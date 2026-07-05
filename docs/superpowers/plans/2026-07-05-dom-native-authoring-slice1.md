# DOM-Native Authoring — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author LZX apps as native HTML DOM (custom-element tags, TypeScript code carriers), compile them with the existing openlaszlo-5.0 compiler via a new DOM→XmlElem front-end, and have the runtime adopt the authored elements in place as the live views.

**Architecture:** A new compiler front-end module (`domsource.ts`) walks a DOM subtree and emits the exact `XmlElem` tree `parseXml` produces; `compile()` is split into `parseXml` + `compileFromXml` so both paths share everything downstream. At runtime, a bootstrap (`startup/laszlo-dom.js`) compiles the page's `<laszlo-app>` subtree in-browser and boots it via `lz.embed` with an adoption patch (`startup/lz-adopt-patch.js`) prepended to the app JS — the patch wraps `LzView.prototype.__makeSprite` and swaps in authored elements as sprite `__LZdiv`s. **Zero edits to `runtime/lfc-src`** (its oracle byte-parity is inviolable).

**Tech Stack:** TypeScript (compiler, already in place), `node --test` (new, zero-dep unit tests), `typescript.transpileModule` (TS carrier transpile, bundled to `startup/lz-ts.js` via esbuild), plain JS for startup modules.

**Spec:** `docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md` — read it before starting any task.

## Global Constraints

- **Never edit `runtime/lfc-src/` or `runtime/lfc/`** — the LFC builds byte-for-byte against the 4.9 oracle golds; adoption is a runtime patch module only.
- **The `.lzx`-text compile path must emit byte-identical output** — every compiler change is additive/refactor-only on that path; Task 4's refactor guard proves it.
- **No new runtime dependencies in the compiler core** (`compile.ts`, `domsource.ts`, etc.) — TS transpile is *injected* as `opts.transpileTs`; `typescript` stays a devDependency used only by `ts-carrier.ts`.
- **The reserved `lzdomadopt` attribute must never appear unless `domAdopt: true`** (byte-parity guard, spec Testing #3).
- **Transpiled carrier output must stay within the ES3-era grammar `sc.ts` parses** — `target: ES5`, `module: None`.
- DOM-authored apps target the **production** build only (no debug/backtrace/profile source-line work).
- All compiler work in `compiler/src/*.ts`; `npm run build` (tsc) must stay clean; tests run with `npm test` (added in Task 1).
- Commit after every task (at minimum); use the existing commit-message style (`git log --oneline` shows imperative subjects).

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `compiler/package.json` | modify | add `test`, `bundle:lzts` scripts |
| `compiler/test/helpers/fakedom.mjs` | create | minimal structural DOM factory for Node unit tests |
| `compiler/test/domsource.test.mjs` | create | adapter unit tests (dialect rules, carriers, stamping) |
| `compiler/test/ts-carrier.test.mjs` | create | transpile unit tests |
| `compiler/test/browser-rootxml.test.mjs` | create | `compileInBrowser` rootXml-path test |
| `compiler/src/domsource.ts` | create | DOM→XmlElem adapter (Seam 1); all dialect rules live here |
| `compiler/src/compile.ts` | modify | extract `compileFromXml` from `compile` (pure refactor) |
| `compiler/src/browser.ts` | modify | `rootXml` option; re-export `domsource` + `parseXml` for the bundle |
| `compiler/src/ts-carrier.ts` | create | `transpileTsBody` (wrap → transpileModule ES5 → unwrap) |
| `startup/lz-adopt-patch.js` | create | runtime adoption patch (Seam 2), prepended to app JS |
| `startup/laszlo-dom.js` | create | bootstrap: gather DOM → compile → boot → adopt → reveal |
| `startup/lz-ts.js` | generated | esbuild bundle of `ts-carrier` (committed like `lzc-browser.js`) |
| `examples/dom-authoring/index.html` | create | Slice-1 demo app |
| `examples/dom-authoring/equivalence.html` | create | in-browser DOM/text equivalence corpus (real HTML parser) |
| `examples/dom-authoring/README.md` | create | authoring-dialect quick reference |

Node unit tests use a **fake DOM** (structural interface) to test adapter *logic*; the **real-HTML-parser** behaviors (lowercasing, `<image>`→`<img>` rewrite, raw-text `<script>`) are covered by `equivalence.html` in a real browser (Task 10). This split keeps the compiler tests dependency-free.

---

### Task 1: Unit-test harness + fake DOM helper

**Files:**
- Modify: `compiler/package.json`
- Create: `compiler/test/helpers/fakedom.mjs`
- Create: `compiler/test/harness.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `el(tag, attrs?, ...children)`, `text(s)`, `comment(s)` from `test/helpers/fakedom.mjs` — used by Tasks 2, 3, 5. `npm test` = build + `node --test test/`.

- [ ] **Step 1: Add the test script**

In `compiler/package.json`, change the `scripts` block to:

```json
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "bundle:browser": "npx esbuild dist/browser.js --bundle --format=esm --platform=browser --outfile=lzc-browser.js",
    "dist": "npm run build && npm run bundle:browser && npm run bundle:lzts",
    "bundle:lzts": "npx esbuild dist/ts-carrier.js --bundle --format=esm --platform=browser --minify --outfile=../startup/lz-ts.js",
    "test": "npm run build && node --test test/"
  },
```

(`bundle:lzts` will fail until Task 7 creates `ts-carrier.ts` — that's fine; only `npm test` is used before then. Do NOT run `npm run dist` until Task 7.)

- [ ] **Step 2: Write the fake DOM helper**

Create `compiler/test/helpers/fakedom.mjs`:

```js
// fakedom.mjs — minimal structural DOM for domsource unit tests. Mirrors the
// subset domsource.ts consumes (DomElementLike / DomNodeLike). Real-HTML-parser
// behavior (lowercasing, <image> rewrite, raw-text <script>) is covered by the
// in-browser equivalence page, not here.
export function el(tag, attrs = {}, ...children) {
  const attrList = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(), // the DOM reports HTML-namespace tag names uppercased
    attributes: attrList,
    childNodes: children.map((c) => (typeof c === "string" ? text(c) : c)),
    getAttribute(n) { const a = attrList.find((x) => x.name === n); return a ? a.value : null; },
    setAttribute(n, v) {
      const a = attrList.find((x) => x.name === n);
      if (a) a.value = String(v); else attrList.push({ name: n, value: String(v) });
    },
  };
}
export function text(s) { return { nodeType: 3, nodeValue: s }; }
export function comment(s) { return { nodeType: 8, nodeValue: s }; }
```

- [ ] **Step 3: Write a harness smoke test**

Create `compiler/test/harness.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXml } from "../dist/xml.js";
import { el, text } from "./helpers/fakedom.mjs";

test("harness: dist import + fakedom shape", () => {
  const root = parseXml("<canvas><view/></canvas>");
  assert.equal(root.name, "canvas");
  const fake = el("view", { width: "10" }, text("hi"));
  assert.equal(fake.tagName, "VIEW");
  assert.equal(fake.getAttribute("width"), "10");
  fake.setAttribute("width", "20");
  assert.equal(fake.getAttribute("width"), "20");
});
```

- [ ] **Step 4: Run the tests**

Run: `cd compiler && npm test`
Expected: build clean, `1 passing` (node --test reporter: `# pass 1`).

- [ ] **Step 5: Commit**

```bash
git add compiler/package.json compiler/test/
git commit -m "compiler: add node --test unit harness + fake-DOM helper for the DOM front-end"
```

---

