# DOM-Native Authoring Slice 2 — App-Aware TypeScript Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lzx-check` — a dev-time Node CLI that type-checks DOM-authored apps: generated `lfc.d.ts` (from the compiler's oracle schema), per-app declarations synthesized from `<class>`/`<attribute>`/ids/named children, and every TS body checked with a typed `this`.

**Architecture:** Four pure modules layered onto Slice 1: `htmlsource.ts` (a minimal dependency-free HTML-dialect parser for Node — raw-text `<script>`, void elements, line tracking), `lfc-dts.ts` (SCHEMA/SCHEMA_EVENTS → `lfc.d.ts`, committed artifact), `app-model.ts` (dialect tree → AppModel: classes, instance types, code bodies with source lines), `app-dts.ts` (AppModel → app `.d.ts` + a bodies file with a line-span map). `lzx-check.ts` drives `tsc` (the existing `typescript` devDependency) over {lfc.d.ts, app.d.ts, bodies.ts} via an in-memory-overlay CompilerHost and maps diagnostics back to source elements/lines. The browser runtime path is untouched — checking is erasure-independent (strip always succeeds; diagnostics are a dev tool, spec "App-aware type checking").

**Tech Stack:** TypeScript compiler API (`ts.createProgram`, existing devDep), `node --test` harness from Slice 1. Zero new dependencies. Nothing here is bundled into `lzc-browser.js`.

**Spec:** `docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md` §"App-aware type checking (Slice 2)". Read it first.

## Global Constraints

- **Zero new dependencies** — `typescript` (devDep) is the only external module; `lzx-check` is a dev tool, never part of the browser bundle (`browser.ts` must NOT import any Slice-2 module).
- **The `.lzx`-text compile path and `runtime/lfc-src` stay untouched** (byte-parity, as in Slice 1).
- **Checking never blocks running** — `lzx-check` is a separate CLI; the Slice-1 bootstrap pipeline is not modified.
- **Type names are deterministic**: built-ins `Lz<Capitalized-tag>` (`LzView`, `LzCanvas`, …), user classes `LzUser_<name>`, per-instance synthesized types `LzInst_<n>` in document order.
- **`text/lzs` carriers are skipped** (ES4 `is`/`cast` are not TS) and counted in the report.
- Work on branch `dom-authoring-slice2` (created off `dom-authoring-slice1` in Task 1).
- `cd compiler && npm test` green after every task; commit after every task.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `compiler/src/htmlsource.ts` | create | dependency-free HTML-dialect parser → `HtmlElem` (DomElementLike-compatible + `line`) |
| `compiler/src/lfc-dts.ts` | create | `tsTypeOf(schemaType)` + `generateLfcDts()` from SCHEMA/SCHEMA_EVENTS + verified curated methods |
| `compiler/src/app-model.ts` | create | dialect tree → `AppModel` (classes, instances, bodies, ids; owner/payload type resolution) |
| `compiler/src/app-dts.ts` | create | `AppModel` → app `.d.ts` text + bodies file text with `BodySpan[]` line map |
| `compiler/src/lzx-check.ts` | create | `checkApp()` driver (tsc + diagnostics mapping) + CLI (`--write-lfc-dts` mode) |
| `compiler/lfc.d.ts` | generated, committed | the LFC API surface (also usable directly by editors) |
| `compiler/package.json` | modify | `bin` entry `lzx-check`, script `gen:lfcdts` |
| `compiler/test/htmlsource.test.mjs` | create | parser tests |
| `compiler/test/lfc-dts.test.mjs` | create | generator tests incl. "generated d.ts compiles clean" |
| `compiler/test/app-model.test.mjs` | create | extraction tests |
| `compiler/test/lzx-check.test.mjs` | create | end-to-end checker tests over fixtures |
| `compiler/test/fixtures/check-clean.html` | create | zero-diagnostic app |
| `compiler/test/fixtures/check-errors.html` | create | seeds the spec's three error classes |
| `examples/dom-authoring/README.md` | modify | one section on running `lzx-check` |

Data flow: `parseHtmlDialect(src)` → `extractApp(root)` → `generateAppDts(model)` + `generateBodies(model)` → `checkApp` assembles `{lfc.d.ts, __lzapp.d.ts, __lzbodies.ts}`, runs `tsc`, maps diagnostics through `BodySpan[]`.

---

### Task 1: Branch + `htmlsource.ts` — the dialect HTML parser

Node has no DOM; `parseXml` can't read the dialect (raw-text `<script>` bodies contain `<`/`&&`). This parser handles exactly the authored dialect: elements, attributes, comments, doctype, the five core entities + numeric refs, raw-text `script`/`style`, HTML void elements, and line tracking for diagnostics. It is checker-scope only (the browser path keeps using the real parser).

**Files:**
- Create: `compiler/src/htmlsource.ts`
- Test: `compiler/test/htmlsource.test.mjs`

**Interfaces:**
- Consumes: nothing from Slice 1 at runtime (interface-compatible with `DomElementLike` by shape).
- Produces (used by Tasks 3, 5):
  - `interface HtmlNode { nodeType: number; nodeValue?: string | null; line: number }`
  - `interface HtmlElem extends HtmlNode { tagName: string; attributes: {name: string; value: string}[]; childNodes: HtmlNode[]; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void }`
  - `class HtmlDialectError extends Error` (message includes a 1-based line)
  - `function parseHtmlDialect(src: string): HtmlElem[]` — the top-level node sequence (elements only; whitespace/doctype/comments skipped at top level)
  - `function findLaszloApp(tops: HtmlElem[]): HtmlElem` — depth-first search for `<laszlo-app>`; throws `HtmlDialectError` if absent

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/htmlsource.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp, HtmlDialectError } from "../dist/htmlsource.js";

test("elements, attrs, text, comments, lowercasing, lines", () => {
  const tops = parseHtmlDialect('<!doctype html>\n<!-- hi -->\n<LASZLO-APP Width="10">\n  <view x="1">t &amp; u</view>\n</LASZLO-APP>');
  assert.equal(tops.length, 1);
  const app = tops[0];
  assert.equal(app.tagName, "LASZLO-APP");          // DOM-style uppercase tagName
  assert.equal(app.getAttribute("width"), "10");     // attr names lowercased
  assert.equal(app.line, 3);
  const view = app.childNodes.find((c) => c.nodeType === 1);
  assert.equal(view.tagName, "VIEW");
  assert.equal(view.line, 4);
  assert.equal(view.childNodes[0].nodeValue, "t & u"); // entities decoded in text
});

test("script is raw text (no entity decode, markup chars survive)", () => {
  const [app] = parseHtmlDialect('<laszlo-app><method name="f"><script type="text/typescript">if (a < b && c) { return `x${a}`; }</script></method></laszlo-app>');
  const method = app.childNodes[0];
  const script = method.childNodes[0];
  assert.equal(script.tagName, "SCRIPT");
  assert.equal(script.childNodes[0].nodeValue, "if (a < b && c) { return `x${a}`; }");
});

test("script raw-text line number points at the code start", () => {
  const [app] = parseHtmlDialect('<laszlo-app>\n<handler name="onclick">\n<script type="text/typescript">\nreturn 1;\n</script>\n</handler>\n</laszlo-app>');
  const handler = app.childNodes.find((c) => c.nodeType === 1);
  const script = handler.childNodes.find((c) => c.nodeType === 1);
  assert.equal(script.childNodes[0].line, 3); // the text node BEGINS on the <script> line (right after '>')
});

