# DOM-Native Authoring for OpenLaszlo 5.0

**Date:** 2026-07-05
**Status:** Approved design, revised after adversarial review; pre-implementation
**Influences:** dreem / dreem2 (Teem2) — DOM-tags-as-source authoring model

## Goal

Author LZX applications as **native HTML DOM** — custom-element tags (`<view>`,
`<text>`, `<button>`, …) that the browser's HTML parser turns into a live DOM
tree — with **TypeScript** as the code language, compile that tree with the
**existing openlaszlo-5.0 compiler**, and have the runtime **adopt the authored
DOM nodes in place** as the live views.

The authored DOM *is* the running app: inspectable in devtools; statically-
authored plain views keep their identity instead of being replaced by
generated `<div class="lzdiv">` nodes. (Qualifiers: the runtime's separate
click-div tree still exists as today; `<text>`/`<inputtext>` fall back to
generated sprites in Slice 1 — see Seam 2.)

## Principles

1. **Additive, never destructive.** The `.lzx`-text compile path, the LFC
   runtime behavior for existing apps, and the byte-for-byte 4.9 parity
   guarantee are untouched. Every new behavior is behind a new entry point or
   an opt-in compiler option.
2. **Language-compatible.** The DOM authoring dialect is LZX — same tags,
   attributes, and constraint syntax — with a defined set of reconciliations
   forced by the HTML parser (the "Authored dialect" section is the complete
   list) and TypeScript replacing LZX Script as the code-body language.
3. **One compiler.** No second parser/codegen. The DOM front-end produces the
   same intermediate tree (`XmlElem`) that `parseXml` produces; everything
   downstream is reused verbatim.

## Background: what dreem/dreem2 contribute

