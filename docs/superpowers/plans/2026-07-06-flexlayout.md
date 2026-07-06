# `<flexlayout>` (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flexbox as an ordinary OpenLaszlo layout — `<flexlayout>` positions/sizes its parent's direct subviews through the vendored css-layout engine, with typed attributes and view hints in lzx-check.

**Architecture:** Three layers: the vendored engine (`css-layout.js`, dreemgl's Facebook css-layout, AMD-unwrapped), a pure adapter (`flex-adapter.js` — attrs+hints+snapshots → wrapper tree → write-back list), and a thin LZX class (`flexlayout.lzx`) that owns delegates/locking and applies write-backs. The adapter and engine are plain UMD-ish scripts so `node --test` loads them directly AND the `.lzx` includes them.

**Tech Stack:** LZX component library, vanilla JS (no ESM in runtime files), `node --test` via `createRequire`, lzx-check component-attribute registry (new, own module).

**Spec:** `docs/superpowers/specs/2026-07-06-flexlayout-design.md` (rev 3). Every mechanism there is normative; this plan adds file-level shape.

## Global Constraints

- Branch `dom-authoring-slice6` stacked on slice-5 HEAD; worktree `.claude/worktrees/flex-slice6`.
- **Frozen-plan collision management:** slice 4 (in flight) owns big regions of `compiler/src/app-model.ts` + `lzx-check.ts`. The checker registry therefore lives in a NEW module `compiler/src/component-registry.ts`; hooks into `app-model.ts` are ≤ ~10 added lines, and none in the regions slice 4's plan edits (its SKIP_LITERAL/instance-walk seams). `lfc-dts.ts` is untouched by other slices.
- `runtime/lfc-src` byte-frozen — nothing here goes near it. `LzText._updateSize()` is CALLED (component-level) but never edited.
- License: `css-layout.js` keeps its Facebook BSD header verbatim + a provenance comment (dreemgl `system/lib/layout.js`, PATENTS file absent upstream — recorded).
- Tests: `cd compiler && npm test`. Geometry battery is pure-JS (engine+adapter, no LFC). Runtime behavior (delegates, text re-measure) is verified via the demo + manual browser check (no browser automation in this repo).
- Defaults (spec): flexdirection `row` (engine default is `column` — always set explicitly), justifycontent `flex-start`, alignitems `stretch`, flexwrap `nowrap`, padding 0. Hints: `flex` (number ≥ 0, grow-only), `alignself`, `margin` (uniform number).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Verified anchors

- Base class `runtime/components/utils/layouts/layout.lzx`: `construct` :123 (creates `updateDelegate` :143, registers `onaddsubview`/`onremovesubview` :159-162), `gotNewSubview` filters `sd.options['ignorelayout']` :224, `removeSubview` :235, `destroy` :174, `lock()` :273-274 sets `this.locked = true`, `update` :437 is the no-op to override.
- Pattern precedent `resizelayout.lzx`: parent-size delegate `this.updateDelegate.register(this.immediateparent, "on"+sizeAxis)` :34; per-subview `resetDelegate.register(sd, "onvisible")` + `on<size>` :48-49; `this.lock()` … `this.locked = false` (direct assignment) :122,145; options read via `sd.getOption('releasetolayout')` :42.
- Raw JS in a component library goes through **`<script src="…"/>`** (precedent `runtime/components/rpc/rpc.js`… wait, `rpc.js:3` uses `<script src="json.js"/>`), handled at `compiler/src/compile.ts:1372-1390` via `resolveScriptSrc` (exists in node-io AND browser-io:341 — both compile paths). `<include href="…js"/>` does NOT work (expandIncludes XML-parses every non-text include, compile.ts:2279-2283; javarpc.js is itself an XML library document).
- Engine `/tmp/dreemgl/system/lib/layout.js` (cloned; if `/tmp` was wiped: `git clone --depth 1 https://github.com/dreemproject/dreemgl /tmp/dreemgl`): `define(function(){…})` wrapper :11, `fillNodes` :13 (skips children lacking `_viewport` — bypassed), live `debugger` :440 (the one at :199 is inside a commented-out function), `layoutNode(node, parentMaxWidth, parentDirection)` :110, exported as `computeLayout` :1277, dimension-defined = `!isNaN(ref._size[i])` :475-478, stretch gate :730-739, flex sets main dim :941-944, grow-only clamp :933-935, engine default flexdirection `column` :424-429.
- Ref contract the adapter must synthesize (round-2-verified): wrapper `{ref, children, visible: true, layout:{width: undefined, height: undefined, left: 0, top: 0, right: 0, bottom: 0}}`; every ref (incl. container) carries `_size,_pos,_corner,_margin[4],_padding[4],_borderwidth[4],_minsize,_maxsize` (+ container `_margin=[0,0,0,0]`); child `_pos`/`_corner` = `[NaN,NaN]`; no `measure` key; `_flexdirection/_justifycontent/_alignitems/_alignself/_flexwrap/_position:'relative'/_direction:'ltr'` (container `_position:'absolute'` is NOT needed — the container's own layout output is unused; we only read children).
- lzx-check test surface: `checkApp(html, name)` → `{findings:[{line, code, message}], …}` (`compiler/test/lzx-check.test.mjs:1-30`), fixtures under `compiler/test/fixtures/`.
- `lfc-dts.ts` curated LzView emission: `VIEW_RELATIONAL` table at :56 (the seam for hint properties).
- Text auto-measure restore: `LzText.$lzc$set_width(null)` dead-ends (`LzTextSprite.setWidth` ignores null, dhtml `LzTextSprite.js:806`; `reevaluateSize` measures subviews only) → after a null write on an `LzText`, call `subview._updateSize()` (the routine its own sprite invokes on text mutation, `LzText.lzs:858-876`).

---

### Task 1: Vendor the engine

**Files:**
- Create: `runtime/components/utils/layouts/css-layout.js`
- Test: `compiler/test/flexlayout-engine.test.mjs`

**Interfaces:**
- Produces global (and CJS export) `LzCssLayout = { layoutNode(node, parentMaxWidth, parentDirection) }` — consumed by the adapter (Task 2) and flexlayout.lzx (Task 4).

- [ ] **Step 1: Failing test** (`compiler/test/flexlayout-engine.test.mjs`) — loads via `createRequire`; a row of two fixed children lays out with correct lefts:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { layoutNode } = require("../../runtime/components/utils/layouts/css-layout.js");

const ref = (over = {}) => ({
  _size: [NaN, NaN], _pos: [NaN, NaN], _corner: [NaN, NaN],
  _margin: [0, 0, 0, 0], _padding: [0, 0, 0, 0], _borderwidth: [0, 0, 0, 0],
  _minsize: [NaN, NaN], _maxsize: [NaN, NaN],
  _flexdirection: "row", _justifycontent: "flex-start", _alignitems: "stretch",
  _alignself: null, _flexwrap: "nowrap", _position: "relative", _direction: "ltr",
  _flex: 0, ...over,   // _alignself NULL, never "auto": getAlignItem (layout.js:388-396) tests truthiness — "auto" matches nothing and falls through to flex-end
});
const node = (r, children = []) => ({
  ref: r, children, visible: true,
  layout: { width: undefined, height: undefined, left: 0, top: 0, right: 0, bottom: 0 },
});

test("engine: row of two fixed children positions them side by side", () => {
  const c1 = node(ref({ _size: [50, 20] })), c2 = node(ref({ _size: [30, 20] }));
  const root = node(ref({ _size: [200, 40] }), [c1, c2]);
  layoutNode(root, 200, "ltr");
  assert.equal(c1.layout.left, 0);
  assert.equal(c2.layout.left, 50);
  assert.equal(c1.layout.width, 50);
});

test("engine: flex child grows into remaining space", () => {
  const fixed = node(ref({ _size: [50, 20] }));
  const grow = node(ref({ _size: [NaN, 20], _flex: 1 }));
  const root = node(ref({ _size: [200, 40] }), [fixed, grow]);
  layoutNode(root, 200, "ltr");
  assert.equal(grow.layout.width, 150);
  assert.equal(grow.layout.left, 50);
});
```

- [ ] **Step 2:** Run: `cd compiler && node --test test/flexlayout-engine.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Copy `/tmp/dreemgl/system/lib/layout.js` → `runtime/components/utils/layouts/css-layout.js` with EXACTLY three mechanical changes:
  1. Keep the Facebook BSD header; append below it:
     ```js
     // Vendored from dreemgl system/lib/layout.js (github.com/dreemproject/dreemgl,
     // Apache-2.0 repo; THIS file is Facebook css-layout, BSD-style license + patents
     // grant per the header above — upstream PATENTS file is absent from the dreemgl
     // repo; noted here for provenance). Changes: AMD wrapper -> UMD-ish global/CJS
     // export; one live `debugger` statement removed. Algorithm untouched.
     ```
  2. Replace the `define(function () {` opening line with `(function (global) {` and the closing `})` return-block: the module ends (at :1276-1281) with
     ```js
     return {
         computeLayout: layoutNode,
         fillNodes: fillNodes,
         ...
     }
     })
     ```
     → replace with
     ```js
     var api = { layoutNode: layoutNode, computeLayout: layoutNode, fillNodes: fillNodes, extractNodes: extractNodes };
     global.LzCssLayout = api;
     if (typeof module !== "undefined" && module.exports) module.exports = api;
     })(typeof globalThis !== "undefined" ? globalThis : this);
     ```
     (Match the ACTUAL return-object shape in the file — keep whatever other keys it returns, adding `layoutNode`.)
  3. Delete the live `debugger` at :440 (`if(!node.ref) debugger` → `if(!node.ref) throw new Error("layoutNode: node without ref")`).
- [ ] **Step 4:** Run → PASS. If a test fails on the ref contract, fix the TEST's ref template against the engine (the engine is read-only ground truth).
- [ ] **Step 5:** Commit: `components: vendor css-layout engine (dreemgl/Facebook BSD; UMD export, debugger removed)`

---

### Task 2: The adapter (pure)

**Files:**
- Create: `runtime/components/utils/layouts/flex-adapter.js`
- Test: `compiler/test/flexlayout-adapter.test.mjs`

**Interfaces (produces — consumed by flexlayout.lzx):**
- Global/CJS `LzFlexAdapter` with:
  - `buildTree(container, children)` → engine-ready wrapper node.
    - `container: { width, height, flexdirection, justifycontent, alignitems, flexwrap, padding }`
    - `children: Array<{ width, height, autoWidth, autoHeight, flex, alignself, margin, visible, ignore }>` — `autoWidth/autoHeight` mean "genuinely auto" per the spec's dimension-control rule (not authored, not constrained, not hasset). Invisible/ignored children are EXCLUDED from the tree but their indices preserved via `idx`.
  - `computeWrites(tree, containerWidth)` → runs `LzCssLayout.layoutNode`, returns `Array<{ idx, x, y, width|null, height|null }>` — width/height non-null ONLY for engine-controlled dims, rounded to integers.
  - `engineControlled(child, containerAlignitems)` → `{ main:boolean, cross:boolean, mainDim:"width"|"height", crossDim }` — the spec's rule: main is engine-controlled iff `flex > 0 && autoMain`; cross iff resolved align is `stretch` && `autoCross`.

- [ ] **Step 1: Failing tests** (`compiler/test/flexlayout-adapter.test.mjs`) — the geometry battery:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("../../runtime/components/utils/layouts/flex-adapter.js");

const kid = (over = {}) => ({ width: 50, height: 20, autoWidth: false, autoHeight: false,
  flex: 0, alignself: null, margin: 0, visible: true, ignore: false, ...over });
const box = (over = {}) => ({ width: 200, height: 40, flexdirection: "row",
  justifycontent: "flex-start", alignitems: "stretch", flexwrap: "nowrap", padding: 0, ...over });

const run = (c, kids) => A.computeWrites(A.buildTree(c, kids), c.width);

test("row: fixed children side by side; authored heights preserved under stretch", () => {
  const w = run(box(), [kid(), kid({ width: 30 })]);
  assert.deepEqual(w.map(x => [x.idx, x.x, x.y]), [[0, 0, 0], [1, 50, 0]]);
  assert.ok(w.every(x => x.width === null && x.height === null));   // nothing engine-controlled
});

test("flex grow: auto-main flex child takes the remainder", () => {
  const w = run(box(), [kid(), kid({ autoWidth: true, flex: 1 })]);
  assert.equal(w[1].x, 50);
  assert.equal(w[1].width, 150);
  assert.equal(w[1].height, null);
});

test("flex on a NON-auto main dim is not engine-controlled (spec rule)", () => {
  const w = run(box(), [kid({ flex: 1 }), kid({ width: 30 })]);  // width authored 50 — engine must KEEP it
  assert.equal(w[0].width, null);
  assert.equal(w[1].x, 50, "authored width actually held in the engine pass");
});

test("stretch: only auto-cross children get height written", () => {
  const w = run(box(), [kid({ autoHeight: true }), kid()]);
  assert.equal(w[0].height, 40);
  assert.equal(w[1].height, null);
});

test("alignself center overrides container stretch", () => {
  const w = run(box(), [kid({ autoHeight: true, alignself: "center", height: 20 })]);
  assert.equal(w[0].height, null);                     // center = not engine-controlled
  assert.equal(w[0].y, 10);
});

test("column + reverse + justify space-between", () => {
  const w = run(box({ flexdirection: "column", justifycontent: "space-between", height: 100 }),
                [kid({ height: 20 }), kid({ height: 20 })]);
  assert.equal(w[0].y, 0);
  assert.equal(w[1].y, 80);
  const rev = run(box({ flexdirection: "row-reverse" }), [kid(), kid({ width: 30 })]);
  assert.equal(rev[0].x, 150);                          // first child at the right edge
});

test("wrap: overflowing row wraps to a second line", () => {
  const w = run(box({ flexwrap: "wrap", height: 100 }), [kid({ width: 120 }), kid({ width: 120, autoHeight: false })]);
  assert.equal(w[0].y, 0);
  assert.ok(w[1].y >= 20, "second child wrapped below");
  assert.equal(w[1].x, 0);
});

test("margins and padding offset positions", () => {
  const w = run(box({ padding: 8 }), [kid({ margin: 4 })]);
  assert.equal(w[0].x, 12);
  assert.equal(w[0].y, 12);
});

test("invisible and ignored children are skipped but indices are stable", () => {
  const w = run(box(), [kid(), kid({ visible: false }), kid({ width: 30 })]);
  assert.deepEqual(w.map(x => x.idx), [0, 2]);
  assert.equal(w[1].x, 50);                             // invisible child takes no space
});

test("grow-only: overflow collapses flex children toward zero, fixed keep size", () => {
  const w = run(box({ width: 60 }), [kid(), kid({ autoWidth: true, flex: 1 }), kid({ width: 40 })]);
  assert.equal(w[1].width, 0);                          // clamped, no negative
  assert.equal(w[2].x, 50);
});

test("rounding stability: fractional splits round to ints; second run is identical", () => {
  const kids = [kid({ autoWidth: true, flex: 1 }), kid({ autoWidth: true, flex: 1 }), kid({ autoWidth: true, flex: 1 })];
  const w1 = run(box({ width: 100 }), kids);
  for (const x of w1) assert.equal(x.width, Math.round(x.width));
  assert.deepEqual(run(box({ width: 100 }), kids), w1);
});

test("zero/negative container: no negative writes", () => {
  const w = run(box({ width: 0 }), [kid({ autoWidth: true, flex: 1 })]);
  assert.ok(w[0].width >= 0);
});
```

- [ ] **Step 2:** Run → FAIL (module not found).
- [ ] **Step 3: Implement `flex-adapter.js`** (UMD-ish like the engine; `require("./css-layout.js")` under CJS, `global.LzCssLayout` otherwise):

```js
// flex-adapter.js — pure adapter between flexlayout.lzx and the vendored css-layout
// engine. Spec: docs/superpowers/specs/2026-07-06-flexlayout-design.md ("The engine and
// its adapter"). No LFC dependencies; unit-tested from node.
(function (global) {
  var engine = (typeof module !== "undefined" && module.exports)
    ? require("./css-layout.js") : global.LzCssLayout;

  function mkRef(over) {
    var r = {
      _size: [NaN, NaN], _pos: [NaN, NaN], _corner: [NaN, NaN],
      _margin: [0, 0, 0, 0], _padding: [0, 0, 0, 0], _borderwidth: [0, 0, 0, 0],
      _minsize: [NaN, NaN], _maxsize: [NaN, NaN],
      _flexdirection: "row", _justifycontent: "flex-start", _alignitems: "stretch",
      _alignself: null, _flexwrap: "nowrap", _position: "relative", _direction: "ltr",   // null, NEVER "auto" (truthy → engine treats as flex-end)
      _flex: 0,
    };
    for (var k in over) r[k] = over[k];
    return r;
  }
  function mkNode(r, children) {
    return { ref: r, children: children || [], visible: true,
      layout: { width: undefined, height: undefined, left: 0, top: 0, right: 0, bottom: 0 } };
  }
  var isRow = function (d) { return d === "row" || d === "row-reverse"; };

  function engineControlled(child, containerAlign, dir) {
    var align = child.alignself || containerAlign;
    var mainAuto = isRow(dir) ? child.autoWidth : child.autoHeight;
    var crossAuto = isRow(dir) ? child.autoHeight : child.autoWidth;
    return {
      main: child.flex > 0 && mainAuto,
      cross: align === "stretch" && crossAuto,
      mainDim: isRow(dir) ? "width" : "height",
      crossDim: isRow(dir) ? "height" : "width",
    };
  }

  function buildTree(c, children) {
    var kids = [];
    for (var i = 0; i < children.length; i++) {
      var ch = children[i];
      if (!ch.visible || ch.ignore) continue;
      var ec = engineControlled(ch, c.alignitems, c.flexdirection);
      var size = [ch.width, ch.height];
      if (ec.main) size[ec.mainDim === "width" ? 0 : 1] = NaN;      // engine-controlled → auto
      if (ec.cross) size[ec.crossDim === "width" ? 0 : 1] = NaN;
      var m = ch.margin || 0;
      var node = mkNode(mkRef({
        _size: size, _flex: ch.flex > 0 && ec.main ? ch.flex : 0,
        _alignself: ch.alignself || null,
        _margin: [m, m, m, m],
      }));
      node.idx = i;
      node.ec = ec;
      kids.push(node);
    }
    var p = c.padding || 0;
    return mkNode(mkRef({
      _size: [c.width, c.height],
      _flexdirection: c.flexdirection || "row",
      _justifycontent: c.justifycontent || "flex-start",
      _alignitems: c.alignitems || "stretch",
      _flexwrap: c.flexwrap || "nowrap",
      _padding: [p, p, p, p],
    }), kids);
  }

  function computeWrites(tree, containerWidth) {
    engine.layoutNode(tree, containerWidth, "ltr");
    var out = [];
    for (var i = 0; i < tree.children.length; i++) {
      var n = tree.children[i];
      out.push({
        idx: n.idx,
        x: Math.round(n.layout.left), y: Math.round(n.layout.top),
        width: n.ec.main && n.ec.mainDim === "width" || n.ec.cross && n.ec.crossDim === "width"
          ? Math.max(0, Math.round(n.layout.width)) : null,
        height: n.ec.main && n.ec.mainDim === "height" || n.ec.cross && n.ec.crossDim === "height"
          ? Math.max(0, Math.round(n.layout.height)) : null,
      });
    }
    return out;
  }

  var api = { buildTree: buildTree, computeWrites: computeWrites, engineControlled: engineControlled };
  global.LzFlexAdapter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4:** Run → iterate until the battery passes. Engine quirks (e.g. how `_flex` interacts with a defined main size, exact wrap line heights) are discovered HERE, in pure JS, not in a browser. Where the engine's behavior contradicts a test's expectation AND the spec is silent, match the engine and note it in the test. EXCEPTION: cross-axis defaults are NOT silent spec territory (alignitems stretch is normative) — a cross-axis failure means an adapter contract bug (see the _alignself null rule), never an engine quirk to encode.
- [ ] **Step 5:** Commit: `components: flex adapter — dimension-control rule, tree build, rounded write-backs (geometry battery)`

---

### Task 3: Checker — component attribute registry + hints

**Files:**
- Create: `compiler/src/component-registry.ts`
- Modify: `compiler/src/app-model.ts` (small hook), `compiler/src/lfc-dts.ts` (hint props on LzView), regenerate `compiler/lfc.d.ts`
- Create: `compiler/test/fixtures/flex-check.html` (+ a clean variant)
- Test: `compiler/test/flexlayout-check.test.mjs`

**Interfaces:**
- `component-registry.ts` exports `COMPONENT_ATTRS: Record<string, Record<string, {kind:"enum", values:string[]} | {kind:"number"}>>` with the `flexlayout` entry (five attrs) — plus `VIEW_HINTS: Record<string, …>` (`flex`: number, `alignself`: enum, `margin`: number) applied to ANY view-derived tag.
- app-model hook: where markup attribute literals are validated, consult the registry for (a) the tag's own entry, (b) VIEW_HINTS on any view; produce findings with the existing finding shape. Placement: additive branch, NOT inside regions slice 4 rewrites (verify at execution against the slice-4 plan's app-model diffs; if a collision looks likely, the hook lives behind one function call `registryFindings(tag, attrs)` imported from the new module so the merge is one line).

- [ ] **Step 1: Failing test** (`flexlayout-check.test.mjs`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("flexlayout enums + hints: violations are findings, clean usage is not", () => {
  const src = read("flex-check.html");
  const r = checkApp(src, "flex-check.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find((f) => f.line === at(needle));
  assert.ok(find('flexdirection="rows"'), "bad enum value should be a finding");
  assert.ok(find('flex="x"'), "non-numeric hint should be a finding");
  assert.ok(!find('flexdirection="row-reverse"'), "good enum flagged");
  assert.ok(!find('flex="1"'), "good hint flagged");
});

test("setAttribute('flex', …) typechecks on views", () => {
  const r = checkApp(read("flex-check-clean.html"), "flex-check-clean.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
});
```

Fixture `flex-check.html` (shape mirrors existing fixtures — `<laszlo-app>` + views; adjust the wrapper to match `check-clean.html`'s exact scaffolding at execution time):

```html
<laszlo-app width="400" height="200">
  <view width="400" height="60">
    <flexlayout flexdirection="rows"></flexlayout>
    <view flex="x" width="40" height="20"></view>
  </view>
  <view width="400" height="60">
    <flexlayout flexdirection="row-reverse" justifycontent="space-between"></flexlayout>
    <view flex="1" height="20"></view>
    <text alignself="center" text="ok"></text>
  </view>
</laszlo-app>
```

`flex-check-clean.html`: a view with a declared `<method>` body calling `this.setAttribute('flex', 2)` — proves the LzView type gained the hints.

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - `component-registry.ts`: the two tables + `registryFindings(tag: string, isViewDerived: boolean, attrs: {name, value, line}[], siblings?: {tags: string[]}): Finding[]` (pure; enum check = value ∈ values, number check = `/^-?\d+(\.\d+)?$/` — `${}`-constraint values are SKIPPED, constraints are typed elsewhere). **Spec item "flex on a constrained main-axis dimension":** when the walk can cheaply provide sibling context (a `flexlayout` sibling exists) AND the view carries both a `flex` hint and a `${…}` value for the main-axis dimension, emit a finding ("flex is ignored: width/height is constrained — only auto dimensions are engine-controlled"). If threading sibling context through the walk would collide with slice-4's app-model edits, SKIP it and record the deviation in the commit message — the dimension-control rule already prevents the runtime write-fight, so the finding is advisory, not load-bearing.
  - `app-model.ts`: import + call `registryFindings` at the point markup attrs are walked; thread findings into the existing findings array.
  - `lfc-dts.ts`: add a curated `VIEW_PROPS` push beside `VIEW_METHODS` (lfc-dts.ts:143 — `if (tag === "view") …`; NOT `VIEW_RELATIONAL`:56, which is only consulted for attrs already in SCHEMA and would be silently dead) emitting `flex?: number; alignself?: string; margin?: number;`, then regenerate `compiler/lfc.d.ts` via `npm run gen:lfcdts` (package.json:23). There is no byte-diff guard for lfc.d.ts; `lfc-dts.test.mjs` typechecks the generated text and `checkApp` reads the committed artifact — the fixture test is the real gate.
- [ ] **Step 4:** `npm test` → new tests pass, `lfc-dts`/`lzx-check` suites still green.
- [ ] **Step 5:** Commit: `compiler: component attribute registry (flexlayout enums + view hints) + LzView hint typing`

---

### Task 4: `flexlayout.lzx`

**Files:**
- Create: `runtime/components/utils/layouts/flexlayout.lzx`
- Modify: `runtime/lzx-autoincludes.properties` (+ the oracle copy under `compiler/compiler-verify/` ONLY if `git grep -l lzx-autoincludes compiler/compiler-verify` shows parity fixtures reference it — check at execution; if unsure, leave the oracle copy alone and confirm `npm test` parity suites stay green)
- Test: compile-level — a fixture app under `compiler/test/fixtures/` compiled via the existing compile test harness (`domsource`/`compile` test files show the invocation), asserting the app compiles and includes the adapter scripts.

**Interfaces:** consumes `LzFlexAdapter` + `LzCssLayout` globals (Tasks 1-2).

- [ ] **Step 1:** Write the class:

```xml
<library>
<include href="utils/layouts/layout.lzx"/>
<script src="css-layout.js"/>
<script src="flex-adapter.js"/>
<class name="flexlayout" extends="layout">
    <!--- Main axis: row (default), column, row-reverse, column-reverse. -->
    <attribute name="flexdirection" value="row" type="string"/>
    <!--- Main-axis distribution: flex-start (default), center, flex-end, space-between, space-around. -->
    <attribute name="justifycontent" value="flex-start" type="string"/>
    <!--- Cross-axis alignment: stretch (default), flex-start, center, flex-end. -->
    <attribute name="alignitems" value="stretch" type="string"/>
    <!--- nowrap (default) or wrap. -->
    <attribute name="flexwrap" value="nowrap" type="string"/>
    <!--- Uniform container padding, px. -->
    <attribute name="padding" value="0" type="number"/>

    <!--- @keywords private -->
    <method name="construct" args="view, args"><![CDATA[
        super.construct(view, args);
        this.$snapshots = {};      // uid -> {width:{auto,value}, height:{auto,value}, controlled:{width,height}}
        this.$subDelegates = {};   // uid -> [LzDelegate]
        this.updateDelegate.register(this.immediateparent, "onwidth");
        this.updateDelegate.register(this.immediateparent, "onheight");
        // One layout per parent: we claim x,y,width,height (documented; base class doesn't enforce)
        if (this.immediateparent.layouts && this.immediateparent.layouts.length > 1) {
            if ($debug) Debug.warn("flexlayout: another layout on %w — flexlayout claims x/y/width/height", this.immediateparent);
        }
    ]]></method>

    <!--- @keywords private -->
    <method name="addSubview" args="sd"><![CDATA[
        super.addSubview(sd);
        var uid = sd.getUID();
        // Snapshot container: filled lazily AT TAKEOVER (first engine write), not at adoption —
        // a ${…} constraint may not have applied yet when onaddsubview fires, and hasset* only
        // becomes reliable once it has. Until we control a dim, live hasset* is the truth.
        this.$snapshots[uid] = { width: null, height: null, controlled: { width: false, height: false } };
        var dels = this.$subDelegates[uid] = [];
        var mk = new LzDelegate(this, "update");
        mk.register(sd, "onvisible");
        mk.register(sd, "onwidth");
        mk.register(sd, "onheight");
        mk.register(sd, "onflex");
        mk.register(sd, "onalignself");
        mk.register(sd, "onmargin");
        dels.push(mk);
        this.update();
    ]]></method>

    <!--- @keywords private -->
    <method name="removeSubview" args="sd"><![CDATA[
        this.$restore(sd);
        var uid = sd.getUID();
        var dels = this.$subDelegates[uid];
        if (dels) { for (var i = 0; i < dels.length; i++) dels[i].unregisterAll(); delete this.$subDelegates[uid]; }
        delete this.$snapshots[uid];
        super.removeSubview(sd);
        this.update();
    ]]></method>

    <!--- @keywords private -->
    <method name="destroy"><![CDATA[
        for (var i = 0; i < this.subviews.length; i++) this.$restore(this.subviews[i]);
        for (var uid in this.$subDelegates) {
            var dels = this.$subDelegates[uid];
            for (var j = 0; j < dels.length; j++) dels[j].unregisterAll();
        }
        super.destroy();
    ]]></method>

    <!--- Put a subview's dimensions back the way we found them (spec: size restoration). -->
    <method name="$restore" args="sd"><![CDATA[
        var snap = this.$snapshots[sd.getUID()];
        if (!snap) return;
        for (var dim in snap.controlled) {
            if (!snap.controlled[dim]) continue;
            if (snap[dim].auto) {
                sd.setAttribute(dim, null);
                // LzText's null path dead-ends in the sprite; force a re-measure.
                if (sd is LzText && sd._updateSize) sd._updateSize();
            } else {
                sd.setAttribute(dim, snap[dim].value);
            }
            snap.controlled[dim] = false;
        }
    ]]></method>

    <!--- @keywords private -->
    <method name="update" args="e=null"><![CDATA[
        if (this.locked) return;
        this.lock();
        try {
            var parent = this.immediateparent;
            var subs = this.subviews;
            var kids = [];
            for (var i = 0; i < subs.length; i++) {
                var s = subs[i], snap = this.$snapshots[s.getUID()];
                kids.push({
                    width: s.width, height: s.height,
                    // Live hasset* unless WE set it (our own setAttribute flips hasset)
                    autoWidth: snap && snap.controlled.width ? snap.width.auto : !s.hassetwidth,
                    autoHeight: snap && snap.controlled.height ? snap.height.auto : !s.hassetheight,
                    // flex on a non-auto main dim is inert by the dimension rule; say so once in debug builds
                    flex: Number(s['flex']) > 0 ? Number(s['flex']) : 0,
                    alignself: s['alignself'] || null,
                    margin: Number(s['margin']) || 0,
                    visible: s.visible,
                    ignore: !!(s.options && s.options['ignorelayout'])
                });
            }
            var tree = LzFlexAdapter.buildTree({
                width: parent.width, height: parent.height,
                flexdirection: this.flexdirection, justifycontent: this.justifycontent,
                alignitems: this.alignitems, flexwrap: this.flexwrap, padding: this.padding
            }, kids);
            var writes = LzFlexAdapter.computeWrites(tree, parent.width);
            for (var w = 0; w < writes.length; w++) {
                var wr = writes[w], sv = subs[wr.idx], sn = this.$snapshots[sv.getUID()];
                if (sv.x !== wr.x) sv.setAttribute('x', wr.x);
                if (sv.y !== wr.y) sv.setAttribute('y', wr.y);
                if (wr.width  != null) {
                    if (sn && !sn.controlled.width) { sn.width = { auto: !sv.hassetwidth, value: sv.width }; sn.controlled.width = true; }
                    if (sv.width !== wr.width) sv.setAttribute('width', wr.width);
                }
                else if (sn && sn.controlled.width)  { /* left engine control */ this.$restoreDim(sv, sn, 'width'); }
                if (wr.height != null) {
                    if (sn && !sn.controlled.height) { sn.height = { auto: !sv.hassetheight, value: sv.height }; sn.controlled.height = true; }
                    if (sv.height !== wr.height) sv.setAttribute('height', wr.height);
                }
                else if (sn && sn.controlled.height) { this.$restoreDim(sv, sn, 'height'); }
            }
        } catch (err) {
            if ($debug) Debug.warn("flexlayout: engine error %w — positions left untouched", err);
        } finally {
            this.locked = false;
        }
    ]]></method>

    <!--- Restore ONE dimension that just left engine control. -->
    <method name="$restoreDim" args="sd, snap, dim"><![CDATA[
        if (snap[dim].auto) {
            sd.setAttribute(dim, null);
            if (sd is LzText && sd._updateSize) sd._updateSize();
        } else {
            sd.setAttribute(dim, snap[dim].value);
        }
        snap.controlled[dim] = false;
    ]]></method>

    <doc>
        <tag name="shortdesc"><text>CSS flexbox layout (vendored css-layout engine).</text></tag>
        <text>Positions and (for flex/stretch children) sizes the parent's direct subviews
        with CSS flexbox semantics. Container attributes: flexdirection, justifycontent,
        alignitems, flexwrap, padding. Subview hints: flex (grow factor; grow-only — this
        engine has no flex-shrink), alignself, margin (uniform). Only genuinely-auto
        dimensions are engine-controlled: authored, constrained, or previously-set sizes
        are inputs, never outputs. No gap property — use margins. One flexlayout per
        parent (it claims x, y, width and height).</text>
    </doc>
</class>
</library>
```
  Notes for the implementer: `sd is LzText` — use the runtime idiom the components use (`sd instanceof LzText` if `is` doesn't compile in this dialect; check a component using instanceof, e.g. grep `instanceof Lz` under runtime/components). `LzDelegate.unregisterAll` — verify the method name in `LaszloEvents.lzs` (it exists as `unregisterAll` in LFC; if named differently, use that). `hassetwidth`/`hassetheight` — verify readable at component level (LaszloView.lzs:1346).
- [ ] **Step 2:** Add `flexlayout: utils/layouts/flexlayout.lzx` to `runtime/lzx-autoincludes.properties` (alphabetical placement, matching file style).
- [ ] **Step 3: Compile-level test:** use `compileFile(appPath, { lpsHome })` from `compiler/dist/node.js` with `lpsHome` = the repo `runtime/` dir — the exact pattern of `compiler/compiler-verify/harness/closure-test.mjs:12,29`. Compile a minimal `.lzx` fixture app using `<flexlayout>` + `flex` hints; assert compile succeeds and the emitted JS contains `LzFlexAdapter` (the script include made it in).
- [ ] **Step 4:** `npm test` → green. (compiler-verify parity suites are MANUAL, not part of npm test — the oracle-autoincludes question is settled by inspection: `find compiler/compiler-verify -name lzx-autoincludes.properties` exists but closure-test compiles with lpsHome=runtime/, and no parity fixture uses flexlayout; leave the oracle copy untouched. The runtime properties file header says "generated by ant" — hand-edit is the repo convention now; note in the commit.)
- [ ] **Step 5:** Commit: `components: <flexlayout> — engine-controlled dims, snapshots/restore, delegate lifecycle`

---

### Task 5: Demo + manual verification + docs

**Files:**
- Create: `examples/dom-authoring/flex-demo.html`
- Modify: spec status line.

- [ ] **Step 1:** Demo — toolbar row + wrapping gallery:

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>flexlayout demo</title>
<script src="/startup/laszlo-dom.js" type="module"></script></head>
<body>
<laszlo-app width="640" height="400">
  <view name="toolbar" width="${canvas.width}" height="48" bgcolor="0xEEEEEE">
    <flexlayout flexdirection="row" justifycontent="space-between" alignitems="center" padding="8"></flexlayout>
    <text text="flexlayout"></text>
    <view flex="1" height="1"></view>
    <text text="menu"></text>
  </view>
  <view name="gallery" y="56" width="${canvas.width}" height="336">
    <flexlayout flexdirection="row" flexwrap="wrap" padding="8"></flexlayout>
    <view width="120" height="80" bgcolor="0x4488CC" margin="6"></view>
    <view width="120" height="80" bgcolor="0x44CC88" margin="6"></view>
    <view width="120" height="80" bgcolor="0xCC8844" margin="6"></view>
    <view width="120" height="80" bgcolor="0x8844CC" margin="6"></view>
    <view width="120" height="80" bgcolor="0xCC4488" margin="6"></view>
  </view>
</laszlo-app>
</body></html>
```
(Adjust tags/attrs to the DOM dialect's actual conventions from `examples/dom-authoring/file-demo.html` at execution time — e.g. whether `canvas.width` constraints and `bgcolor` hex forms are used there.)
- [ ] **Step 2: Manual verification** with the slice-5 dev server: `node server/index.mjs 8096`, open the demo, verify toolbar spacing, gallery wrap, and window resize re-flow (live reload from slice 5 makes iterating pleasant). Record what was checked in the commit message.
- [ ] **Step 3:** `lzx-check` the demo (`node compiler/dist/lzx-check.js examples/dom-authoring/flex-demo.html` or the CLI's actual invocation) → zero findings.
- [ ] **Step 4:** Spec status → `**Status:** Implemented — <date> (…)`; commit `examples+docs: flexlayout demo, spec status`.
