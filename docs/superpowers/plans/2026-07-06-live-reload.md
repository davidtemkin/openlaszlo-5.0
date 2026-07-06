# Dev Live Reload (Slice 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit the source of a served app and every browser showing it reloads — watch sets formed from the compile closure (wrapper apps) and observed source traffic (DOM-authored pages), delivered over a dev-only WebSocket.

**Architecture:** A reload hub (`server/dev-reload.mjs`) with a pure core (closure filtering, denylist, sweep coalescing, HTML injection) and a thin shell (mtime poller, WS handler on the slice-3 upgrade dispatcher). `server/index.mjs` is refactored to an exported `createDevServer()` so integration tests can boot it on port 0. The service worker gets server-mode passthroughs for the page-synthesizing ops so server-side injection is authoritative.

**Tech Stack:** Node ESM, `node --test`, the slice-3 WS codec/dispatcher (`server/connection.mjs`), the compiler's closure-returning `compileFileCached`.

**Spec:** `docs/superpowers/specs/2026-07-06-live-reload-design.md` (rev 3).

## Global Constraints

- Base: branch `dom-authoring-slice5` REBASED onto `dom-authoring-slice3` HEAD (`caee598` — slice 3 complete; 3b/3c docs on top are inert). Work happens in worktree `.claude/worktrees/reload-slice5`.
- Do NOT touch files owned by frozen in-flight plans: `server/bus.mjs`, `server/srvnode.mjs`, `startup/lz-bus.js`, `compiler/src/{domsource,app-model,lzx-check}.ts`. (`server/connection.mjs` is touched ONLY by the already-landed slice-3 shape; we import from it, never edit it.)
- `runtime/lfc-src` and the `.lzx`-text compile path are byte-frozen — nothing in this slice goes near them.
- Poll interval 500 ms; liveness bound 6 busy sweeps; grace 10 s; cap 100 files/app (log drops); denylist prefixes `/runtime/ /compiler/ /startup/ /lps/` + any path containing `/lps/resources/`.
- Tests live in `compiler/test/` and run via `cd compiler && npm test` (which builds first). Server integration fixtures are created under `examples/.tmp-reload/` and removed in `after()`.
- Every commit message: conventional prefix + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Verified anchors (read before coding if anything looks off)

- Dispatcher: `attachUpgradeDispatcher(httpServer, routes)` + `wsAccept` + `encodeText`/`decodeFrames` — `server/connection.mjs:114/99/21/31`; registered in `server/index.mjs:195-198` with `/api/connection` + `/api/bus`.
- `compileApp()` (`server/compile.mjs:44`) → `compileFileCached` → `{ js, closure, tag, cached }` on BOTH hit and miss (`compiler/dist/api-node.js:26,36`). Closure entries are `{ id: <absPath>, kind: "file"|"dir" }` (`compiler/dist/cache-disk.js:28-31`).
- `toSourceUrl` passthrough for `/startup/` EXISTS on this base (`startup/urlmap.mjs:32`) — the reload client URL serves.
- SW: op-emulation block `service-worker.js:273-282` runs in server mode too (only `/api` at `:261` and COMPILED inside `compileResponse` at `:345` pass through today). `COMPILE_MODE` at `:43`.
- `serveStatic` injection today is index-only (`server/index.mjs:81-91,183-189`); wrapper HTML from `wrapperFor` (`server/wrapper.mjs:106`); dev-views HTML via its local `sendHtml` (`server/dev-views.mjs:18`).
- WS test client `wsClient`/`encodeTextMasked` currently defined inside `compiler/test/bus-integration.test.mjs:9-60`.

---

### Task 0: Worktree + branch setup

**Files:** none (git topology only)

- [ ] **Step 1:** From the main checkout (currently ON `dom-authoring-slice5`): move it off the branch, rebase the branch onto slice 3, create the worktree.

```bash
cd /Users/maxcarlsonold/openlaszlo-5.0
git checkout dom-authoring-slice2
git worktree add .claude/worktrees/reload-slice5 dom-authoring-slice5
cd .claude/worktrees/reload-slice5
git rebase caee598
```
Expected: rebase applies the 3 spec commits cleanly (docs-only).

- [ ] **Step 2:** Sanity: `ls server/bus.mjs startup/urlmap.mjs` exist; `cd compiler && npm test` passes (slice-3 suite green on the base).

---

### Task 1: Extract the WS test client into a shared helper

