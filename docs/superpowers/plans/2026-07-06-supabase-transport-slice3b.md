# Supabase Realtime Transport (Slice 3b/3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shared state on static hosting — `<server transport="supabase">` runs the bus over Supabase Realtime: ephemeral broadcast+presence tags (3b) and durable table-backed tags with `rows`/`insert` (3c), typed by `lzx-check`, demoed against the live user-provisioned project.

**Architecture:** The Slice-3 proxy core is untouched; `extractServerDecls`/`busPrelude` learn a transport-aware decl OBJECT (node output byte-identical, golden-tested), the prelude gains the presence proxy + `rows:[]`/`insert`-stub for table tags (both bind-time-critical), and a new lazy bridge (`startup/lz-bus-supabase.js`) drains the ONE shared `__lzBusQueue` (`op:set` → broadcast+track, `op:insert` → RLS-gated insert settling `__lzBusCalls[uid]`). The checker gates the server-body second program on `serverTransport.mode === "node"` and flags methods/handlers in supabase mode. Provisioning is hand+empirical: the user pastes the migration in the dashboard SQL editor; verification is Data-API curl + the live E2E.

**Tech Stack:** vendored `@supabase/supabase-js@2.110.0` UMD (committed, ~206KB), Slice-3 modules, `node --test`, Playwright E2E against `https://cqcvnsiitrwlvrdbdqlt.supabase.co` (publishable key `sb_publishable_lQyZC9w-mgLN6uG2CW7uaQ_kgOqbZmb` — public by design).

**Spec:** `docs/superpowers/specs/2026-07-06-supabase-transport-design.md` (rev 3) — read it first. Branch: `dom-authoring-slice3b` (already created, worktree `.claude/worktrees/bus-slice3`).

## Global Constraints

- **Node-transport behavior byte-identical**: `busPrelude`'s node output is pinned by a GOLDEN string test; Slice-3 tests must stay green untouched.
- **Proxies stay `instanceof LzEventable`** (the LFC constraint gate); all state applies through the ORIGINAL `LzEventable.prototype.setAttribute`.
- **One queue**: insert stubs ride `window.__lzBusQueue` with `{op:"insert", tag, record, uid}` + `window.__lzBusCalls[uid]` settle pairs — never `op:"call"`, never a second queue.
- **No secrets**: only the publishable key appears anywhere; RLS is the boundary; supabase-js vendored+pinned (UMD — a single committed ESM file does not exist).
- **Constraint expressions are ES3** (LZX script compiler): no arrows/template literals in `${…}` — demo code uses function expressions.
- **`rows` is read-only**: prelude warn+no-op + the tsc-verified `Exclude<keyof this & string, "rows">` setter override in the generated class.
- **`server.presence` reserved**; methods/handlers in supabase mode are checker findings; missing `supabase-url`/`supabase-key` is a finding.
- Demo must run on the STATIC server (`tools/serve-static.mjs`) — that's the point.
- `cd compiler && npm test` green after every task; commit after every task.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `startup/vendor/supabase-js-2.110.0.js` | create (downloaded, committed) | official UMD single-file build, `window.supabase` |
| `compiler/src/app-model.ts` | modify | `serverTransport` model field, `table?` on ServerTagModel, supabase-mode findings |
| `compiler/src/app-dts.ts` | modify | table-backed typing (`rows`, `insert`, Exclude-setter), presence built-in, transport-aware generateServerDts |
| `compiler/src/lzx-check.ts` | modify | second program gated on `mode === "node"` |
| `startup/lz-bus.js` | modify | `extractServerDecls` → decl OBJECT (reads `<server>` attrs, `table=`); `busPrelude` transport-aware (presence proxy, rows/insert stubs); node output byte-identical |
| `startup/lz-bus-supabase.js` | create | the bridge: channel/broadcast/presence (3b), subscribe→select→dedupe + insert (3c), `pickAdoptionSource` pure helper |
| `startup/laszlo-dom.js` | modify | route `connectSupabase` vs `connectBus` by `decls.transport` |
| `docs/superpowers/assets/2026-07-06-bus-messages.sql` | create | the migration (user-applied) |
| `examples/dom-authoring/bus-supabase-demo.html` | create | counter (3b) + presence + chat (3c), static-hostable, real project values |
| `compiler/test/bus-supabase.test.mjs` | create | model/checker/decls/prelude/adoption unit tests |
| `examples/dom-authoring/README.md` | modify | supabase section |

---

### Task 1: Vendor supabase-js (pinned UMD)

**Files:**
- Create: `startup/vendor/supabase-js-2.110.0.js`

**Interfaces:**
- Produces: the committed classic-script bundle exposing `window.supabase.createClient(url, key, opts)` — loaded by Task 4's bridge via the bootstrap's `loadScript` pattern.

- [ ] **Step 1: Download the pinned official UMD build**

```bash
mkdir -p startup/vendor
curl -fsSL -o startup/vendor/supabase-js-2.110.0.js \
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js"
wc -c startup/vendor/supabase-js-2.110.0.js
grep -c "createClient" startup/vendor/supabase-js-2.110.0.js
node --check startup/vendor/supabase-js-2.110.0.js && echo "PARSES"
```

