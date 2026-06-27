// Node (filesystem) implementation of the injectable compiler I/O — resolves
// `resource="…"` references relative to the source file, mirroring the oracle
// (under the app dir → ptype "ar"; otherwise relative to LPS_HOME → "sr"). The
// browser build supplies a fetch-based resolver instead.
import { readFileSync, realpathSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath, basename } from "node:path";
import { imageDim } from "./imagedim.js";
/** Longest common path prefix as a string, truncated at the last `/`
 *  (FileUtils.findMaxCommonPrefix). */
function maxCommonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i])
        i++;
    return i > 1 && a[i - 1] === "/" ? a.slice(0, i - 1) : a.slice(0, i);
}
function canon(p) {
    try {
        return realpathSync(p);
    }
    catch {
        return resolvePath(p);
    }
}
/** StringUtils.split: splits on "/" KEEPING empty tokens, so "/a/b" -> ["","a","b"]
 *  (the leading "" is significant for the oracle's segment-count comparison). */
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
/** FileUtils.normalizePath: drop "." / "" components and collapse "x/.." pairs. */
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
/** FileUtils.adjustRelativePath: express `p` (relative to `source`) relative to
 *  `dest`. On unix the RelativizationError branch is dead after normalize (the
 *  leading "" is stripped so no token tests as absolute), so it always returns a
 *  `../…` form. */
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
/** Parser.getUserPathname: the shortest (fewest "/"-segments) pathname for `pathname`
 *  relative to any of `basePathnames`, else `pathname` itself. */
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
/** Build compile options for a source file on disk. `lpsHome` (optional) is the
 *  server root used to resolve non-app-relative resources as "sr". `tracker`
 *  (optional) records every resolved file/dir into the dependency closure (the
 *  TrackingFileResolver decorator). */
