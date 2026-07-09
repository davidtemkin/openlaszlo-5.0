import { test } from "node:test";
import assert from "node:assert/strict";
import { swizzleType, isRepeatedSwizzle, constructorType, genShaderDts, INTRINSICS, OPERATORS }
  from "../dist/shader-table.js";

test("swizzle typing across alphabets and lengths", () => {
  assert.equal(swizzleType("vec4", "xy"), "vec2");
  assert.equal(swizzleType("vec4", "zyx"), "vec3");
  assert.equal(swizzleType("vec4", "rgba"), "vec4");
  assert.equal(swizzleType("vec2", "st"), "vec2");
  assert.equal(swizzleType("vec4", "x"), "float");
  assert.equal(swizzleType("vec2", "z"), null);          // out of range
  assert.equal(swizzleType("vec4", "xr"), null);         // mixed alphabets
  assert.ok(isRepeatedSwizzle("xx"));
  assert.ok(!isRepeatedSwizzle("xyz"));
});

test("constructor rules: summation, broadcast, bvec conversion, zero-arg error", () => {
  assert.equal(constructorType("vec4", ["vec2", "vec2"]), "vec4");
  assert.equal(constructorType("vec4", ["vec3", "float"]), "vec4");
  assert.equal(constructorType("vec3", ["float"]), "vec3");            // broadcast
  assert.equal(constructorType("vec4", ["bvec4"]), "vec4");            // bool→float
  assert.deepEqual(constructorType("vec3", []), { error: "constructor requires arguments" });
  assert.deepEqual(constructorType("vec4", ["vec4", "float"]), { error: "too many components (5 for vec4)" });
});

test("intrinsics: genType overloads incl. scalar-second forms", () => {
  assert.ok(INTRINSICS.max.some(o => o.params.join() === "vec3,float" && o.ret === "vec3"));
  assert.ok(INTRINSICS.clamp.some(o => o.params.join() === "vec4,float,float" && o.ret === "vec4"));
  assert.ok(INTRINSICS.lessThan.some(o => o.params.join() === "vec4,vec4" && o.ret === "bvec4"));
  assert.ok(INTRINSICS.dot.some(o => o.params.join() === "vec3,vec3" && o.ret === "float"));
});

test("operator table: no float % overload; both vec*float orders", () => {
  assert.ok(!OPERATORS.__mod.some(o => o.params.includes("float")));
  assert.ok(OPERATORS.__mul.some(o => o.params.join() === "vec2,float"));
  assert.ok(OPERATORS.__mul.some(o => o.params.join() === "float,vec2"));
});

test("genShaderDts: settable swizzles, readonly repeats, operator intrinsics, builtins", () => {
  const d = genShaderDts("declare const __uniforms: { speed: number };", "");
  assert.match(d, /interface vec4\b/);
  assert.match(d, /\bxyz: vec3;/);                       // settable
  assert.match(d, /readonly xx: vec2;/);                 // repeated → readonly (true TS finding on write)
  assert.match(d, /declare function __mul\(/);
  assert.match(d, /declare const uv: vec2;/);
  assert.match(d, /declare const time: number;/);        // float maps to number in TS space
});
