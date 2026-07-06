# `<shader>` — Typed GPU Leaf View (Slice 7)

**Date:** 2026-07-06 (rev 2 — adversarial review findings applied: the
typing model is redesigned around a generator-owned type lattice, the
shaderlib becomes a curated port, and the GLSL preamble/embedding/client-
program gaps are closed)
**Status:** Approved design, pre-implementation
**Builds on:** Slices 1–4. Shader bodies check in their own
`ts.createProgram` — the same isolation the bus spec establishes for server
bodies (realtime-bus spec, "Checker integration": a separate *program*, not
a separate file, is the boundary); if the bus slice hasn't landed, this
slice introduces the mechanism.
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
validator tests exist.)

## The typing model (load-bearing section, redesigned in rev 2)

TypeScript has no operator overloading: `uv * 8.0` on an interface-typed
`vec2` is TS2363, so rev 1's "`ts.TypeChecker` answers every type question /
TS diagnostics ARE the findings" was unimplementable. The redesign:

1. **The generator owns expression typing.** `glsl-gen.ts` infers over a
   small closed lattice — `float`, `vec2/3/4`, `bool`, `bvec2/3/4`, `int`
   (loop counters only) — exactly what dreemgl's glslgen does, implemented
   fresh over the TS AST with glslgen.js as the reference for operator,
   precedence, promotion, and casting rules. Component-wise `vec ∘ vec`,
   `vec ∘ float` promotion, comparisons yielding `bool`, `lessThan`-family
   builtins yielding `bvec`. Declaration types come from one table: the
   built-ins, the tag's attributes (uniforms), shaderlib signatures, and
   helper-method signatures.
2. **Emission needs no TypeChecker.** The lattice plus that table fully
   type the dialect. Consequence: the in-browser compile path stays lean —
   no `ts.createProgram` in `lzc-browser.js`, and `ts-carrier.ts`'s
   "only module that imports typescript, transpileModule only" invariant
   survives intact. (Rev 1 silently broke it.)
3. **lzx-check layers a real TS program on top (dev-time only).** A
   separate `ts.createProgram` whose virtual files are: a **generated**
   `shader.d.ts` (the swizzle surface is combinatorial — hundreds of
   settable properties across the xyzw/rgba/stpq alphabets — so the file is
   emitted by a build script, never hand-written), the shaderlib
   signatures, the per-tag uniform/helper declarations, and the wrapped
   bodies. **Curated suppressions:** operator diagnostics (TS2362/2363/
   2365) are suppressed — the generator re-performs those checks from its
   lattice — following the Slice-2 precedent of the targeted TS2304
   with(this) suppression. Everything else stands: unresolved identifiers,
   unknown properties/swizzles, call-signature and arity errors, undeclared
   `this.<uniform>` refs.
4. **Findings = TS diagnostics (minus suppressions) ∪ generator findings**
   (dialect violations, lattice type mismatches, GLSL-specific rules).
   "One definition": `shader.d.ts` and the generator's declaration table
   are both emitted from the same source-of-truth signature table, so they
   cannot drift.

## Authoring surface

- **`color()` is the required entry point**, returning `vec4`. Additional
  `<method>`s become GLSL helper functions (typed params: vec/float/bool).
- **Built-ins** (bare identifiers): `uv: vec2` (0–1), `time: float`
  (seconds), `mouse: vec2` (0–1), `size: vec2` (px).
- **Uniforms are `this.<attr>`**: declared `<attribute>`s referenced in a
  body join the uniform table. `type="number"` → `float`; `type="color"` →
  `vec3` (normalized 24-bit LZX color). Undeclared `this.foo` is a finding.
- **Shaderlib namespaces** (pinned; dreemgl's `colorlib` renamed):
  `noise.*`, `shape.*`, `pal.*`, `color.*`, `math.*`.

## The dialect

Allowed: `let`/`const`; **assignment and compound assignment** (`x = `,
`+=`, `*=`, …) including **swizzle lvalues** (`g.yz = …`, `p.xyz *= …`);
arithmetic/comparison/ternary; `if`/`else`; bounded `for`; swizzle reads in
all three alphabets and arbitrary orders; calls to built-ins/shaderlib/
helpers; `return`. (Rev 1 omitted assignment entirely — the shaderlib is
full of it.)

Findings: closures, arrays, objects, strings, template literals, recursion,
`new`, `try`, `while`, spread, destructuring; **swizzle writes with repeated
components** (`v.xx = …` — legal TS property access, illegal GLSL; a
generator finding); `%` on floats (GLSL ES has none; `math.mod` exists).

GLSL-specific emission rules (golden-tested):
- **Precision preamble:** every fragment shader begins
  `precision mediump float;` — GLSL ES 1.00 has **no default float
  precision** in fragment shaders; without this nothing compiles anywhere.
  (Rev 1 omitted it.) `highp` opt-in is future room.
- Numeric literals emit as floats (`1` → `1.0`); integer `for` counters
  emit as `int`, with `float(i)` casts inserted where the counter meets
  float arithmetic.
- **Loop bounds must be literal constants** (ES 1.00 Appendix A);
  a `this.<uniform>` bound is a finding.
- Zero-argument constructor calls (`vec3()`) are findings with a fixit
  (`vec3(0.0)`) — GLSL constructors require arguments.
- No `#extension` support in v1 (see Shaderlib exclusions).

## Compiler: `compiler/src/glsl-gen.ts` (new, pure)

- Input: the tag's method bodies as TS AST (`ts.createSourceFile` — parser
  only, no program), the attribute declarations, the shaderlib signature
  table. Output per tag: `{glslSource, uniforms:[{name, glslType, lzType}],
  usesTime, usesMouse}`. The vertex shader is a fixed quad (static string).
