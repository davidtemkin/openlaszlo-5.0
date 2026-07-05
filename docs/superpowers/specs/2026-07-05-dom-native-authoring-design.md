# DOM-Native Authoring for OpenLaszlo 5.0

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**Influences:** dreem / dreem2 (Teem2) — DOM-tags-as-source authoring model

## Goal

Author LZX applications as **native HTML DOM** — custom-element tags (`<view>`,
`<text>`, `<button>`, …) that the browser's HTML parser turns into a live DOM
tree — then compile that tree with the **existing openlaszlo-5.0 compiler**, and
have the runtime **adopt the authored DOM nodes in place** as the live views.

The authored DOM *is* the running app: inspectable in devtools, no anonymous
generated `<div class="lzdiv">` for statically-authored views.

## Principles

1. **Additive, never destructive.** The `.lzx`-text compile path, the LFC
   runtime behavior for existing apps, and the byte-for-byte 4.9 parity
   guarantee are untouched. Every new behavior is behind a new entry point or
   an opt-in compiler option.
2. **Language-compatible.** The DOM authoring dialect is LZX — same tags, same
   attributes, same constraint syntax — with only the reconciliations the HTML
   parser forces (documented below).
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
 <laszlo-app> in page  ┐                             ┌ LzSprite adopt path
   or  app.lzx file    ├─► domSource.ts ─► XmlElem ──► (existing compiler,  ─► authored <view>
   (DOMParser)         ┘   (DOM→XmlElem)   (identical   unchanged)             IS the live element
                                            structure)