Expected: ~200-260KB; `createClient` count ≥ 1; `PARSES`. If jsdelivr 404s on this exact version, list available with `curl -s https://registry.npmjs.org/@supabase/supabase-js | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['dist-tags'])"` and pin the current latest 2.x, updating the filename EVERYWHERE this plan mentions it.

- [ ] **Step 2: Commit**

```bash
git add startup/vendor/supabase-js-2.110.0.js
git commit -m "startup: vendor supabase-js 2.110.0 (official UMD single-file build, pinned)"
```

---

### Task 2: Model + checker (transport, table tags, findings, typing)

**Files:**
- Modify: `compiler/src/app-model.ts`, `compiler/src/app-dts.ts`, `compiler/src/lzx-check.ts`
- Test: `compiler/test/bus-supabase.test.mjs` (model/checker portion)

**Interfaces:**
- Consumes: Slice-3 shapes (`walkServer`, `ServerTagModel`, `generateServerDts`, the second-program block).
- Produces:
  - `AppModel.serverTransport: { mode: "node" | "supabase"; url?: string; key?: string }` (default `{ mode: "node" }`)
  - `ServerTagModel.table?: string`
  - supabase-mode findings (staticIssues): methods/handlers ("no execution home in supabase mode — use the Node bus, or a table-backed tag"), reserved tag name `presence`, missing `supabase-url`/`supabase-key`
  - `generateServerDts`: in supabase mode, table-backed `_client` classes declare `rows: any[]`, `insert(record: any): Promise<any>`, and the setter override `setAttribute<K extends Exclude<keyof this & string, "rows">>(name: K, value: this[K]): void;`; a `LzSrvPresence_client` class (`count: number`) + `presence` entry in the `server` const; `serverDts` (server program) is EMPTY in supabase mode
  - `lzx-check`: the second program runs only when `model.serverTags.length && model.serverTransport.mode === "node"`

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/bus-supabase.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";
import { checkApp } from "../dist/lzx-check.js";

const parse = (html) => findLaszloApp(parseHtmlDialect(html));
const SUPA = `<laszlo-app>
<view width="\${server.state.count}" x="\${server.presence.count}"></view>
<text text="\${(function(rs){var s='';for(var i=0;i<rs.length;i++)s+=rs[i].body;return s})(server.chat.rows)}"></text>
<server transport="supabase" supabase-url="https://x.supabase.co" supabase-key="sb_publishable_x">
  <counter name="state"><attribute name="count" type="number" value="0"></attribute></counter>
  <chat name="chat" table="bus_messages"></chat>
</server>
</laszlo-app>`;

test("model: transport + table parsed; node default preserved", () => {
  const m = extractApp(parse(SUPA));
  assert.deepEqual(m.serverTransport, { mode: "supabase", url: "https://x.supabase.co", key: "sb_publishable_x" });
  assert.equal(m.serverTags.find((t) => t.name === "chat").table, "bus_messages");
  assert.equal(m.serverTags.find((t) => t.name === "state").table, undefined);
  const node = extractApp(parse("<laszlo-app><server><a name='a'></a></server></laszlo-app>"));
  assert.deepEqual(node.serverTransport, { mode: "node" });
});

test("model: supabase-mode findings — methods/handlers, reserved presence, missing url/key", () => {
  const m = extractApp(parse('<laszlo-app><server transport="supabase">' +
    '<a name="a"><method name="m"><script type="text/typescript">return 1;</script></method>' +
    '<handler name="oninit"><script type="text/typescript">return 1;</script></handler></a>' +
    '<b name="presence"></b></server></laszlo-app>'));
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("no execution home"));
  assert.ok(msgs.includes('"presence" is reserved'));
  assert.ok(msgs.includes("supabase-url"));
});

test("checker: table typing, rows excluded from setter, presence typed, no server program", () => {
  const r = checkApp(SUPA, "x.html");
  assert.deepEqual(r.findings.map((f) => f.message), []); // constraints on rows/count/presence all typecheck
  assert.equal(r.serverBodiesChecked, 0);                 // supabase mode: no second program
  // inline on*= attrs are never body-checked — the bad set must live in a
  // <handler> element body:
  const bad = checkApp(SUPA.replace("</view>",
    '<handler name="onclick"><script type="text/typescript">server.chat.setAttribute("rows", []);</script></handler></view>'), "x.html");
  assert.ok(bad.findings.some((f) => f.code === 2345), "setAttribute(\'rows\', …) must be TS2345: " + JSON.stringify(bad.findings));
});

