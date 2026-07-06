import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem } from "../dist/domsource.js";
import { el, text } from "./helpers/fakedom.mjs";
import { generateShader } from "../dist/glsl-gen.js";
import { loadShaderlib } from "../dist/shaderlib-port.js";

const lib = loadShaderlib();
const glslGen = (input) => generateShader({ ...input, shaderlib: lib });

const shaderApp = (colorCode) =>
  el("laszlo-app", { width: "200", height: "100" },
    el("shader", { width: "200", height: "100" },
      el("attribute", { name: "speed", type: "number", value: "1" }),
      el("method", { name: "color" },
        el("script", { type: "text/typescript" }, text(colorCode)))));

test("domsource: shader methods stripped, shaderprogram attr stamped, JSON survives", () => {
  const xml = domToXmlElem(shaderApp("return vec4(uv * this.speed, 0.0, 1.0);"),
    { transpileTs: (c) => c, glslGen });
  const shader = xml.children.find((c) => c.type === "elem" && c.name === "shader");
  assert.ok(shader, "shader instance kept");
  assert.ok(!shader.children.some((c) => c.type === "elem" && c.name === "method"), "method carriers stripped");
  assert.ok(shader.children.some((c) => c.type === "elem" && c.name === "attribute"), "attribute declarations kept");
  const prog = JSON.parse(shader.attrs.shaderprogram);
  assert.match(prog.glsl, /^precision mediump float;/);
  assert.match(prog.glsl, /uniform float speed;/);
  assert.deepEqual(prog.uniforms, [{ name: "speed", glslType: "float" }]);
  assert.ok(!prog.glsl.includes("\r"), "no raw CRs");
});

test("domsource: generation findings become dialect errors; no glslGen → clear error", () => {
  assert.throws(() => domToXmlElem(shaderApp("const s = 'nope'; return s;"),
    { transpileTs: (c) => c, glslGen }), /string|dialect/i);
  assert.throws(() => domToXmlElem(shaderApp("return vec4(0.0, 0.0, 0.0, 1.0);"),
    { transpileTs: (c) => c }), /glslGen/);
});

test("domsource: shader using the shaderlib inlines only reachable lib functions", () => {
  const xml = domToXmlElem(shaderApp("return pal.pal1(noise.cheapnoise(uv));"),
    { transpileTs: (c) => c, glslGen });
  const prog = JSON.parse(xml.children.find((c) => c.name === "shader").attrs.shaderprogram);
  assert.match(prog.glsl, /pal_pal1/);
  assert.match(prog.glsl, /noise_cheapnoise/);
  assert.doesNotMatch(prog.glsl, /snoise3v/);
});
