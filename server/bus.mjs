// bus.mjs — the realtime attribute bus (spec: docs/superpowers/specs/
// 2026-07-06-realtime-bus-design.md). One BusApp per app path: parses the
// document with the COMPILER'S OWN parser, extracts <server> via app-model,
// transpiles TS carriers via ts-carrier, and runs the tags as SrvNode
// singletons. Protocol: snapshot/delta/set/call/result/error (JSON frames).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wsAccept, encodeText, decodeFrames } from "./connection.mjs";
import { parseHtmlDialect, findLaszloApp } from "../compiler/dist/htmlsource.js";
import { extractApp } from "../compiler/dist/app-model.js";
import { transpileTsBody } from "../compiler/dist/ts-carrier.js";
import { SrvNode } from "./srvnode.mjs";

const DISTRO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const apps = new Map(); // abs path -> BusApp (process-lifetime singletons)

class BusApp {
  constructor(absPath) {
    const root = findLaszloApp(parseHtmlDialect(readFileSync(absPath, "utf8")));
    const model = extractApp(root);
    if (!model.serverTags.length) throw new Error("no <server> section");
    // Spec: duplicate/invalid server tag names REFUSE the app (a silently
    // partial server would mask authoring bugs).
    const bad = [...model.staticIssues, ...model.nameIssues]
      .find((i) => i.message.includes("server tag name"));
    if (bad) throw new Error(bad.message);
    // Declared defaults come from the live section (app-model attrs carry
    // types, not values): read value= per <attribute> from the raw DOM.
    const defaults = {};
    const srvEl = [...root.childNodes].find((c) => c.nodeType === 1 && c.tagName === "SERVER");
    for (const tagEl of [...srvEl.childNodes].filter((c) => c.nodeType === 1)) {
      const tname = tagEl.getAttribute("name");
      defaults[tname] = {};
      for (const a of [...tagEl.childNodes].filter((c) => c.nodeType === 1 && c.tagName === "ATTRIBUTE"))
        defaults[tname][a.getAttribute("name")] = a.getAttribute("value") ?? undefined;
    }
    this.sockets = new Set();
    this.nodes = new Map();
    for (const tag of model.serverTags) {
      const transpiled = {
        ...tag,
        methods: tag.methods.map((m) => ({ ...m, code: transpileTsBody(m.code) })),
        handlers: tag.handlers.map((h) => ({ ...h, code: transpileTsBody(h.code) })),
      };
      this.nodes.set(tag.name, new SrvNode(transpiled, {
        defaults: defaults[tag.name] ?? {},
        onDelta: (t, a, v) => this.broadcast({ op: "delta", tag: t, attr: a, value: v }),
      }));
    }
    for (const n of this.nodes.values()) n.init();
  }
  broadcast(msg) {
    const frame = encodeText(JSON.stringify(msg));
    for (const s of this.sockets) s.write(frame);
  }
  snapshotMsg() {
    const tags = {};
    for (const [name, n] of this.nodes) tags[name] = n.snapshot();
    return { op: "snapshot", tags };
  }
  handle(msg, socket) {
    const send = (m) => socket.write(encodeText(JSON.stringify(m)));
    const node = this.nodes.get(msg.tag);
    if (msg.op === "set") {
      if (!node || !node.hasAttr(msg.attr)) return send({ op: "error", message: `no declared attribute ${msg.tag}.${msg.attr}` });
      try { node.setAttribute(msg.attr, msg.value); } catch (e) { send({ op: "error", message: String(e.message || e) }); }
      return;
    }
    if (msg.op === "call") {
      if (!node || !node.hasMethod(msg.method)) return send({ op: "error", uid: msg.uid, message: `no declared method ${msg.tag}.${msg.method}` });
      try {
        const r = node.callMethod(msg.method, msg.args ?? []);
        Promise.resolve(r).then(
          (value) => send({ op: "result", uid: msg.uid, value: value === undefined ? null : value }),
          (e) => send({ op: "error", uid: msg.uid, message: String(e && e.message || e) }));
      } catch (e) {
        send({ op: "error", uid: msg.uid, message: String(e.message || e) });
      }
      return;
    }
    send({ op: "error", message: `unknown op ${msg.op}` });
  }
}

/** Per-path singleton (shared state, server-lifetime). Exposed for tests.
 *  Failed constructions are NOT cached. */
export function getBusApp(appRelPath) {
  const abs = path.resolve(DISTRO, appRelPath);
  if (!abs.startsWith(DISTRO + path.sep)) throw new Error("path escapes distro");
  if (!apps.has(abs)) apps.set(abs, new BusApp(abs));
  return apps.get(abs);
}

export function busUpgradeHandler(req, socket) {
  if (!wsAccept(req, socket)) return;
  const send = (m) => socket.write(encodeText(JSON.stringify(m)));
  let app;
  try {
    const u = new URL(req.url, "http://localhost");
    app = getBusApp(u.searchParams.get("app") || "");
  } catch (e) {
    send({ op: "error", message: "bus refused: " + String(e.message || e) });
    socket.end();
    return;
  }
  // Snapshot STRICTLY precedes join (spec ordering guarantee).
  send(app.snapshotMsg());
  app.sockets.add(socket);
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, closed, rest } = decodeFrames(buf); buf = rest;
    for (const m of messages) {
      if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; }
      if (m.text == null) continue;
      let msg;
      try { msg = JSON.parse(m.text); } catch { send({ op: "error", message: "malformed frame — closing" }); app.sockets.delete(socket); socket.end(); return; }
      app.handle(msg, socket);
    }
    if (closed) { app.sockets.delete(socket); socket.end(); }
  });
  socket.on("close", () => app.sockets.delete(socket));
  socket.on("error", () => app.sockets.delete(socket));
}
