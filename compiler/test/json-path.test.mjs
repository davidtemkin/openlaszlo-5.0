import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePath, evaluatePath, resolvePointer, isJsonAbsolutePath, hasFanout, JsonPathError } from "../dist/json-path.js";

const bikeshop = { bicycle: [
  { color: "red", price: 19.95 }, { color: "green", price: 29.95 },
  { color: "blue", price: 59.95 }, { color: "black", price: 9.95 } ] };
const store = { store: { book: [{ title: "A", price: 8 }, { title: "B", price: 12 }], bicycle: { color: "red" } } };

test("isJsonAbsolutePath: $name forms yes, ${} constraints and XPath no", () => {
  assert.ok(isJsonAbsolutePath("$bikeshop"));
  assert.ok(isJsonAbsolutePath("$bikeshop/bicycle[*]/color"));
  assert.ok(!isJsonAbsolutePath("${parent.x + 1}"));
  assert.ok(!isJsonAbsolutePath("$once{foo}"));
  assert.ok(!isJsonAbsolutePath("dset:/employee"));
  assert.ok(!isJsonAbsolutePath("/relative"));
});

test("parse: dataset prefix, segments, selectors", () => {
  const p = parsePath("$storedata/store/book[*]/title");
  assert.equal(p.dataset, "storedata");
  assert.deepEqual(p.segments.map((s) => s.prop), ["store", "book", "title"]);
  assert.deepEqual(p.segments[1].selectors, [{ kind: "wild" }]);
  assert.equal(p.filter, false);
  assert.ok(hasFanout(p));
});

test("parse: relative, index, range, bare $name, terminal filter", () => {
  assert.equal(parsePath("/subgenres[*]/name").dataset, null);
  assert.deepEqual(parsePath("/a[0]").segments[0].selectors, [{ kind: "index", i: 0 }]);
  assert.deepEqual(parsePath("/a[0,3,2]").segments[0].selectors, [{ kind: "range", start: 0, end: 3, step: 2 }]);
  assert.deepEqual(parsePath("$foo"), { dataset: "foo", segments: [], filter: false });
  assert.equal(parsePath("$bikeshop/bicycle[*][@]").filter, true);
  assert.ok(!hasFanout(parsePath("/a/b")));
});

test("parse errors: mid-path [@], empty property, garbage selector", () => {
  assert.throws(() => parsePath("$b/a[@]/c"), JsonPathError);
  assert.throws(() => parsePath("$b//c"), JsonPathError);
  assert.throws(() => parsePath("$b/a[x]"), JsonPathError);
  assert.throws(() => parsePath(""), JsonPathError);
});

test("evaluate: dreem corpus", () => {
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[*]/color")),
    ["red", "green", "blue", "black"]);
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[0,3,2]/color")), ["red", "blue"]); // end-exclusive, step 2
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$bikeshop/bicycle[1]/price")), [29.95]);
  assert.deepEqual(evaluatePath(store, parsePath("$s/store/bicycle/color")), ["red"]);
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$b")), [bikeshop]); // bare $name = whole value
});

test("evaluate: missing props / non-arrays fan to nothing; null root is empty", () => {
  assert.deepEqual(evaluatePath(bikeshop, parsePath("$b/nope[*]/x")), []);
  assert.deepEqual(evaluatePath(store, parsePath("$s/store/bicycle[*]")), []); // wild on non-array
  assert.deepEqual(evaluatePath(null, parsePath("$b/bicycle[*]")), []);
});

test("evaluate: [@] filter accumulates via filterFn (dreem signature)", () => {
  const p = parsePath("$bikeshop/bicycle[*][@]");
  const out = evaluatePath(bikeshop, p, (obj, accum) => {
    if (obj.price > 20) accum.unshift(obj.color);
    return accum;
  });
  assert.deepEqual(out, ["blue", "green"]);
});

test("resolvePointer: keys, array indices, misses", () => {
  const r = resolvePointer(bikeshop, "/bicycle/2/color");
  assert.equal(r.parent[r.key], "blue");
  const p2 = resolvePointer(store, "/store/bicycle/color");
  assert.equal(p2.parent[p2.key], "red");
  assert.equal(resolvePointer(bikeshop, "/bicycle/9/color"), null);
  assert.equal(resolvePointer(bikeshop, "/nope/x"), null);
  assert.equal(resolvePointer(bikeshop, ""), null); // pointer cannot address the root
});
