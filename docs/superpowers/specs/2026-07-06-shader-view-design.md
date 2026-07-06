# `<shader>` — Typed GPU Leaf View (Slice 7)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** Slices 1–4 (checker-program isolation pattern from Slice 3);
lands after Slice 6 in the stack.
**Influences:** dreemgl's JS→GLSL stack (`system/base/glslgen.js`,
`system/parse/onejsparser.js`) as the *reference implementation* — not
vendored — and its shaderlib (`system/shaderlib/{noise,shape,palette,color,
math}lib.js`, ~880 lines, Apache 2.0, attribution retained), which IS
ported.

## Goal

A view whose surface is a fragment shader, authored in the same TypeScript
carriers as everything else, with the view's declared attributes bound as
uniforms — so `${}` constraints (and bus deltas, once connected) animate
shaders with zero extra machinery. And typed: shader bodies are statically
checked by lzx-check; a wrong swizzle or a `vec3` where a `vec4` belongs is
a finding before the GL driver ever sees the source.

```html
<shader width="400" height="300">
  <attribute name="speed" type="number" value="1"></attribute>
  <method name="color"><script type="text/typescript">
    let n = noise.snoise2v(uv * 8.0 + time * this.speed);
    return vec4(pal.pal1(n), 1.0);
  </script></method>
</shader>
```

## Principles

1. **One parser tech.** GLSL is emitted from the TypeScript AST with
   `ts.TypeChecker` answering every type question — no second JS parser
   (dreemgl's 3,236-line onejsparser stays home). dreemgl's `glslgen.js` is
   the reference for operator, precedence, and casting rules.
2. **Typed or it didn't happen.** The same `shader.d.ts` that drives GLSL
   emission drives checking; the dialect a body may use and the dialect
   lzx-check accepts are one definition.
3. **Compile-time emission, lean runtime.** GLSL is generated at app compile
   (in-browser lzc or server compile); the runtime class receives a GLSL
   string + uniform table. No parser or generator ships in the component.
4. **Fragment-only v1.** One quad; `color()` over `uv`. Vertex/mesh
   shaders, textures, and multi-pass are explicit non-goals with room left.
5. **Additive.** DOM-authoring/`compileFromXml` path only — the
   `.lzx`-text path is byte-frozen and can't learn new emission (consistent
   with Slices 1–4).

## Authoring surface

- **`color()` is the required entry point**, returning `vec4` for the
  current fragment. Additional `<method>`s on the tag become GLSL helper
  functions through the same generator (typed params: vec/float).
- **Built-ins** (ambient identifiers in `shader.d.ts`): `uv: vec2` (0–1),
  `time: float` (seconds), `mouse: vec2` (0–1 over the view), `size: vec2`
  (px).
- **Uniforms are `this.<attr>`**: declared `<attribute>`s referenced in a
  shader body join the uniform table. `type="number"` → `float`;
  `type="color"` → `vec3` (normalized from the 24-bit LZX color).
  Referencing an undeclared `this.foo` is a finding.
- **Shaderlib namespaces**: `noise.*` (simplex/value noise), `shape.*`
  (distance fields), `pal.*` (palette cycling), `color.*` (HSL/HSV),
  `math.*` (rotate2d, bezier2d, …).

## The dialect

Allowed: `let`/`const` (inferred or annotated), arithmetic/comparison/
ternary, `if`/`else`, bounded `for`, swizzle property access, calls to
built-ins/shaderlib/helper methods, `return`.

Findings (span-mapped to the authored source, Slice-2 machinery): closures,
arrays, objects, strings, template literals, recursion, `new`, `try`,
`while`, spread, destructuring — anything GLSL ES 1.00 can't express.

Numeric rules (the classic corner-case zone, pinned by golden tests): all
numeric literals emit as floats (`1` → `1.0`); an integer `for` counter
(`for (let i = 0; i < 8; i++)`) emits as `int` per GLSL ES 1.00 loop
restrictions.

## Compiler: `compiler/src/glsl-gen.ts` (new, pure)

- Builds a virtual program: `shader.d.ts` (vec2/3/4 with swizzle properties,
  float ops, built-ins, shaderlib signatures) + a generated `this` type from
  the tag's declared attributes + the wrapped bodies.
