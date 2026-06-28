// Browser ENTRY — runs the byte-exact LZX→DHTML compiler IN A BROWSER: fetch the
// app + its dependency closure over HTTP, compile in-page, with closure-based
// caching. Re-exports the pure core too. NO node imports (this is the bundle root).
//
// THE FETCH→SYNC BRIDGE (fault-and-retry preload loop). The compiler core is
// SYNCHRONOUS but browser I/O is async. Rather than refactor the compiler to be
// async, we drive it: each pass runs the sync compile against the files fetched so
// far; the sync provider records every MISS into a `faults` set (returning a benign
// placeholder so one pass surfaces MANY misses); after the pass we fetch all faults
// in parallel, capture each response's validator, and retry. A pass that ends with
// `faults` empty is the REAL output, and the set of fetched URLs is the closure.
// We use the explicit `faults` side-channel (not exceptions) because compileInner
// swallows errors into `{unsupported}`.

import { compile } from "./compile.js";
import { browserOptions, type BrowserIoState, type FetchedFile } from "./browser-io.js";
import {
  BrowserTracker, BrowserCache, validatorFromResponse, browserProbe, type FetchFn,
} from "./cache-browser.js";
import { contentTag } from "./closure.js";
import type { Closure, Validator } from "./closure.js";

// Re-export the pure core (so `import { compile } from ".../browser"` works too).
export { compile } from "./compile.js";
export type { CompileOptions, CompileResult, ResourceInfo, FontInfo } from "./compile.js";
export {
  validatorsEqual, isUpToDate, fnv1a, lookupKey,
} from "./closure.js";
export { contentTag };
export type { Validator, ClosureEntry, Closure, Tracker, Probe } from "./closure.js";
export { browserOptions } from "./browser-io.js";
export type { BrowserIoState, FetchedFile } from "./browser-io.js";
export {
  BrowserTracker, BrowserCache, browserProbe, validatorFromResponse,
} from "./cache-browser.js";
export type { FetchFn, BrowserCacheEntry } from "./cache-browser.js";

/** A version tag baked into cache keys/tags (bump when codegen changes). */
export const COMPILER_VERSION = "lzc-ts-0.0.1";

export interface CompileInBrowserOptions {
  /** The fetch implementation. Defaults to the global `fetch`. */
  fetchFn?: FetchFn;
  /** Server-root URL (LPS_HOME) for components/fonts/lfc/autoincludes. */
  lpsUrl?: string;
  /** A BrowserCache to consult/populate. Omit to skip caching. */
  cache?: BrowserCache;
  /** Sprite mode — "none" (browser distro default, sheet-free) or "oracle". */
  sprites?: "none" | "oracle";
  /** Force-debug build (development only; not byte-exact). */
  debug?: boolean;
  /** DEBUG_BACKTRACE build (`?backtrace`): per-function call-stack frames + per-call
   *  line notes. Implies debug. Byte-for-byte vs the oracle (backtrace.lzx). */
  backtrace?: boolean;
  /** PROFILE build (`?profile`): pairs with the `lfc-profile.js` runtime variant (every
   *  LFC function `$lzprofiler`-metered, Profiler auto-started). Independent of debug;
   *  cache-keyed so a profile build never collides with the production cache. */
  profile?: boolean;
  /** SOLO build (`__LZproxied:"false"`). */
  proxied?: boolean;
  /** Retry cap for the preload loop (a runaway guard). */
  maxRetries?: number;
}

export interface CompileInBrowserResult {
  js: string;
  closure: Closure;
  tag: string;
  cached: boolean;
  unsupported?: string;
  /** How many fault-and-retry passes the compile took to converge. */
  passes: number;
}

