// openlaszlo/compiler/index.mjs — the swappable compiler BACKEND adapter.
//
// TS-FIRST, oracle-fallback. Exposes the SAME compile(lzxAbsPath, opts) -> {siteDir,
// base, hash} contract the server's index.mjs already consumes, so index.mjs is
// unchanged. Strategy per request:
//
//   1. Try the byte-exact TypeScript compiler via compileFileCached() (closure cache
//      in server/.cache-ts/). The served <base>.lzx.js is byte-identical to the oracle
//      output (proven by modern-build/compiler/harness; the only field that differs is
//      the normalized `appbuilddate`, a cosmetic display timestamp).
//   2. If the TS compile is `unsupported` (or throws) -> FALL BACK to the Java oracle
//      (oracle.mjs, the verbatim phase-A path). Logged.
//   3. If the TS compile SUCCEEDS but emits `.sprite.png` montage references (which the
//      TS compiler references but does not GENERATE), we need those montages + the app's
//      packed resources. We reuse the oracle's site dir if one is already cached, swapping
//      in the TS <base>.lzx.js; otherwise we fall back to the oracle for that app and the
//      sprite-generation sub-gap is logged (see PACKAGING-LOG.md / README).
//
// Sprite-FREE apps (hello, loadmedia, many docs snippets) take the PURE TS path: TS JS +
// generated wrapper + the app's own assets, no Java at all.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { renderWrapper } from "../server/wrapper.mjs";
import { compile as oracleCompile, DIST, CACHE, WEBAPP, SCRATCH } from "./oracle.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIST, "..");

// The built TS compiler module (ESM). Imported lazily so the server still starts if the
// dist isn't built (oracle-only mode).
const TS_DIST = path.join(HERE, "dist/node.js");   // self-contained: built TS compiler next to this adapter
let _ts = null;
async function tsModule() {
  if (_ts === undefined) return null;
  if (_ts) return _ts;
  try { _ts = await import(pathToFileURL(TS_DIST).href); return _ts; }
  catch (e) { console.warn("[compiler] TS backend unavailable, oracle-only:", e.message); _ts = undefined; return null; }
}

// A real compiler-version string for the cache key: the dist build's mtime fingerprint +
// the gold-parity tag. Bumping the dist (rebuild) busts the TS cache automatically.
function tsCompilerVersion() {
  let stamp = "0";
  try { stamp = String(Math.floor(fs.statSync(TS_DIST).mtimeMs)); } catch {}
  return "ts-4.9.0+" + stamp;
}

const CACHE_TS = path.join(DIST, "server", ".cache-ts");   // closure-cache store (JS blobs + manifests)
const SITE_TS = path.join(DIST, "server", ".cache-ts-sites"); // assembled site dirs for the TS path
let _diskCache = null;
async function diskCache() {
  if (_diskCache) return _diskCache;
  const ts = await tsModule(); if (!ts) return null;
  _diskCache = new ts.DiskCache(CACHE_TS, tsCompilerVersion());
  return _diskCache;
}

// ---- sprite/resource analysis -----------------------------------------------------
// The TS compiler emits `sprite:'…/foo.sprite.png'` refs for component/app raster
// resources whose MONTAGE (a packed PNG sheet) only the oracle generates. If the JS has
// ANY sprite ref, the app needs oracle-built assets to render correctly.
function spriteRefs(js) {
  const out = new Set();
  for (const m of js.matchAll(/sprite:'([^']+)'/g)) out.add(m[1]);
  for (const m of js.matchAll(/resource:'([^']+\.sprite\.png)'/g)) out.add(m[1]);
  return out;
}

// ---- site assembly (pure TS path) -------------------------------------------------
// Copy the app's own assets (everything except .lzx sources + oracle-generated artifacts)
// into the site dir, so referenced images/fonts/media resolve under the mount.
function copyAppAssets(appDir, siteDir) {
  const SKIP_EXT = new Set([".lzx"]);
  const SKIP_NAME = new Set(["config.xml", "widget-icon.png", ".DS_Store"]);
  const walk = (src, rel) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.name === "lps") continue; // oracle bundle dir, never an app asset
      const sp = path.join(src, e.name), rp = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { walk(sp, rp); continue; }
      if (SKIP_EXT.has(path.extname(e.name)) || SKIP_NAME.has(e.name)) continue;
      if (e.name.endsWith(".lzx.js") || e.name.endsWith(".sprite.png") || e.name.endsWith(".wgt")) continue;
      const dst = path.join(siteDir, rp);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(sp, dst);
    }
  };
  walk(appDir, "");
}

// Stage the one runtime asset the wrapper's `serverroot: 'lps/resources/'` needs.
function stageServerroot(siteDir) {
  const dst = path.join(siteDir, "lps/resources/lps/includes");
  fs.mkdirSync(dst, { recursive: true });
  const blank = path.join(DIST, "runtime/includes/blank.gif");
  if (fs.existsSync(blank)) fs.copyFileSync(blank, path.join(dst, "blank.gif"));
}

