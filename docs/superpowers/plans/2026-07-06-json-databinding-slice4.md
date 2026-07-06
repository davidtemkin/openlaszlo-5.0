# JSON Databinding (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dreem's JSONPath databinding for DOM-authored openlaszlo-5.0 apps — native JSON datasets (inline / fetched / live WebSocket), implicit view replication over dreem slash-dialect paths, raw JS datums bound via the `data` attribute and existing `${}` constraints, statically typed by lzx-check, with a transport-independent wire protocol whose reference relay rides the bus's upgrade dispatcher.

**Architecture:** One shared TS core (`json-path.ts`, pure) consumed by three layers: the compiler (domsource routes `type="json"` datasets and renames JSON-dialect `datapath` → `jsondatapath`; compile emits `lz.jsondata.register(...)` instead of `lzAddLocalData`), the checker (shape inference + path validation + typed `data`), and a browser micro-runtime (`json-runtime.ts`, esbuild-IIFE'd to `startup/lz-json-data.js`, prepended into the app blob) that wraps `LzNode.prototype.makeChild` — the LFC's universal instantiation funnel (every idle-queued spec at every level, including canvas children, passes through it via `LzInstantiator`'s `parent.makeChild(spec, true)`, and it RETURNS the constructed node) — to replicate clones. The LFC is untouched; constraints refire because `(boundView,"data")` dependency pairs register on the declared `ondata` event and `$lzc$set_data` fires it.

**Tech Stack:** TypeScript in `compiler/src` (built by `npm run build`, bundled by esbuild per the `bundle:lzts` precedent), `node --test`, the bus's dep-free WS codec (`server/connection.mjs`) and `wsClient` test helper. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-06-json-databinding-design.md` (rev 3) — read it first.

## Global Constraints

- **Branch/worktree:** `dom-authoring-slice4` in `.claude/worktrees/json-slice4`, stacked on `dom-authoring-slice3`. Before Task 1, `git rebase dom-authoring-slice3` onto the bus's FINAL tip (slice 3 must be complete/merged first — both slices touch `domsource.ts`, `app-model.ts`, `lzx-check.ts`, `startup/laszlo-dom.js`, `lzc-browser.js`; land sequentially, never in parallel).
- **`runtime/lfc-src` and the .lzx-text compile path are byte-frozen** (4.9 oracle). Never edit them. All existing tests are the parity guard; they must stay green after every task.
- **Zero new dependencies.** Runtime code is authored in TS under `compiler/src/` and bundled; `startup/lz-json-data.js` is a generated IIFE artifact (committed, like `lz-ts.js`).
- **Wire protocol messages** (spec conformance surface): `{"lz":1,"subscribe":name}` / `{"dataset":name,"data":value}` / `{"dataset":name,"update":{"path":ptr,"value":v}}` / `{"dataset":name,"error":msg}`. Server MUST snapshot-on-subscribe (`data: null` when nothing retained); client drops updates before a non-null snapshot; last-write-wins; malformed messages logged and skipped.
- **`cd compiler && npm test` green after every task; commit after every task.** Run tests from `compiler/` (`npm test` runs `npm run build` first).
- `data`/`clonenumber` go in clone **construction attrs** (the LFC applies plain values before constraints — `__LZapplyArgs`); pooling default is `false` = destroy/recreate (dreem semantics).

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `compiler/src/json-path.ts` | create | dreem-dialect parser + evaluator + pointer resolver (pure; shared compiler/runtime/server) |
| `compiler/src/json-shape.ts` | create | JSON→Shape inference, Shape→TS rendering, path-over-shape walking (pure) |
| `compiler/src/json-runtime.ts` | create | browser micro-runtime: JsonDataset/registry/sources/mutation + ReplicationManager (host-injected, node-testable) |
| `compiler/src/json-runtime-entry.ts` | create | IIFE entry: installs the runtime on window (LzNode.prototype, lz.jsondata) |
| `compiler/src/domsource.ts` | modify | accept `application/json`/`application/lz-shape` in json datasets; root-child rule; `datapath`→`jsondatapath` renaming + template treatment |
| `compiler/src/compile.ts` | modify | `compileJsonDataset` branch before the `lzAddLocalData` path |
| `compiler/src/app-model.ts` | modify | json dataset collection, path validation, typed `data`, jsonCtx propagation |
| `compiler/src/app-dts.ts` | modify | `__LzShape_*` type aliases for declared shapes |
| `compiler/package.json` | modify | `bundle:jsondata` script; `dist` chain |
| `startup/lz-json-data.js` | generate | committed esbuild IIFE artifact of json-runtime-entry |
| `startup/laszlo-dom.js` | modify | include lz-json-data.js in the app blob when the app has json datasets |
| `server/data-relay.mjs` | create | `/api/data` route: retained snapshots, subscribe/publish, pointer updates |
| `server/index.mjs` | modify | add `/api/data` to the upgrade dispatcher routes |
| `compiler/test/helpers/wsclient.mjs` | create | `wsClient`/`encodeTextMasked` moved out of bus-integration.test.mjs |
| `compiler/test/json-path.test.mjs` | create | evaluator unit tests (dreem corpus) |
| `compiler/test/json-shape.test.mjs` | create | inference/rendering/walking tests |
| `compiler/test/json-compile.test.mjs` | create | domsource + compile routing tests |
| `compiler/test/json-runtime.test.mjs` | create | dataset core, mutation, fetch, replication reconcile, ws client, bridge |
| `compiler/test/json-check.test.mjs` | create | lzx-check typing tests |
| `compiler/test/json-relay.test.mjs` | create | relay integration (real HTTP server + wsClient) |
| `examples/dom-authoring/bikeshop-demo.html` | create | inline dataset + replication + updateData button |
| `examples/dom-authoring/sensors-demo.html` | create | live dataset over `/api/data` |
| `examples/dom-authoring/sensor-feeder.mjs` | create | node publisher peer for the sensors demo |
| `examples/dom-authoring/README.md` | modify | JSON databinding section |

---

### Task 1: `json-path.ts` — parser, evaluator, pointer resolver

**Files:**
- Create: `compiler/src/json-path.ts`
- Test: `compiler/test/json-path.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 2–12):
  - `class JsonPathError extends Error`
  - `type Selector = {kind:"wild"} | {kind:"index"; i:number} | {kind:"range"; start:number; end:number; step:number}`
  - `interface PathSegment { prop: string; selectors: Selector[] }`
  - `interface ParsedPath { dataset: string | null; segments: PathSegment[]; filter: boolean }`
  - `isJsonAbsolutePath(s: string): boolean` — `$name`, `$name/...`, `$name[...]`; NOT `${...}` constraints
  - `parsePath(path: string): ParsedPath` — throws JsonPathError
  - `hasFanout(p: ParsedPath): boolean` — any wild/range selector
  - `evaluatePath(root: unknown, p: ParsedPath, filterFn?: (obj:unknown, accum:unknown[]) => unknown[]): unknown[]`
  - `resolvePointer(root: unknown, pointer: string): { parent: any; key: string | number } | null`

- [ ] **Step 1: Write the failing tests**

`compiler/test/json-path.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePath, evaluatePath, resolvePointer, isJsonAbsolutePath, hasFanout, JsonPathError } from "../dist/json-path.js";

const bikeshop = { bicycle: [
  { color: "red", price: 19.95 }, { color: "green", price: 29.95 },
  { color: "blue", price: 59.95 }, { color: "black", price: 9.95 } ] };
const store = { store: { book: [{ title: "A", price: 8 }, { title: "B", price: 12 }], bicycle: { color: "red" } } };

test("isJsonAbsolutePath: $name forms yes, ${} constraints and XPath no", () => {
  assert.ok(isJsonAbsolutePath("$bikeshop"));
  assert.ok(isJsonAbsolutePath("$bikeshop/bicycle[*]/color"));
  assert.ok(!isJsonAbsolutePath("${parent.x + 1}"));
  assert.ok(!isJsonAbsolutePath("$once{foo}"));
  assert.ok(!isJsonAbsolutePath("dset:/employee"));
  assert.ok(!isJsonAbsolutePath("/relative"));
});

test("parse: dataset prefix, segments, selectors", () => {
  const p = parsePath("$storedata/store/book[*]/title");
  assert.equal(p.dataset, "storedata");
  assert.deepEqual(p.segments.map((s) => s.prop), ["store", "book", "title"]);
  assert.deepEqual(p.segments[1].selectors, [{ kind: "wild" }]);
  assert.equal(p.filter, false);
  assert.ok(hasFanout(p));
});

test("parse: relative, index, range, bare $name, terminal filter", () => {
  assert.equal(parsePath("/subgenres[*]/name").dataset, null);
  assert.deepEqual(parsePath("/a[0]").segments[0].selectors, [{ kind: "index", i: 0 }]);
  assert.deepEqual(parsePath("/a[0,3,2]").segments[0].selectors, [{ kind: "range", start: 0, end: 3, step: 2 }]);
  assert.deepEqual(parsePath("$foo"), { dataset: "foo", segments: [], filter: false });
  assert.equal(parsePath("$bikeshop/bicycle[*][@]").filter, true);
  assert.ok(!hasFanout(parsePath("/a/b")));
});

test("parse errors: mid-path [@], empty property, garbage selector", () => {
  assert.throws(() => parsePath("$b/a[@]/c"), JsonPathError);
  assert.throws(() => parsePath("$b//c"), JsonPathError);
  assert.throws(() => parsePath("$b/a[x]"), JsonPathError);
  assert.throws(() => parsePath(""), JsonPathError);
});

test("evaluate: dreem corpus", () => {
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[*]/color")),
    ["red", "green", "blue", "black"]);
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[0,3,2]/color")), ["red", "blue"]); // end-exclusive, step 2
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[1]/price")), [29.95]);
  assert.deepEqual(evaluatePath(store, parsePath("$s/store/bicycle/color")), ["red"]);
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$b")), [bikeshop]); // bare $name = whole value
});

test("evaluate: missing props / non-arrays fan to nothing; null root is empty", () => {
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$b/nope[*]/x")), []);
  assert.deepEqual(evaluatePath(store, parsePath("$s/store/bicycle[*]")), []); // wild on non-array
  assert.deepEqual(evaluatePath(null, parsePath("$b/bicycle[*]")), []);
});

test("evaluate: [@] filter accumulates via filterFn (dreem signature)", () => {
  const p = parsePath("$bikeshop/bicycle[*][@]");
  const out = evaluatePath(bikeshop, p, (obj, accum) => {
    if (obj.price > 20) accum.unshift(obj.color);
    return accum;
  });
  assert.deepEqual(out, ["blue", "green"]);
});

