// compile.mjs — the LZX→JS compiler interface (swappable backend).
//
// As of the SERVER-track packaging work this is a thin SHIM over the TS-first adapter in
// openlaszlo/compiler/index.mjs: it tries the byte-exact TypeScript compiler (closure
// cache + ETag) and falls back to the Java 4.9 oracle (compiler/oracle.mjs) for debug
// builds, unsupported constructs, or apps needing sprite-montage generation.
//
//   compile(lzxAbsPath, {debug, lpsHome}) -> { siteDir, base, hash, backend, tag, cached }
//
// `compile` is now ASYNC (the TS path imports an ESM module + a disk cache). `backend`
// reports which compiler served ("ts" | "oracle"); `tag` is the ETag (TS path); `cached`
// is true on a TS closure-cache hit. The shape is otherwise unchanged so index.mjs's
// mount/serve logic is untouched.

export { compile, DIST, CACHE, WEBAPP, SCRATCH } from "../compiler/server-api.mjs";
