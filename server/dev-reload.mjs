// server/dev-reload.mjs — dev live reload (spec: docs/superpowers/specs/2026-07-06-live-reload-design.md).
// Pure core (filters, injection, sweep coalescing) + the hub/WS shell. Dev-only; --no-reload disables.
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { wsAccept, encodeText, decodeFrames } from "./connection.mjs";
import { toSourceUrl } from "../startup/urlmap.mjs";

const SRC_EXT = /\.(lzx|html|ts|js)$/i;
const DENY_PREFIX = ["/runtime/", "/compiler/", "/startup/", "/lps/"];
export const WATCH_CAP = 100;

export const isSourceTypeUrl = (p) => SRC_EXT.test(p);
export const isDenylistedUrl = (p) =>
  DENY_PREFIX.some((pre) => p.startsWith(pre)) || p.includes("/lps/resources/");

export function filterClosureEntries(entries, { distro, runtime }) {
  const under = (base, id) => id.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  const files = [];
  for (const e of entries || []) {
    if (e.kind !== "file") continue;
    if (!under(distro, e.id)) continue;
    if (under(runtime, e.id) || under(path.join(distro, "compiler"), e.id) || under(path.join(distro, "startup"), e.id)) continue;
    files.push(e.id);
  }
  const dropped = Math.max(0, files.length - WATCH_CAP);
  return { files: files.slice(0, WATCH_CAP), dropped };
}

export function injectHtml(html, tag) {
  if (!tag) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tag + "</head>");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, tag + "</body>");
  return html + tag;
}

export function nextSweep(state, changed, maxBusy = 6) {
  const pending = new Set(state.pending);
  for (const c of changed) pending.add(c);
  if (changed.length === 0) {
    if (pending.size > 0) return { broadcast: [...pending], state: { pending: new Set(), busy: 0 } };
    return { broadcast: null, state: { pending, busy: 0 } };
  }
  const busy = state.busy + 1;
  if (busy >= maxBusy) return { broadcast: [...pending], state: { pending: new Set(), busy: 0 } };
  return { broadcast: null, state: { pending, busy } };
}

// ── the hub: watch sets, closure store, ring, poller, WS endpoint ─────────────────────────

const RING_MAX = 50;