**Files:**
- Create: `compiler/test/helpers/ws-client.mjs`
- Modify: `compiler/test/bus-integration.test.mjs` (delete local defs, import instead)

**Interfaces:**
- Produces: `wsClient(port, path) -> { ready: Promise, send(obj), next(): Promise<obj>, close(), destroyed(): bool }`, `encodeTextMasked(str): Buffer` — used by Task 5's integration tests.

- [ ] **Step 1:** Move the two functions VERBATIM (lines 9-60 of `bus-integration.test.mjs`, including the masked-frame comment and the close-before-101 rejection) into `compiler/test/helpers/ws-client.mjs`, with the imports they need (`node:net`, `node:crypto`, `decodeFrames` from `../../../server/connection.mjs` — note the extra `../` from `helpers/`).
- [ ] **Step 2:** In `bus-integration.test.mjs` replace the definitions with `import { wsClient, encodeTextMasked } from "./helpers/ws-client.mjs";` (keep its other imports; `encodeTextMasked` may be unused there after the move — keep the import only if used).
- [ ] **Step 3:** Run: `cd compiler && npm test` → all existing tests PASS (pure move).
- [ ] **Step 4:** Commit: `test: extract dependency-free WS client into test helper`

---

### Task 2: `createDevServer()` refactor + argv flags

**Files:**
- Modify: `server/index.mjs`
- Test: `compiler/test/dev-server.test.mjs`

**Interfaces:**
- Produces: `parseServerArgs(argv: string[]) -> { port: number, reload: boolean }`;
  `createDevServer({ port = 8090, reload = true } = {}) -> Promise<{ server, port, hub|null, close(): Promise }>` — every later integration test consumes this. `hub` is `null` until Task 4 wires it (declare the property now, set `null`).

- [ ] **Step 1: Write the failing test** (`compiler/test/dev-server.test.mjs`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseServerArgs, createDevServer } from "../../server/index.mjs";

const get = (port, path, headers = {}) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port, path, headers }, (r) => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on("error", rej);
});

test("parseServerArgs: flags anywhere, first non-flag is the port", () => {
  assert.deepEqual(parseServerArgs([]), { port: 8090, reload: true });
  assert.deepEqual(parseServerArgs(["9000"]), { port: 9000, reload: true });
  assert.deepEqual(parseServerArgs(["--no-reload", "9000"]), { port: 9000, reload: false });
  assert.deepEqual(parseServerArgs(["9000", "--no-reload"]), { port: 9000, reload: false });
});

test("createDevServer boots on port 0 and serves the Explorer index", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    assert.ok(srv.port > 0);
    const r = await get(srv.port, "/");
    assert.equal(r.status, 200);
    assert.match(r.body, /__OL_COMPILE="server"/);
  } finally { await srv.close(); }
});
```

- [ ] **Step 2:** Run: `cd compiler && npm test` → new file FAILS (`parseServerArgs` not exported; importing `server/index.mjs` also side-effect-listens on 8090 — that's the bug the refactor fixes).
- [ ] **Step 3: Refactor `server/index.mjs`.** Mechanical shape (keep every existing handler body byte-identical unless a step below says otherwise):
  - Delete module-level `const PORT = …` and the module-level `const server = http.createServer(…)` / `attachUpgradeDispatcher(…)` / `server.listen(…)` tail.
  - Change the URL parse inside the request handler to `new URL(req.url, "http://localhost")` (the host part is never used).
  - Add at the bottom:

```js
export function parseServerArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--")));
  const pos = argv.find(a => !a.startsWith("--"));
  return { port: parseInt(pos || "8090", 10), reload: !flags.has("--no-reload") };
}