test("resolvePointer: keys, array indices, misses", () => {
  const r = resolvePointer(bikeshop, "/bicycle/2/color");
  assert.equal(r.parent[r.key], "blue");
  const p2 = resolvePointer(store, "/store/bicycle/color");
  assert.equal(p2.parent[p2.key], "red");
  assert.equal(resolvePointer(bikeshop, "/bicycle/9/color"), null);
  assert.equal(resolvePointer(bikeshop, "/nope/x"), null);
  assert.equal(resolvePointer(bikeshop, ""), null); // pointer cannot address the root
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm run build 2>/dev/null; node --test test/json-path.test.mjs`
Expected: FAIL — `Cannot find module '../dist/json-path.js'`

- [ ] **Step 3: Implement `compiler/src/json-path.ts`**

```ts
// json-path.ts — dreem's JSONPath slash dialect (spec: docs/superpowers/specs/
// 2026-07-06-json-databinding-design.md, "Path dialect"). Pure functions,
// consumed by the compiler (validation/typing), the browser runtime
// (json-runtime.ts), and the server relay (pointer updates). ONE grammar,
// three consumers — they cannot disagree.

export class JsonPathError extends Error {}

export type Selector =
  | { kind: "wild" }
  | { kind: "index"; i: number }
  | { kind: "range"; start: number; end: number; step: number };
export interface PathSegment { prop: string; selectors: Selector[] }
export interface ParsedPath { dataset: string | null; segments: PathSegment[]; filter: boolean }

// $name, $name/..., $name[... — but NOT ${…}/$once{…} constraint syntax.
const ABS_RE = /^\$([A-Za-z_]\w*)([\/\[]|$)/;
export function isJsonAbsolutePath(s: string): boolean {
  const m = ABS_RE.exec(s);
  return !!m && !/^\$\w*\{/.test(s);
}

const INT_RE = /^-?\d+$/;

export function parsePath(path: string): ParsedPath {
  let dataset: string | null = null;
  let rest = path;
  if (path.startsWith("$")) {
    const m = /^\$([A-Za-z_]\w*)/.exec(path);
    if (!m) throw new JsonPathError(`bad dataset reference in "${path}"`);
    dataset = m[1];
    rest = path.slice(m[0].length);
  } else if (!path.startsWith("/")) {
    throw new JsonPathError(`path must be $dataset-absolute or /relative: "${path}"`);
  }
  const segments: PathSegment[] = [];
  let filter = false;
  if (rest !== "") {
    if (!rest.startsWith("/")) throw new JsonPathError(`expected "/" after dataset in "${path}"`);
    for (const seg of rest.slice(1).split("/")) {
      const m = /^([^\[\]]+)((?:\[[^\]]*\])*)$/.exec(seg);
      if (!m || m[1] === "") throw new JsonPathError(`empty or malformed segment in "${path}"`);
      const selectors: Selector[] = [];
      for (const [, body] of m[2].matchAll(/\[([^\]]*)\]/g)) {
        if (filter) throw new JsonPathError(`[@] must be terminal in "${path}"`);
        if (body === "*") selectors.push({ kind: "wild" });
        else if (body === "@") filter = true;
        else if (INT_RE.test(body)) selectors.push({ kind: "index", i: parseInt(body, 10) });
        else {
          const parts = body.split(",").map((s) => s.trim());
          if ((parts.length === 2 || parts.length === 3) && parts.every((p) => INT_RE.test(p)))
            selectors.push({ kind: "range", start: +parts[0], end: +parts[1], step: parts[2] != null ? +parts[2] : 1 });
          else throw new JsonPathError(`bad selector [${body}] in "${path}"`);
        }
      }
      segments.push({ prop: m[1], selectors });
    }
  }
  // trailing [@] with no property is not addressable in this dialect
  if (filter && segments.length === 0) throw new JsonPathError(`[@] needs a path in "${path}"`);
  return { dataset, segments, filter };
}

export function hasFanout(p: ParsedPath): boolean {
  return p.segments.some((s) => s.selectors.some((x) => x.kind !== "index"));
}

export function evaluatePath(
  root: unknown, p: ParsedPath,
  filterFn?: (obj: unknown, accum: unknown[]) => unknown[],
): unknown[] {
  if (root == null) return [];
  let cur: unknown[] = [root];
  for (const seg of p.segments) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (v == null || typeof v !== "object") continue;
      let vals: unknown[] = [(v as any)[seg.prop]];
      for (const sel of seg.selectors) {
        const out: unknown[] = [];
        for (const x of vals) {
          if (!Array.isArray(x)) continue;                    // selectors fan arrays only
          if (sel.kind === "wild") out.push(...x);
          else if (sel.kind === "index") { if (sel.i >= 0 && sel.i < x.length) out.push(x[sel.i]); }
          else if (sel.step > 0) for (let i = sel.start; i < sel.end && i < x.length; i += sel.step) out.push(x[i]);
        }
        vals = out;
      }
      for (const x of vals) if (x !== undefined) next.push(x);
    }
    cur = next;
  }
  if (p.filter && filterFn) {
    let accum: unknown[] = [];
    for (const obj of cur) accum = filterFn(obj, accum) ?? accum;
    return accum;
  }
  return cur;
}

/** Pointer paths (updateData / wire "update.path"): /prop or /int steps, no
 *  selectors, cannot address the root. Integer-looking steps index arrays and
 *  are plain keys otherwise. */
export function resolvePointer(root: unknown, pointer: string): { parent: any; key: string | number } | null {
  if (!pointer.startsWith("/")) return null;
  const steps = pointer.slice(1).split("/");
  if (steps.some((s) => s === "" || s.includes("[") || s.includes("]"))) return null;
  let parent: any = root;
  for (let i = 0; i < steps.length - 1; i++) {
    const k = Array.isArray(parent) && INT_RE.test(steps[i]) ? +steps[i] : steps[i];
    parent = parent == null ? undefined : parent[k];
  }
  if (parent == null || typeof parent !== "object") return null;
  const last = steps[steps.length - 1];
  const key = Array.isArray(parent) && INT_RE.test(last) ? +last : last;
  if (!(key in parent) && !(Array.isArray(parent) && typeof key === "number" && key >= 0 && key <= parent.length)) return null;
  return { parent, key };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: json-path tests PASS; all pre-existing tests PASS (parity guard).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-path.ts compiler/test/json-path.test.mjs
git commit -m "compiler: json-path — dreem slash-dialect parser/evaluator/pointer (shared core)"
```

---

### Task 2: `json-shape.ts` — shape inference, rendering, path walking

**Files:**
- Create: `compiler/src/json-shape.ts`
- Test: `compiler/test/json-shape.test.mjs`

**Interfaces:**
- Consumes: `ParsedPath` from `./json-path.js`.
- Produces (used by Task 8):
  - `type Shape = {kind:"prim"; name:"string"|"number"|"boolean"|"null"|"any"} | {kind:"obj"; props: Record<string,{shape:Shape; optional:boolean}>} | {kind:"arr"; elem: Shape|null} | {kind:"union"; members: Shape[]}`
  - `inferShape(v: unknown): Shape`
  - `renderShape(s: Shape): string` — TS type literal text
  - `walkShapePath(root: Shape, p: ParsedPath): { ok: Shape } | { error: string }`

- [ ] **Step 1: Write the failing tests**

`compiler/test/json-shape.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferShape, renderShape, walkShapePath } from "../dist/json-shape.js";
import { parsePath } from "../dist/json-path.js";

test("infer + render: primitives, objects, arrays", () => {
  assert.equal(renderShape(inferShape({ color: "red", price: 19.95, ok: true, n: null })),
    "{ color: string; price: number; ok: boolean; n: null }");
  assert.equal(renderShape(inferShape([1, 2])), "number[]");
  assert.equal(renderShape(inferShape([])), "any[]");
});

test("array unification: merged-optional + union (spec rule)", () => {
  // [{color},{price}] → {color?: string; price?: number}
  assert.equal(renderShape(inferShape([{ color: "red" }, { price: 1 }]).elem ?? inferShape(null)),
    "{ color?: string; price?: number }");
  // [{x:1},{x:null}] → {x: number | null}
  assert.equal(renderShape(inferShape([{ x: 1 }, { x: null }]).elem),
    "{ x: number | null }");
});

test("walk: happy path yields element shape", () => {
  const s = inferShape({ bicycle: [{ color: "red", price: 1 }] });
  const r = walkShapePath(s, parsePath("$b/bicycle[*]"));
  assert.ok("ok" in r);
  assert.equal(renderShape(r.ok), "{ color: string; price: number }");
  const r2 = walkShapePath(s, parsePath("$b/bicycle[*]/color"));
  assert.equal(renderShape(r2.ok), "string");
});

test("walk: unknown property and selector-on-non-array are errors", () => {
  const s = inferShape({ bicycle: [{ color: "red" }], lone: { x: 1 } });
  const r = walkShapePath(s, parsePath("$b/bike[*]"));
  assert.match(r.error, /unknown property "bike"/);
  const r2 = walkShapePath(s, parsePath("$b/lone[*]"));
  assert.match(r2.error, /"lone" is not an array/);
});

test("walk: any is a sink (empty-array elem, declared-any)", () => {
  const s = inferShape({ list: [] });
  const r = walkShapePath(s, parsePath("$b/list[*]/deep/deeper"));
  assert.ok("ok" in r);
  assert.equal(renderShape(r.ok), "any");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm run build 2>/dev/null; node --test test/json-shape.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compiler/src/json-shape.ts`**

```ts
// json-shape.ts — infer a TS-renderable Shape from a JSON literal, render it,
// and walk a ParsedPath over it (spec "Compile-time typing"). Array element
// shapes merge: properties absent from some elements become OPTIONAL,
// properties present with differing types UNION. `any` is the sink type
// (empty arrays, declared-shapeless datasets).

import type { ParsedPath } from "./json-path.js";

export type Shape =
  | { kind: "prim"; name: "string" | "number" | "boolean" | "null" | "any" }
  | { kind: "obj"; props: Record<string, { shape: Shape; optional: boolean }> }
  | { kind: "arr"; elem: Shape | null }
  | { kind: "union"; members: Shape[] };

const ANY: Shape = { kind: "prim", name: "any" };
const prim = (name: "string" | "number" | "boolean" | "null"): Shape => ({ kind: "prim", name });

export function inferShape(v: unknown): Shape {
  if (v === null) return prim("null");
  if (typeof v === "string") return prim("string");
  if (typeof v === "number") return prim("number");
  if (typeof v === "boolean") return prim("boolean");
  if (Array.isArray(v)) {
    if (v.length === 0) return { kind: "arr", elem: null };
    return { kind: "arr", elem: v.map(inferShape).reduce(unify) };
  }
  const props: Record<string, { shape: Shape; optional: boolean }> = {};
  for (const [k, val] of Object.entries(v as object)) props[k] = { shape: inferShape(val), optional: false };
  return { kind: "obj", props };
}

function shapeKey(s: Shape): string { return JSON.stringify(s); }

/** Merge two shapes: objects merge per-property (merged-optional), same-kind
 *  prims collapse, everything else unions (deduped). */
function unify(a: Shape, b: Shape): Shape {
  if (shapeKey(a) === shapeKey(b)) return a;
  if (a.kind === "obj" && b.kind === "obj") {
    const props: Record<string, { shape: Shape; optional: boolean }> = {};
    for (const k of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
      const pa = a.props[k], pb = b.props[k];
      if (pa && pb) props[k] = { shape: unify(pa.shape, pb.shape), optional: pa.optional || pb.optional };
      else props[k] = { shape: (pa ?? pb)!.shape, optional: true };
    }
    return { kind: "obj", props };
  }
  if (a.kind === "arr" && b.kind === "arr") {
    if (a.elem == null) return b;
    if (b.elem == null) return a;
    return { kind: "arr", elem: unify(a.elem, b.elem) };
  }
  const members = [...(a.kind === "union" ? a.members : [a]), ...(b.kind === "union" ? b.members : [b])];
  const seen = new Map<string, Shape>();
  for (const m of members) seen.set(shapeKey(m), m);
  const out = [...seen.values()];
  return out.length === 1 ? out[0] : { kind: "union", members: out };
}

export function renderShape(s: Shape): string {
  switch (s.kind) {
    case "prim": return s.name;
    case "arr": {
      const e = s.elem ? renderShape(s.elem) : "any";
      return s.elem?.kind === "union" ? `(${e})[]` : `${e}[]`;
    }
    case "union": return s.members.map(renderShape).join(" | ");
    case "obj": {
      const entries = Object.entries(s.props)
        .map(([k, p]) => `${k}${p.optional ? "?" : ""}: ${renderShape(p.shape)}`);
      return entries.length ? `{ ${entries.join("; ")} }` : "{}";
    }
  }
}

/** Walk a parsed path over a shape. Property steps require obj (or any/union
 *  containing obj); selectors require arr. `any` absorbs everything. */
export function walkShapePath(root: Shape, p: ParsedPath): { ok: Shape } | { error: string } {
  let cur = root;
  for (const seg of p.segments) {
    // property step
    const stepped = stepProp(cur, seg.prop);
    if ("error" in stepped) return stepped;
    cur = stepped.ok;
    // selectors
    for (const sel of seg.selectors) {
      if (cur.kind === "prim" && cur.name === "any") continue;
      if (cur.kind !== "arr") return { error: `"${seg.prop}" is not an array (selector [${sel.kind}] illegal)` };
      cur = cur.elem ?? ANY;
    }
  }
  return { ok: cur };
}

function stepProp(cur: Shape, prop: string): { ok: Shape } | { error: string } {
  if (cur.kind === "prim") return cur.name === "any" ? { ok: ANY } : { error: `cannot select "${prop}" from ${cur.name}` };
  if (cur.kind === "arr") return { error: `cannot select "${prop}" from an array (use a selector first)` };
  if (cur.kind === "union") {
    const hits: Shape[] = [];
    for (const m of cur.members) { const r = stepProp(m, prop); if ("ok" in r) hits.push(r.ok); }
    if (!hits.length) return { error: `unknown property "${prop}"` };
    return { ok: hits.reduce(unify) };
  }
  const p = cur.props[prop];
  if (!p) return { error: `unknown property "${prop}"` };
  return { ok: p.shape };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-shape.ts compiler/test/json-shape.test.mjs
git commit -m "compiler: json-shape — inference (merged-optional unification), rendering, path walking"
```

---

### Task 3: domsource — JSON datasets + `datapath` → `jsondatapath` renaming

**Files:**
- Modify: `compiler/src/domsource.ts`
- Test: `compiler/test/json-compile.test.mjs` (started here; grows in Task 4)

**Interfaces:**
- Consumes: `isJsonAbsolutePath` from `./json-path.js`.
- Produces (relied on by Tasks 4, 6): XmlElem output where
  - a `<dataset type="json">` keeps its JSON text as a single text child; `application/lz-shape` scripts are dropped (checker-only);
  - every JSON-dialect `datapath` is renamed to `jsondatapath` (absolute `$name…`, or relative under a JSON-bound ancestor);
  - JSON-bound elements and their subtrees are **never adopt-stamped** (template semantics — clones get fresh sprites; the authored template is removed by the bootstrap's cleanup()).

Rules implemented:
1. `<dataset type="json">` must be a direct child of `<laszlo-app>` (DomDialectError otherwise).
2. Inside it, `<script type="application/json">` → text child (verbatim); `<script type="application/lz-shape">` → dropped; other script types keep existing behavior (`application/xml` stays dataset-only for XML datasets).
3. `datapath` value classification: `isJsonAbsolutePath(v)` → json; else `v.startsWith("/") && ctx.jsonBound` → json; else classic (untouched). A `${…}` constraint value is never json (`isJsonAbsolutePath` excludes it).
4. An element with a **classic** datapath resets `ctx.jsonBound = false` for its subtree (nearest-bound-ancestor rule); a json one sets it true AND sets `inTemplate` for itself + subtree (no stamping).

- [ ] **Step 1: Write the failing tests**

`compiler/test/json-compile.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { el, text } from "./helpers/fakedom.mjs";

const app = (...children) => el("laszlo-app", {}, ...children);
const jsonDs = (name, json) => el("dataset", { name, type: "json" },
  el("script", { type: "application/json" }, text(json)));

test("json dataset: JSON body becomes a text child; lz-shape dropped", () => {
  const root = domToXmlElem(app(
    el("dataset", { name: "b", type: "json" },
      el("script", { type: "application/json" }, text('{"x":1}')),
      el("script", { type: "application/lz-shape" }, text("{ x: number }")))));
  const ds = root.children.find((c) => c.type === "elem" && c.name === "dataset");
  const texts = ds.children.filter((c) => c.type === "text" && c.value.trim() !== "");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].value, '{"x":1}');
});

test("json dataset: must be a direct child of laszlo-app", () => {
  assert.throws(() => domToXmlElem(app(el("view", {}, jsonDs("b", "{}")))), DomDialectError);
});

test("datapath renaming: absolute $ paths become jsondatapath", () => {
  const root = domToXmlElem(app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/list[*]" }, el("lz-text", { text: "${parent.data}" }))));
  const v = root.children.find((c) => c.type === "elem" && c.name === "view");
  assert.equal(v.attrs.jsondatapath, "$b/list[*]");
  assert.equal(v.attrs.datapath, undefined);
});

test("datapath renaming: relative under a JSON-bound ancestor; classic resets", () => {
  const root = domToXmlElem(app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/genres[*]" },
      el("view", { datapath: "/subgenres[*]" }),
      el("view", { datapath: "dset:/employee" },
        el("view", { datapath: "/child" })))));      // classic ancestor → classic
  const outer = root.children.find((c) => c.type === "elem" && c.name === "view");
  const [inner, classic] = outer.children.filter((c) => c.type === "elem");
  assert.equal(inner.attrs.jsondatapath, "/subgenres[*]");
  assert.equal(classic.attrs.datapath, "dset:/employee");
  const classicChild = classic.children.find((c) => c.type === "elem");
  assert.equal(classicChild.attrs.datapath, "/child");
  assert.equal(classicChild.attrs.jsondatapath, undefined);
});