// ---- cache key (TS site) ----------------------------------------------------------
// Mirror oracle.mjs's hash shape so multiple apps from one dir don't collide.
function siteHash(ts, lzxAbsPath, debug, lpsHome) {
  const base = path.basename(lzxAbsPath, ".lzx");
  const lpsTag = lpsHome === WEBAPP ? "" : "-ts" + ts.fnv1a(lpsHome).slice(0, 6);
  return base.replace(/[^A-Za-z0-9._-]/g, "_") + (debug ? "-dbg" : "") + lpsTag;
}

// ---- the adapter ------------------------------------------------------------------
// compile(lzxAbsPath, {debug, lpsHome}) -> {siteDir, base, hash, backend, tag, cached}
// `backend` ∈ {"ts","oracle"}; `tag` is the ETag (TS path); `cached` true on a TS cache hit.
export async function compile(lzxAbsPath, { debug = false, lpsHome = SCRATCH } = {}) {
  const appDir = path.dirname(lzxAbsPath);
  const base = path.basename(lzxAbsPath, ".lzx");
  const ts = await tsModule();
  const cache = ts ? await diskCache() : null;

  // The TS path can't currently produce a forced-debug build (the readable/sourcemap
  // backend is gated). Debug requests go straight to the oracle.
  if (ts && cache && !debug) {
    try {
      const r = ts.compileFileCached(lzxAbsPath, { lpsHome, debug: false, proxied: false }, cache);
      if (!r.unsupported) {
        const sprites = spriteRefs(r.js);
        if (sprites.size === 0) {
          // PURE TS PATH — no Java. Assemble a site dir from TS JS + app assets + wrapper.
          const hash = "ts-" + (r.tag || siteHash(ts, lzxAbsPath, debug, lpsHome));
          const siteDir = path.join(SITE_TS, hash, "site");
          const stamp = path.join(siteDir, ".tag");
          // Reuse an assembled site iff its stored tag matches (closure-fresh).
          if (!(fs.existsSync(path.join(siteDir, "index.html")) &&
                fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === (r.tag || ""))) {
            fs.rmSync(path.join(SITE_TS, hash), { recursive: true, force: true });
            fs.mkdirSync(siteDir, { recursive: true });
            fs.writeFileSync(path.join(siteDir, base + ".lzx.js"), r.js);
            copyAppAssets(appDir, siteDir);
            stageServerroot(siteDir);
            fs.writeFileSync(path.join(siteDir, "index.html"), renderWrapper({ base, debug }));
            fs.writeFileSync(stamp, r.tag || "");
          }
          console.log(`[compiler] TS  ${path.relative(DIST, lzxAbsPath)}${r.cached ? " (cache hit)" : ""}`);
          return { siteDir, base, hash, backend: "ts", tag: r.tag, cached: !!r.cached };
        }
        // SPRITE-DEPENDENT app: reuse oracle-built assets if a site is already cached,
        // swapping in the byte-exact TS JS. Else fall through to a full oracle build.
        const merged = mergeOntoOracleSite(lzxAbsPath, { debug, lpsHome }, r.js, base);
        if (merged) {
          console.log(`[compiler] TS+oracle-assets  ${path.relative(DIST, lzxAbsPath)} (${sprites.size} sprites)`);
          return { ...merged, backend: "ts", tag: r.tag, cached: false };
        }
        console.log(`[compiler] -> oracle (sprite montage gen)  ${path.relative(DIST, lzxAbsPath)} (${sprites.size} sprites)`);
      } else {
        console.log(`[compiler] -> oracle (unsupported: ${r.unsupported})  ${path.relative(DIST, lzxAbsPath)}`);
      }
    } catch (e) {
      console.log(`[compiler] -> oracle (TS error: ${e.message})  ${path.relative(DIST, lzxAbsPath)}`);
    }
  }

  // ORACLE FALLBACK (verbatim phase-A path).
  const info = oracleCompile(lzxAbsPath, { debug, lpsHome });
  console.log(`[compiler] oracle  ${path.relative(DIST, lzxAbsPath)}${debug ? " (debug)" : ""}`);
  return { ...info, backend: "oracle" };
}

// If the oracle already produced a site dir for this app (cached), reuse all of its
// assets (sprite montages, packed resources, lps tree) but overwrite <base>.lzx.js with
// the byte-exact TS output. Returns {siteDir, base, hash} or null if no oracle site
// exists yet (caller then does a full oracle build, which also gives us the sprites).
function mergeOntoOracleSite(lzxAbsPath, opts, tsJs, base) {
  // Probe the oracle cache without compiling: replicate oracle.mjs's hash to find the dir.
  let info;
  try { info = oracleCompile(lzxAbsPath, opts); } catch { return null; }
  // oracleCompile builds the site (incl. sprites) if absent; that's exactly what we want
  // when no cached site exists. Now swap in the TS JS so the SERVED js is the TS output.
  try {
    const jsPath = path.join(info.siteDir, base + ".lzx.js");
    if (fs.existsSync(jsPath)) fs.writeFileSync(jsPath, tsJs);
    return { siteDir: info.siteDir, base: info.base, hash: "tsjs-" + info.hash };
  } catch { return null; }
}

export { DIST, CACHE, WEBAPP, SCRATCH };
