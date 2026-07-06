# `<flexlayout>` — CSS Flexbox Layout (Slice 6)

**Date:** 2026-07-06 (rev 2 — adversarial review findings applied: engine
adapter contract, checker machinery honestly scoped, locking/delegate/
intrinsic-size rules corrected, license fixed)
**Status:** Approved design, pre-implementation
**Builds on:** Slices 1–4 (lands after Slice 5 in the stack; no functional
dependency on it).
**Engine provenance:** dreemgl `system/lib/layout.js` — Facebook's
css-layout (pre-Yoga flexbox), as adapted by dreemgl to read
dreemgl-view-shaped nodes. 1,281 lines, dependency-free except its AMD
`define()` wrapper. **License: Facebook BSD-style + patents grant** (per
the file header and dreemgl's own THIRDPARTY.md — *not* Apache 2.0; the
referenced PATENTS file is absent from the dreemgl repo, which the
THIRDPARTY note must record).

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
own level, composing through the normal event/constraint machinery.

## Principles

1. **A normal component-library layout.** `<class name="flexlayout"
   extends="layout">` in `runtime/components/utils/layouts/`. The direct
   precedent for the hard parts is **`resizelayout`**, not simplelayout: it
   registers `updateDelegate` on `this.immediateparent` for
   `on{width,height}` (resizelayout.lzx:34) and writes subview sizes under
   a lock (resizelayout.lzx:119-148). No `lfc-src` edits.
2. **Vendor the engine's algorithm; adapt its shell.** The flexbox
   algorithm is battle-tested and untouched. The shell needs known surgery
   (below) — rev 1's "verbatim" claim was wrong.
3. **Container-driven, one-way.** The layout sizes and positions children
   from the parent's size; it never sizes the parent from content
   (`updateparent` is a later slice if wanted).

## The engine and its adapter (load-bearing section)

dreemgl rewrote css-layout's input contract: there is **no `style` object**.
The engine reads dreemgl-view-shaped refs — `node.ref._size[2]` (NaN =
auto), `_pos`/`_corner`, `_margin[4]`, `_padding[4]`, `_borderwidth[4]`,
`_minsize`/`_maxsize`, `_flex`, `_flexdirection`, `_justifycontent`,
`_alignitems`/`_alignself`, `_flexwrap`, `_position`, `_direction` — inside
wrapper nodes `{ref, children, visible, dirty, layout:{width, height, left,
top, …}}`. The entry point is `layoutNode(node, parentMaxWidth,
parentDirection)` (exported as `computeLayout`), and the engine's own
`fillNodes` is unusable for us (it skips children lacking `_viewport`).

**Vendoring surgery (mechanical, enumerated):** strip the AMD `define()`
wrapper → plain module exporting `layoutNode`; delete the two live
`debugger` statements (layout.js:199,440); keep the Facebook BSD header.
Nothing else changes.

**The adapter is the tree builder** (a pure function, own unit): it
synthesizes wrapper nodes and full `_`-prefixed ref objects from the
layout's attributes and the subviews' state. Rules:

- Container ref: `_size = [parent.width, parent.height]`, the layout's
  attrs mapped to `_flexdirection`/`_justifycontent`/`_alignitems`/
  `_flexwrap`, `_padding = [padding×4]`, `_position:'absolute'` semantics
  per engine defaults, `_direction:'ltr'`. **`_flexdirection` is always set
  explicitly** — the engine's default is `column`, ours is `row`.
- Child refs: `_size[main] = NaN` when `flex > 0` (engine-controlled
  grow), `_size[cross] = NaN` when `alignself`/`alignitems` resolves to
  `stretch` (engine-controlled stretch), otherwise the subview's current
  size. **NaN-in-`_size` is the real dimension-omission mechanism**
  (layout.js:475-478 defines "defined" as `!isNaN`; stretch applies only
  to undefined dims, :730-739; flex sets the main dim itself, :941-944).
- Children that are `!visible` or carry the `ignorelayout` **option**
  (`options="ignorelayout: true"` — it is an option read via
  `sd.options['ignorelayout']`, layout.lzx:223-227, *not* a plain
  attribute) are excluded.
- Hints map to `_flex`, `_alignself`, `_margin = [margin×4]`.

Verified against the engine source: `row`/`row-reverse`/`column`/
`column-reverse`, all five `justifycontent` values, four `alignitems`
values (default `stretch`), `alignself`, `flexwrap: wrap` including
multi-line, per-side margin/padding, min/max clamps all exist. No `gap`
(margins cover it, documented). **`flex` is grow-only in this vintage** —
there is no flex-shrink; on overflow, flexible children clamp toward zero
and fixed children never shrink (layout.js:933-935). The docs and tests say
"grow factor", not "grow/shrink".

## Attribute surface

On `<flexlayout>`:

| Attribute | Type | Values / default |
| --- | --- | --- |
| `flexdirection` | string enum | `row` (default), `column`, `row-reverse`, `column-reverse` |
| `justifycontent` | string enum | `flex-start` (default), `center`, `flex-end`, `space-between`, `space-around` |
| `alignitems` | string enum | `stretch` (default), `flex-start`, `center`, `flex-end` |
| `flexwrap` | string enum | `nowrap` (default), `wrap` |
| `padding` | number | `0` |