test("checker: node-mode apps unaffected (regression)", () => {
  const r = checkApp('<laszlo-app><server><a name="a"><method name="m"><script type="text/typescript">return 1;</script></method></a></server></laszlo-app>', "x.html");
  assert.equal(r.serverBodiesChecked, 1);
  assert.ok(!r.findings.some((f) => f.message.includes("no execution home")));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (`serverTransport` undefined etc.).

- [ ] **Step 3: Implement — app-model.ts**

(a) Interfaces: add `table?: string` to `ServerTagModel`; add to `AppModel`:

```ts
  serverTransport: { mode: "node" | "supabase"; url?: string; key?: string };
```

with model init `serverTransport: { mode: "node" }`.

(b) In `walkServer(serverEl)`, FIRST read the section's own attributes:

```ts
    const transport = (serverEl.getAttribute("transport") ?? "node").toLowerCase();
    if (transport === "supabase") {
      const url = serverEl.getAttribute("supabase-url") ?? undefined;
      const key = serverEl.getAttribute("supabase-key") ?? undefined;
      model.serverTransport = { mode: "supabase", url, key };
      if (!url || !key)
        model.staticIssues.push({ message: `transport="supabase" requires supabase-url and supabase-key`, line: serverEl.line });
    }
```

(c) In the per-tag loop: capture `table`:

```ts
      const table = tagEl.getAttribute("table") ?? undefined;
      const tag: ServerTagModel = { name, tsName: "LzSrv_" + name, attrs: [], methods: [], handlers: [], ...(table ? { table } : {}) };
```

reserved name (before the duplicate check):

```ts
      if (model.serverTransport.mode === "supabase" && name === "presence") {
        model.staticIssues.push({ message: `server tag name "presence" is reserved in supabase mode (built-in)`, line: tagEl.line });
        continue;
      }
```

and in the method/handler branches, when `model.serverTransport.mode === "supabase"`:

```ts
        model.staticIssues.push({ message: `<${t}> on server tag "${name}": no execution home in supabase mode — use the Node bus, or a table-backed tag`, line: c.line });
        // still collected into the model (harmless); the finding is the contract
```

- [ ] **Step 4: Implement — app-dts.ts (`generateServerDts`)**

Make it transport-aware (the model is already a parameter):

```ts
export function generateServerDts(model: AppModel): { clientDts: string; serverDts: string } {
  const supa = model.serverTransport?.mode === "supabase";
  const client: string[] = [];
  const server: string[] = [];
  for (const t of model.serverTags) {
    client.push(`declare class ${t.tsName}_client extends LzEventable {`);
    if (!supa) server.push(`declare class ${t.tsName} extends SrvNode {`);
    for (const a of t.attrs) { client.push(`  ${a.name}: ${a.tsType};`); if (!supa) server.push(`  ${a.name}: ${a.tsType};`); }
    if (supa && t.table) {
      client.push(`  rows: any[];`);
      client.push(`  insert(record: any): Promise<any>;`);
      // rows is read-only: tsc-verified — Exclude removes it from the setter
      // union while the property declaration keeps constraint typing alive.
      client.push(`  setAttribute<K extends Exclude<keyof this & string, "rows">>(name: K, value: this[K]): void;`);
    } else {
      for (const m of t.methods) client.push(`  ${m.name}(...args: any[]): Promise<any>;`);
      client.push(`  setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;`);
    }
    client.push("}", "");
    if (!supa) server.push("}", "");
  }
  if (model.serverTags.length) {
    if (supa) client.push(`declare class LzSrvPresence_client extends LzEventable { count: number; }`, "");
    client.push("declare const server: {");
    for (const t of model.serverTags) client.push(`  ${t.name}: ${t.tsName}_client;`);
    if (supa) client.push(`  presence: LzSrvPresence_client;`);
    client.push("};", "");
  }
  return { clientDts: client.join("\n"), serverDts: server.join("\n") };
}
```

- [ ] **Step 5: Implement — lzx-check.ts gate**

Change the second-program condition:

```ts
  if (model.serverTags.length && model.serverTransport.mode === "node") {
```

(everything inside unchanged; `serverBodiesChecked` stays 0 in supabase mode).

- [ ] **Step 6: Run tests, commit**

Run: `cd compiler && npm test` — Expected: PASS (all suites; Slice-3 bus tests untouched).

```bash
git add compiler/src/ compiler/test/bus-supabase.test.mjs
git commit -m "compiler: supabase transport model + table-backed typing + mode-gated server program"
```

---

### Task 3: Client decls + transport-aware prelude (node output golden-pinned)

**Files:**
- Modify: `startup/lz-bus.js`, `startup/laszlo-dom.js`
- Test: `compiler/test/bus-supabase.test.mjs` (append)

**Interfaces:**
- Consumes: current `extractServerDecls(serverEl)` (returns an ARRAY today) and `busPrelude(decls)`.
- Produces:
  - `extractServerDecls(serverEl)` → `{ transport: "node"|"supabase", url?: string, key?: string, tags: [{ tag, table?, attrs: [{name,value,type}], methods: [{name}] }] }`
  - `busPrelude(decls)` takes the OBJECT. Node mode: per-tag generation UNCHANGED → output byte-identical (golden test). Supabase mode adds: the presence proxy (`window.server.presence`, `count: 0`); per table tag `rows: []` + `insert` stub (`{op:"insert", tag, record, uid}` via `__lzBusSend`, settle in `__lzBusCalls`) and a `setAttribute` shadow that warns+no-ops for `"rows"`; ephemeral tags keep the Slice-3 shadow.
  - `laszlo-dom.js` routes: `decls.transport === "supabase"` → lazy-import `lz-bus-supabase.js`, call `connectSupabase(decls, location.pathname)`; else `connectBus(location.pathname)` as today.

- [ ] **Step 1: Write the failing tests (append to `compiler/test/bus-supabase.test.mjs`)**

```js
// ── Task 3: decls + prelude ──────────────────────────────────────────────────
import { extractServerDecls, busPrelude } from "../../startup/lz-bus.js";

// minimal live-DOM stub: lz-bus uses .children + getAttribute
const elS = (tag, attrs = {}, ...children) => ({
  tagName: tag.toUpperCase(),
  children,
  getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
});

const NODE_DECLS_INPUT = elS("server", {},
  elS("clock", { name: "clock" },
    elS("attribute", { name: "seconds", type: "number", value: "0" }),
    elS("method", { name: "reset" })));

test("extractServerDecls: object shape; node default; supabase attrs + table", () => {
  const node = extractServerDecls(NODE_DECLS_INPUT);
  assert.deepEqual(node, {
    transport: "node",
    tags: [{ tag: "clock", attrs: [{ name: "seconds", value: "0", type: "number" }], methods: [{ name: "reset" }] }],
  });
  const supa = extractServerDecls(elS("server",
    { transport: "supabase", "supabase-url": "https://x.supabase.co", "supabase-key": "k" },
    elS("chat", { name: "chat", table: "bus_messages" })));
  assert.equal(supa.transport, "supabase");
  assert.equal(supa.url, "https://x.supabase.co");
  assert.equal(supa.key, "k");
  assert.equal(supa.tags[0].table, "bus_messages");
});

test("busPrelude: NODE output is byte-identical to Slice 3 (FULL-STRING golden)", () => {
  // GOLDEN is defined at the top of this file — captured in Step 1b.
  const out = busPrelude(extractServerDecls(NODE_DECLS_INPUT));
  // GOLDEN is captured from the PRE-CHANGE Slice-3 busPrelude (see the
  // capture step below) and pasted here verbatim. assert.equal → byte parity.
  assert.equal(out, GOLDEN);
});

test("busPrelude: supabase mode adds presence proxy + table rows/insert stubs", () => {
  const out = busPrelude(extractServerDecls(elS("server",
    { transport: "supabase", "supabase-url": "u", "supabase-key": "k" },
    elS("state", { name: "state" }, elS("attribute", { name: "count", type: "number", value: "0" })),
    elS("chat", { name: "chat", table: "bus_messages" }))));
  assert.ok(out.includes("window.server.presence"));
  assert.ok(out.includes('o.rows = []'));
  assert.ok(out.includes('op: "insert"'));
  assert.ok(!out.includes('op: "call"'));       // no declared methods here
  assert.ok(out.includes('"rows" is read-only'));
});
```

- [ ] **Step 1a: Make startup/ Node-importable (REQUIRED — tests physically cannot import it today)**

`startup/*.js` resolves as CJS from Node (no package.json up its tree declares module type), so `import { busPrelude } from "../../startup/lz-bus.js"` fails with a named-export error on Node 20. Commit:

```bash
cat > startup/package.json <<'EOF2'
{ "type": "module" }
EOF2
```

Safe: browsers never read it; the only Node consumers of `startup/` today are `.mjs` files (server/index.mjs, server/dev-views.mjs — unaffected).

- [ ] **Step 1b: Capture the golden (BEFORE changing lz-bus.js)**

```bash
# (requires Step 1a's startup/package.json)
node --input-type=module -e "
import { busPrelude } from './startup/lz-bus.js';
const decls = [{ tag: 'clock', attrs: [{ name: 'seconds', value: '0', type: 'number' }], methods: [{ name: 'reset' }] }];
console.log(JSON.stringify(busPrelude(decls)));
" > /tmp/golden.json
```

Paste the resulting JSON string into the test as
`const GOLDEN = JSON.parse(String.raw\`<paste>\`);`
(`String.raw` is REQUIRED — a plain string/template literal re-interprets the JSON's `\n`/`\"` escapes before JSON.parse sees them and fails with "Bad control character"; the output contains no backticks or `${`, so raw is safe). Alternative: commit the string to `compiler/test/fixtures/prelude-node.golden` and `readFileSync` it. This pins the CURRENT Slice-3 output before any edit; the new object-taking busPrelude must reproduce it byte-for-byte for node transport.

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (array shape / missing fields). (NOTE: the Task-4 import at the top of this test file makes the WHOLE file fail with module-not-found until Task 4 creates `lz-bus-supabase.js` — either add that import only in Task 4, or create an empty exporting stub now.)

- [ ] **Step 3: Implement — `startup/lz-bus.js`**

Replace `extractServerDecls` and `busPrelude`:

```js
/** Read declarations from the LIVE <server> element (before cleanup removes it).
 *  Returns { transport, url?, key?, tags: [{tag, table?, attrs, methods}] }. */
export function extractServerDecls(serverEl) {
  const transport = (serverEl.getAttribute("transport") || "node").toLowerCase();
  const decls = { transport, tags: [] };
  if (transport === "supabase") {
    decls.url = serverEl.getAttribute("supabase-url") || undefined;
    decls.key = serverEl.getAttribute("supabase-key") || undefined;
  }
  for (const tagEl of [...serverEl.children]) {
    const tag = tagEl.getAttribute("name");
    if (!tag) continue;
    const table = tagEl.getAttribute("table") || undefined;
    const attrs = [], methods = [];
    for (const c of [...tagEl.children]) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") attrs.push({ name: c.getAttribute("name"), value: c.getAttribute("value"), type: c.getAttribute("type") || "" });
      else if (t === "method") methods.push({ name: c.getAttribute("name") });
    }
    decls.tags.push({ tag, ...(table ? { table } : {}), attrs, methods });
  }
  return decls;
}
```

`busPrelude(decls)` — keep the EXACT node-mode template (the golden pins it); the only structural change is `DECLS = decls.tags` plus supabase-conditional blocks:

```js
export function busPrelude(decls) {
  const supa = decls.transport === "supabase";
  return `// lz-bus proxy prelude (generated)
(function () {
  var DECLS = ${JSON.stringify(decls.tags)};
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
${supa ? `    if (d.table) {
      // Table-backed (3c): rows/insert exist at BIND TIME (constraints need
      // them); inserts ride the ONE shared queue with the call machinery.
      o.rows = [];
      o.setAttribute = function (n, v) {
        if (n === "rows") { if (window.console) console.warn('lz-bus: "rows" is read-only (table-backed)'); return; }
        window.__lzBusSend({ op: "set", tag: d.tag, attr: n, value: v });
      };
      o.insert = function (record) {
        var id = ++uid;
        var settle = {};
        var prom = new Promise(function (res, rej) { settle.res = res; settle.rej = rej; });
        C[id] = settle;
        window.__lzBusSend({ op: "insert", tag: d.tag, record: record, uid: id });
        return prom;
      };
    } else {
      o.setAttribute = function (n, v) { window.__lzBusSend({ op: "set", tag: d.tag, attr: n, value: v }); };
    }
    // Spec runtime contract: declared methods are ignored with one warning
    // (they are checker findings; no execution home in supabase mode).
    d.methods.forEach(function (m) {
      o[m.name] = function () {
        if (window.console) console.warn('lz-bus: "' + m.name + '" has no execution home in supabase mode');
        return Promise.reject(new Error("no execution home in supabase mode"));
      };
    });
` : `    // Server-authoritative: SEND, never apply locally (deltas apply via the
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
`}    P[d.tag] = o;
    window.server[d.tag] = o;
  });
${supa ? `  var pres = new LzEventable();
  pres.count = 0;
  P.presence = pres;
  window.server.presence = pres;
` : ``}})();
`;
}
```

NOTE for the golden: the node branch must reproduce the Slice-3 template EXACTLY (same indentation/comments). Diff `git show dom-authoring-slice3:startup/lz-bus.js` if the golden assertions fail.

- [ ] **Step 4: Implement — `startup/laszlo-dom.js` routing**

The current code stores `busDecls = { decls: busMod.extractServerDecls(serverEl), mod: busMod }` and later calls `busDecls.mod.connectBus(location.pathname)`. Change ONLY the connect line:

```js
  if (busDecls) {
    if (busDecls.decls.transport === "supabase") {
      const supaMod = await import(new URL("lz-bus-supabase.js", HERE).href);
      supaMod.connectSupabase(busDecls.decls, location.pathname);
    } else {
      busDecls.mod.connectBus(location.pathname);
    }
  }
```

(`busPrelude(busDecls.decls)` already receives the object — no change there.)

- [ ] **Step 5: Run tests + syntax checks, commit**

```bash
cd compiler && npm test
npx esbuild ../startup/lz-bus.js --bundle --outfile=/dev/null
npx esbuild ../startup/laszlo-dom.js --bundle --outfile=/dev/null
cd .. && git add startup/lz-bus.js startup/laszlo-dom.js compiler/test/bus-supabase.test.mjs
git commit -m "startup: transport-aware decls + prelude (node golden-pinned; presence/rows/insert at bind time)"
```

(The esbuild check of laszlo-dom.js will report the missing `lz-bus-supabase.js` import — dynamic imports are NOT resolved by esbuild at bundle time with `new URL(...)` patterns, so it passes; if it errors, create the Task-4 file first as an empty module.)

---

### Task 4: The bridge — `startup/lz-bus-supabase.js`

**Files:**
- Create: `startup/lz-bus-supabase.js`
- Test: `compiler/test/bus-supabase.test.mjs` (append — pure helpers only)

**Interfaces:**
- Consumes: `window.__lzBusProxies/__lzBusQueue/__lzBusCalls/__lzBusSend` (prelude), vendored `window.supabase` (Task 1), `LzEventable` (LFC global).
- Produces:
  - `export function connectSupabase(decls, appPath): void`
  - `export function pickAdoptionSource(presenceState): object | null` — pure: flatten `{key: [meta,…]}`, pick the meta with the OLDEST numeric `joined_at` that has a `state` object; return its `state` or null. Malformed metas ignored.
  - `export function dedupeAppend(rows, record): any[] | null` — pure: null if `record.id` already present, else a NEW array with the record appended (ordered arrival assumed).

- [ ] **Step 1: Write the failing pure-helper tests (append)**

```js
// ── Task 4: bridge pure helpers ──────────────────────────────────────────────
import { pickAdoptionSource, dedupeAppend } from "../../startup/lz-bus-supabase.js";

test("pickAdoptionSource: oldest joined_at wins; malformed ignored; empty null", () => {
  assert.equal(pickAdoptionSource({}), null);
  const st = pickAdoptionSource({
    a: [{ joined_at: 200, state: { s: { count: 2 } } }],
    b: [{ joined_at: 100, state: { s: { count: 9 } } }],
    c: [{ nope: true }, { joined_at: 50 }, { joined_at: 10, state: {} }], // malformed / empty state: ignored
  });
  assert.deepEqual(st, { s: { count: 9 } });
});

test("dedupeAppend: id-deduped, immutable append", () => {
  const rows = [{ id: 1, body: "a" }];
  assert.equal(dedupeAppend(rows, { id: 1, body: "a" }), null);
  const next = dedupeAppend(rows, { id: 2, body: "b" });
  assert.equal(next.length, 2);
  assert.equal(rows.length, 1); // immutable
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `startup/lz-bus-supabase.js`:

```js
// lz-bus-supabase.js — Supabase Realtime bridge for the bus (spec:
// docs/superpowers/specs/2026-07-06-supabase-transport-design.md).
// 3b: one channel per app (`lzbus:<path>`) carrying broadcast{self:true} +
// presence; joiners adopt the OLDEST peer's presence-carried state.
// 3c: per table tag, subscribe postgres_changes FIRST, then select, dedupe
// by id. All state applies via the ORIGINAL LzEventable.prototype.setAttribute.
// Pure decision helpers exported for unit tests; window/* touched only
// inside functions (module is Node-importable for tests).

/** Oldest-joined peer's state (the room's longest-converged view), or null. */
export function pickAdoptionSource(presenceState) {
  let best = null;
  for (const metas of Object.values(presenceState || {})) {
    for (const m of metas || []) {
      if (!m || typeof m.joined_at !== "number" || !m.state || typeof m.state !== "object"
          || Object.keys(m.state).length === 0) continue; // empty-state seniors never win
      if (!best || m.joined_at < best.joined_at) best = m;
    }
  }
  return best ? best.state : null;
}

/** Immutable id-deduped append; null when the record is already present. */
export function dedupeAppend(rows, record) {
  if ((rows || []).some((r) => r.id === record.id)) return null;
  return [...rows, record];
}

const VENDOR = "vendor/supabase-js-2.110.0.js";

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

export function connectSupabase(decls, appPath) {
  const path = appPath.replace(/^\//, "");
  const waitForProxies = (fn, n = 0) => {
    if (window.__lzBusProxies) return fn();
    if (n > 200) return console.warn("lz-bus: proxies never appeared");
    setTimeout(() => waitForProxies(fn, n + 1), 50);
  };
  waitForProxies(async () => {
    try {
    if (!window.supabase) await loadScript(new URL(VENDOR, import.meta.url).href);
    const client = window.supabase.createClient(decls.url, decls.key, { auth: { persistSession: false } });
    const P = window.__lzBusProxies;
    const C = window.__lzBusCalls;
    let fresh = true; // never applied any EPHEMERAL tag state -> adoption allowed
    // apply = raw (presence count AND table rows use it — neither may block
    // adoption: table state lives in a different authority domain, and peer
    // presence state can never contain rows);
    // applyState = EPHEMERAL tag state (delta/echo/adoption; clears fresh).
    const apply = (tag, attr, value) => {
      const o = P[tag];
      if (o) LzEventable.prototype.setAttribute.call(o, attr, value);
    };
    const applyState = (tag, attr, value) => { fresh = false; apply(tag, attr, value); };
    const localState = {}; // our presence meta mirror
    const joinedAt = Date.now();

    // ── 3b: the app channel (broadcast + presence) ──
    const chan = client.channel("lzbus:" + path, { config: { broadcast: { self: true } } });
    chan.on("broadcast", { event: "lzbus" }, ({ payload: m }) => {
      if (m && m.op === "delta") applyState(m.tag, m.attr, m.value);
    });
    chan.on("presence", { event: "sync" }, () => {
      const state = chan.presenceState();
      let count = 0;
      for (const metas of Object.values(state)) count += metas.length;
      apply("presence", "count", count); // raw: never blocks adoption
      if (fresh) {
        const adopted = pickAdoptionSource(state);
        if (adopted) for (const [tag, attrs] of Object.entries(adopted))
          for (const [a, v] of Object.entries(attrs)) applyState(tag, a, v);
      }
    });

    // sender path: set -> broadcast (self-echo applies) + presence meta
    const doSet = (m) => {
      (localState[m.tag] = localState[m.tag] || {})[m.attr] = m.value;
      chan.send({ type: "broadcast", event: "lzbus", payload: { op: "delta", tag: m.tag, attr: m.attr, value: m.value } });
      chan.track({ state: localState, joined_at: joinedAt });
    };

    // ── 3c: per table tag ──
    const tableTags = decls.tags.filter((t) => t.table);
    const doInsert = async (m) => {
      const tag = decls.tags.find((t) => t.tag === m.tag);
      const settle = C[m.uid];
      try {
        const { error } = await client.from(tag.table).insert({ ...m.record, app: path });
        if (error) throw error;
        if (settle) { delete C[m.uid]; settle.res(null); } // v1: resolves null (row not returned) — accepted divergence
      } catch (e) {
        if (settle) { delete C[m.uid]; settle.rej(e instanceof Error ? e : new Error(String(e.message || e))); }
      }
    };
    for (const t of tableTags) {
      // SUBSCRIBE FIRST, then select, dedupe by id (spec race rule).
      client.channel("lzbus-table:" + path + ":" + t.tag)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: t.table, filter: "app=eq." + path }, (msg) => {
          const next = dedupeAppend(P[t.tag].rows, msg.new);
          if (next) apply(t.tag, "rows", next); // raw: table state never blocks adoption
        })
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            console.warn("lz-bus: table channel " + status + " for " + t.tag);
        });
      client.from(t.table).select("*").eq("app", path).order("id").then(({ data, error }) => {
        if (error) return console.warn("lz-bus: table select failed:", error.message);
        let rows = P[t.tag].rows;
        for (const r of data || []) { const next = dedupeAppend(rows, r); if (next) rows = next; }
        apply(t.tag, "rows", rows); // raw: table state never blocks adoption
      });
    }

    chan.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        const q = window.__lzBusQueue.splice(0);
        const route = (m) => m.op === "insert" ? doInsert(m)
          : m.op === "set" ? doSet(m)
          : console.warn("lz-bus: unsupported op in supabase mode:", m.op);
        window.__lzBusSend = (m) => { JSON.stringify(m); route(m); };
        q.forEach(route);
        chan.track({ state: localState, joined_at: joinedAt });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("lz-bus: supabase channel " + status + " — check the project's Realtime 'Allow public access' setting");
      }
    });
    } catch (e) {
      // Spec degradation contract: one warning, defaults hold.
      console.warn("lz-bus: supabase transport unavailable — server state stays at defaults:", e && e.message);
    }
  });
}
```

(NOTE: the `try {` body above is deliberately NOT re-indented — do not reflow it; the braces are verified balanced. The `apply`/`applyState` split above is load-bearing: presence-count AND table-row updates use raw `apply` so they never block adoption; delta/echo/adoption use `applyState`, which clears the `fresh` flag.)

- [ ] **Step 3: Implementation-time platform verification (spec principle 4)**

One search_docs/doc-fetch pass confirming: presence "keys per object" limit (our tracked meta has 2 top-level keys), free-tier message rates, and that `broadcast: { self: true }` + `presenceState()` shapes match the vendored 2.110.0. Note results in the task summary.

- [ ] **Step 4: Run tests + syntax check, commit**

```bash
cd compiler && npm test
npx esbuild ../startup/lz-bus-supabase.js --bundle --outfile=/dev/null
cd .. && git add startup/lz-bus-supabase.js compiler/test/bus-supabase.test.mjs
git commit -m "startup: supabase bridge (broadcast+presence, adoption, table sync, queue drain)"
```

---

### Task 5: Migration + provisioning (USER STEP) + empirical verification

**Files:**
- Create: `docs/superpowers/assets/2026-07-06-bus-messages.sql`

- [ ] **Step 1: Write the migration**

```sql
-- bus_messages: table-backed tag storage for the Supabase transport demo
-- (spec: docs/superpowers/specs/2026-07-06-supabase-transport-design.md).
-- Apply via the Supabase dashboard SQL editor (project is outside the MCP org).
create table public.bus_messages (
  id bigint generated always as identity primary key,
  app text not null,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);
alter table public.bus_messages enable row level security;
create policy "bus demo read" on public.bus_messages
  for select to anon, authenticated using (true);
create policy "bus demo write" on public.bus_messages
  for insert to anon, authenticated
  with check (char_length(body) <= 500 and char_length(app) <= 200);
create index bus_messages_app_id on public.bus_messages (app, id);
-- REQUIRED for postgres_changes delivery (silent non-delivery without it):
alter publication supabase_realtime add table public.bus_messages;
```

- [ ] **Step 2: USER STEP (blocking) — apply the migration**

Ask the user to paste `docs/superpowers/assets/2026-07-06-bus-messages.sql` into the dashboard SQL editor at `https://supabase.com/dashboard/project/cqcvnsiitrwlvrdbdqlt/sql` and run it. WAIT for confirmation.

- [ ] **Step 3: Empirical Data-API verification (spec provisioning §2)**

```bash
U="https://cqcvnsiitrwlvrdbdqlt.supabase.co"; K="sb_publishable_lQyZC9w-mgLN6uG2CW7uaQ_kgOqbZmb"
# 201: table + Data-API exposure + INSERT RLS
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$U/rest/v1/bus_messages" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"app":"provision-check","body":"hello"}'
# the row comes back: SELECT RLS
curl -s "$U/rest/v1/bus_messages?app=eq.provision-check&select=body" -H "apikey: $K"
# oversize body REJECTED (the check gates): expect 4xx
python3 -c "print('{\"app\":\"provision-check\",\"body\":\"' + 'x'*501 + '\"}')" > /tmp/big.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$U/rest/v1/bus_messages" \
  -H "apikey: $K" -H "Content-Type: application/json" -d @/tmp/big.json
```

Expected: `201`, `[{"body":"hello"}]`, `4xx` (23514 check violation surfaces as 400). Any other result: STOP, report (likely Data-API exposure settings or the migration didn't run).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/assets/2026-07-06-bus-messages.sql
git commit -m "assets: bus_messages migration (RLS + realtime publication) — applied to the demo project"
```

---

### Task 6: Demo + live E2E + docs

**Files:**
- Create: `examples/dom-authoring/bus-supabase-demo.html`
- Modify: `examples/dom-authoring/README.md`

- [ ] **Step 1: Write the demo (real project values; ES3 in constraints!)**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>OpenLaszlo — Supabase realtime demo (static hosting)</title>
  <style>laszlo-app{visibility:hidden;display:block;position:relative}</style>
  <script type="module" src="../../startup/laszlo-dom.js"></script>
</head>
<body style="font:14px sans-serif;margin:16px">
  <h2>Supabase transport: STATIC hosting, two browsers, one state</h2>
  <laszlo-app width="640" height="380" bgcolor="#f2eef7">
    <view name="counterbox" x="20" y="20" width="${100 + server.state.count * 12}" height="48" bgcolor="#7a4fb0">
      <handler name="onclick"><script type="text/typescript">
        server.state.setAttribute('count', server.state.count + 1);
      </script></handler>
    </view>
    <text x="20" y="80" text="${'count: ' + server.state.count + '   online: ' + server.presence.count}"></text>
    <text x="20" y="110" width="600" height="180" multiline="true"
          text="${(function(rs){var s='';for(var i=0;i&lt;rs.length;i++)s+=rs[i].body+'\n';return s})(server.chat.rows)}"></text>
    <inputtext name="msg" x="20" y="310" width="400" height="24" bgcolor="#ffffff"></inputtext>
    <view x="430" y="308" width="60" height="26" bgcolor="#9bbb59">
      <handler name="onclick"><script type="text/typescript">
        const box = (this.parent as any).msg;
        server.chat.insert({ body: box.getText() });
        box.setAttribute('text', '');
      </script></handler>
    </view>
    <server transport="supabase"
            supabase-url="https://cqcvnsiitrwlvrdbdqlt.supabase.co"
            supabase-key="sb_publishable_lQyZC9w-mgLN6uG2CW7uaQ_kgOqbZmb">
      <counter name="state">
        <attribute name="count" type="number" value="0"></attribute>
      </counter>
      <chat name="chat" table="bus_messages"></chat>
    </server>
  </laszlo-app>
</body>
</html>
```

(NOTE the constraint uses an ES3 function expression and `&lt;` for the `<` — attribute values are HTML-parsed. Verify the checker is happy first.)

- [ ] **Step 2: Check it**

```bash
cd compiler && node dist/lzx-check.js ../examples/dom-authoring/bus-supabase-demo.html
```
Expected: `OK — 2 bodies, 3 constraints, 0 server bodies checked, 0 findings`.

- [ ] **Step 3: Live E2E — STATIC server, two Playwright tabs**

```bash
cd /Users/maxcarlsonold/openlaszlo-5.0/.claude/worktrees/bus-slice3 && node tools/serve-static.mjs . 8092 &
```

Two tabs on `http://localhost:8092/examples/dom-authoring/bus-supabase-demo.html`. Verify in order:
1. Both boot; channel reaches SUBSCRIBED (no `lz-bus:` warnings — this IS the Channel-Restrictions check; a CHANNEL_ERROR warning means the project's Realtime "Allow public access" setting must be flipped: report to the user).
2. Click the purple box in tab A → **both** tabs' count and box width update (broadcast + self-echo canary, serverless).
3. `online: 2` in both tabs (presence).
4. Send a chat message from tab B → appears in BOTH tabs (postgres_changes proves the publication ALTER took).
5. Reload tab A → chat persists (durable); counter adopts from tab B's presence (bumped value, not 0). ALSO open a THIRD tab (the spec's joiner-adoption pin): it must adopt the bumped counter, show `online: 3`, and the chat log. Reload tab B too (chat "survives a reload of BOTH").
6. Close tab B → tab A shows `online: 1`.
7. Console: no errors.

- [ ] **Step 4: Docs + final commit**

Append to `examples/dom-authoring/README.md`:

```markdown

## Supabase transport (Slice 3b/3c) — shared state on STATIC hosting

`<server transport="supabase" supabase-url=… supabase-key=…>` runs the bus
over Supabase Realtime — no Node server:

    node tools/serve-static.mjs . 8087
    open http://localhost:8087/examples/dom-authoring/bus-supabase-demo.html  # two browsers

Ephemeral tags sync via broadcast + presence (late joiners adopt the
oldest peer's state; `server.presence.count` is built-in; empty room =
defaults). Tags with `table=` are DURABLE: `rows` fills from the table and
follows inserts live (RLS-gated `insert()`); state survives everyone
leaving. Methods/handlers have no execution home in supabase mode
(lzx-check flags them) — use the Node bus for server code. Presence meta
updates ride every set; real apps should throttle (free tier ~20/sec).
Inline apps only (rooms key on the page path). The demo project's
publishable key is committed by design; the free tier pauses after ~1 week
idle.
```

```bash
cd compiler && npm test
cd .. && git add examples/dom-authoring/ && git commit -m "examples: supabase transport demo (ephemeral counter + presence + durable chat), live E2E verified"
```

---

## Out of scope (spec Non-goals — do not build)

Edge-Function execution home (3b.2), private channels/auth users, `broadcast_changes` triggers, UPDATE/DELETE sync, conflict resolution beyond LWW, offline queueing, Slice-4 replicator integration, presence throttling (documented, not built).
