# `<flexlayout>` — CSS Flexbox Layout (Slice 6)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** Slices 1–4 (lands after Slice 5 in the stack; no functional
dependency on it).
**Influences:** dreemgl `system/lib/layout.js` — a dependency-free pure-JS
port of Facebook's css-layout (the pre-Yoga flexbox engine), 1,281 lines,
Apache 2.0 (attribution retained in the vendored header and THIRDPARTY
notes).

## Goal

Flexbox semantics as an ordinary OpenLaszlo layout:

```html
<view width="640" height="64">
  <flexlayout flexdirection="row" justifycontent="space-between"
              alignitems="center" padding="8"></flexlayout>
  <text text="Logo"></text>
  <view flex="1"></view>          <!-- spacer grows -->
  <text text="Menu"></text>
</view>
```

One level per layout (idiomatic OL): each `<flexlayout>` lays out its parent
view's direct subviews. Nested flex is nested flexlayouts, each settling its
own level, composing through the normal event/constraint machinery like every
existing layout.

## Principles

1. **A normal component-library layout.** `<class name="flexlayout"
   extends="layout">` in `runtime/components/utils/layouts/`, following
   `simplelayout`'s structure (override `addSubview`/`update`, use the base
   class's `lock()`/`unlock()` against write-back re-entry). No `lfc-src`
   edits.
2. **Vendor the engine, don't rewrite flexbox.** The css-layout port is
   battle-tested; the algorithm's correctness is the entire risk of a fresh
   implementation. Vendored essentially verbatim as
   `runtime/components/utils/layouts/css-layout.js`, exposed as a single
   `computeLayout(node)` entry (loading mechanism — library `<script src>`
   vs. inline block — confirmed at plan time; both are supported paths).
3. **Container-driven, one-way.** The layout sizes and positions children
   from the parent's size; it never sizes the parent from content
   (`updateparent` semantics are a later slice if wanted).

## Attribute surface

On `<flexlayout>` (all declared `<attribute>`s of the class):

| Attribute | Type | Values / default |
| --- | --- | --- |
| `flexdirection` | string enum | `row` (default), `column`, `row-reverse`, `column-reverse` |
| `justifycontent` | string enum | `flex-start` (default), `center`, `flex-end`, `space-between`, `space-around` |
| `alignitems` | string enum | `stretch` (default), `flex-start`, `center`, `flex-end` |
| `flexwrap` | string enum | `nowrap` (default), `wrap` |
| `padding` | number | `0` |

Layout **hints on subviews** (the `ignorelayout` precedent — plain attributes
any view may carry):

| Hint | Type | Meaning |
| --- | --- | --- |
| `flex` | number | grow/shrink factor along the main axis (`0` = fixed) |
| `alignself` | string enum | overrides `alignitems` for this child |
| `margin` | number | uniform margin on all four sides |

No `gap`: the css-layout generation predates it; margins cover it
(documented in the component docs). Subviews with `ignorelayout="true"` are
skipped, as in every OL layout.

## Semantics

`update()`:

1. Build a one-level css-layout node: container style from the layout's
   attributes with the **parent view's current `width`/`height`** as the
   container size; each participating subview becomes a child node with its
   hints. **Which dimensions the child node carries is the load-bearing
   rule:** a child's current size enters its style — EXCEPT the main-axis
   dimension when `flex > 0` (engine-controlled growth/shrink) and the
   cross-axis dimension when `alignself`/`alignitems` resolves to `stretch`
   (engine-controlled stretch). css-layout only flexes/stretches dimensions
   that are absent from the style, so omitting them is what makes those
   features work at all.
2. Run `computeLayout`.
3. Write back `x`/`y` — and `width`/`height` only where flex growth or
   cross-axis stretch dictates — via `setAttribute`, skipping no-op writes
   (no event storms).

The attrs-plus-hints → css-layout-tree builder is a pure function (own
module/`<script>` unit) so it is unit-testable without a runtime.

Two triggers `simplelayout` doesn't need but flex does:

- **Parent resize:** delegates on the parent's `onwidth`/`onheight` call
  `update()` — flex is container-driven.
- **Hint changes:** `onflex`/`onalignself`/`onmargin` delegates on each
  subview (registered in `addSubview`, released on removal via the base
  class's delegate bookkeeping) call `update()`.

## Registration & checker integration

- `lzx-autoincludes.properties` entry (`flexlayout: utils/layouts/
  flexlayout.lzx`) + the routine `lzc-browser.js` rebundle (autoincludes
  ship inside the bundle; the byte-parity guard covers the LFC, not the
  bundle — same procedure as Slice 2).
- The layout's own attributes reach lzx-check through the same mechanism as
  `simplelayout`'s (extends-chain resolution; exact wiring confirmed at plan
  time). Enums are string-literal-union types, so
  `flexdirection="rows"` is a finding.
- The three hints join a small **global layout-hint allowlist** typed on any
  view (`flex`: number, `alignself`: the enum, `margin`: number) — the
  `ignorelayout` precedent. Contextual validation ("only next to a
  flexlayout") is not worth the machinery; a hint without a flexlayout
  sibling is inert, as OL hints have always been.

## Error handling

- Unknown enum values: checker finding; at runtime, ignored with one console
  warning (LZX leniency convention) and the default used.
- Zero/negative container size: the engine runs; written-back sizes clamp to
  ≥ 0.
- An engine exception (bad hint combination) is caught: warn once, leave
  current positions untouched — a layout bug never takes down the app.

## Testing

1. **Unit** — the tree-builder pure function (attrs/hints/ignorelayout →
   node); a geometry fixture battery through `computeLayout` + write-back:
   row/column (+reverse), grow/shrink, wrap, every `justifycontent` and
   `alignitems`/`alignself` value, margins, padding, mixed fixed/flex
   children.
2. **lzx-check** — enum-violation finding; hint typing (`flex="x"` a
   finding); hints accepted on plain views.
3. **E2E (Playwright)** — a real app: initial geometry asserted; parent
   resize re-flows; `setAttribute('flex', …)` on a child re-flows.

## Demo

`examples/dom-authoring/flex-demo.html`: a toolbar row (logo / grow-spacer /
menu) above a wrapping gallery, window-resizable.

## Non-goals (v1)

`gap`, percentage bases, baseline alignment, whole-subtree single-pass mode,
`updateparent` (content-sized containers), RTL, browser-native CSS flex on
sprite divs (rejected: the LFC owns geometry — absolute positioning and
synchronous `x`/`width` reads; readback would thrash and go stale).
