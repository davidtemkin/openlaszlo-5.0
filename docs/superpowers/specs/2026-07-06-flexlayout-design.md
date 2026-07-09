# `<flexlayout>` — CSS Flexbox Layout (Slice 6)

**Date:** 2026-07-06 (rev 3 — round-2 review applied: engine-control rule
respects authored/constrained sizes, text restore mechanism designed,
adapter init rules made normative, factual corrections)
**Status:** Implemented — 2026-07-06 (branch dom-authoring-slice6; 131 tests green
incl. 14-case geometry battery + compile + checker fixtures; demo lzx-check-clean.
Deviations: engine accessor layer fixed for reverse axes — dreemgl's rewritten
isDimDefined + 14 siblings threw on row-reverse/column-reverse, normalized via
baseAxis(), asymmetric-margin flip under reverse documented out of scope; snapshots
taken at TAKEOVER not adoption (constraints may apply after onaddsubview).
In-browser interaction pass (toolbar resize, wrap re-flow) pending user browser —
no browser automation in this environment.)
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
   precedent for the hard parts is **`resizelayout`**: it registers
   `updateDelegate` on `this.immediateparent` for `on{width,height}`
   (resizelayout.lzx:34) and writes subview sizes under a lock
   (resizelayout.lzx:119-148). No `lfc-src` edits.
2. **Vendor the engine's algorithm; adapt its shell.** The flexbox
   algorithm is battle-tested and untouched. The shell needs known surgery
   (below).
3. **Container-driven, one-way.** The layout sizes and positions children
   from the parent's size; it never sizes the parent from content
   (`updateparent` is a later slice if wanted).
4. **Only auto dimensions belong to the engine.** Authored and constrained
   sizes are inputs, never outputs — matching CSS, where stretch and flex
   apply to *auto* dimensions. (Rev 2 stretched unconditionally, which
   would have overwritten authored sizes and then destroyed them on
   restore.)

## The engine and its adapter (load-bearing section)

dreemgl rewrote css-layout's input contract: there is **no `style` object**.
The engine reads dreemgl-view-shaped refs — `node.ref._size[2]` (NaN =
auto), `_pos`/`_corner`, `_margin[4]`, `_padding[4]`, `_borderwidth[4]`,
`_minsize`/`_maxsize`, `_flex`, `_flexdirection`, `_justifycontent`,
`_alignitems`/`_alignself`, `_flexwrap`, `_position`, `_direction` — inside
wrapper nodes `{ref, children, visible, layout:{…}}`. The entry point is
`layoutNode(node, parentMaxWidth, parentDirection)` (exported as
`computeLayout`); the engine's own `fillNodes` is unusable for us (it skips
children lacking `_viewport`), and bypassing it is safe — the `dirty`/
`oldlayout` caching it feeds is commented out in `layoutNode`.

**Vendoring surgery (mechanical, enumerated):** strip the AMD `define()`
wrapper → plain module exporting `layoutNode`; delete the one live
`debugger` statement (layout.js:440; the one at :199 is inside a
commented-out function); keep the Facebook BSD header. Nothing else
changes.

**The adapter is the tree builder** (a pure function, own unit). Normative
construction rules — each verified against what the engine actually
touches; getting any wrong poisons the pass silently:

