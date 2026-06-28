// Node-side convenience API: compile an LZX file on disk, capturing its dependency
// closure, with an optional disk cache. This is the seam the server adapter and the
// `lzc` CLI build on. The pure compiler core (compile.ts) stays I/O-free; all disk
// access is here + node-io.ts + cache-disk.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "./compile.js";
import { nodeOptions } from "./node-io.js";
import { DiskTracker, DiskCache } from "./cache-disk.js";
import type { Closure } from "./closure.js";

export interface CompileFileOptions {
  /** LPS_HOME (server root) for resolving components/fonts/autoincludes. */
  lpsHome?: string;
  debug?: boolean;
  /** DEBUG_BACKTRACE build (`?lzbacktrace`): per-function call-stack frames + per-call
   *  line notes. Implies debug. Pairs with the `lfc-backtrace.js` runtime variant. */
  backtrace?: boolean;
  /** PROFILE build (`?profile`): pairs with the `lfc-profile.js` runtime variant (every
   *  LFC function `$lzprofiler`-metered, Profiler auto-started). Independent of debug;
   *  cache-keyed so a profile build never collides with the production cache. */
  profile?: boolean;
  /** false ⇒ SOLO build (`__LZproxied:"false"`). Default (true) ⇒ proxied. */
  proxied?: boolean;
  /** "none" ⇒ Java-free sprite-sheet-free output (multi-frame resources render
   *  from individual frame PNGs). Default "oracle" ⇒ byte-parity sheet refs. */
  sprites?: "oracle" | "none";
}

export interface CompileFileResult {
  js: string;
  closure: Closure;
  unsupported?: string;
  /** The ETag (set when served via a cache). */
  tag?: string;
  /** True when returned from the cache without recompiling. */
  cached?: boolean;
}

/** The compiler properties that gate cache staleness (Java's computeKey props). */
function compileProps(o: CompileFileOptions): Record<string, string> {
  return { debug: String(!!o.debug || !!o.backtrace), backtrace: String(!!o.backtrace),
           profile: String(!!o.profile), proxied: String(o.proxied !== false), sprites: o.sprites ?? "oracle" };
}

/** Compile a file on disk, returning the JS + the full dependency closure (every
 *  include / imported library / autoincluded component / resource / dataset / font /
 *  script the compile read). No caching. */
export function compileFile(mainPath: string, o: CompileFileOptions = {}): CompileFileResult {
  const abs = resolve(mainPath);
  const tracker = new DiskTracker();
  tracker.file(abs); // the main source is the first dependency
  const source = readFileSync(abs, "utf8");
  const opts = nodeOptions(abs, o.lpsHome, tracker);
  const r = compile(source, { ...opts, debug: o.debug, backtrace: o.backtrace, profile: o.profile, proxied: o.proxied, sprites: o.sprites });
  return { js: r.js, unsupported: r.unsupported, closure: { entries: tracker.entries(), props: compileProps(o) } };
}

/** Compile with a disk cache: serve a fresh cached blob when every tracked
 *  dependency still validates (isUpToDate); otherwise recompile + store. Failures
 *  (unsupported constructs) are never cached. Returns `cached` + the ETag `tag`. */
export function compileFileCached(mainPath: string, o: CompileFileOptions, cache: DiskCache): CompileFileResult {
  const abs = resolve(mainPath);
  const props = compileProps(o);
  const hit = cache.get(abs, props);
  if (hit) return { js: hit.blob, closure: hit.closure, tag: hit.tag, cached: true };
  const r = compileFile(abs, o);
  if (r.unsupported) return r; // never cache a failed compile
  const tag = cache.put(abs, r.closure, r.js);
  return { ...r, tag, cached: false };
}