export function createDevServer({ port = 8090, reload = true } = {}) {
  const server = http.createServer(handleRequest);            // handleRequest = the existing async handler, now a named fn
  attachUpgradeDispatcher(server, {
    "/api/connection": connectionUpgradeHandler,
    "/api/bus": busUpgradeHandler,
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({
      server, port: server.address().port, hub: null,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port, reload } = parseServerArgs(process.argv.slice(2));
  createDevServer({ port, reload }).then((s) => {
    console.log(`OpenLaszlo dynamic server → http://localhost:${s.port}/`);
    console.log("  server-side compile (TS, disk-cached) + /api + persistent connection");
    console.log("  connection (WebSocket) server on /api/connection");
  });
}
```
  (Move the two existing `console.log` lines into the CLI branch as shown; `reload` is accepted and ignored until Task 4.)
- [ ] **Step 4:** Run: `cd compiler && npm test` → both new tests PASS, everything else still green. Also `node server/index.mjs 8091 &` from the worktree root; `curl -s localhost:8091/ | grep -c __OL_COMPILE` → 1; kill it.
- [ ] **Step 5:** Commit: `server: export createDevServer() + flag-aware argv (port 0 testable, --no-reload parsed)`

---

### Task 3: Reload pure core — filters, injection, sweep coalescing

**Files:**
- Create: `server/dev-reload.mjs` (pure functions only in this task)
- Test: `compiler/test/dev-reload-core.test.mjs`

**Interfaces (produces, consumed by Tasks 4-6):**
- `isSourceTypeUrl(p: string): boolean` — `.lzx|.html|.ts|.js` (case-insensitive)
- `isDenylistedUrl(p: string): boolean` — prefixes `/runtime/ /compiler/ /startup/ /lps/` or contains `/lps/resources/`
- `filterClosureEntries(entries: {id,kind}[], { distro, runtime }): string[]` — `kind==="file"`, under distro, NOT under runtime / `<distro>/compiler/` / `<distro>/startup/`; cap 100 with `{kept, dropped}` return: `{ files: string[], dropped: number }`
- `injectHtml(html: string, tag: string): string` — before `</head>`, else before `</body>`, else append
- `nextSweep(state: {pending:Set<string>, busy:number}, changed: string[], maxBusy=6): { broadcast: string[]|null, state }`

- [ ] **Step 1: Write the failing tests** (`compiler/test/dev-reload-core.test.mjs`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSourceTypeUrl, isDenylistedUrl, filterClosureEntries, injectHtml, nextSweep }
  from "../../server/dev-reload.mjs";

test("isSourceTypeUrl", () => {
  for (const p of ["/a/b.lzx", "/a/b.html", "/a/b.ts", "/a/b.js", "/a/B.LZX"]) assert.ok(isSourceTypeUrl(p), p);
  for (const p of ["/a/b.png", "/a/b.css", "/a/b.json", "/a/b"]) assert.ok(!isSourceTypeUrl(p), p);
});

test("isDenylistedUrl", () => {
  for (const p of ["/runtime/lfc/lfc.js", "/compiler/lzc-browser.js", "/startup/laszlo-dom.js",
                   "/lps/includes/explore.css", "/examples/x/lps/resources/lps/components/y.gif"])
    assert.ok(isDenylistedUrl(p), p);
  for (const p of ["/examples/calendar/calendar.lzx", "/coverpages/welcome.lzx"]) assert.ok(!isDenylistedUrl(p), p);
});

test("filterClosureEntries: files under distro only, no runtime/compiler/startup, capped", () => {
  const distro = "/D", runtime = "/D/runtime";
  const mk = (id, kind = "file") => ({ id, kind });
  const r = filterClosureEntries([
    mk("/D/examples/app.lzx"), mk("/D/examples/inc.lzx"),
    mk("/D/runtime/components/lz/button.lzx"), mk("/D/compiler/dist/node.js"),
    mk("/D/startup/urlmap.mjs"), mk("/D/examples", "dir"), mk("/elsewhere/x.lzx"),
  ], { distro, runtime });
  assert.deepEqual(r.files, ["/D/examples/app.lzx", "/D/examples/inc.lzx"]);
  assert.equal(r.dropped, 0);
  const many = Array.from({ length: 150 }, (_, i) => mk(`/D/e/f${i}.lzx`));
  const capped = filterClosureEntries(many, { distro, runtime });
  assert.equal(capped.files.length, 100);
  assert.equal(capped.dropped, 50);
});

test("injectHtml placement", () => {
  const T = "<script>x</script>";
  assert.equal(injectHtml("<html><head></head><body></body></html>", T),
               `<html><head>${T}</head><body></body></html>`);
  assert.equal(injectHtml("<html><body></body></html>", T), `<html><body>${T}</body></html>`);
  assert.equal(injectHtml("<p>bare", T), `<p>bare${T}`);
});

test("nextSweep: quiet-sweep broadcast + liveness bound", () => {
  let s = { pending: new Set(), busy: 0 };
  let r = nextSweep(s, ["/a.lzx"]);                 // busy sweep 1
  assert.equal(r.broadcast, null); s = r.state;
  r = nextSweep(s, []);                             // quiet → flush
  assert.deepEqual(r.broadcast, ["/a.lzx"]); s = r.state;
  assert.equal(s.pending.size, 0); assert.equal(s.busy, 0);
  r = nextSweep(s, []);                             // idle → nothing
  assert.equal(r.broadcast, null); s = r.state;
  for (let i = 0; i < 5; i++) { r = nextSweep(s, [`/f${i}`]); assert.equal(r.broadcast, null, `sweep ${i}`); s = r.state; }
  r = nextSweep(s, ["/f5"]);                        // 6th busy sweep → forced flush
  assert.equal(r.broadcast.length, 6);
});
```

- [ ] **Step 2:** Run: `cd compiler && npm test` → FAILS (module not found).
- [ ] **Step 3: Implement** the five functions in `server/dev-reload.mjs`:

```js
// server/dev-reload.mjs — dev live reload (spec: docs/superpowers/specs/2026-07-06-live-reload-design.md).
// Pure core (this section) + hub/WS shell (below, Task 4+). Dev-only; --no-reload disables.
import path from "node:path";

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
```

- [ ] **Step 4:** Run: `cd compiler && npm test` → PASS.
- [ ] **Step 5:** Commit: `server: dev-reload pure core (source/denylist filters, closure filter, injectHtml, sweep coalescing)`

---

### Task 4: The reload hub — watch sets, poller, WS handler

**Files:**
- Modify: `server/dev-reload.mjs` (append the hub)
- Modify: `server/index.mjs` (instantiate + route + hooks)
- Test: `compiler/test/dev-reload-hub.test.mjs` (hub with injected stat; no sockets)

**Interfaces (produces):**
- `createReloadHub({ distro, runtime, statFn?, intervalMs?, graceMs?, log? }) -> hub`
- `hub.noteClosure(appUrlPath, closure)` — store ALWAYS (pre-watch arrivals kept), filtered
- `hub.noteRequest(srcUrlPath, refererUrlPath|null)` — ring buffer + live-set add
- `hub.watch(appUrlPath, loadedAt, socket) -> { ok, stale } | { error }` — creates/joins set
- `hub.sweepOnce()` — one poll pass (tests call this directly; the interval calls it)
- `hub.upgradeHandler(req, socket)` — the WS endpoint (Task 5 tests it end-to-end)
- `hub.bootId: string`; `hub.appCount(): number` (observability for tests)
- `hub.start()/stop()` — interval lifecycle (`unref()`d)
- Socket protocol: S→C `{op:"hello",bootId}` on accept; C→S `{op:"watch",app,loadedAt}`; S→C `{op:"changed",paths}` / `{op:"error",message}` (then close).

- [ ] **Step 1: Write the failing tests** (`compiler/test/dev-reload-hub.test.mjs`) — hub logic with a fake `statFn` and a fake socket (`{written:[], write(b){this.written.push(b)}, destroyed:false}`); decode frames with `decodeFrames` from `server/connection.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createReloadHub } from "../../server/dev-reload.mjs";
import { decodeFrames } from "../../server/connection.mjs";

const DISTRO = path.resolve("/D");
const mkHub = (stats) => createReloadHub({
  distro: DISTRO, runtime: path.join(DISTRO, "runtime"),
  statFn: (p) => { const s = stats.get(p); if (!s) throw new Error("ENOENT"); return s; },
  log: () => {},
});
const fakeSock = () => ({ written: [], write(b) { this.written.push(b); }, destroyed: false, destroy() { this.destroyed = true; }, end() {} });
const frames = (sock) => {
  const { messages } = decodeFrames(Buffer.concat(sock.written.map(b => Buffer.isBuffer(b) ? b : Buffer.from(b))));
  return messages.filter(m => m.text).map(m => JSON.parse(m.text));
};

test("watch seeds from the app file + stored closure; sweep detects change and broadcasts", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx"), incAbs = path.join(DISTRO, "examples/t/inc.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 10 }], [incAbs, { mtimeMs: 1, size: 5 }]]);
  const hub = mkHub(stats);
  hub.noteClosure(app, { entries: [{ id: appAbs, kind: "file" }, { id: incAbs, kind: "file" }] }); // BEFORE watch
  const sock = fakeSock();
  hub.attach(sock);                                    // hello
  const r = hub.watch(app, 5_000, sock);
  assert.equal(r.ok, true); assert.equal(r.stale, false);
  hub.sweepOnce();                                     // baseline established at watch; nothing changed
  stats.set(incAbs, { mtimeMs: 2, size: 5 });          // edit the include
  hub.sweepOnce();                                     // busy sweep — accumulate
  hub.sweepOnce();                                     // quiet sweep — broadcast
  const msgs = frames(sock);
  assert.equal(msgs[0].op, "hello");
  const changed = msgs.find(m => m.op === "changed");
  assert.ok(changed && changed.paths.some(p => p.endsWith("inc.lzx")));
});

test("loadedAt staleness answers changed immediately", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 9_999, size: 10 }]]);
  const hub = mkHub(stats);
  const sock = fakeSock(); hub.attach(sock);
  const r = hub.watch(app, 5_000, sock);               // page loaded before the file's mtime
  assert.equal(r.stale, true);
  assert.ok(frames(sock).some(m => m.op === "changed"));
});

test("watch outside the served root is refused", () => {
  const hub = mkHub(new Map());
  const sock = fakeSock(); hub.attach(sock);
  const r = hub.watch("/../etc/passwd", 0, sock);
  assert.ok(r.error);
});

test("noteRequest joins live sets via referer; denylisted and non-source never join; ring replays", () => {
  const app = "/examples/t/page.html";
  const appAbs = path.join(DISTRO, "examples/t/page.html"), tsAbs = path.join(DISTRO, "examples/t/code.ts");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 1 }], [tsAbs, { mtimeMs: 1, size: 1 }]]);
  const hub = mkHub(stats);
  hub.noteRequest("/examples/t/code.ts", app);          // BEFORE watch → ring
  hub.noteRequest("/runtime/lfc/lfc.js", app);          // denylisted
  hub.noteRequest("/examples/t/pic.png", app);          // not source-typed
  const sock = fakeSock(); hub.attach(sock);
  hub.watch(app, 5_000, sock);
  assert.equal(hub.watchedFiles(app).length, 2);        // page + code.ts (replayed)
  assert.ok(hub.watchedFiles(app).includes(tsAbs));
});

test("grace teardown: last socket close keeps the set for graceMs, then drops it", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 1 }]]);
  let now = 0;
  const hub = createReloadHub({
    distro: DISTRO, runtime: path.join(DISTRO, "runtime"),
    statFn: (p) => stats.get(p) || (() => { throw new Error("ENOENT"); })(),
    graceMs: 10_000, nowFn: () => now, log: () => {},
  });
  const sock = fakeSock(); hub.attach(sock);
  hub.watch(app, 5_000, sock);
  hub.detach(sock);
  assert.equal(hub.appCount(), 1);                      // grace holds it
  now = 11_000; hub.sweepOnce();
  assert.equal(hub.appCount(), 0);
});
```

- [ ] **Step 2:** Run → FAIL (`createReloadHub` not exported).
- [ ] **Step 3: Implement the hub** (append to `server/dev-reload.mjs`):

```js
import crypto from "node:crypto";
import fs from "node:fs";
import { wsAccept, encodeText, decodeFrames } from "./connection.mjs";
import { toSourceUrl } from "../startup/urlmap.mjs";

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
    const abs = path.normalize(path.join(distro, norm(urlPath)));
    return abs.startsWith(distro) ? abs : null;
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
      const st = sockets.get(sock); if (st) st.app = key;
      // staleness: any seed file newer than the page load → reload now
      let stale = false;
      for (const [f, base] of a.files) if (base && base.mtimeMs > loadedAt) { stale = true; break; }
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
          const was = base, is = cur;
          const differs = (was === null) !== (is === null) ||
            (was && is && (was.mtimeMs !== is.mtimeMs || was.size !== is.size));
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
```

- [ ] **Step 4:** Run: `cd compiler && npm test` → hub tests PASS.
- [ ] **Step 5: Wire into `server/index.mjs`** (inside `createDevServer`):
  - `import { createReloadHub, injectHtml } from "./dev-reload.mjs";`
  - In `createDevServer`: `const hub = reload ? createReloadHub({ distro: DISTRO, runtime: RUNTIME }) : null; if (hub) hub.start();`
  - Routes: add `...(hub ? { "/api/dev-reload": hub.upgradeHandler } : {})` to the dispatcher map.
  - Resolve `{ server, port, hub, close }`; `close` also calls `hub?.stop()`.
  - Thread `hub` to the request handler (make `handleRequest` a closure created by a `makeHandler(hub)` factory, or attach via module-level `let activeHub` set in `createDevServer` — use the factory; module-level state only for dev-views injection, Task 6).
  - In the main handler, right before the final `serveStatic(...)` call (step 3 of the dispatch), add:
    ```js
    if (hub) hub.noteRequest(p, refererPath(req));
    ```
    with the helper `const refererPath = (req) => { try { return req.headers.referer ? new URL(req.headers.referer).pathname : null; } catch { return null; } };`
    (This runs for 200s AND 304s — serveStatic decides the status afterward.)
  - In `compileEndpoint`, after a successful `compileApp` (`r` has no `.unsupported`), BEFORE the ETag check:
    ```js
    if (hub && r.closure) hub.noteClosure(url.pathname.replace(/\.js$/, ""), r.closure);
    ```
    `compileEndpoint` therefore takes `hub` as a 4th arg (thread from the handler factory).
- [ ] **Step 6: Integration smoke** (append to `compiler/test/dev-server.test.mjs`):

```js
test("dev-reload endpoint answers hello over a real socket", async () => {
  const { wsClient } = await import("./helpers/ws-client.mjs");
  const srv = await createDevServer({ port: 0 });
  try {
    const ws = wsClient(srv.port, "/api/dev-reload");
    await ws.ready;
    const hello = await ws.next();
    assert.equal(hello.op, "hello");
    assert.ok(hello.bootId);
    ws.close();
  } finally { await srv.close(); }
});

test("--no-reload leaves the endpoint unregistered", async () => {
  const { wsClient } = await import("./helpers/ws-client.mjs");
  const srv = await createDevServer({ port: 0, reload: false });
  try {
    const ws = wsClient(srv.port, "/api/dev-reload");
    await assert.rejects(ws.ready);       // dispatcher destroys unclaimed paths
  } finally { await srv.close(); }
});
```

- [ ] **Step 7:** Run: `cd compiler && npm test` → PASS.
- [ ] **Step 8:** Commit: `server: reload hub (watch sets, closure store, ring, grace, staleness) + /api/dev-reload endpoint`

---

### Task 5: End-to-end watch behavior over the wire

**Files:**
- Test: `compiler/test/dev-reload-integration.test.mjs`
- (Fixture dir `examples/.tmp-reload/` created/removed by the test.)

**Interfaces:** consumes Task 2's `createDevServer`, Task 1's `wsClient`, Task 4's protocol.

- [ ] **Step 1: Write the failing test:**

```js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../server/index.mjs";
import { wsClient } from "./helpers/ws-client.mjs";

const DISTRO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = path.join(DISTRO, "examples/.tmp-reload");
const APP = "/examples/.tmp-reload/app.lzx";
const INC = path.join(FIX, "inc.lzx");

const get = (port, p, headers = {}) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port, path: p, headers }, (r) => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on("error", rej);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let srv;
before(async () => {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(INC, `<library><class name="tmphello" extends="text"/></library>`);
  fs.writeFileSync(path.join(FIX, "app.lzx"),
    `<canvas width="100" height="100"><include href="inc.lzx"/><tmphello text="hi"/></canvas>`);
  srv = await createDevServer({ port: 0 });
});
after(async () => { await srv.close(); fs.rmSync(FIX, { recursive: true, force: true }); });

async function watched(appPath, loadedAt = Date.now()) {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready;
  assert.equal((await ws.next()).op, "hello");
  ws.send({ op: "watch", app: appPath, loadedAt });
  return ws;
}

test("closure include: compile first, then watch, then edit include → changed", async () => {
  const r = await get(srv.port, APP + ".js");              // compile → noteClosure (pre-watch!)
  assert.equal(r.status, 200);
  const ws = await watched(APP);
  await sleep(700);                                        // let a baseline sweep pass
  fs.appendFileSync(INC, "<!-- edit -->");
  const msg = await ws.next();                             // ~1-1.5s: busy sweep + quiet sweep
  assert.equal(msg.op, "changed");
  assert.ok(msg.paths.some(p => p.endsWith("inc.lzx")));
  ws.close();
});

test("watch outside root refused with error frame", async () => {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready; await ws.next();                          // hello
  ws.send({ op: "watch", app: "/../../etc/passwd", loadedAt: 0 });
  const msg = await ws.next();
  assert.equal(msg.op, "error");
  ws.close();
});

test("stale loadedAt gets immediate changed", async () => {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready; await ws.next();
  ws.send({ op: "watch", app: APP, loadedAt: 1 });          // loaded before the file existed
  const msg = await ws.next();
  assert.equal(msg.op, "changed");
  ws.close();
});

test("referer-tracked source fetch joins; denylisted does not", async () => {
  const ws = await watched(APP);
  const referer = `http://127.0.0.1:${srv.port}${APP}`;
  await get(srv.port, "/examples/.tmp-reload/inc.lzx", { referer });     // source-typed → joins
  await get(srv.port, "/runtime/lfc/lfc.js", { referer });               // denylisted → no
  assert.ok(srv.hub.watchedFiles(APP).some(f => f.endsWith("inc.lzx")));
  assert.ok(!srv.hub.watchedFiles(APP).some(f => f.includes("runtime")));
  ws.close();
});
```

- [ ] **Step 2:** Run → the first test FAILS if any wiring is off (this is the flagship round-2 race case: closure arrives before `watch`). Fix until green. Timing note: poll = 500 ms, so `changed` arrives within ~1.5 s; `node --test` default timeout is fine.
- [ ] **Step 3:** Full run: `cd compiler && npm test` → all green (bus suite unaffected).
- [ ] **Step 4:** Commit: `test: dev-reload integration — closure race, refusal, staleness, referer joins`

---

### Task 6: HTML injection everywhere + reload client + SW passthrough

**Files:**
- Modify: `server/index.mjs` (`serveStatic` html branch, `serveWrapper`)
- Modify: `server/dev-views.mjs` (`sendHtml` injects)
- Modify: `server/dev-reload.mjs` (module-level enable flag + `RELOAD_TAG`)
- Create: `startup/dev-reload-client.js`
- Modify: `service-worker.js` (server-mode passthrough for RUN/SOURCE/SRCTEXT/EDIT/EDIT_POST)
- Test: extend `compiler/test/dev-server.test.mjs`

**Interfaces:**
- `dev-reload.mjs` exports: `RELOAD_TAG = '<script src="/startup/dev-reload-client.js" defer></script>'`, `setReloadEnabled(bool)`, `reloadTagIfEnabled(): string` (empty when disabled). `injectHtml(html, reloadTagIfEnabled())` is a no-op when disabled (injecting an empty tag must return html unchanged — add that guard to `injectHtml`).

- [ ] **Step 1: Failing tests** (append to `dev-server.test.mjs`):

```js
test("wrapper, static html, and editor pages carry the reload client; index keeps __OL_COMPILE", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    const idx = await get(srv.port, "/");
    assert.match(idx.body, /__OL_COMPILE="server"/);
    assert.match(idx.body, /dev-reload-client\.js/);
    const wrap = await get(srv.port, "/examples/calendar/calendar.lzx", { accept: "text/html" });
    assert.match(wrap.body, /dev-reload-client\.js/);
    const ed = await get(srv.port, "/examples/calendar/calendar.lzx?edit", { accept: "text/html" });
    assert.match(ed.body, /dev-reload-client\.js/);
  } finally { await srv.close(); }
});

