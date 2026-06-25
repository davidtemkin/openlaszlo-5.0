// Disk-backed implementation of the dependency-closure cache (server + CLI). The
// browser supplies a parallel implementation (fetch validators + CacheStorage); both
// share the env-agnostic algorithm in closure.ts. Mirrors Java's CompilationManager
// + cm/Cache: key by mainpath+props, store the compiled blob + the closure manifest,
// and recompile only when isUpToDate() fails over the stored closure.
import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isUpToDate, lookupKey, contentTag, } from "./closure.js";
/** Disk validator for one path — Java's FileInfo{lastModified, length}. mtime is
 *  floored to ms-int for stable JSON round-tripping. A missing path records
 *  `{missing:true}` so its later creation also busts the cache. */
function statValidator(id) {
    try {
        const s = statSync(id);
        return { mtime: Math.floor(s.mtimeMs), size: s.size };
    }
    catch {
        return { missing: true };
    }
}
/** Records every resolved file/dir with its disk validator captured at read time —
 *  Java's TrackingFileResolver. Pass the instance to nodeOptions(src, lps, tracker). */
export class DiskTracker {
    constructor() {
        this.m = new Map();
    }
    file(id) { if (!this.m.has(id))
        this.m.set(id, { id, kind: "file", v: statValidator(id) }); }
    dir(id) { this.m.set(id, { id, kind: "dir", v: statValidator(id) }); }
    /** The collected closure entries (sorted by id for a stable manifest). */
    entries() {
        return [...this.m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
}
/** Re-read a dependency's CURRENT disk validator (for isUpToDate). */
export const diskProbe = (e) => statValidator(e.id);
/** On-disk compile cache. Layout: `<dir>/<lookupKey>.json` holds {tag, closure} and
 *  `<dir>/<lookupKey>.js` holds the compiled blob. Whole-app granularity (one blob
 *  per (mainpath, props) — the global-gensym constraint, per the compiler plan). */
export class DiskCache {
    constructor(dir, compilerVersion) {
        this.dir = dir;
        this.compilerVersion = compilerVersion;
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
    }
    /** Look up a fresh cached compile. Returns null on miss or staleness (any tracked
     *  dependency's current validator no longer matches, or props changed). */
    get(mainId, props) {
        const key = lookupKey(mainId, props, this.compilerVersion);
        const manPath = join(this.dir, key + ".json");
        const blobPath = join(this.dir, key + ".js");
        if (!existsSync(manPath) || !existsSync(blobPath))
            return null;
        let man;
        try {
            man = JSON.parse(readFileSync(manPath, "utf8"));
        }
        catch {
            return null;
        }
        if (!isUpToDate(man.closure, props, diskProbe))
            return null;
        return { blob: readFileSync(blobPath, "utf8"), tag: man.tag, closure: man.closure };
    }
    /** Store a finished compile; returns the ETag (contentTag) for the response. */
    put(mainId, closure, blob) {
        const key = lookupKey(mainId, closure.props, this.compilerVersion);
        const tag = contentTag(mainId, closure, this.compilerVersion);
        writeFileSync(join(this.dir, key + ".js"), blob);
        writeFileSync(join(this.dir, key + ".json"), JSON.stringify({ tag, closure }));
        return tag;
    }
}
