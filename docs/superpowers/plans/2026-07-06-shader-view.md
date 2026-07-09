# `<shader>` Typed GPU Leaf View (Slice 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `<shader>` view whose fragment shader is authored in TS carriers, GLSL emitted at compile time from the TS AST by a generator-owned type lattice, uniforms bound to declared attributes, and bodies statically checked by lzx-check via an operator-rewrite pre-pass.

**Architecture:** One **signature table** (`shader-table.ts`) feeds four consumers: the generated `shader.d.ts` + operator intrinsics (checker), the generator's lattice (`glsl-gen.ts`, parser-only — `ts.createSourceFile`, never `ts.createProgram`), the curated shaderlib port, and the docs. Routing needs **zero `compile.ts` changes**: `domsource.ts` strips the shader method carriers pre-stamp (the `<server>` precedent), calls an **injected** `glslGen` (the `transpileTs` injection precedent — the typescript-bundling invariant survives), and stamps the program as a JSON-escaped `shaderprogram` attribute (the `$datapath` generated-attr precedent; JSON escaping survives `normAttr`). The runtime class reads the attribute and drives a WebGL1 quad.

**Tech Stack:** TypeScript compiler API (parser only in the emit path; full program only inside dev-time lzx-check), WebGL1, LZX component library.

**Spec:** `docs/superpowers/specs/2026-07-06-shader-view-design.md` (rev 3) — normative for the dialect, lattice, table scope, preamble, port exclusions/corrections, and error handling.

## Global Constraints

- Branch `dom-authoring-slice7` stacked on `dom-authoring-slice6`; worktree `.claude/worktrees/shader-slice7`.
- `compile.ts` untouched (parity-guarded). `runtime/lfc-src` untouched. `ts-carrier.ts`'s invariant untouched: `glsl-gen.ts` may `import ts from "typescript"` ONLY because it is (a) used by lzx-check (dev-time, already imports typescript) and (b) injected into domsource from `lz-ts.js` for the browser path — it must NOT be imported by `browser.ts`/the lzc bundle graph (verify: `grep -c typescript` on the rebuilt `lzc-browser.js` stays 0-equivalent, i.e. bundle byte-parity or no `createSourceFile` string).
- GLSL rules (spec, golden-tested): `precision mediump float;` preamble; literals emit float (`1`→`1.0`); int `for` counters + `float(i)` casts; literal-constant loop bounds; zero-arg constructors are findings; `%` on floats is a finding (`math.mod`); repeated-component swizzle writes are readonly-in-d.ts + generator finding.
- Uniform mapping: `type="number"` → `float`; `type="color"` → `vec3` (24-bit normalize). Built-ins: `uv: vec2`, `time: float`, `mouse: vec2`, `size: vec2`.
- Shaderlib namespaces `noise/shape/pal/color/math`; exclusions + upstream-bug corrections exactly as the spec's "curated port" section (drawField, palettelib texture fns; snoise2, sdTorus82/88, dup circle, bool odd/even).
- No browser automation available: GL validation is a **self-checking validation page** (compiles every emitted shader with `gl.compileShader`, renders pass/fail) + the user's browser pass; golden tests are the merge gate.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Verified anchors (worktree flex-slice6 = base)

