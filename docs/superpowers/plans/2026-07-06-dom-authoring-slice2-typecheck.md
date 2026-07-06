# DOM-Native Authoring Slice 2 — App-Aware TypeScript Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lzx-check` — a dev-time Node CLI that validates the WHOLE authored surface of DOM-dialect apps (and, for markup/constraints/refs, existing `.lzx` apps): TS bodies with typed `this`, markup attribute literals, cross-references, and `${…}` constraint expressions — against an `lfc.d.ts` derived from the oracle schema PLUS the LFC source itself (typed method signatures, `lz.*` services, `LzDeclaredEvent`-typed events via the compiler's own ES4 parser).

**Architecture:** Four pure modules layered onto Slice 1: `htmlsource.ts` (a minimal dependency-free HTML-dialect parser for Node — raw-text `<script>`, void elements, line tracking), `lfc-dts.ts` (SCHEMA/SCHEMA_EVENTS → `lfc.d.ts`, committed artifact), `app-model.ts` (dialect tree → AppModel: classes, instance types, code bodies with source lines), `app-dts.ts` (AppModel → app `.d.ts` + a bodies file with a line-span map). `lzx-check.ts` drives `tsc` (the existing `typescript` devDependency) over {lfc.d.ts, app.d.ts, bodies.ts} via an in-memory-overlay CompilerHost and maps diagnostics back to source elements/lines. The browser runtime path is untouched — checking is erasure-independent (strip always succeeds; diagnostics are a dev tool, spec "App-aware type checking").

**Tech Stack:** TypeScript compiler API (`ts.createProgram`, existing devDep), `node --test` harness from Slice 1. Zero new dependencies. Nothing here is bundled into `lzc-browser.js`.

**Spec:** `docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md` §"App-aware type checking (Slice 2)". Read it first.

## Global Constraints

- **Zero new dependencies** — `typescript` (devDep) is the only external module; `lzx-check` is a dev tool, never part of the browser bundle (`browser.ts` must NOT import any Slice-2 module).
- **`sc.ts` changes are additive-only and byte-diff-guarded**: annotation capture stores into NEW optional AST fields that emission never reads; the Task-1B guard (before/after corpus compile + LFC build diff) must show byte-identical output.
- **The `.lzx`-text compile path and `runtime/lfc-src` stay untouched** (byte-parity, as in Slice 1).
- **Checking never blocks running** — `lzx-check` is a separate CLI; the Slice-1 bootstrap pipeline is not modified.
- **Type names are deterministic**: built-ins `Lz<Capitalized-tag>` (`LzView`, `LzCanvas`, …), user classes `LzUser_<name>`, per-instance synthesized types `LzInst_<n>` in document order.
- **`text/lzs` carriers are skipped** (ES4 `is`/`cast` are not TS) and counted in the report.
- Work on branch `dom-authoring-slice2` (created off `dom-authoring-slice1` in Task 1).
- `cd compiler && npm test` green after every task; commit after every task.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `compiler/src/htmlsource.ts` | create | dependency-free HTML-dialect parser → `HtmlElem` (DomElementLike-compatible + element AND per-attribute `line`s) |
| `compiler/src/sc.ts` | modify (additive, guarded) | capture `:Type` annotations into optional AST fields; export `parseLibraryAst` + the `Stmt`/`ClassMember`/`Node` types |
| `compiler/src/lfc-reflect.ts` | create | walk the expanded LFC AST → `LfcReflection` (classes/members with types, `lz.*` assignments), visibility-filtered |
| `compiler/src/xml-adapter.ts` | create | `XmlElem` (parseXml) → `HtmlElem`-shaped tree so `.lzx` apps feed the same model extractor |
| `compiler/src/lfc-dts.ts` | create | `tsTypeOf(schemaType)` + `generateLfcDts(reflection?)`: schema attrs + derived methods/vars + `LzDeclaredEvent` events + derived `lz` namespace + curated core |
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
  - `interface HtmlElem extends HtmlNode { tagName: string; attributes: {name: string; value: string; line: number}[]; childNodes: HtmlNode[]; getAttribute(n: string): string | null; attrLine(n: string): number; setAttribute(n: string, v: string): void }` — per-attribute lines feed markup-literal and constraint diagnostics; `attrLine` returns the element's line for unknown names
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
  assert.equal(app.attrLine("width"), 3);            // per-attribute line
  assert.equal(app.attrLine("nope"), 3);             // unknown -> element line
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
  attributes: { name: string; value: string; line: number }[];
  childNodes: HtmlNode[];
  getAttribute(n: string): string | null;
  /** 1-based source line of the attribute (the element's line if absent). */
  attrLine(n: string): number;
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
  const attributes: { name: string; value: string; line: number }[] = [];
  return {
    nodeType: ELEMENT, line, tagName: tag.toUpperCase(), attributes, childNodes: [],
    getAttribute(n) { const a = attributes.find((x) => x.name === n); return a ? a.value : null; },
    attrLine(n) { const a = attributes.find((x) => x.name === n); return a ? a.line : line; },
    setAttribute(n, v) {
      const a = attributes.find((x) => x.name === n);
      if (a) a.value = String(v); else attributes.push({ name: n, value: String(v), line });
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
      const attrLine = line;
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
      el.attributes.push({ name, value, line: attrLine });
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

/** Breadth-first search for the <laszlo-app> element. */
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

### Task 1B: `sc.ts` — capture `:Type` annotations + export `parseLibraryAst` (byte-diff-guarded)

The parser currently ERASES ES4 type annotations (`skipTypeAnnotation`, sc.ts:395). Capture them into NEW optional AST fields that emission never reads, and export a reflection entry that reuses `compileLibraryProgram`'s own parse+`#include`-expansion. Every change here is additive; the guard proves output bytes are untouched.

**Files:**
- Modify: `compiler/src/sc.ts` (four small edits)
- No new test file (the guard IS the test; Task 1C unit-tests the consumer)

**Interfaces:**
- Produces (used by Task 1C):
  - `export function parseLibraryAst(rootSource: string, rootFile: string, resolveInclude: (path: string) => string | null): Stmt[]` — the include-expanded, constant-folded statement list
  - `export type { Stmt, ClassMember, Node as ScNode }` (type-only; zero runtime impact)
  - New optional AST fields: on `func` nodes `paramTypes?: (string | null)[]` and `returnType?: string | null`; on `var` class members `varType?: string | null`

- [ ] **Step 1: Capture the BEFORE outputs (guard)**

```bash
cd compiler && npm run build && mkdir -p /tmp/lzc-guard2/before
for f in ../docs/component-browser/components.lzx ../explorer/explore-nav.lzx \
         ../examples/ten-minutes/sessionwindow.lzx ../examples/ten-minutes/path-attribute.lzx; do
  LPS_HOME=../runtime node dist/cli.js "$f" > "/tmp/lzc-guard2/before/$(basename "$f").js"
done
# the LFC build exercises the class/var/param parse paths hardest:
node dist/cli.js --lfc ../runtime/lfc-src/LaszloLibrary.lzs > /tmp/lzc-guard2/before/lfc.js 2>/dev/null \
  || node dist/cli.js --lfc "$(ls ../runtime/lfc-src/*.lzs | head -1)" > /tmp/lzc-guard2/before/lfc.js
wc -c /tmp/lzc-guard2/before/*
```

Expected: four app outputs + a multi-hundred-KB lfc.js. If the LFC root isn't `LaszloLibrary.lzs`, find it: `grep -rl "#include" ../runtime/lfc-src/*.lzs | head` — the root is the file that is not itself included (check `compiler/compiler-verify/` scripts or README for the exact `--lfc` invocation) — and use it consistently in BOTH guard passes and Task 1C/2.

- [ ] **Step 2: Make `skipTypeAnnotation`/`typeExpr` capture**

In `compiler/src/sc.ts`, change (current at ~:395):

```ts
  skipTypeAnnotation(): void {
    if (!this.is(":")) return;
    this.next();
    this.typeExpr();
  }
```

to:

```ts
  /** Skip an ActionScript-style `:Type` annotation — erased from OUTPUT, but the
   *  type text is RETURNED for reflection (lfc-reflect). null = no annotation. */
  skipTypeAnnotation(): string | null {
    if (!this.is(":")) return null;
    this.next();
    return this.typeExpr();
  }
```

and make `typeExpr()` build and return the text it consumes (it currently just advances). Follow its existing token walk exactly, concatenating: `*`, the (dotted) name, the optional `.<…>` vector parameter, the optional trailing `?`. Signature: `typeExpr(): string`. (Callers that ignore the return need no change.)

- [ ] **Step 3: Thread captures into the three AST sites**

(a) `formalParams()` (~:983): collect `const types: (string | null)[] = []`, pushing `this.skipTypeAnnotation()` where it is currently discarded (both the rest-param and normal-param sites push too — rest pushes its capture); return `{ names, defaults, rest, types }`.
(b) The `func`-node construction site (~:980, the `return { k: "func", … }`): add `...(types.some((t) => t != null) ? { paramTypes: types } : {})`. Also capture the RETURN-type annotation — the post-paramlist `skipTypeAnnotation()` is at ~:936 inside `functionExpr` (same scope as the :980 return) — store it as `returnType`.
(c) `classBody`'s var member (~:677): `const varType = this.skipTypeAnnotation();` then `members.push({ kind: "var", name: vn, init, static: isStatic, ...(varType ? { varType } : {}) });` — and add the optional fields to the `ClassMember`/`Node` type declarations (`varType?: string | null` on the var member; `paramTypes?: (string | null)[]; returnType?: string | null` on `func`).

(d) **`foldNode`'s `"func"` case (sc.ts:1253) RECONSTRUCTS the node field-by-field and would silently DROP the captures** (reflection runs `foldStmts`; every method's `fn` goes through this). Extend that reconstruction with:

```ts
  ...(n.paramTypes ? { paramTypes: n.paramTypes } : {}),
  ...(n.returnType != null ? { returnType: n.returnType } : {}),
```

Additive — emission never reads these fields; the byte-diff guard proves it. (Var members are safe: their fold spreads `{ ...m, init }`.)

- [ ] **Step 4: Add the reflection export**

At the bottom of `sc.ts` (near `compileLibraryProgram`), add:

```ts
/** REFLECTION-ONLY: parse + #include-expand + fold a library root, returning
 *  the raw statement AST (with captured :Type annotations). Read-only sibling
 *  of compileLibraryProgram — shares no state with codegen and never emits. */
export function parseLibraryAst(
  rootSource: string,
  rootFile: string,
  resolveInclude: (path: string) => string | null,
): Stmt[] {
  const parseFold = (src: string, file: string): Stmt[] => {
    const p = new Parser(lex("#file " + file + "\n#line 1\n" + src, 1, undefined, true));
    p.lfc = true;
    return foldStmts(p.parseProgram());
  };
  const expand = (stmts: Stmt[], stack: string[]): Stmt[] => {
    const out: Stmt[] = [];
    for (const s of stmts) {
      if (s.s === "include") {
        if (stack.includes(s.path)) throw new ScUnsupported(`#include cycle: ${[...stack, s.path].join(" -> ")}`);
        const src = resolveInclude(s.path);
        if (src == null) throw new ScUnsupported(`#include not found: ${s.path}`);
        out.push(...expand(parseFold(src, s.path), [...stack, s.path]));
      } else if (s.s === "block") out.push({ ...s, body: expand(s.body, stack) });
      else out.push(s); // top-level classes/assignments are what reflection reads
    }
    return out;
  };
  return expand(parseFold(rootSource, rootFile), [rootFile]);
}
export type { Stmt, ClassMember, Node as ScNode };
```

(If `Stmt`/`ClassMember`/`Node` are declared as non-exported types, the `export type` re-export at the bottom is sufficient; adjust to `export type Stmt = …` style only if tsc demands it.)

- [ ] **Step 5: Rebuild, capture AFTER, byte-diff, full tests**

```bash
npm run build && mkdir -p /tmp/lzc-guard2/after
for f in ../docs/component-browser/components.lzx ../explorer/explore-nav.lzx \
         ../examples/ten-minutes/sessionwindow.lzx ../examples/ten-minutes/path-attribute.lzx; do
  LPS_HOME=../runtime node dist/cli.js "$f" > "/tmp/lzc-guard2/after/$(basename "$f").js"