- **dreem** (and dreem2's client side) author UIs as custom tags in HTML,
  instantiated at runtime with reactive `${…}` constraints — the same lineage
  as LZX. Their runtime renders to anonymous positioned divs via a Sprite
  abstraction, exactly like the LFC's `LzSprite`.
- The idea brought over here: **the page's DOM tree as the source of truth**,
  with no separate XML text file required — while keeping OpenLaszlo's
  compiler (which dreem lacks: it interprets at runtime, paying parse/compile
  cost per load and losing whole-program analysis).
- **Deferred** dreem2 ideas (out of scope now, seams kept open): compositions
  (client+server in one file), the server-side reactive-attribute WebSocket
  bus, RPC proxies, multi-screen targets, the visual editor.

## Architecture

The compiler's public surface funnels through
`compile(source: string, opts)` (`compiler/src/compile.ts:2461`) →
`parseXml(source)` (`compiler/src/xml.ts:73`) → an **`XmlElem` tree**.
Everything downstream (schema, includes, codegen, byte-parity) consumes only
that tree. Two seams:

```
 AUTHORING                COMPILE FRONT-END              RUNTIME
 <laszlo-app> in page  ┐  TS carriers transpiled     ┌ LzSprite adopt path
   or  app file        ├─► domSource.ts ─► XmlElem ──► (existing compiler  ─► authored <view>
   (DOMParser)         ┘   (DOM→XmlElem)   (identical   pipeline)             IS the live element
                                            structure)
```

Note on "existing compiler pipeline": accepting a pre-built root `XmlElem`
requires a small internal refactor of `compile()` (it currently parses the
source itself at :2462) — an extracted `compileFromXml(root, opts)` that both
the text path and the DOM path call. The text path's behavior and output are
unchanged.

**Dialect boundary:** the DOM dialect applies to the **app root** only.
`<include>`d libraries and dataset `src=` files are always parsed as strict
XML via `parseXml` (compile.ts:480, :1432, :2280, :2418, :2452), even when
the root app is DOM-authored. Existing `.lzx` libraries work unchanged from
DOM-authored apps.

### Components

| Unit | Location | Purpose |
| --- | --- | --- |
| `domSource.ts` | `compiler/src/` (new) | Walk a DOM subtree → emit `XmlElem` tree identical in structure to `parseXml` output |
| DOM compile path | composition, not a wrapper | The "compileFromDom" behavior is the composition `domToXmlElem(root, {domAdopt, transpileTs})` + `compileInBrowser(pageUrl, {rootXml})` (browser) or + `compileFromXml(rootXml)` (sync/tests) — no separate named entry point |
| `compileFromXml(root, opts)` | `compiler/src/compile.ts` (extracted) | The existing `compile()` body minus the `parseXml` call; `compile()` becomes `parseXml` + `compileFromXml` |
| `compileInBrowser` rootXml option | `compiler/src/browser.ts` | Accept a pre-built root `XmlElem` instead of fetched text, reusing include/resource fetch plumbing. The compile cache is **skipped** for the rootXml path in Slice 1 (the `BrowserCache` revalidates closures over HTTP; an inline DOM root has no fetchable validator — content-hash caching is a follow-up) |
| `lz-adopt-patch.js` | `startup/` (new, runtime patch module) | Adopt authored elements as sprite `__LZdiv`s — see Seam 2 |
| `lz-ts.js` | `startup/` (new, built bundle) | Lazy-loaded TS transpile bundle (`ts.transpileModule`, ES5 target) the bootstrap injects as `transpileTs` |
| `laszlo-dom.js` | `startup/` (new) | Bootstrap: gather source DOM (inline or fetched file), transpile carriers, compile, run, adopt, reveal |
| `lzx-check` | `compiler/` (new CLI, Slice 2) | App-aware TypeScript type checking (see "TypeScript integration") |
| Demo page | `examples/dom-authoring/` (new) | App authored entirely in DOM tags proving the full slice |

## The authored dialect

This section is the **complete** set of HTML↔LZX reconciliations. Anything
not listed here is plain LZX.

### Root element

- The app root is **`<laszlo-app>`**, which maps to the root `XmlElem` named
  `canvas` (the compiler hard-requires a `canvas` root, compile.ts:2463).
  Canvas attributes (`width`, `height`, `bgcolor`, `proxied`, …) are authored
  on `<laszlo-app>`.
- A literal `<canvas>` tag is **forbidden** in the dialect: it is an
  `HTMLCanvasElement` — its children are unrendered fallback content and it
  paints a default 300×150 surface.

### Tag-collision inventory

LZX tag names that collide with HTML's parser or element semantics cannot be
authored bare. The dialect provides a uniform escape: any LZX tag may be
written **`lz-<tag>`** (the adapter strips the prefix). Colliding tags MUST
use it:

| LZX tag | HTML problem | Policy |
| --- | --- | --- |
| `canvas` | real element, fallback-content parsing | forbidden; use `<laszlo-app>` root |
| `script` | executed by the page parser | carrier convention (below); bare `<script>` is a dialect **error** |
| `style` | RAWTEXT parsing; browser applies content as page CSS | must author `<lz-style>` |
| `image` | parser rewrites `<image>` → void `<img>`, destroying children | must author `<lz-image>` |
| `html` | in-body `<html>` merges into the document element | must author `<lz-html>` |
| `form` | nested-form start tags silently dropped | must author `<lz-form>` |
| `button`, `label`, `menu` | parse OK but adopted elements carry UA chrome/semantics | must author `<lz-button>` / `<lz-label>` / `<lz-menu>` |
| `param` | void element — children impossible | must author `<lz-param>` |
| `font` | parses OK; never a view (resource declaration), no adoption | bare allowed |

The adapter maintains this list and rejects bare colliding tags with a clear
diagnostic. Non-colliding LZX tags (`view`, `text`, `inputtext`, `attribute`,
`method`, `handler`, `dataset`, `class`, …) are authored bare.

### Names

- The HTML parser lowercases tag and attribute names. Core LZX is lowercase
  already; **user-defined `<class>` names AND user-defined attribute/event
  names must be authored lowercase** (a camelCase `myAttr="1"` silently
  arrives as `myattr` and would never match a camelCase declaration).

### Attribute values

- The DOM preserves literal newlines/tabs in attribute values, but `parseXml`
  applies XML normalization (literal `\t\r\n` → single space, xml.ts:199).
  The adapter **replicates that normalization** so multi-line `onclick=` /
  `${…}` values compile identically.
- Undetectable corner (documented rule): in the DOM, an authored `&#10;` and
  a literal newline are both `\n` by the time the adapter sees them — both
  normalize to a space. Apps that need a real newline in an attribute value
  put the code in a carrier instead.

### Self-closing and structure

- HTML does not self-close custom elements: `<view/>` must be written
  `<view></view>`.
- Text nodes become `XmlText` as `parseXml` produces them; the compiler
  normalizes indentation whitespace downstream. Known divergences, documented
  as dialect rules: HTML decodes the full entity set (`&nbsp;` → NBSP) while
  XML knows only the five core entities; browsers normalize CRLF; HTML strips
  the newline immediately after `<pre>`.

### Code carriers

The HTML parser treats `<` `>` `&` inside element text as markup — but parses
`<script>` content as raw text, and **does not execute** scripts bearing a
non-JavaScript `type`. Therefore:

- Code bodies live in **typed script carriers**:
  `<script type="text/typescript">` (the default language, see next section)
  or `<script type="text/lzs">` (raw LZX Script escape hatch, passed through
  untransformed).
- A carrier **directly inside** `<method>`, `<handler>`, or `<setter>` is a
  raw-text body carrier: its `textContent` becomes the parent element's code
  body and the carrier is elided from the emitted tree.
  `<method name="f" args="n"><script type="text/typescript">return n*2;</script></method>`
  yields the same `XmlElem` as XML `<method name="f" args="n">return n*2;</method>`.
- A typed carrier **elsewhere** maps to a real LZX `<script>` element
  (top-level script blocks), with the `type` attribute elided.
- A **bare `<script>`** (no type, or a JavaScript type) is a dialect error:
  in the inline path the browser would execute it as page JS during parse,
  before the bootstrap runs (a `return` outside a function throws; a
  top-level body would run against a nonexistent runtime). The adapter
  rejects it with a diagnostic. The rule applies in both paths (the
  `DOMParser` file path never executes scripts, but documents must stay
  portable between paths).
- Simple code with no markup-significant characters may still be written as
  plain element text inside `<method>`/`<handler>`/`<setter>` — treated as
  TypeScript, same as a typed carrier.
- **Inline `<dataset>` XML content** is not representable in HTML (the parser
  lowercases, re-nests, and rewrites arbitrary XML). Datasets in the DOM
  dialect either use `src=` files (parsed as strict XML, unchanged) or an XML
  carrier: `<script type="application/xml">` inside `<dataset>`, whose text
  is parsed with `DOMParser`'s `text/xml` mode and grafted into the tree
  verbatim.

## TypeScript integration

**TypeScript is the code language of the DOM dialect.** It must be
*type-compatible* with OpenLaszlo's (ES4-heritage) type system as implemented
in this repo.

### Runtime pipeline (Slice 1, blocking)

- Carrier bodies → **TS transpile** (type-strip + ES5 downlevel via
  `ts.transpileModule` or esbuild; no type checking; runs in the bootstrap /
  the bootstrap's compile step) → output within the ES3-era grammar `sc.ts` accepts →
  existing compiler, unchanged.
- Modern syntax (arrows, `let`/`const`, template literals, destructuring)
  downlevels cleanly — the authoring language is modern TS, not typed ES3.
- **ES4 operator mapping** (verified against `sc.ts`):
  - `:Type` annotations — both ES4 (`sc.ts:391`) and TS erase them; identical
    semantics. TS primitives `number`/`string`/`boolean` correspond to ES4
    `Number`/`String`/`Boolean`.
  - `e cast T` (ES4, erased, `sc.ts:246`) → `e as T` (TS, erased). Exact
    equivalent.
  - `a is B` (ES4, compiles to the mixin-aware runtime test `B.$lzsc$isa(a)`,
    `sc.ts:280`) → TS code uses `instanceof` for plain classes, or a typed
    runtime helper exposing the mixin-aware test for mixin/interface cases.
- The `text/lzs` escape hatch keeps raw LZX Script (with `is`/`cast`) usable
  per-carrier; the `.lzx`-text path is untouched as always.

### App-aware type checking (Slice 2, non-blocking)

Three generated layers, then a checker harness:

1. **`lfc.d.ts`** — generated from the compiler's oracle schema
   (`schema-types.ts`: class lineage, attribute types, event *names* —
   events typed `any`) plus a small hand-curated method core verified
   against `runtime/lfc-src` (`setAttribute`/`destroy`/`animate`; view:
   `bringToFront`/`sendToBack`/`setSource`), and the `canvas` global.
   Delegate shapes and `lz.*` typing are `any` in Slice 2 (follow-up).
2. **Per-app declarations** — synthesized from the authored DOM: each
   `<class name="rec" extends="view">` becomes a declared class extending
   `LzView`, with `<attribute type="…">` mapped to TS types (`number`→
   `number`, `boolean`→`boolean`, `color`→`string | number`, `size`→
   `number | string`, `expression`/`css`/missing→`any` — LZX's default
   attribute type is `expression`), `<method>` signatures from their
   `args`, and named children / `id`s as typed properties / globals.
   Deterministic type names: built-ins `Lz<Tag>`, user classes
   `LzUser_<name>`, per-instance synthesized types `LzInst_<n>`. Ids,
   class names, and attribute names must be TS identifiers (and not
   `constructor`) — violations are findings, and diagnostics from the
   generated app declarations themselves are surfaced, never swallowed.
3. **Body-checking harness** — each method/handler body is checked as a
   function body with **typed `this`** (the owning class) and typed args:
   a handler observing an attribute is typed from that attribute, with
   size attrs resolved to `number` (the LFC fires attribute events with
   the *resolved* value — e.g. `$lzc$set_width` sends the computed pixel
   number, never a percent string). `setAttribute` is strict —
   `setAttribute<K extends keyof this & string>(name: K, value: this[K])`
   — so misspelled attribute names and wrong-typed values are findings;
   LZX's set-an-undeclared-name idiom needs the `(this as any)` escape
   hatch, deliberately. TS bodies must use explicit `this.` (the runtime's
   `with(this)` scoping tolerates bare names; the checker does not).
   `${…}` **constraint expressions are deferred**: constraints compile
   with `with(this)` scoping (bare `parent` etc., compile.ts:563), which
   TS cannot model without identifier rewriting — a follow-up.

**Where it runs:** dev-time. A Node CLI (`lzx-check`) loads an app (inline
page or file — pages must be **well-formed**: explicit close tags; HTML void
elements and raw-text `<script>`/`<style>` are supported, but the checker's
dependency-free parser has no HTML implied-end-tag error recovery),
synthesizes the declarations, runs `tsc`, and reports diagnostics mapped
back to their element. The browser bootstrap never blocks
on checking (erasability: strip always succeeds; diagnostics are a dev tool).
An in-browser `?debug` diagnostics overlay is a possible later addition.

## Seam 1 — compiler front-end (`domSource.ts`)

`domToXmlElem(node)`: a recursive walk producing `XmlElem`/`XmlText` nodes,
applying the dialect rules above (prefix stripping, attribute-value
normalization, carrier elision — carriers are transpiled before this walk).

**Adopt-id stamping** (only when `domAdopt: true`):

- Stamped: statically-authored **plain-view instance elements** in the app
  body. Each gets `data-lz-adopt="N"` on the live DOM node and a reserved
  `lzdomadopt="N"` attribute on its `XmlElem`.
- **Explicitly NOT stamped:** (a) any subtree of `<class>` / `<interface>` /
  `<mixin>` — those are templates; a stamped template child would make every
  instance claim the same live element; (b) `<dataset>` content — a stamp
  would be serialized into `initialdata` and corrupt user data; (c) `<text>`
  and `<inputtext>` elements (Slice 1 — see Seam 2).
- With `domAdopt` off/absent (all existing paths), no reserved attributes
  exist anywhere ⇒ the text path's output is byte-identical to today.

**Equivalence contract:** for any app authored in both dialects,
`domToXmlElem(htmlDom)` deep-equals `parseXml(lzxText)` modulo (a) adopt-id
attributes, (b) source position fields (`line`, `endLine`, `endCol`,
`closeLine`, `attrLines` — absent for DOM sources; the compiler reads them
only for debug-build directives), and (c) the `XmlText.cdata` flag (never
read by the compiler — compile.ts sets it but nothing consumes it).

## Seam 2 — runtime element adoption

**Constraint discovered during planning: `runtime/lfc-src` cannot be edited.**
The LFC itself builds byte-for-byte against the 4.9 oracle golds in all four
modes (README; enforced by `compiler-verify`) — that guarantee is the
project's identity, and any edit to `LzSprite.js` or `LaszloView.lzs` would
break it. Adoption is therefore implemented as a **runtime patch module**
(`startup/lz-adopt-patch.js`) that the bootstrap prepends to the compiled app
JS (the embed sequence loads the LFC script first, then the app script — so
the patch runs after the LFC exists and before any view is constructed). The
LFC on disk stays byte-identical; existing apps never load the patch.

- **Threading (confirmed by review, low-risk):** the compiler does not reject
  unknown attributes (`attrType` defaults to `"string"`, schema.ts:42-48), so
  `lzdomadopt` flows into the compiled instance args unchallenged, and
  `LzView.__makeSprite(args)` (LaszloView.lzs:495) receives the args before
  attribute application.
- **The patch:** wraps `LzView.prototype.__makeSprite`. After the original
  runs (sprite exists, `__LZdiv` is a fresh unattached div), if
  `args.lzdomadopt` is present: set `args.lzdomadopt = LzNode._ignoreAttribute`
  (the sentinel used for `stretches`/`resource`, LaszloView.lzs:459-468 — so
  it is never applied as a normal attribute, no spurious event, no `?debug`
  warning), look up the authored element in the registry, copy the created
  div's `className` (`lzdiv` — default styles are class-selector CSS,
  LzSprite.js:503-532, so they apply to non-div elements; `position:absolute`
  forces block layout on inline custom elements) and any inline `cssText`
  onto it, set its `owner` back-reference, and swap it in as
  `sprite.__LZdiv`. Subclasses (`LzText` etc.) override `__makeSprite`
  entirely, so the wrapper never fires for them — matching the stamping
  exclusion.
- **Registry semantics:** consume-once (`Map` delete on claim). Missing or
  already-consumed ids fall back to the created div with a console warning.
  The app always runs; adoption is best-effort per node.
- **`addChildSprite` needs no patch:** views are constructed in document
  order, and `appendChild` of an already-nested authored element re-appends
  it in that same order, so sibling order is preserved (and z-order is
  explicit via `__setZ`, not DOM-order). Verified by a sibling-order test.
  Click/container-div trees (`__LZclickcontainerdiv` etc.) are untouched —
  note `fix_clickable` defaults to true, so the parallel anonymous click-div
  tree still exists for clickable views; adoption covers the *content*
  element.
- **Root reparenting (documented reality):** the root sprite builds its
  `lzcanvasdiv` inside `lz.embed`'s appenddiv (LzSprite.js:27-116;
  `LaszloCanvas.__makeSprite` takes null args, LaszloCanvas.lzs:248).
  Top-level authored views are therefore **moved** (appendChild) into
  `lzcanvasdiv` on adoption — element identity and children are preserved,
  but their position in the document changes. The bootstrap places the app
  host so this is visually seamless.