test("constraint datapath is never json-renamed", () => {
  const root = domToXmlElem(app(el("view", { datapath: "${this.pathexpr}" })));
  const v = root.children.find((c) => c.type === "elem" && c.name === "view");
  assert.equal(v.attrs.datapath, "${this.pathexpr}");
});

test("json-bound subtrees are never adopt-stamped (template semantics)", () => {
  const live = app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/list[*]" }, el("view", {})),
    el("view", {}));
  domToXmlElem(live, { domAdopt: true });
  const [, bound, plain] = live.childNodes.filter((c) => c.nodeType === 1);
  assert.equal(bound.getAttribute("data-lz-adopt"), null);
  assert.equal(bound.childNodes[0].getAttribute("data-lz-adopt"), null);
  assert.notEqual(plain.getAttribute("data-lz-adopt"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: json-compile tests FAIL (no renaming, DomDialectError on application/json).

- [ ] **Step 3: Implement in `compiler/src/domsource.ts`**

Add the import at the top:

```ts
import { isJsonAbsolutePath } from "./json-path.js";
```

Extend `Ctx`:

```ts
interface Ctx {
  opts: DomSourceOptions;
  counter: { n: number };
  inTemplate: boolean;
  jsonBound: boolean;
}
```

(Also add `jsonBound: false` to the initial ctx in `domToXmlElem`.)

In `scriptNodes`, change the signature to `scriptNodes(el, parentName, ctx, parentIsJsonDataset: boolean)` and insert BEFORE the `application/xml` case:

```ts
  if (type === "application/json") {
    if (!parentIsJsonDataset)
      throw new DomDialectError('<script type="application/json"> is only valid inside <dataset type="json">');
    return [{ type: "text", value: textContentOf(el), cdata: false }];
  }
  if (type === "application/lz-shape") {
    if (!parentIsJsonDataset)
      throw new DomDialectError('<script type="application/lz-shape"> is only valid inside <dataset type="json">');
    return []; // checker-only (lzx-check reads it from the HTML directly); dropped from the compile
  }
```

In `walkElem`, after the attrs loop, classify the datapath and rename:

```ts
  // JSON databinding (spec 2026-07-06-json-databinding-design.md): decide the
  // datapath dialect STATICALLY and rename json ones to `jsondatapath` so the
  // LFC's XPath machinery never sees them. Classification: $name-absolute, or
  // /relative under a JSON-bound ancestor. A ${…} constraint is never json.
  let boundKind: "json" | "xpath" | null = null;
  const dp = attrs["datapath"];
  if (dp != null) {
    if (isJsonAbsolutePath(dp) || (dp.startsWith("/") && ctx.jsonBound)) {
      boundKind = "json";
      attrs["jsondatapath"] = dp;
      delete attrs["datapath"];
      attrOrder[attrOrder.indexOf("datapath")] = "jsondatapath";
    } else if (!/^\s*\$\w*\{/.test(dp)) boundKind = "xpath";
  }
```

Replace the `childCtx` computation with (keeping the template logic, adding json context — a json-bound element IS a template):

```ts
  const enterTemplate = !ctx.inTemplate && (NO_STAMP_SUBTREE.has(name) || boundKind === "json");
  const childCtx: Ctx = {
    ...ctx,
    inTemplate: ctx.inTemplate || enterTemplate,
    jsonBound: boundKind ? boundKind === "json" : ctx.jsonBound,
  };
```

Change the adopt-stamping condition so a json-bound element itself is not stamped:

```ts
  if (ctx.opts.domAdopt && !isRoot && !ctx.inTemplate && boundKind !== "json" && !NO_STAMP_TAGS.has(name)) {
```

Add the root-child rule in the children loop (next to the `<server>` rule), before the script/walk dispatch:

```ts
    if ((localName(ce) === "dataset" || localName(ce) === "lz-dataset") &&
        ce.getAttribute("type") === "json" && !isRoot)
      throw new DomDialectError('<dataset type="json"> must be a direct child of <laszlo-app>');
```

Update the `scriptNodes` call site to pass the flag:

```ts
    if (localName(ce) === "script") {
      children.push(...scriptNodes(ce, name, childCtx, name === "dataset" && attrs["type"] === "json"));
      if (isCodeParent) sawCarrier = true;
      continue;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS, including all pre-existing domsource tests (no behavior change without `type="json"`/JSON paths).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/domsource.ts compiler/test/json-compile.test.mjs
git commit -m "compiler: domsource json datasets + static datapath dialect routing (jsondatapath)"
```

---

### Task 4: compile — `compileJsonDataset` emission

**Files:**
- Modify: `compiler/src/compile.ts` (top-level child dispatch, currently `if (child.name === "dataset" && isLocalDataset(child))` around line 4085)
- Test: `compiler/test/json-compile.test.mjs` (extend)

**Interfaces:**
- Consumes: XmlElem trees (from parseXml or domToXmlElem).
- Produces (relied on by Tasks 5–7): app JS containing, at the dataset's document position, exactly:
  `lz.jsondata.register("<name>",{json:<JSON>});` or `{src:"<url>"}` / `{ws:"<url>"}` (ws chosen when the url matches `/^wss?:/`).
  `jsondatapath` needs **no** compile change: `attrType()` defaults unknown names to `"string"`, so it flows into the instantiation args as a plain string literal.

- [ ] **Step 1: Write the failing tests** (append to `compiler/test/json-compile.test.mjs`)

```js
import { compileInBrowser } from "../dist/browser.js";
import { parseXml } from "../dist/xml.js";

const fetch404 = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });

async function compileApp(xml) {
  const r = await compileInBrowser("http://t.test/app.html", { rootXml: parseXml(xml), fetchFn: fetch404, maxRetries: 5 });
  assert.equal(r.unsupported, undefined, r.unsupported);
  return r.js;
}

test("compile: inline json dataset emits lz.jsondata.register, no lzAddLocalData, no global", async () => {
  const js = await compileApp(
    '<canvas><dataset name="bikeshop" type="json">{"bicycle":[{"color":"red"}]}</dataset></canvas>');
  assert.ok(js.includes('lz.jsondata.register("bikeshop",{json:{"bicycle":[{"color":"red"}]}});'));
  assert.ok(!js.includes("lzAddLocalData"));
  assert.ok(!/var bikeshop/.test(js)); // no global binding — name "server" can never clobber the bus root
});

test("compile: src and ws datasets", async () => {
  const js = await compileApp(
    '<canvas><dataset name="a" type="json" src="./a.json"/><dataset name="s" type="json" src="ws://h/api/data"/></canvas>');
  assert.ok(js.includes('lz.jsondata.register("a",{src:"./a.json"});'));
  assert.ok(js.includes('lz.jsondata.register("s",{ws:"ws://h/api/data"});'));
});

test("compile: malformed inline JSON is a compile error naming the dataset", async () => {
  const r = await compileInBrowser("http://t.test/app.html", {
    rootXml: parseXml('<canvas><dataset name="bad" type="json">{oops}</dataset></canvas>'),
    fetchFn: fetch404, maxRetries: 5 });
  assert.match(r.unsupported ?? "", /dataset "bad".*JSON/);
});

test("compile: jsondatapath flows through as a plain string attr", async () => {
  const js = await compileApp(
    '<canvas><dataset name="b" type="json">{"l":[1]}</dataset><view jsondatapath="$b/l[*]"/></canvas>');
  assert.ok(js.includes('jsondatapath:"$b/l[*]"'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: new tests FAIL (`lzAddLocalData` emitted / XML parse of JSON content fails).

- [ ] **Step 3: Implement in `compiler/src/compile.ts`**

First extend the xml.js import at compile.ts:4 — `XmlText` is not currently
imported and the type predicate below needs it:

```ts
import { parseXml, XmlElem, XmlNode, XmlText } from "./xml.js";
```

Add next to `compileDataset` (~line 495):

```ts
/** A `<dataset type="json">` (spec 2026-07-06-json-databinding-design.md):
 *  registers with the json micro-runtime instead of lzAddLocalData. Emits NO
 *  global binding. Inline JSON is validated (and normalized) at compile time. */
function compileJsonDataset(el: XmlElem): string {
  const name = el.attrs["name"];
  if (!name) throw new Unsupported(`<dataset type="json"> without name`);
  const src = el.attrs["src"];
  if (src != null) {
    const kind = /^wss?:/.test(src) ? "ws" : "src";
    return `lz.jsondata.register(${jsString(name)},{${kind}:${jsString(src)}});`;
  }
  const text = el.children.filter((c): c is XmlText => c.type === "text").map((c) => c.value).join("");
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Unsupported(`dataset "${name}": invalid JSON — ${(e as Error).message}`); }
  return `lz.jsondata.register(${jsString(name)},{json:${JSON.stringify(parsed)}});`;
}
```

In the top-level dispatch, insert BEFORE the existing `child.name === "dataset" && isLocalDataset(child)` branch:

```ts
      if (child.name === "dataset" && child.attrs["type"] === "json") {
        if (DEBUG_STMTS) throw new Unsupported(`<dataset type="json"> in a debug build`);
        js += compileJsonDataset(child);
        continue;
      }
```

(Debug builds are the byte-parity .lzx path; JSON datasets are DOM-authored-only per spec — refusing is honest, silent miscompilation is not.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS, including every pre-existing compile/parity test.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/compile.ts compiler/test/json-compile.test.mjs
git commit -m "compiler: compileJsonDataset — lz.jsondata.register emission, bypassing lzAddLocalData"
```

---

### Task 5: json-runtime core — JsonDataset, registry, mutation, fetch source

**Files:**
- Create: `compiler/src/json-runtime.ts`
- Test: `compiler/test/json-runtime.test.mjs`

**Interfaces:**
- Consumes: `parsePath/evaluatePath/resolvePointer/hasFanout` from `./json-path.js`.
- Produces (used by Tasks 6, 7, 9, 12):
  - `interface WsLike { send(s: string): void; close(): void; onopen: (() => void) | null; onmessage: ((ev: {data: string}) => void) | null; onclose: (() => void) | null }`
  - `interface RuntimeHost { lzNodeProto: any; warn(msg: string): void; fetchFn?: (url: string) => Promise<{ok: boolean; status: number; json(): Promise<any>}>; makeSocket?: (url: string) => WsLike; setTimeoutFn?: (cb: () => void, ms: number) => any; globals?: any }`
  - `class JsonDataset { name: string; data: any; ready: boolean; onData(cb): void; offData(cb): void; onError(cb): void; setData(v): void; updateData(pointer: string, value: any): boolean; toLzDataset(name?, opts?): any /* Task 12 */ }`
  - `class JsonRegistry { register(name, init: {json?: any; src?: string; ws?: string}, shape?: string): JsonDataset; get(name): JsonDataset | undefined; whenRegistered(name, cb: (ds: JsonDataset) => void): void }`
  - `installJsonRuntime(host: RuntimeHost): JsonRegistry` (Task 5 installs registry + sources; Task 6 adds the createChildren wrap)

- [ ] **Step 1: Write the failing tests**

`compiler/test/json-runtime.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { installJsonRuntime } from "../dist/json-runtime.js";

export function makeHost(over = {}) {
  const warnings = [];
  return {
    warnings,
    lzNodeProto: {},
    warn: (m) => warnings.push(m),
    setTimeoutFn: (cb) => { cb(); },   // immediate for tests
    ...over,
  };
}

test("register inline: data ready immediately; ondata fires on setData/updateData", () => {
  const jd = installJsonRuntime(makeHost());
  const ds = jd.register("b", { json: { list: [1, 2] } });
  assert.equal(ds.ready, true);
  const seen = [];
  ds.onData(() => seen.push(structuredClone(ds.data)));
  ds.updateData("/list/0", 9);
  assert.deepEqual(ds.data.list, [9, 2]);
  ds.setData({ list: [] });
  assert.equal(seen.length, 2);
});

test("updateData: unresolvable pointer warns, no mutation, no event", () => {
  const host = makeHost();
  const jd = installJsonRuntime(host);
  const ds = jd.register("b", { json: { x: 1 } });
  let fired = 0;
  ds.onData(() => fired++);
  assert.equal(ds.updateData("/nope/deep", 5), false);
  assert.equal(fired, 0);
  assert.equal(host.warnings.length, 1);
});

test("whenRegistered: fires immediately when present, later on register", () => {
  const jd = installJsonRuntime(makeHost());
  const order = [];
  jd.whenRegistered("later", () => order.push("later"));
  jd.register("now", { json: 1 });
  jd.whenRegistered("now", () => order.push("now"));
  jd.register("later", { json: 2 });
  assert.deepEqual(order, ["now", "later"]);
});

test("fetch source: ok sets data; failure fires onError", async () => {
  const okHost = makeHost({ fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ v: 42 }) }) });
  const ds = installJsonRuntime(okHost).register("a", { src: "./a.json" });
  await new Promise((r) => ds.onData(r));
  assert.equal(ds.data.v, 42);

  const errs = [];
  const badHost = makeHost({ fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const ds2 = installJsonRuntime(badHost).register("a", { src: "./a.json" });
  ds2.onError((m) => errs.push(m));
  await new Promise((r) => setImmediate(r));
  assert.equal(errs.length, 1);
  assert.equal(ds2.ready, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compiler/src/json-runtime.ts`** (core only; the ReplicationManager arrives in Task 6, the ws source in Task 9, the bridge in Task 12)

```ts
// json-runtime.ts — the JSON databinding micro-runtime (spec: docs/superpowers/
// specs/2026-07-06-json-databinding-design.md, "Runtime components"). Authored
// here so the parser is shared with the compiler; bundled to
// startup/lz-json-data.js (IIFE) by `npm run bundle:jsondata` and prepended to
// the app blob by laszlo-dom.js. Every environment touchpoint (LzNode
// prototype, fetch, WebSocket, timers, window globals) is injected via
// RuntimeHost so the whole runtime is node-testable.

import { parsePath, evaluatePath, resolvePointer, hasFanout, ParsedPath, JsonPathError } from "./json-path.js";

export interface WsLike {
  send(s: string): void; close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}
export interface RuntimeHost {
  lzNodeProto: any;
  warn(msg: string): void;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  makeSocket?: (url: string) => WsLike;
  setTimeoutFn?: (cb: () => void, ms: number) => any;
  globals?: any; // window-ish: lz, canvas, LzDataElement (bridge)
}

export class JsonDataset {
  data: any = null;
  ready = false;
  private dataCbs = new Set<() => void>();
  private errCbs = new Set<(msg: string) => void>();
  constructor(public name: string, private host: RuntimeHost, public shape?: string) {}
  onData(cb: () => void): void { this.dataCbs.add(cb); }
  offData(cb: () => void): void { this.dataCbs.delete(cb); }
  onError(cb: (msg: string) => void): void { this.errCbs.add(cb); }
  fireError(msg: string): void { this.host.warn(`dataset "${this.name}": ${msg}`); for (const cb of [...this.errCbs]) cb(msg); }
  setData(v: any): void { this.data = v; this.ready = true; for (const cb of [...this.dataCbs]) cb(); }
  updateData(pointer: string, value: any): boolean {
    const r = resolvePointer(this.data, pointer);
    if (!r) { this.host.warn(`dataset "${this.name}": updateData("${pointer}") resolves nothing`); return false; }
    r.parent[r.key] = value;
    for (const cb of [...this.dataCbs]) cb();
    return true;
  }
  // toLzDataset(name?, opts?) — Task 12
}

export class JsonRegistry {
  private datasets = new Map<string, JsonDataset>();
  private pending = new Map<string, Array<(ds: JsonDataset) => void>>();
  constructor(private host: RuntimeHost) {}
  get(name: string): JsonDataset | undefined { return this.datasets.get(name); }
  whenRegistered(name: string, cb: (ds: JsonDataset) => void): void {
    const ds = this.datasets.get(name);
    if (ds) { cb(ds); return; }
    const q = this.pending.get(name) ?? [];
    q.push(cb);
    this.pending.set(name, q);
  }
  register(name: string, init: { json?: any; src?: string; ws?: string }, shape?: string): JsonDataset {
    const ds = new JsonDataset(name, this.host, shape);
    this.datasets.set(name, ds);
    if ("json" in init) ds.setData(init.json);
    else if (init.src != null) this.fetchInto(ds, init.src);
    else if (init.ws != null) this.liveInto(ds, init.ws); // Task 9
    for (const cb of this.pending.get(name) ?? []) cb(ds);
    this.pending.delete(name);
    return ds;
  }
  private fetchInto(ds: JsonDataset, url: string): void {
    const f = this.host.fetchFn;
    if (!f) { ds.fireError("no fetch available"); return; }
    f(url).then(
      async (res) => {
        if (!res.ok) { ds.fireError(`fetch ${url} → ${res.status}`); return; }
        try { ds.setData(await res.json()); } catch (e) { ds.fireError(`bad JSON from ${url}: ${(e as Error).message}`); }
      },
      (e) => ds.fireError(`fetch ${url} failed: ${(e as Error).message}`));
  }
  private liveInto(ds: JsonDataset, url: string): void {
    ds.fireError("ws source not built yet"); // replaced in Task 9
  }
}

export function installJsonRuntime(host: RuntimeHost): JsonRegistry {
  const reg = new JsonRegistry(host);
  // Task 6 wraps host.lzNodeProto.createChildren here.
  return reg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-runtime.ts compiler/test/json-runtime.test.mjs
git commit -m "runtime: json-runtime core — JsonDataset registry, mutation API, fetch source (host-injected)"
```

---

### Task 6: json-runtime replication — makeChild interception + reconcile

**Files:**
- Modify: `compiler/src/json-runtime.ts`
- Test: `compiler/test/json-runtime.test.mjs` (extend)

**Why `makeChild`, not `createChildren` (load-bearing):** the LFC's default
instantiation is IDLE-QUEUED — `createChildren` dispatches to
`lz.Instantiator.requestInstantiation` (LzNode.lzs:1387-1400), which queues and
returns; the queue drains later in idle ticks calling
`parent.makeChild(spec, true)` (LzInstantiator.lzs:299). So (a) nothing is in
`subnodes` when `createChildren` returns — scan-based clone tracking finds
nothing; and (b) canvas-level children NEVER pass through `createChildren`
(they go `LzInstantiateView` → `initDone` → `requestInstantiation(canvas, …)` →
`makeChild`, LaszloCanvas.lzs:671-691). `makeChild` is the universal funnel at
every level and RETURNS the constructed node (LzNode.lzs:1449-1477) — clone
tracking is its return value. Clones the manager creates via the original
`makeChild(spec)` (no `async` arg → `__LZisnew = true` → subtree instantiates
synchronously via `createImmediate`, LzInstantiator syncNew).

**Interfaces:**
- Consumes: Task 5's registry; child specs shaped `{class, attrs, children}` (what `emitSpec` compiles, compile.ts:941-949; `makeChild` reads `e['class']`, `e.attrs`, `e.children`, LzNode.lzs:1449-1477). The LFC mutates the attrs object it is handed (`$lzc$bind_id`, `delete iargs["$datapath"]`) — the manager spread-copies attrs per clone, so specs stay reusable.
- Produces:
  - `installJsonRuntime` wraps `host.lzNodeProto.makeChild(e, async)`: a spec with a string `e.attrs.jsondatapath` is diverted to a `ReplicationManager` (returns `null`); everything else passes through to the original.
  - `export class ReplicationManager { clones: any[]; refresh(): void }` — clone attrs get `data`, `clonenumber`, `cloneManager` (construction attrs); `jsondatapath` removed. Clones are the original `makeChild`'s return values. Default destroy/recreate; `pooling` (`true`/`"true"`) reuses by index, hides surplus (`setAttribute("visible", false)`). After reconcile, fires the parent's `onclones` event if one exists (`parent.onclones.sendEvent(clones)` guarded).
  - Relative paths evaluate against the nearest ancestor (walking `immediateparent`) where `data != null`.
  - Zero matches → zero clones. Unknown dataset → warn once, bind on later registration. Parent destroyed (`__LZdeleted`) → unbind.
  - Known corner (document in a code comment, don't solve): a bound view with `initstage="defer"` replicates when the deferred spec finally drains through `makeChild` — replication timing follows the LFC queue, by design.
  - Known limitation (spec rev 4): nested relative bindings inside a POOLED (reused) clone do not re-evaluate on datum swap; the default destroy/recreate path rebuilds them correctly.

- [ ] **Step 1: Write the failing tests** (append; note the fake-LFC harness)

```js
// ── replication harness: a minimal LzNode-ish fake that MODELS THE QUEUE ──
// The real LFC idle-queues instantiation: createChildren enqueues; the
// instantiator later calls parent.makeChild(spec, true) per spec; makeChild
// constructs synchronously and RETURNS the node. Mirroring that here pins the
// contract the runtime actually relies on — a synchronous fake would pass with
// broken scan-based tracking.
function makeFakeLfc() {
  const queue = [];
  const proto = {
    makeChild(e, _async) {
      const node = { __proto__: proto, __LZdeleted: false, destroyed: false, subnodes: [], immediateparent: this };
      for (const [k, v] of Object.entries(e.attrs ?? {})) node[k] = v;
      node.setAttribute = function (n, v) { this[n] = v; (this.sets ??= []).push([n, v]); };
      node.destroy = function () { this.destroyed = true; this.__LZdeleted = true; this.immediateparent.subnodes = this.immediateparent.subnodes.filter((s) => s !== this); };
      this.subnodes.push(node);
      for (const c of e.children ?? []) node.makeChild(c, true); // subtree: same funnel, sync (createImmediate-like)
      return node;
    },
    createChildren(carr) { for (const spec of carr ?? []) queue.push([this, spec]); }, // idle-queued
  };
  const root = { __proto__: proto, __LZdeleted: false, subnodes: [], immediateparent: null };
  root.setAttribute = function (n, v) { this[n] = v; };
  const drain = () => { while (queue.length) { const [parent, spec] = queue.shift(); parent.makeChild(spec, true); } };
  return { proto, root, drain };
}

test("replication: nothing before the queue drains; N tracked clones after (makeChild return values)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  jd.register("b", { json: { bicycle: [{ color: "red" }, { color: "green" }] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/bicycle[*]", height: 20 } }]);
  assert.equal(root.subnodes.length, 0);          // queued, not instantiated — the real-LFC contract
  drain();
  assert.equal(root.subnodes.length, 2);
  assert.equal(root.subnodes[0].cloneManager.clones.length, 2); // tracked via return values, no scan
  assert.deepEqual(root.subnodes.map((n) => n.data.color), ["red", "green"]);
  assert.deepEqual(root.subnodes.map((n) => n.clonenumber), [0, 1]);
  assert.equal(root.subnodes[0].jsondatapath, undefined);
  assert.equal(root.subnodes[0].height, 20);
  assert.ok(root.subnodes[0].cloneManager);
});

test("canvas-level bound view: diverted at makeChild directly (the LzInstantiator call shape)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { l: ["x", "y"] } });
  const ret = root.makeChild({ class: "view", attrs: { jsondatapath: "$b/l[*]" } }, true);
  assert.equal(ret, null);                        // diverted spec constructs no view itself
  assert.equal(root.subnodes.length, 2);          // …but its clones do, synchronously via origMakeChild
  assert.deepEqual(root.subnodes.map((n) => n.data), ["x", "y"]);
});

test("reconcile default: destroy + recreate on ondata; zero matches → zero clones", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: [1, 2, 3] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]" } }]);
  drain();
  const first = [...root.subnodes];
  ds.setData({ l: [7] });
  assert.ok(first.every((n) => n.destroyed));
  assert.equal(root.subnodes.length, 1);
  assert.equal(root.subnodes[0].data, 7);
  ds.setData({ l: [] });
  assert.equal(root.subnodes.length, 0);
});

test("reconcile pooling=true: reuse by index, hide surplus, grow shortfall", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: ["a", "b", "c"] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]", pooling: true } }]);
  drain();
  const first = [...root.subnodes];
  ds.setData({ l: ["x"] });
  assert.equal(first[0].destroyed, false);
  assert.equal(first[0].data, "x");
  assert.equal(first[1].visible, false);          // hidden, not destroyed
  ds.setData({ l: ["p", "q", "r", "s"] });
  assert.equal(root.subnodes.filter((n) => n.visible !== false).length, 4);
  assert.equal(first[1].visible, true);            // resurrected from the pool
});

test("relative path binds against nearest ancestor datum (nested replication)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("g", { json: { genres: [{ name: "jazz", sub: ["cool", "free"] }] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$g/genres[*]" },
    children: [{ class: "view", attrs: { jsondatapath: "/sub[*]" } }] }]);
  drain();
  const outer = root.subnodes[0];
  assert.deepEqual(outer.subnodes.map((n) => n.data), ["cool", "free"]);
});

test("single non-fanout match binds one view; unknown dataset warns then binds on register", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$late/title" } }]);
  drain();
  assert.equal(root.subnodes.length, 0);
  assert.equal(host.warnings.length, 1);
  jd.register("late", { json: { title: "hi" } });
  assert.equal(root.subnodes.length, 1);
  assert.equal(root.subnodes[0].data, "hi");
});

test("onclones fires on the parent when an event exists; destroyed parent unbinds", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: [1] } });
  const clonesSeen = [];
  root.onclones = { sendEvent: (c) => clonesSeen.push(c.length) };
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]" } }]);
  drain();
  assert.deepEqual(clonesSeen, [1]);
  root.__LZdeleted = true;
  ds.setData({ l: [1, 2] });
  assert.deepEqual(clonesSeen, [1]);              // no refresh after parent death
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: replication tests FAIL (without the makeChild wrap, the drained spec instantiates ONCE with `jsondatapath` still set — no clones, no diversion).

- [ ] **Step 3: Implement** — append to `compiler/src/json-runtime.ts` and wire into `installJsonRuntime`:

```ts
/** Implicit replication over a JSON-dialect datapath (spec "Replication").
 *  Diverted child specs never reach the LFC's XPath machinery. */
export class ReplicationManager {
  clones: any[] = [];
  private parsed: ParsedPath | null = null;
  private ds: JsonDataset | null = null;
  private refreshCb = () => this.refresh();
  constructor(
    private reg: JsonRegistry, private host: RuntimeHost,
    private parent: any, private spec: any, private path: string,
    private origMake: (e: any, async?: any) => any,
  ) {
    try { this.parsed = parsePath(path); }
    catch (e) { host.warn(`jsondatapath "${path}": ${(e as JsonPathError).message}`); return; }
    if (this.parsed.dataset != null) {
      if (!reg.get(this.parsed.dataset))
        host.warn(`jsondatapath "${path}": unknown dataset "$${this.parsed.dataset}" (binds when registered)`);
      reg.whenRegistered(this.parsed.dataset, (ds) => { this.ds = ds; ds.onData(this.refreshCb); this.refresh(); });
    } else {
      this.refresh(); // relative: context datum is already constructed on an ancestor
      // relative rebinds arrive as full re-replication of the ancestor (destroy/recreate)
    }
  }
  private contextValue(): unknown {
    if (this.parsed!.dataset != null) return this.ds ? this.ds.data : null;
    for (let n = this.parent; n; n = n.immediateparent) if (n.data != null) return n.data;
    return null;
  }
  private matches(): unknown[] {
    const filterFn = this.parsed!.filter ? this.filterFn() : undefined; // Task 11
    return evaluatePath(this.contextValue(), this.parsed!, filterFn);
  }
  private filterFn(): ((obj: unknown, accum: unknown[]) => unknown[]) | undefined {
    return undefined; // Task 11
  }
  refresh(): void {
    if (this.parent.__LZdeleted) { if (this.ds) this.ds.offData(this.refreshCb); return; }
    const m = this.sorted(this.matches()); // sorted() is identity until Task 11
    const pooling = this.spec.attrs?.pooling === true || this.spec.attrs?.pooling === "true";
    if (!pooling) {
      for (const c of this.clones) if (!c.__LZdeleted) c.destroy();
      this.clones = [];
      this.create(m, 0);
    } else {
      const live = this.clones.filter((c) => !c.__LZdeleted);
      const reuse = Math.min(live.length, m.length);
      for (let i = 0; i < reuse; i++) {
        if (live[i].visible === false) live[i].setAttribute("visible", true);
        live[i].setAttribute("clonenumber", i);
        live[i].setAttribute("data", m[i]);
      }
      for (let i = m.length; i < live.length; i++) live[i].setAttribute("visible", false);
      this.clones = live;
      if (m.length > live.length) this.create(m.slice(live.length), live.length);
    }
    const ev = this.parent.onclones;
    if (ev && typeof ev.sendEvent === "function") ev.sendEvent(this.clones);
  }
  private create(datums: unknown[], base: number): void {
    for (let i = 0; i < datums.length; i++) {
      const datum = datums[i];
      if (isLzDataNode(datum)) { this.host.warn(`jsondatapath "${this.path}": LzDataElement datum refused (use the bridge one-way)`); continue; }
      const attrs = { ...this.spec.attrs, data: datum, clonenumber: base + i, cloneManager: this };
      delete attrs.jsondatapath;
      // No async arg: __LZisnew=true → the clone's own subtree instantiates
      // synchronously (createImmediate / syncNew). makeChild RETURNS the node —
      // that return value IS the clone tracking (the LFC's default path is
      // idle-queued, so scanning subnodes after the fact finds nothing).
      const node = this.origMake.call(this.parent, { ...this.spec, attrs });
      if (node) this.clones.push(node);
    }
  }
  private sorted(m: unknown[]): unknown[] { return m; } // Task 11
}

/** Duck-check for LFC data nodes (LzDataElement/LzDataText) without importing
 *  the LFC: the $lzc$set_data setter would instantiate a classic LzDatapath on
 *  anything that IS one — the guard keeps that branch unreachable. */
function isLzDataNode(v: unknown): boolean {
  return !!v && typeof v === "object" &&
    typeof (v as any).appendChild === "function" && "ownerDocument" in (v as any);
}
```

Replace `installJsonRuntime`:

```ts
export function installJsonRuntime(host: RuntimeHost): JsonRegistry {
  const reg = new JsonRegistry(host);
  // makeChild is the LFC's universal instantiation funnel (LzInstantiator calls
  // parent.makeChild(spec, true) for every queued spec at every level,
  // including canvas children). Wrapping createChildren would miss canvas-level
  // bound views entirely and could not track idle-queued clones.
  const orig = host.lzNodeProto.makeChild;
  host.lzNodeProto.makeChild = function (e: any, async?: any) {
    const p = e && e.attrs && e.attrs.jsondatapath;
    if (typeof p === "string") { new ReplicationManager(reg, host, this, e, p, orig); return null; }
    return orig.call(this, e, async);
  };
  return reg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-runtime.ts compiler/test/json-runtime.test.mjs
git commit -m "runtime: replication manager — createChildren interception, destroy/recreate + pooled reconcile, nesting"
```

---

### Task 7: bundle + bootstrap wiring + bikeshop demo

**Files:**
- Create: `compiler/src/json-runtime-entry.ts`
- Modify: `compiler/package.json` (scripts), `startup/laszlo-dom.js` (blob assembly)
- Create: `examples/dom-authoring/bikeshop-demo.html`
- Generate: `startup/lz-json-data.js`, refreshed `compiler/lzc-browser.js` (committed artifacts)

**Interfaces:**
- Consumes: `installJsonRuntime` (Task 6); the blob assembly at `startup/laszlo-dom.js:118` (`new Blob([prelude, patch, "\n", r.js])`).
- Produces: `window.lz.jsondata` (a `JsonRegistry`) installed after the LFC and the adopt patch, before app JS — the composed order is `[busPrelude, adoptPatch, "\n", lz-json-data, "\n", appJs]`, defined ONLY here.

- [ ] **Step 1: Write `compiler/src/json-runtime-entry.ts`**

```ts
// json-runtime-entry.ts — IIFE entry for startup/lz-json-data.js (built by
// `npm run bundle:jsondata`). Prepended to the app blob by laszlo-dom.js when
// the app declares <dataset type="json">: after the LFC and the adopt patch,
// before the app JS — so LzNode exists and no view has been constructed yet.

import { installJsonRuntime } from "./json-runtime.js";

const g = window as any;
if (typeof g.LzNode !== "undefined" && g.lz && !g.lz.jsondata) {
  g.lz.jsondata = installJsonRuntime({
    lzNodeProto: g.LzNode.prototype,
    warn: (m: string) => console.warn("[lz-json]", m),
    fetchFn: (u: string) => fetch(u),
    makeSocket: (u: string) => new WebSocket(u) as any,
    setTimeoutFn: (cb: () => void, ms: number) => setTimeout(cb, ms),
    globals: g,
  });
}
```

- [ ] **Step 2: Add the bundle script** — in `compiler/package.json` scripts:

```json
    "bundle:jsondata": "npx esbuild dist/json-runtime-entry.js --bundle --format=iife --platform=browser --minify --outfile=../startup/lz-json-data.js",
```

and extend `dist`:

```json
    "dist": "npm run build && npm run bundle:browser && npm run bundle:lzts && npm run bundle:jsondata",
```

- [ ] **Step 3: Wire the bootstrap** — in `startup/laszlo-dom.js`, after the transpileTs block (line ~93), add:

```js
  // JSON databinding (spec 2026-07-06-json-databinding-design.md): include the
  // micro-runtime in the app blob when the app declares json datasets. Order is
  // a relative constraint: after the LFC + adopt patch, before the app JS.
  let jsonRt = "";
  if (host.querySelector('dataset[type="json"],lz-dataset[type="json"]')) {
    jsonRt = (await (await fetch(new URL("lz-json-data.js", HERE))).text()) + "\n";
  }
```

and change the blob line to:

```js
  const appUrl = URL.createObjectURL(new Blob([prelude, patch, "\n", jsonRt, r.js], { type: "text/javascript" }));
```

- [ ] **Step 4: Rebuild artifacts**

Run: `cd compiler && npm run dist`
Expected: `startup/lz-json-data.js` created; `lzc-browser.js` refreshed (carries the domsource/compile changes); `npm test` still green.

- [ ] **Step 5: Write the demo** — `examples/dom-authoring/bikeshop-demo.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>JSON databinding — bikeshop</title>
  <script type="module" src="../../startup/laszlo-dom.js"></script>
</head>
<body>
<laszlo-app height="300" bgcolor="#f7f7f7">
  <dataset name="bikeshop" type="json">
    <script type="application/json">
      { "bicycle": [
        { "color": "red",   "price": 19.95 },
        { "color": "green", "price": 29.95 },
        { "color": "blue",  "price": 59.95 } ] }
    </script>
  </dataset>

  <lz-view x="10" y="10">
    <simplelayout axis="y" spacing="4"></simplelayout>
    <lz-view datapath="$bikeshop/bicycle[*]" height="18">
      <lz-text text="${parent.data.color + ' — $' + parent.data.price}"
               fgcolor="${parent.data.price > 20 ? '#999999' : '#000000'}"></lz-text>
    </lz-view>
  </lz-view>

  <lz-view x="10" y="120" width="140" height="22" bgcolor="#dddddd">
    <lz-text text="sale: first bike $9.99" x="4" y="3"></lz-text>
    <handler name="onclick">
      lz.jsondata.get('bikeshop').updateData('/bicycle/0/price', 9.99);
    </handler>
  </lz-view>
</laszlo-app>
</body>
</html>
```

- [ ] **Step 6: Verify in the running server**

Run: `node server/index.mjs 8090 &` then load `http://localhost:8090/examples/dom-authoring/bikeshop-demo.html` (browser or `mcp playwright`).
Expected: three replicated rows; clicking the button re-renders row 1 at $9.99 in black. Kill the server after.

- [ ] **Step 7: Commit**

```bash
git add compiler/src/json-runtime-entry.ts compiler/package.json startup/laszlo-dom.js \
        startup/lz-json-data.js compiler/lzc-browser.js examples/dom-authoring/bikeshop-demo.html
git commit -m "runtime: lz-json-data bundle + bootstrap blob wiring; bikeshop demo (inline + updateData)"
```

---

### Task 8: lzx-check typing — shapes, path validation, typed `data`

**Files:**
- Modify: `compiler/src/app-model.ts`, `compiler/src/app-dts.ts`
- Test: `compiler/test/json-check.test.mjs`

**Interfaces:**
- Consumes: `parsePath/isJsonAbsolutePath/JsonPathError` (Task 1), `inferShape/renderShape/walkShapePath/Shape` (Task 2), the existing extractApp walk + generateAppDts.
- Produces:
  - `AppModel.jsonDatasets: { name: string; rootType: string; shape: import("./json-shape.js").Shape | null; line: number }[]`
  - Bound instances gain `attrs` entries `data: <elem type>` and `clonenumber: number`; `ownerMembers` gains `data`/`clonenumber`.
  - `generateAppDts` emits `type __LzShape_<name> = <declared literal>;` per lz-shape dataset.
  - Static findings: JsonPathError, unknown dataset, unknown property / non-array selector (inline shapes only), malformed inline JSON.
  - `walkInstance` decides the dialect with the SAME rule as domsource (absolute via `isJsonAbsolutePath`; relative iff nearest datapath-bound ancestor is JSON-bound — carried via a `jsonCtx` parameter).

- [ ] **Step 1: Write the failing tests**

`compiler/test/json-check.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApp } from "../dist/lzx-check.js";

const wrap = (body) => `<!doctype html><html><body><laszlo-app>${body}</laszlo-app></body></html>`;
const DS = `<dataset name="bikeshop" type="json"><script type="application/json">
  { "bicycle": [ { "color": "red", "price": 19.95 } ] }
</script></dataset>`;

test("typed data: valid member checks clean; typo is TS2339 on the constraint line", () => {
  const ok = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[*]">
      <lz-text text="\${parent.data.color}"></lz-text></lz-view>`), "app.html");
  assert.deepEqual(ok.findings, []);

  const bad = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[*]">
      <lz-text text="\${parent.data.colour}"></lz-text></lz-view>`), "app.html");
  assert.equal(bad.findings.length, 1);
  assert.equal(bad.findings[0].code, 2339);
  assert.match(bad.findings[0].message, /colour/);
});

test("path validation: unknown dataset, unknown property, selector on non-array", () => {
  const r1 = checkApp(wrap(`${DS}<lz-view datapath="$nope/x[*]"></lz-view>`), "app.html");
  assert.match(r1.findings[0].message, /unknown dataset "\$nope"/);
  const r2 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bike[*]"></lz-view>`), "app.html");
  assert.match(r2.findings[0].message, /unknown property "bike"/);
  const r3 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[0]/color[*]"></lz-view>`), "app.html");
  assert.match(r3.findings[0].message, /not an array/);
});

