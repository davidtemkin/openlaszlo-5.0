# `<shader>` — Typed GPU Leaf View (Slice 7)

**Date:** 2026-07-06 (rev 3 — round-2 review applied: operator-rewrite
pre-pass replaces diagnostic suppression, the signature table is scoped to
include GLSL intrinsics and constructor rules, the client-program gate is
body-only, the emission seam names its parity cost)
**Status:** Implemented — 2026-07-06 (branch dom-authoring-slice7; 157 tests green
incl. hero canary end-to-end, 12-case validation battery, curated-port
transpiles-finding-free). Deviations: routing needed ZERO compile.ts changes
(domsource strips carriers + stamps a JSON shaderprogram attribute; glslGen
injected like transpileTs via a new lzts-entry bundle entry); helper params
typed inline in args="p: vec2" + returns= attr; shaderlib deferred bits:
cell3w, math macro-constants (documented in port headers); signature-table
docs consumer deferred. Browser conformance pass = user opens
examples/dom-authoring/shader-validate.html (ALL PASS expected) + the demo —
no browser automation available in the implementing environment.
**Builds on:** Slices 1–4. Shader bodies check in their own
`ts.createProgram` — the same isolation the bus spec establishes for server
bodies (realtime-bus spec, "Checker integration": a separate *program*, not
a separate file, is the boundary; adjudicated in round 2 — the pattern is
specced there); if the bus slice hasn't landed, this slice introduces the
mechanism.
**Influences:** dreemgl's JS→GLSL stack (`system/base/glslgen.js`) as the
*reference implementation* for inference/casting rules — not vendored — and
its shaderlib (`system/shaderlib/`, 882 lines, Apache 2.0 as part of the
dreemgl repo; NOTICE propagated per Apache §4(d)), which is ported —
**curated, not mechanically translated** (see Shaderlib).

## Goal

A view whose surface is a fragment shader, authored in the same TypeScript
carriers as everything else, with the view's declared attributes bound as
uniforms — so `${}` constraints (and bus deltas, once connected) animate
shaders with zero extra machinery. And typed: wrong-typed shader code is an
lzx-check finding before the GL driver ever sees it.

```html
<shader width="400" height="300">
  <attribute name="speed" type="number" value="1"></attribute>
  <method name="color"><script type="text/typescript">
    let n = noise.snoise2v(uv * 8.0 + time * this.speed);
    return pal.pal1(n);
  </script></method>
</shader>
```

(`pal.pal1` returns `vec4`; rev 1's `vec4(pal.pal1(n), 1.0)` was itself a
GLSL arity error — caught in review, kept here as a reminder of why the
validator tests exist. This example is also a normative checker test: it
must check **finding-free end-to-end** — rev 2's design failed on exactly
this line.)

## The typing model (load-bearing section)

TypeScript has no operator overloading: `uv * 8.0` on an interface-typed
`vec2` is TS2363. Rev 2 tried suppressing the operator diagnostics; round 2
showed that suppression hides the *diagnostic* but not the *inferred type* —
`uv * 8.0` still infers `number`, so every downstream use produces false
findings (`.xy` on number → TS2339; passing to `snoise2v` → TS2345), and
vec `+` infers an error type that silently *disables* downstream checking.
The rev 3 design:

1. **The generator owns expression typing (unchanged from rev 2).**
   `glsl-gen.ts` infers over a small closed lattice — `float`, `vec2/3/4`,
   `bool`, `bvec2/3/4`, `int` (loop counters only) — implemented fresh over
   the TS AST with dreemgl's glslgen.js as the reference for operator,
   precedence, promotion, and casting rules. Declaration types come from
   the signature table (below).
2. **Emission needs no TypeChecker.** The lattice plus the table fully
   type the dialect. The in-browser compile path stays lean — no
   `ts.createProgram` in `lzc-browser.js`; `ts-carrier.ts`'s
   transpileModule-only bundling invariant survives.
