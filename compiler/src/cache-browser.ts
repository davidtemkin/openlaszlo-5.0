// Browser-backed implementation of the dependency-closure cache — the mirror of
// cache-disk.ts. Same env-agnostic algorithm (closure.ts); only the validator
// SOURCE differs (HTTP response headers instead of fs.stat) and the STORE differs
// (CacheStorage / an in-memory Map instead of files on disk).
//
// Validator policy (mirrors closure.ts's documented order): prefer a strong/weak
// HTTP validator — `{ etag }`, else `{ lastModified, size }` — and always also
// carry an `fnv1a` content `hash` as a universal floor, so two environments that
// disagree on headers still detect a real content change.

import {
  type Tracker, type ClosureEntry, type Validator, type Closure,
  isUpToDate, lookupKey, contentTag, fnv1a,
} from "./closure.js";

/** Derive a Validator from a fetched response's headers + body. `headers` is any
 *  Headers-like object (real `Response.headers`, or a plain map from the test
 *  shim). `text` (when given) seeds the content `hash` floor. */
export function validatorFromResponse(
  headers: { get(name: string): string | null } | undefined,
  body?: { text?: string; size?: number },
): Validator {
  const v: Validator = {};
  const etag = headers?.get("etag") ?? headers?.get("ETag") ?? null;
  const lastMod = headers?.get("last-modified") ?? headers?.get("Last-Modified") ?? null;
  if (etag) v.etag = etag;
  else if (lastMod) v.lastModified = lastMod;
  if (body?.text !== undefined) v.hash = fnv1a(body.text);
  if (body?.size !== undefined) v.size = body.size;
  return v;
}

/** Records every fetched URL with the validator captured from its response — the
 *  browser counterpart of DiskTracker. The driver calls `record(url, validator)`
 *  as each fetch lands; `file(id)`/`dir(id)` satisfy the Tracker interface but in
 *  the browser the recording is validator-first (we already hold the response). */
export class BrowserTracker implements Tracker {
  private m = new Map<string, ClosureEntry>();
  /** Record a fetched URL's validator (called by the driver per fetch). */
  record(id: string, v: Validator, kind: "file" | "dir" = "file"): void {
    this.m.set(id, { id, kind, v });
  }
  /** Tracker.file — used when a resolver touches a URL we have NOT separately
   *  recorded (defensive; the driver normally records every fetch up front). */
  file(id: string): void { if (!this.m.has(id)) this.m.set(id, { id, kind: "file", v: { missing: true } }); }
  dir(id: string): void { if (!this.m.has(id)) this.m.set(id, { id, kind: "dir", v: { missing: true } }); }
  has(id: string): boolean { return this.m.has(id); }
  /** Drop all recorded entries (the driver resets per pass so the FINAL pass's
   *  recorded set is exactly the used closure). */
  reset(): void { this.m.clear(); }
  entries(): ClosureEntry[] {
    return [...this.m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

/** A fetch-like function (the global `fetch`, or the test FS shim). */
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

/** Re-read a dependency's CURRENT validator over HTTP — a conditional HEAD (cheap,
 *  no body). Returns `{missing:true}` if the resource is now gone. Used by
 *  BrowserCache.get via isUpToDate. Async, so the cache get is async too. */
export async function browserProbe(entry: ClosureEntry, fetchFn: FetchFn): Promise<Validator> {
  try {
    const res = await fetchFn(entry.id, { method: "HEAD" });
    if (!res.ok) return { missing: true };
    // For a HEAD we have no body → no fresh hash/size unless the server returns
    // content-length. We still compare the header validators (etag/lastModified),
    // which is what closure.ts's validatorsEqual keys on when present.
    const v = validatorFromResponse(res.headers);
    const cl = res.headers.get("content-length");
    if (cl && entry.v.size !== undefined) v.size = Number(cl);
    // If neither side has a comparable header field, fall back to a GET for hash.
    if (v.etag === undefined && v.lastModified === undefined && v.size === undefined) {
      const g = await fetchFn(entry.id, { method: "GET" });
      if (!g.ok) return { missing: true };
      return validatorFromResponse(g.headers, { text: await g.text() });
    }
    return v;
  } catch {
    return { missing: true };
  }
}

export interface BrowserCacheEntry {
  blob: string;
  tag: string;
  closure: Closure;
}

interface StoredManifest { tag: string; closure: Closure }

/** A tiny key/value store the cache persists to: CacheStorage when available in a
 *  real browser, else an in-memory Map (the default in Node test runs). */
interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

class MemKv implements KvStore {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
}

/** CacheStorage-backed store (real browser). Stores values as text responses under
 *  a synthetic `https://lzc-cache/<key>` request. */
class CacheStorageKv implements KvStore {
  constructor(private cacheName: string) {}
  private url(k: string) { return "https://lzc-cache.invalid/" + encodeURIComponent(k); }
  async get(k: string): Promise<string | null> {
    const c = await caches.open(this.cacheName);
    const r = await c.match(this.url(k));
    return r ? await r.text() : null;
  }
  async put(k: string, v: string): Promise<void> {
    const c = await caches.open(this.cacheName);
    await c.put(this.url(k), new Response(v));
  }
}

/** The browser compile cache — counterpart of DiskCache. Keyed by lookupKey
 *  (mainUrl + sorted props + compilerVersion); stores {tag, closure} + the blob;
 *  freshness re-checked via isUpToDate over the stored closure using browserProbe.
 *  All ops are async (HTTP / CacheStorage). */
export class BrowserCache {
  private kv: KvStore;
  constructor(private compilerVersion: string, opts?: { cacheName?: string; store?: "memory" | "cachestorage" }) {
    const useCS = (opts?.store ?? (typeof caches !== "undefined" ? "cachestorage" : "memory")) === "cachestorage"
      && typeof caches !== "undefined";
    this.kv = useCS ? new CacheStorageKv(opts?.cacheName ?? "lzc-compile-cache") : new MemKv();
  }

  /** Look up a fresh cached compile. `fetchFn` is used by browserProbe to re-check
   *  each dependency. Returns null on miss or staleness. */
  async get(mainUrl: string, props: Record<string, string>, fetchFn: FetchFn): Promise<BrowserCacheEntry | null> {
    const key = lookupKey(mainUrl, props, this.compilerVersion);
    const manRaw = await this.kv.get(key + ".json");
    const blob = await this.kv.get(key + ".js");
    if (manRaw === null || blob === null) return null;
    let man: StoredManifest;
    try { man = JSON.parse(manRaw); } catch { return null; }
    // isUpToDate needs a SYNC probe; we pre-probe every dep async then feed a map.
    const probed = new Map<string, Validator>();
    await Promise.all(man.closure.entries.map(async (e) => { probed.set(e.id, await browserProbe(e, fetchFn)); }));
    const fresh = isUpToDate(man.closure, props, (e) => probed.get(e.id) ?? { missing: true });
    if (!fresh) return null;
    return { blob, tag: man.tag, closure: man.closure };
  }

  /** Store a finished compile; returns the ETag (contentTag). */
  async put(mainUrl: string, closure: Closure, blob: string): Promise<string> {
    const key = lookupKey(mainUrl, closure.props, this.compilerVersion);
    const tag = contentTag(mainUrl, closure, this.compilerVersion);
    await this.kv.put(key + ".js", blob);
    await this.kv.put(key + ".json", JSON.stringify({ tag, closure } satisfies StoredManifest));
    return tag;
  }
}