test("malformed inline JSON and bad path syntax are findings with lines", () => {
  const r = checkApp(wrap(`<dataset name="bad" type="json"><script type="application/json">{oops}</script></dataset>`), "app.html");
  assert.match(r.findings[0].message, /invalid JSON/);
  assert.ok(r.findings[0].line > 0);
  const r2 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop//x"></lz-view>`), "app.html");
  assert.match(r2.findings[0].message, /segment/);
});

test("relative datapath types against the ancestor datum; classic XPath untouched", () => {
  const nested = checkApp(wrap(`<dataset name="g" type="json"><script type="application/json">
      {"genres":[{"name":"jazz","sub":[{"label":"cool"}]}]}
    </script></dataset>
    <lz-view datapath="$g/genres[*]">
      <lz-view datapath="/sub[*]"><lz-text text="\${parent.data.label}"></lz-text></lz-view>
    </lz-view>`), "app.html");
  assert.deepEqual(nested.findings, []);
  const classic = checkApp(wrap(`<lz-view datapath="dset:/employee"></lz-view>`), "app.html");
  assert.deepEqual(classic.findings, []);
});

test("lz-shape dataset: declared TS literal types data via __LzShape alias", () => {
  const app = wrap(`<dataset name="sensors" type="json" src="ws://h/api/data">
      <script type="application/lz-shape">{ temp: number, readings: number[] }</script>
    </dataset>
    <lz-view datapath="$sensors"><lz-text text="\${parent.data.temp.toFixed(1)}"></lz-text></lz-view>`);
  assert.deepEqual(checkApp(app, "app.html").findings, []);
  const bad = wrap(`<dataset name="sensors" type="json" src="ws://h/api/data">
      <script type="application/lz-shape">{ temp: number }</script>
    </dataset>
    <lz-view datapath="$sensors"><lz-text text="\${parent.data.temperature}"></lz-text></lz-view>`);
  assert.equal(checkApp(bad, "app.html").findings[0].code, 2339);
});

