// Browser (fetch) implementation of the injectable compiler I/O — the mirror of
// node-io.ts. Where node-io resolves a `resource="…"`/`<include>`/`<script src>`
// reference to an ABSOLUTE FILESYSTEM PATH and reads it with `fs`, this resolves
// the same reference to a URL and reads it from an in-memory `map` of already-
// fetched files; a miss is recorded into `faults` (the preload side-channel) and a
// benign placeholder is returned so the synchronous compile keeps going and
// surfaces MORE misses in the same pass (see browser.ts for the driver loop).
//
// URLs play the role node-io gives absolute paths: `baseUrl` is the app directory
// URL (node's `appDir`), `lpsUrl` is the server-root URL (node's `lpsHome`). The
// pure path arithmetic (split/normalize/relativize, getUserPathname, relPathOf) is
// reused verbatim on the URL PATHNAMES, so the emitted `relPath`/`ptype`/debug
// filenames are byte-identical to the Node path.
//
// No node imports — this is part of the browser bundle.
import { imageDim } from "./imagedim.js";
// --- pure path arithmetic, mirrored from node-io.ts (operates on URL pathnames) ---
function maxCommonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i])
        i++;
    return i > 1 && a[i - 1] === "/" ? a.slice(0, i - 1) : a.slice(0, i);
}
function splitJ(s) {
    const out = [];
    let start = 0;
    for (;;) {
        const end = s.indexOf("/", start);
        if (end === -1) {
            if (start > 0 || start < s.length)
                out.push(s.slice(start));
            break;
        }
        out.push(s.slice(start, end));
        start = end + 1;
    }
    return out;
}
function normalizePath(path) {
    for (let i = 0; i < path.length; i++) {
        const c = path[i];
        if (c === "." || c === "") {
            path.splice(i, 1);
            i--;
        }
        else if (c === ".." && i > 0) {
            path.splice(i - 1, 2);
            i -= 2;
        }
    }
}
function adjustRelativePath(p, source, dest) {
    const sep = "/";
    if (p.endsWith(sep))
        return p;
    if (source.endsWith(sep))
        source = source.slice(0, -1);
    if (dest.endsWith(sep))
        dest = dest.slice(0, -1);
    const sd = splitJ(source);
    const dd = splitJ(dest);
    normalizePath(sd);
    normalizePath(dd);
    while (sd.length && dd.length && sd[0] === dd[0]) {
        sd.shift();
        dd.shift();
    }
    const comps = [];
    for (let i = 0; i < sd.length; i++)
        comps.push("..");
    for (const d of dd)
        comps.push(d);
    comps.push(p);
    return comps.join(sep);
}
function getUserPathname(pathname, basePathnames) {
    pathname = pathname.replace(/\\/g, "/");
    const slash = pathname.lastIndexOf("/");
    const sourceDir = slash >= 0 ? pathname.slice(0, slash) : "";
    const name = pathname.slice(slash + 1);
    let best = pathname;
    let bestLen = splitJ(best).length;
    for (const base of basePathnames) {
        const cand = adjustRelativePath(name, base.replace(/\\/g, "/"), sourceDir);
        const len = splitJ(cand).length;
        if (len < bestLen) {
            best = cand;
            bestLen = len;
        }
    }
    return best;
}
// --- URL helpers: join + normalize, mirroring node's resolvePath/dirname ---
/** The directory URL of a file URL (everything up to and including the last "/"). */
function dirUrl(u) {
    const i = u.lastIndexOf("/");
    return i >= 0 ? u.slice(0, i) : u;
}
function basenameUrl(u) {
    const i = u.lastIndexOf("/");
    return i >= 0 ? u.slice(i + 1) : u;
}
/** Join a base URL with a (possibly `../`-containing) ref and collapse `.`/`..`.
 *  Mirrors node's resolvePath(dir, ref). Absolute refs (with scheme) pass through.
 *  Query/fragment are dropped (resources don't carry them here). */