1. Every wrapper node's `layout` starts `{width: undefined, height:
   undefined, left: 0, top: 0, right: 0, bottom: 0}` — the engine adds
   into `layout[leading]` (undefined would NaN-poison positions) and
   treats non-undefined width/height as "already computed" (a `0` init
   disables all sizing).
2. Every wrapper node sets `visible: true` explicitly — falsy `visible`
   silently drops children from size accumulation.
3. Every ref — **including the container's** — carries all the `_`-arrays
   (`_size`, `_pos`, `_corner`, `_margin`, `_padding`, `_borderwidth`,
   `_minsize`, `_maxsize`); the engine indexes them unconditionally.
   Container `_margin = [0,0,0,0]`. Child `_pos`/`_corner` are
   `[NaN, NaN]` — mapping current x/y into `_pos` would double offsets
   (the engine adds relative position to flow position).
4. Refs carry no `measure` key (its mere presence makes the engine call
   it).
5. `_flexdirection` is always set explicitly — the engine's default is
   `column`, ours is `row`.

**Dimension control (rev 3 rule):** at adoption into the layout, the
layout snapshots each subview's sizing state per dimension:
`hasset{width,height}` and the current values. A dimension is
**engine-controlled** — passed as `NaN` in `_size` — only when it is
genuinely auto: not authored, not written by a `${…}` constraint, not
`hasset`. Authored/constrained dimensions pass through as defined values,
and the engine's own `isDimDefined` gate then yields CSS-correct behavior:
stretch and flex apply to auto dimensions only; a `<view width="50"
height="20">` in a stretch row keeps its authored height. A `flex` hint on
a view whose main-axis dimension is constrained is a checker finding (the
registry, below) and a runtime warning — the write-fight (constraint
re-applies, layout overwrites, last-writer-wins flapping) is otherwise
silent and unarbitrated.

Children that are `!visible` or carry the `ignorelayout` **option**
(`options="ignorelayout: true"` — an option read via
`sd.options['ignorelayout']`, layout.lzx:223-227, not a plain attribute)
are excluded from the tree.

Engine feature surface verified: `row`/`row-reverse`/`column`/
`column-reverse`, all five `justifycontent` values, four `alignitems`
values (default `stretch`), `alignself`, `flexwrap: wrap` including
multi-line, per-side margin/padding, min/max clamps. No `gap` (margins
cover it). **`flex` is grow-only** — no flex-shrink; on overflow, flexible
children clamp toward zero and fixed children never shrink. Multi-line
cross packing follows the engine's `_aligncontent` default (`flex-start`);
v1 does not expose `aligncontent` (documented).

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
as expressions — compile.ts:2918-2920 — and `LzDelegate.register`
auto-creates missing events, so `onflex` delegates work): `flex` (number,
grow factor), `alignself` (enum, overrides `alignitems`), `margin`
(number, uniform).

## Update semantics

`update()` runs under the **resizelayout locking pattern**: set
`this.locked = true`, work, clear with `this.locked = false` — direct
assignment, bypassing the `locked` setter, because `unlock()` → `reset()`
→ `update()` re-enters infinitely (layout.lzx:284-287, 190-194;
resizelayout.lzx:145 is the precedent). The engine-exception catch clears
`locked` in a `finally` — otherwise one bad pass permanently disables the
layout.

1. Build the adapter tree (above).
2. `layoutNode(tree, parent.width, 'ltr')`.
3. Write back `x`/`y` always; `width`/`height` only for engine-controlled
   dimensions. Round to integers (the engine's `round()` is identity —
   fractional write-backs would defeat the no-op skip and never
   stabilize) and skip no-op writes.

**Size restoration (rev 3 — the rev-2 null-restore was wrong twice
over):** when a dimension leaves engine control (hint change, alignself
change, subview removal, layout destruction):

- If the snapshot says the dimension was **authored**, write the snapshot
  value back. (`null` means "re-measure", not "restore what you had" —
  rev 2 would have destroyed authored sizes.)
- If it was **auto**: write `null` to restore auto-measure
  (LaszloView.lzs:1343-1376) — **except text views, where the LFC's null
  path is a no-op dead end**: the dhtml text sprite ignores null widths
  (LzTextSprite.js:806) and `reevaluateSize` measures only subview
  extents, so a text leaf "restores" to width 0. For `LzText` instances
  the layout follows the null write with a forced re-measure via the
  text's own `_updateSize()` (the routine its sprite invokes on text
  mutation). Component code calling an LFC-internal method is the
  accepted cost — the alternative is an lfc-src edit, which Principle 1
  forbids; the E2E pins the actually-deliverable behavior.

**Update triggers:**
- parent `onwidth`/`onheight` (resizelayout precedent);
- subview `on<sizeAxis>` for **both** axes (text reflow, image load),
  guarded by `locked`;
- subview `onvisible` (resizelayout.lzx:48 precedent — rev 2 excluded
  invisible children but never re-triggered on the toggle);
- hint changes: `onflex`/`onalignself`/`onmargin` per subview.

**Delegate release:** the layout keeps a per-subview delegate list;
`removeSubview` override and `destroy` release them and apply the size
restoration rule. (Factual correction from rev 2: the base class's
`onremovesubview` hook is *not* dead — `LzView.destroy` sends it when the
parent is valid, LaszloView.lzs:1926 — but release-on-destroy still must
cover parent-teardown, where the event never fires.)

**Coexistence:** flexlayout claims `x`, `y`, `width`, and `height` — it
cannot share a parent with any other layout. This is convention, **not
enforced by the base class** (rev 2 claimed a base-class warning that does
not exist — `construct` just pushes into `vip.layouts`): flexlayout itself
warns at construct time when another layout is already present on the
parent.

## Registration & checker integration

- Autoincludes entry (`flexlayout: utils/layouts/flexlayout.lzx`).
  **No `lzc-browser.js` rebundle**: the browser compiler fetches
  `lzx-autoincludes.properties` at runtime (browser-io.ts:283-294).
  Plan-time check: whether the oracle copy under `compiler/compiler-verify/`
  participates in parity fixtures.
- **Component-attribute typing is NEW machinery, in two named places.**
  Today lzx-check knows component tags only as legal tag/extends names;
  their own attributes are silently unvalidated. This slice adds:
  (a) a small curated **component attribute registry** in `app-model.ts` —
  flexlayout's five attrs (enums as string-literal unions), the three
  hints valid on any view, and the flex-vs-constrained-dimension finding;
  (b) the hint properties added to the **`lfc-dts.ts` curated LzView
  emission** (that is where the LzView type actually comes from — not
  app-model) plus regeneration of the `lfc.d.ts` artifact, so strict
  `setAttribute('flex', …)` accepts them. Registry covers flexlayout only
  in v1.

## Error handling

- Enum violations: checker finding; at runtime ignored with one console
  warning and the default used.
- Zero/negative container size: engine runs; write-backs clamp to ≥ 0.
- An engine exception is caught (`finally` clears the lock): warn once,
  leave positions untouched.

## Testing

1. **Unit** — the adapter pure function: normative construction rules 1-5
   (layout init shape, explicit visible, complete `_`-arrays incl.
   container, NaN `_pos`, no `measure`, explicit `_flexdirection`);
   dimension-control snapshots (authored vs auto vs constrained);
   geometry battery through `layoutNode` + write-back: row/column
   (+reverse), grow, overflow collapse (grow-only pinned), wrap
   (flex-start packing pinned), every justify/align value, authored-size
   preservation under stretch, margins, padding, rounding stability (two
   consecutive updates → zero writes).
2. **lzx-check** — registry: enum-violation finding, hint typing
   (`flex="x"` a finding), hints accepted on plain views and via
   `setAttribute`, flex-on-constrained-dimension finding.
3. **E2E (Playwright)** — initial geometry; parent resize re-flows; child
   text change re-flows; visibility toggle re-flows; `setAttribute('flex',
   …)` re-flows; un-stretching restores: an authored size comes back
   exactly, an auto text child re-measures to its text (via the
   `_updateSize` path — the deliverable behavior, not the rev-2 fiction).

## Demo

`examples/dom-authoring/flex-demo.html`: a toolbar row (logo / grow-spacer /
menu) above a wrapping gallery, window-resizable.

## Non-goals (v1)

`gap`, flex-shrink (engine lacks it), `aligncontent` exposure, percentage
bases, baseline alignment, whole-subtree single-pass mode, `updateparent`,
RTL, generalizing the attribute registry beyond flexlayout, browser-native
CSS flex on sprite divs (rejected: the LFC owns geometry — absolute
positioning and synchronous `x`/`width` reads; readback would thrash and go
stale).