test("shapeless src dataset types data as any (no findings either way)", () => {
  const app = wrap(`<dataset name="x" type="json" src="./x.json"></dataset>
    <lz-view datapath="$x/whatever[*]"><lz-text text="\${parent.data.anything}"></lz-text></lz-view>`);
  assert.deepEqual(checkApp(app, "app.html").findings, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: FAIL (no dataset shapes; `$nope/x[*]` produces no finding; TS2339 not raised because `data` types as the base-class `any`).

- [ ] **Step 3: Implement**

In `compiler/src/app-model.ts`, add imports and the model field:

```ts
import { parsePath, isJsonAbsolutePath, JsonPathError, ParsedPath } from "./json-path.js";
import { inferShape, renderShape, walkShapePath, Shape } from "./json-shape.js";

export interface JsonDatasetModel { name: string; rootType: string; shape: Shape | null; line: number }
// AppModel gains:
//   jsonDatasets: JsonDatasetModel[];
```

(Add `jsonDatasets: []` to the model initializer.)

In `extractApp`, BEFORE `walkInstance(root, …)`, collect root-level json datasets:

```ts
  for (const c of elemChildren(root)) {
    if (c.tagName.toLowerCase() !== "dataset" || c.getAttribute("type") !== "json") continue;
    const name = c.getAttribute("name") ?? "";
    if (!checkName("dataset", name, c.line)) continue;
    const scripts = elemChildren(c).filter((s) => s.tagName === "SCRIPT");
    const jsonEl = scripts.find((s) => (s.getAttribute("type") ?? "").toLowerCase() === "application/json");
    const shapeEl = scripts.find((s) => (s.getAttribute("type") ?? "").toLowerCase() === "application/lz-shape");
    let shape: Shape | null = null;
    let rootType = "any";
    if (jsonEl) {
      const { code, line } = textOf(jsonEl);
      try { shape = inferShape(JSON.parse(code)); rootType = renderShape(shape); }
      catch (e) { model.staticIssues.push({ message: `dataset "${name}": invalid JSON — ${(e as Error).message}`, line }); }
    } else if (shapeEl) {
      rootType = `__LzShape_${name}`;   // declared literal, emitted as a type alias
    }
    model.jsonDatasets.push({ name, rootType, shape, line: c.line });
  }
```

Add a `jsonCtx` parameter to `walkInstance` (`jsonCtx: { shape: Shape | null; tsType: string } | null`, initial call passes `null`) and, right after the `desc` computation, handle the datapath:

```ts
    // JSON datapath (spec 2026-07-06-json-databinding-design.md): same static
    // dialect rule as domsource. Types `data` on the bound instance; validates
    // the path against the dataset shape when one is known.
    let childJsonCtx = jsonCtx;
    const dp = el.getAttribute("datapath");
    if (dp != null && !/^\s*\$\w*\{/.test(dp)) {
      const isAbs = isJsonAbsolutePath(dp);
      const isRel = dp.startsWith("/") && jsonCtx != null;
      if (isAbs || isRel) {
        const dpLine = [...el.attributes].find((a) => a.name === "datapath")?.line ?? el.line;
        let parsed: ParsedPath | null = null;
        try { parsed = parsePath(dp); }
        catch (e) { model.staticIssues.push({ message: `datapath "${dp}": ${(e as JsonPathError).message}`, line: dpLine }); }
        if (parsed) {
          let baseShape: Shape | null; let baseType: string;
          if (isAbs) {
            const ds = model.jsonDatasets.find((d) => d.name === parsed!.dataset);
            if (!ds) {
              model.staticIssues.push({ message: `datapath "${dp}": unknown dataset "$${parsed.dataset}"`, line: dpLine });
              baseShape = null; baseType = "any";
            } else { baseShape = ds.shape; baseType = ds.rootType; }
          } else { baseShape = jsonCtx!.shape; baseType = jsonCtx!.tsType; }
          let elemShape: Shape | null = null; let elemType = "any";
          if (baseShape) {
            const r = walkShapePath(baseShape, parsed);
            if ("error" in r) model.staticIssues.push({ message: `datapath "${dp}": ${r.error}`, line: dpLine });
            else { elemShape = r.ok; elemType = renderShape(r.ok); }
          } else if (baseType !== "any") {
            // declared (lz-shape) dataset: indexed-access typing; segment errors
            // surface as TS diagnostics on the generated declarations
            let t = baseType;
            for (const seg of parsed.segments) {
              t = `NonNullable<${t}>[${JSON.stringify(seg.prop)}]`;
              for (const _sel of seg.selectors) t = `NonNullable<${t}>[number]`;
            }
            elemType = t;
          }
          inst.attrs.push({ name: "data", tsType: elemType });
          inst.attrs.push({ name: "clonenumber", tsType: "number" });
          childJsonCtx = { shape: elemShape, tsType: elemType };
        } // classic datapaths fall through untouched
      } else if (!dp.startsWith("/") || jsonCtx == null) {
        childJsonCtx = null; // classic binding resets the JSON context (nearest-bound-ancestor)
      }
    }
```

Pass `childJsonCtx` through the recursive call (`walkInstance(c, inst, childSiblings, childJsonCtx)`), and update the initial call to `walkInstance(root, null, new Set(), null)`.

The `JsonDatasetModel` interface (defined in the app-model snippet above) must
also carry the declared literal so app-dts can emit it:

```ts
export interface JsonDatasetModel { name: string; rootType: string; shape: Shape | null; declaredLiteral?: string; line: number }
```

In the extract pre-pass, the `shapeEl` branch becomes:

```ts
    } else if (shapeEl) {
      rootType = `__LzShape_${name}`;   // declared literal, emitted as a type alias
      declaredLiteral = textOf(shapeEl).code.trim();
    }
```

(with `let declaredLiteral: string | undefined;` above and `declaredLiteral`
included in the pushed model object). In `compiler/src/app-dts.ts`, in
`generateAppDts` before the classes loop:

```ts
  for (const d of model.jsonDatasets)
    if (d.declaredLiteral) out.push(`type ${d.rootType} = ${d.declaredLiteral};`);
```

Note (documented limitation, spec rev 4): a TS syntax error in the declared
literal surfaces as a generated-declarations finding (line 0), not mapped to
the script's source line. JSON datapaths inside `<class>` templates are
renamed by domsource (they work at runtime) but are NOT checked/typed —
consistent with the slice-2 "template subtrees" follow-up.

Note: `data`/`clonenumber` are already ownerMembers via `inst.attrs` (the constraint collector includes `inst.attrs.map((x) => x.name)`), and `SKIP_LITERAL` still contains `datapath` so the literal validator never fires on it — nothing else to change there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS (incl. all slice-2 and bus checker tests).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/app-model.ts compiler/src/app-dts.ts compiler/test/json-check.test.mjs
git commit -m "lzx-check: json dataset shapes, path validation, typed data on bound instances"
```

---

### Task 9: live source — wire protocol client (reconnect, drop-before-snapshot)

**Files:**
- Modify: `compiler/src/json-runtime.ts` (replace the `liveInto` stub)
- Test: `compiler/test/json-runtime.test.mjs` (extend)

**Interfaces:**
- Consumes: `host.makeSocket(url): WsLike`, `host.setTimeoutFn`.
- Produces: dataset behavior per the spec's lifecycle rules — subscribe on open (`{"lz":1,"subscribe":name}`); snapshot messages (`{dataset, data}`) call `setData` (null data leaves `ready` false); updates before a non-null snapshot are dropped with a warning; `{dataset, error}` fires `onError`; wrong-dataset/malformed messages logged and skipped; reconnect with capped exponential backoff (500ms · 2^n, cap 30s, reset on open), re-subscribing each time.

- [ ] **Step 1: Write the failing tests** (append)

```js
function makeSocketRig() {
  const sockets = [];
  const makeSocket = (url) => {
    const ws = { url, sent: [], onopen: null, onmessage: null, onclose: null,
      send(s) { this.sent.push(JSON.parse(s)); }, close() {} };
    sockets.push(ws);
    return ws;
  };
  return { sockets, makeSocket, open: (ws) => ws.onopen(), msg: (ws, m) => ws.onmessage({ data: JSON.stringify(m) }) };
}

test("live: subscribe on open; snapshot then updates apply; pre-snapshot updates drop", () => {
  const rig = makeSocketRig();
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: () => {} });
  const ds = installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  const [ws] = rig.sockets;
  rig.open(ws);
  assert.deepEqual(ws.sent, [{ lz: 1, subscribe: "sensors" }]);
  rig.msg(ws, { dataset: "sensors", update: { path: "/temp", value: 1 } });   // before snapshot
  assert.equal(ds.ready, false);
  assert.ok(host.warnings.some((w) => /before snapshot/.test(w)));
  rig.msg(ws, { dataset: "sensors", data: { temp: 20 } });
  rig.msg(ws, { dataset: "sensors", update: { path: "/temp", value: 22.4 } });
  assert.equal(ds.data.temp, 22.4);
});

test("live: null snapshot keeps waiting; wrong-dataset and malformed skipped; error fires onError", () => {
  const rig = makeSocketRig();
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: () => {} });
  const ds = installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  const errs = [];
  ds.onError((m) => errs.push(m));
  const [ws] = rig.sockets;
  rig.open(ws);
  rig.msg(ws, { dataset: "sensors", data: null });
  assert.equal(ds.ready, false);
  rig.msg(ws, { dataset: "other", data: { x: 1 } });
  ws.onmessage({ data: "{not json" });
  assert.equal(ds.ready, false);
  rig.msg(ws, { dataset: "sensors", error: "refused" });
  assert.deepEqual(errs, ["refused"]);
});

