# Realtime Bus (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dreem2's realtime bus for openlaszlo-5.0 — a `<server>` section inside `<laszlo-app>` whose tags run as shared `SrvNode` singletons on the Node server, sync attributes to every client over WebSocket, accept `setAttribute`/RPC-method calls back, bind into client constraints via `LzEventable` proxies, and typecheck end-to-end in `lzx-check`.

**Architecture:** One document, two extractions. `domsource.ts` strips `<server>` from the client compile (before stamping — the existing bootstrap `cleanup()` then removes the live section for free); `app-model.ts` extracts the server model for BOTH the checker and the bus server (`server/bus.mjs` imports `compiler/dist`). The bus reuses `connection.mjs`'s frame codec behind a new shared upgrade dispatcher. Client proxies are `LzEventable` instances built by a prelude prepended to the app JS blob (the `lz-adopt-patch` mechanism) — the LFC's `applyConstraintExpr` gate is `instanceof LzEventable` and silently nulls anything else, and `LzDelegate.register` auto-creates events, so this exact shape is mandatory and sufficient.

**Tech Stack:** existing dep-free WS codec (`server/connection.mjs`), `compiler/dist` (htmlsource, app-model, ts-carrier), `node --test`, Playwright for E2E. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-06-realtime-bus-design.md` — read it first. Branch: `dom-authoring-slice3` (already created).

## Global Constraints

- **Zero new dependencies**; nothing here is bundled into `lzc-browser.js` except the existing exports it already carries (`lz-bus.js` is a plain startup module like `laszlo-dom.js`).
- **Proxies MUST be `instanceof LzEventable`** — the LFC silently NULLS failing constraint dependencies (LzNode.lzs:1673, empty catch). The constraint-refire canary test is mandatory.
- **Server-authoritative:** client proxy `setAttribute` sends, never applies locally; only deltas/snapshots mutate proxies (via the ORIGINAL `LzEventable.prototype.setAttribute`).
- **Declared surface only:** RPC `set` for declared `<attribute>`s, `call` for declared `<method>`s.
- **`server` is a reserved identifier** (id/canvas-level name/attribute) — checker findings.
- **Snapshot strictly precedes any delta on a socket** (join broadcast set after snapshot write).
- Server bodies check in a **second `ts.createProgram`** (no `lfc.d.ts`; Node globals never leak into client checking).
- `.lzx`-text path, byte parity, Slices 1–2 untouched; static hosting degrades gracefully (console warning, defaults hold).
- `cd compiler && npm test` green after every task; commit after every task.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `server/connection.mjs` | modify | export codec (`encodeText`/`decodeFrames`/`acceptKey`), extract `connectionUpgradeHandler`, add `attachUpgradeDispatcher` |
| `server/index.mjs` | modify | wire the dispatcher with `/api/connection` + `/api/bus` routes |
| `server/srvnode.mjs` | create | pure server-tag runtime: attrs/coercion, handler dispatch, delta hook, JSON guard, Promise-aware `callMethod` |
| `server/bus.mjs` | create | `/api/bus` upgrade handler; per-app `BusApp` (parse+extract+transpile via `compiler/dist`, sockets, protocol) |
| `compiler/src/domsource.ts` | modify | `<server>` dialect rule: strip before stamping/children; root-child-only; at most one |
| `compiler/src/app-model.ts` | modify | server-tag model extraction (`serverTags`), reserved-`server` findings, skip in client walk |
| `compiler/src/app-dts.ts` | modify | `generateServerDts` (client const + server classes), `generateServerBodies`, `SRVNODE_DTS`/`NODE_GLOBALS_DTS` |
| `compiler/src/lzx-check.ts` | modify | second server-body program; reserved-name + server findings; `serverBodiesChecked` |
| `startup/lz-bus.js` | create | `extractServerDecls`, `busPrelude` (proxy prelude string), `connectBus` (WS, reconnect, RPC promises) |
| `startup/laszlo-dom.js` | modify | detect `<server>`: extract decls before cleanup, prepend prelude, lazy-import lz-bus, `connectBus` after embed |
| `compiler/test/bus-model.test.mjs` | create | domsource strip + app-model server extraction tests |
| `compiler/test/srvnode.test.mjs` | create | SrvNode unit tests (imports `../../server/srvnode.mjs`) |
| `compiler/test/bus-integration.test.mjs` | create | real HTTP server + WS test client: full protocol |
| `compiler/test/bus-check.test.mjs` | create | checker: server typing, program isolation, reserved names |
| `compiler/test/fixtures/bus-app.html` | create | integration fixture app |
| `compiler/test/fixtures/bus-check-errors.html` | create | checker error fixture |
| `examples/dom-authoring/bus-demo.html` | create | shared counter + RPC chat demo |
| `examples/dom-authoring/README.md` | modify | bus section |

---

### Task 1: Upgrade dispatcher + codec exports

**Files:**
- Modify: `server/connection.mjs` (:18-52 codec, :97-123 attach)
- Modify: `server/index.mjs:20,:194`
- Test: `compiler/test/bus-integration.test.mjs` (started here with dispatcher-only tests; grows in Task 3)

**Interfaces:**
- Produces (used by Tasks 3, tests):
  - `export { encodeText, decodeFrames, acceptKey }` (existing module-scope functions, now exported)
  - `export function wsAccept(req, socket): boolean` — writes the 101 handshake (returns false + destroys when no key)
  - `export function connectionUpgradeHandler(req, socket): void` — the existing chat behavior, minus the path guard
  - `export function attachUpgradeDispatcher(httpServer, routes: Record<string, (req, socket) => void>): void` — ONE `upgrade` listener; FIRST match over the routes' insertion order (exact path or `prefix + "/"`); unclaimed paths destroyed exactly once

- [ ] **Step 1: Write the failing test**

Create `compiler/test/bus-integration.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { attachUpgradeDispatcher, encodeText, decodeFrames, acceptKey } from "../../server/connection.mjs";

// Minimal dep-free WS TEST client. Client->server frames MUST be masked (RFC 6455).
export function encodeTextMasked(str) {
  const data = Buffer.from(str, "utf8");
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  let header;
  const len = data.length;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  return Buffer.concat([header, mask, masked]);
}

/** Open a raw WS to `path` on `port`; returns {send(obj), next():Promise<obj>, close()}. */
export function wsClient(port, path) {
  const sock = net.connect(port, "127.0.0.1");
  const queue = [];
  const waiters = [];
  let buf = Buffer.alloc(0);
  let up = false;
  const ready = new Promise((res, rej) => {
    sock.on("connect", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!up) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        if (!buf.slice(0, idx).toString().includes("101")) return rej(new Error("no 101: " + buf.slice(0, 40)));
        buf = buf.slice(idx + 4);
        up = true;
        res();
      }
      const { messages, rest } = decodeFrames(buf);
      buf = rest;
      for (const m of messages) if (m.text != null) {
        const obj = JSON.parse(m.text);
        const w = waiters.shift();
        if (w) w(obj); else queue.push(obj);
      }
    });
    sock.on("error", rej);
    // A destroyed unclaimed socket produces a clean FIN with NO 'error' event —
    // without this, an await on `ready` for a refused path hangs the suite.
    sock.on("close", () => { if (!up) rej(new Error("connection refused before 101")); });
  });
  return {
    ready,
    send: (obj) => sock.write(encodeTextMasked(JSON.stringify(obj))),
    next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)),
    close: () => sock.destroy(),
    destroyed: () => sock.destroyed,
  };
}