### Task 2: `domsource.ts` — core walk (names, root, attrs, text)

**Files:**
- Create: `compiler/src/domsource.ts`
- Test: `compiler/test/domsource.test.mjs`

**Interfaces:**
- Consumes: `XmlElem`/`XmlText`/`XmlNode`, `parseXml` from `./xml.js`; fakedom from Task 1.
- Produces (used by Tasks 3, 5, 6, 9):
  - `interface DomNodeLike { nodeType: number; nodeValue?: string | null }`
  - `interface DomElementLike extends DomNodeLike { tagName: string; attributes: ArrayLike<{name: string; value: string}>; childNodes: ArrayLike<DomNodeLike>; getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }`
  - `interface DomSourceOptions { domAdopt?: boolean; transpileTs?: (code: string) => string }`
  - `class DomDialectError extends Error {}`
  - `function domToXmlElem(root: DomElementLike, opts?: DomSourceOptions): XmlElem`

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/domsource.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { parseXml } from "../dist/xml.js";
import { el, text, comment } from "./helpers/fakedom.mjs";

// Strip the fields the equivalence contract excludes (spec Seam 1): source
// positions + cdata. parseXml sets line/endLine/endCol/closeLine/attrLines.
function strip(n) {
  if (n.type === "elem") {
    delete n.line; delete n.endLine; delete n.endCol; delete n.closeLine;
    delete n.attrLines; delete n.origin;
    n.children.forEach(strip);
  } else { delete n.line; delete n.cdata; }
  return n;
}
const eq = (a, b) => assert.deepEqual(strip(a), strip(b));

test("basic tree equals parseXml", () => {
  const dom = el("laszlo-app", { width: "100", height: "50" },
    el("view", { x: "1", bgcolor: "#ff0000" },
      el("view", { width: "10" })));
  eq(domToXmlElem(dom), parseXml('<canvas width="100" height="50"><view x="1" bgcolor="#ff0000"><view width="10"></view></view></canvas>'));
});

test("text nodes and comments: text kept, comments dropped", () => {
  const dom = el("laszlo-app", {}, text("  "), comment("nope"), el("view", {}), text("\n"));
  eq(domToXmlElem(dom), parseXml("<canvas>  <view></view>\n</canvas>"));
});

test("attribute values: literal tab/CR/LF fold to spaces (xml.ts normalization)", () => {
  const dom = el("laszlo-app", {}, el("view", { onclick: "a=1;\n\tb=2;\r" }));
  const out = domToXmlElem(dom);
  assert.equal(out.children[0].attrs.onclick, "a=1;  b=2; ");
});

test("attrOrder preserves authored order", () => {
  const dom = el("laszlo-app", {}, el("view", { y: "2", x: "1", width: "9" }));
  assert.deepEqual(domToXmlElem(dom).children[0].attrOrder, ["y", "x", "width"]);
});

test("lz- prefix strips to the LZX tag", () => {
  const dom = el("laszlo-app", {}, el("lz-image", { src: "a.png" }), el("lz-style", {}));
  const out = domToXmlElem(dom);
  assert.equal(out.children[0].name, "image");
  assert.equal(out.children[1].name, "style");
});

test("forbidden bare tags throw DomDialectError", () => {
  for (const tag of ["canvas", "style", "img", "image", "html", "form", "button", "label", "menu", "param"]) {
    assert.throws(() => domToXmlElem(el("laszlo-app", {}, el(tag, {}))), DomDialectError, tag);
  }
});

