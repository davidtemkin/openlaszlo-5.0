// Public entry — the PURE, browser-safe compiler core. No Node imports: an external
// caller supplies I/O via CompileOptions (and, for caching, a Tracker + a Probe).
// The Node conveniences (fs-backed provider, disk cache, compileFile) live in the
// "./node" entry so a browser bundle never pulls in `node:fs`.

export { compile, compileLibrary, LFC_BANNER } from "./compile.js";
export type { CompileOptions, CompileResult, ResourceInfo, FontInfo } from "./compile.js";

// Dependency-closure + cache primitives (env-agnostic — the algorithm is shared by
// the disk and browser caches; only the validator source differs).
export {
  validatorsEqual, isUpToDate, fnv1a, lookupKey, contentTag,
} from "./closure.js";
export type {
  Validator, ClosureEntry, Closure, Tracker, Probe,
} from "./closure.js";