test("live: reconnect with backoff, re-subscribe, backoff resets on open", () => {
  const rig = makeSocketRig();
  const delays = [];
  const timers = [];
  const host = makeHost({ makeSocket: rig.makeSocket,
    setTimeoutFn: (cb, ms) => { delays.push(ms); timers.push(cb); } });
  installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  rig.sockets[0].onclose();                        // drop before ever opening
  assert.deepEqual(delays, [500]);
  timers.shift()();                                // fire reconnect → socket #2
  rig.sockets[1].onclose();
  assert.deepEqual(delays, [500, 1000]);           // doubled
  timers.shift()();
  rig.open(rig.sockets[2]);                        // success resets backoff
  assert.deepEqual(rig.sockets[2].sent, [{ lz: 1, subscribe: "sensors" }]);
  rig.sockets[2].onclose();
  assert.equal(delays[2], 500);
});

test("live: onerror fires ONCE after 8 consecutive failures; retries continue", () => {
  const rig = makeSocketRig();
  const timers = [];
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: (cb) => timers.push(cb) });
  const ds = installJsonRuntime(host).register("s", { ws: "ws://h/api/data" });
  const errs = [];
  ds.onError((m) => errs.push(m));
  for (let i = 0; i < 10; i++) { rig.sockets[rig.sockets.length - 1].onclose(); timers.shift()(); }
  assert.equal(errs.length, 1);
  assert.equal(rig.sockets.length, 11);            // still reconnecting after the error
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: FAIL (`ws source not built yet` error fires).

