// CLI: compile an LZX file to DHTML JS on stdout.
//   lzc-ts <file.lzx> [--proxied] [--debug] [--backtrace] [--canvas]
// --canvas (or --runtime=canvas / LZC_CANVAS=1) targets the own-pixels canvas kernel
// (LFCcanvas.js); dhtml-family, so the app JS is byte-identical — it only sets $canvas.
// SOLO IS THE DEFAULT: `__LZproxied="false"`, so the compiled app fetches its data with
// a direct GET and runs on any static host — the same build the in-browser Service
// Worker and the Node server emit (both are SOLO-only). Opt into a PROXIED build with
// --proxied (or --no-solo / LZC_PROXIED=1) only when deploying behind an LPS server
// that proxies data requests; --solo / --proxied=false / LZC_SOLO=1 re-assert the default.
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
  console.error("usage: lzc-ts <file.lzx> [--proxied]   |   lzc-ts --lfc <LaszloLibrary.lzs>");
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
// CANVAS runtime target (`lzr=canvas`): compile for the own-pixels canvas kernel
// (LFCcanvas.js) instead of the managed-DOM lfc.js. Canvas is DHTML-family — the app
// bytes are byte-identical to a dhtml build; this ONLY sets the `$canvas` compile-time
// constant true (for `<switch><when property="$canvas">` / `<when runtime="canvas">`).
// Selecting the LFCcanvas.js kernel + loader wrapper is the deployer's job (server /
// Service Worker); the compiler emits the same app JS. `--runtime=canvas` mirrors the
// oracle's `--runtime=dhtml` spelling.
if (process.env.LZC_CANVAS === "1" || flags.includes("--canvas") || flags.includes("--runtime=canvas"))
  opts.canvas = true;
// SOLO by DEFAULT (__LZproxied="false"): the compiled app fetches data with a direct
// GET, so it runs on a static host — matching the Service Worker + Node-server
// compilers. Opt into a PROXIED build (__LZproxied="true", data routed through an LPS
// data-proxy server) with --proxied / --no-solo / LZC_PROXIED=1. An explicit
// --solo / --proxied=false / LZC_SOLO=1 re-asserts the default and wins on conflict.
opts.proxied = false;
if (process.env.LZC_PROXIED === "1" || flags.includes("--proxied") ||
    flags.includes("--proxied=true") || flags.includes("--no-solo"))
  opts.proxied = true;
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