done
node dist/cli.js --lfc <SAME-ROOT-AS-STEP-1> > /tmp/lzc-guard2/after/lfc.js
diff -r /tmp/lzc-guard2/before /tmp/lzc-guard2/after && echo "BYTE-IDENTICAL"
npm test
```

Expected: `BYTE-IDENTICAL` + all tests PASS. Any diff = the capture leaked into emission; revert and re-approach.

- [ ] **Step 6: Commit**

```bash
git add compiler/src/sc.ts
git commit -m "compiler: capture ES4 :Type annotations in the AST + parseLibraryAst reflection export (byte-diff-guarded)"
```

---

### Task 1C: `lfc-reflect.ts` — derive classes, members, and `lz.*` from the LFC AST

**Files:**
- Create: `compiler/src/lfc-reflect.ts`
- Test: `compiler/test/lfc-reflect.test.mjs`

**Interfaces:**
- Consumes: `parseLibraryAst` (Task 1B); Node `fs` for the CLI-side loader.
- Produces (used by Task 2):

```ts
export interface LfcMethod { name: string; params: { name: string; type: string | null }[]; returnType: string | null; isStatic: boolean }
export interface LfcVar { name: string; type: string | null; isStatic: boolean }
export interface LfcClass { name: string; sup: string | null; methods: LfcMethod[]; vars: LfcVar[] }
export interface LfcReflection { classes: Map<string, LfcClass>; lzAssignments: { prop: string; className: string }[] }
export function reflectLibrary(stmts: Stmt[]): LfcReflection
export function loadLfcReflection(rootLzsPath: string): LfcReflection  // fs read + resolveInclude relative to root dir
```

**Rules:** visibility filter drops members whose name starts with `__` or `$` (the LFC's private conventions) and constructors (name === class name). `lz.*` extraction: top-level `{s:"expr", e:{k:"assign", l:{k:"member", o:…, p:P}, r:R}}` where the assign target chain bottoms out at identifier `lz` → record `{prop: P, className: <rightmost identifier chain of R, e.g. "LzTimerService.LzTimer" → "LzTimerService">}` — record the FULL dotted right side and let Task 2 decide typing (the singleton's class is the last-but-one segment for `X.Y` service-instance patterns; when `R` is a bare identifier, that identifier).

- [ ] **Step 1: Write the failing tests**

Create `compiler/test/lfc-reflect.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryAst } from "../dist/sc.js";
import { reflectLibrary, loadLfcReflection } from "../dist/lfc-reflect.js";

test("reflects classes, typed members, filters privates + constructor", () => {
  const src = `
class LzDemo extends LzEventable {
  var count:Number = 0;
  var __secret:Boolean = false;
  static var flag:Boolean = true;
  function LzDemo(parent = null) { }
  function poke(n:Number, s:String = null):void { }
  function $lzc$hidden() { }
}
lz.Demo = LzDemoService.LzDemo;
`;
  const r = reflectLibrary(parseLibraryAst(src, "demo.lzs", () => null));
  const c = r.classes.get("LzDemo");
  assert.ok(c);
  assert.equal(c.sup, "LzEventable");
  assert.deepEqual(c.vars, [
    { name: "count", type: "Number", isStatic: false },
    { name: "flag", type: "Boolean", isStatic: true },
  ]);
  assert.deepEqual(c.methods, [{
    name: "poke", isStatic: false, returnType: "void",
    params: [{ name: "n", type: "Number" }, { name: "s", type: "String" }],
  }]);
  assert.deepEqual(r.lzAssignments, [{ prop: "Demo", className: "LzDemoService.LzDemo" }]);
});

test("include expansion feeds reflection", () => {
  const files = { "inc.lzs": "class LzInc { function go():void { } }" };
  const r = reflectLibrary(parseLibraryAst('#include "inc.lzs"\n', "root.lzs", (p) => files[p] ?? null));
  assert.ok(r.classes.get("LzInc"));
});

test("loads the REAL LFC: LzNode/LzView present with expected members", () => {
  // Root discovery: the file compiler-verify/CLI --lfc builds from.
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  const r = loadLfcReflection(root);
  const node = r.classes.get("LzNode");
  assert.ok(node, "LzNode not found — wrong root file?");
  assert.ok(node.methods.some((m) => m.name === "animate"));
  const view = r.classes.get("LzView");
  assert.ok(view.methods.some((m) => m.name === "bringToFront"));
  assert.ok(r.lzAssignments.some((a) => a.prop === "Timer"));
  assert.ok(r.lzAssignments.some((a) => a.prop === "Focus"));
  // privates filtered
  assert.ok(!view.methods.some((m) => m.name.startsWith("__") || m.name.startsWith("$")));
});
```

(If the real root is not `LaszloLibrary.lzs`, fix the path in the test to the root found in Task 1B Step 1 — the assertion messages point there.)

- [ ] **Step 2: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `compiler/src/lfc-reflect.ts`:

```ts
// lfc-reflect.ts — derive the LFC's typed API surface from its SOURCE via the
// compiler's own ES4 parser (spec "App-aware type checking" layer 1b). The
// schema gives attribute types; THIS gives method signatures, typed vars, and
// the lz.* service namespace. Dev-tool-only (lzx-check); never bundled.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLibraryAst, type Stmt, type ClassMember, type ScNode } from "./sc.js";

export interface LfcMethod { name: string; params: { name: string; type: string | null }[]; returnType: string | null; isStatic: boolean }
export interface LfcVar { name: string; type: string | null; isStatic: boolean }
export interface LfcClass { name: string; sup: string | null; methods: LfcMethod[]; vars: LfcVar[] }
export interface LfcReflection { classes: Map<string, LfcClass>; lzAssignments: { prop: string; className: string }[] }