3. **lzx-check layers a real TS program on top (dev-time only) — via an
   operator-rewrite pre-pass, not suppressions.** Before bodies are
   wrapped into the shader program, arithmetic, compound-assignment, and
   unary-negation nodes are rewritten into calls to ambient intrinsics —
   `__mul(a,b)`, `__add`, `__sub`, `__div`, `__neg`, … — whose **full
   overload sets** (`(vec2, float): vec2`, `(float, vec2): vec2`,
   `(vec2, vec2): vec2`, `(float, float): float`, …) are generated from
   the signature table. Consequences: no operator diagnostics to suppress;
   `vec2 + vec3` is a true no-matching-overload finding; inferred types
   downstream are correct vecs, so property/call/assignment diagnostics
   are trustworthy — the hero example checks clean and `let m = uv * 8.0;
   m.xyz` is a true finding. Cost, stated: the rewrite shifts source
   offsets, so span mapping gains a per-body second layer (rewrite-map
   composed with the Slice-2 `BodySpan` map) or uses position-preserving
   emission; the plan picks one.
4. **Findings = TS diagnostics over the rewritten program ∪ generator
   findings** (dialect violations, GLSL-specific rules). "One definition":
   `shader.d.ts`, the operator-intrinsic overloads, and the generator's
   lattice/declaration table are all emitted from the **signature table**,
   the single source of truth.

## The signature table

One generated artifact feeding four consumers (`shader.d.ts`, the operator
intrinsics, the generator's lattice, the docs). Its scope (round 2 caught
rev 2 never defining it):

- **Types:** `float`, `vec2/3/4` with the full swizzle surface (all
  lengths and orders across xyzw/rgba/stpq — ~1,470 settable properties on
  the vec types combined; generated, never hand-written; repeated-component
  properties emitted `readonly` so illegal writes like `v.xx = …` are true
  TS findings rather than generator work), `bool`, `bvec2/3/4`, `int`.
- **GLSL ES 1.00 intrinsic functions with their genType/scalar overloads**
  — the curated port alone needs ~22: `mod`, `floor`, `fract`, `abs`,
  `dot`, `cross`, `length`, `distance`, `normalize`, `min`, `max`,
  `clamp`, `mix`, `step`, `smoothstep`, `sqrt`, `pow`, `exp`, `log`,
  `sin`, `cos`, `sign`, plus the `lessThan`-family comparisons (→ bvec)
  and `any`/`all`. Overload resolution covers the scalar-second forms
  (`max(vec3, 0.0)`, `clamp(vec4, 0.0, 1.0)`, `mod(vec3, 289.0)`).
- **Vec constructor rules:** component-count summation
  (`vec4(x.xy, y.xy)`, `vec4(v3, 1.0)`), scalar broadcast (`vec2(0.5)`,
  `vec3(j)`), bvec→float conversion (`vec4(lessThan(p, vec4(0.0)))`).
  Zero-argument constructors are findings with a fixit (`vec3(0.0)`).
- **Built-in variables:** `uv: vec2` (0–1), `time: float` (seconds),
  `mouse: vec2` (0–1), `size: vec2` (px).
- **Shaderlib signatures** (from the curated port) and per-tag uniform/
  helper declarations.

## Authoring surface

- **`color()` is the required entry point**, returning `vec4`. Additional
  `<method>`s become GLSL helper functions (typed params: vec/float/bool).
- **Uniforms are `this.<attr>`**: declared `<attribute>`s referenced in a
  body join the uniform table. `type="number"` → `float`; `type="color"` →
  `vec3` (normalized 24-bit LZX color). Undeclared `this.foo` is a finding.