```

### Components

| Unit | Location | Purpose |
| --- | --- | --- |
| `domSource.ts` | `compiler/src/` (new) | Walk a DOM subtree → emit `XmlElem` tree identical in structure to `parseXml` output |
| `compileFromDom(rootElement, opts)` | `compiler/src/` (new entry) | Wrap `compile()` with the DOM adapter; stamps adopt-ids when `domAdopt: true` |
| `compileInBrowser` rootXml option | `compiler/src/browser.ts` (small refactor) | Accept a pre-built root `XmlElem` instead of fetched text, reusing its existing include/resource fetch plumbing |
| `LzSprite` adopt path | `runtime/lfc-src/kernel/dhtml/LzSprite.js` | Use the authored element as `__LZdiv` instead of `createElement('div')` |
| `LzView.__makeSprite` | `runtime/lfc-src/views/LaszloView.lzs` | Forward the adopt-id from instance args to the sprite constructor |
| `laszlo-dom.js` | `startup/` (new) | Bootstrap: gather source DOM (inline or fetched file), compile, run, adopt, reveal |
| Demo page | `examples/dom-authoring/` (new) | App authored entirely in DOM tags proving the full slice |

## Seam 1 — compiler front-end (`domSource.ts`)

`domToXmlElem(node)`: a recursive walk producing `XmlElem`/`XmlText` nodes.

**HTML↔LZX reconciliation rules:**

- **Names.** Tag and attribute names arrive from the HTML parser lowercased →
  used as-is for `XmlElem.name` / `attrs`. Core LZX tags are already
  lowercase. **User-defined `<class>` names must be authored lowercase**
  (documented authoring rule).
- **Attributes.** Values verbatim (the DOM has already entity-decoded);
  `attrOrder` from `element.attributes` iteration order. Inline handler
  attributes (`onclick="…"`) pass through unchanged.
- **Self-closing tags.** HTML does not self-close custom elements:
  `<view/>` must be written `<view></view>` (documented authoring rule).
- **Children / whitespace.** Text nodes become `XmlText` exactly as
  `parseXml` produces them; the compiler already normalizes indentation
  whitespace downstream — no special-casing in the adapter.
- **Code blocks (`<script>` carrier convention).** The HTML parser treats
  `<` `>` `&` inside element text as markup — but parses `<script>` content
  as raw text. So:
  - A `<script>` **directly inside** `<method>`, `<handler>`, or `<setter>`
    is a **raw-text carrier**: its `textContent` becomes the parent element's
    code body (an `XmlText` with `cdata: true`), and the `<script>` wrapper
    is elided from the tree.
    `<method name="f" args="n"><script>return n*2;</script></method>`
    yields the identical `XmlElem` as XML
    `<method name="f" args="n">return n*2;</method>`.
  - A `<script>` **anywhere else** maps to a real LZX `<script>` element
    (top-level script blocks).
  - Simple code with no markup-significant characters may still be written as
    plain element text.
- **Adopt-id stamping** (only when `domAdopt: true`): each view-bearing
  authored element gets `data-lz-adopt="N"` set on the live DOM node, and a
  reserved `lzdomadopt="N"` attribute on its `XmlElem`. With `domAdopt`
  off/absent (all existing paths), no reserved attributes exist anywhere ⇒
  the text path's output is byte-identical to today.

**Equivalence contract:** for any app authored in both dialects,
`domToXmlElem(htmlDom)` deep-equals `parseXml(lzxText)` modulo (a) adopt-id
attributes and (b) source line/column fields (`line`, `endLine`, `endCol`,
`closeLine`, `attrLines` — absent for DOM sources). This contract is enforced
by tests (below).

## Seam 2 — runtime element adoption

- **`LzView.__makeSprite`** (`LaszloView.lzs` ~line 495): if the instance args
  carry an adopt-id (from the compiled `lzdomadopt` attribute), pass it to
  `new LzSprite(this, false, adoptId)`.
- **`LzSprite` constructor**: when an adopt-id is supplied and the bootstrap's
  adoption registry has a live element for it, use that element as
  `this.__LZdiv` (adding the `lzdiv` class and the same default styles a
  created div gets). Otherwise `createElement('div')` exactly as today.
- **`addChildSprite`**: when the child sprite's `__LZdiv` is already a DOM
  descendant of the parent's `__LZdiv` (true for adopted, already-nested
  authored nodes), **skip the `appendChild`** — a re-append would reorder
  siblings. Click/container-div trees (`__LZclickcontainerdiv` etc.) are
  managed exactly as today.
- **Fallback is the norm, adoption is the bonus.** Replicated views,
  programmatically-created views, and `<class>`-template instantiations have
  no adopt-id and create divs exactly as today. Only statically-authored
  top-level instance nodes adopt.
- The bootstrap strips consumed carrier `<script>`s from the live DOM before
  the app runs (they are source, not content).

**Correlation mechanism:** adopt-id threading (compile-time stamp → instance
args → sprite) is the primary design. If the implementation spike shows
threading a reserved attribute through arg application is heavier than
expected, the documented fallback is a document-order adoption registry with
tag-name match guards. The implementation plan starts with a spike to settle
this.

## Bootstrap & authoring model (`laszlo-dom.js`)

Two source paths, one pipeline:

- **Inline:** the page contains `<laszlo-app>…app tags…</laszlo-app>`. The
  bootstrap hides the subtree (pre-upgrade flash prevention), stamps adopt-ids
  / builds the adoption registry, calls `compileFromDom(root, {domAdopt:true})`,
  runs the emitted JS, the runtime adopts the nodes, then reveals.
- **File:** `<laszlo-app src="app.lzx">`. The bootstrap fetches the file,
  parses it with `DOMParser` (`text/html` — this is what makes the dialect
  HTML-flavored rather than strict XML), inserts the parsed subtree into the
  app host element so it is live and inspectable, then proceeds identically
  to inline.

The bootstrap is independent of the existing service worker (which continues
to serve `.lzx`-text apps unchanged) and uses the existing browser compiler
bundle (`compiler/lzc-browser.js`) directly.

## Error handling

- **Compile errors** surface exactly as the existing browser-compile path
  surfaces them (the compiler's error type is unchanged); the bootstrap
  renders them into the app host element instead of a blank screen.
- **Adoption mismatches** (registry id with no live element — e.g. the user
  mutated the DOM between stamp and run): the sprite falls back to creating a
  div and logs a console warning. The app still runs; it just loses adoption
  for that node.
- **Unknown tags** inside `<laszlo-app>` flow to the compiler and produce the
  compiler's normal unknown-tag diagnostics.

## Scope

**Phase-1 vertical slice (this spec):**

1. `domSource.ts` adapter + equivalence tests
2. `compileFromDom` entry + `compileInBrowser` rootXml option
3. `LzSprite`/`__makeSprite` adopt path
4. `laszlo-dom.js` bootstrap (inline + file)
5. One demo page in `examples/dom-authoring/`: several views, one layout, a
   `<handler>` (via script carrier), a `${…}` constraint — with the authored
   nodes provably the live DOM.

**Non-goals (explicitly deferred):**

- Backend work: dreem2 compositions, server-side reactive tags, WebSocket
  attribute bus, RPC. (The existing Node server and its WebSocket remain
  available as-is.)
- A Custom-Elements (`customElements.define`) registry — we control
  instantiation; CE lifecycle adds ordering complexity for no gain here.
- Exhaustive component-library coverage or porting all examples.
- The dreem2 visual editor.
- **Debug/backtrace/profile source-line parity for DOM-authored apps.** A live
  DOM has no source text lines; DOM-path apps target the production build.
  They still *run* under `?debug` — they just lack exact source-line
  directives. The `.lzx`-text path keeps full four-mode parity.

## Testing

1. **DOM/text equivalence (the core proof).** For a corpus of sample apps
   written in both dialects, assert `domToXmlElem(html)` deep-equals
   `parseXml(lzx)` modulo adopt-ids and line fields. Proves
   "language-compatible" and full pipeline reuse.
2. **Adoption identity.** After the demo app runs:
   `authoredElement === view.getSprite().__LZdiv` for each authored view, and
   no orphaned generated divs for adopted nodes.
3. **Byte-parity guard.** With `domAdopt` off (all existing paths), compiler
   output is byte-identical to today — the existing `compiler-verify` harness
   already asserts this across the corpus; add a unit check that no reserved
   `lzdomadopt` attribute can appear without the option.
4. **Behavioral demo checks.** Constraint updates, the layout, and the handler
   in the demo app work identically to the same app compiled from `.lzx` text.

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
