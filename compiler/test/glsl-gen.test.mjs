import { test } from "node:test";
import assert from "node:assert/strict";
import { generateShader, rewriteOperators } from "../dist/glsl-gen.js";

const gen = (code, uniforms = [], helpers = []) =>
  generateShader({ color: { code, srcLine: 1 }, helpers, uniforms });

const glslOf = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.program.glsl; };
const findingsOf = (r) => { assert.equal(r.ok, false); return r.findings.map(f => f.message); };

test("minimal color(): preamble, main wrapper, float literals", () => {
  const g = glslOf(gen("return vec4(1, 0, 0.5, 1);"));
  assert.match(g, /^precision mediump float;/);
  assert.match(g, /vec4\(1\.0, 0\.0, 0\.5, 1\.0\)/);
  assert.match(g, /void main\(\)/);
  assert.match(g, /gl_FragColor = color\(\);/);
});

test("uniforms: this.speed → uniform float; color type → vec3; only referenced ones", () => {
  const r = gen("return vec4(uv * this.speed, this.tint.x, 1.0);",
    [{ name: "speed", lzType: "number" }, { name: "tint", lzType: "color" }, { name: "unused", lzType: "number" }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /uniform float speed;/);
  assert.match(r.program.glsl, /uniform vec3 tint;/);
  assert.deepEqual(r.program.uniforms.map(u => u.name).sort(), ["speed", "tint"]);
  assert.match(r.program.glsl, /vec4\(uv \* speed, tint\.x, 1\.0\)/);
});

test("builtins: uv/time/mouse/size wire varyings/uniforms and set flags", () => {
  const r = gen("return vec4(uv, time, mouse.x);");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.program.usesTime, true);
  assert.equal(r.program.usesMouse, true);
  assert.match(r.program.glsl, /varying vec2 uv;/);
  assert.match(r.program.glsl, /uniform float time;/);
});

test("lattice: vec arithmetic promotion, comparisons, logical ops, ternary", () => {
  const g = glslOf(gen(`
    let a = uv * 8.0;
    let b = a + vec2(1, 2);
    let c = b.x > 1.0 && b.y < 2.0;
    return c ? vec4(b, 0.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
  `));
  assert.match(g, /vec2 a = uv \* 8\.0;/);
  assert.match(g, /bool c = /);
});

test("assignment, chained + compound + swizzle lvalues", () => {
  const g = glslOf(gen(`
    let p = vec4(uv, 0, 1);
    p.xy += uv;
    p.xyz = p.xyz * 0.5;
    let r2 = 0.0; let g2 = 0.0;
    r2 = g2 = p.x;
    return p;
  `));
  assert.match(g, /p\.xy \+= uv;/);
  assert.match(g, /r2 = \(g2 = p\.x\);|r2 = g2 = p\.x;/);
});

test("for loop: int counter, float(i) cast where it meets float math", () => {
  const g = glslOf(gen(`
    let acc = 0.0;
    for (let i = 0; i < 8; i++) { acc = acc + float(i) * 0.1; }
    return vec4(acc, acc, acc, 1.0);
  `));
  assert.match(g, /for \(int i = 0; i < 8; i\+\+\)/);
  assert.match(g, /float\(i\) \* 0\.1/);
});

test("helpers become GLSL functions; call-graph pruning drops unused ones", () => {
  const r = generateShader({
    color: { code: "return glow(uv);", srcLine: 1 },
    helpers: [
      { name: "glow", params: [{ name: "p", type: "vec2" }], ret: "vec4", code: "return vec4(p, 0.0, 1.0);", srcLine: 1 },
      { name: "dead", params: [], ret: "float", code: "return 1.0;", srcLine: 1 },
    ],
    uniforms: [],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /vec4 glow\(vec2 p\)/);
  assert.doesNotMatch(r.program.glsl, /float dead/);
});

test("findings: dialect violations, each with a line", () => {
  for (const [code, needle] of [
    ["const a = [1, 2]; return vec4(1.0,0.0,0.0,1.0);", /array/i],
    ["const s = 'x'; return vec4(1.0,0.0,0.0,1.0);", /string/i],
    ["while (true) {} return vec4(1.0,0.0,0.0,1.0);", /while/i],
    ["let v = vec2(1.0, 2.0); v.xx = v; return vec4(v, 0.0, 1.0);", /repeated/i],
    ["let m = 5.0 % 2.0; return vec4(m, 0.0, 0.0, 1.0);", /mod|%/i],
    ["let z = vec3(); return vec4(z, 1.0);", /constructor/i],
    ["for (let i = 0; i < this.n; i++) {} return vec4(1.0,0.0,0.0,1.0);", /loop bound/i],
    ["return vec4(uv, 1.0);", /components|arity|vec4/i],                   // 3 for vec4
    ["return vec4(uv, vec3(1.0));", /components|arity|vec4/i],             // 5 for vec4 — strict summation
    ["let q = uv + vec3(1.0,1.0,1.0); return vec4(q, 0.0, 1.0);", /vec2.*vec3|mismatch|operand/i],
    ["return this.nope;", /undeclared|nope/i],
  ]) {
    const msgs = findingsOf(gen(code, [{ name: "n", lzType: "number" }]));
    assert.ok(msgs.some(m => needle.test(m)), `${code} → ${JSON.stringify(msgs)}`);
  }
});

test("rewriteOperators: arithmetic → intrinsic calls; line-preserving", () => {
  const src = "let m = uv * 8.0 + n;\nlet k = -m;";
  const { code } = rewriteOperators(src);
  assert.match(code, /__add\(__mul\(uv, 8\.0\), n\)/);
  assert.match(code, /__neg\(m\)/);
  assert.equal(code.split("\n").length, src.split("\n").length, "line-preserving");
});

test("the hero example generates clean", () => {
  const r = generateShader({
    color: { code: "let n = noise.snoise2v(uv * 8.0 + time * this.speed);\nreturn pal.pal1(n);", srcLine: 1 },
    helpers: [], uniforms: [{ name: "speed", lzType: "number" }],
    shaderlib: {
      signatures: { "noise.snoise2v": { params: ["vec2"], ret: "float" }, "pal.pal1": { params: ["float"], ret: "vec4" } },
      glslFor: () => "/* lib stub */",
    },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /snoise2v\(uv \* 8\.0 \+ time \* speed\)/);
});

test("rewriteOperators: depth-3+ chains fold once (regression: nested splices double-applied)", () => {
  const src = "let r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * 0.35),\n             fbm(p + w * q + vec2(8.3, 2.8)));";
  const { code } = rewriteOperators(src);
  assert.equal(code.split("\n").length, src.split("\n").length, "line-preserving");
  assert.match(code, /__add\(__add\(__add\(p, __mul\(w, q\)\), vec2\(1\.7, 9\.2\)\), __mul\(t, 0\.35\)\)/);
  assert.doesNotMatch(code, /\)\)[a-z]/, "no spliced debris");
});