test("root: laszlo-app maps to canvas; other roots pass through dialectName", () => {
  assert.equal(domToXmlElem(el("laszlo-app", {})).name, "canvas");
  assert.equal(domToXmlElem(el("view", {})).name, "view"); // e.g. equivalence fixtures
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npm test`
Expected: build FAILS (`domsource.ts` missing) or tests fail with `Cannot find module '../dist/domsource.js'`.

- [ ] **Step 3: Implement the core walk**

Create `compiler/src/domsource.ts`:

```ts
// domsource.ts — the DOM→XmlElem front-end for the DOM-authored dialect
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Emits the SAME XmlElem structure parseXml produces (minus source positions),
// so everything downstream of the compiler is reused verbatim. Operates on a
// minimal structural DOM interface (DomElementLike) so it runs against the real
// browser DOM and against the test fake alike — no lib.dom dependency.

import { parseXml, XmlElem, XmlNode, XmlText } from "./xml.js";

export interface DomNodeLike { nodeType: number; nodeValue?: string | null }
export interface DomElementLike extends DomNodeLike {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  childNodes: ArrayLike<DomNodeLike>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}
export interface DomSourceOptions {
  /** Stamp adopt-ids: data-lz-adopt on live elements + lzdomadopt XmlElem attrs. */
  domAdopt?: boolean;
  /** TypeScript carrier transpile (injected; typically ts-carrier's transpileTsBody). */
  transpileTs?: (code: string) => string;
}
export class DomDialectError extends Error {}

const ELEMENT = 1, TEXT = 3, CDATA = 4, COMMENT = 8;
const PREFIX = "lz-";

// Spec "Tag-collision inventory": LZX tags that cannot be authored bare.
const FORBIDDEN_BARE: Record<string, string> = {
  canvas: "the app root is <laszlo-app>; a literal <canvas> is an HTML canvas element",
  style: "HTML parses <style> as raw CSS and applies it to the page; write <lz-style>",
  image: "HTML rewrites <image> to a void <img>, destroying children; write <lz-image>",
  img: "HTML rewrote your <image> to <img>; write <lz-image>",
  html: "an in-body <html> start tag merges into the document; write <lz-html>",
  form: "HTML drops nested <form> start tags; write <lz-form>",
  button: "an adopted <button> carries UA chrome/semantics; write <lz-button>",
  label: "write <lz-label>",
  menu: "write <lz-menu>",
  param: "<param> is a void element; write <lz-param>",
};

const CODE_PARENTS = new Set(["method", "handler", "setter"]);
// Spec Seam 1: never stamp inside these subtrees (templates / data).
const NO_STAMP_SUBTREE = new Set(["class", "interface", "mixin", "dataset"]);
// Tags never stamped: non-visual declarations + the Slice-1 text fallback.
// Over-stamping an unknown tag that turns out non-visual is benign (only
// LzView.__makeSprite consumes adopt-ids; an unclaimed registry entry is inert).
const NO_STAMP_TAGS = new Set([
  "canvas", "attribute", "method", "handler", "setter", "script", "include",
  "font", "resource", "dataset", "datapath", "datapointer", "class",
  "interface", "mixin", "node", "state", "animator", "animatorgroup",
  "layout", "simplelayout", "stableborderlayout", "constantlayout",
  "wrappinglayout", "text", "inputtext", "splash", "switch", "when", "otherwise",
]);

interface Ctx {
  opts: DomSourceOptions;
  counter: { n: number };
  inTemplate: boolean;
}

function localName(el: DomElementLike): string {
  return el.tagName.toLowerCase();
}

/** Dialect tag name: strip the lz- escape prefix; reject forbidden bare tags. */
function dialectName(raw: string): string {
  if (raw.startsWith(PREFIX)) return raw.slice(PREFIX.length);
  const why = FORBIDDEN_BARE[raw];
  if (why) throw new DomDialectError(`<${raw}> cannot be authored bare: ${why}`);
  return raw;
}

/** XML attribute-value normalization (mirror of xml.ts): tab/CR/LF → space. */
const normAttr = (v: string) => v.replace(/[\t\r\n]/g, " ");

function textContentOf(el: DomElementLike): string {
  let s = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as DomNodeLike;
    if (c.nodeType === TEXT || c.nodeType === CDATA) s += c.nodeValue ?? "";
    else if (c.nodeType === ELEMENT) s += textContentOf(c as DomElementLike);
  }
  return s;
}

function transpile(ctx: Ctx, code: string): string {
  if (!ctx.opts.transpileTs)
    throw new DomDialectError(
      "TypeScript code present but no transpileTs was provided (text/lzs carriers pass through)");
  return ctx.opts.transpileTs(code);
}

/** A <script> child of `parentName`. Returns the node(s) grafted into the parent. */
function scriptNodes(el: DomElementLike, parentName: string, ctx: Ctx): XmlNode[] {
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (type === "application/xml") {
    if (parentName !== "dataset")
      throw new DomDialectError('<script type="application/xml"> is only valid inside <dataset>');
    return [parseXml(textContentOf(el).trim())]; // single-root XML grafted verbatim
  }
  let body: string;
  if (type === "text/typescript") body = transpile(ctx, textContentOf(el));
  else if (type === "text/lzs") body = textContentOf(el);
  else
    throw new DomDialectError(
      "bare or JavaScript-typed <script> is not allowed (the page parser would execute it); " +
      'use <script type="text/typescript"> or <script type="text/lzs">');
  const textNode: XmlText = { type: "text", value: body, cdata: false };
  if (CODE_PARENTS.has(parentName)) return [textNode]; // body carrier: wrapper elided
  return [{ type: "elem", name: "script", attrs: {}, attrOrder: [], children: [textNode] }];
}

function walkElem(el: DomElementLike, ctx: Ctx, isRoot: boolean): XmlElem {
  const raw = localName(el);
  const name = isRoot && raw === "laszlo-app" ? "canvas" : dialectName(raw);

  const attrs: Record<string, string> = {};
  const attrOrder: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === "data-lz-adopt") continue; // live-DOM stamp, never source
    if (!(a.name in attrs)) { attrOrder.push(a.name); attrs[a.name] = normAttr(a.value); }
  }

  const childCtx: Ctx = ctx.inTemplate || !NO_STAMP_SUBTREE.has(name)
    ? { ...ctx, inTemplate: ctx.inTemplate }
    : { ...ctx, inTemplate: true };

  const children: XmlNode[] = [];
  const isCodeParent = CODE_PARENTS.has(name);
  let sawCarrier = false;
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as DomNodeLike;
    if (c.nodeType === COMMENT) continue;
    if (c.nodeType === TEXT || c.nodeType === CDATA) {
      children.push({ type: "text", value: c.nodeValue ?? "", cdata: false });
      continue;
    }
    if (c.nodeType !== ELEMENT) continue;
    const ce = c as DomElementLike;
    if (localName(ce) === "script") {
      children.push(...scriptNodes(ce, name, childCtx));
      if (isCodeParent) sawCarrier = true;
      continue;
    }
    children.push(walkElem(ce, childCtx, false));
  }

  // A code parent's PLAIN text body is TypeScript (spec "Code carriers"). With a
  // carrier present, surrounding whitespace-only text is dropped (the carrier IS
  // the body, and the XML dialect has no such wrapper whitespace).
  if (isCodeParent) {
    if (sawCarrier) {
      const kept = children.filter((k) => !(k.type === "text" && k.value.trim() === ""));
      children.length = 0;
      children.push(...kept);
    } else if (children.length && children.every((k) => k.type === "text")) {
      const joined = children.map((k) => (k as XmlText).value).join("");
      if (joined.trim() !== "") {
        children.length = 0;
        children.push({ type: "text", value: transpile(childCtx, joined), cdata: false });
      }
    }
  }

  const elem: XmlElem = { type: "elem", name, attrs, attrOrder, children };

  // Adopt-id stamping (spec Seam 1). Root (canvas) is never adopted.
  if (ctx.opts.domAdopt && !isRoot && !ctx.inTemplate && !NO_STAMP_TAGS.has(name)) {
    const id = String(ctx.counter.n++);
    el.setAttribute("data-lz-adopt", id);
    elem.attrs["lzdomadopt"] = id;
    elem.attrOrder.push("lzdomadopt");
  }
  return elem;
}

/** DOM subtree → XmlElem tree (the DOM dialect's parseXml). */
export function domToXmlElem(root: DomElementLike, opts: DomSourceOptions = {}): XmlElem {
  return walkElem(root, { opts, counter: { n: 1 }, inTemplate: false }, true);
}
```

Note: this file already contains the carrier and stamping logic that Tasks 3 and 5 *test* — implementing it in one coherent module avoids a stub-then-rewrite churn. Tasks 3 and 5 add the tests that pin its behavior (and fix anything the tests flush out).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: all Task-2 tests PASS (carrier/stamping behavior is untested until Tasks 3/5).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/domsource.ts compiler/test/domsource.test.mjs
git commit -m "compiler: domsource.ts DOM->XmlElem front-end (dialect core walk)"
```

---

### Task 3: Carrier handling tests (TS / lzs / xml / bare / plain-text)

**Files:**
- Test: `compiler/test/domsource.test.mjs` (append)
- Modify (only if a test flushes out a bug): `compiler/src/domsource.ts`

**Interfaces:**
- Consumes: `domToXmlElem`, `DomDialectError` (Task 2); fakedom (Task 1).
- Produces: pinned carrier semantics for Task 9's bootstrap and Task 10's corpus. Tests inject a **fake transpile** `(s) => "/*T*/" + s` — the real one arrives in Task 7 and is independent.

- [ ] **Step 1: Write the failing/pinning tests**

Append to `compiler/test/domsource.test.mjs`:

```js
const T = (s) => "/*T*/" + s; // fake transpile marker

test("carrier: text/typescript inside <method> becomes the method body, wrapper elided", () => {
  const dom = el("laszlo-app", {},
    el("method", { name: "f", args: "n" }, text("\n  "),
      el("script", { type: "text/typescript" }, text("return n*2;")), text("\n")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const m = out.children.find((c) => c.type === "elem");
  assert.equal(m.name, "method");
  assert.deepEqual(m.children, [{ type: "text", value: "/*T*/return n*2;", cdata: false }]);
});

test("carrier: text/lzs passes through untranspiled", () => {
  const dom = el("laszlo-app", {},
    el("handler", { event: "onclick" },
      el("script", { type: "text/lzs" }, text("if (this is LzView) x();"))));
  const out = domToXmlElem(dom, { transpileTs: T });
  const h = out.children.find((c) => c.type === "elem");
  assert.deepEqual(h.children, [{ type: "text", value: "if (this is LzView) x();", cdata: false }]);
});

test("carrier: plain text inside <method> is TypeScript", () => {
  const dom = el("laszlo-app", {}, el("method", { name: "g" }, text("return 1;")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const m = out.children.find((c) => c.type === "elem");
  assert.deepEqual(m.children, [{ type: "text", value: "/*T*/return 1;", cdata: false }]);
});

test("carrier: TS without transpileTs throws", () => {
  const dom = el("laszlo-app", {}, el("method", { name: "g" }, text("return 1;")));
  assert.throws(() => domToXmlElem(dom), DomDialectError);
});

test("carrier: standalone typed script maps to a real <script> element, type elided", () => {
  const dom = el("laszlo-app", {},
    el("script", { type: "text/lzs" }, text("var a = 1;")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const s = out.children.find((c) => c.type === "elem");
  assert.equal(s.name, "script");
  assert.deepEqual(s.attrs, {});
  assert.deepEqual(s.children, [{ type: "text", value: "var a = 1;", cdata: false }]);
});

test("carrier: bare <script> is a dialect error", () => {
  const dom = el("laszlo-app", {}, el("script", {}, text("alert(1)")));
  assert.throws(() => domToXmlElem(dom, { transpileTs: T }), DomDialectError, /bare/i);
});

test("carrier: application/xml inside dataset grafts parsed XML", () => {
  const dom = el("laszlo-app", {},
    el("dataset", { name: "d" },
      el("script", { type: "application/xml" }, text('<items><item x="1"></item></items>'))));
  const out = domToXmlElem(dom, { transpileTs: T });
  const ds = out.children.find((c) => c.type === "elem");
  const items = ds.children[0];
  assert.equal(items.name, "items");
  assert.equal(items.children[0].name, "item");
  assert.equal(items.children[0].attrs.x, "1");
});

test("carrier: application/xml outside dataset is a dialect error", () => {
  const dom = el("laszlo-app", {},
    el("view", {}, el("script", { type: "application/xml" }, text("<x></x>"))));
  assert.throws(() => domToXmlElem(dom, { transpileTs: T }), DomDialectError);
});
```

