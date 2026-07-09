import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShaderlib } from "../dist/shaderlib-port.js";
import { generateShader } from "../dist/glsl-gen.js";

test("the whole curated port transpiles finding-free", () => {
  const lib = loadShaderlib();
  assert.deepEqual(lib.findings, []);
  for (const ns of ["noise", "shape", "pal", "color", "math"]) assert.ok(lib.namespaces.includes(ns));
  // corrections applied:
  assert.ok(!("noise.snoise2" in lib.signatures), "snoise2 dropped (undefined z upstream)");
  assert.ok(!("shape.sdTorus82" in lib.signatures), "sdTorus82 dropped (undefined length2)");
  assert.ok(!("shape.drawField" in lib.signatures), "drawField excluded (derivatives ext)");
  assert.ok(!("pal.fetch" in lib.signatures), "texture functions excluded");
  assert.equal(lib.signatures["math.odd"].ret, "bool");
  assert.equal(lib.signatures["pal.pal1"].ret, "vec4");
  assert.equal(lib.signatures["noise.snoise2v"].params.join(), "vec2");
  assert.equal(lib.signatures["shape.circle"].params.length, 4, "distance-field circle survives; boolean one renamed fillcircle");
  assert.ok("shape.fillcircle" in lib.signatures);
});

test("cross-namespace calls resolve; pruning emits only reachable code, deps-first", () => {
  const lib = loadShaderlib();
  const r = generateShader({
    color: { code: "return color.hsla(vec4(uv, 0.5, 1.0));", srcLine: 1 },
    helpers: [], uniforms: [], shaderlib: lib,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /color_hsla/);
  assert.match(r.program.glsl, /color_hue2rgb/, "intra-lib dep emitted");
  assert.ok(r.program.glsl.indexOf("color_hue2rgb(") > -1);
  assert.ok(r.program.glsl.indexOf("float color_hue2rgb") < r.program.glsl.indexOf("vec4 color_hsla"),
    "deps emitted before dependents");
  assert.doesNotMatch(r.program.glsl, /snoise3v/, "unreachable lib code pruned");
});

test("the hero example generates against the REAL port", () => {
  const lib = loadShaderlib();
  const r = generateShader({
    color: { code: "let n = noise.snoise2v(uv * 8.0 + time * this.speed);\nreturn pal.pal1(n);", srcLine: 1 },
    helpers: [], uniforms: [{ name: "speed", lzType: "number" }],
    shaderlib: lib,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /float noise_snoise2v\(vec2 v\)/);
  assert.match(r.program.glsl, /vec4 pal_pal1\(float t\)/);
});