export function nodeOptions(sourcePath, lpsHome, tracker) {
    const appDir = canon(dirname(sourcePath));
    // Closure capture: record a file whose content we read, or a directory we listed.
    const rd = (abs) => { const b = readFileSync(abs); tracker?.file(abs); return b; };
    const rdText = (abs) => { const b = readFileSync(abs, "utf8"); tracker?.file(abs); return b; };
    const ls = (abs) => { const e = readdirSync(abs); tracker?.dir(abs); return e; };
    const lpsCanon = lpsHome ? canon(lpsHome) : null;
    // Layout: the original webapp nests resources under `lps/` (<home>/lps/components +
    // <home>/WEB-INF/lps/misc/…); the FLATTENED distro puts them at <home>/components +
    // <home>/lzx-autoincludes.properties. Detect once and prefix accordingly, so ONE
    // resolver serves both layouts (no symlink overlay needed for the flat distro).
    const _nested = !!lpsHome && existsSync(resolvePath(lpsHome, "lps", "components"));
    const LPS = _nested ? "lps/" : "";
    const AUTOINC = _nested ? "WEB-INF/lps/misc/lzx-autoincludes.properties" : "lzx-autoincludes.properties";
    // getRelPath: a resolved absolute path → [ptype, relPath]. Under the app dir →
    // "ar" (app-relative); else relative to LPS_HOME → "sr" (server-root).
    const relPathOf = (abs) => {
        let ptype, prefix;
        if (abs.startsWith(appDir)) {
            ptype = "ar";
            prefix = maxCommonPrefix(abs, appDir);
        }
        else {
            ptype = "sr";
            prefix = lpsCanon ? maxCommonPrefix(abs, lpsCanon) : appDir;
        }
        let relPath = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
        if (relPath[0] === "/")
            relPath = relPath.slice(1);
        return { ptype, relPath };
    };
    const resolveResource = (ref, originId) => {
        // Mirror FileResolver.resolvePathname for the DHTML resource path. A `.swf`
        // reference is rewritten to `.png` (DHTML can't render Flash; OpenLaszlo's
        // build pre-generates PNG siblings, some under an `autoPng/` subdir). Search
        // order: the defining file's own dir (FileResolver's `base`), then the
        // component/font/LFC dirs; within each dir, the direct path then the
        // `autoPng/<file>` variant (FileResolver inserts the subdir before the
        // filename when the direct file is missing).
        const isSwf = /\.swf$/i.test(ref);
        const pngRef = isSwf ? ref.replace(/\.swf$/i, ".png") : ref;
        // FileResolver's `base` is the directory of the file containing the ref.
        const originDir = originId ? canon(dirname(originId)) : appDir;
        const baseDirs = [originDir];
        if (lpsCanon)
            baseDirs.push(resolvePath(lpsCanon, LPS + "components"), resolvePath(lpsCanon, LPS + "fonts"), resolvePath(lpsCanon, LPS + "lfc"));
        // `insertSubdir(dir/a/b/c.png, "autoPng")` => `dir/a/b/autoPng/c.png`.
        const autoPngOf = (p) => resolvePath(dirname(p), "autoPng", basename(p));
        let abs;
        let bytes;
        outer: for (const dir of baseDirs) {
            const direct = resolvePath(dir, pngRef);
            const tries = isSwf ? [direct, autoPngOf(direct)] : [direct];
            for (const cand of tries) {
                try {
                    abs = canon(cand);
                    bytes = rd(abs);
                    break outer;
                }
                catch {
                    abs = undefined;
                }
            }
        }
        if (!abs || !bytes)
            return null;
        const dim = imageDim(bytes);
        if (!dim)
            return null; // non-raster (no PNG substitute resolved)
        const { ptype, relPath } = relPathOf(abs);
        return { width: dim.width, height: dim.height, ptype, relPath };
    };
    // Font resolution mirrors FileResolver's search order for a bare reference:
    // app dir → components → font dir (lps/fonts) → LFC dir (lps/lfc).
    const resolveFont = (src) => {
        if (!lpsCanon) {
            try {
                return relPathOf(canon(resolvePath(appDir, src)));
            }
            catch {
                return null;
            }
        }
        const candidates = [
            resolvePath(appDir, src),
            resolvePath(lpsCanon, LPS + "components", src),
            resolvePath(lpsCanon, LPS + "fonts", src),
            resolvePath(lpsCanon, LPS + "lfc", src),
        ];
        for (const cand of candidates) {
            try {
                const abs = canon(cand);
                rd(abs);
                return relPathOf(abs);
            }
            catch { /* next */ }
        }
        return null;
    };
    // Enumerate the frames of a multi-frame resource whose `src` is a directory
    // (trailing `/` → all image files in it) or a `.swf` (→ the pre-generated
    // `autoPng/<base><digits>.png` siblings). Frames are returned in SORTED order;
    // the oracle's directory enumeration order is its JVM `File.list()` filesystem
    // order, which is non-portable — sorted is deterministic (and matches the
    // oracle directly when its listing happened to be sorted, e.g. spinner).
    const frameInfo = (abs) => {
        let bytes;
        try {
            bytes = rd(abs);
        }
        catch {
            return null;
        }
        const dim = imageDim(bytes);
        if (!dim)
            return null;
        const { ptype, relPath } = relPathOf(canon(abs));
        return { width: dim.width, height: dim.height, ptype, relPath };
    };
    const resolveResourceFrames = (ref, originId) => {
        const originDir = originId ? canon(dirname(originId)) : appDir;
        const baseDirs = [originDir, appDir];
        if (lpsCanon)
            baseDirs.push(resolvePath(lpsCanon, LPS + "components"));
        const collect = (dirAbs, re) => {
            let entries;
            try {
                entries = ls(dirAbs);
            }
            catch {
                return null;
            }
            // Exclude the oracle's own generated `<first>.sprite.png` montage artifact
            // (it is the OUTPUT of compiling this directory, not an input frame).
            const imgs = entries.filter((f) => re.test(f) && !/\.sprite\.png$/i.test(f)).sort();
            if (!imgs.length)
                return null;
            const infos = imgs.map((f) => frameInfo(resolvePath(dirAbs, f)));
            return infos.some((i) => !i) ? null : infos;
        };
        if (ref.endsWith("/")) {
            for (const d of baseDirs) {
                const r = collect(resolvePath(d, ref), /\.(png|jpe?g|gif)$/i);
                if (r)
                    return r;
            }
        }
        else if (/\.swf$/i.test(ref)) {
            const base = basename(ref).replace(/\.swf$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            // A MULTI-frame `.swf` renders to autoPng siblings `<base>NNNN.png` (exactly
            // 4 digits, 1-based — upbtn0001/0002/0003). The number is `\d{4}`, NOT a bare
            // `\d+`: `arrow.swf` must NOT match `arrow2.png` (the render of the SEPARATE
            // single-frame `arrow2.swf`). A SINGLE-frame `.swf` has NO numbered series,
            // so enumeration returns null here and the caller falls through to the single
            // `resolveResource` path (which finds `autoPng/<base>.png`).
            const re = new RegExp("^" + base + "\\d{4}\\.png$", "i");
            for (const d of baseDirs) {
                const r = collect(resolvePath(d, dirname(ref), "autoPng"), re);
                if (r)
                    return r;
            }
        }
        return null;
    };
    const spritePath = basename(sourcePath).replace(/\.lzx$/, "") + ".sprite.png";
    const resolveInclude = (ref, fromId) => {
        // Search order: relative to the including file, then the LFC component base.
        // A leading-slash href (`/extensions/…`) is resolved from the component base.
        // An href naming a directory includes that dir's `library.lzx`.
        const base = fromId ? dirname(fromId) : appDir;
        const roots = ref.startsWith("/")
            ? (lpsHome ? [resolvePath(lpsHome, LPS + "components", ref.slice(1))] : [])
            : [resolvePath(base, ref)];
        if (lpsHome && !ref.startsWith("/"))
            roots.push(resolvePath(lpsHome, LPS + "components", ref));
        const candidates = roots.flatMap((r) => [r, resolvePath(r, "library.lzx")]);
        for (const abs of candidates) {
            try {
                return { source: rdText(abs), id: abs };
            }
            catch {
                /* try next */
            }
        }
        return null;
    };
    // Auto-include map: component tag -> library path (relative to lps/components).
    const autoincludes = {};
    if (lpsHome) {
        try {
            const txt = rdText(canon(resolvePath(lpsHome, AUTOINC)));
            for (const line of txt.split("\n")) {
                const m = /^\s*([\w-]+)\s*[:=]\s*(\S+)/.exec(line);
                if (m && !line.trimStart().startsWith("#"))
                    autoincludes[m[1]] = m[2];
            }
        }
        catch {
            /* no autoincludes file */
        }
    }
    // Dataset src: read the referenced XML file relative to the INCLUDING file's
    // directory (CompilationEnvironment.resolveReference uses the element's source-
    // file parent), with the app dir as a fallback. So lzpix's classes/dataman.lzx
    // `src="../data/canned_favorites.xml"` resolves from classes/ → data/.
    const resolveDatasetSrc = (ref, fromId) => {
        const base = fromId ? dirname(fromId) : appDir;
        const cands = base === appDir ? [resolvePath(appDir, ref)] : [resolvePath(base, ref), resolvePath(appDir, ref)];
        for (const abs of cands) {
            try {
                return rdText(canon(abs));
            }
            catch { /* next */ }
        }
        return null;
    };
    // Script src: a `<script src="json.js"/>` reads the referenced JS file relative
    // to the INCLUDING file's directory (CompilationEnvironment.resolveReference uses
    // the element's source-file parent), with the component base as a fallback. The
    // file's raw text becomes the script body (prefixed by the oracle with a `#file
    // <src>\n#line 1` directive — here the caller passes file=<src>, baseLine=1).
    const resolveScriptSrc = (ref, fromId) => {
        const base = fromId ? dirname(fromId) : appDir;
        const cands = [resolvePath(base, ref)];
        if (lpsHome && !ref.startsWith("/"))
            cands.push(resolvePath(lpsHome, LPS + "components", ref));
        if (lpsHome && ref.startsWith("/"))
            cands.push(resolvePath(lpsHome, LPS + "components", ref.slice(1)));
        for (const abs of cands) {
            try {
                return rdText(canon(abs));
            }
            catch { /* next */ }
        }
        return null;
    };
    // Debug directive filename: a faithful port of the oracle's
    // Parser.getUserPathname (CompilationEnvironment.setApplicationFile +
    // FileUtils.adjustRelativePath). Each file's source-location directive uses the
    // SHORTEST pathname relative to a search-path dir: [app-file parent (canonical),
    // components, fonts, LFC]. So the app file relativizes to its basename
    // (`browser-integration-$19.lzx`) and library files to a component-relative path
    // (`base/colors.lzx`, `utils/layouts/simpleboundslayout.lzx`). The `/tmp` symlink
    // is why dbg3 keeps its full `/tmp/dbg3.lzx`: the app file's non-canonical
    // sourceDir (`/tmp`) differs from basePathnames[0] = canon(parent) =
    // `/private/tmp`, so the relativized `../../tmp/dbg3.lzx` is LONGER and loses.
    const sourceId = resolvePath(sourcePath);
    const basePathnames = [appDir];
    if (lpsCanon)
        basePathnames.push(canon(resolvePath(lpsCanon, LPS + "components")), canon(resolvePath(lpsCanon, LPS + "fonts")), canon(resolvePath(lpsCanon, LPS + "lfc")));
    const debugFileName = (id) => {
        // The app file uses its as-given (non-canonical) path so the /tmp-symlink quirk
        // survives; library files use the canonical path (mirrors FileResolver, whose
        // pathnames live under the real component dir that basePathnames is canon'd to).
        const isApp = id === sourceId || canon(id) === canon(sourceId);
        return getUserPathname(isApp ? sourceId : canon(id), basePathnames);
    };
    return { resolveResource, resolveResourceFrames, resolveFont, spritePath, resolveInclude, autoincludes, resolveDatasetSrc, resolveScriptSrc, sourceId, debugFileName };
}