const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
function decode(bytes: Uint8Array): string {
  if (textDecoder) return textDecoder.decode(bytes);
  // Minimal UTF-8 fallback (test environments always have TextDecoder).
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** The compiler properties that gate cache staleness (must match api-node's). */
function compileProps(o: CompileInBrowserOptions): Record<string, string> {
  return { debug: String(!!o.debug || !!o.backtrace), backtrace: String(!!o.backtrace),
           profile: String(!!o.profile), proxied: String(o.proxied !== false), sprites: o.sprites ?? "none" };
}

/** Compile an LZX app located at `mainUrl` entirely in the browser. Returns the JS,
 *  the dependency closure, the content tag (ETag), whether it was a cache hit, and
 *  the number of preload passes. */
export async function compileInBrowser(
  mainUrl: string,
  o: CompileInBrowserOptions = {},
): Promise<CompileInBrowserResult> {
  const fetchFn: FetchFn = o.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  if (!fetchFn) throw new Error("compileInBrowser: no fetch available (pass fetchFn)");
  const sprites = o.sprites ?? "none";
  const props = compileProps(o);

  // 1. Cache lookup (re-validates the stored closure over HTTP).
  if (o.cache) {
    const hit = await o.cache.get(mainUrl, props, fetchFn);
    if (hit) {
      return { js: hit.blob, closure: hit.closure, tag: hit.tag, cached: true, passes: 0 };
    }
  }

  // 2. The fetched-file map + a tracker recording each fetch's validator.
  const state: BrowserIoState = {
    map: new Map<string, FetchedFile>(), faults: new Set<string>(), missing: new Set<string>(),
  };
  const tracker = new BrowserTracker();

  // fetch one URL, store bytes+text in the map, record its validator. A 404 is
  // recorded as `{missing:true}` AND stored as an empty file so the resolver's next
  // pass sees a definitive miss (not an endless fault) — matching node's "not found
  // → null" with the closure still noting the negative dependency.
  // Validators captured at fetch time, keyed by URL. The CLOSURE is built from the
  // URLs a resolver actually USES (state.onUse), not from everything fetched — a
  // speculatively-fetched probe (e.g. the `.swf`→autoPng variant fetched in the same
  // pass as its direct hit) stays OUT of the closure, matching node-io which only
  // tracks files it reads-and-returns. This keeps the browser closure == Node's.
  const validators = new Map<string, Validator>();
  const fetchOne = async (url: string): Promise<void> => {
    try {
      const res = await fetchFn(url, { method: "GET" });
      if (!res.ok) {
        // A 404 is a DEFINITIVE miss: mark it so the resolver skips this candidate
        // (like node-io trying the next path) instead of treating an empty placeholder
        // as a real file.
        state.missing.add(url);
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const text = decode(buf);
      state.map.set(url, { bytes: buf, text });
      validators.set(url, validatorFromResponse(res.headers, { text, size: buf.length }));
    } catch {
      state.missing.add(url);
    }
  };
  // onUse: record a used URL into the (current-pass) tracker. Reset before each pass
  // so the FINAL pass's tracker is exactly the used closure.
  state.onUse = (url: string) => {
    if (!tracker.has(url)) tracker.record(url, validators.get(url) ?? { missing: true });
  };

  // The MAIN app source is always the first dependency. Fetch it before pass 1 so
  // the compile has something to parse.
  await fetchOne(mainUrl);
  // Eagerly fetch the autoincludes properties (node reads it during option build);
  // recording it keeps the closure aligned with the Node path.
  if (o.lpsUrl) {
    const lps = o.lpsUrl.endsWith("/") ? o.lpsUrl.slice(0, -1) : o.lpsUrl;
    await fetchOne(lps + "/WEB-INF/lps/misc/lzx-autoincludes.properties");
  }

  // 3. The fault-and-retry driver loop.
  const maxRetries = o.maxRetries ?? 50;
  let result = { js: "", unsupported: undefined as string | undefined };
  let passes = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    state.faults.clear();
    // Reset the per-pass closure tracker, then seed the MAIN app (it is parsed
    // directly, never via the resolver `want()`, so onUse never fires for it).
    tracker.reset();
    tracker.record(mainUrl, validators.get(mainUrl) ?? { missing: true });
    const opts = browserOptions({ baseUrl: mainUrl, lpsUrl: o.lpsUrl, state, sprites });
    const r = compile(state.map.get(mainUrl)!.text, {
      ...opts, debug: o.debug, backtrace: o.backtrace, profile: o.profile, proxied: o.proxied, sprites,
    });
    passes++;
    result = { js: r.js, unsupported: r.unsupported };
    if (state.faults.size === 0) break; // converged: no new misses
    // Fetch every newly-faulted URL, then retry.
    // Fetch only faults we have NOT already resolved one way or the other: not in
    // the map (already fetched) and not in `missing` (already known 404). Without
    // the `missing` guard a candidate that legitimately 404s along a search path
    // would re-fault → re-404 every pass and the loop would never converge.
    const toFetch = [...state.faults].filter((u) => !state.map.has(u) && !state.missing.has(u));
    if (toFetch.length === 0) break; // all faults already fetched (negative deps) → stable
    await Promise.all(toFetch.map(fetchOne));
    if (attempt === maxRetries) {
      throw new Error(`compileInBrowser: did not converge after ${maxRetries} passes (still faulting ${toFetch.length} urls, e.g. ${toFetch[0]})`);
    }
  }

  const closure: Closure = { entries: tracker.entries(), props };

  // 4. Store in the cache (never cache an unsupported/failed compile).
  let tag: string;
  let cached = false;
  if (o.cache && !result.unsupported) {
    tag = await o.cache.put(mainUrl, closure, result.js);
  } else {
    // Compute the tag inline so callers always get a stable ETag.
    tag = contentTag(mainUrl, closure, COMPILER_VERSION);
  }
  void cached;

  return { js: result.js, closure, tag, cached: false, unsupported: result.unsupported, passes };
}