- **Sprite subclasses (Slice 1 position):** `<text>`/`<inputtext>` do not use
  the plain `LzSprite` constructor — `LzText.__makeSprite` creates an
  `LzTextSprite` that builds its own container + scrolldiv and renders via
  `innerHTML` (LzTextSprite.js:14-37, :284). **Slice 1: text/inputtext fall
  back to created sprites (no adoption)**; the bootstrap removes the authored
  text elements after compile (they are source), so no double rendering.
  Adopting text sprites is a designed-for follow-up, not a Phase-1 goal.
- **Fallback is the norm, adoption is the bonus:** replicated views (one
  stamped element can't serve N instantiations — hence not stamped),
  programmatically-created views, and `<class>`-template instantiations
  create divs exactly as today.
- The bootstrap strips consumed carrier `<script>`s from the live DOM before
  the app runs (they are source, not content).

## Bootstrap & authoring model (`laszlo-dom.js`)

Two source paths, one pipeline:

- **Inline:** the page contains `<laszlo-app>…app tags…</laszlo-app>`. The
  bootstrap hides the subtree (pre-upgrade flash prevention), stamps
  adopt-ids / builds the adoption registry, calls
  `domToXmlElem(host, {domAdopt:true, transpileTs})` then
  `compileInBrowser(pageUrl, {rootXml})`, runs
  the emitted JS, the runtime adopts the nodes, then reveals.
- **File:** `<laszlo-app src="app.html">`. The bootstrap fetches the file,
  parses it with `DOMParser` (`text/html` — this is what makes the dialect
  HTML-flavored rather than strict XML; parsed scripts never execute),
  inserts the parsed subtree into the app host element so it is live and
  inspectable, then proceeds identically to inline.

The bootstrap is independent of the existing service worker (which continues
to serve `.lzx`-text apps unchanged) and uses the existing browser compiler
bundle (`compiler/lzc-browser.js`) directly.

## Error handling

- **Dialect errors** (bare `<script>`, bare colliding tag, literal
  `<canvas>`): the adapter rejects with a specific diagnostic naming the
  element and the rule; the bootstrap renders it into the app host.
- **Compile errors** surface exactly as the existing browser-compile path
  surfaces them; the bootstrap renders them into the app host element instead
  of a blank screen.
- **Transpile errors** (malformed TS in a carrier): reported like compile
  errors, naming the owning element.
- **Adoption mismatches** (registry id with no live element, or an
  already-consumed id): the sprite falls back to creating a div and logs a
  console warning. The app still runs.
- **Unknown tags** inside `<laszlo-app>` flow to the compiler and produce the
  compiler's normal unknown-tag diagnostics.

## Scope

**Slice 1 — authoring runs end-to-end (blocking):**

1. `domSource.ts` adapter (dialect rules, stamping scope) + equivalence tests
2. `compileFromXml` extraction; `compileInBrowser`
   rootXml option (content-hash cache key)
3. TS transpile step for carriers (strip + ES5 downlevel; `text/lzs`
   pass-through)
4. `lz-adopt-patch.js` runtime patch module (consume-once registry,
   `_ignoreAttribute` consumption, sibling-order test; zero lfc-src edits)
5. `laszlo-dom.js` bootstrap (inline + file)
6. Demo page in `examples/dom-authoring/`: several views, one layout, a
   `<handler>` in TS (via typed carrier), a `${…}` constraint — with the
   authored plain-view nodes provably the live DOM.

**Slice 2 — app-aware type checking (non-blocking):**

7. Generated `lfc.d.ts` from schema + LFC
8. Per-app declaration synthesis (`<class>`, `<attribute>`, ids, named
   children)
9. `lzx-check` CLI: typed-`this` body checking, element-mapped diagnostics

**Non-goals (explicitly deferred):**

- Backend work: dreem2 compositions, server-side reactive tags, WebSocket
  attribute bus, RPC. (The existing Node server and its WebSocket remain
  available as-is.)
- A Custom-Elements (`customElements.define`) registry — we control
  instantiation; CE lifecycle adds ordering complexity for no gain here.
- Adopting `<text>`/`<inputtext>` sprite subclasses (designed-for follow-up).
- Exhaustive component-library coverage or porting all examples.
- The dreem2 visual editor.
- In-browser type-diagnostics overlay (`lzx-check` is dev-time CLI first).
- `${…}` constraint-expression checking (blocked on `with(this)` scoping —
  see "App-aware type checking" layer 3).
- Typed `lz.*` services and event/delegate shapes (`any` in Slice 2).
- **Debug/backtrace/profile source-line parity for DOM-authored apps.** A
  live DOM has no source text lines; DOM-path apps target the production
  build. They still *run* under `?debug` — they just lack exact source-line
  directives. The `.lzx`-text path keeps full four-mode parity.

## Testing

1. **DOM/text equivalence (the core proof).** For a corpus of sample apps
   written in both dialects, assert `domToXmlElem(html)` deep-equals
   `parseXml(lzx)` modulo the contract's exclusion list (adopt-ids, source
   position fields, `cdata`). Corpus must cover: prefixed colliding tags,
   multi-line attribute values (normalization), typed carriers in all three
   positions (method body, top-level script, dataset XML), `text/lzs`
   pass-through, and entity edge cases.