- Second-program pattern EXISTS: `lzx-check.ts:131-165` (server bodies: 3 virtual files, no lfc.d.ts, `ts.createProgram`, BodySpan mapping `srcLine + (genLine - genStartLine)`; client program touches only `__lzbodies.ts`/`__lzconstraints.ts`).
- Raw-body collection precedent: `app-model.ts:226-274` `walkServer` collects untranspiled carrier text into `model.serverTags[].methods/handlers` — the exact model for `model.shaderPrograms`.
- `NON_INSTANCE` at `app-model.ts:52-54`; instance body collection at `:371,374`.
- domsource `<server>` strip-before-stamp: `domsource.ts:170-178` (`continue` before stamping/child-walk); `transpileTs` injection seam `:89-99`; carrier typing `:110-119`.
- Generated-attr precedents: `compile.ts:1465` (`$lzc$bind_id`), `:1862` (`$datapath`), `:1870` (`$delegates`) — attrs-map strings, `jsString`-escaped at emission.
- Injection plumbing: `startup/laszlo-dom.js` ~:89-96 passes `transpileTs` from `lz-ts.js` into `compileInBrowser`; `distroFetch` (:40-51) maps runtime-tree URLs (autoincludes). checkApp never runs domsource — Task 4 is fully independent of Task 5.
- Sprite DOM access: `drawview.lzx:580` `this.sprite.__LZcanvas` (LzSprite props readable from component methods); shader creates its own `<canvas>` in `this.sprite.__LZdiv`.
- Script-in-library: `<script src="…"/>` (slice-6 flexlayout precedent; `compile.ts:1372-1390`).

---

### Task 1: The signature table + generated d.ts artifacts

**Files:**
- Create: `compiler/src/shader-table.ts`
- Test: `compiler/test/shader-table.test.mjs`

**Interfaces (produces):**
- `TYPES = ["float","vec2","vec3","vec4","bool","bvec2","bvec3","bvec4","int"]`
- `INTRINSICS: Record<name, Overload[]>` where `Overload = { params: Type[], ret: Type }` — the spec's ~24 GLSL ES 1.00 functions with genType + scalar-second overloads (`mod/floor/fract/abs/dot/cross/length/distance/normalize/min/max/clamp/mix/step/smoothstep/sqrt/pow/exp/log/sin/cos/tan/sign/lessThan-family/any/all/float()/int() casts`).
- `CONSTRUCTORS`: component-count summation + scalar broadcast + bvec→float rules as a checkable function `constructorType(name, argTypes): Type | {error}`.
- `OPERATORS`: table for `__mul/__add/__sub/__div/__neg/__mod` overloads (vec∘vec same-size, vec∘float both orders, float∘float, int∘int; `__mod` only int∘int — float % is a finding).
- `genShaderDts(uniformDecls: string, shaderlibDts: string): string` — vec interfaces with the FULL generated swizzle surface (xyzw/rgba/stpq × lengths 1-4; **repeated-component combos emitted `readonly`**), built-ins, intrinsic declarations, operator intrinsics (`declare function __mul(a: vec2, b: number): vec2;` …), `declare const uv: vec2;` etc.
- `swizzleType(recv: Type, prop: string): Type | null` and `isRepeatedSwizzle(prop): boolean` — shared by generator + d.ts emitter (one definition).

- [ ] **Step 1: Failing tests** (`compiler/test/shader-table.test.mjs`):

```js
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
```

- [ ] **Step 2:** Run (`cd compiler && npm run build && node --test test/shader-table.test.mjs`) → FAIL.
- [ ] **Step 3:** Implement `shader-table.ts`. Sizes: swizzle surface is generated by iterating alphabets `["xyzw","rgba","stpq"]` × lengths 1..4 over component counts ≤ the vec size (~1,470 props across vec2/3/4 — never hand-written). In TS space `float`→`number`, `int`→`number`, `bool`→`boolean`; vec/bvec are interfaces. Operator intrinsic declarations emitted from `OPERATORS`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit: `compiler: shader signature table (types, intrinsics, constructors, operators) + generated shader.d.ts surface`

---

### Task 2: `glsl-gen.ts` — the generator

**Files:**
- Create: `compiler/src/glsl-gen.ts`
- Test: `compiler/test/glsl-gen.test.mjs`

**Interfaces (produces):**
- `generateShader(input): { ok: true, program: ShaderProgram } | { ok: false, findings: {message, line}[] }` where
  `input = { color: {code, srcLine}, helpers: Array<{name, params: {name,type}[], ret, code, srcLine}>, uniforms: Array<{name, lzType: "number"|"color"}>, shaderlib?: ShaderlibPort }`
  `ShaderProgram = { glsl: string, uniforms: Array<{name, glslType}>, usesTime, usesMouse }`