- [ ] **Step 2: Run tests**

Run: `cd compiler && npm test`
Expected: PASS (Task 2's implementation already covers these). If any FAIL, fix `domsource.ts` minimally until green — the tests are the contract, per spec "Code carriers".

- [ ] **Step 3: Commit**

```bash
git add compiler/test/domsource.test.mjs compiler/src/domsource.ts
git commit -m "compiler: pin DOM-dialect carrier semantics (ts/lzs/xml/bare/plain-text)"
```

---

### Task 4: Extract `compileFromXml` (pure refactor) + refactor guard

**Files:**
- Modify: `compiler/src/compile.ts:2461-2465`
- No new tests (the guard is a byte-diff over real apps)

**Interfaces:**
- Consumes: existing `compile(source, opts)`.
- Produces: `export function compileFromXml(root: XmlElem, opts?: CompileOptions): CompileResult` — used by Tasks 6 and by `compile` itself. `compile`'s signature and behavior are unchanged.

- [ ] **Step 1: Capture the BEFORE outputs (refactor guard)**

```bash
cd compiler && npm run build && mkdir -p /tmp/lzc-guard/before
for f in ../docs/component-browser/components.lzx ../explorer/explore-nav.lzx \
         ../docs/component-browser/formview.lzx ../docs/component-browser/treeview.lzx; do
  LPS_HOME=../runtime node dist/cli.js "$f" > "/tmp/lzc-guard/before/$(basename "$f").js"
done
wc -c /tmp/lzc-guard/before/*.js
```

Expected: four non-trivial outputs (each tens-to-hundreds of KB). If any is empty or errors, pick a different `.lzx` from `docs/component-browser/` — the guard needs real compiles.

- [ ] **Step 2: Verify `source` is unused after the parse**

```bash
awk 'NR>=2461 && NR<=3200' src/compile.ts | grep -n "\bsource\b" | grep -v "sourceId\|resolveScriptSrc\|debugFileName" | head
```

Expected: no hits that reference the `source` PARAMETER inside the function body (comments are fine). If the parameter IS used beyond `parseXml(source)`, STOP — report it; the extraction then needs a `sourceText` thread-through and the plan must be amended.

- [ ] **Step 3: Perform the extraction**

In `compiler/src/compile.ts`, replace:

```ts
export function compile(source: string, opts: CompileOptions = {}): CompileResult {
  const root = parseXml(source);
  if (root.name !== "canvas") {
```

with:

```ts
export function compile(source: string, opts: CompileOptions = {}): CompileResult {
  return compileFromXml(parseXml(source), opts);
}

/** Compile from a pre-built root XmlElem — the DOM-authored path's entry point
 *  (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
 *  The text path above is exactly parseXml + this; its output is IDENTICAL. */
export function compileFromXml(root: XmlElem, opts: CompileOptions = {}): CompileResult {
  if (root.name !== "canvas") {
```

(The rest of the original function body is untouched — it already operates only on `root`.)

- [ ] **Step 4: Rebuild, capture AFTER outputs, byte-diff**

```bash
npm run build && mkdir -p /tmp/lzc-guard/after
for f in ../docs/component-browser/components.lzx ../explorer/explore-nav.lzx \
         ../docs/component-browser/formview.lzx ../docs/component-browser/treeview.lzx; do
  LPS_HOME=../runtime node dist/cli.js "$f" > "/tmp/lzc-guard/after/$(basename "$f").js"
done
diff -r /tmp/lzc-guard/before /tmp/lzc-guard/after && echo "BYTE-IDENTICAL"
```

Expected: `BYTE-IDENTICAL`. Any diff = the refactor is NOT pure; revert and retry.

- [ ] **Step 5: Run the unit tests too**

Run: `npm test` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add compiler/src/compile.ts
git commit -m "compiler: extract compileFromXml from compile (pure refactor, byte-diff-guarded)"
```

---

### Task 5: Adopt-id stamping tests + byte-parity guard

**Files:**
- Test: `compiler/test/domsource.test.mjs` (append)
- Modify (only if a test flushes out a bug): `compiler/src/domsource.ts`

**Interfaces:**
- Consumes: Task 2's `domToXmlElem` (`domAdopt` option).
- Produces: pinned stamping contract for Task 8 (patch reads `lzdomadopt` ids as strings `"1"`, `"2"`, … in document order) and Task 9 (registry built from `[data-lz-adopt]`).

- [ ] **Step 1: Write the pinning tests**

Append to `compiler/test/domsource.test.mjs`:

```js
test("stamping: off by default — no lzdomadopt anywhere (byte-parity guard)", () => {
  const dom = el("laszlo-app", {}, el("view", {}, el("view", {})));
  assert.ok(!JSON.stringify(domToXmlElem(dom)).includes("lzdomadopt"));
});

test("stamping: on — plain views get sequential ids on BOTH the XmlElem and the live element", () => {
  const inner = el("view", { width: "5" });
  const outer = el("view", {}, inner);
  const dom = el("laszlo-app", {}, outer);
  const out = domToXmlElem(dom, { domAdopt: true });
  assert.equal(out.attrs.lzdomadopt, undefined);            // root never stamped
  assert.equal(out.children[0].attrs.lzdomadopt, "1");
  assert.equal(out.children[0].children[0].attrs.lzdomadopt, "2");
  assert.equal(outer.getAttribute("data-lz-adopt"), "1");
  assert.equal(inner.getAttribute("data-lz-adopt"), "2");
});

test("stamping: excluded inside class/interface/mixin/dataset subtrees", () => {
  const tmplView = el("view", {});
  const dom = el("laszlo-app", {},
    el("class", { name: "rec", extends: "view" }, tmplView),
    el("dataset", { name: "d" }, el("script", { type: "application/xml" }, text("<r></r>"))));
  const out = domToXmlElem(dom, { domAdopt: true, transpileTs: (s) => s });
  assert.ok(!JSON.stringify(out).includes("lzdomadopt"));
  assert.equal(tmplView.getAttribute("data-lz-adopt"), null);
});

test("stamping: text/inputtext and non-visual tags excluded; user tags stamped", () => {
  const dom = el("laszlo-app", {},
    el("text", {}, text("hi")),
    el("inputtext", {}),
    el("simplelayout", { axis: "y" }),
    el("mybutton", {}));            // unknown tag = assumed user view class
  const out = domToXmlElem(dom, { domAdopt: true });
  const names = out.children.filter((c) => c.type === "elem");
  assert.equal(names.find((c) => c.name === "text").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "inputtext").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "simplelayout").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "mybutton").attrs.lzdomadopt, "1");
});