- [ ] **Step 3: Implement** — replace `liveInto` in `JsonRegistry`:

```ts
  private liveInto(ds: JsonDataset, url: string): void {
    const host = this.host;
    if (!host.makeSocket) { ds.fireError("no WebSocket available"); return; }
    let sawSnapshot = false;
    let retry = 0;
    const connect = () => {
      const ws = host.makeSocket!(url);
      ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ lz: 1, subscribe: ds.name })); };
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { host.warn(`dataset "${ds.name}": malformed frame skipped`); return; }
        if (!m || m.dataset !== ds.name) { host.warn(`dataset "${ds.name}": message for "${m?.dataset}" skipped`); return; }
        if ("data" in m) {
          if (m.data !== null) { sawSnapshot = true; ds.setData(m.data); }
        } else if (m.update && typeof m.update.path === "string") {
          if (!sawSnapshot) host.warn(`dataset "${ds.name}": update before snapshot dropped`);
          else ds.updateData(m.update.path, m.update.value);
        } else if (typeof m.error === "string") {
          ds.fireError(m.error);
        } else host.warn(`dataset "${ds.name}": unknown message skipped`);
      };
      ws.onclose = () => {
        const delay = Math.min(30000, 500 * 2 ** retry++);
        if (retry === 8) ds.fireError("connection lost after 8 attempts; still retrying at the cap");
        (host.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms)))(connect, delay);
      };
    };
    connect();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-runtime.ts compiler/test/json-runtime.test.mjs
git commit -m "runtime: live dataset source — wire protocol client, capped-backoff reconnect, drop-before-snapshot"
```

---

### Task 10: server relay — `/api/data` on the shared dispatcher

**Files:**
- Create: `compiler/test/helpers/wsclient.mjs` (move `wsClient` + `encodeTextMasked` out of `compiler/test/bus-integration.test.mjs`; that file then imports them — importing a test file from another would re-register its tests)
- Modify: `compiler/test/bus-integration.test.mjs` (import from the helper; delete the moved definitions)
- Create: `server/data-relay.mjs`
- Modify: `server/index.mjs` (add the route)
- Test: `compiler/test/json-relay.test.mjs`

**Interfaces:**
- Consumes: `wsAccept/encodeText/decodeFrames` from `server/connection.mjs` (bus Task 1); `resolvePointer` from `compiler/dist/json-path.js` (same import style as `server/bus.mjs` importing `compiler/dist`).
- Produces:
  - `export function dataUpgradeHandler(req, socket)` — the `/api/data` route.
  - `export function _resetForTests()` — clears retained state between tests.
  - Behavior: any peer on the socket may subscribe AND publish. `{"lz":1,"subscribe":name}` → immediate snapshot reply (retained or `{dataset,data:null}`); unknown `lz` version → `{dataset:<name>,error}` reply to the sender + skip. `{dataset,data}` → retain + broadcast to that dataset's subscribers. `{dataset,update:{path,value}}` → apply to retained via `resolvePointer` (miss → error reply to sender only) + broadcast the update verbatim. Malformed frames: logged, skipped (socket stays). Publishers that also subscribed receive their own messages (LWW in arrival order, per spec).

- [ ] **Step 1: Move the helper.** Create `compiler/test/helpers/wsclient.mjs` containing `encodeTextMasked` and `wsClient` EXACTLY as they exist at the top of `compiler/test/bus-integration.test.mjs` (copy verbatim, including the `decodeFrames` import from `../../server/connection.mjs` — note the extra `../` from `helpers/`). In `bus-integration.test.mjs`, delete the two definitions and add `import { wsClient, encodeTextMasked } from "./helpers/wsclient.mjs";`. Run `cd compiler && npm test` — bus tests must stay green before proceeding.

- [ ] **Step 2: Write the failing tests**

`compiler/test/json-relay.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { attachUpgradeDispatcher } from "../../server/connection.mjs";
import { dataUpgradeHandler, _resetForTests } from "../../server/data-relay.mjs";
import { wsClient } from "./helpers/wsclient.mjs";

async function rig() {
  _resetForTests();
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, { "/api/data": dataUpgradeHandler });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

test("subscribe before publish: null snapshot, then live snapshot + updates flow", async () => {
  const { server, port } = await rig();
  const sub = wsClient(port, "/api/data");
  await sub.ready;
  sub.send({ lz: 1, subscribe: "sensors" });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: null });

  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "sensors", data: { temp: 20 } });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: { temp: 20 } });
  pub.send({ dataset: "sensors", update: { path: "/temp", value: 22.4 } });
  assert.deepEqual(await sub.next(), { dataset: "sensors", update: { path: "/temp", value: 22.4 } });

  sub.close(); pub.close(); server.close();
});

test("late subscriber gets the RETAINED snapshot with updates applied", async () => {
  const { server, port } = await rig();
  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "sensors", data: { temp: 20 } });
  pub.send({ dataset: "sensors", update: { path: "/temp", value: 25 } });
  await new Promise((r) => setTimeout(r, 50));

  const sub = wsClient(port, "/api/data");
  await sub.ready;
  sub.send({ lz: 1, subscribe: "sensors" });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: { temp: 25 } });
  sub.close(); pub.close(); server.close();
});

test("bad pointer errors the sender only; unknown version rejected; malformed skipped", async () => {
  const { server, port } = await rig();
  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "s", data: { x: 1 } });
  pub.send({ dataset: "s", update: { path: "/nope/deep", value: 2 } });
  const err = await pub.next();
  assert.equal(err.dataset, "s");
  assert.match(err.error, /resolves nothing/);

  pub.send({ lz: 99, subscribe: "s" });
  assert.match((await pub.next()).error, /version/);

  pub.send({ what: "ever" });                       // skipped, socket alive
  pub.send({ lz: 1, subscribe: "s" });
  assert.deepEqual(await pub.next(), { dataset: "s", data: { x: 1 } });
  pub.close(); server.close();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: FAIL — `server/data-relay.mjs` not found.

- [ ] **Step 4: Implement `server/data-relay.mjs`**

```js
// data-relay.mjs — the JSON-dataset relay (spec: docs/superpowers/specs/
// 2026-07-06-json-databinding-design.md, "Wire protocol"). A route on the
// shared upgrade dispatcher (/api/data). Dataset-keyed pub/sub with retained
// snapshots: any conforming peer (browser, node, micropython) may subscribe
// and/or publish on one socket. The protocol itself is transport-independent;
// this relay is just the reference server.

import { wsAccept, encodeText, decodeFrames } from "./connection.mjs";
import { resolvePointer } from "../compiler/dist/json-path.js";

const datasets = new Map(); // name -> { data: any|null, subs: Set<socket> }
const entry = (name) => {
  let e = datasets.get(name);
  if (!e) datasets.set(name, e = { data: null, subs: new Set() });
  return e;
};
export function _resetForTests() { datasets.clear(); }

function handle(msg, socket) {
  const send = (m) => { try { socket.write(encodeText(JSON.stringify(m))); } catch {} };
  if (msg.subscribe != null) {
    if (msg.lz !== 1) return send({ dataset: String(msg.subscribe), error: "unsupported protocol version" });
    const e = entry(String(msg.subscribe));
    e.subs.add(socket);
    return send({ dataset: String(msg.subscribe), data: e.data }); // snapshot MUST precede any update
  }
  if (typeof msg.dataset !== "string") return; // malformed: skip
  const e = entry(msg.dataset);
  if ("data" in msg) {
    e.data = msg.data;
    const frame = encodeText(JSON.stringify({ dataset: msg.dataset, data: msg.data }));
    for (const s of e.subs) { try { s.write(frame); } catch {} }
    return;
  }
  if (msg.update && typeof msg.update.path === "string") {
    const r = resolvePointer(e.data, msg.update.path);
    if (!r) return send({ dataset: msg.dataset, error: `update "${msg.update.path}" resolves nothing` });
    r.parent[r.key] = msg.update.value;
    const frame = encodeText(JSON.stringify({ dataset: msg.dataset, update: msg.update }));
    for (const s of e.subs) { try { s.write(frame); } catch {} }
    return;
  }
  // unknown op: skip (a misbehaving peer cannot wedge the relay)
}

export function dataUpgradeHandler(req, socket) {
  if (!wsAccept(req, socket)) return;
  let buf = Buffer.alloc(0);
  const drop = () => { for (const e of datasets.values()) e.subs.delete(socket); };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, closed, rest } = decodeFrames(buf); buf = rest;
    for (const m of messages) {
      if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; }
      if (m.text == null) continue;
      try { handle(JSON.parse(m.text), socket); }
      catch (e) { console.warn("data-relay: malformed frame skipped:", String(e && e.message || e)); }
    }
    if (closed) { drop(); socket.end(); }
  });
  socket.on("close", drop);
  socket.on("error", drop);
}
```

In `server/index.mjs`, extend the dispatcher routes (currently `/api/connection` + `/api/bus`):

```js
import { dataUpgradeHandler } from "./data-relay.mjs";
// …
attachUpgradeDispatcher(server, {
  "/api/connection": connectionUpgradeHandler,
  "/api/bus": busUpgradeHandler,           // realtime bus (spec 2026-07-06-realtime-bus-design.md)
  "/api/data": dataUpgradeHandler,         // JSON-dataset relay (spec 2026-07-06-json-databinding-design.md)
});
```

(Also check the `/api/` static-guard branch at `server/index.mjs:160` — if it special-cases `/api/connection` only, extend the exclusion to any `/api/` path handled by the dispatcher; upgrade requests never hit the HTTP handler, so usually no change is needed. Verify with the integration test.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS (bus integration untouched, relay tests green).

- [ ] **Step 6: Commit**

```bash
git add compiler/test/helpers/wsclient.mjs compiler/test/bus-integration.test.mjs \
        server/data-relay.mjs server/index.mjs compiler/test/json-relay.test.mjs