- **Routing and embedding (rev 1 left this unspecified; the naive routes
  are broken):** `domsource.ts` must tag carriers inside a `<shader>`
  subtree so (a) they are **not** fed to the normal `transpileTs` path —
  otherwise a type-stripped `color()` referencing undefined `vec4` ships in
  the app JS — and (b) the client-program body walk **skips shader-tag
  bodies** (`extractApp` currently collects every instance `<method>` body;
  `shader` joins a NON_INSTANCE-style skip). The emitted program object
  travels **inside the generated instance JS as a JSON literal** (the same
  channel method bodies are emitted through), never as an XmlElem attribute
  value — attribute transport would normalize the GLSL's newlines away
  (`domsource.ts` CR/LF→space). Exact emission seam pinned at plan time;
  the two requirements above are normative.
- **Call-graph pruning:** emitted GLSL includes only shaderlib/helper
  functions reachable from `color()`, resolved through namespace-qualified
  calls and the constant table.

## Shaderlib: a curated port, not a translation

Review inventory: the five libs are AMD-wrapped (`define(function(require,
exports){…})`), use `var`, chained export aliases, `this.`-method
intra-lib calls (`this.hue2rgb`), string macro-constants
(`this.PI = '3.14…'`) consumed cross-lib by bare name, texture-dependent
functions, extension-dependent derivatives, and three outright upstream
bugs. "All five libs transpile finding-free" (rev 1) was false. Instead:

- **One-time curated port** into `compiler/shaderlib/` as dialect-clean TS
  sources: AMD unwrapped, `var`→`let`, alias chains split, `this.`-calls →
  namespace calls, string constants → typed `const` floats. The generator
  validates the **port** (that's the test), and the port is the thing we
  maintain.
- **Excluded from v1:** palettelib's texture-based functions (5 of 14 —
  textures are a non-goal), `shape.drawField` (needs
  `GL_OES_standard_derivatives`; no `#extension` support in v1),
  `math.odd`/`even` in their string-returning form (ported as
  `bool`-returning).
- **Upstream bugs fixed in the port, documented:** `noise.snoise2`
  references an undefined `z` (dropped in favor of `snoise2v`);
  `shape.length2`/`length8` call functions defined nowhere in dreemgl
  (dropped); `shape.circle` is defined twice with different signatures
  (the field-returning one survives, renamed apart).
- The port's signature table is the single source for `shader.d.ts`, the
  generator's declaration table, and the docs.

## Checker integration

Shader bodies check in their own `ts.createProgram` (isolation is
program-level; ambient globals are program-wide): generated `shader.d.ts` +
shaderlib signatures + per-tag uniform types — no `lfc.d.ts`, no DOM, no
Node. Suppression list as specified in the typing model. The client program
is touched in exactly one way: it **skips** shader-tag bodies (and a test
pins that a client body using `vec4` is still a finding — isolation both
ways). Span-mapping reuses the Slice-2 `BodySpan` machinery.

## Runtime: `runtime/components/extensions/shader.lzx`

Registered in autoincludes (fetched at runtime by the browser compiler — no
bundle rebuild). Modeled on drawview's *placement* (a dhtml-runtime
extension component) — but note honestly: drawview is an ES4 `dynamic
class … extends LzView` inside `<switch><when runtime="dhtml">`, the
sprite's canvas helper is hardcoded to 2D, and there is no DPR precedent;
the canvas/GL code here is new, not inherited.

- **Init:** create a `<canvas>` in `sprite.__LZdiv`, DPR-aware sizing,
  WebGL1 context, compile the precompiled GLSL (~150 lines of fresh quad
  boilerplate), bind the quad, set initial uniforms, render.
- **Uniform updates:** per table entry, an `on<attr>` delegate
  (`new LzDelegate(this, …)` — the standard component pattern) sets the
  uniform and schedules a coalesced render on the next animation frame.
- **Time/mouse:** `usesTime` → rAF loop gated on tab and view visibility;
  `usesMouse` → pointermove on the canvas, normalized.
- **Resize:** `onwidth`/`onheight` delegates resize canvas + viewport,
  update `size`, render.

## Error handling

- Dialect violations and type errors: compile-time findings (span-mapped).
- Runtime GLSL compile/link failure (driver variance): log the generated
  source + info log once; the view falls back to its `bgcolor`.
- No WebGL: same fallback, one console warning.
- `webglcontextlost`/`restored`: recompile and re-render on restore.
- A `<shader>` compiled through a path that produced no program (e.g. the
  frozen `.lzx`-text path): runtime detects the missing generated program
  and falls back with one warning.

## Testing

1. **Unit (glsl-gen)** — golden GLSL per dialect feature (arithmetic
   promotion, swizzle reads/writes, ternary, if, int-counter for with
   `float(i)` casts, helpers, uniforms, precision preamble present); a
   finding test per rejected construct (incl. repeated-component swizzle
   write, uniform loop bound, zero-arg constructor); call-graph pruning
   incl. cross-lib constants.
2. **Shaderlib port** — the curated port transpiles finding-free; a
   Playwright harness `gl.compileShader`s the emitted library and every
   demo shader asserting `COMPILE_STATUS`. (Honest framing: headless CI is
   ANGLE/SwiftShader — a strict, consistent ES 1.00 validator, which is
   the deployment reality for Chrome anyway; it is *conformance* testing,
   not driver-variance testing.)
3. **Checker** — unresolved identifier, unknown swizzle, call-arity,
   undeclared `this.<uniform>` findings; operator expressions produce NO
   TS findings (suppression works) while a lattice mismatch (`vec2 +
   vec3`) IS a generator finding; a client body using `vec4` is still a
   finding.
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