test("--no-reload injects nothing", async () => {
  const srv = await createDevServer({ port: 0, reload: false });
  try {
    const wrap = await get(srv.port, "/examples/calendar/calendar.lzx", { accept: "text/html" });
    assert.doesNotMatch(wrap.body, /dev-reload-client\.js/);
  } finally { await srv.close(); }
});

test("injected static html gets a distinct etag (no stale 304 from pre-injection caches)", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    const one = await get(srv.port, "/examples/dom-authoring/file-demo.html");
    assert.match(one.body, /dev-reload-client\.js/);
    assert.match(one.headers.etag || "", /-r"$/);
    const not = await get(srv.port, "/examples/dom-authoring/file-demo.html", { "if-none-match": one.headers.etag });
    assert.equal(not.status, 304);
  } finally { await srv.close(); }
});

test("reload client file serves from /startup/", async () => {
  const srv = await createDevServer({ port: 0 });
  try { assert.equal((await get(srv.port, "/startup/dev-reload-client.js")).status, 200); }
  finally { await srv.close(); }
});
```
(If `/examples/dom-authoring/file-demo.html` doesn't exist on this base, substitute any static `.html` under `examples/` — check with `ls examples/dom-authoring/*.html` and pin the path in the test.)

- [ ] **Step 2:** Run → FAIL. Implement:
  - `dev-reload.mjs`: `let enabled = true; export const setReloadEnabled = (v) => { enabled = !!v; }; export const RELOAD_TAG = '<script src="/startup/dev-reload-client.js" defer></script>'; export const reloadTagIfEnabled = () => (enabled ? RELOAD_TAG : "");` and guard `injectHtml`: `if (!tag) return html;`.
  - `createDevServer`: call `setReloadEnabled(reload)`.
  - `serveStatic` html handling — replace the `inject` special case with:

```js
  const isHtml = mimeOf(abs).startsWith("text/html");
  if (isHtml || inject) {
    let html = fs.readFileSync(abs, "utf8");
    if (inject) html = html.replace(/<\/head>/i, '<script>window.__OL_COMPILE="server"</script></head>');
    html = injectHtml(html, reloadTagIfEnabled());
    const st2 = fs.statSync(abs);
    const etag = `"${st2.size.toString(16)}-${Math.floor(st2.mtimeMs).toString(16)}-r"`;
    if (req.headers["if-none-match"] === etag) return send(res, 304, undefined, { ETag: etag });
    return send(res, 200, html, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache", ETag: etag });
  }
```
  - `serveWrapper`: `send(res, 200, injectHtml(r.html, reloadTagIfEnabled()), …)`.
  - `dev-views.mjs` `sendHtml`: `res.end(injectHtml(body, reloadTagIfEnabled()))` (import both from `./dev-reload.mjs`).
- [ ] **Step 3: Write `startup/dev-reload-client.js`:**

```js
// dev-reload-client.js — injected by the dynamic server in dev mode (never by static hosts).
// Protocol: docs/superpowers/specs/2026-07-06-live-reload-design.md. One console line on
// unavailability; reconnect with capped backoff; reload on changed / on bootId change.
(function () {
  var loadedAt = Date.now();
  var bootId = null, everConnected = false, attempts = 0;
  function connect() {
    var ws;
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/dev-reload"); }
    catch (e) { return quiet(); }
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.op === "hello") {
        everConnected = true; attempts = 0;
        if (bootId && m.bootId !== bootId) { location.reload(); return; }
        bootId = m.bootId;
        ws.send(JSON.stringify({ op: "watch", app: location.pathname, loadedAt: loadedAt }));
      } else if (m.op === "changed") location.reload();
    };
    ws.onclose = function () {
      if (!everConnected) return quiet();               // endpoint absent (static host / --no-reload): go quiet
      attempts++;
      setTimeout(connect, Math.min(8000, 250 * Math.pow(2, attempts)));
    };
  }
  var quieted = false;
  function quiet() { if (!quieted) { quieted = true; console.log("[dev-reload] unavailable; live reload off"); } }
  connect();
})();
```
- [ ] **Step 4: SW passthrough** — in `service-worker.js`, at the TOP of the classify block (immediately after `const op = classifyLzxRequest(...)` at ~line 274), insert:

```js
    // SERVER mode: the Node server owns the page-synthesizing ops (wrapper/source/editor)
    // so dev-mode injection (live reload) is authoritative — mirrors the /api and COMPILED
    // passthroughs. COMPILED keeps its own passthrough inside compileResponse (edit tokens).
    if (COMPILE_MODE === "server" &&
        (op === OP.RUN || op === OP.SOURCE || op === OP.SRCTEXT || op === OP.EDIT || op === OP.EDIT_POST)) {
      event.respondWith(fetch(req));
      return;
    }
```
- [ ] **Step 5:** Run: `cd compiler && npm test` → all green.
- [ ] **Step 6:** Commit: `server: inject reload client on every HTML emitter; SW server-mode passthrough; reload client`

---

### Task 7: Verification, docs, memory

- [ ] **Step 1: Full suite** — `cd compiler && npm test` → green; note the count delta vs. Task 0's baseline.
- [ ] **Step 2: Manual E2E via Playwright MCP** (the repo has no Playwright dep — this is operator verification, per plan): `node server/index.mjs 8090` in the worktree; browser to `http://localhost:8090/examples/calendar/calendar.lzx`; confirm the app renders; `echo ' ' >> examples/calendar/calendar.lzx` (whitespace append; revert after); confirm the tab reloads within ~2 s. Repeat once after visiting `/` first (SW installed) — same behavior. Revert the file (`git checkout -- examples/calendar/calendar.lzx`).
- [ ] **Step 3: Docs** — extend the header comment of `server/index.mjs` usage line to `node server/index.mjs [port=8090] [--no-reload]`; add a short "Live reload" paragraph to `docs/` alongside the spec (one file: `docs/superpowers/specs/2026-07-06-live-reload-design.md` gains a final `**Status:** implemented — <date>` line edit at the top instead of a separate doc).
- [ ] **Step 4:** Commit: `docs: live reload usage + spec status`; update project memory (slice 5 done, branch state).
