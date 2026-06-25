// Node-side convenience API: compile an LZX file on disk, capturing its dependency
// closure, with an optional disk cache. This is the seam the server adapter and the
// `lzc` CLI build on. The pure compiler core (compile.ts) stays I/O-free; all disk
// access is here + node-io.ts + cache-disk.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "./compile.js";
import { nodeOptions } from "./node-io.js";
import { DiskTracker } from "./cache-disk.js";
/** The compiler properties that gate cache staleness (Java's computeKey props). */
function compileProps(o) {
    return { debug: String(!!o.debug), proxied: String(o.proxied !== false), sprites: o.sprites ?? "oracle" };
}
/** Compile a file on disk, returning the JS + the full dependency closure (every
 *  include / imported library / autoincluded component / resource / dataset / font /
 *  script the compile read). No caching. */
export function compileFile(mainPath, o = {}) {
    const abs = resolve(mainPath);
    const tracker = new DiskTracker();
    tracker.file(abs); // the main source is the first dependency
    const source = readFileSync(abs, "utf8");
    const opts = nodeOptions(abs, o.lpsHome, tracker);
    const r = compile(source, { ...opts, debug: o.debug, proxied: o.proxied, sprites: o.sprites });
    return { js: r.js, unsupported: r.unsupported, closure: { entries: tracker.entries(), props: compileProps(o) } };
}
/** Compile with a disk cache: serve a fresh cached blob when every tracked
 *  dependency still validates (isUpToDate); otherwise recompile + store. Failures
 *  (unsupported constructs) are never cached. Returns `cached` + the ETag `tag`. */
export function compileFileCached(mainPath, o, cache) {
    const abs = resolve(mainPath);
    const props = compileProps(o);
    const hit = cache.get(abs, props);
    if (hit)
        return { js: hit.blob, closure: hit.closure, tag: hit.tag, cached: true };
    const r = compileFile(abs, o);
    if (r.unsupported)
        return r; // never cache a failed compile
    const tag = cache.put(abs, r.closure, r.js);
    return { ...r, tag, cached: false };
}
