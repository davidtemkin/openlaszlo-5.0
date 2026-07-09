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
  const w = run(box({ flexwrap: "wrap", height: 100 }), [kid({ width: 120 }), kid({ width: 120 })]);
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
