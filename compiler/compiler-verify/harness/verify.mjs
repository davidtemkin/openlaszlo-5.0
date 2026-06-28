// Self-contained oracle-vs-TS differential harness for the OpenLaszlo distro.
//
// Drives the bundled minimal-LPS_HOME oracle (../oracle/lzc.sh) and the distro
// TypeScript compiler (../../dist/cli.js) over the distro's own .lzx programs +
// the runtime LFC sources, and asserts byte-for-byte parity of the NORMALIZED
// output. It is a self-contained PORT of the canonical development harness
// (modern-build/compiler/harness/batch.mjs), retargeted at distro-resident
// inputs and at this directory's external-dependency model:
//   * the Java 4.9.0 oracle is reached via ../oracle/lzc.sh ($JAVA_HOME +
//     $OL_ORACLE_JAR — neither bundled; see ../README.md);
//   * NO golds are committed — every gold is regenerated into a local,
//     gitignored cache (.goldcache* / .goldcache-lfc).
//
// MODES (run `node harness/verify.mjs` with no args for the usage list):
//
//   App-compile (production / debug / profile), docs-program corpus:
//     build  <dir|file...>   oracle-compile *.lzx (production) -> .goldcache
//     check                  TS port vs .goldcache (refuse-or-match)      [346/0/0]
//     check-debug            force-debug TS vs the debug-source golds      [78/0/0]
//     build-profile [dir]    oracle --profile golds -> .goldcache-profile
//     check-profile          TS --profile vs .goldcache-profile           [263/0/0]
//     show   <name>          first-divergence detail for one cached gold
//     live   <dir|file...>   compile BOTH fresh (no cache), production+debug
//
//   The LFC library build (runtime/lfc-src/ -> the 4 LFC golds):
//     build-oracle-lfc       oracle-build the 4 LFC golds -> .goldcache-lfc
//     check-lfc              TS --lfc            vs gold  [426989]
//     check-lfc-debug        TS --lfc + debug    vs gold  [1179477]
//     check-lfc-backtrace    TS --lfc + backtrace vs gold [2207200]
//     check-lfc-profile      TS --lfc + profile  vs gold  [1463512]
//
//   Real apps + single-program byte probes:
//     check-dashboard [main] examples/dashboard byte-parity (live)  [BYTE-IDENTICAL]
//     build-explorer-solo / check-explorer-solo     nav-derived SOLO set   [62/0/0]
//     build-explorer-debug / check-explorer-debug   nav-derived DEBUG set  [62/0/0]
//     dbg3   [file]          forced-debug RAW byte probe (bundled dbg3.lzx) [845661]
//     btshow [file]          backtrace RAW byte probe (backtrace.lzx)     [1340227]
//
// Prerequisites (see ../README.md): $JAVA_HOME (JDK 17), $OL_ORACLE_JAR (the
// prebuilt OL 4.9.0 compiler classpath), and the TS compiler built (npm run build).

import { execFileSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync,
  readdirSync, statSync, rmSync, cpSync,
} from "node:fs";
import { basename, resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));        // .../compiler-verify/harness
const VERIFY = resolve(HERE, "..");                          // .../compiler-verify
const OL_ROOT = resolve(HERE, "..", "..", "..");             // .../openlaszlo-5.0
const LZC = join(VERIFY, "oracle", "lzc.sh");               // bundled oracle driver
const CLI = resolve(VERIFY, "..", "dist", "cli.js");        // distro TS compiler
const LPS_HOME = join(VERIFY, "oracle", "lps-home");        // minimal LPS_HOME

const CACHE = join(VERIFY, ".goldcache");                   // production app golds
const PROFILE_CACHE = join(VERIFY, ".goldcache-profile");   // profile app golds
const EXPLORER_CACHE = join(VERIFY, ".goldcache-explorer-solo");
const EXPLORER_DEBUG_CACHE = join(VERIFY, ".goldcache-explorer-debug");
const LFC_CACHE = join(VERIFY, ".goldcache-lfc");           // the 4 regenerated LFC golds