test("stamping: a stale data-lz-adopt on input is never emitted as source", () => {
  const dom = el("laszlo-app", {}, el("view", { "data-lz-adopt": "99" }));
  const out = domToXmlElem(dom); // domAdopt OFF
  assert.ok(!JSON.stringify(out).includes("99"));
  assert.ok(!JSON.stringify(out).includes("data-lz-adopt"));
});
```

- [ ] **Step 2: Run tests**

Run: `cd compiler && npm test`
Expected: PASS (implementation from Task 2). Fix `domsource.ts` minimally if not.

- [ ] **Step 3: Commit**

```bash
git add compiler/test/domsource.test.mjs compiler/src/domsource.ts
git commit -m "compiler: pin adopt-id stamping contract (scopes, sequencing, parity guard)"
```

---

### Task 6: `compileInBrowser` rootXml path + bundle exports

**Files:**
- Modify: `compiler/src/browser.ts`
- Test: `compiler/test/browser-rootxml.test.mjs`

**Interfaces:**
- Consumes: `compileFromXml` (Task 4), `domToXmlElem` types (Task 2).
- Produces (used by Task 9's bootstrap via the `lzc-browser.js` bundle):
  - `CompileInBrowserOptions.rootXml?: XmlElem`
  - re-exports: `domToXmlElem`, `DomDialectError`, `parseXml`, `compileFromXml` and types `DomElementLike`, `DomSourceOptions`.

- [ ] **Step 1: Write the failing test**

Create `compiler/test/browser-rootxml.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileInBrowser } from "../dist/browser.js";
import { parseXml } from "../dist/xml.js";

test("rootXml path: compiles a pre-built root; mainUrl is never fetched; no cache use", async () => {
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url);
    return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const rootXml = parseXml('<canvas width="100" height="100"><view width="10" height="10" bgcolor="0xff0000"></view></canvas>');
  const r = await compileInBrowser("http://example.test/page.html", { rootXml, fetchFn, maxRetries: 5 });
  assert.ok(!fetched.includes("http://example.test/page.html"), "mainUrl must not be fetched");
  assert.equal(r.unsupported, undefined);
  assert.ok(r.js.length > 1000, "expected real compiled output, got " + r.js.length + " bytes");
});

