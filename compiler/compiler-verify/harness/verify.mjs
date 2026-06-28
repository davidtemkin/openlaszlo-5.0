// Self-contained oracle-vs-TS differential harness for the OpenLaszlo distro.
//
// Drives the bundled minimal-LPS_HOME oracle (../oracle/lzc.sh, SOLO mode) and
// the distro TypeScript compiler (../../dist/cli.js) over a set of .lzx programs
// and reports byte-for-byte parity of the NORMALIZED output. NO golds are
// committed (they are ~hundreds of MB); `regen` writes them to a local,
// gitignored cache and `check` compares the TS port against that cache. `live`
// compiles BOTH fresh (no cache) for quick spot checks.
//
// Modes:
//   node harness/verify.mjs regen <dir|file...>    # oracle-compile -> .goldcache/
//   node harness/verify.mjs check <dir|file...>    # TS port vs .goldcache/
//   node harness/verify.mjs live  <dir|file...>    # compile BOTH fresh, compare
//   node harness/verify.mjs show  <file.lzx>       # first-divergence detail (live)
//
// Each mode runs BOTH the non-debug (nd) and debug (dbg) variant.
//
// Prerequisites (see ../README.md): $JAVA_HOME (JDK 17) and $OL_ORACLE_JAR
// (the prebuilt OL 4.9.0 compiler classpath).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LZC = join(HERE, "..", "oracle", "lzc.sh");                 // bundled oracle driver
const CLI = resolve(HERE, "..", "..", "dist", "cli.js");          // distro TS compiler
const LPS_HOME = resolve(HERE, "..", "oracle", "lps-home");       // minimal LPS_HOME
const CACHE = join(HERE, "..", ".goldcache");                     // gitignored
const SCRATCH = join(process.env.TMPDIR || "/tmp", `lzc-verify-scratch-${process.pid}`);
const NORM = "1970-01-01T00:00:00Z";

// ---- normalizer: identical semantics to modern-build/compiler/harness/batch.mjs.
// (1) appbuilddate is the one nondeterministic field (embedded compile time).
// (2) multi-frame enumeration ORDER is the oracle's JVM File.list() order (non-
//     portable); sort BOTH sides. (3) the distro ships sprites:"none", so the
//     sprite-sheet machinery is dropped — strip it from BOTH sides so the gate
//     compares the sheet-free form.
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
  // Canonicalize component/font source-path PREFIXES in debug source-location
  // attributions (`/* -*- file: PATH#N -*- */` and `$reportException("PATH",…)`).
  // The bundled lps-home symlinks lps/components -> the distro runtime tree, and
  // the oracle's relativePath canonicalizes that symlink into an escaping
  // `../../../../runtime/components/base/colors.lzx` path, whereas the TS compiler
  // keeps the logical components-relative form `base/colors.lzx`. Both denote the
  // SAME source file + line; strip the layout-dependent prefix (everything up to
  // and including `…/components/` or `…/fonts/`) on BOTH sides so the gate compares
  // the source identity + line, not where the resources physically live. (The
  // app's own file is already emitted basename-relative and is untouched.)
  js = js.replace(/\/?(?:[\w.$\-]+\/|\.\.\/)*(?:components|fonts)\//g, "");
  return js;
}

function die(msg) { console.error(msg); process.exit(2); }
function checkEnv() {
  if (!process.env.JAVA_HOME) die("verify.mjs: ERROR $JAVA_HOME unset (need JDK 17). See ../README.md");
  if (!process.env.OL_ORACLE_JAR) die("verify.mjs: ERROR $OL_ORACLE_JAR unset (prebuilt OL 4.9.0 classpath). See ../README.md");
  if (!existsSync(CLI)) die(`verify.mjs: ERROR TS compiler not built at ${CLI} (run: cd openlaszlo-5.0/compiler && npm run build)`);
}

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

// Oracle-compile <src> in the given mode; returns normalized output text.
// mode: "nd" (SOLO production) | "dbg" (SOLO + --debug).
function oracle(src, mode) {
  mkdirSync(SCRATCH, { recursive: true });
  const out = join(SCRATCH, "oracle.js");
  const args = ["--runtime=dhtml", "--dir", SCRATCH, "-o", "oracle.js"];
  if (mode === "dbg") args.unshift("--debug");
  execFileSync("bash", [LZC, ...args, src], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LZC_SOLO: "1" },
    timeout: 240000, maxBuffer: 256 * 1024 * 1024,
  });
  return normalize(readFileSync(out, "utf8"));
}