git commit -m "server: /api/data JSON-dataset relay on the shared dispatcher (retained snapshots, pointer updates)"
```

---

### Task 11: filter + sort

**Files:**
- Modify: `compiler/src/json-runtime.ts` (fill `filterFn()` and `sorted()`)
- Test: `compiler/test/json-runtime.test.mjs` (extend)

**Spec note:** rev 4 already places `filterfunction` on the **parent** of the datapath-bound view (the bound view is a template — no instance exists before replication runs). No spec edit needed here.

**Interfaces:**
- Consumes: `this.parent.filterfunction` (a compiled LZX method, present on the constructed parent); `spec.attrs.sortfield` (string), `spec.attrs.sortasc` (`true`/`"true"`/`false`/`"false"`, default true).
- Produces: matches filtered through the dreem accumulate signature, then sorted by `datum[sortfield]` (numbers numerically, otherwise string compare), descending when sortasc is false.

- [ ] **Step 1: Write the failing tests** (append)

```js
test("[@] filter: parent-hosted filterfunction accumulates (dreem signature)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { bicycle: [
    { color: "red", price: 19.95 }, { color: "green", price: 29.95 }, { color: "blue", price: 59.95 } ] } });
  root.filterfunction = function (obj, accum) { if (obj.price > 20) accum.unshift(obj.color); return accum; };
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/bicycle[*][@]" } }]);
  drain();
  assert.deepEqual(root.subnodes.map((n) => n.data), ["blue", "green"]);
});

test("[@] without a parent filterfunction warns and yields zero clones", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  jd.register("b", { json: { l: [1, 2] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*][@]" } }]);
  drain();
  assert.equal(root.subnodes.length, 0);
  assert.ok(host.warnings.some((w) => /filterfunction/.test(w)));
});

test("sortfield/sortasc: numeric sort, descending", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { bicycle: [
    { color: "green", price: 29.95 }, { color: "red", price: 9.95 }, { color: "blue", price: 59.95 } ] } });
  root.createChildren([{ class: "view",
    attrs: { jsondatapath: "$b/bicycle[*]", sortfield: "price", sortasc: "false" } }]);
  drain();
  assert.deepEqual(root.subnodes.map((n) => n.data.color), ["blue", "green", "red"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: filter test FAIL (filterFn stub returns undefined → unfiltered order) / sort FAIL.

- [ ] **Step 3: Implement** — replace the two stubs in `ReplicationManager`:

```ts
  private filterFn(): ((obj: unknown, accum: unknown[]) => unknown[]) | undefined {
    const f = this.parent.filterfunction;
    if (typeof f !== "function") {
      this.host.warn(`jsondatapath "${this.path}": [@] but no filterfunction on the parent — zero matches`);
      return () => [];
    }
    return (obj, accum) => f.call(this.parent, obj, accum);
  }

  private sorted(m: unknown[]): unknown[] {
    const field = this.spec.attrs?.sortfield;
    if (typeof field !== "string" || field === "") return m;
    const asc = !(this.spec.attrs?.sortasc === false || this.spec.attrs?.sortasc === "false");
    const key = (d: any) => (d == null ? undefined : d[field]);
    return [...m].sort((a, b) => {
      const ka = key(a), kb = key(b);
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      return asc ? c : -c;
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-runtime.ts compiler/test/json-runtime.test.mjs
git commit -m "runtime: [@] filterfunction (parent-hosted per spec) + sortfield/sortasc"
```

---

### Task 12: LzDataElement bridge

**Files:**
- Modify: `compiler/src/json-runtime.ts` (`JsonDataset.toLzDataset`)
- Test: `compiler/test/json-runtime.test.mjs` (extend)

**Interfaces:**
- Consumes: `host.globals` (window-ish) providing `lz.dataset` (constructor: `new lz.dataset(canvas, attrs)`), `canvas`, and `LzDataElement.__LZv2E(value): LzDataElement[]` (the frozen converter, LzDataElement.lzs:815).
- Produces: `toLzDataset(name?: string, opts?: { live?: boolean }): any` — one-shot conversion by default (`setChildNodes(__LZv2E(data))`); `live: true` re-converts on every `ondata`. One-directional; the replication guard from Task 6 already refuses LzDataElement datums.

- [ ] **Step 1: Write the failing tests** (append)

```js
function makeBridgeGlobals() {
  const made = [];
  class FakeLDE { constructor() { this.appendChild = () => {}; this.ownerDocument = {}; } }
  FakeLDE.__LZv2E = (v) => [{ converted: structuredClone(v) }];
  class FakeDataset { constructor(parent, attrs) { this.attrs = attrs; made.push(this); }
    setChildNodes(kids) { this.kids = kids; } }
  return { made, globals: { canvas: {}, lz: { dataset: FakeDataset }, LzDataElement: FakeLDE } };
}

test("toLzDataset: one-shot converts via __LZv2E; live re-converts on ondata", () => {
  const b = makeBridgeGlobals();
  const jd = installJsonRuntime(makeHost({ globals: b.globals }));
  const ds = jd.register("b", { json: { x: 1 } });
  const xml = ds.toLzDataset("b_xml");
  assert.equal(b.made.length, 1);
  assert.equal(xml.attrs.name, "b_xml");
  assert.deepEqual(xml.kids[0].converted, { x: 1 });
  ds.setData({ x: 2 });
  assert.deepEqual(xml.kids[0].converted, { x: 1 });   // one-shot: unchanged

  const live = ds.toLzDataset(undefined, { live: true });
  assert.equal(live.attrs.name, "b_xml");          // default name = "<name>_xml"
  ds.setData({ x: 3 });
  assert.deepEqual(live.kids[0].converted, { x: 3 });
});

test("toLzDataset without LFC globals throws a clear error", () => {
  const jd = installJsonRuntime(makeHost());
  const ds = jd.register("b", { json: 1 });
  assert.throws(() => ds.toLzDataset(), /LFC/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: FAIL — `toLzDataset` is not a function.

- [ ] **Step 3: Implement** — add to `JsonDataset`:

```ts
  /** Bridge to the classic XML data stack (spec "JsonDataset > Bridge"): a real
   *  LzDataset filled via the frozen LzDataElement.__LZv2E converter. One-shot
   *  by default; {live:true} re-converts on every ondata. ONE-directional —
   *  edits to the converted tree do not flow back, and bridged values must not
   *  be fed into JSON bindings (the replication guard refuses them). */
  toLzDataset(name?: string, opts?: { live?: boolean }): any {
    const g = this.host.globals;
    if (!g || !g.lz || !g.lz.dataset || !g.LzDataElement || typeof g.LzDataElement.__LZv2E !== "function")
      throw new Error("toLzDataset requires the LFC (lz.dataset / LzDataElement.__LZv2E) on the host globals");
    const ds = new g.lz.dataset(g.canvas, { name: name ?? this.name + "_xml" });
    const fill = () => ds.setChildNodes(g.LzDataElement.__LZv2E(this.data));
    fill();
    if (opts?.live) this.onData(fill);
    return ds;
  }
```

(`host` is already a constructor field on `JsonDataset` — change its visibility from `private` to `private readonly` if tsc complains about the access from the method; it is the same class.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/json-runtime.ts compiler/test/json-runtime.test.mjs
git commit -m "runtime: toLzDataset bridge — one-shot/live __LZv2E conversion into a classic LzDataset"
```

---

### Task 13: sensors demo, feeder peer, docs, final dist

**Files:**
- Create: `examples/dom-authoring/sensors-demo.html`, `examples/dom-authoring/sensor-feeder.mjs`
- Modify: `examples/dom-authoring/README.md`
- Regenerate + commit: `startup/lz-json-data.js`, `compiler/lzc-browser.js` (final `npm run dist`)

- [ ] **Step 1: Write `examples/dom-authoring/sensors-demo.html`** (server default port is 8090 — `node server/index.mjs [port=8090]`):

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>JSON databinding — live sensors (/api/data)</title>
  <script type="module" src="../../startup/laszlo-dom.js"></script>
</head>
<body>
<!-- Serve via: node server/index.mjs   then run: node examples/dom-authoring/sensor-feeder.mjs -->
<laszlo-app height="200" bgcolor="#f7f7f7">
  <dataset name="sensors" type="json" src="ws://localhost:8090/api/data">
    <script type="application/lz-shape">{ temp: number, readings: number[] }</script>
  </dataset>
  <lz-view x="10" y="10" height="24" datapath="$sensors">
    <lz-text text="${'temp: ' + parent.data.temp}"></lz-text>
  </lz-view>
  <lz-view x="10" y="40">
    <simplelayout axis="y" spacing="2"></simplelayout>
    <lz-view datapath="$sensors/readings[*]" height="16">
      <lz-text text="${'reading ' + parent.clonenumber + ': ' + parent.data}"></lz-text>
    </lz-view>
  </lz-view>
</laszlo-app>
</body>
</html>
```

Note the first binding: `datapath="$sensors"` sits on the enclosing `lz-view` (the whole-dataset single-bind), and the text constraint reads `parent.data.temp`. The bound view does not exist until the first snapshot arrives — that IS the loading state.

- [ ] **Step 2: Write `examples/dom-authoring/sensor-feeder.mjs`** (a "device" peer — deliberately dumb: socket + JSON, nothing else):

```js
// sensor-feeder.mjs — a minimal conforming publisher peer for /api/data
// (spec "Wire protocol"): what a micropython device would send. Publishes a
// snapshot, then pointer updates once a second.
//   node examples/dom-authoring/sensor-feeder.mjs [port=8090]
import net from "node:net";
import crypto from "node:crypto";

const port = Number(process.argv[2] || 8090);
const sock = net.connect(port, "127.0.0.1", () => {
  sock.write(`GET /api/data HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
function send(obj) { // masked client frame (RFC 6455)
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  const header = data.length < 126
    ? Buffer.from([0x81, 0x80 | data.length])
    : (() => { const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); return h; })();
  sock.write(Buffer.concat([header, mask, masked]));
}
let up = false;
sock.on("data", () => {
  if (up) return;
  up = true;
  send({ dataset: "sensors", data: { temp: 20, readings: [20] } });
  let t = 20;
  setInterval(() => {
    t = Math.round((t + (Math.random() - 0.5)) * 10) / 10;
    send({ dataset: "sensors", update: { path: "/temp", value: t } });
    send({ dataset: "sensors", data: { temp: t, readings: [t, t - 1, t + 1] } });
  }, 1000);
});
sock.on("error", (e) => { console.error("feeder:", e.message); process.exit(1); });
console.log(`feeding "sensors" via ws://127.0.0.1:${port}/api/data — Ctrl-C to stop`);
```

- [ ] **Step 3: Verify end to end**

Run: `node server/index.mjs & node examples/dom-authoring/sensor-feeder.mjs &` then load `http://localhost:8090/examples/dom-authoring/sensors-demo.html`.
Expected: temp text and readings rows update every second. Kill both processes after.

- [ ] **Step 4: Document.** Add to `examples/dom-authoring/README.md` a "JSON databinding (Slice 4)" section: the two demos, the dataset/datapath authoring surface (one paragraph + the bikeshop snippet), the wire protocol's four message shapes, the micropython sketch from the spec, and a pointer to the spec file.

- [ ] **Step 5: Final artifacts + full suite**

Run: `cd compiler && npm run dist && npm test`
Expected: all suites green; regenerated `lzc-browser.js`, `startup/lz-json-data.js`, `startup/lz-ts.js` byte-stable or refreshed.

- [ ] **Step 6: Commit**

```bash
git add examples/dom-authoring/ startup/lz-json-data.js startup/lz-ts.js compiler/lzc-browser.js
git commit -m "examples: live sensors demo + feeder peer over /api/data; README; final dist artifacts"
```

(`startup/lz-ts.js` is included in case `npm run dist` refreshed it; `git status` must be clean after this commit.)

---

## Plan Self-Review (performed)

- **Spec coverage:** dialect grammar → Task 1; unification/typing rules → Tasks 2, 8; authoring/routing → Tasks 3–4; dataset sources + mutation → Tasks 5, 9; replication/pooling/nesting/onclones → Task 6; blob order + `lz.jsondata` install → Task 7; wire protocol + lifecycle rules + relay-on-dispatcher → Tasks 9–10; filter/sort → Task 11 (with a spec amendment for the filterfunction host — the bound view is a template, so the method lives on the constructed parent); bridge + guard → Tasks 6, 12; error-handling table rows are each asserted in a test (compile diagnostics T4/T8, unknown-$name T6, fetch failure T5, ws drop/error/malformed/pre-snapshot T9, relay errors T10, updateData miss T5, zero matches T6, LzDataNodeMixin guard T6/T12).
- **Known deviations/limitations (all recorded in spec rev 4):** filterfunction host = parent of the bound view; debug-build JSON datasets refused (Task 4, DOM-authored apps never compile debug); `onclones` fires on the parent, only when a delegate created the event (guarded send); ws `onerror` once after 8 consecutive failures, retries continue at the cap; shapeless datasets type as `any` with no finding; lz-shape TS syntax errors surface as line-0 generated-declaration findings; nested relative bindings inside POOLED clones do not re-evaluate on datum swap (default destroy/recreate rebuilds them); class-template JSON datapaths work at runtime but are unchecked (slice-2 template follow-up); `initstage="defer"` replication follows the LFC queue timing.
- **Type consistency:** `ParsedPath/Selector/Shape/RuntimeHost/WsLike/JsonRegistry` names are used identically across Tasks 1–12; `jsondatapath` is the single cross-layer key (domsource → compile output → runtime interception → checker).