export function createReloadHub({
  distro, runtime, statFn, intervalMs = 500, graceMs = 10_000, nowFn = Date.now, log = console.log,
} = {}) {
  const stat = statFn || ((p) => { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size }; });
  const bootId = crypto.randomUUID();
  const apps = new Map();       // appUrl -> { files: Map<abs, {mtimeMs,size}|null>, sockets:Set, sweep:{pending,busy}, graceUntil:null|ms }
  const closures = new Map();   // appUrl -> string[] (filtered abs paths) — outlives watch sets
  const ring = [];              // [{src, app}]
  const sockets = new Map();    // socket -> { app: string|null, buf: Buffer }
  let timer = null;

  const norm = (p) => toSourceUrl(p.split("?")[0]);
  const absOf = (urlPath) => {
    // Refuse traversal BEFORE normalization: toSourceUrl may prefix /explorer,
    // making "/../x" normalize back INSIDE distro ("/explorer/../x" → "/x").
    if (urlPath.split("?")[0].split("/").includes("..")) return null;
    const abs = path.normalize(path.join(distro, norm(urlPath)));
    return abs.startsWith(distro.endsWith(path.sep) ? distro : distro + path.sep) ? abs : null;
  };
  const sendTo = (sock, obj) => { try { sock.write(encodeText(JSON.stringify(obj))); } catch {} };
  const baseline = (a, absPath) => {
    if (a.files.has(absPath)) return;
    try { a.files.set(absPath, stat(absPath)); } catch { a.files.set(absPath, null); }
  };

  function addFile(appUrl, absPath) {
    const a = apps.get(appUrl);
    if (!a || a.files.has(absPath)) return;
    if (a.files.size >= WATCH_CAP) { log(`[dev-reload] cap: dropping ${absPath} for ${appUrl}`); return; }
    baseline(a, absPath);
  }

  const hub = {
    bootId,
    appCount: () => apps.size,
    watchedFiles: (appUrl) => [...(apps.get(norm(appUrl))?.files.keys() || [])],

    noteClosure(appUrl, closure) {
      const key = norm(appUrl);
      const { files, dropped } = filterClosureEntries(closure?.entries, { distro, runtime });
      if (dropped) log(`[dev-reload] closure cap: dropped ${dropped} entries for ${key}`);
      closures.set(key, files);
      const a = apps.get(key);
      if (a) for (const f of files) addFile(key, f);
    },

    noteRequest(srcUrlPath, refererUrlPath) {
      if (!refererUrlPath) return;
      const src = norm(srcUrlPath);
      if (!isSourceTypeUrl(src) || isDenylistedUrl(src)) return;
      const app = norm(refererUrlPath);
      ring.push({ src, app });
      if (ring.length > RING_MAX) ring.shift();
      if (apps.has(app)) { const abs = absOf(src); if (abs) addFile(app, abs); }
    },

    watch(appUrlPath, loadedAt, sock) {
      const st0 = sockets.get(sock);
      if (st0 && st0.app) return { error: "one watch per socket" };   // spec: one app per page/socket
      const key = norm(appUrlPath);
      const abs = absOf(appUrlPath);
      if (!abs) return { error: "path outside served root" };
      let a = apps.get(key);
      if (!a) {
        a = { files: new Map(), sockets: new Set(), sweep: { pending: new Set(), busy: 0 }, graceUntil: null };
        apps.set(key, a);
        baseline(a, abs);
        for (const f of closures.get(key) || []) addFile(key, f);
        for (const r of ring) if (r.app === key) { const fa = absOf(r.src); if (fa) addFile(key, fa); }
      }
      a.graceUntil = null;
      a.sockets.add(sock);
      if (st0) st0.app = key;
      // staleness: any seed file newer than the page load → reload now
      let stale = false;
      for (const [, base] of a.files) if (base && base.mtimeMs > loadedAt) { stale = true; break; }
      if (stale) sendTo(sock, { op: "changed", paths: [key] });
      return { ok: true, stale };
    },

    attach(sock) {
      sockets.set(sock, { app: null, buf: Buffer.alloc(0) });
      sendTo(sock, { op: "hello", bootId });
    },
    detach(sock) {
      const st = sockets.get(sock);
      sockets.delete(sock);
      if (!st || !st.app) return;
      const a = apps.get(st.app);
      if (!a) return;
      a.sockets.delete(sock);
      if (a.sockets.size === 0) a.graceUntil = nowFn() + graceMs;
    },

    sweepOnce() {
      const now = nowFn();
      for (const [key, a] of apps) {
        if (a.sockets.size === 0 && a.graceUntil !== null && now >= a.graceUntil) { apps.delete(key); continue; }
        const changed = [];
        for (const [f, base] of a.files) {
          let cur = null;
          try { cur = stat(f); } catch {}
          const differs = (base === null) !== (cur === null) ||
            (base && cur && (base.mtimeMs !== cur.mtimeMs || base.size !== cur.size));
          if (differs) { changed.push(f); a.files.set(f, cur); }
        }
        const rel = changed.map((f) => f.slice(distro.length));
        const r = nextSweep(a.sweep, rel);
        a.sweep = r.state;
        if (r.broadcast) for (const s of a.sockets) sendTo(s, { op: "changed", paths: r.broadcast });
      }
    },

    upgradeHandler(req, socket) {
      if (!wsAccept(req, socket)) return;
      hub.attach(socket);
      socket.on("data", (chunk) => {
        const st = sockets.get(socket); if (!st) return;
        st.buf = Buffer.concat([st.buf, chunk]);
        const { messages, closed, rest } = decodeFrames(st.buf); st.buf = rest;
        for (const m of messages) {
          if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; }
          let msg; try { msg = JSON.parse(m.text); } catch { sendTo(socket, { op: "error", message: "bad frame" }); socket.end(); return; }
          if (msg.op === "watch") {
            const r = hub.watch(String(msg.app || ""), Number(msg.loadedAt) || 0, socket);
            if (r.error) { sendTo(socket, { op: "error", message: r.error }); socket.end(); }
          }
        }
        if (closed) { hub.detach(socket); socket.end(); }
      });
      socket.on("close", () => hub.detach(socket));
      socket.on("error", () => hub.detach(socket));
    },

    start() { if (!timer) { timer = setInterval(() => hub.sweepOnce(), intervalMs); timer.unref?.(); } },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
  return hub;
}