2. **Adoption identity.** After the demo app runs:
   `authoredElement === view.getSprite().__LZdiv` for each authored
   plain-view element; text views excluded (Slice-1 fallback); no orphaned
   generated divs for adopted nodes; sibling order preserved.
3. **Byte-parity guard.** With `domAdopt` off (all existing paths), compiler
   output is byte-identical to today — the existing `compiler-verify` harness
   already asserts this across the corpus; add a unit check that no reserved
   `lzdomadopt` attribute can appear without the option.
4. **Transpile correctness.** TS carriers using arrows / `let` / template
   literals / `as` compile through `sc.ts` and behave identically to
   hand-written LZX Script equivalents; `text/lzs` carriers with `is`/`cast`
   pass through unmodified.
5. **Behavioral demo checks.** Constraint updates, the layout, and the
   handler in the demo app work identically to the same app compiled from
   `.lzx` text.
6. **Slice 2:** `lzx-check` catches a wrong-typed attribute assignment, a
   misspelled member on a typed `this`, and a bad handler-arg use in the
   demo; clean demo passes with zero diagnostics.

## Alternatives considered

- **B — real Custom Elements registry** (`customElements.define` per tag,
  `connectedCallback`-driven upgrade): fights LFC's absolute-positioning and
  global-style model, requires dynamic registration for user `<class>`
  definitions, adds lifecycle-ordering complexity. Rejected — we already
  control instantiation.
- **C — serialize DOM back to XML text and reuse `parseXml`:** simplest
  front-end but reintroduces XML-escaping pain for code bodies and loses live
  node identity, degrading adoption to fragile positional matching. Rejected
  except as a throwaway spike technique.
- **ES4/LZX Script as the DOM-dialect code language:** rejected as the
  default (TS chosen for modern syntax + real tooling), retained per-carrier
  via `type="text/lzs"`.