const DOCS_CORPUS = join(OL_ROOT, "docs/src/developers/programs");
const LFC_ROOT = join(OL_ROOT, "runtime/lfc-src/LaszloLibrary.lzs");
const DASHBOARD = join(OL_ROOT, "examples/dashboard/dashboard.lzx");
const BACKTRACE = join(DOCS_CORPUS, "backtrace.lzx");
const DBG3 = join(HERE, "fixtures", "dbg3.lzx");
const NAV = join(OL_ROOT, "explorer/nav_dhtml.xml");

const NORM = "1970-01-01T00:00:00Z";
const MAXBUF = 256 * 1024 * 1024;

// ---- normalizer: identical policy to batch.mjs PLUS the distro-symlink path
// canonicalization. (1) appbuilddate (embedded compile time). (2) multi-frame
// enumeration ORDER (the oracle's JVM File.list() order; sort BOTH sides). (3)
// the sprite-sheet machinery (the distro ships sprites:"none"). (4) the
// component/font source-path PREFIX in `#file`/reportException/displayName
// attributions: lps-home/lps/components is a SYMLINK into ../../runtime/, which
// the oracle's relativePath canonicalizes into an escaping `../../../../runtime/
// components/…` path while the TS port keeps the logical `base/colors.lzx` form.
// Both denote the SAME source file + line; strip the layout-dependent prefix so
// the gate compares source identity + line, not where the resources live.
function normalize(js) {
  js = js.replace(/appbuilddate:( ?)"[^"]*"/g, (_, sp) => `appbuilddate:${sp}"${NORM}"`);
  js = js.replace(/LzResourceLibrary\.[\w$]+=\{[^}]*\}/g, (def) => {
    def = def.replace(/(width|height):(\d+(?:\.\d+)?)/g, (_, k, v) => `${k}:${Math.round(+v)}`);
    def = def.replace(/frames:\[([^\]]*)\]/, (_, list) =>
      "frames:[" + (list.match(/'[^']*'/g) || []).sort().join(",") + "]");
    def = def.replace(/,sprite:'[^']*'/g, "");
    def = def.replace(/,spriteoffset:\d+/g, "");
    return def;
  });
  js = js.replace(/LzResourceLibrary\.__allcss=\{path:'[^']*'\};?/g, "");
  js = js.replace(/\/?(?:[\w.$\-]+\/|\.\.\/)*(?:components|fonts)\//g, "");
  return js;
}

function die(msg) { console.error(msg); process.exit(2); }
function checkEnv() {
  if (!process.env.JAVA_HOME) die("verify.mjs: ERROR $JAVA_HOME unset (need JDK 17). See ../README.md");
  if (!process.env.OL_ORACLE_JAR) die("verify.mjs: ERROR $OL_ORACLE_JAR unset (prebuilt OL 4.9.0 classpath). See ../README.md");
  if (!existsSync(CLI)) die(`verify.mjs: ERROR TS compiler not built at ${CLI} (run: cd openlaszlo-5.0/compiler && npm run build)`);
}
function needCli() {
  if (!existsSync(CLI)) die(`verify.mjs: ERROR TS compiler not built at ${CLI} (run: cd openlaszlo-5.0/compiler && npm run build)`);
}

const keyOf = (src) => basename(src).replace(/\.lzx$/, "");
const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const errOf = (e) => (e.stderr || "").toString().trim().replace(/^UNSUPPORTED:\s*/, "").split("\n")[0]
  || String(e.message).split("\n")[0];

// Collect .lzx sources from dirs/files (non-recursive for dirs, like batch.mjs).
function collect(args) {
  const out = [];
  for (const a of args) {
    const p = resolve(a);
    if (!existsSync(p)) die(`verify.mjs: no such path ${p}`);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith(".lzx")) out.push(join(p, f));
    } else if (p.endsWith(".lzx")) out.push(p);
  }
  if (!out.length) die("verify.mjs: no .lzx programs found");
  return out;
}

// Only standalone <canvas> programs (the oracle refuses <library>/fragment roots).
function isCanvas(file) {
  let txt; try { txt = readFileSync(file, "utf8"); } catch { return false; }
  const s = txt.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const m = s.match(/<\s*([a-zA-Z][\w-]*)/);
  return !!m && m[1].toLowerCase() === "canvas";
}