test("dispatcher: routes by prefix, destroys unclaimed exactly once", async () => {
  const hits = [];
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, {
    "/api/echo": (req, socket) => {
      hits.push(req.url);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        acceptKey(req.headers["sec-websocket-key"]) + "\r\n\r\n");
      socket.on("data", (chunk) => {
        const { messages } = decodeFrames(chunk);
        for (const m of messages) if (m.text != null) socket.write(encodeText(m.text));
      });
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const c = wsClient(port, "/api/echo?x=1");
  await c.ready;
  c.send({ hi: 1 });
  assert.deepEqual(await c.next(), { hi: 1 });
  assert.deepEqual(hits, ["/api/echo?x=1"]);
  c.close();

  // unclaimed path: connection must be refused (no 101)
  const bad = wsClient(port, "/api/nope");
  await assert.rejects(bad.ready);
  server.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test`
Expected: FAIL — `attachUpgradeDispatcher` is not exported.

- [ ] **Step 3: Refactor connection.mjs**

(a) Export the codec — change the three declarations (`:18`, `:21`, `:31`):

```js
export const acceptKey = k => crypto.createHash("sha1").update(k + WS_GUID).digest("base64");
export function encodeText(str) { /* body unchanged */ }
export function decodeFrames(buf) { /* body unchanged */ }
```

(b) Add above `attachConnectionServer`:

```js
/** Write the 101 handshake. Returns false (socket destroyed) when the key is missing. */
export function wsAccept(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return false; }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n");
  return true;
}

/** ONE upgrade listener for the whole server; handlers registered by path
 *  prefix. Node runs EVERY `upgrade` listener, so multiple listeners each
 *  guarding their own path would destroy each other's sockets — this
 *  dispatcher destroys unclaimed paths exactly once. */
export function attachUpgradeDispatcher(httpServer, routes) {
  httpServer.on("upgrade", (req, socket) => {
    const path = (req.url || "").split("?")[0];
    for (const [prefix, handler] of Object.entries(routes)) {
      if (path === prefix || path.startsWith(prefix + "/")) { handler(req, socket); return; }
    }
    socket.destroy();
  });
}

/** The chat connection behavior (was the body of the old upgrade listener). */
export function connectionUpgradeHandler(req, socket) {
  if (!wsAccept(req, socket)) return;
  const u = new URL(req.url, "http://localhost");
  const agent = new Agent(socket, u.searchParams.get("app") || "chat");
  let buf = Buffer.alloc(0);
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, closed, rest } = decodeFrames(buf); buf = rest;
    for (const m of messages) {
      if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; } // pong
      try { handleMessage(agent, JSON.parse(m.text)); } catch {}
    }
    if (closed) { leave(agent); socket.end(); }
  });
  socket.on("close", () => leave(agent));
  socket.on("error", () => leave(agent));
}
```

(c) Reduce `attachConnectionServer` to back-compat sugar (and keep its log line):

```js
export function attachConnectionServer(httpServer, pathPrefix = "/api/connection") {
  attachUpgradeDispatcher(httpServer, { [pathPrefix]: connectionUpgradeHandler });
  console.log(`  connection (WebSocket) server on ${pathPrefix}`);
}
```

(d) In `server/index.mjs`, replace line 194 (`attachConnectionServer(server);`) with:

```js
attachUpgradeDispatcher(server, {
  "/api/connection": connectionUpgradeHandler,
  // "/api/bus": busUpgradeHandler,        // UNCOMMENT in Task 3 (import arrives there too)
});
console.log("  connection (WebSocket) server on /api/connection");
```

and the import (line 20): `import { attachUpgradeDispatcher, connectionUpgradeHandler } from "./connection.mjs";` (add `import { busUpgradeHandler } from "./bus.mjs";` in Task 3; leave the route commented until then so the server still boots).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS (66 tests). Also boot-check the server (macOS has no `timeout`): `cd .. && (node server/index.mjs 8099 > /tmp/boot.log 2>&1 & BOOT=$!; sleep 2; kill $BOOT; head -5 /tmp/boot.log)` — expect the startup lines, no crash.

- [ ] **Step 5: Commit**

```bash
git add server/connection.mjs server/index.mjs compiler/test/bus-integration.test.mjs
git commit -m "server: shared upgrade dispatcher + WS codec exports (bus groundwork)"
```

---

### Task 2: `<server>` dialect rule + server model extraction

**Files:**
- Modify: `compiler/src/domsource.ts`
- Modify: `compiler/src/app-model.ts`
- Test: `compiler/test/bus-model.test.mjs`

**Interfaces:**
- Consumes: Slice-2 shapes (`HtmlElem`, `extractApp`, `AppModel`, `declAttr`, `checkName`, `collectBody`-style raw text access).
- Produces (used by Tasks 3, 5):

```ts
// app-model.ts additions
export interface ServerBody { name: string; args: string[]; code: string; srcLine: number } // RAW TS (untranspiled)
export interface ServerTagModel {
  name: string;             // bus identity (the name= attribute)
  tsName: string;           // "LzSrv_" + name
  attrs: AppAttr[];         // via declAttr (tsType + declKind)
  methods: ServerBody[];
  handlers: ServerBody[];   // includes oninit and on<attr> handlers
}
// AppModel gains: serverTags: ServerTagModel[]
```

- `domToXmlElem`: `<server>` as a direct child of the root is SKIPPED (before stamping, before the child walk); `<server>` anywhere else or a second one → `DomDialectError`.
- `extractApp`: populates `serverTags` (bodies RAW — the injected `transpileTs` is NOT applied to server bodies); the client instance walk skips the subtree; reserved-`server` findings: `id="server"`, root-level `name="server"`, any `<attribute name="server">` → `staticIssues`; a server tag without a valid-identifier `name` → `nameIssues` (tag skipped); duplicate server tag names → `staticIssues`.

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/bus-model.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";

const parse = (html) => findLaszloApp(parseHtmlDialect(html));
const APP = `<laszlo-app>
<view width="\${server.clock.seconds}"></view>
<server>
  <clock name="clock">
    <attribute name="seconds" type="number" value="0"></attribute>
    <handler name="oninit"><script type="text/typescript">setInterval(() => this.setAttribute('seconds', this.seconds + 1), 1000);</script></handler>
    <method name="reset" args="to"><script type="text/typescript">this.setAttribute('seconds', to);</script></method>
  </clock>