Hints on subviews (plain attributes; undeclared markup attributes compile
as expressions and `LzDelegate.register` auto-creates their events, so
`onflex` delegates work): `flex` (number, grow factor), `alignself` (enum,
overrides `alignitems`), `margin` (number, uniform).

## Update semantics

`update()` runs under the **resizelayout locking pattern**: set
`this.locked = true`, work, then clear the flag directly
(`this.locked = false`). Rev 1 said "use `lock()`/`unlock()`" — that is an
infinite loop: `unlock()` → `reset()` → `update()` re-enters
(layout.lzx:284-287, 190-194). simplelayout never calls `lock()` either;
resizelayout:145 is the correct precedent.

1. Build the adapter tree (above).
2. `layoutNode(tree, parent.width, 'ltr')`.
3. Write back `x`/`y` always; `width`/`height` only for engine-controlled
   dimensions. **Round to integers** (the engine's `round()` is identity —
   fractional write-backs would defeat the no-op skip and never stabilize)
   and skip no-op writes.

**Intrinsic-size restoration (the text-view ratchet):** `setAttribute(
'width', v)` on a view sets `hassetwidth` permanently, disabling
auto-measure — and default `stretch` hits every text child of a row. Rule:
the layout records, per subview per dimension, whether IT took control;
when a dimension leaves engine control (hint change, alignself change,
subview removal, layout destruction), the layout writes `null` once
(`setAttribute(dim, null)` restores auto-measure, LaszloView.lzs:1349,
1365-1377). Layout state, not global bookkeeping.

**Update triggers:**
- parent `onwidth`/`onheight` (resizelayout precedent) — flex is
  container-driven;
- subview `on<sizeAxis>` for **both** axes (simplelayout registers one;
  flex needs both — text reflow, image load), guarded by `locked` against
  write-back re-entry;
- hint changes: `onflex`/`onalignself`/`onmargin` per subview.

**Delegate release is designed here, not inherited:** the base class has no
delegate bookkeeping — `removeSubview` splices without releasing, and its
`onremovesubview` hook is annotated dead (layout.lzx:160-162, 235-245). The
layout keeps a per-subview delegate list; `removeSubview` override and
`destroy` release them (and apply the intrinsic-size restoration rule).

**Coexistence:** flexlayout claims `x`, `y`, `width`, and `height` — it
cannot share a parent with any other layout (the base class requires
disjoint claimed attribute sets). Documented; a second layout on the same
parent is a runtime warning today by base-class behavior.

## Registration & checker integration

- Autoincludes entry (`flexlayout: utils/layouts/flexlayout.lzx`).
  **No `lzc-browser.js` rebundle**: the browser compiler fetches
  `lzx-autoincludes.properties` at runtime (browser-io.ts:284-294); rev 1's
  rebundle claim was wrong. Plan-time check: whether the oracle copy under
  `compiler/compiler-verify/` participates in parity fixtures.
- **Component-attribute typing is NEW machinery, honestly scoped.** Today
  lzx-check knows component tags only as legal tag/extends names; their own
  attributes are silently unvalidated (`<simplelayout axis="bogus">` is not
  a finding — instances type as `LzView`). This slice adds a small curated
  **component attribute registry** in `app-model.ts`: an entry for
  `flexlayout` (the five attrs, enums as string-literal unions) and the
  three hints typed on any view. Two mechanisms, per the review: markup
  literal validation via the registry, and the hints added to the `LzView`
  type so strict `setAttribute('flex', …)` accepts them. Registry covers
  flexlayout only in v1; generalizing to the rest of the component library
  is follow-up work.

## Error handling

- Enum violations: checker finding; at runtime ignored with one console
  warning and the default used.
- Zero/negative container size: engine runs; write-backs clamp to ≥ 0.
- An engine exception is caught: warn once, leave positions untouched.

## Testing

1. **Unit** — the adapter pure function (attrs/hints/visibility/
   ignorelayout-option → wrapper tree; NaN placement rules; explicit
   `_flexdirection`); geometry battery through `layoutNode` + write-back
   logic: row/column (+reverse), grow, overflow collapse (grow-only
   semantics pinned), wrap, every justify/align value, margins, padding,
   mixed fixed/flex, rounding stability (two consecutive updates → zero
   writes).
2. **lzx-check** — registry: enum-violation finding, hint typing
   (`flex="x"` a finding), hints accepted on plain views and via
   `setAttribute`.
3. **E2E (Playwright)** — initial geometry; parent resize re-flows; child
   text change re-flows (both-axes trigger); `setAttribute('flex', …)`
   re-flows; un-stretching a text child restores auto-measure (the
   ratchet rule observable).

## Demo

`examples/dom-authoring/flex-demo.html`: a toolbar row (logo / grow-spacer /
menu) above a wrapping gallery, window-resizable.

## Non-goals (v1)

`gap`, flex-shrink (engine lacks it), percentage bases, baseline alignment,
whole-subtree single-pass mode, `updateparent`, RTL, generalizing the
attribute registry beyond flexlayout, browser-native CSS flex on sprite
divs (rejected: the LFC owns geometry — absolute positioning and
synchronous `x`/`width` reads; readback would thrash and go stale).