- Emission is parser-only: `ts.createSourceFile` per body; the lattice types every expression from the table (Task 1) + uniforms + helper signatures; violations accumulate as findings (never throws).
- Also exports `rewriteOperators(code): { code }` — the checker pre-pass (Task 4) — arithmetic/compound-assign/unary-minus → `__mul(a,b)` etc., produced from the same AST walk. **Line-preserving by construction** (intra-line span splices; the implementation asserts equal newline counts), so the existing BodySpan formula alone maps lines; finding COLUMNS are approximate (documented).

- [ ] **Step 1: Failing golden tests** (`compiler/test/glsl-gen.test.mjs`) — the contract, complete:

```js
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
  assert.equal(r.ok, true);
  assert.match(r.program.glsl, /uniform float speed;/);
  assert.match(r.program.glsl, /uniform vec3 tint;/);
  assert.deepEqual(r.program.uniforms.map(u => u.name).sort(), ["speed", "tint"]);
  assert.match(r.program.glsl, /vec4\(uv \* speed, tint\.x, 1\.0\)/);
});

test("builtins: uv/time/mouse/size wire varyings/uniforms and set flags", () => {
  const r = gen("return vec4(uv, time, mouse.x);");
  assert.equal(r.ok, true);
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
    return c ? vec4(b, 0, 1) : vec4(0);
  `.replace("vec4(0)", "vec4(0.0, 0.0, 0.0, 0.0)")));
  assert.match(g, /vec2 a = uv \* 8\.0;/);
  assert.match(g, /bool c = /);
});