test("void elements take no children; style is raw text", () => {
  const tops = parseHtmlDialect('<html><head><meta charset="utf-8"><style>a{}</style></head><body><laszlo-app></laszlo-app></body></html>');
  const app = findLaszloApp(tops);
  assert.equal(app.tagName, "LASZLO-APP");
});

test("self-closing slash on a custom tag is ignored (HTML behavior), so it must still be closed", () => {
  const [app] = parseHtmlDialect("<laszlo-app><view/></view></laszlo-app>");
  assert.equal(app.childNodes[0].tagName, "VIEW");
});

test("mismatched close tag throws with line", () => {
  assert.throws(() => parseHtmlDialect("<laszlo-app><view>\n</wiew></laszlo-app>"), HtmlDialectError, /line 2/);
});

test("findLaszloApp throws when absent", () => {
  assert.throws(() => findLaszloApp(parseHtmlDialect("<div></div>")), HtmlDialectError);
});
```

- [ ] **Step 2: Create the branch, run tests to verify failure**

```bash
git checkout -b dom-authoring-slice2
cd compiler && npm test
```
Expected: FAIL — `Cannot find module '../dist/htmlsource.js'`.

- [ ] **Step 3: Implement**

Create `compiler/src/htmlsource.ts`:

```ts
// htmlsource.ts — minimal HTML-dialect parser for lzx-check (Node has no DOM).
// Parses exactly the DOM-authoring dialect (spec: docs/superpowers/specs/
// 2026-07-05-dom-native-authoring-design.md): elements, attributes, comments,
// doctype, five core entities + numeric refs, RAW-TEXT script/style, HTML void
// elements — with 1-based line tracking for diagnostics. Checker-scope only;
// the browser path keeps using the real HTML parser. Dependency-free.

export interface HtmlNode { nodeType: number; nodeValue?: string | null; line: number }
export interface HtmlElem extends HtmlNode {
  tagName: string;
  attributes: { name: string; value: string }[];
  childNodes: HtmlNode[];
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
}
export class HtmlDialectError extends Error {}

const ELEMENT = 1, TEXT = 3, COMMENT = 8;
const RAW_TEXT = new Set(["script", "style"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

function decodeEnt(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return body.toLowerCase() in ENTITIES ? ENTITIES[body.toLowerCase()] : m;
  });
}

function makeElem(tag: string, line: number): HtmlElem {
  const attributes: { name: string; value: string }[] = [];
  return {
    nodeType: ELEMENT, line, tagName: tag.toUpperCase(), attributes, childNodes: [],
    getAttribute(n) { const a = attributes.find((x) => x.name === n); return a ? a.value : null; },
    setAttribute(n, v) {
      const a = attributes.find((x) => x.name === n);
      if (a) a.value = String(v); else attributes.push({ name: n, value: String(v) });
    },
  };
}

export function parseHtmlDialect(src: string): HtmlElem[] {
  let i = 0, line = 1;
  const n = src.length;
  const err = (msg: string): never => { throw new HtmlDialectError(`${msg} (line ${line})`); };
  const advance = (to: number) => { for (; i < to; i++) if (src[i] === "\n") line++; };

  function skipDoctypeOrComment(): boolean {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) err("unterminated comment");
      advance(end + 3);
      return true;
    }
    if (src.startsWith("<!", i)) { // doctype / other declarations
      const end = src.indexOf(">", i);
      if (end < 0) err("unterminated <! declaration");
      advance(end + 1);
      return true;
    }
    return false;
  }

  /** Parse attributes up to (not consuming) the closing `>` or `/>`. */
  function parseAttrs(el: HtmlElem): void {
    for (;;) {
      while (i < n && /\s/.test(src[i])) advance(i + 1);
      if (i >= n) err(`unterminated <${el.tagName.toLowerCase()}> tag`);
      if (src[i] === ">" || (src[i] === "/" && src[i + 1] === ">")) return;
      const m = /^[^\s=/>]+/.exec(src.slice(i));
      if (!m) err("malformed attribute");
      const name = m![0].toLowerCase();
      advance(i + m![0].length);
      while (i < n && /\s/.test(src[i])) advance(i + 1);
      let value = "";
      if (src[i] === "=") {
        advance(i + 1);
        while (i < n && /\s/.test(src[i])) advance(i + 1);
        const q = src[i];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, i + 1);
          if (end < 0) err(`unterminated attribute value for ${name}`);
          value = decodeEnt(src.slice(i + 1, end));
          advance(end + 1);
        } else {
          const m2 = /^[^\s>]*/.exec(src.slice(i));
          value = decodeEnt(m2![0]);
          advance(i + m2![0].length);
        }
      }
      el.setAttribute(name, value);
    }
  }

  function parseElement(): HtmlElem {
    // at '<' followed by a name char
    const startLine = line;
    advance(i + 1);
    const m = /^[a-zA-Z][^\s/>]*/.exec(src.slice(i));
    if (!m) err("malformed start tag");
    const tag = m![0].toLowerCase();
    advance(i + m![0].length);
    const el = makeElem(tag, startLine);
    parseAttrs(el);
    if (src[i] === "/" && src[i + 1] === ">") advance(i + 2); // slash ignored (HTML) — still needs a close tag unless void
    else advance(i + 1); // consume '>'

    if (VOID.has(tag)) return el;

    if (RAW_TEXT.has(tag)) {
      const textLine = line;
      const close = src.toLowerCase().indexOf("</" + tag, i);
      if (close < 0) err(`unterminated <${tag}> raw text`);
      const raw = src.slice(i, close);
      if (raw.length) el.childNodes.push({ nodeType: TEXT, nodeValue: raw, line: textLine });
      advance(close);
      const end = src.indexOf(">", i);
      if (end < 0) err(`unterminated </${tag}>`);
      advance(end + 1);
      return el;
    }

    // children until matching close tag
    for (;;) {
      if (i >= n) err(`unclosed <${tag}>`);
      if (src.startsWith("</", i)) {
        advance(i + 2);
        const cm = /^[a-zA-Z][^\s>]*/.exec(src.slice(i));
        const closeName = cm ? cm[0].toLowerCase() : "";
        if (closeName !== tag) err(`mismatched </${closeName}>, expected </${tag}>`);
        advance(i + closeName.length);
        const end = src.indexOf(">", i);
        if (end < 0) err(`unterminated </${tag}>`);
        advance(end + 1);
        return el;
      }
      if (src[i] === "<" && skipDoctypeOrComment()) continue;
      if (src[i] === "<" && /[a-zA-Z]/.test(src[i + 1] ?? "")) { el.childNodes.push(parseElement()); continue; }
      // text run
      const textLine = line;
      let j = i;
      while (j < n && !(src[j] === "<" && (src[j + 1] === "/" || src[j + 1] === "!" || /[a-zA-Z]/.test(src[j + 1] ?? "")))) j++;
      if (j === i) j++; // lone '<' — consume as text
      const t = src.slice(i, j);
      advance(j);
      el.childNodes.push({ nodeType: TEXT, nodeValue: decodeEnt(t), line: textLine });
    }
  }

  const tops: HtmlElem[] = [];
  while (i < n) {
    if (src[i] === "<") {
      if (skipDoctypeOrComment()) continue;
      if (/[a-zA-Z]/.test(src[i + 1] ?? "")) { tops.push(parseElement()); continue; }
    }
    if (!/\s/.test(src[i])) err(`unexpected content at top level: ${JSON.stringify(src.slice(i, i + 12))}`);
    advance(i + 1);
  }
  return tops;
}