// ----- oracle / TS drivers -------------------------------------------------
// The oracle ALWAYS writes its `<name>.sprite.png` resource montage NEXT TO THE
// SOURCE (and next to co-located resource dirs for multi-file apps) — there is no
// option to disable or relocate it. The distro source tree is read-only, so we
// snapshot the *.sprite.png set under the source's directory before compiling and
// delete ONLY the ones the oracle newly created, preserving any pre-existing.
function listSprites(dir) {
  const out = [];
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSprites(p));
    else if (e.name.endsWith(".sprite.png")) out.push(p);
  }
  return out;
}

// Oracle-compile a <canvas> app; returns NORMALIZED text. opts: {solo, debug, profile}.
function oracleApp(src, { solo = false, debug = false, profile = false } = {}) {
  const out = mkdtempSync(join(tmpdir(), "lzc-verify-"));
  const name = keyOf(src) + ".dhtml.js";
  const srcDir = dirname(src);
  const spritesBefore = new Set(listSprites(srcDir));
  const args = ["--runtime=dhtml", "--dir", out, "-o", name];
  if (debug) args.unshift("--debug");
  if (profile) args.push("--profile");
  args.push(src);
  try {
    execFileSync("bash", [LZC, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(solo ? { LZC_SOLO: "1" } : {}) },
      timeout: 240000, maxBuffer: MAXBUF,
    });
    const o = join(out, name);
    if (!existsSync(o)) throw new Error("no oracle output");
    return normalize(readFileSync(o, "utf8"));
  } finally {
    try { rmSync(out, { recursive: true, force: true }); } catch {}
    for (const p of listSprites(srcDir)) if (!spritesBefore.has(p)) { try { rmSync(p); } catch {} }
  }
}

// TS-compile a <canvas> app; returns NORMALIZED text. opts: {solo, debug, profile}.
// LZC_SPRITES=none: the distro ships sprites:"none" (normalize() strips the oracle
// gold's sprite refs to match), AND it stops the TS CLI from writing a `<name>.sprite.png`
// montage next to the (read-only) distro source. Never drop it.
function tsApp(src, { solo = false, debug = false, profile = false } = {}) {
  const env = { ...process.env, LPS_HOME, LZC_SPRITES: "none" };
  if (solo) env.LZC_SOLO = "1";
  if (debug) env.LZC_DEBUG_FORCE = "1";
  if (profile) env.LZC_PROFILE = "1";
  return normalize(execFileSync("node", [CLI, src], {
    stdio: ["ignore", "pipe", "pipe"], env, timeout: 240000, maxBuffer: MAXBUF,
  }).toString());
}

// ----- program-set discovery (distro-resident) ----------------------------
// The docs program corpus (the 346-canvas app-compile set): every standalone
// <canvas> under docs/src/developers/programs.
function corpusPrograms() {
  if (!existsSync(DOCS_CORPUS)) die(`verify.mjs: docs corpus not found at ${DOCS_CORPUS}`);
  return readdirSync(DOCS_CORPUS).filter((f) => f.endsWith(".lzx")).sort()
    .map((f) => join(DOCS_CORPUS, f)).filter(isCanvas);
}

