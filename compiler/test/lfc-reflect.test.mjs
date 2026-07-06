import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryAst } from "../dist/sc.js";
import { reflectLibrary, loadLfcReflection } from "../dist/lfc-reflect.js";

test("reflects classes, typed members, filters privates + constructor", () => {
  const src = `
class LzDemo extends LzEventable {
  var count:Number = 0;
  var __secret:Boolean = false;
  static var flag:Boolean = true;
  function LzDemo(parent = null) { }
  function poke(n:Number, s:String = null):void { }
  function $lzc$hidden() { }
}
lz.Demo = LzDemoService.LzDemo;
`;
  const r = reflectLibrary(parseLibraryAst(src, "demo.lzs", () => null));
  const c = r.classes.get("LzDemo");
  assert.ok(c);
  assert.equal(c.sup, "LzEventable");
  assert.deepEqual(c.vars, [
    { name: "count", type: "Number", isStatic: false },
    { name: "flag", type: "Boolean", isStatic: true },
  ]);
  assert.deepEqual(c.methods, [{
    name: "poke", isStatic: false, returnType: "void",
    params: [{ name: "n", type: "Number" }, { name: "s", type: "String" }],
  }]);
  assert.deepEqual(r.lzAssignments, [{ prop: "Demo", className: "LzDemoService.LzDemo" }]);
});

test("include expansion feeds reflection", () => {
  const files = { "inc.lzs": "class LzInc { function go():void { } }" };
  const r = reflectLibrary(parseLibraryAst('#include "inc.lzs"\n', "root.lzs", (p) => files[p] ?? null));
  assert.ok(r.classes.get("LzInc"));
});

test("loads the REAL LFC: LzNode/LzView present with expected members", () => {
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  const r = loadLfcReflection(root);
  const node = r.classes.get("LzNode");
  assert.ok(node, "LzNode not found — wrong root file?");
  assert.ok(node.methods.some((m) => m.name === "animate"));
  const view = r.classes.get("LzView");
  assert.ok(view.methods.some((m) => m.name === "bringToFront"));
  assert.ok(r.lzAssignments.some((a) => a.prop === "Timer"));
  assert.ok(r.lzAssignments.some((a) => a.prop === "Focus"));
  // privates filtered
  assert.ok(!view.methods.some((m) => m.name.startsWith("__") || m.name.startsWith("$")));
});
