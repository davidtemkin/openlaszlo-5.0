import { test } from "node:test";
import assert from "node:assert/strict";
import { inferShape, renderShape, walkShapePath } from "../dist/json-shape.js";
import { parsePath } from "../dist/json-path.js";

test("infer + render: primitives, objects, arrays", () => {
  assert.equal(renderShape(inferShape({ color: "red", price: 19.95, ok: true, n: null })),
    "{ color: string; price: number; ok: boolean; n: null }");
  assert.equal(renderShape(inferShape([1, 2])), "number[]");
  assert.equal(renderShape(inferShape([])), "any[]");
});

test("array unification: merged-optional + union (spec rule)", () => {
  // [{color},{price}] → {color?: string; price?: number}
  assert.equal(renderShape(inferShape([{ color: "red" }, { price: 1 }]).elem),
    "{ color?: string; price?: number }");
  // [{x:1},{x:null}] → {x: number | null}
  assert.equal(renderShape(inferShape([{ x: 1 }, { x: null }]).elem),
    "{ x: number | null }");
});

test("walk: happy path yields element shape", () => {
  const s = inferShape({ bicycle: [{ color: "red", price: 1 }] });
  const r = walkShapePath(s, parsePath("$b/bicycle[*]"));
  assert.ok("ok" in r);
  assert.equal(renderShape(r.ok), "{ color: string; price: number }");
  const r2 = walkShapePath(s, parsePath("$b/bicycle[*]/color"));
  assert.equal(renderShape(r2.ok), "string");
});

test("walk: unknown property and selector-on-non-array are errors", () => {
  const s = inferShape({ bicycle: [{ color: "red" }], lone: { x: 1 } });
  const r = walkShapePath(s, parsePath("$b/bike[*]"));
  assert.match(r.error, /unknown property "bike"/);
  const r2 = walkShapePath(s, parsePath("$b/lone[*]"));
  assert.match(r2.error, /"lone" is not an array/);
});

test("walk: any is a sink (empty-array elem, declared-any)", () => {
  const s = inferShape({ list: [] });
  const r = walkShapePath(s, parsePath("$b/list[*]/deep/deeper"));
  assert.ok("ok" in r);
  assert.equal(renderShape(r.ok), "any");
});