- **Shaderlib namespaces** (pinned; dreemgl's `colorlib` renamed):
  `noise.*`, `shape.*`, `pal.*`, `color.*`, `math.*`.

## The dialect

Allowed: `let`/`const`; assignment, **chained assignment** (`r = g = b =
l` — assignment is an expression in GLSL too), and compound assignment
including **swizzle lvalues** (`g.yz = …`, `p.xyz *= …`); arithmetic,
unary minus, comparison, ternary; **logical `&&`/`||`/`!`** (rev 2 omitted
them; shapelib uses them); `if`/`else`; bounded `for`; swizzle reads in
all alphabets and orders; calls to intrinsics/shaderlib/helpers; `return`.

Findings: closures, arrays, objects, strings, template literals,
recursion, `new`, `try`, `while`, spread, destructuring; swizzle writes
with repeated components (readonly in the d.ts — a true TS finding); `%`
on floats (GLSL ES has none; `mod` exists).

GLSL-specific emission rules (golden-tested):
- **Precision preamble:** every fragment shader begins
  `precision mediump float;` — GLSL ES 1.00 fragment shaders have no
  default float precision; without it nothing compiles anywhere. `highp`
  opt-in is future room.
- Numeric literals emit as floats (`1` → `1.0`); integer `for` counters
  emit as `int`, with `float(i)` casts inserted where the counter meets
  float arithmetic.
- **Loop bounds must be literal constants** (ES 1.00 Appendix A); a
  `this.<uniform>` bound is a finding.
- No `#extension` support in v1 (see Shaderlib exclusions).

## Compiler: `compiler/src/glsl-gen.ts` (new, pure)

- Input: the tag's method bodies as TS AST (`ts.createSourceFile` — parser
  only), the attribute declarations, the signature table. Output per tag:
  `{glslSource, uniforms:[{name, glslType, lzType}], usesTime, usesMouse}`.
  The vertex shader is a fixed quad (static string).
- **Routing (normative requirements; exact seam pinned at plan time):**
  (a) carriers inside a `<shader>` subtree are **not** fed to the normal
  `transpileTs` path — a type-stripped `color()` referencing undefined
  `vec4` must never ship in the app JS; (b) the client checker program
  gates **method-body collection only**: the shader tag remains a full
  instance in the model — attrs, id/name registration, and `${}`
  constraint checking on its markup attributes all stay (round 2: a
  NON_INSTANCE-style prune would have unchecked the demo's own
  slider-bound `speed`); (c) the program object travels **JSON-escaped**
  — the rule is "no *raw* GLSL in XmlElem attribute transport" (the
  CR/LF→space normalization), and a JSON string literal survives
  normalization, so either the generated-JS channel or an escaped
  attribute is acceptable; (d) the seam touches `compile.ts` (generated
  instance JS is its `BuiltNode` emission) — **the oracle-parity-guarded
  file**; the plan budgets for guard-proving that `.lzx`-text output is
  byte-identical, as Slices 1–2 did.
- **Call-graph pruning:** emitted GLSL includes only shaderlib/helper
  functions reachable from `color()`, resolved through namespace-qualified
  calls, intra-lib bare-name calls (the port qualifies them), and the
  constant table.

## Shaderlib: a curated port, not a translation

Round-1 inventory: the five libs are AMD-wrapped, use `var`, chained
export aliases, `this.`-method and bare-name intra-lib calls, string
macro-constants consumed cross-lib, texture-dependent functions,
extension-dependent derivatives, and upstream bugs. So:

- **One-time curated port** into `compiler/shaderlib/` as dialect-clean TS
  sources: AMD unwrapped, `var`→`let`, alias chains split, `this.`-calls
  and bare intra-lib calls → namespace-qualified calls, string constants
  (`this.PI = '3.14…'`) → typed `const` floats. The generator validates
  the **port** (that is the test), and the port is what we maintain.
- **Excluded from v1:** palettelib's texture-based functions (5 of **16**
  — textures are a non-goal), `shape.drawField` (needs
  `GL_OES_standard_derivatives`; no `#extension` in v1).
- **Ported with corrections, documented:** `noise.snoise2` references an
  undefined `z` (dropped in favor of `snoise2v`); `shape.sdTorus82`/
  `sdTorus88` call `length2`/`length8`, which are defined **nowhere** in
  dreemgl (both torus functions dropped — rev 2 misnamed the drop targets
  as `length2`/`length8` themselves); `shape.circle` is defined twice with
  different signatures (the field-returning one survives, renamed apart);
  `math.odd`/`even` return booleans upstream (rev 2 said strings — wrong
  file trait; they port as `bool`-returning unchanged).
- The port's signature table entries feed the single source of truth.

## Checker integration