// The Laszlo-Explorer nav-derived set: the Explorer app itself + every <canvas>
// program its nav_dhtml.xml links. Nav URLs are root-relative (`/animation/…`);
// they resolve under openlaszlo-5.0/ or openlaszlo-5.0/explorer/.
function explorerPrograms() {
  const out = []; const seen = new Set();
  const add = (disk) => {
    if (!existsSync(disk) || !isCanvas(disk)) return;
    const key = relative(OL_ROOT, disk).replace(/\.lzx$/, "").replace(/[\/\\]/g, "-").replace(/[^A-Za-z0-9_.-]/g, "_");
    if (seen.has(key)) return; seen.add(key);
    out.push({ key, disk });
  };
  add(join(OL_ROOT, "explorer/explore-nav.lzx"));
  try {
    const xml = readFileSync(NAV, "utf8");
    const urls = new Set();
    for (const m of xml.matchAll(/(?:src|popup|href)="([^"]*\.lzx)[^"]*"/g)) urls.add(m[1].split("?")[0]);
    for (const u of [...urls].sort()) {
      const rel = u.replace(/^\//, "");
      const d1 = join(OL_ROOT, rel), d2 = join(OL_ROOT, "explorer", rel);
      if (existsSync(d1)) add(d1); else add(d2);
    }
  } catch { /* no nav */ }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ----- generic differential over a gold cache ------------------------------
// Each cache holds <key>.gold (NORMALIZED oracle output) + <key>.src (the source
// path). `tsOpts` selects the TS mode. `filter` (optional) selects a gold subset.
function checkCache(cacheDir, tsOpts, { label, filter } = {}) {
  if (!existsSync(cacheDir)) die(`verify.mjs: no gold cache at ${cacheDir}; run the matching build* first`);
  let golds = readdirSync(cacheDir).filter((f) => f.endsWith(".gold")).sort();
  if (filter) golds = golds.filter((g) => filter(readFileSync(join(cacheDir, g), "utf8")));
  let ok = 0; const diffs = []; const unsup = {};
  for (const g of golds) {
    const name = g.replace(/\.gold$/, "");
    const src = readFileSync(join(cacheDir, name + ".src"), "utf8").trim();
    const gold = normalize(readFileSync(join(cacheDir, g), "utf8")); // re-normalize (idempotent)
    let mine;
    try { mine = tsApp(src, tsOpts); }
    catch (e) { const k = errOf(e); unsup[k] = (unsup[k] || 0) + 1; continue; }
    if (mine === gold) ok++;
    else { const pos = firstDiff(gold, mine); diffs.push({ name, pos, gold: gold.slice(Math.max(0, pos - 40), pos + 40), mine: mine.slice(Math.max(0, pos - 40), pos + 40) }); }
  }
  const unsupN = Object.values(unsup).reduce((a, b) => a + b, 0);
  console.log(`\n== ${label}: ${ok} match, ${diffs.length} diff, ${unsupN} unsup (of ${golds.length}) ==`);
  if (diffs.length) {
    console.log("\n--- DIFFS (first-divergence offset) ---");
    for (const d of diffs.sort((a, b) => a.pos - b.pos)) console.log(`  diff@${d.pos}  ${d.name}\n    gold …${d.gold}\n    mine …${d.mine}`);
  }
  if (unsupN) {
    console.log("\n--- UNSUP (by frequency) ---");
    for (const [r, c] of Object.entries(unsup).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${r}`);
  }
  return { ok, diff: diffs.length, unsup: unsupN, total: golds.length };
}

// ----- single-program RAW byte probe (no normalize stripping beyond appbuilddate/path) ---
function rawProbe(label, gold, mine) {
  const pos = firstDiff(gold, mine);
  console.log(`\n== ${label}: mine=${mine.length} gold=${gold.length} ==`);
  if (pos >= gold.length && pos >= mine.length) console.log("RAW IDENTICAL — byte-for-byte!");
  else {
    console.log(`first divergence @${pos}`);
    console.log(`GOLD: …${JSON.stringify(gold.slice(Math.max(0, pos - 80), pos + 100))}`);
    console.log(`MINE: …${JSON.stringify(mine.slice(Math.max(0, pos - 80), pos + 100))}`);
  }
}

// ----- LFC: regenerate the 4 oracle golds + the 4 differentials ------------
const LFC_VARIANTS = {
  "LFCdhtml.js":           { scFlags: [], tsEnv: {} },
  "LFCdhtml-debug.js":     { scFlags: ["--option", "nameFunctions", "--option", "warnGlobalAssignments", "-D$debug=true"], tsEnv: { LZC_DEBUG_FORCE: "1" } },
  "LFCdhtml-backtrace.js": { scFlags: ["--option", "debugBacktrace", "--option", "nameFunctions", "--option", "warnGlobalAssignments", "-D$debug=true"], tsEnv: { LZC_BACKTRACE: "1" } },
  "LFCdhtml-profile.js":   { scFlags: ["--profile"], tsEnv: { LZC_PROFILE: "1" } },
};

function buildOracleLfc() {
  checkEnv();
  if (!existsSync(LFC_ROOT)) die(`verify.mjs: LFC source not found at ${LFC_ROOT}`);
  if (!existsSync(LFC_CACHE)) mkdirSync(LFC_CACHE);
  // Build from a SCRATCH copy so we never write into the source tree (lzsc
  // resolves #include relative to CWD, so we must run from the LFC source dir).
  const scratch = mkdtempSync(join(tmpdir(), "lfc-verify-"));
  cpSync(dirname(LFC_ROOT), scratch, { recursive: true });
  try {
    for (const [outName, v] of Object.entries(LFC_VARIANTS)) {
      const outPath = join(LFC_CACHE, outName);
      execFileSync("bash", [LZC,
        "--option", "generatePredictableTemps=true", ...v.scFlags,
        "--runtime=dhtml", `-o${outPath}`, "--default=LaszloLibrary.lzs"], {
        cwd: scratch, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LZC_SC: "1" }, timeout: 300000, maxBuffer: MAXBUF,
      });
      const sz = statSync(outPath).size;
      console.log(`  ${String(sz).padStart(8)}  ${outName}`);
    }
    console.log(`LFC golds rebuilt in ${LFC_CACHE}`);
  } finally { try { rmSync(scratch, { recursive: true, force: true }); } catch {} }
}

function checkLfc(outName, tsEnv) {
  needCli();
  const goldPath = join(LFC_CACHE, outName);
  if (!existsSync(goldPath)) die(`verify.mjs: no LFC gold at ${goldPath}; run 'build-oracle-lfc' first`);
  const gold = readFileSync(goldPath, "utf8");
  let mine;
  try {
    mine = execFileSync("node", [CLI, "--lfc", LFC_ROOT], {
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LPS_HOME, ...tsEnv },
      timeout: 240000, maxBuffer: MAXBUF,
    }).toString();
  } catch (e) { console.log(`${outName} TS BUILD FAILED: ${errOf(e)}`); process.exit(1); }
  rawProbe(outName, gold, mine);
}

// =========================== command dispatch ==============================
const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "build" || cmd === "regen") {
  // Oracle-compile each .lzx (PRODUCTION) into .goldcache. Programs whose canvas
  // declares debug="true" come out as DEBUG golds automatically (source-driven);
  // check-debug isolates those. The oracle skips non-<canvas> roots.
  checkEnv();
  if (!existsSync(CACHE)) mkdirSync(CACHE);
  const srcs = collect(args.length ? args : [DOCS_CORPUS]);
  let ok = 0, skip = 0;
  for (const src of srcs) {
    const k = keyOf(src);
    try {
      const gold = oracleApp(src, {});
      writeFileSync(join(CACHE, k + ".gold"), gold);
      writeFileSync(join(CACHE, k + ".src"), src);
      ok++;
    } catch { skip++; }
    if ((ok + skip) % 25 === 0) console.error(`  ...${ok + skip}/${srcs.length} (${ok} gold, ${skip} skip)`);
  }
  console.log(`build: ${ok} gold, ${skip} skipped (oracle can't compile standalone) -> ${CACHE}`);
} else if (cmd === "check") {
  // PRODUCTION differential (refuse-or-match). debug="true" programs are compiled
  // by the TS port's source-driven debug backend (no force flag) — they must match.
  needCli();
  checkCache(CACHE, {}, { label: "check (production)" });
} else if (cmd === "check-debug") {
  // FORCED-DEBUG differential over the debug-source golds (those carrying the
  // `/* -*- file:` source-location directives). LZC_DEBUG_FORCE=1.
  needCli();
  checkCache(CACHE, { debug: true }, {
    label: "check-debug", filter: (g) => g.includes("/* -*- file:"),
  });
} else if (cmd === "build-profile") {
  // APP-PROFILE gold builder: oracle --profile over each NON-debug <canvas> app
  // (every function gets the $lzprofiler call/return timing meter). Skips
  // debug="true"/compileroptions-debug/<debug> programs (out of scope for the
  // production ?profile instrumentation). -> .goldcache-profile.
  checkEnv();
  if (!existsSync(PROFILE_CACHE)) mkdirSync(PROFILE_CACHE);
  const dir = args[0] ? resolve(args[0]) : DOCS_CORPUS;
  let files = (statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => f.endsWith(".lzx")).map((f) => join(dir, f))
    : [dir]).sort();
  files = files.filter((f) => {
    if (!isCanvas(f)) return false;
    const s = readFileSync(f, "utf8");
    const canvas = (s.match(/<canvas[^>]*>/) || [""])[0];
    if (/\bdebug\s*=\s*"true"/.test(canvas)) return false;
    if (/compileroptions\s*=\s*"[^"]*debug\s*:\s*true/.test(canvas)) return false;
    if (/<debug[\s/>]/.test(s)) return false;
    return true;
  });
  let ok = 0, skip = 0;
  for (const src of files) {
    const k = keyOf(src);
    try {
      writeFileSync(join(PROFILE_CACHE, k + ".gold"), oracleApp(src, { profile: true }));
      writeFileSync(join(PROFILE_CACHE, k + ".src"), src);
      ok++;
    } catch { skip++; }
    if ((ok + skip) % 25 === 0) console.error(`  ...${ok + skip}/${files.length} (${ok} gold, ${skip} skip)`);
  }
  console.log(`build-profile: ${ok} gold, ${skip} skipped (of ${files.length}) -> ${PROFILE_CACHE}`);
} else if (cmd === "check-profile") {
  needCli();
  checkCache(PROFILE_CACHE, { profile: true }, { label: "check-profile" });
} else if (cmd === "build-explorer-solo" || cmd === "build-explorer-debug") {
  // Oracle-compile each nav-derived Explorer program in SOLO (proxied=false),
  // production or --debug, into the matching gold cache.
  checkEnv();
  const debug = cmd === "build-explorer-debug";
  const dir = debug ? EXPLORER_DEBUG_CACHE : EXPLORER_CACHE;
  if (!existsSync(dir)) mkdirSync(dir);
  const progs = explorerPrograms();
  let ok = 0; const failed = [];
  for (const { key, disk } of progs) {
    try {
      writeFileSync(join(dir, key + ".gold"), oracleApp(disk, { solo: true, debug }));
      writeFileSync(join(dir, key + ".src"), disk);
      ok++;
    } catch (e) { failed.push(`${key}: ${errOf(e)}`); }
    if ((ok + failed.length) % 10 === 0) console.error(`  ...${ok + failed.length}/${progs.length} (${ok} gold)`);
  }
  console.log(`${cmd}: ${ok} gold, ${failed.length} oracle-failed (of ${progs.length}) -> ${dir}`);
  for (const f of failed) console.log("  ORACLE-FAIL " + f);
} else if (cmd === "check-explorer-solo") {
  needCli();
  checkCache(EXPLORER_CACHE, { solo: true }, { label: "check-explorer-solo" });
} else if (cmd === "check-explorer-debug") {
  needCli();
  checkCache(EXPLORER_DEBUG_CACHE, { solo: true, debug: true }, { label: "check-explorer-debug" });
} else if (cmd === "build-oracle-lfc") {
  buildOracleLfc();
} else if (cmd === "check-lfc") {
  checkLfc("LFCdhtml.js", LFC_VARIANTS["LFCdhtml.js"].tsEnv);
} else if (cmd === "check-lfc-debug") {
  checkLfc("LFCdhtml-debug.js", LFC_VARIANTS["LFCdhtml-debug.js"].tsEnv);
} else if (cmd === "check-lfc-backtrace") {
  checkLfc("LFCdhtml-backtrace.js", LFC_VARIANTS["LFCdhtml-backtrace.js"].tsEnv);
} else if (cmd === "check-lfc-profile") {
  checkLfc("LFCdhtml-profile.js", LFC_VARIANTS["LFCdhtml-profile.js"].tsEnv);
} else if (cmd === "check-dashboard") {
  // Real-app byte-parity gate (live: oracle + TS, no cache). Production, non-SOLO.
  checkEnv();
  const main = args[0] ? resolve(args[0]) : DASHBOARD;
  if (!existsSync(main)) die(`verify.mjs: app not found at ${main}`);
  const gold = oracleApp(main, {});
  const mine = tsApp(main, {});
  const pos = firstDiff(gold, mine);
  console.log(`\n== ${basename(main)}: mine=${mine.length} gold=${gold.length} ==`);
  if (pos >= gold.length && pos >= mine.length) console.log("BYTE-IDENTICAL — match!");
  else {
    console.log(`first divergence @${pos}`);
    console.log(`GOLD: …${gold.slice(Math.max(0, pos - 70), pos + 90)}`);
    console.log(`MINE: …${mine.slice(Math.max(0, pos - 70), pos + 90)}`);
  }
} else if (cmd === "dbg3") {
  // Forced-debug RAW byte probe over the bundled synthetic dbg3.lzx (canvas
  // debug="true"). NON-SOLO (proxied), matching the canonical dbgshow probe.
  checkEnv();
  const src = args[0] ? resolve(args[0]) : DBG3;
  rawProbe(basename(src) + " (forced-debug)", oracleApp(src, {}), tsApp(src, { debug: true }));
} else if (cmd === "btshow") {
  // Backtrace RAW byte probe (DEBUG_BACKTRACE). SOLO + debug; the canvas
  // compileroptions="backtrace:true" drives the per-call-site instrumentation.
  checkEnv();
  const src = args[0] ? resolve(args[0]) : BACKTRACE;
  if (!existsSync(src)) die(`verify.mjs: backtrace program not found at ${src}`);
  rawProbe(basename(src) + " (backtrace)", oracleApp(src, { solo: true, debug: true }), tsApp(src, { solo: true, debug: true }));
} else if (cmd === "show") {
  needCli();
  const name = args[0] || die("verify.mjs show <name>");
  const src = readFileSync(join(CACHE, name + ".src"), "utf8").trim();
  const gold = normalize(readFileSync(join(CACHE, name + ".gold"), "utf8"));
  // Re-detect mode from the gold (debug golds carry the file directive).
  const debug = gold.includes("/* -*- file:");
  const mine = tsApp(src, { debug });
  rawProbe(name + (debug ? " (debug)" : ""), gold, mine);
} else if (cmd === "live") {
  // Compile BOTH fresh (no cache), production + forced-debug, for a quick spot check.
  checkEnv();
  const srcs = collect(args);
  for (const mode of [{}, { _dbg: true }]) {
    const debug = !!mode._dbg;
    let ok = 0; const diffs = [], unsup = [];
    for (const src of srcs) {
      const k = keyOf(src);
      let gold, mine;
      try { gold = oracleApp(src, { debug }); } catch (e) { unsup.push(`${k}: ORACLE ${errOf(e)}`); continue; }
      try { mine = tsApp(src, { debug }); } catch (e) { unsup.push(`${k}: ${errOf(e)}`); continue; }
      if (mine === gold) ok++;
      else { const pos = firstDiff(gold, mine); diffs.push(`  diff@${pos}  ${k}`); }
    }
    console.log(`\n===== ${debug ? "DEBUG" : "PRODUCTION"} =====`);
    console.log(`  ${ok} match, ${diffs.length} diff, ${unsup.length} unsup (of ${srcs.length})`);
    diffs.forEach((d) => console.log(d));
    unsup.forEach((u) => console.log("  unsup " + u));
  }
} else {
  console.log(`usage: node harness/verify.mjs <mode> [args]

  App-compile (docs program corpus):
    build [dir|file...]     oracle production golds -> .goldcache (default: docs corpus)
    check                   TS vs .goldcache                         [346/0/0]
    check-debug             forced-debug TS vs debug-source golds     [78/0/0]
    build-profile [dir]     oracle --profile golds -> .goldcache-profile
    check-profile           TS --profile vs .goldcache-profile        [263/0/0]
    show <name>             first-divergence detail for one cached gold
    live <dir|file...>      compile BOTH fresh (production + debug)

  LFC library build (runtime/lfc-src/):
    build-oracle-lfc        oracle-build the 4 LFC golds -> .goldcache-lfc
    check-lfc               TS --lfc            vs gold               [426989]
    check-lfc-debug         TS --lfc + debug    vs gold               [1179477]
    check-lfc-backtrace     TS --lfc + backtrace vs gold              [2207200]
    check-lfc-profile       TS --lfc + profile  vs gold               [1463512]

  Real apps + byte probes:
    check-dashboard [main]  examples/dashboard byte-parity (live) [BYTE-IDENTICAL]
    build-explorer-solo / check-explorer-solo    nav SOLO set         [62/0/0]
    build-explorer-debug / check-explorer-debug  nav DEBUG set        [62/0/0]
    dbg3 [file]             forced-debug RAW probe (bundled dbg3.lzx) [845661]
    btshow [file]           backtrace RAW probe (backtrace.lzx)       [1340227]
`);
  process.exit(1);
}
