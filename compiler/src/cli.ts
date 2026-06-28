// CLI: compile an LZX file to DHTML JS on stdout.
//   lzc-ts <file.lzx> [--solo | --proxied=false] [--debug] [--backtrace]
// SOLO build flag (or env LZC_SOLO=1) flips the single `__LZproxied` byte to
// "false" — the oracle's SOLO mode. Default is the proxied (normal) build.
// --debug / --backtrace (or LZC_DEBUG_FORCE=1 / LZC_BACKTRACE=1) select the debug
// and DEBUG_BACKTRACE (lzc -g2) backends; backtrace implies debug.
import { readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { compile, compileLibrary } from "./compile.js";
import { nodeOptions } from "./node-io.js";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));
const file = positional[0];
if (!file) {
  console.error("usage: lzc-ts <file.lzx> [--solo | --proxied=false]   |   lzc-ts --lfc <LaszloLibrary.lzs>");
  process.exit(2);
}

// LFC library-root mode: compile a bare `.lzs` library root (LaszloLibrary.lzs,
// full of `#include`s) to a production LFCdhtml.js. Includes resolve relative to
// the root file's directory (the oracle's fixed-base Resolver). ADDITIVE — does
// not affect the `<canvas>` app path.
if (flags.includes("--lfc")) {
  const rootSrc = readFileSync(file, "utf8");
  const base = dirname(file);
  const resolveInclude = (p: string): string | null => {
    try { return readFileSync(join(base, p), "utf8"); } catch { return null; }
  };
  // BACKTRACE LFC variant (`LFCdhtml-backtrace.js`): debug + DEBUG_BACKTRACE. Implies
  // debug. Selected via --backtrace or LZC_BACKTRACE=1.
  const lfcBacktrace = process.env.LZC_BACKTRACE === "1" || flags.includes("--backtrace");
  // PROFILE LFC variant (`LFCdhtml-profile.js`): nameFunctions + the `$lzprofiler`
  // per-function timing meter, $debug=false. Selected via --profile or LZC_PROFILE=1.
  const lfcProfile = process.env.LZC_PROFILE === "1" || flags.includes("--profile");
  const lfcDebug = lfcBacktrace || process.env.LZC_DEBUG_FORCE === "1" || flags.includes("--debug");
  try {
    // Synchronous write to fd 1 so a large LFC build is not truncated by exit.
    writeSync(1, compileLibrary(rootSrc, file.split("/").pop()!, resolveInclude, lfcDebug, lfcBacktrace, lfcProfile));
  } catch (e) {
    console.error("UNSUPPORTED: " + (e as Error).message);
    process.exit(3);
  }
  process.exit(0);
}
const src = readFileSync(file, "utf8");
const opts = nodeOptions(file, process.env.LPS_HOME);
// FORCED-DEBUG (development only): LZC_DEBUG_FORCE=1 drives the in-progress
// readable/source-mapped backend, bypassing the `canvas debug="true"` refusal.
if (process.env.LZC_DEBUG_FORCE === "1" || flags.includes("--debug")) opts.debug = true;
// DEBUG_BACKTRACE (lzc -g2): per-function call-stack frames + per-call line notes.
// Implies debug (the compiler forces it). Byte-for-byte vs the oracle (backtrace.lzx).
if (process.env.LZC_BACKTRACE === "1" || flags.includes("--backtrace")) opts.backtrace = true;
// PROFILE app build (lzc -p / --profile): nameFunctions (compress=false displayName-
// IIFEs) + the `$lzprofiler` per-function timing meter, $debug=false (production
// folding). Instruments the APP's OWN functions. Byte-for-byte vs the oracle --profile.
if (process.env.LZC_PROFILE === "1" || flags.includes("--profile")) opts.profile = true;
// SOLO build: emit __LZproxied="false" (the one-byte oracle SOLO delta).
if (process.env.LZC_SOLO === "1" || flags.includes("--solo") || flags.includes("--proxied=false"))
  opts.proxied = false;
// Sheet-free output: drop the sprite-sheet machinery (multi-frame resources render
// from individual frame PNGs). Default for the Java-free distro.
if (process.env.LZC_SPRITES === "none" || flags.includes("--no-sprites")) opts.sprites = "none";
const res = compile(src, opts);
if (res.unsupported) {
  console.error("UNSUPPORTED: " + res.unsupported);
  process.exit(3);
}
process.stdout.write(res.js);