const isPrivate = (n: string) => n.startsWith("__") || n.startsWith("$");

/** Render a member/identifier chain (`a.b.c`) or null if not one. */
function dottedName(n: any): string | null {
  if (n.k === "id") return n.name;
  if (n.k === "member") { const o = dottedName(n.o); return o ? o + "." + n.p : null; }
  return null;
}

export function reflectLibrary(stmts: Stmt[]): LfcReflection {
  const classes = new Map<string, LfcClass>();
  const lzAssignments: { prop: string; className: string }[] = [];

  const visit = (s: any): void => {
    if (s.s === "block") { s.body.forEach(visit); return; }
    if (s.s === "if") { if (s.t) visit(s.t); if (s.e) visit(s.e); return; }
    if (s.s === "as3class") {
      const cls: LfcClass = { name: s.name, sup: s.sup, methods: [], vars: [] };
      for (const m of s.members as any[]) {
        if (m.kind === "var" && !isPrivate(m.name))
          cls.vars.push({ name: m.name, type: m.varType ?? null, isStatic: m.static });
        else if (m.kind === "method" && !isPrivate(m.name) && m.name !== s.name) {
          const fn = m.fn;
          cls.methods.push({
            name: m.name, isStatic: m.static, returnType: fn.returnType ?? null,
            params: (fn.params as string[]).map((p: string, i: number) => ({
              name: p, type: fn.paramTypes?.[i] ?? null,
            })),
          });
        }
      }
      classes.set(s.name, cls);
      return;
    }
    if (s.s === "expr" && s.e?.k === "assign" && s.e.op === "=") {
      const l = s.e.l;
      if (l?.k === "member" && l.o?.k === "id" && l.o.name === "lz") {
        const right = dottedName(s.e.r);
        if (right) lzAssignments.push({ prop: l.p, className: right });
      }
    }
  };
  stmts.forEach(visit);
  return { classes, lzAssignments };
}

/** Load + reflect the real LFC from its library root (.lzs with #includes). */
export function loadLfcReflection(rootLzsPath: string): LfcReflection {
  const rootSource = readFileSync(rootLzsPath, "utf8");
  const base = dirname(rootLzsPath);
  const resolveInclude = (p: string): string | null => {
    try { return readFileSync(join(base, p), "utf8"); } catch { return null; }
  };
  return reflectLibrary(parseLibraryAst(rootSource, rootLzsPath.split("/").pop()!, resolveInclude));
}
```

(`ScNode` import may be unused — drop it if tsc flags it. If member/assign AST field names differ from this sketch, follow the ACTUAL shapes in sc.ts — `{s:"expr", e}`, `{k:"assign", op, l, r}`, `{k:"member", o, p}`, `{k:"id", name}` were verified during planning at sc.ts:251/:241/:234.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS. The real-LFC test is the canary: if `parseLibraryAst` throws `ScUnsupported` on some construct, note WHERE and wrap only reflection (not codegen) with a per-file try/skip — reflection can tolerate skipping a problem file; codegen cannot.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/lfc-reflect.ts compiler/test/lfc-reflect.test.mjs
git commit -m "compiler: lfc-reflect.ts — typed LFC API surface + lz.* services from the sc.ts AST"
```

---

### Task 2: `lfc-dts.ts` — generate and commit `lfc.d.ts`

**Files:**
- Create: `compiler/src/lfc-dts.ts`
- Test: `compiler/test/lfc-dts.test.mjs`
- Generated + committed (in Task 5, once the CLI exists): `compiler/lfc.d.ts`

**Interfaces:**
- Consumes: `SCHEMA`, `SCHEMA_EVENTS` from `./schema-types.js`; `LfcReflection` (Task 1C).
- Produces (used by Tasks 3, 4, 5):
  - `function tsTypeOf(schemaType: string): string` — schema type string → TS type text
  - `function builtinTsName(tag: string): string | null` — `view`→`"LzView"`, … ; null if not an emitted built-in
  - `function generateLfcDts(reflection?: LfcReflection): string` — schema-only when no reflection (fallback); with reflection: derived methods merged onto the schema classes, ALL other reflected classes (services etc.) declared, `LzDeclaredEvent`-typed events, and a typed `lz` namespace

