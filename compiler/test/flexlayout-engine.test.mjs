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
  // _alignself NULL, never "auto": getAlignItem (layout.js:388-396) tests truthiness —
  // "auto" matches no constant and falls through to flex-end.
  _alignself: null, _flexwrap: "nowrap", _position: "relative", _direction: "ltr",
  _flex: 0, ...over,
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
  assert.equal(c1.layout.top, 0, "cross-axis start (stretch/flex-start, not flex-end)");
});

test("engine: flex child grows into remaining space", () => {
  const fixed = node(ref({ _size: [50, 20] }));
  const grow = node(ref({ _size: [NaN, 20], _flex: 1 }));
  const root = node(ref({ _size: [200, 40] }), [fixed, grow]);
  layoutNode(root, 200, "ltr");
  assert.equal(grow.layout.width, 150);
  assert.equal(grow.layout.left, 50);
});