// TS-compile <src> in the given mode; returns normalized output text.
function ts(src, mode) {
  const env = { ...process.env, LPS_HOME, LZC_SOLO: "1", LZC_SPRITES: "none" };
  if (mode === "dbg") env.LZC_DEBUG_FORCE = "1";
  return normalize(execFileSync("node", [CLI, src], {
    stdio: ["ignore", "pipe", "pipe"], env,
    timeout: 240000, maxBuffer: 256 * 1024 * 1024,
  }).toString());
}

const keyOf = (src) => basename(src).replace(/\.lzx$/, "");
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "regen") {
  checkEnv();
  if (!existsSync(CACHE)) mkdirSync(CACHE);
  const srcs = collect(args);
  let nd = 0, dbg = 0; const fail = [];
  for (const src of srcs) {
    const k = keyOf(src);
    writeFileSync(join(CACHE, k + ".src"), src);
    for (const [mode, inc] of [["nd", () => nd++], ["dbg", () => dbg++]]) {
      try { writeFileSync(join(CACHE, `${k}.${mode}.gold`), oracle(src, mode)); inc(); }
      catch (e) { fail.push(`${k}.${mode}: ${String(e.stderr || e.message).split("\n").slice(-2).join(" | ").slice(0, 160)}`); }
    }
  }
  console.log(`regen: ${srcs.length} programs -> ${CACHE}`);
  console.log(`  nd gold: ${nd}, dbg gold: ${dbg}, oracle-failed: ${fail.length}`);
  for (const f of fail) console.log("  FAIL " + f);
} else if (cmd === "check" || cmd === "live") {
  checkEnv();
  if (cmd === "check" && !existsSync(CACHE)) die(`verify.mjs: no gold cache at ${CACHE}; run 'regen' first`);
  const srcs = cmd === "check"
    ? readdirSync(CACHE).filter((f) => f.endsWith(".src")).sort()
        .map((f) => readFileSync(join(CACHE, f), "utf8").trim())
    : collect(args);
  const result = {};
  for (const mode of ["nd", "dbg"]) {
    let ok = 0; const diffs = [], unsup = [];
    for (const src of srcs) {
      const k = keyOf(src);
      let gold;
      if (cmd === "check") {
        const gp = join(CACHE, `${k}.${mode}.gold`);
        if (!existsSync(gp)) continue;
        gold = normalize(readFileSync(gp, "utf8")); // re-normalize (idempotent) so normalizer changes apply

      } else {
        try { gold = oracle(src, mode); }
        catch (e) { unsup.push(`${k}: ORACLE ${String(e.stderr || e.message).split("\n").slice(-1)[0].slice(0, 120)}`); continue; }
      }
      let mine;
      try { mine = ts(src, mode); }
      catch (e) {
        unsup.push(`${k}: ${String(e.stderr || "").trim().replace(/^UNSUPPORTED:\s*/, "").split("\n")[0].slice(0, 120) || String(e.message).split("\n")[0]}`);
        continue;
      }
      if (mine === gold) ok++;
      else { const pos = firstDiff(gold, mine); diffs.push({ k, pos, gold: gold.slice(Math.max(0, pos - 40), pos + 40), mine: mine.slice(Math.max(0, pos - 40), pos + 40) }); }
    }
    result[mode] = { ok, diffs, unsup, total: ok + diffs.length + unsup.length };
  }
  for (const mode of ["nd", "dbg"]) {
    const r = result[mode];
    console.log(`\n===== ${mode === "nd" ? "NON-DEBUG" : "DEBUG"} =====`);
    console.log(`  ${r.ok} match, ${r.diffs.length} diff, ${r.unsup.length} unsup (of ${r.total})`);
    for (const d of r.diffs.sort((a, b) => a.pos - b.pos)) {
      console.log(`  diff@${d.pos}  ${d.k}`);
      console.log(`    gold …${d.gold.replace(/\n/g, "\\n")}`);
      console.log(`    mine …${d.mine.replace(/\n/g, "\\n")}`);
    }
    for (const u of r.unsup) console.log("  unsup " + u);
  }
} else if (cmd === "show") {
  checkEnv();
  const src = resolve(args[0] || die("verify.mjs show <file.lzx>"));
  for (const mode of ["nd", "dbg"]) {
    const gold = oracle(src, mode), mine = ts(src, mode);
    const pos = firstDiff(gold, mine);
    console.log(`\n===== ${mode} ${pos >= gold.length && pos >= mine.length ? "IDENTICAL" : "@" + pos} =====`);
    if (gold !== mine) {
      console.log(`GOLD …${gold.slice(Math.max(0, pos - 80), pos + 120)}`);
      console.log(`MINE …${mine.slice(Math.max(0, pos - 80), pos + 120)}`);
    }
  }
} else {
  console.log("usage: node harness/verify.mjs <regen|check|live|show> <dir|file...>");
  process.exit(1);
}
