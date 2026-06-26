// Dependency-closure tracking + cache-staleness logic — a port of the Java
// compiler's cm/DependencyTracker + TrackingFileResolver model, generalized so the
// same algorithm runs on disk (server/CLI) and in the browser.
//
// The Java model (DependencyTracker): every file the compiler resolves is recorded
// with a validator — `FileInfo{lastModified, length, canRead}` — and a cached
// compile is up-to-date iff every recorded file's CURRENT validator still matches
// AND the compiler properties are unchanged (DependencyTracker.isUpToDate). We keep
// that algorithm verbatim; we only let the validator be whatever the environment
// cheaply provides: mtime+size on disk, ETag/Last-Modified over HTTP, content-hash
// as a universal floor.

/** A cheap change-detection signal for one dependency. Any field the environment
 *  can supply is used; comparison is field-by-field over the fields PRESENT in the
 *  stored validator (a probe that can no longer supply a field → treated as changed).
 *  - disk:    `{ mtime, size }`            (fs.stat — Java's FileInfo)
 *  - browser: `{ etag }` or `{ lastModified, size }`  (HTTP validators)
 *  - any:     `{ hash }`                   (content hash — universal fallback)
 *  `missing: true` records that the dependency did not exist at compile time (so its
 *  later CREATION also busts the cache). */
export interface Validator {
  mtime?: number;
  size?: number;
  etag?: string;
  lastModified?: string;
  hash?: string;
  missing?: boolean;
}

export interface ClosureEntry {
  /** Environment-local identity: an absolute path on disk, a URL in the browser. */
  id: string;
  kind: "file" | "dir";
  v: Validator;
}

/** The full dependency closure of one compile + the compiler properties that, per
 *  the Java cache key, also gate staleness (debug, proxied, runtime, …). */
export interface Closure {
  entries: ClosureEntry[];
  props: Record<string, string>;
}

/** Collects the set of dependencies touched during a compile. The environment
 *  supplies an implementation that captures the validator at record time (disk:
 *  statSync; browser: from the fetch response headers). Mirrors Java's
 *  TrackingFileResolver decorator — the compiler core never sees it. */
export interface Tracker {
  file(id: string): void;
  dir(id: string): void;
}

/** Two validators match iff every field present in BOTH agrees, and neither flips
 *  the `missing` flag. (We compare on the stored validator's fields; a richer probe
 *  is fine.) */
export function validatorsEqual(stored: Validator, current: Validator): boolean {
  if (!!stored.missing !== !!current.missing) return false;
  if (stored.missing && current.missing) return true;
  // A matching STRONG validator (HTTP ETag / Last-Modified) is authoritative: the
  // resource is unchanged, so we must NOT also require size/hash to match. This is
  // not just an optimization — it is REQUIRED for correctness over a compressing
  // host: the cache is populated from GET responses (the validator's `size` is the
  // DECOMPRESSED body length, `hash` is over the decompressed text), but freshness is
  // re-checked with a cheap HEAD whose `Content-Length` is the COMPRESSED size (and
  // which has no body to re-hash). Letting that size/hash difference veto a matching
  // ETag made every reload a cache MISS → a full recompile. ETags exist precisely to
  // be authoritative for conditional requests; trust them when both sides supply one.
  for (const k of ["etag", "lastModified"] as const) {
    if (stored[k] !== undefined && current[k] !== undefined) return stored[k] === current[k];
  }
  // No shared strong validator (e.g. the disk backend's mtime+size, or a host that
  // sends none) → fall back to content-hash / mtime / size, all of which the probe
  // can supply comparably in that case.
  let compared = 0;
  for (const k of ["hash", "mtime", "size"] as const) {
    if (stored[k] !== undefined && current[k] !== undefined) {
      if (stored[k] !== current[k]) return false;
      compared++;
    }
  }
  // If the stored validator and the probe share NO comparable field, we cannot
  // prove freshness → treat as stale (conservative; forces a recompile).
  return compared > 0;
}

/** A probe re-reads the CURRENT validator for a dependency (disk: statSync; browser:
 *  HEAD / conditional GET). Returns `{missing:true}` if the dependency is now gone. */
export type Probe = (entry: ClosureEntry) => Validator;

/** Java DependencyTracker.isUpToDate: the cached compile is fresh iff the props are
 *  unchanged and every recorded dependency's current validator still matches. */
export function isUpToDate(closure: Closure, currentProps: Record<string, string>, probe: Probe): boolean {
  const a = closure.props, b = currentProps;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  for (const e of closure.entries) {
    if (!validatorsEqual(e.v, probe(e))) return false;
  }
  return true;
}

/** FNV-1a 64-bit (as 16 hex chars) — a small dependency-free content hash for cache
 *  keys/ETags. Not cryptographic; collision risk is negligible for this use and the
 *  validator re-check catches a stale hit anyway. */
export function fnv1a(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/** The cache LOOKUP key — computable BEFORE compiling (so there's no chicken-and-egg:
 *  the closure is only known after a compile). Java's computeKey: `relpath + sorted
 *  props` + compiler version. The stored manifest under this key carries the closure,
 *  and freshness is then decided by isUpToDate(). */
export function lookupKey(mainId: string, props: Record<string, string>, compilerVersion: string): string {
  const parts = [`v=${compilerVersion}`, `main=${mainId}`];
  for (const k of Object.keys(props).sort()) parts.push(`${k}=${props[k]}`);
  return fnv1a(parts.join("\n"));
}

/** The content TAG (ETag) for a finished compile: a stable hash of the closure's
 *  identities+validators + compiler version + props. Computed AFTER a compile (the
 *  closure is known) and served as the HTTP ETag so conditional requests still 304.
 *  A changed dependency yields a new tag directly (DESIGN.md's content-hash variant). */
export function contentTag(mainId: string, closure: Closure, compilerVersion: string): string {
  const parts = [`v=${compilerVersion}`, `main=${mainId}`];
  for (const k of Object.keys(closure.props).sort()) parts.push(`${k}=${closure.props[k]}`);
  const sorted = [...closure.entries].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const e of sorted) {
    const v = e.v;
    parts.push(`${e.kind}:${e.id}|${v.hash ?? ""}|${v.etag ?? ""}|${v.lastModified ?? ""}|${v.mtime ?? ""}|${v.size ?? ""}|${v.missing ? "X" : ""}`);
  }
  return fnv1a(parts.join("\n"));
}
