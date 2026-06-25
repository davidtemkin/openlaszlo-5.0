// Disk-backed implementation of the dependency-closure cache (server + CLI). The
// browser supplies a parallel implementation (fetch validators + CacheStorage); both
// share the env-agnostic algorithm in closure.ts. Mirrors Java's CompilationManager
// + cm/Cache: key by mainpath+props, store the compiled blob + the closure manifest,
// and recompile only when isUpToDate() fails over the stored closure.

import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Tracker, type ClosureEntry, type Validator, type Closure,
  isUpToDate, lookupKey, contentTag,
} from "./closure.js";

/** Disk validator for one path — Java's FileInfo{lastModified, length}. mtime is
 *  floored to ms-int for stable JSON round-tripping. A missing path records
 *  `{missing:true}` so its later creation also busts the cache. */
function statValidator(id: string): Validator {
  try { const s = statSync(id); return { mtime: Math.floor(s.mtimeMs), size: s.size }; }
  catch { return { missing: true }; }
}

/** Records every resolved file/dir with its disk validator captured at read time —
 *  Java's TrackingFileResolver. Pass the instance to nodeOptions(src, lps, tracker). */
export class DiskTracker implements Tracker {
  private m = new Map<string, ClosureEntry>();
  file(id: string): void { if (!this.m.has(id)) this.m.set(id, { id, kind: "file", v: statValidator(id) }); }
  dir(id: string): void { this.m.set(id, { id, kind: "dir", v: statValidator(id) }); }
  /** The collected closure entries (sorted by id for a stable manifest). */
  entries(): ClosureEntry[] {
    return [...this.m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

/** Re-read a dependency's CURRENT disk validator (for isUpToDate). */
export const diskProbe = (e: ClosureEntry): Validator => statValidator(e.id);

export interface CacheEntry {
  /** The compiled output (JS). */
  blob: string;
  /** The ETag (contentTag) — serve as HTTP ETag for 304s. */
  tag: string;
  /** The stored dependency closure (so a future request can re-check freshness). */
  closure: Closure;
}

/** On-disk compile cache. Layout: `<dir>/<lookupKey>.json` holds {tag, closure} and
 *  `<dir>/<lookupKey>.js` holds the compiled blob. Whole-app granularity (one blob
 *  per (mainpath, props) — the global-gensym constraint, per the compiler plan). */
export class DiskCache {
  constructor(private dir: string, private compilerVersion: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** Look up a fresh cached compile. Returns null on miss or staleness (any tracked
   *  dependency's current validator no longer matches, or props changed). */
  get(mainId: string, props: Record<string, string>): CacheEntry | null {
    const key = lookupKey(mainId, props, this.compilerVersion);
    const manPath = join(this.dir, key + ".json");
    const blobPath = join(this.dir, key + ".js");
    if (!existsSync(manPath) || !existsSync(blobPath)) return null;
    let man: { tag: string; closure: Closure };
    try { man = JSON.parse(readFileSync(manPath, "utf8")); } catch { return null; }
    if (!isUpToDate(man.closure, props, diskProbe)) return null;
    return { blob: readFileSync(blobPath, "utf8"), tag: man.tag, closure: man.closure };
  }

  /** Store a finished compile; returns the ETag (contentTag) for the response. */
  put(mainId: string, closure: Closure, blob: string): string {
    const key = lookupKey(mainId, closure.props, this.compilerVersion);
    const tag = contentTag(mainId, closure, this.compilerVersion);
    writeFileSync(join(this.dir, key + ".js"), blob);
    writeFileSync(join(this.dir, key + ".json"), JSON.stringify({ tag, closure }));
    return tag;
  }
}