</server>
</laszlo-app>`;

test("domsource: <server> stripped from the client compile, never stamped", () => {
  const xml = domToXmlElem(parse(APP), { domAdopt: true, transpileTs: (s) => s });
  // NOTE: the client view's constraint STRING contains "server.clock", so assert
  // on markers that exist ONLY inside the <server> subtree:
  assert.ok(!JSON.stringify(xml).includes("setInterval"), "server body leaked into client compile");
  assert.ok(xml.children.every((c) => c.type !== "elem" || c.name !== "server"), "server section element leaked");
  // and nothing inside <server> got a live data-lz-adopt stamp
  const root = parse(APP);
  domToXmlElem(root, { domAdopt: true, transpileTs: (s) => s });
  const srv = [...root.childNodes].find((c) => c.nodeType === 1 && c.tagName === "SERVER");
  assert.ok(!JSON.stringify(srv).includes("data-lz-adopt"));
});

test("domsource: non-root or duplicate <server> is a dialect error", () => {
  assert.throws(() => domToXmlElem(parse("<laszlo-app><view><server></server></view></laszlo-app>"), { transpileTs: (s) => s }), DomDialectError);
  assert.throws(() => domToXmlElem(parse("<laszlo-app><server></server><server></server></laszlo-app>"), { transpileTs: (s) => s }), DomDialectError);
});

test("app-model: serverTags extracted with RAW bodies; client walk skips subtree", () => {
  const m = extractApp(parse(APP));
  assert.equal(m.serverTags.length, 1);
  const t = m.serverTags[0];
  assert.equal(t.name, "clock");
  assert.equal(t.tsName, "LzSrv_clock");
  assert.deepEqual(t.attrs, [{ name: "seconds", tsType: "number", declKind: "number" }]);
  assert.equal(t.methods.length, 1);
  assert.deepEqual(t.methods[0].args, ["to"]);
  assert.ok(t.methods[0].code.includes("this.setAttribute('seconds', to)"));
  assert.ok(t.handlers[0].code.includes("setInterval"), "raw TS preserved (arrow NOT transpiled)");
  assert.ok(t.handlers[0].code.includes("=>"), "server bodies must stay untranspiled in the model");
  // the client instance walk never saw <clock>: canvas root + one client view
  assert.equal(m.instances.length, 2);
});

test("app-model: reserved identifier `server` + server-tag name rules", () => {
  const m = extractApp(parse('<laszlo-app><view id="server"></view><view name="server"></view>' +
    '<server><a name="dup"></a><b name="dup"></b><c name="my-tag"></c></server></laszlo-app>'));
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes('id "server" is reserved'));
  assert.ok(msgs.includes('name "server" is reserved'));
  assert.ok(msgs.includes('duplicate server tag name "dup"'));
  assert.ok(m.nameIssues.some((i) => i.message.includes("my-tag")));
  // rule pinned: first "dup" kept; second "dup" skipped (staticIssue);
  // invalid "my-tag" skipped (nameIssue) -> exactly ONE tag survives
  assert.equal(m.serverTags.length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (`serverTags` undefined, no dialect error).

- [ ] **Step 3: Implement — domsource.ts**

In `walkElem`'s child loop (where `walkClass`/`scriptNodes` dispatch happens), add BEFORE other element handling:

```ts
    if (localName(ce) === "server") {
      if (!isRoot) throw new DomDialectError("<server> must be a direct child of <laszlo-app>");
      if (sawServer) throw new DomDialectError("at most one <server> section per app");
      sawServer = true;
      continue; // stripped from the client compile; never stamped (the
                // bootstrap's existing cleanup() removes the live section)
    }
```

with `let sawServer = false;` declared in `walkElem` before the loop (it only matters at the root; a nested `<server>` throws regardless via the `!isRoot` check — note `isRoot` is walkElem's own parameter, so pass a flag: the child loop runs inside the ROOT's walkElem invocation when `isRoot` is true; use that).

Concretely: `walkElem(el, ctx, isRoot)` — inside ITS child loop, `isRoot` refers to `el`. A `<server>` child of the root sees `isRoot === true`. A `<server>` deeper down is a child of a non-root element (`isRoot === false`) → error.

- [ ] **Step 4: Implement — app-model.ts**

(a) Add the interfaces (per the Interfaces block) and `serverTags: []` to the model init.
(b) The explicit `t === "server"` case below is AUTHORITATIVE (it must run walkServer); do NOT rely on `NON_INSTANCE` (which would silently swallow the section). Adding "server" to NON_INSTANCE is unnecessary.
(c) In `walkInstance`'s child loop, BEFORE the `NON_INSTANCE` fall-through:

```ts
      if (t === "server") {
        if (parent === null) walkServer(c);   // root child only; elsewhere client-invalid but harmless: skip
        continue;
      }
```

(d) Reserved-name findings — these must be STRUCTURAL guards (the reserved
name is never registered — a `declare const server: LzInst_N;` would collide
with the bus `server` const in `__lzapp.d.ts`). Extend the existing chains:

```ts
    if (id === "server") {
      model.staticIssues.push({ message: `id "server" is reserved (the bus proxy root)`, line: el.line });
      // NOT registered: no seenIds.add, no inst.id
    } else if (id && seenIds.has(id)) {
      /* existing duplicate branch unchanged */
    } else if (id) { /* existing registration branch unchanged */ }
```

and for names:

```ts
    if (nm === "server" && parent && parent.baseTsName === "LzCanvas") {
      model.staticIssues.push({ message: `name "server" is reserved at canvas level (binds globally)`, line: el.line });
      // NOT pushed into parent.namedChildren
    } else if (nm && parent) { /* existing duplicate-sibling + registration chain unchanged */ }