test("assignment, chained + compound + swizzle lvalues", () => {
  const g = glslOf(gen(`
    let p = vec4(uv, 0, 1);
    let q = vec2(0, 0);
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
  assert.equal(r.ok, true);
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
    ["return vec4(uv, vec3(1.0));", /components|arity|vec4/i],              // 5 for vec4 — STRICT summation; partial consumption of the last arg is a WebGL1 portability trap, rejected
    ["let q = uv + vec3(1.0,1.0,1.0); return vec4(q, 0.0, 1.0);", /vec2.*vec3|mismatch/i],
    ["return this.nope;", /undeclared|nope/i],
  ]) {
    const msgs = findingsOf(gen(code, [{ name: "n", lzType: "number" }]));
    assert.ok(msgs.some(m => needle.test(m)), `${code} → ${JSON.stringify(msgs)}`);
  }
});

test("rewriteOperators: arithmetic → intrinsic calls; positions mapped", () => {
  const src = "let m = uv * 8.0 + n;\nlet k = -m;";
  const { code } = rewriteOperators(src);
  assert.equal(code.split("\n").length, src.split("\n").length, "line-preserving");
  assert.match(code, /__add\(__mul\(uv, 8\.0\), n\)/);
  assert.match(code, /__neg\(m\)/);
});

test("the hero example generates clean", () => {
  const r = generateShader({
    color: { code: "let n = noise.snoise2v(uv * 8.0 + time * this.speed);\nreturn pal.pal1(n);", srcLine: 1 },
    helpers: [], uniforms: [{ name: "speed", lzType: "number" }],
    shaderlib: { signatures: { "noise.snoise2v": { params: ["vec2"], ret: "float" }, "pal.pal1": { params: ["float"], ret: "vec4" } },
                 glslFor: (names) => "/* lib stub */" },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /snoise2v\(uv \* 8\.0 \+ time \* speed\)/);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per the spec's dialect/lattice sections. Structure: `typeOf(node, env)` (lattice, table-driven), `emitExpr(node, env)`, `emitStmt`, per-body walk, uniform/builtin usage collection, helper topological emission with pruning, `rewriteOperators` reusing the same operator classification. dreemgl `glslgen.js` is the reference for precedence/casting corner cases.
- [ ] **Step 4:** Iterate to green (this is the long task). **Step 5:** Commit: `compiler: glsl-gen — TS-AST → GLSL ES 1.00 (lattice, dialect findings, pruning, operator rewrite)`

---

### Task 3: The shaderlib curated port

**Files:**
- Create: `compiler/shaderlib/{noise,shape,pal,color,math}.ts` (dialect-clean sources) + `compiler/src/shaderlib-port.ts` (loader) + **`compiler/src/shaderlib-sources.ts` (GENERATED — string constants of the five sources, emitted by `npm run gen:shaderlib` added to package.json; the browser bundle gets the sources this way, since `--platform=browser --external:fs` turns fs reads into throw-shims)**. `loadShaderlib(sources = EMBEDDED)` parses the injected/embedded sources ONCE, exposes `signatures` + `glslFor(reachableNames)` + `findings`.
- Test: `compiler/test/shaderlib-port.test.mjs`

- [ ] **Step 1: Failing test:**

```js
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
  assert.equal(lib.signatures["math.odd"].ret, "bool");
  assert.equal(lib.signatures["pal.pal1"].ret, "vec4");
  assert.equal(lib.signatures["noise.snoise2v"].params.join(), "vec2");
});

test("cross-namespace calls + constants resolve; pruning emits only reachable code", () => {
  const lib = loadShaderlib();
  const r = generateShader({
    color: { code: "return vec4(color.hsla(vec4(uv, 0.5, 1.0)).rgb, 1.0);", srcLine: 1 },
    helpers: [], uniforms: [], shaderlib: lib,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.program.glsl, /hsla/);
  assert.doesNotMatch(r.program.glsl, /snoise3v/, "unreachable lib code pruned");
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Port the five dreemgl files (`/tmp/dreemgl/system/shaderlib/`; re-clone if wiped) by hand into the dialect (each ported file KEEPS a provenance header + the repo NOTICE gains a dreemgl entry — Apache §4(d), spec-normative): AMD unwrapped, `var`→`let`, alias chains split (keep the PRIMARY name: `snoise2v`, `rainbow`→`pal1` keeps `pal1`), `this.`-calls → namespace-qualified, string constants → `const PI: float = 3.141592653589793;`, exclusions + corrections per the spec list. Every function annotated (`function snoise2v(v: vec2): float`). `loadShaderlib()` parses once, caches, returns findings (must be `[]`).
- [ ] **Step 4:** Green. **Step 5:** Commit: `compiler: shaderlib curated port (5 namespaces, corrections + exclusions documented) + loader`

---

### Task 4: Checker — third program with operator pre-pass

**Files:**
- Modify: `compiler/src/app-model.ts` (walkShader: raw-body collection, body-only gate), `compiler/src/lzx-check.ts` (shader program block after the server one), `compiler/src/app-dts.ts` if body-wrapping helpers live there (follow `generateServerBodies`)
- Create: fixtures `compiler/test/fixtures/shader-check.html`, `shader-check-clean.html` (the HERO example verbatim)
- Test: `compiler/test/shader-check.test.mjs`

- [ ] **Step 1: Failing tests:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("HERO CANARY: the spec's example checks finding-free end-to-end", () => {
  const r = checkApp(read("shader-check-clean.html"), "shader-check-clean.html");
  assert.deepEqual(r.findings.map(f => f.message), []);
  assert.ok(r.shaderBodiesChecked >= 1);
});

test("shader findings map to source lines; client program is untouched both ways", () => {
  const src = read("shader-check.html");
  const r = checkApp(src, "shader-check.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex(l => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find(f => f.line === at(needle));
  assert.ok(find("m.xyz"), "downstream-of-arithmetic wrong swizzle IS a finding: " + JSON.stringify(r.findings));
  assert.ok(find("noise.snoise2v(badarg"), "call-arity/type finding");
  assert.ok(find("this.notdeclared"), "undeclared uniform finding");
  assert.ok(find("vec4 leaked"), "client body using vec4 is still a finding (isolation)");
  assert.ok(!find("let ok = uv * 8.0"), "operator arithmetic itself is NOT a finding");
  assert.ok(find('${parent.bogus}'), "invalid constraint on the shader tag IS a finding (attrs still constraint-checked)");
  assert.ok(r.constraintsChecked >= 1);
});
```

Fixture `shader-check-clean.html` — the hero example inside the standard scaffold (mirror `check-clean.html`'s shape):

```html
<laszlo-app width="400" height="300">
  <shader width="400" height="300">
    <attribute name="speed" type="number" value="1"></attribute>
    <method name="color"><script type="text/typescript">
      let n = noise.snoise2v(uv * 8.0 + time * this.speed);
      return pal.pal1(n);
    </script></method>
  </shader>
</laszlo-app>
```

`shader-check.html`: a shader whose `color()` contains `let m = uv * 8.0; let ok = uv * 8.0; return pal.pal1(m.xyz.x);` (wrong swizzle on vec2-typed m), a `noise.snoise2v(badarg, 2.0)` call, `this.notdeclared`, a `width="${parent.bogus}"` INVALID constraint on the shader tag (must produce a finding — proves shader-tag attrs still constraint-check), and a SIBLING plain `<view>` with a client `<method>` body `const vec4 leaked = 1;`-style use of `vec4` (asserting isolation).

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement:
  - `app-model.ts`: `<shader>` stays an instance (attrs/constraints walked); its `<method>` children route to `model.shaderPrograms.push({ name, uniforms: declaredAttrs, color, helpers })` via `rawBody` (the walkServer pattern) INSTEAD of `collectBody`. Gate: inside the instance child loop, `if (t === "method" && tagIs("shader")) { …raw collect…; continue; }` before the normal method branch.
  - `lzx-check.ts`: after the server block, a shader block: for each shader program, run bodies through `rewriteOperators`, wrap as functions (uniform-typed `this` → a `__uniforms`-style declared const per tag; helpers with annotated params), build virtual files `[shader.d.ts (genShaderDts + shaderlib signatures + per-tag uniforms), __lzshaderbodies.ts]`, `ts.createProgram`, map diagnostics through the composed span map (operator-rewrite line map ∘ BodySpan). Report `shaderBodiesChecked`.
  - ALSO run `generateShader` per tag and surface its findings (dialect violations TS can't see) — one code path shared with Task 5's emission.
- [ ] **Step 4:** `npm test` green. **Step 5:** Commit: `compiler: shader bodies check in their own program (operator-rewrite pre-pass, hero canary, both-way isolation)`

---

### Task 5: Routing — domsource strip + injected glslGen + attribute embedding

**Files:**
- Modify: `compiler/src/domsource.ts` (shader subtree handling), `compiler/src/browser.ts` (thread `opts.glslGen` if opts flow through it), NEW bundle entry `compiler/src/lzts-entry.ts` (re-exports ts-carrier's surface + exports `glslGen` built from glsl-gen + the EMBEDDED shaderlib) + `compiler/package.json` `bundle:lzts` script pointed at `dist/lzts-entry.js` (today it bundles `dist/ts-carrier.js` directly — ts-carrier.ts itself stays untouched; the invariant becomes: typescript-importing modules live ONLY in the lzts bundle graph + dev-time lzx-check, never lzc-browser), `startup/laszlo-dom.js` (pass `glslGen` alongside `transpileTs`)
- Test: `compiler/test/shader-domsource.test.mjs` + rebuild dist/bundles

- [ ] **Step 1: Failing test:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem } from "../dist/domsource.js";      // match the actual export (see domsource.test.mjs)
import { makeDom } from "./helpers/fakedom.mjs";           // match existing domsource tests' DOM helper
import { generateShader } from "../dist/glsl-gen.js";
import { loadShaderlib } from "../dist/shaderlib-port.js";

const APP = `<laszlo-app width="200" height="100">
  <shader width="200" height="100">
    <attribute name="speed" type="number" value="1"></attribute>
    <method name="color"><script type="text/typescript">
      return vec4(uv * this.speed, 0.0, 1.0);
    </script></method>
  </shader>
</laszlo-app>`;

test("domsource: shader methods stripped, shaderprogram attr stamped, JSON survives", () => {
  const { root } = makeDom(APP);                           // adapt to the existing helper API
  const lib = loadShaderlib();
  const xml = domToXmlElem(root, { transpileTs: (c) => c,  // no-op ts for the test
    glslGen: (input) => generateShader({ ...input, shaderlib: lib }) });
  const shader = xml.children.find(c => c.name === "shader");
  assert.ok(shader, "shader instance kept");
  assert.ok(!shader.children.some(c => c.name === "method"), "method carriers stripped");
  const prog = JSON.parse(shader.attrs.shaderprogram);
  assert.match(prog.glsl, /^precision mediump float;/);
  assert.match(prog.glsl, /uniform float speed;/);
  assert.deepEqual(prog.uniforms, [{ name: "speed", glslType: "float" }]);
});

test("domsource: generation findings become dialect errors; no glslGen provided → clear error", () => {
  const bad = APP.replace("return vec4(uv * this.speed, 0.0, 1.0);", "const s = 'nope'; return s;");
  const { root } = makeDom(bad);
  assert.throws(() => domToXmlElem(root, { transpileTs: (c) => c, glslGen: (i) => generateShader(i) }),
    /string|dialect/i);
  const { root: r2 } = makeDom(APP);
  assert.throws(() => domToXmlElem(r2, { transpileTs: (c) => c }), /glslGen/);
});
```
(Adapt import names/DOM helper to the existing `domsource.test.mjs` conventions at execution — the assertions are normative, the scaffolding follows the house style.)

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement in `domsource.ts`, modeled on the `<server>` branch: when the walk enters a `<shader>` element, collect `<attribute>` decls (name/type) and `<method>` carriers RAW (color + helpers with parsed `args`), call `ctx.opts.glslGen({ color, helpers, uniforms })`; `ok:false` → `DomDialectError` with the findings' first message + line; `ok:true` → stamp `shaderprogram` attr with `JSON.stringify(program)` and drop the method children (the `<attribute>` children stay — declarations compile normally). Missing `opts.glslGen` with a `<shader>` present → clear `DomDialectError`. Wire the option through `compileInBrowser`/`checkApp` callers: `lz-ts.js` entry exports a `glslGen` built from its bundled typescript + the shaderlib port; `laszlo-dom.js` passes it; lzx-check constructs it directly.
- [ ] **Step 4:** `npm run dist` (bundles now include glsl-gen + shaderlib in the LZ-TS bundle ONLY — verify `lzc-browser.js` did not grow typescript: byte-compare or grep). Full `npm test` green. **Step 5:** Commit: `compiler: <shader> routing — carriers stripped pre-compile, injected glslGen, JSON program attribute (compile.ts untouched)`

---

### Task 6: Runtime `<shader>` + validation page + demo

**Files:**
- Create: `runtime/components/extensions/webgl-quad.js` (UMD, pure-ish GL boilerplate: compile/link, quad, uniform setters, context-loss re-init; injectable gl for the one node-testable pure part — uniform table → setter plan)
- Create: `runtime/components/extensions/shader.lzx` (`<class name="shader" extends="view">`). MUST declare `<attribute name="shaderprogram" type="string" value=""/>` — the type annotation is load-bearing: an UNTYPED declaration compiles authored values as "expression" and the stamped JSON would emit as a raw object literal (compile.ts:2895-2908), breaking JSON.parse; `type="string"` routes through jsString. Empty default doubles as the frozen-.lzx-path "absent" detection.
- Modify: `runtime/lzx-autoincludes.properties` (+`shader: extensions/shader.lzx`)
- Create: `examples/dom-authoring/shader-demo.html` (hero noise/palette surface + `<slider>`-bound `speed`; the slider instance REDECLARES `<attribute name="value" type="number" value="1"/>` so the `${sl.value}` constraint typechecks — lzx-check types unknown component tags as closed LzView; if redeclaration trips other checks, fall back to a click-stepper view and record the deviation), `examples/dom-authoring/shader-validate.html` (self-checking: compiles the emitted shaderlib + demo shaders via `gl.compileShader`, renders a pass/fail table — the browser-side conformance gate the spec demands, runnable by the user)
- Test: `compiler/test/shader-runtime.test.mjs` (pure parts: uniform plan mapping number/color→float/vec3 incl. 24-bit normalize; plus a compile-level test that the demo app compiles via checkApp/domsource clean)

- [ ] **Step 1: Failing test** (uniform plan + demo-clean):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";
const require = createRequire(import.meta.url);
const Q = require("../../runtime/components/extensions/webgl-quad.js");

test("uniform plan: lz values → GL setter plan", () => {
  const plan = Q.uniformPlan([{ name: "speed", glslType: "float" }, { name: "tint", glslType: "vec3" }]);
  assert.deepEqual(plan.speed.kind, "1f");
  assert.deepEqual(plan.tint.kind, "3f");
  assert.deepEqual(Q.lzColorToVec3(0xff8000).map(v => Math.round(v * 100) / 100), [1, 0.5, 0]);
});

test("the shader demo checks clean end-to-end", () => {
  const r = checkApp(readFileSync(new URL("../../examples/dom-authoring/shader-demo.html", import.meta.url), "utf8"),
    "shader-demo.html");
  assert.deepEqual(r.findings.map(f => f.message), []);
});
```

- [ ] **Step 2:** Implement `webgl-quad.js` (UMD like flex-adapter): `init(canvas, glsl)` → `{gl, program, setUniform(name, kind, value), draw(), dispose()}`; static vertex shader (`attribute vec2 pos; varying vec2 uv; …`); context-lost/restored hooks; returns null (with reason) when WebGL unavailable; **on compile/link failure logs the generated source + infoLog ONCE and returns null** (spec's driver-variance path → bgcolor fallback).
- [ ] **Step 3:** Implement `shader.lzx` per the spec's Runtime section: parse `this.shaderprogram` (absent/empty → one `Debug.warn` + bgcolor fallback — the frozen-path story), create canvas in `this.sprite.__LZdiv` (DPR-aware), init quad, per-uniform `on<attr>` delegates (LzDelegate) setting via the plan + coalesced rAF render, `usesTime` → visibility-gated rAF loop, `usesMouse` → pointermove, `onwidth/onheight` resize. `<script src="webgl-quad.js"/>` include; autoincludes entry.
- [ ] **Step 4:** Demo + validation page. Demo authoring mirrors flex-demo conventions (laszlo-dom module script; `<slider>` if available in the dialect, else a click-stepper view like counter-app). Validation page: plain JS, no LFC — fetches nothing, embeds the emitted GLSL of (a) each demo shader (author them inline via lz-ts's exported glslGen in the page) or (b) simplest: a `<laszlo-app>` with several `<shader>` tags exercising noise/shape/pal/color/math, plus a plain-JS footer that finds every canvas's compiled program status. Keep it simple and honest: it must render PASS/FAIL text per shader without user interpretation.
- [ ] **Step 5:** `npm test` green; `node compiler/dist/lzx-check.js examples/dom-authoring/shader-demo.html` → OK. **Step 6:** Spec status → implemented (record: browser conformance pass = user runs shader-validate.html + demo — no automation available; the signature table's docs consumer is deferred to follow-up). Commit: `components+examples: <shader> runtime, webgl-quad, demo + self-checking validation page; spec status`

## Execution notes

- Task order is strict (2 needs 1; 3 needs 2; 4 needs 1-3; 5 needs 2-3; 6 needs 5).
- If glsl-gen corner cases stall (precedence/casting), consult `/tmp/dreemgl/system/base/glslgen.js` — the reference implementation — before inventing rules.
- Record every deviation in commit messages; the spec status edit summarizes them at the end.