- Walks each body's `ts.SourceFile`, querying `ts.TypeChecker` per
  expression, emitting GLSL ES 1.00.
- Output per tag: `{glslSource, uniforms:[{name, glslType, lzType}],
  usesTime, usesMouse}`, embedded in the compiled app as a generated
  attribute the runtime class reads. The vertex shader is a fixed quad
  (static string).
- **Shaderlib is translated once at build time**: the five dreemgl libs are
  plain dependency-free JS functions; they run through the same generator to
  produce a static GLSL function library plus a typed `shaderlib.d.ts`.
  Emission includes only functions reachable from the body's call graph
  (small programs, no dead library code).

## Checker integration

Shader bodies check in their **own `ts.createProgram`** (the Slice-3
isolation boundary — ambient globals are program-wide): `shader.d.ts` +
shaderlib + the generated uniform type, no `lfc.d.ts`, no DOM globals, no
Node globals. TS diagnostics ARE the shader findings; the generator adds
dialect findings for constructs TS accepts but GLSL can't express. Client
and server body programs are untouched; no new CLI surface.

## Runtime: `runtime/components/extensions/shader.lzx`

`<class name="shader" extends="view">` (precedent: `drawview.lzx`),
registered in autoincludes (+ routine bundle rebuild).

- **Init:** create a `<canvas>` in `sprite.__LZdiv`, DPR-aware sizing,
  WebGL1 context, compile the precompiled GLSL (~150 lines of fresh quad
  boilerplate — dreemgl's `shaderwebgl.js` is not needed), bind the quad,
  set initial uniforms, render.
- **Uniform updates:** per table entry, an `on<attr>` delegate sets the
  uniform and schedules a render on the next animation frame (coalesced) —
  this is what makes constraints and bus deltas animate shaders.
- **Time:** `usesTime` → a rAF loop gated on tab visibility
  (`visibilitychange`) and view visibility; otherwise render only on
  change. `usesMouse` → pointermove on the canvas, normalized.
- **Resize:** `onwidth`/`onheight` delegates resize canvas + viewport,
  update `size`, render.

## Error handling

- Dialect violations and type errors: compile-time findings (span-mapped).
- Runtime GLSL compile/link failure (driver variance): log the generated
  source + info log once; the view falls back to its `bgcolor`.
- No WebGL available: same fallback, one console warning.
- `webglcontextlost`/`restored`: recompile and re-render on restore.
- A `<shader>` compiled through a path that produced no program (e.g. the
  frozen `.lzx`-text path): runtime detects the missing generated attribute
  and falls back with one warning.

## Testing

1. **Unit (glsl-gen)** — golden GLSL output per dialect feature
   (arithmetic, swizzles, ternary, if, int-counter for, helper functions,
   uniform refs, float literal emission); a finding test per rejected
   construct; call-graph pruning of the library.
2. **Shaderlib translation** — all five libs transpile finding-free; a
   Playwright harness `gl.compileShader`s the emitted library and every
   demo shader and asserts `COMPILE_STATUS` — the browser is the GLSL
   validator (no native tooling added).
3. **Checker** — wrong swizzle, vec-arity mismatch, undeclared
   `this.<uniform>` findings; a client body using `vec4` is still a finding
   (program isolation both ways).
4. **E2E (Playwright)** — the demo renders (readPixels: non-uniform
   output); a slider-bound uniform changes pixels; `usesTime` animates (two
   frames differ); no-WebGL fallback (context creation stubbed to null)
   shows bgcolor without errors.

## Demo

`examples/dom-authoring/shader-demo.html`: an animated noise/palette surface
with a `<slider>` constraint-bound to `speed`.

## Non-goals (v1)

Vertex/mesh shaders and instancing (fragment-only surface is
forward-compatible), textures/`sampler2D` (no image inputs yet — the
biggest stated omission), multi-pass/render-to-texture, WebGL2, a raw-GLSL
escape hatch (`<script type="x-glsl">` noted as protocol room, not built),
`.lzx`-text-path emission, shader hot reload beyond Slice 5's page reload.