function joinUrl(base, ref) {
    if (/^[a-z]+:\/\//i.test(ref))
        return ref;
    const m = /^([a-z]+:\/\/[^/]*)(\/.*)?$/i.exec(base);
    const origin = m ? m[1] : "";
    let path = m ? (m[2] ?? "") : base;
    if (ref.startsWith("/"))
        path = ref;
    else
        path = (path.endsWith("/") ? path : path + "/") + ref;
    const segs = path.split("/");
    const out = [];
    for (const s of segs) {
        if (s === "." || s === "")
            continue;
        if (s === "..") {
            if (out.length)
                out.pop();
            continue;
        }
        out.push(s);
    }
    return origin + "/" + out.join("/");
}
/** insertSubdir(dir/a/b/c.png, "autoPng") => dir/a/b/autoPng/c.png. */
function insertSubdir(u, sub) {
    return dirUrl(u) + "/" + sub + "/" + basenameUrl(u);
}
/** Build CompileOptions whose hooks resolve refs to URLs and read from `state.map`,
 *  recording misses to `state.faults`. `baseUrl` is the app file URL (the MAIN
 *  source); `lpsUrl` the server-root URL. Mirrors nodeOptions's search order. */
export function browserOptions(args) {
    const { baseUrl, lpsUrl, state } = args;
    const appDir = dirUrl(baseUrl);
    const lps = lpsUrl ? (lpsUrl.endsWith("/") ? lpsUrl.slice(0, -1) : lpsUrl) : null;
    // Read a URL from the fetched map. Three outcomes:
    //  - HIT     → the FetchedFile.
    //  - PENDING → not fetched yet: record a fault (so the driver fetches it) and
    //              return null; the CALLER tracks that a candidate is still pending.
    //  - MISS    → known 404 (in state.missing): return null, do NOT re-fault.
    // The benign-placeholder behaviour lives in each resolver: if NO candidate hit
    // but at least one was PENDING, the resolver returns a placeholder so the compile
    // keeps going and surfaces MORE misses this pass; once the closure is fetched, a
    // later pass resolves it for real (or returns null on a true miss).
    let pending = false; // set by want() per resolver call; resolvers read+reset it
    const want = (url) => {
        const hit = state.map.get(url);
        if (hit) {
            state.onUse?.(url);
            return hit;
        } // record the USED dep (closure capture)
        if (state.missing.has(url))
            return null; // known 404 → skip (try next candidate)
        state.faults.add(url);
        pending = true;
        return null;
    };
    // Benign placeholders returned while a resource's real bytes are still in flight.
    // They appear ONLY in non-final passes (the driver retries until faults is empty),
    // so they never reach the emitted output. Dimensions are 1×1 (smallest valid).
    const PLACEHOLDER_RESOURCE = { width: 1, height: 1, ptype: "ar", relPath: "__lzc_pending__" };
    const PLACEHOLDER_INCLUDE = { source: "<library/>", id: "__lzc_pending__" };
    const PLACEHOLDER_TEXT = ""; // empty script body while fetching
    // A VALID-XML empty-dataset placeholder. A dataset's body is parsed IMMEDIATELY by
    // compileDataset; an empty "" would throw parseXml("") ("expected '<'") and abort the
    // whole pass BEFORE the fault loop can fetch the real src. Valid XML lets the pass
    // complete so the fault fetches the data; the FINAL pass uses the real content (so the
    // output stays byte-identical to node-io, which reads the file synchronously).
    const DATASET_PLACEHOLDER = "<data/>";
    // appDir/lps as bare pathnames (for relPathOf / getUserPathname arithmetic). We
    // keep the full URL elsewhere but the relativization runs on pathnames so the
    // emitted relPath is "components/foo.png" exactly as on disk.
    const pathOf = (u) => {
        const m = /^[a-z]+:\/\/[^/]*(\/.*)?$/i.exec(u);
        return m ? (m[1] ?? "") : u;
    };
    const appDirPath = pathOf(appDir);
    const lpsPath = lps ? pathOf(lps) : null;
    const relPathOf = (absUrl) => {
        const abs = pathOf(absUrl);
        let ptype, prefix;
        if (abs.startsWith(appDirPath)) {
            ptype = "ar";
            prefix = maxCommonPrefix(abs, appDirPath);
        }
        else {
            ptype = "sr";
            prefix = lpsPath ? maxCommonPrefix(abs, lpsPath) : appDirPath;
        }
        let relPath = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
        if (relPath[0] === "/")
            relPath = relPath.slice(1);
        return { ptype, relPath };
    };
    const resolveResource = (ref, originId) => {
        const isSwf = /\.swf$/i.test(ref);
        const pngRef = isSwf ? ref.replace(/\.swf$/i, ".png") : ref;
        const originDir = originId ? dirUrl(originId) : appDir;
        const baseDirs = [originDir];
        if (lps)
            baseDirs.push(lps + "/lps/components", lps + "/lps/fonts", lps + "/lps/lfc");
        pending = false;
        let foundUrl;
        let file = null;
        outer: for (const dir of baseDirs) {
            const direct = joinUrl(dir + "/", pngRef);
            const tries = isSwf ? [direct, insertSubdir(direct, "autoPng")] : [direct];
            for (const cand of tries) {
                const f = want(cand);
                if (f) {
                    foundUrl = cand;
                    file = f;
                    break outer;
                }
            }
        }
        if (!foundUrl || !file)
            return pending ? PLACEHOLDER_RESOURCE : null;
        const dim = imageDim(file.bytes);
        if (!dim)
            return null;
        const { ptype, relPath } = relPathOf(foundUrl);
        return { width: dim.width, height: dim.height, ptype, relPath };
    };
    const resolveFont = (src) => {
        const cands = [];
        cands.push(joinUrl(appDir + "/", src));
        if (lps) {
            cands.push(joinUrl(lps + "/lps/components/", src));
            cands.push(joinUrl(lps + "/lps/fonts/", src));
            cands.push(joinUrl(lps + "/lps/lfc/", src));
        }
        pending = false;
        for (const cand of cands) {
            const f = want(cand);
            if (f)
                return relPathOf(cand);
        }
        return pending ? { ptype: "ar", relPath: "__lzc_pending__" } : null;
    };
    const frameInfo = (url) => {
        const f = want(url);
        if (!f)
            return null;
        const dim = imageDim(f.bytes);
        if (!dim)
            return null;
        const { ptype, relPath } = relPathOf(url);
        return { width: dim.width, height: dim.height, ptype, relPath };
    };
    // Directory enumeration over HTTP is not generally available; multi-frame
    // directory/.swf resources are out of scope for the sheet-free browser distro
    // (sprites:"none" already avoids the montage). Returning null routes a `.swf`
    // ref to the single-frame resolveResource path (autoPng/<base>.png).
    const resolveResourceFrames = () => null;
    const resolveInclude = (ref, fromId) => {
        const base = fromId ? dirUrl(fromId) : appDir;
        const roots = ref.startsWith("/")
            ? (lps ? [joinUrl(lps + "/lps/components/", ref.slice(1))] : [])
            : [joinUrl(base + "/", ref)];
        if (lps && !ref.startsWith("/"))
            roots.push(joinUrl(lps + "/lps/components/", ref));
        // An LZX include names EITHER a file (`foo.lzx`) OR a directory whose `library.lzx`
        // is the real entry (`foo` → `foo/library.lzx`) — the name's suffix already tells
        // which. Over HTTP each wrong-form guess is a 404 round-trip, so pick the form by
        // suffix instead of probing both: a `.lzx` ref can't be a directory, a bare name
        // can't be a file. Drops the impossible candidates (≈⅔ of 404 probes) without
        // changing which file resolves — the search path (app dir, then lps/components) is
        // untouched, so app-local overrides and on-demand component editing still work.
        const candidates = roots.flatMap((r) => (/\.lzx$/i.test(ref) ? [r] : [r + "/library.lzx"]));
        pending = false;
        for (const url of candidates) {
            const f = want(url);
            if (f)
                return { source: f.text, id: url };
        }
        return pending ? PLACEHOLDER_INCLUDE : null;
    };
    // Auto-include map: tag -> library path (relative to lps/components). Parsed from
    // the fetched properties file (recorded as a closure dep, like Node).
    const autoincludes = {};
    if (lps) {
        const propUrl = lps + "/WEB-INF/lps/misc/lzx-autoincludes.properties";
        const f = want(propUrl);
        if (f) {
            for (const line of f.text.split("\n")) {
                const m = /^\s*([\w-]+)\s*[:=]\s*(\S+)/.exec(line);
                if (m && !line.trimStart().startsWith("#"))
                    autoincludes[m[1]] = m[2];
            }
        }
    }
    const resolveDatasetSrc = (ref, fromId) => {
        const base = fromId ? dirUrl(fromId) : appDir;
        const cands = base === appDir
            ? [joinUrl(appDir + "/", ref)]
            : [joinUrl(base + "/", ref), joinUrl(appDir + "/", ref)];
        pending = false;
        for (const url of cands) {
            const f = want(url);
            if (f)
                return f.text;
        }
        return pending ? DATASET_PLACEHOLDER : null;
    };
    const resolveScriptSrc = (ref, fromId) => {
        const base = fromId ? dirUrl(fromId) : appDir;
        const cands = [joinUrl(base + "/", ref)];
        if (lps && !ref.startsWith("/"))
            cands.push(joinUrl(lps + "/lps/components/", ref));
        if (lps && ref.startsWith("/"))
            cands.push(joinUrl(lps + "/lps/components/", ref.slice(1)));
        pending = false;
        for (const url of cands) {
            const f = want(url);
            if (f)
                return f.text;
        }
        return pending ? PLACEHOLDER_TEXT : null;
    };
    // Debug directive filename — mirror node-io's getUserPathname over URL pathnames.
    // (The browser distro runs sprites:"none" non-debug, so this is rarely hit, but
    // kept faithful for parity.)
    const sourceId = baseUrl;
    const basePathnames = [appDirPath];
    if (lpsPath)
        basePathnames.push(lpsPath + "/lps/components", lpsPath + "/lps/fonts", lpsPath + "/lps/lfc");
    const debugFileName = (id) => {
        const isApp = id === sourceId;
        return getUserPathname(pathOf(isApp ? sourceId : id), basePathnames);
    };
    const spritePath = basenameUrl(baseUrl).replace(/\.lzx$/, "") + ".sprite.png";
    return {
        resolveResource, resolveResourceFrames, resolveFont, spritePath, resolveInclude,
        autoincludes, resolveDatasetSrc, resolveScriptSrc, sourceId, debugFileName,
    };
}
