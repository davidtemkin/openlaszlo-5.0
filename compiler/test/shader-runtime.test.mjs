import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";
const require = createRequire(import.meta.url);
const Q = require("../../runtime/components/extensions/webgl-quad.js");

test("uniform plan: lz values → GL setter plan; 24-bit color normalize", () => {
  const plan = Q.uniformPlan([{ name: "speed", glslType: "float" }, { name: "tint", glslType: "vec3" }]);
  assert.equal(plan.speed.kind, "1f");
  assert.equal(plan.tint.kind, "3f");
  assert.deepEqual(Q.lzColorToVec3(0xff8000).map(v => Math.round(v * 100) / 100), [1, 0.5, 0]);
  assert.deepEqual(Q.lzColorToVec3(0), [0, 0, 0]);
});

test("the shader demo checks clean end-to-end", () => {
  const r = checkApp(readFileSync(new URL("../../examples/dom-authoring/shader-demo.html", import.meta.url), "utf8"),
    "shader-demo.html");
  assert.deepEqual(r.findings.map(f => `${f.line}: ${f.message}`), []);
  assert.ok(r.shaderBodiesChecked >= 1);
});

test("every validation-page case generates clean GLSL (the browser page compiles them)", async () => {
  const { generateShader } = await import("../dist/glsl-gen.js");
  const { loadShaderlib } = await import("../dist/shaderlib-port.js");
  const lib = loadShaderlib();
  const html = readFileSync(new URL("../../examples/dom-authoring/shader-validate.html", import.meta.url), "utf8");
  const m = html.match(/<script type="application\/json" id="cases">([\s\S]*?)<\/script>/);
  assert.ok(m, "CASES json block found");
  const cases = JSON.parse(m[1]);
  for (const [label, code] of Object.entries(cases)) {
    const r = generateShader({ color: { code, srcLine: 1 }, helpers: [],
      uniforms: [{ name: "speed", lzType: "number" }, { name: "tint", lzType: "color" }], shaderlib: lib });
    assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.ok ? null : r.findings)}`);
    assert.match(r.program.glsl, /^precision mediump float;/);
  }
});