/** Depth-first search for the <laszlo-app> element. */
export function findLaszloApp(tops: HtmlElem[]): HtmlElem {
  const stack = [...tops];
  while (stack.length) {
    const el = stack.shift()!;
    if (el.tagName === "LASZLO-APP") return el;
    for (const c of el.childNodes) if (c.nodeType === ELEMENT) stack.push(c as HtmlElem);
  }
  throw new HtmlDialectError("no <laszlo-app> element found");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: all Slice-1 tests + 7 new ones PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/htmlsource.ts compiler/test/htmlsource.test.mjs
git commit -m "compiler: htmlsource.ts — dependency-free dialect HTML parser for lzx-check"
```

---

### Task 2: `lfc-dts.ts` — generate and commit `lfc.d.ts`

**Files:**
- Create: `compiler/src/lfc-dts.ts`
- Test: `compiler/test/lfc-dts.test.mjs`
- Generated + committed (in Task 5, once the CLI exists): `compiler/lfc.d.ts`

**Interfaces:**
- Consumes: `SCHEMA`, `SCHEMA_EVENTS` from `./schema-types.js` (existing).
- Produces (used by Tasks 3, 4, 5):
  - `function tsTypeOf(schemaType: string): string` — schema type string → TS type text
  - `function builtinTsName(tag: string): string | null` — `view`→`"LzView"`, … ; null if not an emitted built-in
  - `function generateLfcDts(): string`

Type mapping (locked): `number`/`numberExpression` → `number`; `size`/`sizeExpression` → `number | string` (percent strings); `boolean`/`inheritableBoolean` → `boolean`; `color` → `string | number`; `css`/`expression`/`node`/`reference` → `any`; everything else (`string`, `token`, `text`, `ID`, `script`, …) → `string`.

Emitted classes (the node/view lineage): `node, animatorgroup, animator, contextmenu, contextmenuitem, datapointer, datapath, dataset, state, view, canvas, text, inputtext` — TS names `Lz` + capitalized tag (`LzView`, `LzInputtext`? No: keep the LFC's real names for the four everyone knows: `text`→`LzText`, `inputtext`→`LzInputText`; everything else `Lz`+capitalize-first-letter).

Curated members (verified against `runtime/lfc-src` during planning — LzNode.lzs:2301, :2222; LaszloView.lzs:2854, :2926, :2986):
- `LzNode`: strict `setAttribute<K extends keyof this & string>(name: K, value: this[K]): void` (catches misspelled attr names AND wrong-typed values; escape hatch is `(this as any)`), `destroy(): void`, `animate(prop: string, to: number, duration: number, isRelative?: boolean | null, moreargs?: Record<string, any> | null): any`.
- `LzView` adds: `bringToFront(): void`, `sendToBack(): void`, `setSource(source: string, cache?: any, headers?: any, filetype?: any): void`.
- Relational overrides (schema types them as `string`, which is wrong for DX): `parent: any` is NOT used — emit `parent: LzNode`, `immediateparent: LzNode`, `classroot: LzNode`, `subnodes: LzNode[]` on LzNode; `subviews: LzView[]` on LzView.
- Skip schema attrs whose names start with `$` or equal `with`.
- Events (from `SCHEMA_EVENTS`): each as a property `onclick: any;` on its class.
- Globals: `declare const canvas: LzCanvas; declare const lz: any; declare const Debug: any; declare var $debug: boolean;`

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/lfc-dts.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { generateLfcDts, tsTypeOf, builtinTsName } from "../dist/lfc-dts.js";

test("tsTypeOf mapping", () => {
  assert.equal(tsTypeOf("number"), "number");
  assert.equal(tsTypeOf("numberExpression"), "number");
  assert.equal(tsTypeOf("size"), "number | string");
  assert.equal(tsTypeOf("inheritableBoolean"), "boolean");
  assert.equal(tsTypeOf("color"), "string | number");
  assert.equal(tsTypeOf("expression"), "any");
  assert.equal(tsTypeOf("token"), "string");
});

test("builtinTsName", () => {
  assert.equal(builtinTsName("view"), "LzView");
  assert.equal(builtinTsName("text"), "LzText");
  assert.equal(builtinTsName("inputtext"), "LzInputText");
  assert.equal(builtinTsName("canvas"), "LzCanvas");
  assert.equal(builtinTsName("simplelayout"), null); // components are not in the emitted set
});

test("generated d.ts has the expected shape", () => {
  const dts = generateLfcDts();
  assert.ok(dts.includes("declare class LzView extends LzNode"));
  assert.ok(dts.includes("width: number | string;"));            // size
  assert.ok(dts.includes("bgcolor: string | number;"));          // color
  assert.ok(dts.includes("x: number;"));                         // numberExpression
  assert.ok(dts.includes("setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;"));
  assert.ok(dts.includes("onclick: any;"));                      // SCHEMA_EVENTS
  assert.ok(dts.includes("parent: LzNode;"));                    // relational override
  assert.ok(dts.includes("declare const canvas: LzCanvas;"));
  assert.ok(!dts.includes("$lzc$"));                             // $-attrs skipped
});

test("generated d.ts compiles clean under tsc", () => {
  const dts = generateLfcDts();
  const host = ts.createCompilerHost({});
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVer) =>
    name === "lfc.d.ts" ? ts.createSourceFile(name, dts, langVer, true) : orig(name, langVer);
  host.fileExists = ((oe) => (n) => n === "lfc.d.ts" || oe(n))(host.fileExists.bind(host));
  const prog = ts.createProgram(["lfc.d.ts"], { noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"] }, host);
  const diags = [...prog.getSyntacticDiagnostics(), ...prog.getSemanticDiagnostics()];
  assert.deepEqual(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")), []);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (`Cannot find module '../dist/lfc-dts.js'`).

- [ ] **Step 3: Implement**

Create `compiler/src/lfc-dts.ts`:

```ts
// lfc-dts.ts — generate lfc.d.ts from the compiler's oracle schema
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md,
// "App-aware type checking", layer 1). SCHEMA carries class -> extends +
// attr types; SCHEMA_EVENTS carries per-class event names. Methods are a
// small curated core VERIFIED against runtime/lfc-src (do not invent APIs).

import { SCHEMA, SCHEMA_EVENTS } from "./schema-types.js";

/** Schema type string -> TS type text. */
export function tsTypeOf(t: string): string {
  switch (t) {
    case "number": case "numberExpression": return "number";
    case "size": case "sizeExpression": return "number | string";
    case "boolean": case "inheritableBoolean": return "boolean";
    case "color": return "string | number";
    case "css": case "expression": case "node": case "reference": return "any";
    default: return "string"; // string, token, text, ID, script, …
  }
}

// The emitted node/view lineage, in dependency order (base before derived).
const EMIT_ORDER = ["node", "animatorgroup", "animator", "contextmenu", "contextmenuitem",
  "datapointer", "datapath", "dataset", "state", "view", "canvas", "text", "inputtext"];
const SPECIAL_NAMES: Record<string, string> = { text: "LzText", inputtext: "LzInputText" };

/** Built-in tag -> emitted TS class name (null when not an emitted built-in). */
export function builtinTsName(tag: string): string | null {
  if (!EMIT_ORDER.includes(tag)) return null;
  return SPECIAL_NAMES[tag] ?? "Lz" + tag[0].toUpperCase() + tag.slice(1);
}

// Relational attrs the schema types as plain strings; override for real DX.
const RELATIONAL: Record<string, string> = {
  parent: "LzNode", immediateparent: "LzNode", classroot: "LzNode", subnodes: "LzNode[]",
};
const VIEW_RELATIONAL: Record<string, string> = { subviews: "LzView[]" };

// Curated methods — verified against runtime/lfc-src (LzNode.lzs:2301/:2222,
// LaszloView.lzs:2854/:2926/:2986). The strict setAttribute catches both
// misspelled attribute names and wrong-typed values; escape: (this as any).
const NODE_METHODS = [
  "setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;",
  "destroy(): void;",
  "animate(prop: string, to: number, duration: number, isRelative?: boolean | null, moreargs?: Record<string, any> | null): any;",
];
const VIEW_METHODS = [
  "bringToFront(): void;",
  "sendToBack(): void;",
  "setSource(source: string, cache?: any, headers?: any, filetype?: any): void;",
];

export function generateLfcDts(): string {
  const out: string[] = [
    "// AUTO-GENERATED by `node dist/lzx-check.js --write-lfc-dts` from the",
    "// compiler's oracle schema (schema-types.ts). Do not edit by hand.",
    "",
    "declare class LzEventable {}",
    "",
  ];
  for (const tag of EMIT_ORDER) {
    const cls = SCHEMA[tag];
    const name = builtinTsName(tag)!;
    const extTag = cls.ext && EMIT_ORDER.includes(cls.ext) ? builtinTsName(cls.ext)! : "LzEventable";
    out.push(`declare class ${name} extends ${extTag} {`);
    if (tag === "node") out.push(`  constructor(parent?: LzNode, attrs?: Record<string, any>);`);
    for (const [attr, sType] of Object.entries(cls.attrs)) {
      if (attr.startsWith("$") || attr === "with") continue;
      const override = tag === "node" ? RELATIONAL[attr] : tag === "view" ? VIEW_RELATIONAL[attr] : undefined;
      out.push(`  ${attr}: ${override ?? tsTypeOf(sType)};`);
    }
    for (const ev of SCHEMA_EVENTS[tag] ?? []) out.push(`  ${ev}: any;`);
    if (tag === "node") for (const m of NODE_METHODS) out.push("  " + m);
    if (tag === "view") for (const m of VIEW_METHODS) out.push("  " + m);
    out.push("}", "");
  }
  out.push(
    "declare const canvas: LzCanvas;",
    "declare const lz: any;",
    "declare const Debug: any;",
    "declare var $debug: boolean;",
    "");
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS. If the "compiles clean" test reports duplicate-identifier or shadowing diagnostics, fix the generator (not the test) — e.g. an attr colliding with an event name must emit only once (attrs win; skip the event property if the name already emitted for that class).

- [ ] **Step 5: Commit**

```bash
git add compiler/src/lfc-dts.ts compiler/test/lfc-dts.test.mjs
git commit -m "compiler: lfc-dts.ts — generate lfc.d.ts from the oracle schema + curated core"
```

---

### Task 3: `app-model.ts` — per-app extraction

**Files:**
- Create: `compiler/src/app-model.ts`
- Test: `compiler/test/app-model.test.mjs`

**Interfaces:**
- Consumes: `HtmlElem` (Task 1), `builtinTsName`, `tsTypeOf` (Task 2), `schemaAttrType` from `./schema-types.js`.
- Produces (used by Tasks 4, 5):

```ts
export interface AppAttr { name: string; tsType: string }
export interface BodyParam { name: string; tsType: string }
export interface BodyInfo {
  label: string;          // e.g. `<handler name="onclick"> in <view name="bar">`
  ownerType: string;      // TS type name for `this`
  params: BodyParam[];
  code: string;
  srcLine: number;        // 1-based line of the body text in the source file
}
export interface AppClassModel {
  tsName: string;         // LzUser_<name>
  extTsName: string;
  attrs: AppAttr[];
  methodSigs: string[];   // e.g. "f(a: any, b: any): any;"
}
export interface AppInstanceModel {
  tsName: string;         // LzInst_<n>, document order
  baseTsName: string;
  attrs: AppAttr[];       // instance-level <attribute> declarations
  namedChildren: { name: string; tsName: string }[];
  id?: string;
}
export interface AppModel {
  classes: AppClassModel[];
  instances: AppInstanceModel[];
  bodies: BodyInfo[];
  skippedLzs: number;     // text/lzs carriers not checked
}
export function extractApp(root: HtmlElem): AppModel
```

**Extraction rules (locked):**
- Tag names: lowercase `tagName`, strip a leading `lz-`. `laszlo-app` root → base `LzCanvas`.
- Owner type resolution for a tag: user `<class name=x>` → `LzUser_x`; `builtinTsName(tag)` if non-null; otherwise `LzView` (assumed user view class from an include — documented).
- Every element that is an app *instance* (the root, plus any element that is not one of `attribute/method/handler/setter/script/class/interface/mixin/dataset/include/font/resource`) gets an `AppInstanceModel` with a synthesized `LzInst_<n>` type extending its base; `name="x"` on a child adds `x: LzInst_<child>` to the PARENT instance's `namedChildren`; `id="y"` records `id`.
- `<class name="rec" extends="view">`: attrs from `<attribute name= type=>` children (type map: same `tsTypeOf` keys; missing/unknown type → `any` — LZX's default attribute type is expression); `<method name="f" args="a,b">` → `methodSigs` entry `f(a: any, b: any): any;`; bodies inside the class get `ownerType = LzUser_rec`. Class subtrees do NOT produce `AppInstanceModel`s (they are templates).
- **Bodies**: `<method>/<handler>/<setter>` with a `text/typescript` carrier (or plain text) produce a `BodyInfo`; `text/lzs` carriers increment `skippedLzs`. `srcLine` = the carrier text node's `line` (or the plain text node's).
- **Params**: `<method args="a, b">` → `a: any, b: any`. `<handler name="onXYZ" args="v">` → `v` typed by resolving attr `XYZ`: (1) instance/class declared `<attribute>` walking the user-extends chain, (2) `schemaAttrType(baseTag, "XYZ")` → `tsTypeOf`, else `any`. `<setter name="w" args="v">` → same resolution for attr `w`.
- `<dataset>` subtrees are data: skipped entirely.

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/app-model.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";

const app = (html) => extractApp(findLaszloApp(parseHtmlDialect(html)));

test("instances get document-order LzInst types; named children and ids recorded", () => {
  const m = app('<laszlo-app><view name="panel" id="p1"><view name="bar"></view></view></laszlo-app>');
  assert.equal(m.instances[0].tsName, "LzInst_1");        // the canvas root
  assert.equal(m.instances[0].baseTsName, "LzCanvas");
  assert.equal(m.instances[1].tsName, "LzInst_2");
  assert.equal(m.instances[1].baseTsName, "LzView");
  assert.equal(m.instances[1].id, "p1");
  assert.deepEqual(m.instances[0].namedChildren, [{ name: "panel", tsName: "LzInst_2" }]);
  assert.deepEqual(m.instances[1].namedChildren, [{ name: "bar", tsName: "LzInst_3" }]);
});

test("instance <attribute> declarations become typed attrs", () => {
  const m = app('<laszlo-app><view><attribute name="count" type="number" value="0"></attribute><attribute name="tag"></attribute></view></laszlo-app>');
  assert.deepEqual(m.instances[1].attrs, [{ name: "count", tsType: "number" }, { name: "tag", tsType: "any" }]);
});

test("user classes: attrs, method sigs, body owner; template makes no instances", () => {
  const m = app('<laszlo-app><class name="rec" extends="view"><attribute name="hue" type="color"></attribute><method name="f" args="a, b"><script type="text/typescript">return a;</script></method><view></view></class></laszlo-app>');
  assert.equal(m.classes.length, 1);
  assert.equal(m.classes[0].tsName, "LzUser_rec");
  assert.equal(m.classes[0].extTsName, "LzView");
  assert.deepEqual(m.classes[0].attrs, [{ name: "hue", tsType: "string | number" }]);
  assert.deepEqual(m.classes[0].methodSigs, ["f(a: any, b: any): any;"]);
  assert.equal(m.instances.length, 1);                    // only the canvas root
  assert.equal(m.bodies.length, 1);
  assert.equal(m.bodies[0].ownerType, "LzUser_rec");
  assert.deepEqual(m.bodies[0].params, [{ name: "a", tsType: "any" }, { name: "b", tsType: "any" }]);
});

test("handler payload typed from the declared attribute; setter arg likewise", () => {
  const m = app('<laszlo-app><view><attribute name="count" type="number"></attribute>' +
    '<handler name="oncount" args="c"><script type="text/typescript">return c;</script></handler>' +
    '<handler name="onwidth" args="w"><script type="text/typescript">return w;</script></handler>' +
    '<handler name="onclick" args="e"><script type="text/typescript">return e;</script></handler>' +
    '<setter name="count" args="v"><script type="text/typescript">return v;</script></setter>' +
    "</view></laszlo-app>");
  const [oncount, onwidth, onclick, setcount] = m.bodies;
  assert.deepEqual(oncount.params, [{ name: "c", tsType: "number" }]);          // declared attr
  assert.deepEqual(onwidth.params, [{ name: "w", tsType: "number | string" }]); // schema size
  assert.deepEqual(onclick.params, [{ name: "e", tsType: "any" }]);             // non-attr event
  assert.deepEqual(setcount.params, [{ name: "v", tsType: "number" }]);
  assert.equal(oncount.ownerType, "LzInst_2");
});

test("text/lzs carriers skipped and counted; dataset subtrees skipped; srcLine recorded", () => {
  const m = app('<laszlo-app>\n<view>\n<handler name="onclick"><script type="text/lzs">if (this is LzView) x();</script></handler>\n<method name="g">\n<script type="text/typescript">\nreturn 1;\n</script>\n</method>\n</view>\n<dataset name="d"><script type="application/xml"><r></r></script></dataset>\n</laszlo-app>');
  assert.equal(m.skippedLzs, 1);
  assert.equal(m.bodies.length, 1);
  assert.equal(m.bodies[0].srcLine, 5); // the <script> line; code starts right after '>'
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `compiler/src/app-model.ts`:

```ts
// app-model.ts — extract the checkable model of a DOM-authored app
// (spec "App-aware type checking", layer 2): user classes, per-instance
// synthesized types (named children, ids, instance attributes), and every
// TypeScript code body with a typed owner and typed params.

import type { HtmlElem, HtmlNode } from "./htmlsource.js";
import { builtinTsName, tsTypeOf } from "./lfc-dts.js";
import { schemaAttrType } from "./schema-types.js";

export interface AppAttr { name: string; tsType: string }
export interface BodyParam { name: string; tsType: string }
export interface BodyInfo { label: string; ownerType: string; params: BodyParam[]; code: string; srcLine: number }
export interface AppClassModel { tsName: string; extTsName: string; attrs: AppAttr[]; methodSigs: string[] }
export interface AppInstanceModel { tsName: string; baseTsName: string; attrs: AppAttr[]; namedChildren: { name: string; tsName: string }[]; id?: string }
export interface AppModel { classes: AppClassModel[]; instances: AppInstanceModel[]; bodies: BodyInfo[]; skippedLzs: number }

const ELEMENT = 1, TEXT = 3;
const NON_INSTANCE = new Set(["attribute", "method", "handler", "setter", "script",
  "class", "interface", "mixin", "dataset", "include", "font", "resource"]);

// LZX <attribute type=…> vocabulary → TS (shares tsTypeOf keys; default any —
// LZX's default attribute type is `expression`).
function attrDeclTsType(t: string | null): string {
  if (!t) return "any";
  if (t === "expression" || t === "html") return "any";
  return tsTypeOf(t);
}

const tagOf = (el: HtmlElem): string => {
  const t = el.tagName.toLowerCase();
  return t === "laszlo-app" ? "canvas" : t.startsWith("lz-") ? t.slice(3) : t;
};
const elemChildren = (el: HtmlElem): HtmlElem[] =>
  [...el.childNodes].filter((c): c is HtmlElem => c.nodeType === ELEMENT);
const textOf = (el: HtmlElem): { code: string; line: number } => {
  const t = [...el.childNodes].find((c): c is HtmlNode => c.nodeType === TEXT);
  return { code: t?.nodeValue ?? "", line: t?.line ?? el.line };
};

export function extractApp(root: HtmlElem): AppModel {
  const model: AppModel = { classes: [], instances: [], bodies: [], skippedLzs: 0 };
  const userClasses = new Map<string, AppClassModel>();
  let instSeq = 0;

  // Resolve an attribute's TS type on an owner: declared attrs (walking the
  // user-extends chain), then the built-in schema, else any.
  function resolveAttrType(name: string, declared: AppAttr[], baseTag: string, extChain: string[]): string {
    const d = declared.find((a) => a.name === name);
    if (d) return d.tsType;
    for (const cn of extChain) {
      const c = userClasses.get(cn);
      const ca = c?.attrs.find((a) => a.name === name);
      if (ca) return ca.tsType;
    }
    const s = schemaAttrType(baseTag, name);
    return s ? tsTypeOf(s) : "any";
  }

  // Collect a code body from <method>/<handler>/<setter>. Returns null for
  // lzs carriers (counted) and empty bodies.
  function collectBody(el: HtmlElem, ownerType: string, ownerDesc: string, params: BodyParam[]): void {
    const carrier = elemChildren(el).find((c) => c.tagName === "SCRIPT");
    let code: string, line: number;
    if (carrier) {
      const type = (carrier.getAttribute("type") ?? "").trim().toLowerCase();
      if (type === "text/lzs") { model.skippedLzs++; return; }
      ({ code, line } = textOf(carrier));
    } else {
      ({ code, line } = textOf(el));
    }
    if (code.trim() === "") return;
    const nameAttr = el.getAttribute("name") ?? "";
    model.bodies.push({
      label: `<${el.tagName.toLowerCase()} name="${nameAttr}"> in ${ownerDesc}`,
      ownerType, params, code, srcLine: line,
    });
  }

  function bodyParams(el: HtmlElem, kind: string, declared: AppAttr[], baseTag: string, extChain: string[]): BodyParam[] {
    const args = (el.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
    if (args.length === 0) return [];
    if (kind === "handler") {
      const ev = el.getAttribute("name") ?? "";
      const attr = ev.startsWith("on") ? ev.slice(2) : "";
      const t = attr ? resolveAttrType(attr, declared, baseTag, extChain) : "any";
      return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
    }
    if (kind === "setter") {
      const t = resolveAttrType(el.getAttribute("name") ?? "", declared, baseTag, extChain);
      return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
    }
    return args.map((a) => ({ name: a, tsType: "any" }));
  }

  function walkClass(el: HtmlElem): void {
    const name = el.getAttribute("name") ?? "anonymous";
    const ext = el.getAttribute("extends") ?? "view";
    const extUser = userClasses.get(ext);
    const cls: AppClassModel = {
      tsName: "LzUser_" + name,
      extTsName: extUser ? extUser.tsName : (builtinTsName(ext) ?? "LzView"),
      attrs: [], methodSigs: [],
    };
    userClasses.set(name, cls);
    model.classes.push(cls);
    const baseTag = builtinTsName(ext) ? ext : "view";
    const extChain = extUser ? [ext] : [];
    const desc = `<class name="${name}">`;
    for (const c of elemChildren(el)) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") cls.attrs.push({ name: c.getAttribute("name") ?? "", tsType: attrDeclTsType(c.getAttribute("type")) });
      else if (t === "method") {
        const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
        cls.methodSigs.push(`${c.getAttribute("name")}(${args.map((a) => a + ": any").join(", ")}): any;`);
        collectBody(c, cls.tsName, desc, bodyParams(c, "method", cls.attrs, baseTag, extChain));
      } else if (t === "handler" || t === "setter") {
        collectBody(c, cls.tsName, desc, bodyParams(c, t, cls.attrs, baseTag, extChain));
      }
      // template children (views etc.) are NOT instances; their bodies are
      // checked against the class this-type only when directly under <class>
      // (nested template view bodies: follow-up, out of Slice-2 scope).
    }
  }

  function walkInstance(el: HtmlElem, parent: AppInstanceModel | null): void {
    const tag = tagOf(el);
    const user = userClasses.get(tag);
    const inst: AppInstanceModel = {
      tsName: "LzInst_" + ++instSeq,
      baseTsName: user ? user.tsName : (builtinTsName(tag) ?? "LzView"),
      attrs: [], namedChildren: [],
    };
    model.instances.push(inst);
    const id = el.getAttribute("id");
    if (id) inst.id = id;
    const nm = el.getAttribute("name");
    if (nm && parent) parent.namedChildren.push({ name: nm, tsName: inst.tsName });

    const baseTag = builtinTsName(tag) ? tag : "view";
    const extChain = user ? [tag] : [];
    const desc = `<${el.tagName.toLowerCase()}${nm ? ` name="${nm}"` : ""}>`;

    // First pass: attribute declarations (so handler payloads can see them).
    for (const c of elemChildren(el))
      if (c.tagName.toLowerCase() === "attribute")
        inst.attrs.push({ name: c.getAttribute("name") ?? "", tsType: attrDeclTsType(c.getAttribute("type")) });

    for (const c of elemChildren(el)) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") continue;
      if (t === "class" || t === "interface" || t === "mixin") { walkClass(c); continue; }
      if (t === "dataset") continue; // data, not code
      if (t === "method") {
        const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
        // instance methods surface on the instance type via methodSigs-like attr
        inst.attrs.push({ name: c.getAttribute("name") ?? "", tsType: `(${args.map((a) => a + ": any").join(", ")}) => any` });
        collectBody(c, inst.tsName, desc, bodyParams(c, "method", inst.attrs, baseTag, extChain));
        continue;
      }
      if (t === "handler" || t === "setter") { collectBody(c, inst.tsName, desc, bodyParams(c, t, inst.attrs, baseTag, extChain)); continue; }
      if (t === "script") continue; // top-level scripts: checked as canvas-owned in a follow-up
      if (!NON_INSTANCE.has(t)) walkInstance(c, inst);
    }
  }

  walkInstance(root, null);
  return model;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/app-model.ts compiler/test/app-model.test.mjs
git commit -m "compiler: app-model.ts — per-app type-model extraction for lzx-check"
```

---

### Task 4: `app-dts.ts` — declaration + bodies emission

**Files:**
- Create: `compiler/src/app-dts.ts`
- Test: `compiler/test/app-model.test.mjs` (append — emission tests live with extraction tests; they share fixtures)

**Interfaces:**
- Consumes: `AppModel` (Task 3).
- Produces (used by Task 5):
  - `function generateAppDts(model: AppModel): string`
  - `interface BodySpan { genStartLine: number; srcLine: number; label: string }` — `genStartLine` is the 1-based line of the `function` header in the generated file; body code starts on the NEXT line.
  - `function generateBodies(model: AppModel): { source: string; spans: BodySpan[] }`

- [ ] **Step 1: Write the failing tests**

Append to `compiler/test/app-model.test.mjs`:

```js
import { generateAppDts, generateBodies } from "../dist/app-dts.js";

test("app dts: classes, instance types, named children, ids", () => {
  const m = app('<laszlo-app><class name="rec" extends="view"><attribute name="hue" type="color"></attribute><method name="f" args="a"><script type="text/typescript">return a;</script></method></class><view name="panel" id="p1"><attribute name="count" type="number"></attribute></view></laszlo-app>');
  const dts = generateAppDts(m);
  assert.ok(dts.includes("declare class LzUser_rec extends LzView {"));
  assert.ok(dts.includes("hue: string | number;"));
  assert.ok(dts.includes("f(a: any): any;"));
  assert.ok(dts.includes("declare class LzInst_1 extends LzCanvas {"));
  assert.ok(dts.includes("panel: LzInst_2;"));
  assert.ok(dts.includes("declare class LzInst_2 extends LzView {"));
  assert.ok(dts.includes("count: number;"));
  assert.ok(dts.includes("declare const p1: LzInst_2;"));
});

test("bodies file: typed this + params, spans map generated lines to source lines", () => {
  const m = app('<laszlo-app>\n<view name="v">\n<handler name="onclick">\n<script type="text/typescript">\nconst a: number = 1;\nreturn a;\n</script>\n</handler>\n</view>\n</laszlo-app>');
  const { source, spans } = generateBodies(m);
  assert.ok(source.includes("function __lz_body_1(this: LzInst_2): any {"));
  assert.ok(source.includes("const a: number = 1;"));
  assert.equal(spans.length, 1);
  // body code begins at generated line genStartLine+1 and source line srcLine+1
  // (srcLine is the <script> line; its text starts right after '>', so the
  // first CODE line is srcLine+1 when the carrier opens with a newline).
  assert.equal(spans[0].srcLine, 4);
  const genFirstCodeLine = source.split("\n").indexOf("const a: number = 1;") + 1;
  assert.equal(genFirstCodeLine, spans[0].genStartLine + 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `compiler/src/app-dts.ts`:

```ts
// app-dts.ts — emit the per-app declarations and the body-check harness
// (spec "App-aware type checking", layers 2-3) from an AppModel.

import type { AppModel } from "./app-model.js";

export interface BodySpan { genStartLine: number; srcLine: number; label: string }

export function generateAppDts(model: AppModel): string {
  const out: string[] = ["// AUTO-GENERATED per-app declarations (lzx-check). Do not edit.", ""];
  for (const c of model.classes) {
    out.push(`declare class ${c.tsName} extends ${c.extTsName} {`);
    for (const a of c.attrs) out.push(`  ${a.name}: ${a.tsType};`);
    for (const s of c.methodSigs) out.push(`  ${s}`);
    out.push("}", "");
  }
  for (const inst of model.instances) {
    out.push(`declare class ${inst.tsName} extends ${inst.baseTsName} {`);
    for (const a of inst.attrs) out.push(`  ${a.name}: ${a.tsType};`);
    for (const nc of inst.namedChildren) out.push(`  ${nc.name}: ${nc.tsName};`);
    out.push("}", "");
  }
  for (const inst of model.instances)
    if (inst.id) out.push(`declare const ${inst.id}: ${inst.tsName};`);
  out.push("");
  return out.join("\n");
}

/** One function per body, `this`-typed; spans map generated lines to source. */
export function generateBodies(model: AppModel): { source: string; spans: BodySpan[] } {
  const lines: string[] = ["// AUTO-GENERATED body-check harness (lzx-check). Do not edit.", ""];
  const spans: BodySpan[] = [];
  model.bodies.forEach((b, idx) => {
    const params = ["this: " + b.ownerType, ...b.params.map((p) => `${p.name}: ${p.tsType}`)];
    lines.push(`// ${b.label}`);
    const genStartLine = lines.length + 1; // 1-based line of the function header
    lines.push(`function __lz_body_${idx + 1}(${params.join(", ")}): any {`);
    // Line-map anchor. Mapping (Task 5): sourceLine = spanSrcLine + (genLine - genStartLine).
    // A multi-line carrier (`<script …>\ncode`) starts code at srcLine + 1 — the
    // stripped leading newline makes generated line genStartLine+1 ↔ srcLine+1.
    // A single-line carrier (`<script …>code</script>`) starts code ON srcLine,
    // so anchor one line earlier to keep the same formula exact.
    const spanSrcLine = b.code.startsWith("\n") ? b.srcLine : b.srcLine - 1;
    spans.push({ genStartLine, srcLine: spanSrcLine, label: b.label });
    for (const l of b.code.replace(/^\n/, "").split("\n")) lines.push(l);
    lines.push("}", "");
  });
  return { source: lines.join("\n"), spans };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/app-dts.ts compiler/test/app-model.test.mjs
git commit -m "compiler: app-dts.ts — per-app declaration + body-harness emission"
```

---

### Task 5: `lzx-check.ts` — driver, CLI, fixtures, committed `lfc.d.ts`

**Files:**
- Create: `compiler/src/lzx-check.ts`
- Create: `compiler/test/fixtures/check-clean.html`, `compiler/test/fixtures/check-errors.html`
- Test: `compiler/test/lzx-check.test.mjs`
- Modify: `compiler/package.json` (bin + `gen:lfcdts` script)
- Generated + committed: `compiler/lfc.d.ts`

**Interfaces:**
- Consumes: everything above; `typescript` devDep.
- Produces:
  - `interface Finding { line: number; col: number; code: number; message: string; element: string }` (`line`/`col` in the SOURCE app file)
  - `interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number }`
  - `function checkApp(html: string, fileName: string): CheckResult`
  - CLI: `node dist/lzx-check.js <app.html>` → report + exit 1 on findings, 0 clean; `node dist/lzx-check.js --write-lfc-dts` → prints the generated `lfc.d.ts` to stdout.

- [ ] **Step 1: Write the fixtures**

Create `compiler/test/fixtures/check-clean.html`:

```html
<laszlo-app width="400" height="200">
  <view name="counterbox" x="20" y="20" width="200" height="60" bgcolor="#d08040">
    <attribute name="count" type="number" value="0"></attribute>
    <handler name="onclick">
      <script type="text/typescript">
        this.setAttribute('count', this.count + 1);
        this.setAttribute('width', 200 + this.count * 20);
      </script>
    </handler>
    <handler name="oncount" args="c">
      <script type="text/typescript">
        const doubled: number = c * 2;
        this.animate('x', doubled, 500);
      </script>
    </handler>
  </view>
</laszlo-app>
```

Create `compiler/test/fixtures/check-errors.html`:

```html
<laszlo-app width="400" height="200">
  <view name="box">
    <attribute name="count" type="number" value="0"></attribute>
    <handler name="onclick">
      <script type="text/typescript">
        this.setAttribute('count', 'oops');
      </script>
    </handler>
    <handler name="onwidth" args="w">
      <script type="text/typescript">
        return this.cuont + w.toUpperCase();
      </script>
    </handler>
  </view>
</laszlo-app>
```

Seeded errors: (1) wrong-typed `setAttribute('count', 'oops')` — `count: number`; (2) misspelled member `this.cuont`; (3) `w.toUpperCase()` where `onwidth`'s payload is `number | string` → not callable without narrowing. These are exactly the spec's Testing #6 triple.

- [ ] **Step 2: Write the failing tests**

Create `compiler/test/lzx-check.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("clean fixture: zero findings, bodies counted", () => {
  const r = checkApp(read("check-clean.html"), "check-clean.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
  assert.equal(r.bodiesChecked, 2);
  assert.equal(r.skippedLzs, 0);
});

test("errors fixture: the spec's three error classes, mapped to source lines", () => {
  const src = read("check-errors.html");
  const r = checkApp(src, "check-errors.html");
  assert.equal(r.findings.length >= 3, true, JSON.stringify(r.findings, null, 2));
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find((f) => f.line === at(needle));
  const wrongType = find("setAttribute('count', 'oops')");
  assert.ok(wrongType, "wrong-typed setAttribute not found");
  assert.equal(wrongType.code, 2345);
  const misspelled = find("this.cuont");
  assert.ok(misspelled, "misspelled member not found");
  assert.ok([2339, 2551].includes(misspelled.code)); // 2551 = did-you-mean variant
  const badArg = r.findings.find((f) => f.message.includes("toUpperCase"));
  assert.ok(badArg, "bad handler-arg use not found");
  for (const f of r.findings) assert.ok(f.element.includes("<handler"));
});

test("lzs carriers are skipped, not failed", () => {
  const r = checkApp('<laszlo-app><view><handler name="onclick"><script type="text/lzs">if (this is LzView) x();</script></handler></view></laszlo-app>', "x.html");
  assert.equal(r.skippedLzs, 1);
  assert.equal(r.findings.length, 0);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

Create `compiler/src/lzx-check.ts`:

```ts
// lzx-check.ts — app-aware TypeScript checking for DOM-authored apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md,
// "App-aware type checking", Slice 2). Dev-time CLI; never bundled.
//
//   node dist/lzx-check.js <app.html>      check an app document
//   node dist/lzx-check.js --write-lfc-dts print the generated lfc.d.ts
//
// The program tsc sees: lfc.d.ts (generated from the oracle schema),
// __lzapp.d.ts (per-app declarations), __lzbodies.ts (each method/handler/
// setter body as a this-typed function). Diagnostics in __lzbodies.ts are
// mapped back to the app file through the BodySpan table.

import ts from "typescript";
import { readFileSync } from "node:fs";
import { parseHtmlDialect, findLaszloApp } from "./htmlsource.js";
import { extractApp } from "./app-model.js";
import { generateAppDts, generateBodies, BodySpan } from "./app-dts.js";
import { generateLfcDts } from "./lfc-dts.js";

export interface Finding { line: number; col: number; code: number; message: string; element: string }
export interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number }

const COMPILER_OPTS: ts.CompilerOptions = {
  noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"],
  target: ts.ScriptTarget.ES2020,
};

export function checkApp(html: string, fileName: string): CheckResult {
  const model = extractApp(findLaszloApp(parseHtmlDialect(html)));
  const appDts = generateAppDts(model);
  const { source: bodiesSrc, spans } = generateBodies(model);
  const virtual = new Map<string, string>([
    ["lfc.d.ts", generateLfcDts()],
    ["__lzapp.d.ts", appDts],
    ["__lzbodies.ts", bodiesSrc],
  ]);

  const host = ts.createCompilerHost(COMPILER_OPTS);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVer) =>
    virtual.has(name) ? ts.createSourceFile(name, virtual.get(name)!, langVer, true) : origGet(name, langVer);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (name) => virtual.has(name) || origExists(name);
  const origRead = host.readFile.bind(host);
  host.readFile = (name) => virtual.get(name) ?? origRead(name);

  const prog = ts.createProgram([...virtual.keys()], COMPILER_OPTS, host);
  const bodiesSf = prog.getSourceFile("__lzbodies.ts")!;
  const diags = [...prog.getSyntacticDiagnostics(bodiesSf), ...prog.getSemanticDiagnostics(bodiesSf)];

  const findings: Finding[] = [];
  for (const d of diags) {
    if (d.file?.fileName !== "__lzbodies.ts" || d.start == null) continue;
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    const genLine = pos.line + 1;
    // find the span containing this generated line
    let span: BodySpan | undefined;
    for (const s of spans) if (s.genStartLine <= genLine) span = s; else break;
    const line = span ? span.srcLine + (genLine - span.genStartLine) : genLine;
    findings.push({
      line, col: pos.character + 1, code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      element: span?.label ?? "(unknown)",
    });
  }
  return { findings, skippedLzs: model.skippedLzs, bodiesChecked: model.bodies.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "--write-lfc-dts") {
    process.stdout.write(generateLfcDts());
    process.exit(0);
  }
  const file = args[0];
  if (!file) {
    console.error("usage: lzx-check <app.html>   |   lzx-check --write-lfc-dts");
    process.exit(2);
  }
  const html = readFileSync(file, "utf8");
  const r = checkApp(html, file);
  for (const f of r.findings)
    console.error(`${file}:${f.line}:${f.col} TS${f.code} ${f.message}   [${f.element}]`);
  const note = r.skippedLzs ? ` (${r.skippedLzs} text/lzs carrier${r.skippedLzs > 1 ? "s" : ""} skipped)` : "";
  if (r.findings.length) {
    console.error(`${r.findings.length} finding(s) across ${r.bodiesChecked} bodies${note}`);
    process.exit(1);
  }
  console.log(`OK — ${r.bodiesChecked} bodies checked, 0 findings${note}`);
}
```

- [ ] **Step 5: Wire package.json**

In `compiler/package.json`, add to `bin` and `scripts`:

```json
  "bin": {
    "lzc": "./dist/cli.js",
    "lzx-check": "./dist/lzx-check.js"
  },
```

and in `scripts`:

```json
    "gen:lfcdts": "npm run build && node dist/lzx-check.js --write-lfc-dts > lfc.d.ts",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS. Likely first-run issues and their fixes: (a) the misspelled-member diagnostic may be TS2551 ("did you mean 'count'") — the test accepts both; (b) if `w.toUpperCase()` produces no diagnostic, the payload type resolution fell back to `any` — fix `resolveAttrType`, not the test; (c) if the clean fixture has findings, read them — they are real generator bugs (e.g. a missing curated member).

- [ ] **Step 7: Generate and commit `lfc.d.ts`**

```bash
npm run gen:lfcdts && head -5 lfc.d.ts && wc -l lfc.d.ts
```
Expected: the AUTO-GENERATED banner; a few hundred lines.

- [ ] **Step 8: Commit**

```bash
git add compiler/src/lzx-check.ts compiler/test/lzx-check.test.mjs compiler/test/fixtures/ compiler/package.json compiler/lfc.d.ts
git commit -m "compiler: lzx-check CLI — app-aware TS checking (lfc.d.ts + per-app decls + typed bodies)"
```

---

### Task 6: Real-app verification + docs

**Files:**
- Modify: `examples/dom-authoring/README.md`
- Modify (only if verification finds generator bugs): the Slice-2 sources

- [ ] **Step 1: Run the checker on the shipped demos**

```bash
cd compiler && npm run build
node dist/lzx-check.js ../examples/dom-authoring/counter-app.html
```
Expected: `OK — 1 bodies checked, 0 findings` (the counter app uses `(this as any)` casts, which check clean). If findings appear, they are real: either the demo's TS is wrong (fix the demo — e.g. the `(this as any).count` casts can now be REMOVED since `count` is a declared attribute: do that, re-run `lzx-check` AND re-load the file-demo in a browser to confirm it still runs) or the generator is (fix it).

- [ ] **Step 2: Improve the demo to showcase typed `this`**

Since `count` is declared, `counter-app.html`'s handler can drop its casts. Update `examples/dom-authoring/counter-app.html`'s handler body to:

```html
    <handler name="onclick">
      <script type="text/typescript">
        this.setAttribute('count', this.count + 1);
        this.setAttribute('width', 200 + this.count * 20);
      </script>
    </handler>
```

Then verify BOTH ways:

```bash
node dist/lzx-check.js ../examples/dom-authoring/counter-app.html   # expect OK
```
and load `http://localhost:8087/examples/dom-authoring/file-demo.html` in a browser (start `node tools/serve-static.mjs . 8087` if not running) — the counter must still widen on click.

- [ ] **Step 3: Seed-check the error path end-to-end**

```bash
node dist/lzx-check.js test/fixtures/check-errors.html; echo "exit: $?"
```
Expected: three findings printed as `file:line:col TS<code> message [<element>]`, `exit: 1`.

- [ ] **Step 4: Document**

Append to `examples/dom-authoring/README.md`:

```markdown

## Type checking (Slice 2)

`lzx-check` type-checks an app document: TypeScript bodies get a typed
`this` (your `<attribute>` declarations, named children, LFC API from the
generated `compiler/lfc.d.ts`), `setAttribute` names/values are checked,
and handler args are typed from the attribute they observe.

    cd compiler
    node dist/lzx-check.js ../examples/dom-authoring/counter-app.html

Exit 1 + `file:line:col TS<code>` diagnostics on findings; `text/lzs`
carriers are skipped (ES4 is not TypeScript). Checking never blocks
running — the browser pipeline only strips types.
```

- [ ] **Step 5: Full suite + commit**

```bash
cd compiler && npm test
cd .. && git add examples/dom-authoring/ compiler/
git commit -m "lzx-check: verify against shipped demos; de-cast counter demo; docs"
```

---

## Out of scope (follow-ups, do not build)

Per spec/deferred: `.lzx` XML-dialect checking, top-level `<script>` bodies (canvas-owned), nested template-view bodies inside `<class>`, `${…}` constraint-expression checking (spec says best-effort — deferred), an in-browser `?debug` diagnostics overlay, editor/IDE integration beyond the committed `lfc.d.ts`, `lz.*` namespace typing (currently `any`).