**Reflection-merge rules (locked):**
- ES4→TS type map (`es4TsType`, exported): `Number`/`int`/`uint`→`number`, `String`→`string`, `Boolean`→`boolean`, `void`→`void`, `Array`→`any[]`, `Function`→`(...args: any[]) => any`, `*`/`Object`/`null`/missing→`any`; a class-name type is kept verbatim IF that class is declared in this d.ts (computed against the declared-name set), else `any`. Trailing `?` (nullable) stripped; optional params from ES4 defaults (`= …` → `?`).
- **Case reconciliation**: reflected LFC class names are the REAL spellings (`LzAnimatorGroup`); schema-lineage classes are emitted under `builtinTsName` (`LzAnimatorgroup`). Match reflected↔schema case-insensitively on `lz`+tag; merge the reflected members into the schema class emission; when spellings differ, ALSO emit `type LzAnimatorGroup = LzAnimatorgroup;` aliases so derived signatures' type refs resolve.
- Derived members are added only when the name isn't already emitted (schema attr, event, curated method) — curated + schema win.
- **Events**: `declare class LzDeclaredEvent { ready: boolean; sendEvent(value?: any): void; }` (verified: `$lzc$set_width` calls `onwidth.sendEvent(…)`, compiled output tests `.ready`); every SCHEMA_EVENTS property is `LzDeclaredEvent`, not `any`.
- **`lz` namespace**: `declare const lz: { Timer: LzTimerService; Focus: LzFocusService; …; [k: string]: any }` — each `lz.X = A.B` assignment typed as class `A` when `A` is declared (the LFC's service-singleton pattern stores the instance on the service class), else `any`. The index signature keeps unreflected entries (tag map etc.) usable; documented as the remaining loose edge.

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
import { loadLfcReflection } from "../dist/lfc-reflect.js";

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

test("schema-only d.ts (fallback, no reflection) has the expected shape", () => {
  const dts = generateLfcDts();
  assert.ok(dts.includes("declare class LzView extends LzNode"));
  assert.ok(dts.includes("width: number | string;"));            // size
  assert.ok(dts.includes("bgcolor: string | number;"));          // color
  assert.ok(dts.includes("x: number;"));                         // numberExpression
  assert.ok(dts.includes("setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;"));
  assert.ok(dts.includes("onclick: LzDeclaredEvent;"));          // SCHEMA_EVENTS, typed
  assert.ok(dts.includes("parent: LzNode;"));                    // relational override
  assert.ok(dts.includes("declare const canvas: LzCanvas;"));
  assert.ok(!dts.includes("$lzc$"));                             // $-attrs skipped
});

test("reflection-merged d.ts: derived methods, services, typed lz namespace", () => {
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  const dts = generateLfcDts(loadLfcReflection(root));
  assert.ok(dts.includes("declare class LzDeclaredEvent {"));
  assert.ok(/bringToFront\(\): (void|any);/.test(dts));          // derived onto LzView
  assert.ok(dts.includes("declare const lz: {"));
  assert.ok(/Timer: \w+;/.test(dts));                            // typed service singleton
  assert.ok(/Focus: \w+;/.test(dts));
  assert.ok(!/\b(__|\$)\w+\s*\(/.test(dts), "private members leaked");
});

test("generated d.ts compiles clean under tsc (BOTH modes)", () => {
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  for (const dts of [generateLfcDts(), generateLfcDts(loadLfcReflection(root))]) {
    const host = ts.createCompilerHost({});
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (name, langVer) =>
      name === "lfc.d.ts" ? ts.createSourceFile(name, dts, langVer, true) : orig(name, langVer);
    host.fileExists = ((oe) => (n) => n === "lfc.d.ts" || oe(n))(host.fileExists.bind(host));
    const prog = ts.createProgram(["lfc.d.ts"], { noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"] }, host);
    const diags = [...prog.getSyntacticDiagnostics(), ...prog.getSemanticDiagnostics()];
    assert.deepEqual(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")), []);
  }
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
import type { LfcReflection, LfcClass, LfcMethod } from "./lfc-reflect.js";

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
  // NOTE: `keyof this & string` also admits method/event names (harmless);
  // the point is rejecting MISSPELLED names and wrong-typed values.
  "setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;",
  "destroy(): void;",
  "animate(prop: string, to: number, duration: number, isRelative?: boolean | null, moreargs?: Record<string, any> | null): any;",
];
const VIEW_METHODS = [
  "bringToFront(): void;",
  "sendToBack(): void;",
  "setSource(source: string, cache?: any, headers?: any, filetype?: any): void;",
];

/** ES4 annotation text → TS type text. `declared` = names this d.ts declares
 *  (class-name types survive only when they resolve). */
export function es4TsType(t: string | null, declared: (n: string) => boolean): string {
  if (!t) return "any";
  const base = t.replace(/\?$/, "").replace(/\.<.*>$/, "");
  switch (base) {
    case "Number": case "int": case "uint": return "number";
    case "String": return "string";
    case "Boolean": return "boolean";
    case "void": return "void";
    case "Array": return "any[]";
    case "Function": return "(...args: any[]) => any";
    case "*": case "Object": case "null": return "any";
    default: return declared(base) ? base : "any";
  }
}

export function generateLfcDts(reflection?: LfcReflection): string {
  // Reconcile reflected real spellings (LzAnimatorGroup) with schema emission
  // names (LzAnimatorgroup): case-insensitive match on "lz"+tag.
  const schemaNameFor = new Map<string, string>();  // lowercased reflected name -> emitted name
  for (const tag of EMIT_ORDER) schemaNameFor.set(("lz" + tag).toLowerCase(), builtinTsName(tag)!);
  const reflected = reflection ? [...reflection.classes.values()] : [];
  const mergedInto = new Map<string, LfcClass>();   // emitted schema name -> reflected class
  const standalone: LfcClass[] = [];
  const aliases: [string, string][] = [];           // [realName, emittedName] when spellings differ
  for (const rc of reflected) {
    const emitted = schemaNameFor.get(rc.name.toLowerCase());
    if (emitted) {
      mergedInto.set(emitted, rc);
      if (emitted !== rc.name) aliases.push([rc.name, emitted]);
    } else if (rc.name !== "LzEventable" && rc.name !== "LzDeclaredEvent") standalone.push(rc);
    // (LzEventable merges into the base declaration below, not standalone)
  }
  const declaredNames = new Set<string>([
    "LzEventable", "LzDeclaredEvent",
    ...EMIT_ORDER.map((t) => builtinTsName(t)!),
    ...standalone.map((c) => c.name),
    ...aliases.map(([real]) => real),
  ]);
  const T = (t: string | null) => es4TsType(t, (n) => declaredNames.has(n));

  const methodSig = (m: LfcMethod): string => {
    const ps = m.params.map((p) => `${p.name}?: ${T(p.type)}`); // LFC params are widely defaulted; all optional
    return `  ${m.isStatic ? "static " : ""}${m.name}(${ps.join(", ")}): ${m.returnType ? T(m.returnType) : "any"};`;
  };

  // LzEventable IS a real LFC class (core/LzEventable.lzs) — merge its
  // reflected members into the base declaration instead of emitting a
  // duplicate standalone class (TS2300). LzDeclaredEvent stays curated.
  const eventable = reflection?.classes.get("LzEventable");
  const out: string[] = [
    "// AUTO-GENERATED by `node dist/lzx-check.js --write-lfc-dts` from the",
    "// compiler's oracle schema (schema-types.ts) and the LFC source AST",
    "// (lfc-reflect.ts). Do not edit by hand.",
    "",
    "declare class LzEventable {",
    ...(eventable ? [
      ...eventable.vars.map((v) => `  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`),
      ...eventable.methods.filter((m) => m.name !== "setAttribute").map(methodSig), // LzNode's strict generic wins
    ] : []),
    "}",
    "declare class LzDeclaredEvent { ready: boolean; sendEvent(value?: any): void; }",
    "",
  ];
  for (const tag of EMIT_ORDER) {
    const cls = SCHEMA[tag];
    const name = builtinTsName(tag)!;
    const extTag = cls.ext && EMIT_ORDER.includes(cls.ext) ? builtinTsName(cls.ext)! : "LzEventable";
    const emitted = new Set<string>();
    out.push(`declare class ${name} extends ${extTag} {`);
    if (tag === "node") out.push(`  constructor(parent?: LzNode, attrs?: Record<string, any>);`);
    for (const [attr, sType] of Object.entries(cls.attrs)) {
      if (attr.startsWith("$") || attr === "with") continue;
      const override = tag === "node" ? RELATIONAL[attr] : tag === "view" ? VIEW_RELATIONAL[attr] : undefined;
      out.push(`  ${attr}: ${override ?? tsTypeOf(sType)};`);
      emitted.add(attr);
    }
    for (const ev of SCHEMA_EVENTS[tag] ?? []) if (!emitted.has(ev)) { out.push(`  ${ev}: LzDeclaredEvent;`); emitted.add(ev); }
    if (tag === "node") for (const m of NODE_METHODS) { out.push("  " + m); emitted.add(m.split(/[<(]/)[0]); }
    if (tag === "view") for (const m of VIEW_METHODS) { out.push("  " + m); emitted.add(m.split(/[<(]/)[0]); }
    // Derived members (reflection) — schema/curated win on collision.
    const rc = mergedInto.get(name);
    if (rc) {
      for (const v of rc.vars) if (!emitted.has(v.name)) { out.push(`  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`); emitted.add(v.name); }
      for (const m of rc.methods) if (!emitted.has(m.name)) { out.push(methodSig(m)); emitted.add(m.name); }
    }
    out.push("}", "");
  }
  for (const [real, emitted] of aliases) out.push(`type ${real} = ${emitted};`);
  if (aliases.length) out.push("");
  // Non-schema reflected classes (services, kernel, …). Superclass kept when declared.
  for (const rc of standalone) {
    const sup = rc.sup && declaredNames.has(rc.sup) ? ` extends ${rc.sup}` : "";
    const emitted = new Set<string>();
    out.push(`declare class ${rc.name}${sup} {`);
    for (const v of rc.vars) if (!emitted.has(v.name)) { out.push(`  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`); emitted.add(v.name); }
    for (const m of rc.methods) if (!emitted.has(m.name)) { out.push(methodSig(m)); emitted.add(m.name); }
    out.push("}", "");
  }
  // The lz service namespace: `lz.X = A.B` → X typed as class A (the LFC's
  // service-singleton-on-the-service-class pattern), else any. Index signature
  // keeps unreflected entries (the tag map etc.) usable — the one loose edge.
  if (reflection) {
    out.push("declare const lz: {");
    const seen = new Set<string>();
    for (const a of reflection.lzAssignments) {
      if (seen.has(a.prop) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(a.prop)) continue;
      seen.add(a.prop);
      if (a.className.includes(".")) {
        // Service-singleton pattern `lz.X = A.B`: the instance lives on the
        // service class A — instance-typed.
        const cls = a.className.split(".")[0];
        out.push(`  ${a.prop}: ${declaredNames.has(cls) ? cls : "any"};`);
      } else {
        // Class publish `lz.X = SomeClass` (e.g. lz.Delegate = LzDelegate,
        // LaszloEvents.lzs): the VALUE is the class — `typeof`, so
        // `new lz.Delegate(...)` is constructable.
        out.push(`  ${a.prop}: ${declaredNames.has(a.className) ? "typeof " + a.className : "any"};`);
      }
    }
    out.push("  [k: string]: any;", "};");
  } else {
    out.push("declare const lz: any;");
  }
  out.push(
    "declare const canvas: LzCanvas;",
    "declare const Debug: any;",
    "declare var $debug: boolean;",
    "");
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS. If the "compiles clean" test reports duplicate-identifier or shadowing diagnostics, fix the generator (not the test) — e.g. an attr colliding with an event name must emit only once (attrs win; skip the event property if the name already emitted for that class). If TS2416 (incompatible override) appears from a DERIVED member vs an INHERITED schema attr up the ancestor chain, skip the reflected member whenever any ancestor emits that name with a non-`any` type.

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
export interface NameIssue { message: string; line: number }
export interface ConstraintInfo {
  expr: string;           // the inner expression of ${…} / $once{…} / …
  line: number;           // the attribute's source line
  label: string;          // e.g. `width constraint on <view name="bar">`
  ownerType: string; parentType: string; classrootType: string;
  ownerMembers: string[]; // with(this)-legal bare names (declared attrs + named children + schema chain)
}
export interface AppModel {
  classes: AppClassModel[];
  instances: AppInstanceModel[];
  bodies: BodyInfo[];
  constraints: ConstraintInfo[];
  skippedLzs: number;      // non-TS bodies not checked (text/lzs carriers; ALL bodies in .lzx mode)
  nameIssues: NameIssue[]; // invalid TS identifiers — excluded from emission, reported as findings
  staticIssues: NameIssue[]; // markup-literal + cross-reference findings
}
export interface ExtractOptions { es4Bodies?: boolean } // .lzx mode: skip every body (ES4, not TS)
export function extractApp(root: HtmlElem, opts?: ExtractOptions): AppModel
```

**Markup-literal rules** (attribute values on instance elements, skipping `name`/`id`/`data-lz-adopt`/`lzdomadopt` and event/handler attributes starting `on`): resolve the attr's SCHEMA kind (declared `<attribute type>` first, then `schemaAttrType`); a value matching the constraint syntax `/^\s*\$\w*\{[\s\S]*\}\s*$/` routes to `constraints` instead; otherwise validate: `number`/`numberExpression` → `/^-?\d+(\.\d+)?$/`; `size`/`sizeExpression` → number OR `/^\d+(\.\d+)?%$/`; `boolean`/`inheritableBoolean` → `true`|`false`; `color` → `#hex3/6`, `0xhex6`, or a CSS name (`/^[a-zA-Z]+$/`). Violations → `staticIssues`.

**Cross-reference rules:** `<class extends="x">` where `x` is neither a user class seen so far nor a schema tag → issue; duplicate `id` across the app → issue; duplicate `name` among element siblings → issue.

**Constraint context types:** `ownerType` = the instance's synthesized type; `parentType` = the enclosing instance's type (`LzNode` for the root); `classrootType` = the root instance's type (v1: app-level nodes only — class-template subtrees are not walked, same scoping as bodies); `immediateparent` is typed as `parentType` (placement is a documented v1 approximation). `ownerMembers` = instance attrs + named children + user-class chain attrs + ALL schema attr names walking the base tag's extends chain.

**Extraction rules (locked):**
- Tag names: lowercase `tagName`, strip a leading `lz-`. `laszlo-app` root → base `LzCanvas`.
- Owner type resolution for a tag: user `<class name=x>` → `LzUser_x`; `builtinTsName(tag)` if non-null; otherwise `LzView` (assumed user view class from an include — documented).
- Every element that is an app *instance* (the root, plus any element that is not one of `attribute/method/handler/setter/script/class/interface/mixin/dataset/include/font/resource`) gets an `AppInstanceModel` with a synthesized `LzInst_<n>` type extending its base; `name="x"` on a child adds `x: LzInst_<child>` to the PARENT instance's `namedChildren`; `id="y"` records `id`.
- `<class name="rec" extends="view">`: attrs from `<attribute name= type=>` children (type map: same `tsTypeOf` keys; missing/unknown type → `any` — LZX's default attribute type is expression); `<method name="f" args="a,b">` → `methodSigs` entry `f(a: any, b: any): any;`; bodies inside the class get `ownerType = LzUser_rec`. Class subtrees do NOT produce `AppInstanceModel`s (they are templates).
- **Bodies**: `<method>/<handler>/<setter>` with a `text/typescript` carrier (or plain text) produce a `BodyInfo`; `text/lzs` carriers increment `skippedLzs`. `srcLine` = the carrier text node's `line` (or the plain text node's).
- **Params**: `<method args="a, b">` → `a: any, b: any`. `<handler name="onXYZ" args="v">` → `v` typed by resolving attr `XYZ`: (1) instance/class declared `<attribute>` walking the user-extends chain, (2) `schemaAttrType(baseTag, "XYZ")`, else `any`. **Payloads use the RESOLVED type** — `size`/`sizeExpression` → `number`, not `number | string`: the LFC fires attribute events with the resolved value (verified: `$lzc$set_width` sends the computed pixel number, LaszloView.lzs:1354/:2498; a `number | string` payload would false-positive TS2362 on `w * 2` in every real onwidth handler). `<setter name="w" args="v">` → the PROPERTY type (setters receive the authored value, which may be a percent string).
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
  assert.deepEqual(oncount.params, [{ name: "c", tsType: "number" }]);  // declared attr
  assert.deepEqual(onwidth.params, [{ name: "w", tsType: "number" }]);  // schema size, RESOLVED for payloads
  assert.deepEqual(onclick.params, [{ name: "e", tsType: "any" }]);     // non-attr event
  assert.deepEqual(setcount.params, [{ name: "v", tsType: "number" }]);
  assert.equal(oncount.ownerType, "LzInst_2");
});

test("markup literals: bad number/boolean/color values are staticIssues; constraints are not", () => {
  const m = app('<laszlo-app>\n<view width="10p" visible="yes" bgcolor="#12" x="${parent.width}" y="12" opacity="0.5"></view>\n</laszlo-app>');
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("width"));
  assert.ok(msgs.includes("visible"));
  assert.ok(msgs.includes("bgcolor"));
  assert.equal(m.staticIssues.length, 3);           // x is a constraint; y/opacity are fine
  assert.equal(m.staticIssues[0].line, 2);
  assert.equal(m.constraints.length, 1);
});

test("size accepts percents; color accepts names and 0x", () => {
  const m = app('<laszlo-app><view width="50%" bgcolor="red" fgcolor="0xffcc00"></view></laszlo-app>');
  assert.deepEqual(m.staticIssues, []);
});

test("cross-refs: unknown extends, duplicate ids, duplicate sibling names", () => {
  const m = app('<laszlo-app><class name="a" extends="nosuch"></class><view id="x"></view><view id="x"></view><view name="n"></view><view name="n"></view></laszlo-app>');
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("nosuch"));
  assert.ok(msgs.includes('duplicate id "x"'));
  assert.ok(msgs.includes('duplicate sibling name "n"'));
});

test("constraints carry actual context types + ownerMembers", () => {
  const m = app('<laszlo-app><view name="panel"><attribute name="grow" type="boolean"></attribute><view name="bar" width="${parent.width - 20}"></view></view></laszlo-app>');
  assert.equal(m.constraints.length, 1);
  const c = m.constraints[0];
  assert.equal(c.expr, "parent.width - 20");
  assert.equal(c.ownerType, "LzInst_3");   // bar
  assert.equal(c.parentType, "LzInst_2");  // panel
  assert.equal(c.classrootType, "LzInst_1");
  assert.ok(c.ownerMembers.includes("width"));  // schema attr, with(this)-legal
});

test(".lzx mode (es4Bodies): every body skipped, markup still validated", () => {
  const m = extractApp(findLaszloApp(parseHtmlDialect('<laszlo-app><view width="bad"><method name="f">return 1;</method></view></laszlo-app>')), { es4Bodies: true });
  assert.equal(m.bodies.length, 0);
  assert.equal(m.skippedLzs, 1);
  assert.equal(m.staticIssues.length, 1);
});

test("name validation: constructor / invalid identifiers become issues, not declarations", () => {
  const m = app('<laszlo-app><view id="my-id"><attribute name="constructor" type="number"></attribute></view></laszlo-app>');
  assert.equal(m.nameIssues.length, 2);
  assert.ok(m.nameIssues[0].message.includes("my-id"));
  assert.ok(m.nameIssues[1].message.includes("constructor"));
  assert.equal(m.instances[1].id, undefined);
  assert.deepEqual(m.instances[1].attrs, []);
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
  "class", "interface", "mixin", "dataset", "include", "font", "resource",
  "event", "splash", "stylesheet", "import"]);

// Names emitted into the generated .d.ts must be TS identifiers; `constructor`
// is a class-member keyword. Invalid names become NameIssue findings and are
// excluded from emission (a corrupted declaration file would poison the whole
// check — the driver also surfaces any residual app-d.ts diagnostics).
const TS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const validName = (n: string) => TS_IDENT.test(n) && n !== "constructor";

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
  const model: AppModel = { classes: [], instances: [], bodies: [], skippedLzs: 0, nameIssues: [] };
  const userClasses = new Map<string, AppClassModel>();
  let instSeq = 0;

  /** Validate a to-be-emitted name; record + reject invalid ones. */
  function checkName(kind: string, n: string, line: number): boolean {
    if (validName(n)) return true;
    model.nameIssues.push({ message: `${kind} "${n}" is not a valid identifier (or is "constructor") — excluded from checking`, line });
    return false;
  }

  // Resolve an attribute's TS type on an owner: declared attrs (walking the
  // user-extends chain), then the built-in schema, else any. `resolved: true`
  // is the EVENT-PAYLOAD flavor: the LFC fires attribute events with the
  // resolved value (e.g. onwidth sends the computed pixel number, never a
  // percent string — LaszloView.lzs $lzc$set_width/updateWidth), so size
  // maps to plain number there; property declarations keep number | string.
  function resolveAttrType(name: string, declared: AppAttr[], baseTag: string, extChain: string[], resolved: boolean): string {
    const d = declared.find((a) => a.name === name);
    if (d) return d.tsType;
    for (const cn of extChain) {
      const c = userClasses.get(cn);
      const ca = c?.attrs.find((a) => a.name === name);
      if (ca) return ca.tsType;
    }
    const s = schemaAttrType(baseTag, name);
    if (!s) return "any";
    if (resolved && (s === "size" || s === "sizeExpression")) return "number";
    return tsTypeOf(s);
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
      const t = attr ? resolveAttrType(attr, declared, baseTag, extChain, true) : "any";
      return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
    }
    if (kind === "setter") {
      const t = resolveAttrType(el.getAttribute("name") ?? "", declared, baseTag, extChain, false);
      return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
    }
    return args.map((a) => ({ name: a, tsType: "any" }));
  }

  function walkClass(el: HtmlElem): void {
    const name = el.getAttribute("name") ?? "anonymous";
    if (!checkName("class", name, el.line)) return; // issue recorded; class skipped
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
      if (t === "attribute") {
        const an = c.getAttribute("name") ?? "";
        if (checkName("attribute", an, c.line)) cls.attrs.push({ name: an, tsType: attrDeclTsType(c.getAttribute("type")) });
      }
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
    if (id && checkName("id", id, el.line)) inst.id = id;
    const nm = el.getAttribute("name");
    if (nm && parent && checkName("name", nm, el.line)) parent.namedChildren.push({ name: nm, tsName: inst.tsName });

    const baseTag = builtinTsName(tag) ? tag : "view";
    const extChain = user ? [tag] : [];
    const desc = `<${el.tagName.toLowerCase()}${nm ? ` name="${nm}"` : ""}>`;

    // First pass: attribute declarations (so handler payloads can see them).
    for (const c of elemChildren(el))
      if (c.tagName.toLowerCase() === "attribute") {
        const an = c.getAttribute("name") ?? "";
        if (checkName("attribute", an, c.line)) inst.attrs.push({ name: an, tsType: attrDeclTsType(c.getAttribute("type")) });
      }

    for (const c of elemChildren(el)) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") continue;
      if (t === "class" || t === "interface" || t === "mixin") { walkClass(c); continue; }
      if (t === "dataset") continue; // data, not code
      if (t === "method") {
        const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
        // instance methods surface on the instance type via methodSigs-like attr
        const mn = c.getAttribute("name") ?? "";
        if (checkName("method", mn, c.line))
          inst.attrs.push({ name: mn, tsType: `(${args.map((a) => a + ": any").join(", ")}) => any` });
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

- [ ] **Step 3b: Integrate validation + constraints into the implementation**

The Step-3 code needs these additions (same file, `app-model.ts`). NOTE: the
interface declarations in this task's **Interfaces** section are canonical —
they SUPERSEDE the Step-3 sketch's `AppModel` (which predates `constraints`/
`staticIssues`/`ExtractOptions`); declare them exactly as the Interfaces
section shows.

(a) Model init and signature:

```ts
export function extractApp(root: HtmlElem, opts: ExtractOptions = {}): AppModel {
  const model: AppModel = { classes: [], instances: [], bodies: [], constraints: [],
    skippedLzs: 0, nameIssues: [], staticIssues: [] };
  const seenIds = new Set<string>();
  // … (userClasses / instSeq / checkName as in Step 3)
```

(b) `.lzx` mode: at the TOP of `collectBody`, before the carrier logic:

```ts
    if (opts.es4Bodies) { model.skippedLzs++; return; } // .lzx bodies are ES4, not TS
```

(c) `walkClass` extends check (right after `const ext = …`):

```ts
    if (!userClasses.has(ext) && !(ext in SCHEMA))
      model.staticIssues.push({ message: `<class name="${name}"> extends unknown "${ext}"`, line: el.line });
```

(import `SCHEMA` alongside `schemaAttrType` from `./schema-types.js`).

(d) New helpers (module level):

```ts
const CONSTRAINT_RE = /^\s*\$\w*\{([\s\S]*)\}\s*$/;
const SKIP_LITERAL = new Set(["name", "id", "data-lz-adopt", "lzdomadopt", "with", "placement", "options", "styleclass", "datapath"]);

/** All schema attr names up the extends chain (with(this)-legal bare names). */
function schemaAttrNames(tag: string): string[] {
  const out: string[] = [];
  let c: string | null = tag;
  while (c && SCHEMA[c]) { out.push(...Object.keys(SCHEMA[c].attrs).filter((n) => !n.startsWith("$"))); c = SCHEMA[c].ext; }
  return out;
}

/** Literal validation by SCHEMA kind (declared <attribute type> checked via its TS type). */
function literalIssue(name: string, value: string, kind: string | null): string | null {
  const num = /^-?\d+(\.\d+)?$/.test(value);
  switch (kind) {
    case "number": case "numberExpression":
      return num ? null : `attribute ${name}="${value}" is not a number`;
    case "size": case "sizeExpression":
      return num || /^\d+(\.\d+)?%$/.test(value) ? null : `attribute ${name}="${value}" is not a number or percent`;
    case "boolean": case "inheritableBoolean":
      return value === "true" || value === "false" ? null : `attribute ${name}="${value}" is not true/false`;
    case "color":
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) || /^0x[0-9a-fA-F]{6}$/.test(value) || /^[a-zA-Z]+$/.test(value)
        ? null : `attribute ${name}="${value}" is not a color`;
    default: return null;
  }
}
```

(e) In `walkInstance`, AFTER the first pass (attribute declarations) and before the child walk, add the per-attribute validation/constraint pass:

```ts
    // Markup literals + constraint collection (spec "Beyond bodies").
    // Reverse-map a DECLARED attr's TS type back to a literal-validation kind.
    // Compared via tsTypeOf() so the string coupling is explicit (size and
    // color have distinct orderings: "number | string" vs "string | number").
    // A declared type="size" (=== tsTypeOf("size")) is validated as size.
    const declKindOf = (n: string): string | null => {
      const d = inst.attrs.find((a) => a.name === n);
      if (d) {
        if (d.tsType === tsTypeOf("number")) return "number";
        if (d.tsType === tsTypeOf("boolean")) return "boolean";
        if (d.tsType === tsTypeOf("color")) return "color";
        if (d.tsType === tsTypeOf("size")) return "size";
        return null; // any/string/… — not literal-validated
      }
      return schemaAttrType(baseTag, n);
    };
    for (const a of el.attributes) {
      if (SKIP_LITERAL.has(a.name) || a.name.startsWith("on")) continue;
      const cm = CONSTRAINT_RE.exec(a.value);
      if (cm) {
        model.constraints.push({
          expr: cm[1], line: a.line,
          label: `${a.name} constraint on ${desc}`,
          ownerType: inst.tsName,
          parentType: parent ? parent.tsName : "LzNode",
          classrootType: model.instances[0].tsName,
          ownerMembers: [
            ...inst.attrs.map((x) => x.name),
            // user-class chain attrs are with(this)-legal too (the locked rule)
            ...extChain.flatMap((cn) => userClasses.get(cn)?.attrs.map((x) => x.name) ?? []),
            ...schemaAttrNames(baseTag),
          ],
        });
        continue;
      }
      const issue = literalIssue(a.name, a.value, declKindOf(a.name));
      if (issue) model.staticIssues.push({ message: issue, line: a.line });
    }
```

(`desc` is already defined above this insertion point in the Step-3 code — no move needed. `ownerMembers` also gains named children: push each `nc.name` into the matching constraint after the child walk, or simpler — append `inst.namedChildren.map((c) => c.name)` in a small post-pass at the end of `extractApp`: `for (const c of model.constraints) { const inst = model.instances.find((i) => i.tsName === c.ownerType); if (inst) c.ownerMembers.push(...inst.namedChildren.map((n) => n.name)); }`.)

(f) Duplicate id / sibling-name checks: in `walkInstance` where `id`/`nm` are read:

```ts
    if (id && seenIds.has(id)) {
      model.staticIssues.push({ message: `duplicate id "${id}"`, line: el.line });
      // do NOT set inst.id — a second `declare const` would add TS2451 noise
    } else if (id) { seenIds.add(id); /* inst.id set as in Step 3 (after checkName) */ }
```
(Adjust the Step-3 `if (id && checkName(…)) inst.id = id;` line to live inside this else-branch.)

and for siblings, in the parent: keep `const siblingNames = new Set<string>()` per `walkInstance` call; when a child registers `nm`: `if (siblingNames.has(nm)) model.staticIssues.push({ message: \`duplicate sibling name "${nm}"\`, line: c.line }); siblingNames.add(nm);` — implement by passing the parent's set down or hoisting the named-children registration into the parent's loop (the existing code registers from the child; move the duplicate check next to `parent.namedChildren.push`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd compiler && npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add compiler/src/app-model.ts compiler/test/app-model.test.mjs
git commit -m "compiler: app-model — extraction + markup-literal/ref validation + constraint collection"
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
  - `interface ConstraintSpan { genStartLine: number; attrLine: number; label: string; ownerMembers: string[] }` — constraints are single-expression; ALL their diagnostics map to `attrLine`.
  - `function generateConstraintChecks(model: AppModel): { source: string; spans: ConstraintSpan[] }` — one function per constraint:
    `function __lz_constraint_<n>(this: <ownerType>, parent: <parentType>, immediateparent: <parentType>, classroot: <classrootType>): any { return (<expr>); }`

- [ ] **Step 1: Write the failing tests**

Append to `compiler/test/app-model.test.mjs`:

```js
import { generateAppDts, generateBodies, generateConstraintChecks } from "../dist/app-dts.js";

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

test("constraint checks: typed this/parent/classroot params, spans carry ownerMembers", () => {
  const m = app('<laszlo-app><view name="panel"><view width="${parent.width - 20}"></view></view></laszlo-app>');
  const { source, spans } = generateConstraintChecks(m);
  assert.ok(source.includes("function __lz_constraint_1(this: LzInst_3, parent: LzInst_2, immediateparent: LzInst_2, classroot: LzInst_1): any {"));
  assert.ok(source.includes("return (parent.width - 20);"));
  assert.equal(spans.length, 1);
  assert.ok(spans[0].ownerMembers.includes("width"));
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

export interface ConstraintSpan { genStartLine: number; attrLine: number; label: string; ownerMembers: string[] }

/** One function per ${…} constraint, with the ACTUAL enclosing instance types
 *  (spec "Beyond bodies"): this/parent/immediateparent/classroot are precise,
 *  which is what makes checking possible despite the runtime's with(this)
 *  scoping. Diagnostics all map to the attribute's line (single expressions). */
export function generateConstraintChecks(model: AppModel): { source: string; spans: ConstraintSpan[] } {
  const lines: string[] = ["// AUTO-GENERATED constraint-check harness (lzx-check). Do not edit.", ""];
  const spans: ConstraintSpan[] = [];
  model.constraints.forEach((c, idx) => {
    lines.push(`// ${c.label}`);
    const genStartLine = lines.length + 1;
    lines.push(`function __lz_constraint_${idx + 1}(this: ${c.ownerType}, parent: ${c.parentType}, immediateparent: ${c.parentType}, classroot: ${c.classrootType}): any {`);
    spans.push({ genStartLine, attrLine: c.line, label: c.label, ownerMembers: c.ownerMembers });
    lines.push(`return (${c.expr.replace(/\n/g, " ")});`, "}", "");
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
- Create: `compiler/src/lzx-check.ts`, `compiler/src/xml-adapter.ts`
- Create: `compiler/test/fixtures/check-clean.html`, `compiler/test/fixtures/check-errors.html`, `compiler/test/fixtures/check-errors.lzx`
- Test: `compiler/test/lzx-check.test.mjs`
- Modify: `compiler/package.json` (bin + `gen:lfcdts` script)
- Generated + committed: `compiler/lfc.d.ts` (reflection-merged — regenerating parses the LFC, a few seconds)

**Interfaces:**
- Consumes: everything above; `typescript` devDep; the COMMITTED `compiler/lfc.d.ts` (read at `new URL("../lfc.d.ts", import.meta.url)`, falling back to schema-only `generateLfcDts()` when absent — full reflection is too slow to run per check).
- Produces:
  - `interface Finding { line: number; col: number; code: number; message: string; element: string }` (`line`/`col` in the SOURCE app file)
  - `interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number; constraintsChecked: number }`
  - `function checkApp(source: string, fileName: string): CheckResult` — `.lzx` filenames parse via `parseXml` + the `xml-adapter` (ES4 bodies skipped); everything else via `parseHtmlDialect`+`findLaszloApp`.
  - `export function xmlToHtml(e: XmlElem): HtmlElem` from the new `compiler/src/xml-adapter.ts`
  - CLI: `node dist/lzx-check.js <app.html|app.lzx>` → report + exit 1 on findings, 0 clean; `node dist/lzx-check.js --write-lfc-dts` → prints the REFLECTION-merged `lfc.d.ts` (loads the LFC root) to stdout.

**Constraint suppression rule (locked):** a diagnostic in `__lzconstraints.ts` with code 2304 whose message matches `Cannot find name '(\w+)'` is SUPPRESSED when that name is in the span's `ownerMembers` (a `with(this)`-legal bare attribute reference); every other constraint diagnostic is a finding at the span's `attrLine`.

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
  <view name="box" height="12px" visible="maybe" y="${this.parent.nosuchthing}">
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
    <view width="${width - 10}" x="${parent.count + wat}"></view>
  </view>
  <view id="dup"></view>
  <view id="dup" bgcolor="notacolor!"></view>
</laszlo-app>
```

Seeded beyond the body triple: `height="12px"` (bad size literal), `visible="maybe"` (bad boolean), `bgcolor="notacolor!"` (bad color, the `!` fails the name pattern), duplicate `id="dup"`, `${this.parent.nosuchthing}` (member error — `parent` is `LzNode`-typed on `this`, which has no `nosuchthing`), `${parent.count + wat}` (`parent.count` resolves against the TYPED parent param — no finding — while bare `wat` → TS2304 finding), and `${width - 10}` (bare `width` IS an owner member → `with(this)`-legal → suppressed).

Create `compiler/test/fixtures/check-errors.lzx` (the XML dialect):

```xml
<canvas width="400" height="200">
  <view name="box" width="oops" x="${nope + 1}">
    <method name="f">
      return this doesn't parse as TS but is never checked;
    </method>
  </view>
</canvas>
```

Seeded errors: (1) wrong-typed `setAttribute('count', 'oops')` — `count: number`; (2) misspelled member `this.cuont`; (3) `w.toUpperCase()` where `onwidth`'s payload is `number` (resolved) → TS2339. These are exactly the spec's Testing #6 triple.

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

test("errors fixture: bodies, literals, refs, constraints — all mapped to source lines", () => {
  const src = read("check-errors.html");
  const r = checkApp(src, "check-errors.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find((f) => f.line === at(needle));
  // the spec's body triple
  const wrongType = find("setAttribute('count', 'oops')");
  assert.ok(wrongType, "wrong-typed setAttribute not found");
  assert.equal(wrongType.code, 2345);
  const misspelled = find("this.cuont");
  assert.ok(misspelled, "misspelled member not found");
  assert.ok([2339, 2551].includes(misspelled.code));
  assert.ok(r.findings.some((f) => f.message.includes("toUpperCase")), "bad handler-arg use not found");
  // markup literals + refs
  assert.ok(r.findings.some((f) => f.message.includes('height="12px"')));
  assert.ok(r.findings.some((f) => f.message.includes('visible="maybe"')));
  assert.ok(r.findings.some((f) => f.message.includes("notacolor")));
  assert.ok(r.findings.some((f) => f.message.includes('duplicate id "dup"')));
  // constraints: typed-member error + bare-unknown error; bare OWNER member suppressed
  assert.ok(r.findings.some((f) => f.message.includes("nosuchthing")));
  assert.ok(r.findings.some((f) => f.message.includes("'wat'")));
  assert.ok(!r.findings.some((f) => f.message.includes("'width'")), "with(this)-legal bare width must be suppressed");
  assert.equal(r.constraintsChecked, 3);
});

test(".lzx dialect: markup/constraints validated, ES4 bodies skipped", () => {
  const r = checkApp(read("check-errors.lzx"), "check-errors.lzx");
  assert.ok(r.findings.some((f) => f.message.includes('width="oops"')));
  assert.ok(r.findings.some((f) => f.message.includes("'nope'")));  // constraint bare unknown
  assert.equal(r.bodiesChecked, 0);
  assert.equal(r.skippedLzs, 1);
});

test("lzs carriers are skipped, not failed", () => {
  const r = checkApp('<laszlo-app><view><handler name="onclick"><script type="text/lzs">if (this is LzView) x();</script></handler></view></laszlo-app>', "x.html");
  assert.equal(r.skippedLzs, 1);
  assert.equal(r.findings.length, 0);
});

test("invalid names surface as findings instead of corrupting the check", () => {
  const r = checkApp('<laszlo-app><view id="my-id"><attribute name="constructor"></attribute><handler name="onclick"><script type="text/typescript">return 1;</script></handler></view></laszlo-app>', "x.html");
  assert.equal(r.findings.filter((f) => f.element === "(name validation)").length, 2);
  // the body still checks (and is clean) despite the rejected declarations
  assert.equal(r.bodiesChecked, 1);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd compiler && npm test` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement the XML adapter**

Create `compiler/src/xml-adapter.ts`:

```ts
// xml-adapter.ts — XmlElem (parseXml) → HtmlElem-shaped tree, so .lzx apps
// feed the same model extractor as the DOM dialect (spec "Beyond bodies").
// parseXml already carries element lines and attrLines.

import type { XmlElem } from "./xml.js";
import type { HtmlElem, HtmlNode } from "./htmlsource.js";

export function xmlToHtml(e: XmlElem): HtmlElem {
  const attributes = e.attrOrder.map((n) => ({
    name: n, value: e.attrs[n], line: e.attrLines?.[n] ?? e.line ?? 0,
  }));
  const el: HtmlElem = {
    nodeType: 1, line: e.line ?? 0, tagName: e.name.toUpperCase(), attributes,
    childNodes: [],
    getAttribute(n) { const a = attributes.find((x) => x.name === n); return a ? a.value : null; },
    attrLine(n) { const a = attributes.find((x) => x.name === n); return a ? a.line : (e.line ?? 0); },
    setAttribute(n, v) {
      const a = attributes.find((x) => x.name === n);
      if (a) a.value = String(v); else attributes.push({ name: n, value: String(v), line: e.line ?? 0 });
    },
  };
  el.childNodes = e.children.map((c): HtmlNode =>
    c.type === "elem" ? xmlToHtml(c) : { nodeType: 3, nodeValue: c.value, line: c.line ?? 0 });
  return el;
}
```

- [ ] **Step 5: Implement the driver + CLI**

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
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseHtmlDialect, findLaszloApp } from "./htmlsource.js";
import { parseXml } from "./xml.js";
import { xmlToHtml } from "./xml-adapter.js";
import { extractApp } from "./app-model.js";
import { generateAppDts, generateBodies, generateConstraintChecks, BodySpan } from "./app-dts.js";
import { generateLfcDts } from "./lfc-dts.js";
import { loadLfcReflection } from "./lfc-reflect.js";

export interface Finding { line: number; col: number; code: number; message: string; element: string }
export interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number; constraintsChecked: number }

const COMPILER_OPTS: ts.CompilerOptions = {
  noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"],
  target: ts.ScriptTarget.ES2020,
};

/** The COMMITTED reflection-merged lfc.d.ts (fast, deterministic); schema-only
 *  fallback if it hasn't been generated yet. */
function readLfcDts(): string {
  try { return readFileSync(fileURLToPath(new URL("../lfc.d.ts", import.meta.url)), "utf8"); }
  catch { return generateLfcDts(); }
}

export function checkApp(source: string, fileName: string): CheckResult {
  const isLzx = /\.lzx$/i.test(fileName);
  const root = isLzx ? xmlToHtml(parseXml(source)) : findLaszloApp(parseHtmlDialect(source));
  const model = extractApp(root, { es4Bodies: isLzx });
  const appDts = generateAppDts(model);
  const { source: bodiesSrc, spans } = generateBodies(model);
  const { source: constrSrc, spans: constrSpans } = generateConstraintChecks(model);
  const virtual = new Map<string, string>([
    ["lfc.d.ts", readLfcDts()],
    ["__lzapp.d.ts", appDts],
    ["__lzbodies.ts", bodiesSrc],
    ["__lzconstraints.ts", constrSrc],
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
  const findings: Finding[] = [];

  // Extraction-time name validation (invalid ids/class/attribute names).
  for (const ni of model.nameIssues)
    findings.push({ line: ni.line, col: 1, code: 0, message: ni.message, element: "(name validation)" });
  // Markup-literal + cross-reference validation.
  for (const si of model.staticIssues)
    findings.push({ line: si.line, col: 1, code: 0, message: si.message, element: "(markup validation)" });

  // Diagnostics in the generated APP DECLARATIONS are real findings too (an
  // invalid id/attribute name corrupts the type model): swallowing them would
  // let the checker report a false "OK" over a broken program. lfc.d.ts is
  // covered by its own compiles-clean unit test.
  const appSf = prog.getSourceFile("__lzapp.d.ts")!;
  for (const d of [...prog.getSyntacticDiagnostics(appSf), ...prog.getSemanticDiagnostics(appSf)]) {
    findings.push({
      line: 0, col: 0, code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      element: "(generated app declarations — check id/class/attribute names)",
    });
  }

  const bodiesSf = prog.getSourceFile("__lzbodies.ts")!;
  const diags = [...prog.getSyntacticDiagnostics(bodiesSf), ...prog.getSemanticDiagnostics(bodiesSf)];
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

  // Constraint diagnostics: precise this/parent/classroot types; the ONE
  // with(this) accommodation is suppressing TS2304 on the owner's own members.
  const constrSf = prog.getSourceFile("__lzconstraints.ts")!;
  for (const d of [...prog.getSyntacticDiagnostics(constrSf), ...prog.getSemanticDiagnostics(constrSf)]) {
    if (d.start == null) continue;
    const genLine = d.file!.getLineAndCharacterOfPosition(d.start).line + 1;
    let span: (typeof constrSpans)[number] | undefined;
    for (const s of constrSpans) if (s.genStartLine <= genLine) span = s; else break;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (d.code === 2304 && span) {
      const m = /Cannot find name '(\w+)'/.exec(msg);
      if (m && span.ownerMembers.includes(m[1])) continue; // with(this)-legal bare name
    }
    findings.push({ line: span?.attrLine ?? genLine, col: 1, code: d.code, message: msg, element: span?.label ?? "(constraint)" });
  }
  return { findings, skippedLzs: model.skippedLzs, bodiesChecked: model.bodies.length, constraintsChecked: model.constraints.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// realpath resolves the npm .bin symlink (whose basename has no .js extension —
// a naive endsWith() check would make the installed bin a silent no-op);
// pathToFileURL handles Windows paths.
const isMain = !!process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "--write-lfc-dts") {
    // Reflection-merged: derive class members + lz.* from the LFC source.
    const root = fileURLToPath(new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url));
    process.stdout.write(generateLfcDts(loadLfcReflection(root)));
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
  const note = r.skippedLzs ? ` (${r.skippedLzs} non-TS bod${r.skippedLzs > 1 ? "ies" : "y"} skipped)` : "";
  const scope = `${r.bodiesChecked} bodies, ${r.constraintsChecked} constraints`;
  if (r.findings.length) {
    console.error(`${r.findings.length} finding(s) across ${scope}${note}`);
    process.exit(1);
  }
  console.log(`OK — ${scope} checked, 0 findings${note}`);
}
```

- [ ] **Step 6: Wire package.json**

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

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd compiler && npm test`
Expected: PASS. Likely first-run issues and their fixes: (a) the misspelled-member diagnostic may be TS2551 ("did you mean 'count'") — the test accepts both; (b) if `w.toUpperCase()` produces no diagnostic, the payload type resolution fell back to `any` — fix `resolveAttrType`, not the test; (c) if the clean fixture has findings, read them — they are real generator bugs (e.g. a missing curated member).

- [ ] **Step 8: Generate and commit `lfc.d.ts`**

```bash
npm run gen:lfcdts && head -5 lfc.d.ts && wc -l lfc.d.ts
```
Expected: the AUTO-GENERATED banner; a few hundred lines.

- [ ] **Step 9: Commit**

```bash
git add compiler/src/lzx-check.ts compiler/src/xml-adapter.ts compiler/test/lzx-check.test.mjs compiler/test/fixtures/ compiler/package.json compiler/lfc.d.ts
git commit -m "compiler: lzx-check CLI — full-surface validation (bodies, literals, refs, constraints; html + lzx)"
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
Expected: `OK — 1 bodies, 0 constraints checked, 0 findings` (the counter app uses `(this as any)` casts, which check clean). If findings appear, they are real: either the demo's TS is wrong (fix the demo — e.g. the `(this as any).count` casts can now be REMOVED since `count` is a declared attribute: do that, re-run `lzx-check` AND re-load the file-demo in a browser to confirm it still runs) or the generator is (fix it).

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

- [ ] **Step 2b: Verify the full-page (inline) path**

```bash
node dist/lzx-check.js ../examples/dom-authoring/index.html
```
Expected: `OK — 1 bodies, 1 constraints checked, 0 findings` (the inline demo's handler uses `(this as any)` casts; its `${parent.width - 20}` constraint checks clean against the typed parent). This exercises the parser's void-element / raw-text-style / entity handling on a real page. If it errors on page structure, the parser has a well-formedness gap — fix `htmlsource.ts`.

- [ ] **Step 3: Seed-check the error path end-to-end**

```bash
node dist/lzx-check.js test/fixtures/check-errors.html; echo "exit: $?"
```
Expected: three findings printed as `file:line:col TS<code> message [<element>]`, `exit: 1`.

- [ ] **Step 3b: Corpus sweep (.lzx path against real apps)**

```bash
for f in ../docs/component-browser/components.lzx ../examples/ten-minutes/sessionwindow.lzx; do
  node dist/lzx-check.js "$f"; echo "-- $f exit: $?"
done
```
Expected: each app **parses, extracts, and reports** (bodies 0 / skipped N, constraints M). Findings against the 2005-era corpus are acceptable and interesting (report a sample in the task summary); crashes/`ScUnsupported`/adapter errors are bugs — fix them. This is the "validate across everything" acceptance check.

- [ ] **Step 4: Document**

Append to `examples/dom-authoring/README.md`:

```markdown

## Type checking (Slice 2)

`lzx-check` validates the whole authored surface: TypeScript bodies get a
typed `this` (your `<attribute>` declarations, named children, the LFC API
derived from the compiler schema AND the LFC source — see the generated
`compiler/lfc.d.ts`), `setAttribute` names/values are checked, handler args
are typed from the attribute they observe, markup attribute literals are
validated against their types, `extends`/duplicate-id/duplicate-name refs
are checked, and `${…}` constraints are checked with the actual enclosing
instance types. Works on `.html` (DOM dialect) and `.lzx` (XML dialect —
ES4 bodies skipped, everything else validated).

    cd compiler
    node dist/lzx-check.js ../examples/dom-authoring/counter-app.html
    node dist/lzx-check.js ../docs/component-browser/components.lzx

Exit 1 + `file:line:col TS<code>` diagnostics on findings; non-TS bodies
(`text/lzs`, `.lzx`) are skipped and counted. Checking never blocks
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

Per spec/deferred: top-level `<script>` bodies (canvas-owned), nested template-view bodies AND constraints inside `<class>` subtrees, doc-comment (`@param`) type mining for un-annotated LFC params, **mixin member reflection** (`class LzText extends LzView with LzFormatter` — formatter methods won't appear on the merged class; calls to them from `<text>` bodies may false-positive: known, documented), tightening the `lz` namespace's `[k: string]: any` index signature, `immediateparent`/placement-aware typing (v1 approximates as parent), an in-browser `?debug` diagnostics overlay, editor/IDE integration beyond the committed `lfc.d.ts`.
