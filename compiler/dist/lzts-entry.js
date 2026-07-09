// lzts-entry.ts — the lz-ts.js bundle entry. Re-exports ts-carrier's transpile surface
// (ts-carrier.ts itself stays untouched) and adds the <shader> GLSL generator with the
// EMBEDDED shaderlib (shaderlib-sources.ts — no fs in the browser). The typescript
// package lives ONLY in this bundle graph + dev-time lzx-check, never lzc-browser.
export * from "./ts-carrier.js";
import { generateShader } from "./glsl-gen.js";
import { loadShaderlib } from "./shaderlib-port.js";
/** domsource's injectable <shader> generator (spec 2026-07-06-shader-view-design.md). */
export function glslGen(input) {
    return generateShader({ ...input, shaderlib: loadShaderlib() });
}