Shader bodies check in their own `ts.createProgram` (isolation is
program-level; ambient globals are program-wide): generated `shader.d.ts`
+ operator intrinsics + shaderlib signatures + per-tag uniform types — no
`lfc.d.ts`, no DOM, no Node. Bodies pass through the operator-rewrite
pre-pass first (typing model §3). The client program is touched in exactly
one way: it skips shader-tag **method bodies** (and a test pins that a
client body using `vec4` is still a finding — isolation both ways).
Span-mapping composes the rewrite map with the Slice-2 `BodySpan`
machinery.

## Runtime: `runtime/components/extensions/shader.lzx`

Registered in autoincludes (fetched at runtime by the browser compiler —
no bundle rebuild). Modeled on drawview's *placement* (a dhtml-runtime
extension component) — noting honestly: drawview is an ES4 `dynamic class
… extends LzView` inside `<switch><when runtime="dhtml">`, the sprite's
canvas helper is hardcoded to 2D, and there is no DPR precedent; the
canvas/GL code here is new, not inherited.

- **Init:** create a `<canvas>` in `sprite.__LZdiv`, DPR-aware sizing,
  WebGL1 context, compile the precompiled GLSL (~150 lines of fresh quad
  boilerplate), bind the quad, set initial uniforms, render.
- **Uniform updates:** per table entry, an `on<attr>` delegate
  (`new LzDelegate(this, …)` — the standard component pattern) sets the
  uniform and schedules a coalesced render on the next animation frame —
  this is what makes constraints and bus deltas animate shaders.
- **Time/mouse:** `usesTime` → rAF loop gated on tab and view visibility;
  `usesMouse` → pointermove on the canvas, normalized.
- **Resize:** `onwidth`/`onheight` delegates resize canvas + viewport,
  update `size`, render.

## Error handling

- Dialect violations and type errors: compile-time findings (span-mapped
  through the rewrite map).
- Runtime GLSL compile/link failure (driver variance): log the generated
  source + info log once; the view falls back to its `bgcolor`.
- No WebGL: same fallback, one console warning.
- `webglcontextlost`/`restored`: recompile and re-render on restore.
- A `<shader>` compiled through a path that produced no program (e.g. the
  frozen `.lzx`-text path): runtime detects the missing generated program
  and falls back with one warning.

## Testing

1. **Unit (glsl-gen)** — golden GLSL per dialect feature (arithmetic
   promotion, swizzle reads/writes, chained assignment, logical ops,
   ternary, if, int-counter for with `float(i)` casts, constructor
   summation/broadcast/bvec-conversion, helpers, uniforms, precision
   preamble present); a finding test per rejected construct (incl.
   repeated-component swizzle write, uniform loop bound, zero-arg
   constructor, `%` on floats); call-graph pruning incl. cross-lib
   constants and intra-lib calls.
2. **Shaderlib port** — the curated port transpiles finding-free; a
   Playwright harness `gl.compileShader`s the emitted library and every
   demo shader asserting `COMPILE_STATUS`. (Honest framing: headless CI is
   ANGLE/SwiftShader — strict, consistent ES 1.00 *conformance*
   validation, not driver-variance testing.)
3. **Checker** — **the hero example checks finding-free end-to-end** (the
   canary that failed both prior revisions); downstream-of-arithmetic
   truthfulness both ways: `let m = uv * 8.0; return pal.pal1(m.x)` clean,
   `m.xyz` a finding, `vec2 + vec3` a finding (no-matching-overload);
   unresolved identifier, unknown swizzle, call-arity, undeclared
   `this.<uniform>` findings; a client body using `vec4` still a finding;
   a `${}` constraint on a shader tag's own attribute still checked
   (the body-only gate).
4. **E2E (Playwright)** — demo renders (readPixels non-uniform); a
   slider-bound uniform changes pixels; `usesTime` animates (two frames
   differ); no-WebGL fallback shows bgcolor without errors.

## Demo

`examples/dom-authoring/shader-demo.html`: an animated noise/palette
surface with a `<slider>` constraint-bound to `speed`.

## Non-goals (v1)

Vertex/mesh shaders and instancing, textures/`sampler2D` (hence the
palettelib exclusions), `#extension` directives (hence no `drawField`),
multi-pass/render-to-texture, WebGL2, a raw-GLSL escape hatch (noted as
protocol room), `.lzx`-text-path emission, `highp` policy, shader hot
reload beyond Slice 5's page reload.
