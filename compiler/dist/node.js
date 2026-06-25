// Node entry — the pure core PLUS the filesystem provider, disk cache, and the
// compileFile/compileFileCached conveniences. This is what the server adapter and
// the `lzc` CLI import. (Browser code imports the root "." entry instead.)
export * from "./index.js";
export { nodeOptions } from "./node-io.js";
export { compileFile, compileFileCached } from "./api-node.js";
export { DiskTracker, DiskCache, diskProbe } from "./cache-disk.js";