test("rootXml path: the passed tree is not mutated across passes", async () => {
  const fetchFn = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  const rootXml = parseXml("<canvas><view></view></canvas>");
  const snapshot = JSON.stringify(rootXml);
  await compileInBrowser("http://example.test/page.html", { rootXml, fetchFn, maxRetries: 5 });
  assert.equal(JSON.stringify(rootXml), snapshot, "compileInBrowser must clone, not mutate");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test`
Expected: FAIL — `rootXml` is not an option yet (TS build error or unused-option behavior mismatch).

- [ ] **Step 3: Implement**

In `compiler/src/browser.ts`:

(a) imports — change the `compile` import and add xml types:

```ts
import { compile, compileFromXml } from "./compile.js";
import type { XmlElem } from "./xml.js";
```

(b) add to `CompileInBrowserOptions` (after `maxRetries`):

```ts
  /** DOM-authored path (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md):
   *  compile this pre-built root instead of fetching `mainUrl`. `mainUrl` is still
   *  required — it is the BASE URL for relative includes/resources. The compile
   *  cache is SKIPPED (an inline DOM root has no fetchable validator). */
  rootXml?: XmlElem;
```

(c) add near `compileProps`:

```ts
/** XmlElem trees are plain JSON data; clone per pass (compileFromXml may mutate,
 *  e.g. the autoinclude splice into root.children). */
const cloneXml = (e: XmlElem): XmlElem => JSON.parse(JSON.stringify(e)) as XmlElem;
```

(d) in `compileInBrowser`, make three guarded changes:

```ts
  // 1. Cache lookup — SKIPPED for the rootXml path.
  if (o.cache && !o.rootXml) {
```

```ts
  // The MAIN app source is the first dependency (text path only; a rootXml
  // build has no main source to fetch — the page's DOM is the source).
  if (!o.rootXml) await fetchOne(mainUrl);
```

and in the retry loop, replace the single `compile(...)` call with:

```ts
    const r = o.rootXml
      ? compileFromXml(cloneXml(o.rootXml), {
          ...opts, debug: o.debug, backtrace: o.backtrace, profile: o.profile, proxied: o.proxied, sprites, canvas: o.canvas,
        })
      : compile(state.map.get(mainUrl)!.text, {
          ...opts, debug: o.debug, backtrace: o.backtrace, profile: o.profile, proxied: o.proxied, sprites, canvas: o.canvas,
        });
```

and the cache store:

```ts
  if (o.cache && !result.unsupported && !o.rootXml) {
```

(e) add the bundle re-exports (with the existing re-export block near the top):

```ts
export { domToXmlElem, DomDialectError } from "./domsource.js";
export type { DomElementLike, DomNodeLike, DomSourceOptions } from "./domsource.js";
export { parseXml } from "./xml.js";
export type { XmlElem, XmlNode, XmlText } from "./xml.js";
export { compileFromXml } from "./compile.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS. (The rootXml compile converges against an all-404 fetch because misses are definitive `state.missing` entries — pass 2 is stable.) If the first test's `js.length` assertion fails because the bare app legitimately compiles to `unsupported`, inspect `r.unsupported` — a real message means missing plumbing, not a test problem.

- [ ] **Step 5: Rebuild the browser bundle and commit**

```bash
npm run build && npm run bundle:browser
git add compiler/src/browser.ts compiler/test/browser-rootxml.test.mjs compiler/lzc-browser.js
git commit -m "compiler: compileInBrowser rootXml path (DOM-authored apps) + bundle exports"
```

---

### Task 7: `ts-carrier.ts` transpile + `startup/lz-ts.js` bundle

**Files:**
- Create: `compiler/src/ts-carrier.ts`
- Test: `compiler/test/ts-carrier.test.mjs`
- Generated: `startup/lz-ts.js` (committed, like `lzc-browser.js`)

**Interfaces:**
- Consumes: `typescript` (existing devDependency).
- Produces: `export function transpileTsBody(code: string): string` — the `transpileTs` injected by Task 9's bootstrap; throws `Error` with `TypeScript syntax error: …` on bad input.

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/ts-carrier.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { transpileTsBody } from "../dist/ts-carrier.js";

test("type annotations are erased", () => {
  const out = transpileTsBody("var x: number = 1; return x;");
  assert.ok(!out.includes(": number"));
  assert.ok(out.includes("return x;"));
});

test("as-casts are erased (ES4 cast equivalent)", () => {
  const out = transpileTsBody("return (this.parent as any).width;");
  assert.ok(!/\bas\b/.test(out));
});

test("arrows downlevel to functions with _this capture", () => {
  const out = transpileTsBody("const f = () => this.width; return f();");
  assert.ok(!out.includes("=>"));
  assert.ok(out.includes("_this"), "arrow this must be captured for function-body semantics");
});

test("template literals and let/const downlevel", () => {
  const out = transpileTsBody("let n = 2; const s = `v=${n}`; return s;");
  assert.ok(!out.includes("`"));
  assert.ok(!/\blet\b|\bconst\b/.test(out));
});

test("top-level return is legal (bodies are function bodies)", () => {
  assert.ok(transpileTsBody("return 42;").includes("return 42;"));
});

test("no 'use strict' prologue is injected", () => {
  assert.ok(!transpileTsBody("return 1;").includes("use strict"));
});

test("syntax errors throw", () => {
  assert.throws(() => transpileTsBody("const = ;"), /TypeScript syntax error/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `compiler/src/ts-carrier.ts`:

```ts
// ts-carrier.ts — TypeScript carrier transpile for the DOM-authored dialect
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Carrier bodies are FUNCTION BODIES (method/handler/setter code), so they are
// wrapped in a function for transpileModule (top-level `return` is legal, arrow
// `this`-capture lands inside the body) and unwrapped after. Output targets ES5
// so it stays within the ES3-era grammar sc.ts parses. Type-STRIP only — no
// checking (that is Slice 2's lzx-check).
//
// This module is the ONLY compiler source that imports `typescript`; it is
// excluded from the core (injected as opts.transpileTs) and bundled separately
// to startup/lz-ts.js (npm run bundle:lzts).

import ts from "typescript";

const WRAP_HEAD = "function __lzTsBody__(){\n";

export function transpileTsBody(code: string): string {
  const out = ts.transpileModule(WRAP_HEAD + code + "\n}", {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) {
    throw new Error(
      "TypeScript syntax error: " + ts.flattenDiagnosticMessageText(errs[0].messageText, " "));
  }
  const js = out.outputText;
  const open = js.indexOf("{");
  const close = js.lastIndexOf("}");
  return js.slice(open + 1, close).trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS.

- [ ] **Step 5: Build the browser bundle and smoke it in Node**

```bash
npm run build && npm run bundle:lzts
node --input-type=module -e "import('$PWD/../startup/lz-ts.js').then(m => console.log(m.transpileTsBody('return (1 as number) + 1;')))"
```

Expected: `return 1 + 1;` and `startup/lz-ts.js` exists (a few MB, minified).
If esbuild fails on `typescript`'s node-builtin references, append `--define:process.env.NODE_ENV='"production"'` and, if still failing, `--external:fs --external:path --external:os --external:inspector` to the `bundle:lzts` script (typescript guards those behind runtime checks; externals are never reached in `transpileModule`). Re-run the Node smoke after any flag change.

- [ ] **Step 6: Commit**

```bash
git add compiler/src/ts-carrier.ts compiler/test/ts-carrier.test.mjs compiler/package.json startup/lz-ts.js
git commit -m "compiler: TS carrier transpile (wrap/strip/ES5-unwrap) + lz-ts.js browser bundle"
```

---

### Task 8: `startup/lz-adopt-patch.js` — the runtime adoption patch

**Files:**
- Create: `startup/lz-adopt-patch.js`

**Interfaces:**
- Consumes: `window.__lzDomAdoptRegistry` (a `Map<string, Element>` set by Task 9's bootstrap before the app JS runs); LFC globals `LzView`, `LzNode` (already loaded — the patch is prepended to the app JS, and the embed loads the LFC script first).
- Produces: adopted elements as `sprite.__LZdiv`. Browser-verified in Task 10 (no Node test — this file only makes sense against the live LFC).

- [ ] **Step 1: Write the patch**

Create `startup/lz-adopt-patch.js`:

```js
// lz-adopt-patch.js — element-adoption runtime patch for DOM-authored apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md, Seam 2).
//
// PREPENDED to the compiled app JS by laszlo-dom.js: lz.embed loads the LFC
// script first, then the app script — so LzView/LzNode exist here and no view
// has been constructed yet. The LFC on disk is UNTOUCHED (its byte-for-byte
// oracle parity is inviolable; that is why this is a patch, not an LFC edit).
//
// Contract with the compiler (domsource.ts): statically-authored plain-view
// instances carry args.lzdomadopt = "<n>", and the live authored element
// carries data-lz-adopt="<n>" (held in window.__lzDomAdoptRegistry).
(function () {
  var reg = window.__lzDomAdoptRegistry;
  if (!reg || typeof LzView === "undefined" || typeof LzNode === "undefined") return;
  var orig = LzView.prototype.__makeSprite;
  LzView.prototype.__makeSprite = function (args) {
    orig.call(this, args);
    if (!args || args.lzdomadopt == null) return;
    var id = String(args.lzdomadopt);
    // Consume: the sentinel means "never apply as a normal attribute" — exactly
    // how construct() handles stretches/resource (LaszloView.lzs).
    args.lzdomadopt = LzNode._ignoreAttribute;
    var el = reg.get(id);
    if (!el) {
      if (window.console) console.warn("lz-adopt: no live element for id " + id + " (falling back to a created div)");
      return;
    }
    reg["delete"](id); // consume-once
    var sprite = this.sprite;
    var created = sprite && sprite.__LZdiv;
    // Only swap a fresh, unattached, plain created div. Subclass sprites
    // (LzTextSprite etc.) never reach this wrapper (they override __makeSprite),
    // and stamping already excludes them — this is defense in depth.
    if (!created || created.tagName !== "DIV" || created.parentNode) return;
    el.className = created.className;             // 'lzdiv' → class-selector styles apply
    if (created.style.cssText) el.style.cssText = created.style.cssText;
    el.owner = sprite;                            // the back-reference the LFC sets on __LZdiv
    sprite.__LZdiv = el;
  };
})();
```

- [ ] **Step 2: Syntax-check it**

Run: `node --check startup/lz-adopt-patch.js`
Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add startup/lz-adopt-patch.js
git commit -m "startup: lz-adopt-patch.js — element-adoption runtime patch (zero LFC edits)"
```

---

### Task 9: `startup/laszlo-dom.js` bootstrap + demo page

**Files:**
- Create: `startup/laszlo-dom.js`
- Create: `examples/dom-authoring/index.html`
- Create: `examples/dom-authoring/README.md`

**Interfaces:**
- Consumes: `compileInBrowser` + `domToXmlElem` from `compiler/lzc-browser.js` (Task 6); `transpileTsBody` from `startup/lz-ts.js` (Task 7, lazy-imported); `startup/lz-adopt-patch.js` (Task 8); `runtime/embed.js` + `runtime/lfc/lfc.js` (existing).
- Produces: `<laszlo-app>` (inline or `src=`) boots as a running app with adopted elements. Verified in Task 10.

- [ ] **Step 1: Write the bootstrap**

Create `startup/laszlo-dom.js`:

```js
// laszlo-dom.js — bootstrap for DOM-authored LZX apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Finds every <laszlo-app>, compiles its live DOM subtree with the in-browser
// compiler (rootXml path), and boots the result via lz.embed with the adoption
// patch prepended — so the authored view elements BECOME the running app's DOM.
// Independent of the service worker; the .lzx-text path is untouched.

import { compileInBrowser, domToXmlElem } from "../compiler/lzc-browser.js";

const HERE = new URL(".", import.meta.url);              // …/startup/
const DISTRO = new URL("..", HERE);                      // distro root
const RUNTIME = new URL("runtime/", DISTRO).href.replace(/\/$/, "");

// Hide app hosts before first paint; revealed per-app on embed onload.
const css = document.createElement("style");
css.textContent = "laszlo-app{visibility:hidden;display:block;position:relative}";
document.head.appendChild(css);

function fail(host, err) {
  host.style.visibility = "visible";
  host.textContent = "";
  const pre = document.createElement("pre");
  pre.style.cssText = "color:#a00;font:12px monospace;white-space:pre-wrap;padding:12px;margin:0";
  pre.textContent = String((err && err.message) || err);
  host.appendChild(pre);
}

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => bad(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

/** Drop source-only elements from the live tree, keeping stamped views (and any
 *  ancestors of stamped views). Adopted elements are re-attached under the app's
 *  lzcanvasdiv by the LFC's own addChildSprite appendChilds, in document order. */
function cleanup(el) {
  for (const c of [...el.children]) {
    if (c.hasAttribute("data-lz-adopt") || c.querySelector("[data-lz-adopt]")) cleanup(c);
    else c.remove();
  }
}

let appSeq = 0;

async function boot(host) {
  // FILE path: fetch + DOMParser (parsed scripts never execute), inline the subtree
  // so it is live and inspectable — then identical to the inline path.
  const src = host.getAttribute("src");
  if (src) {
    const res = await fetch(new URL(src, document.baseURI));
    if (!res.ok) throw new Error("laszlo-app src fetch failed: " + res.status + " " + src);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const app = doc.querySelector("laszlo-app");
    if (!app) throw new Error("no <laszlo-app> element in " + src);
    for (const a of [...app.attributes])
      if (!host.hasAttribute(a.name)) host.setAttribute(a.name, a.value);
    host.replaceChildren(...app.childNodes);
  }

  // TS transpile, lazy-loaded only when the app has code to transpile.
  let transpileTs;
  if (host.querySelector("method,handler,setter,script")) {
    transpileTs = (await import(new URL("lz-ts.js", HERE).href)).transpileTsBody;
  }

  // DOM → XmlElem. Stamps data-lz-adopt on live plain-view elements.
  const rootXml = domToXmlElem(host, { domAdopt: true, transpileTs });

  // Adoption registry (consume-once; read by lz-adopt-patch.js).
  const reg = new Map();
  for (const el of host.querySelectorAll("[data-lz-adopt]"))
    reg.set(el.getAttribute("data-lz-adopt"), el);
  window.__lzDomAdoptRegistry = reg;

  // The authored tree is source; drop what won't be adopted.
  cleanup(host);

  // Compile in-browser. The page URL is the base for relative refs; the runtime
  // root is the same lpsUrl the service worker uses (see service-worker.js).
  const r = await compileInBrowser(document.baseURI, {
    rootXml, lpsUrl: RUNTIME, sprites: "none", proxied: false,
  });
  if (r.unsupported) throw new Error("compile: " + r.unsupported);

  // Assemble: adoption patch + app JS in ONE script. lz.embed loads the LFC
  // first, then this blob — so the patch installs before any view constructs.
  const patch = await (await fetch(new URL("lz-adopt-patch.js", HERE))).text();
  const appUrl = URL.createObjectURL(new Blob([patch, "\n", r.js], { type: "text/javascript" }));

  if (typeof window.lz === "undefined" || !window.lz.embed) {
    await loadScript(RUNTIME + "/embed.js");
  }
  const containerId = "lzappcontainer" + appSeq;
  const appId = "lzapp" + appSeq;
  appSeq++;
  const container = document.createElement("div");
  container.id = containerId;
  host.appendChild(container);

  window.lz.embed.__serverroot = RUNTIME + "/includes/";
  window.lz.embed.dhtml({
    url: appUrl,
    lfcurl: RUNTIME + "/lfc/lfc.js",
    serverroot: "lps/resources/",
    bgcolor: host.getAttribute("bgcolor") || "#ffffff",
    width: host.getAttribute("width") || "100%",
    height: host.getAttribute("height") || "100%",
    id: appId,
    accessible: "false",
    cancelmousewheel: false,
    cancelkeyboardcontrol: false,
    skipchromeinstall: false,
    usemastersprite: false,
    approot: "",
    appenddivid: containerId,
  });
  window.lz.embed.applications[appId].onload = function () {
    host.style.visibility = "visible";
  };
}

for (const host of document.querySelectorAll("laszlo-app")) {
  boot(host).catch((e) => fail(host, e));
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check startup/laszlo-dom.js`
Expected: clean. (It's a browser module; Node only parses it.)

- [ ] **Step 3: Write the demo page**

Create `examples/dom-authoring/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>OpenLaszlo — DOM-authored demo</title>
  <script type="module" src="../../startup/laszlo-dom.js"></script>
</head>
<body style="font:14px sans-serif;margin:16px">
  <h2>DOM-authored LZX (Slice 1 demo)</h2>
  <p>The colored boxes below are the <em>authored elements</em> — inspect them:
     the <code>&lt;view&gt;</code> tags you see in this file's source are the
     live nodes of the running app.</p>

  <laszlo-app width="640" height="420" bgcolor="#eef2f7">
    <view name="panel" x="20" y="20" width="400" height="260" bgcolor="#ffffff">
      <attribute name="grow" type="boolean" value="false"></attribute>
      <view name="bar" x="10" y="10" width="${parent.width - 20}" height="28" bgcolor="#4a6fb0">
        <handler event="onclick">
          <script type="text/typescript">
            const p = this.parent as any;
            p.setAttribute('height', p.grow ? 260 : 320);
            p.setAttribute('grow', !p.grow);
          </script>
        </handler>
      </view>
      <view name="stack" x="10" y="48" width="120" height="180">
        <view width="120" height="36" bgcolor="#c0504d"></view>
        <view width="120" height="36" bgcolor="#9bbb59"></view>
        <view width="120" height="36" bgcolor="#8064a2"></view>
        <simplelayout axis="y" spacing="8"></simplelayout>
      </view>
    </view>
  </laszlo-app>
</body>
</html>
```

- [ ] **Step 4: Write the dialect quick reference**

Create `examples/dom-authoring/README.md`:

```markdown
# DOM-authored LZX (Slice 1)

Author LZX as native HTML inside `<laszlo-app>` (or a separate file via
`<laszlo-app src="app.html">`), served from the distro root:

    node tools/serve-static.mjs . 8087
    open http://localhost:8087/examples/dom-authoring/

## Dialect rules (full spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md)

- The app root is `<laszlo-app width height bgcolor …>` (= LZX `<canvas>`).
  A literal `<canvas>` tag is forbidden.
- Code is **TypeScript**, in typed carriers:
  `<script type="text/typescript">…</script>` inside
  `<method>/<handler>/<setter>` (or standalone for top-level scripts).
  `type="text/lzs"` passes raw LZX Script through (for `is` / `cast`).
  Bare `<script>` is an error (the page parser would execute it).
- Tags that collide with HTML need the `lz-` prefix:
  `lz-style`, `lz-image`, `lz-html`, `lz-form`, `lz-button`, `lz-label`,
  `lz-menu`, `lz-param`. (Any LZX tag may be prefixed.)
- Lowercase only: user class names, attribute and event names.
- No self-closing custom tags: write `<view></view>`, not `<view/>`.
- Inline datasets use `<script type="application/xml">…</script>` (single XML
  root) or `src=` files.
- Statically-authored plain `<view>`s are **adopted**: the element you wrote is
  the live `__LZdiv` of its sprite. `<text>`/`<inputtext>`, replicated and
  class-instantiated views render into created elements (Slice-1 fallback).
- Production build only (no `?debug` source-line mapping for DOM-authored apps).
```

- [ ] **Step 5: Commit**

```bash
git add startup/laszlo-dom.js examples/dom-authoring/index.html examples/dom-authoring/README.md
git commit -m "startup: laszlo-dom.js bootstrap + DOM-authored demo app"
```

---

### Task 10: In-browser equivalence corpus + end-to-end verification

**Files:**
- Create: `examples/dom-authoring/equivalence.html`
- No compiler changes expected; fixes go where the failure is.

**Interfaces:**
- Consumes: `domToXmlElem`, `parseXml` from the bundle (Task 6); the demo (Task 9).
- Produces: the spec's Testing #1 (real-HTML-parser equivalence), #2 (adoption identity, sibling order), #5 (behavior) — all green.

- [ ] **Step 1: Write the equivalence page**

Create `examples/dom-authoring/equivalence.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>DOM ↔ XML-text equivalence</title></head>
<body style="font:13px monospace">
<h2>DOM/text equivalence corpus (spec Testing #1)</h2>
<div id="out">running…</div>
<script type="module">
import { domToXmlElem, parseXml } from "../../compiler/lzc-browser.js";

// Strip the contract's excluded fields: source positions + cdata (spec Seam 1).
function strip(n) {
  if (n.type === "elem") {
    delete n.line; delete n.endLine; delete n.endCol; delete n.closeLine;
    delete n.attrLines; delete n.origin;
    n.children.forEach(strip);
  } else { delete n.line; delete n.cdata; }
  return n;
}

// Each case: the SAME app in both dialects. Code uses text/lzs carriers so no
// transpile is involved (transpile equivalence is ts-carrier.test.mjs's job).
// Whitespace is written identically on both sides — the contract compares
// text nodes verbatim.
const CASES = [
  {
    name: "basic tree + attrs",
    html: '<laszlo-app width="100" height="50"><view x="1" bgcolor="#ff0000"><view width="10"></view></view></laszlo-app>',
    lzx: '<canvas width="100" height="50"><view x="1" bgcolor="#ff0000"><view width="10"></view></view></canvas>',
  },
  {
    name: "lz- prefixed colliding tags",
    html: '<laszlo-app><lz-image src="a.png"></lz-image></laszlo-app>',
    lzx: '<canvas><image src="a.png"></image></canvas>',
  },
  {
    name: "multi-line attribute value normalizes",
    html: '<laszlo-app><view onclick="a=1;\n\tb=2;"></view></laszlo-app>',
    lzx: '<canvas><view onclick="a=1;\n\tb=2;"></view></canvas>',
  },
  {
    name: "method body via lzs carrier == XML text body",
    html: '<laszlo-app><method name="f" args="n"><script type="text/lzs">return n*2;<\/script></method></laszlo-app>',
    lzx: '<canvas><method name="f" args="n">return n*2;</method></canvas>',
  },
  {
    // NOTE the asymmetry, which is the dialect's whole point: HTML <script> is
    // RAW TEXT (no entity decoding — && stays &&), while the XML side must
    // escape it as &amp;&amp; (which parseXml decodes back to &&).
    name: "top-level script carrier == <script> (raw text vs XML escaping)",
    html: '<laszlo-app><script type="text/lzs">var a = 1 && 2;<\/script></laszlo-app>',
    lzx: '<canvas><script>var a = 1 &amp;&amp; 2;</script></canvas>',
  },
  {
    name: "dataset xml carrier == inline dataset XML",
    html: '<laszlo-app><dataset name="d"><script type="application/xml"><items><item x="1"></item></items><\/script></dataset></laszlo-app>',
    lzx: '<canvas><dataset name="d"><items><item x="1"></item></items></dataset></canvas>',
  },
  {
    name: "core entities in text",
    html: '<laszlo-app><view><text>a &amp; b &lt; c</text></view></laszlo-app>',
    lzx: '<canvas><view><text>a &amp; b &lt; c</text></view></canvas>',
  },
];

const out = document.getElementById("out");
out.textContent = "";
let fails = 0;
for (const c of CASES) {
  let line;
  try {
    const dom = new DOMParser().parseFromString(c.html, "text/html").querySelector("laszlo-app");
    const a = JSON.stringify(strip(domToXmlElem(dom)));
    const b = JSON.stringify(strip(parseXml(c.lzx)));
    const ok = a === b;
    if (!ok) fails++;
    line = (ok ? "PASS  " : "FAIL  ") + c.name + (ok ? "" : "\n  dom: " + a + "\n  xml: " + b);
  } catch (e) {
    fails++;
    line = "ERROR " + c.name + ": " + e.message;
  }
  const div = document.createElement("div");
  div.textContent = line;
  div.style.color = line.startsWith("PASS") ? "#080" : "#a00";
  out.appendChild(div);
}
const sum = document.createElement("h3");
sum.id = "summary";
sum.textContent = fails === 0 ? "ALL PASS (" + CASES.length + ")" : fails + " FAILURES";
out.appendChild(sum);
</script>
</body>
</html>
```

(The `<\/script>` escapes inside the string literals are required — they are inside a real `<script type="module">`.)

- [ ] **Step 2: Serve the distro and run the equivalence corpus**

```bash
cd /Users/maxcarlsonold/openlaszlo-5.0 && node tools/serve-static.mjs . 8087 &
```

Load `http://localhost:8087/examples/dom-authoring/equivalence.html` in a real browser (use the Playwright tools if available, else manually).
Expected: the `#summary` element reads `ALL PASS (7)`. Fix `domsource.ts` for any FAIL (rebuild + re-bundle: `cd compiler && npm run build && npm run bundle:browser`), re-load, repeat until green.

- [ ] **Step 3: Verify the demo end-to-end**

Load `http://localhost:8087/examples/dom-authoring/index.html`. Verify, in order:

1. **It renders**: a white panel on the `#eef2f7` canvas, blue bar, three colored boxes stacked vertically with 8px gaps (`simplelayout` working).
2. **Adoption identity** (spec Testing #2) — run in the console:
   ```js
   [...document.querySelectorAll("[data-lz-adopt]")].map(el =>
     !!(el.owner && el.owner.__LZdiv === el && el.owner.owner))
   ```
   Expected: an array of `true` (one per authored plain view: panel, bar, stack — the three stack children are also stamped: 6 total).
3. **Sibling order preserved**: the three stack boxes appear red, green, purple top-to-bottom (authored order).
4. **Constraint works** (`${parent.width - 20}`): the bar is 380px wide:
   ```js
   document.querySelector('[data-lz-adopt]') /* panel */; // then:
   [...document.querySelectorAll("[data-lz-adopt]")].find(e => getComputedStyle(e).backgroundColor === "rgb(74, 111, 176)").offsetWidth
   ```
   Expected: `380`.
5. **TS handler works**: click the blue bar — the panel's height grows to 320px; click again — back to 260px.
6. **No leftover source junk**: `document.querySelector("laszlo-app script, laszlo-app method, laszlo-app handler, laszlo-app attribute")` → `null`.
7. **Console**: no `lz-adopt:` warnings, no errors.

Any failure: debug at the failing seam (bootstrap → compile output → patch), fix, re-verify. Do NOT weaken the checks.

- [ ] **Step 4: Regression-check the text path end-to-end**

Load `http://localhost:8087/` (the Explorer, compiled by the service worker).
Expected: loads and runs exactly as before (spot-check one example app). This confirms the bundle changes didn't disturb the text path.

- [ ] **Step 5: Full test suite + final commit**

```bash
cd compiler && npm test
cd .. && git add examples/dom-authoring/equivalence.html
git commit -m "examples: in-browser DOM/text equivalence corpus + verified Slice-1 demo"
```

Expected: all unit tests PASS; working tree clean after commit.

---

## Deferred to the Slice-2 plan (do not build here)

Per spec: `lfc.d.ts` generation, per-app declaration synthesis, the `lzx-check` CLI, text/inputtext adoption, rootXml compile caching, in-browser diagnostics overlay, and all dreem2 backend ideas.