```

and in the `<attribute>` first pass: `if (an === "server") { model.staticIssues.push({ message: \`attribute name "server" is reserved\`, line: c.line }); continue; }` (before the `checkName` push).

(e) The server walk (module-level within `extractApp`'s closure):

```ts
  function walkServer(serverEl: HtmlElem): void {
    const seen = new Set<string>();
    for (const tagEl of elemChildren(serverEl)) {
      const name = tagEl.getAttribute("name") ?? "";
      if (!checkName("server tag name", name, tagEl.line)) continue;
      if (seen.has(name)) {
        model.staticIssues.push({ message: `duplicate server tag name "${name}"`, line: tagEl.line });
        continue;
      }
      seen.add(name);
      const tag: ServerTagModel = { name, tsName: "LzSrv_" + name, attrs: [], methods: [], handlers: [] };
      // RAW body collection — server bodies are transpiled by the BUS (and
      // checked by the SERVER program), never by the client pipeline.
      const rawBody = (el: HtmlElem): { code: string; line: number } => {
        const carrier = elemChildren(el).find((c) => c.tagName === "SCRIPT");
        return textOf(carrier ?? el);
      };
      for (const c of elemChildren(tagEl)) {
        const t = c.tagName.toLowerCase();
        const cn = c.getAttribute("name") ?? "";
        const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
        if (t === "attribute") {
          if (checkName("attribute", cn, c.line)) tag.attrs.push(declAttr(cn, c.getAttribute("type")));
        } else if (t === "method") {
          const { code, line } = rawBody(c);
          if (checkName("method", cn, c.line)) tag.methods.push({ name: cn, args, code, srcLine: line });
        } else if (t === "handler") {
          const { code, line } = rawBody(c);
          tag.handlers.push({ name: cn, args, code, srcLine: line });
        }
      }
      model.serverTags.push(tag);
    }
  }
```

(`declAttr` and `textOf` already exist from Slice 2. NOTE: `rawBody` ignores carrier `type=` — server bodies are TS by definition; a `text/lzs` carrier in `<server>` is out of scope and simply treated as TS, which the server-body check will flag if invalid.)

- [ ] **Step 5: Run tests + REBUILD THE BROWSER BUNDLE**

Run: `cd compiler && npm test && npm run bundle:browser`
Expected: PASS (all suites; Slice-2 tests unaffected because apps without `<server>` produce `serverTags: []`). The bundle rebuild is **mandatory**: `startup/laszlo-dom.js` imports `domToXmlElem` from the COMMITTED `compiler/lzc-browser.js` — without the rebuild, the Task-6 demo runs the OLD bundle, `<server>` leaks into the in-browser compile as an unknown tag, and the app never renders.

- [ ] **Step 6: Commit**

```bash
git add compiler/src/domsource.ts compiler/src/app-model.ts compiler/test/bus-model.test.mjs compiler/lzc-browser.js
git commit -m "compiler: <server> dialect rule (strip-before-stamp) + server-tag model extraction"
```

---

### Task 3: `SrvNode` + `bus.mjs` + protocol (integration-tested)

**Files:**
- Create: `server/srvnode.mjs`
- Create: `server/bus.mjs`
- Modify: `server/index.mjs` (uncomment the `/api/bus` route, add the import)
- Test: `compiler/test/srvnode.test.mjs`, `compiler/test/bus-integration.test.mjs` (append), `compiler/test/fixtures/bus-app.html`

**Interfaces:**
- Consumes: `attachUpgradeDispatcher`/`wsAccept`/codec (Task 1); `extractApp`+`parseHtmlDialect`+`findLaszloApp`+`transpileTsBody` from `compiler/dist` (Slice 2 / Task 2).
- Produces:
  - `class SrvNode { constructor(tagModel, { defaults, onDelta }) }` — `defaults` maps attr name to the authored value= string — `tagModel` is a `ServerTagModel` whose bodies are ALREADY-TRANSPILED JS; members: `name`, `setAttribute(attr, value)`, `callMethod(method, args): any|Promise`, `snapshot(): Record<string, any>`, `hasAttr(a)`, `hasMethod(m)`, `init()` (fires oninit).
  - `export function busUpgradeHandler(req, socket): void` (bus.mjs) and `export function getBusApp(appRelPath): BusApp` (synchronous; exposed for tests); `BusApp = { nodes: Map<string, SrvNode>, sockets: Set, broadcast, handle, snapshotMsg }`.

**Protocol recap (spec):** S→C `snapshot`/`delta`/`result`/`error`; C→S `set`/`call`. Snapshot before join. Declared surface only. Promise-returning methods settle `result` with the resolved value.

- [ ] **Step 1: Write the failing SrvNode unit tests**

Create `compiler/test/srvnode.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SrvNode } from "../../server/srvnode.mjs";

const CLOCK = {
  name: "clock",
  attrs: [{ name: "seconds", tsType: "number", declKind: "number" }],
  // bodies here are TRANSPILED JS (the bus transpiles; unit tests hand JS in)
  methods: [
    { name: "reset", args: ["to"], code: "this.setAttribute('seconds', to); return 'ok';" },
    { name: "later", args: [], code: "return Promise.resolve(42);" },
  ],
  handlers: [
    { name: "oninit", args: [], code: "this.inited = true;" },
    { name: "onseconds", args: ["v"], code: "this.last = v;" },
  ],
};
// defaults come from the DECLARED value attr — model attrs don't carry value;
// SrvNode takes a defaults map:
const make = (deltas) => new SrvNode(CLOCK, { defaults: { seconds: "0" }, onDelta: (t, a, v) => deltas.push([t, a, v]) });

test("defaults coerced by declKind; oninit fires on init()", () => {
  const d = [];
  const n = make(d);
  assert.equal(n.seconds, 0);           // "0" -> number 0
  assert.equal(n.inited, undefined);
  n.init();
  assert.equal(n.inited, true);
  assert.deepEqual(d, []);              // init does not broadcast
});

test("setAttribute: applies, fires on<attr> handler BEFORE delta hook", () => {
  const d = [];
  const n = make(d);
  n.setAttribute("seconds", 5);
  assert.equal(n.seconds, 5);
  assert.equal(n.last, 5);              // handler saw it
  assert.deepEqual(d, [["clock", "seconds", 5]]);
});

test("JSON guard: non-serializable value throws at the call site", () => {
  const n = make([]);
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => n.setAttribute("seconds", cyc), /JSON/);
});

test("callMethod: sync result, Promise result, unknown method", () => {
  const n = make([]);
  assert.equal(n.callMethod("reset", [9]), "ok");
  assert.equal(n.seconds, 9);
  return n.callMethod("later", []).then((v) => assert.equal(v, 42))
    .then(() => { assert.ok(!n.hasMethod("nope")); });
});

test("snapshot reflects current attrs only (declared)", () => {
  const n = make([]);
  n.setAttribute("seconds", 3);
  assert.deepEqual(n.snapshot(), { seconds: 3 });
});
```

- [ ] **Step 2: Run to verify failure, then implement `server/srvnode.mjs`**

```js
// srvnode.mjs — the server-tag runtime (spec "Server runtime"). PURE: no
// fs/net; bodies arrive ALREADY-TRANSPILED (the bus runs transpileTsBody).
// setAttribute: JSON-guard -> apply -> on<attr> handler -> onDelta hook.

const coerce = (kind, v) => {
  if (v == null) return v;
  if (kind === "number" || kind === "numberExpression" || kind === "size" || kind === "sizeExpression") return Number(v);
  if (kind === "boolean" || kind === "inheritableBoolean") return v === true || v === "true";
  return v;
};

export class SrvNode {
  constructor(tagModel, { defaults = {}, onDelta = () => {} } = {}) {
    this.name = tagModel.name;
    this.__attrs = new Set(tagModel.attrs.map((a) => a.name));
    this.__methods = new Map();
    this.__handlers = new Map();
    this.__onDelta = onDelta;
    for (const a of tagModel.attrs) this[a.name] = coerce(a.declKind, defaults[a.name]);
    for (const m of tagModel.methods) this.__methods.set(m.name, new Function(...m.args, m.code));
    for (const h of tagModel.handlers) this.__handlers.set(h.name, new Function(...h.args, h.code));
  }
  hasAttr(a) { return this.__attrs.has(a); }
  hasMethod(m) { return this.__methods.has(m); }
  init() { const h = this.__handlers.get("oninit"); if (h) h.call(this); }
  setAttribute(attr, value) {
    JSON.stringify(value); // throws on cycles/BigInt — a server-code bug, surfaced at the call site
    this[attr] = value;
    const h = this.__handlers.get("on" + attr);
    if (h) h.call(this, value);
    this.__onDelta(this.name, attr, value);
  }
  callMethod(method, args) {
    return this.__methods.get(method).apply(this, args);
  }
  snapshot() {
    const out = {};
    for (const a of this.__attrs) out[a] = this[a];
    return out;
  }
}
```

Run: `cd compiler && npm test` — SrvNode suite PASS.

- [ ] **Step 3: Write the fixture + failing bus integration tests**

Create `compiler/test/fixtures/bus-app.html`:

```html
<laszlo-app width="100" height="100">
  <view width="${server.state.count}"></view>
  <server>
    <state name="state">
      <attribute name="count" type="number" value="0"></attribute>
      <attribute name="log" type="string" value=""></attribute>
      <method name="bump" args="by"><script type="text/typescript">
        this.setAttribute('count', this.count + by);
        return this.count;
      </script></method>
      <method name="boom"><script type="text/typescript">
        throw new Error('kaboom');
      </script></method>
      <method name="slow"><script type="text/typescript">
        return new Promise((res) => setTimeout(() => res('done'), 10));
      </script></method>
    </state>
  </server>
</laszlo-app>
```

Append to `compiler/test/bus-integration.test.mjs`:

```js
import { busUpgradeHandler } from "../../server/bus.mjs";

async function busServer() {
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, { "/api/bus": busUpgradeHandler });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}
const FIXTURE = "compiler/test/fixtures/bus-app.html"; // distro-relative

test("bus: snapshot on connect; set round-trips; delta reaches BOTH clients", async () => {
  const { server, port } = await busServer();
  const a = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await a.ready;
  const snapA = await a.next();
  assert.equal(snapA.op, "snapshot");
  assert.deepEqual(snapA.tags.state, { count: 0, log: "" });

  const b = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await b.ready;
  assert.equal((await b.next()).op, "snapshot");

  a.send({ op: "set", tag: "state", attr: "count", value: 7 });
  const [da, db] = [await a.next(), await b.next()];
  assert.deepEqual(da, { op: "delta", tag: "state", attr: "count", value: 7 }); // sender gets the echo too
  assert.deepEqual(db, da);
  a.close(); b.close(); server.close();
});

test("bus: call (sync, promise, throwing) + declared-surface enforcement", async () => {
  const { server, port } = await busServer();
  const c = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await c.ready; await c.next(); // snapshot (count now 7 — singleton persists across tests in-process? NO: new server, but getBusApp caches per PATH within the process)
  c.send({ op: "call", tag: "state", method: "bump", args: [5], uid: 1 });
  // bump broadcasts a delta AND returns a result — order: delta then result
  const m1 = await c.next(); const m2 = await c.next();
  const result = [m1, m2].find((m) => m.op === "result");
  const delta = [m1, m2].find((m) => m.op === "delta");
  assert.ok(result && delta);
  assert.equal(result.uid, 1);
  assert.equal(result.value, delta.value);

  c.send({ op: "call", tag: "state", method: "slow", args: [], uid: 2 });
  assert.deepEqual(await c.next(), { op: "result", uid: 2, value: "done" }); // Promise settled

  c.send({ op: "call", tag: "state", method: "boom", args: [], uid: 3 });
  const err = await c.next();
  assert.equal(err.op, "error"); assert.equal(err.uid, 3); assert.match(err.message, /kaboom/);

  c.send({ op: "set", tag: "state", attr: "nope", value: 1 });
  assert.equal((await c.next()).op, "error"); // undeclared attr

  c.send({ op: "call", tag: "state", method: "nope", args: [], uid: 4 });
  assert.equal((await c.next()).op, "error"); // undeclared method
  c.close(); server.close();
});

test("bus: reconnect gets a fresh snapshot with persisted state", async () => {
  const { server, port } = await busServer();
  const a = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await a.ready;
  const before = (await a.next()).tags.state.count;
  a.send({ op: "set", tag: "state", attr: "count", value: before + 1 });
  await a.next(); // delta
  a.close();
  const b = wsClient(port, `/api/bus?app=${FIXTURE}`); // "reconnect"
  await b.ready;
  const snap = await b.next();
  assert.equal(snap.op, "snapshot");
  assert.equal(snap.tags.state.count, before + 1); // persisted, not defaults
  b.close(); server.close();
});

test("bus: unknown app path refused; traversal refused", async () => {
  const { server, port } = await busServer();
  for (const bad of ["nope/missing.html", "../etc/passwd"]) {
    const c = wsClient(port, `/api/bus?app=${bad}`);
    await c.ready; // handshake still completes; refusal is an error frame + close
    const e = await c.next();
    assert.equal(e.op, "error");
  }
  server.close();
});
```

NOTE the caching caveat in the first call-test comment: `getBusApp` caches per path for the PROCESS lifetime (shared singletons), so `count` carries across tests in this file. The assertions above are written order-independent of the starting count (they compare result==delta value, not absolutes) — keep them that way.

- [ ] **Step 4: Implement `server/bus.mjs`**

```js
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
const apps = new Map(); // appRelPath -> BusApp (process-lifetime singletons)

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
    // Re-read declared defaults from the live section (app-model attrs carry
    // types, not values): walk the raw DOM for value= per attribute.
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

/** Per-path singleton (shared state, server-lifetime). Exposed for tests. */
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
```

Wire `server/index.mjs`: add `import { busUpgradeHandler } from "./bus.mjs";` and uncomment the `/api/bus` route from Task 1(d).

- [ ] **Step 5: Run tests**

Run: `cd compiler && npm test` — Expected: all PASS (the delta-vs-result ordering in the call test is asserted order-independently). Boot check (portable): `cd .. && (node server/index.mjs 8099 > /tmp/boot.log 2>&1 & BOOT=$!; sleep 2; kill $BOOT; head -5 /tmp/boot.log)`.

- [ ] **Step 6: Commit**

```bash
git add server/srvnode.mjs server/bus.mjs server/index.mjs compiler/test/srvnode.test.mjs compiler/test/bus-integration.test.mjs compiler/test/fixtures/bus-app.html
git commit -m "server: SrvNode runtime + /api/bus WebSocket bus (snapshot/delta/set/call, integration-tested)"
```

---

### Task 4: `lz-bus.js` client + bootstrap hook

**Files:**
- Create: `startup/lz-bus.js`
- Modify: `startup/laszlo-dom.js`

**Interfaces:**
- Consumes: the live `<server>` element (bootstrap DOM), the blob-prelude mechanism (`laszlo-dom.js:102-105`), `window.LzEventable` (LFC global).
- Produces:
  - `export function extractServerDecls(serverEl): Decl[]` where `Decl = { tag: string, attrs: { name, value, type }[], methods: { name }[] }`
  - `export function busPrelude(decls): string` — classic-JS prelude creating `window.server` proxies (`LzEventable` instances), `window.__lzBusProxies`, `__lzBusQueue`, `__lzBusCalls`, `__lzBusSend`
  - `export function connectBus(appPath): void` — polls for `__lzBusProxies`, opens the WS, flushes the queue, applies snapshot/deltas via `LzEventable.prototype.setAttribute`, settles call promises, reconnects with backoff

- [ ] **Step 1: Write `startup/lz-bus.js`**

```js
// lz-bus.js — client side of the realtime bus (spec: docs/superpowers/specs/
// 2026-07-06-realtime-bus-design.md, "Client runtime").
//
// Split: busPrelude() returns a CLASSIC-JS string prepended to the app blob
// (runs after the LFC, before app code) that creates the proxies; connectBus()
// runs as a module on the page and bridges them to the WebSocket. Proxies are
// permanent singletons mutated in place — constraints captured them by
// reference at bind time.

/** Read declarations from the LIVE <server> element (before cleanup removes it). */
export function extractServerDecls(serverEl) {
  const decls = [];
  for (const tagEl of [...serverEl.children]) {
    const tag = tagEl.getAttribute("name");
    if (!tag) continue;
    const attrs = [], methods = [];
    for (const c of [...tagEl.children]) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") attrs.push({ name: c.getAttribute("name"), value: c.getAttribute("value"), type: c.getAttribute("type") || "" });
      else if (t === "method") methods.push({ name: c.getAttribute("name") });
    }
    decls.push({ tag, attrs, methods });
  }
  return decls;
}

const coerceJs = `function __lzCoerce(t, v) {
  if (v == null) return v;
  if (t === "number" || t === "size") return Number(v);
  if (t === "boolean") return v === "true" || v === true;
  return v;
}`;

/** The proxy prelude. MUST create instanceof-LzEventable objects — the LFC
 *  SILENTLY NULLS constraint dependencies that fail `dp instanceof LzEventable`
 *  (applyConstraintExpr, release build: empty catch). */
export function busPrelude(decls) {
  return `// lz-bus proxy prelude (generated)
(function () {
  var DECLS = ${JSON.stringify(decls)};
  var P = window.__lzBusProxies = {};
  var Q = window.__lzBusQueue = [];
  var C = window.__lzBusCalls = {};
  var uid = 0;
  ${coerceJs}
  window.__lzBusSend = function (m) { JSON.stringify(m); Q.push(m); }; // JSON guard at the call site
  window.server = {};
  DECLS.forEach(function (d) {
    var o = new LzEventable();
    d.attrs.forEach(function (a) { o[a.name] = __lzCoerce(a.type, a.value); });
    // Server-authoritative: SEND, never apply locally (deltas apply via the
    // ORIGINAL LzEventable.prototype.setAttribute in connectBus).
    o.setAttribute = function (n, v) { window.__lzBusSend({ op: "set", tag: d.tag, attr: n, value: v }); };
    d.methods.forEach(function (m) {
      o[m.name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var id = ++uid;
        var settle = {};
        var prom = new Promise(function (res, rej) { settle.res = res; settle.rej = rej; });
        C[id] = settle;
        window.__lzBusSend({ op: "call", tag: d.tag, method: m.name, args: args, uid: id });
        return prom;
      };
    });
    P[d.tag] = o;
    window.server[d.tag] = o;
  });
})();
`;
}

/** Bridge the proxies to the WebSocket. Reconnects with capped backoff; every
 *  (re)connect applies a fresh snapshot through the ORIGINAL setter so
 *  constraints converge. */
export function connectBus(appPath) {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/bus?app=" + encodeURIComponent(appPath.replace(/^\//, ""));
  let tries = 0;
  const waitForProxies = (fn, n = 0) => {
    if (window.__lzBusProxies) return fn();
    if (n > 200) return console.warn("lz-bus: proxies never appeared");
    setTimeout(() => waitForProxies(fn, n + 1), 50);
  };
  const apply = (tag, attr, value) => {
    const o = window.__lzBusProxies[tag];
    if (o) LzEventable.prototype.setAttribute.call(o, attr, value); // fires on<attr> -> constraints
  };
  const open = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      const q = window.__lzBusQueue.splice(0);
      window.__lzBusSend = (m) => { JSON.stringify(m); ws.send(JSON.stringify(m)); };
      q.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.op === "snapshot") for (const [tag, attrs] of Object.entries(m.tags)) for (const [a, v] of Object.entries(attrs)) apply(tag, a, v);
      else if (m.op === "delta") apply(m.tag, m.attr, m.value);
      else if (m.op === "result") { const c = window.__lzBusCalls[m.uid]; if (c) { delete window.__lzBusCalls[m.uid]; c.res(m.value); } }
      else if (m.op === "error") {
        if (m.uid != null) { const c = window.__lzBusCalls[m.uid]; if (c) { delete window.__lzBusCalls[m.uid]; c.rej(new Error(m.message)); } }
        else console.warn("lz-bus:", m.message);
      }
    };
    ws.onclose = () => {
      window.__lzBusSend = (m) => { JSON.stringify(m); window.__lzBusQueue.push(m); };
      const delay = Math.min(15000, 1000 * Math.pow(2, tries++));
      setTimeout(open, delay);
    };
    ws.onerror = () => { if (tries === 0) console.warn("lz-bus: WebSocket unavailable (static host?) — server state stays at defaults"); };
  };
  waitForProxies(open);
}
```

- [ ] **Step 2: Hook the bootstrap (`startup/laszlo-dom.js`)**

(a) After the file-dialect inlining and BEFORE `domToXmlElem` (which strips nothing live) / `cleanup()` (which removes the live section), detect + extract. (NOTE: the existing `querySelector("method,handler,setter,script")` lazy-load check also matches carriers inside `<server>`, so `lz-ts.js` may load for server-only code — harmless, do NOT "fix" it; `domToXmlElem` skips the subtree so nothing server-side is transpiled client-side.)

```js
  // Realtime bus: extract <server> declarations before cleanup() removes the
  // live section (spec: 2026-07-06-realtime-bus-design.md).
  let busDecls = null;
  const serverEl = [...host.children].find((c) => c.tagName === "SERVER");
  if (serverEl) {
    const busMod = await import(new URL("lz-bus.js", HERE).href);
    busDecls = { decls: busMod.extractServerDecls(serverEl), mod: busMod };
  }
```

(b) In the blob assembly (currently `new Blob([patch, "\n", r.js], …)`), prepend the prelude FIRST (proxies must exist before the adopt patch is irrelevant, but before app code is mandatory):

```js
  const prelude = busDecls ? busDecls.mod.busPrelude(busDecls.decls) : "";
  const appUrl = URL.createObjectURL(new Blob([prelude, patch, "\n", r.js], { type: "text/javascript" }));
```

(c) After `lz.embed.dhtml({...})` is called, start the bridge:

```js
  if (busDecls) busDecls.mod.connectBus(location.pathname);
```

- [ ] **Step 3: Syntax-check both files**

Run: `cd compiler && npx esbuild ../startup/lz-bus.js --bundle --outfile=/dev/null && npx esbuild ../startup/laszlo-dom.js --bundle --outfile=/dev/null && cd ..`
Expected: two bundle-size lines, no errors. Also `cd compiler && npm test` (nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add startup/lz-bus.js startup/laszlo-dom.js
git commit -m "startup: lz-bus client (LzEventable proxy prelude + WS bridge) wired into the bootstrap"
```

---

### Task 5: Checker integration (server typing, second program)

**Files:**
- Modify: `compiler/src/app-dts.ts`, `compiler/src/lzx-check.ts`
- Test: `compiler/test/bus-check.test.mjs`, `compiler/test/fixtures/bus-check-errors.html`

**Interfaces:**
- Consumes: `serverTags` (Task 2), Slice-2 emission machinery (`BodySpan`, span mapping).
- Produces (app-dts.ts):
  - `export const SRVNODE_DTS: string` — `declare class SrvNode { setAttribute<K extends keyof this & string>(name: K, value: this[K]): void; }` plus curated Node globals: `declare function setInterval(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any; declare function clearInterval(t: any): void; declare function setTimeout(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any; declare function clearTimeout(t: any): void; declare const console: any; declare function fetch(input: any, init?: any): Promise<any>;`
  - `export function generateServerDts(model): { clientDts: string; serverDts: string }` — client: `declare class LzSrv_<name>_client extends LzEventable { <attrs typed>; <method>(...args: any[]): Promise<any>; setAttribute<K…>(…): void; }` + `declare const server: { <name>: LzSrv_<name>_client; … };` — server: `declare class LzSrv_<name> extends SrvNode { <attrs typed>; }`
  - `export function generateServerBodies(model): { source: string; spans: BodySpan[] }` — one function per server method/handler: `function __lz_srv_<n>(this: LzSrv_<name>, <args typed via the same handler/setter resolution against the tag's declared attrs>): any { … }` (same line-anchor rule as `generateBodies`)
- lzx-check: `CheckResult` gains `serverBodiesChecked: number`; server bodies run in a SECOND `ts.createProgram` over `{ "srvnode.d.ts": SRVNODE_DTS, "__lzsrvapp.d.ts": serverDts, "__lzsrvbodies.ts": … }` (NO lfc.d.ts, NO client app dts); the CLIENT program's `__lzapp.d.ts` gains `clientDts` appended.

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/fixtures/bus-check-errors.html`:

```html
<laszlo-app width="100" height="100">
  <view id="server"></view>
  <view y="${server.state.count * 2}" x="${server.state.nope}">
    <handler name="onclick"><script type="text/typescript">
      server.state.setAttribute('count', 'oops');
      server.state.bump(1).then((v: number) => v);
      setInterval(() => {}, 100);
    </script></handler>
  </view>
  <server>
    <state name="state">
      <attribute name="count" type="number" value="0"></attribute>
      <method name="bump" args="by"><script type="text/typescript">
        this.setAttribute('count', this.count + by);
        this.setAttribute('cuont', 1);
      </script></method>
      <handler name="oncount" args="v"><script type="text/typescript">
        console.log(v * 2);
        canvas.width;
      </script></handler>
    </state>
  </server>
</laszlo-app>
```

Create `compiler/test/bus-check.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const read = (f) => readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8");

test("bus checker: client + server surfaces, program isolation", () => {
  const src = read("bus-check-errors.html");
  const r = checkApp(src, "bus-check-errors.html");
  const msgs = r.findings.map((f) => f.code + ":" + f.message).join("\n");
  // reserved identifier
  assert.ok(msgs.includes('id "server" is reserved'));
  // client: wrong-typed set on the typed proxy
  assert.ok(r.findings.some((f) => f.code === 2345 && f.message.includes("'number'")), msgs);
  // client: setInterval must NOT be legal in client bodies (program isolation)
  assert.ok(r.findings.some((f) => f.code === 2304 && f.message.includes("setInterval")), msgs);
  // client constraint: server.state.count typechecks (no finding), nope doesn't
  assert.ok(r.findings.some((f) => f.message.includes("'nope'") || f.message.includes("nope")), msgs);
  assert.ok(!msgs.includes("'count'"), "count must typecheck");
  // server body: misspelled setAttribute name is a finding
  assert.ok(r.findings.some((f) => f.message.includes("cuont")), msgs);
  // server body: setInterval/console legal (no findings mentioning them from srv bodies)
  // server body: canvas must NOT be visible (isolation, reverse direction)
  assert.ok(r.findings.some((f) => f.code === 2304 && f.message.includes("canvas")), msgs);
  assert.equal(r.serverBodiesChecked, 2);
});

test("bus checker: clean bus fixture has zero findings", () => {
  const r = checkApp(read("bus-app.html"), "bus-app.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
  assert.equal(r.serverBodiesChecked, 3); // bump, boom, slow; no handlers
});
```

- [ ] **Step 2: Run to verify failure, then implement**

app-dts.ts — add:

```ts
export const SRVNODE_DTS = `declare class LzEventableBase {}
declare class SrvNode {
  setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;
}
declare function setInterval(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearInterval(t: any): void;
declare function setTimeout(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearTimeout(t: any): void;
declare const console: any;
declare function fetch(input: any, init?: any): Promise<any>;
`;

export function generateServerDts(model: AppModel): { clientDts: string; serverDts: string } {
  const client: string[] = [];
  const server: string[] = [];
  for (const t of model.serverTags) {
    client.push(`declare class ${t.tsName}_client extends LzEventable {`);
    server.push(`declare class ${t.tsName} extends SrvNode {`);
    for (const a of t.attrs) { client.push(`  ${a.name}: ${a.tsType};`); server.push(`  ${a.name}: ${a.tsType};`); }
    for (const m of t.methods) client.push(`  ${m.name}(...args: any[]): Promise<any>;`);
    client.push(`  setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;`);
    client.push("}", "");
    server.push("}", "");
  }
  if (model.serverTags.length) {
    client.push("declare const server: {");
    for (const t of model.serverTags) client.push(`  ${t.name}: ${t.tsName}_client;`);
    client.push("};", "");
  }
  return { clientDts: client.join("\n"), serverDts: server.join("\n") };
}

export function generateServerBodies(model: AppModel): { source: string; spans: BodySpan[] } {
  const lines: string[] = ["// AUTO-GENERATED server-body harness (lzx-check). Do not edit.", ""];
  const spans: BodySpan[] = [];
  let idx = 0;
  for (const t of model.serverTags) {
    for (const b of [...t.methods, ...t.handlers]) {
      // handler payload typing: on<attr> -> that attr's tsType (declared on the tag)
      const attr = b.name.startsWith("on") ? b.name.slice(2) : "";
      const payload = t.attrs.find((a) => a.name === attr)?.tsType ?? "any";
      const params = ["this: " + t.tsName,
        ...b.args.map((a, i) => `${a}: ${b.name.startsWith("on") && i === 0 ? payload : "any"}`)];
      lines.push(`// <${b.name}> on server tag <${t.name}>`);
      const genStartLine = lines.length + 1;
      lines.push(`function __lz_srv_${++idx}(${params.join(", ")}): any {`);
      const spanSrcLine = b.code.startsWith("\n") ? b.srcLine : b.srcLine - 1;
      spans.push({ genStartLine, srcLine: spanSrcLine, label: `<${b.name}> on server tag <${t.name}>` });
      for (const l of b.code.replace(/^\n/, "").split("\n")) lines.push(l);
      lines.push("}", "");
    }
  }
  return { source: lines.join("\n"), spans };
}
```

lzx-check.ts — in `checkApp`: `generateServerDts(model)` is called BEFORE the virtual-map assembly (its `clientDts` is part of `__lzapp.d.ts`); the server program + findings run after the client program's findings:

```ts
  // Server bodies: a SECOND program — ambient globals are program-wide, so
  // Node globals must never share a program with client bodies (and the LFC's
  // canvas/lz globals must not leak into server bodies).
  const { clientDts, serverDts } = generateServerDts(model);
  // (clientDts was appended to __lzapp.d.ts above — see the appDts change)
  const { source: srvSrc, spans: srvSpans } = generateServerBodies(model);
  let serverBodiesChecked = 0;
  if (model.serverTags.length) {
    serverBodiesChecked = model.serverTags.reduce((n, t) => n + t.methods.length + t.handlers.length, 0);
    const srvVirtual = new Map<string, string>([
      ["srvnode.d.ts", SRVNODE_DTS],
      ["__lzsrvapp.d.ts", serverDts],
      ["__lzsrvbodies.ts", srvSrc],
    ]);
    // …same host-override pattern as the client program, new ts.createProgram,
    // same span-mapped findings loop over __lzsrvbodies.ts (element label from
    // the span; suppression rule NOT applied — server bodies are plain TS).
  }
```

and the client `__lzapp.d.ts` assembly becomes `generateAppDts(model) + "\n" + clientDts` (note `clientDts` references `LzEventable`, declared in lfc.d.ts — present in the client program ✓). Add `serverBodiesChecked` to `CheckResult` and the CLI report line. The server-program findings loop is a copy of the client bodies loop with the srv file/spans (extract a small `collectBodyFindings(prog, fileName, spans, findings)` helper to avoid duplicating it — refactor the existing loop into it first).

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS, including both isolation directions (client TS2304 on `setInterval`, server TS2304 on `canvas`).

- [ ] **Step 4: Commit**

```bash
git add compiler/src/app-dts.ts compiler/src/lzx-check.ts compiler/test/bus-check.test.mjs compiler/test/fixtures/bus-check-errors.html
git commit -m "lzx-check: server-tag typing (LzSrv_*, typed server const) + isolated second program"
```

---

### Task 6: Demo, E2E, docs

**Files:**
- Create: `examples/dom-authoring/bus-demo.html`
- Modify: `examples/dom-authoring/README.md`

- [ ] **Step 1: Write the demo**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>OpenLaszlo — realtime bus demo</title>
  <style>laszlo-app{visibility:hidden;display:block;position:relative}</style>
  <script type="module" src="../../startup/laszlo-dom.js"></script>
</head>
<body style="font:14px sans-serif;margin:16px">
  <h2>Realtime bus (Slice 3): open this page in TWO browsers</h2>
  <laszlo-app width="640" height="360" bgcolor="#eef2f7">
    <view name="counterbox" x="20" y="20" width="${100 + server.state.count * 12}" height="48" bgcolor="#4a6fb0">
      <handler name="onclick"><script type="text/typescript">
        server.state.setAttribute('count', server.state.count + 1);
      </script></handler>
    </view>
    <text x="20" y="80" text="${'count: ' + server.state.count}"></text>
    <text x="20" y="110" width="600" height="160" multiline="true" text="${server.state.log}"></text>
    <inputtext name="msg" x="20" y="290" width="400" height="24" bgcolor="#ffffff"></inputtext>
    <view x="430" y="288" width="60" height="26" bgcolor="#9bbb59">
      <handler name="onclick"><script type="text/typescript">
        const box = (this.parent as any).msg;
        server.state.say(box.getText());
        box.setAttribute('text', '');
      </script></handler>
    </view>
  </laszlo-app>
</body>
</html>
```

(`msg` and the send button are both canvas-level children, so the button
handler's `this.parent` is the canvas instance whose named child `msg` holds
the inputtext — hence `(this.parent as any).msg`; verify live in Step 3.)

Add the `<server>` section before `</laszlo-app>`:

```html
    <server>
      <state name="state">
        <attribute name="count" type="number" value="0"></attribute>
        <attribute name="log" type="string" value=""></attribute>
        <method name="say" args="text"><script type="text/typescript">
          if (typeof text === 'string' && text.trim())
            this.setAttribute('log', this.log + text.trim() + '\n');
        </script></method>
      </state>
    </server>
```

- [ ] **Step 2: Check it**

```bash
cd compiler && node dist/lzx-check.js ../examples/dom-authoring/bus-demo.html
```
Expected: `OK` (bodies + constraints + 1 server method checked). Fix any findings — they are real.

- [ ] **Step 3: E2E with two Playwright tabs**

```bash
cd /Users/maxcarlsonold/openlaszlo-5.0 && node server/index.mjs 8090 &
```

Open TWO tabs on `http://localhost:8090/examples/dom-authoring/bus-demo.html` (Playwright `browser_tabs` + `browser_navigate`). Verify:
1. Both render; counter text reads `count: 0`.
2. Click the blue box in tab A → BOTH tabs show `count: 1` and the box widens. **This IS the spec's mandatory constraint-refire canary** (`${100 + server.state.count * 12}` is a compiled constraint updating from a delta — the silent `instanceof LzEventable` null guard). It is deliberately a browser check, not a Node unit test: the failure mode only exists in the real compiled-LFC + prelude environment. Record the result in the task summary.
3. Type in tab B's input, click send → the log `<text>` updates in BOTH tabs.
4. Reload tab A → snapshot restores current count/log (not defaults).
5. Console: no errors (the `lz-bus:` warning must NOT appear when the server is up).

Any failure: debug at the failing seam (prelude → WS frames → LFC events). The most likely failure is the constraint not re-firing — check `instanceof LzEventable` on `server.state` in the console first.

- [ ] **Step 4: Docs + final commit**

Append to `examples/dom-authoring/README.md`:

```markdown

## Realtime bus (Slice 3)

A `<server>` section inside `<laszlo-app>` declares server-side reactive tags
(same dialect, same TypeScript carriers). Run under the Node server:

    node server/index.mjs 8090
    open http://localhost:8090/examples/dom-authoring/bus-demo.html   # in two browsers

Server attributes sync to every client (constraints track them:
`width="${100 + server.state.count * 12}"`); inline apps only in v1
(`src=`-loaded apps can't reach the bus yet); clients write back with
`server.state.setAttribute(...)` and call server `<method>`s as Promises.
State is server-authoritative and shared (one singleton per app).
`lzx-check` types both sides — server bodies run in Node (so `setInterval`
is legal there and flagged in client code). Static hosting: the section is
inert (console warning, defaults hold).
```

```bash
cd compiler && npm test
cd .. && git add examples/dom-authoring/ && git commit -m "examples: realtime bus demo (shared counter + RPC chat) + docs; E2E verified"
```

---

## Known limitation (document, don't fix in v1)

`src=`-loaded apps (`<laszlo-app src="app.html">`) with a `<server>` section:
`connectBus(location.pathname)` points the bus at the HOST PAGE, not the
fetched src document, so the bus refuses (console warning, defaults hold).
Inline apps only for v1; note this in the README bus section.

## Out of scope (per spec Non-goals — do not build)

Sessions/presence/auth, delta replay/versioning, hot reload of `<server>`, `.lzx`-dialect `<server>`, multi-screen, editor, horizontal scaling, plain-module server objects (the SrvNode factoring keeps the door open).
