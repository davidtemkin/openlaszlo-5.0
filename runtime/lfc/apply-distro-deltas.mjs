#!/usr/bin/env node
// apply-distro-deltas.mjs — turn a PRISTINE TS-built LFC into the SHIPPED distro LFC.
//
// The distro's runtime LFC is NOT hand-maintained. It is the pristine LFC that the
// TypeScript compiler builds byte-for-byte identical to the Java oracle gold
// (production lfc.js = 426874, debug lfc-debug.js = 1179351), PLUS exactly three
// small, documented "distro deltas" re-applied on top:
//
// NOTE on the debug build: the CORRECT debug LFC is the original `buildlfcdebug`
// build = `$debug=true` (full on-canvas runtime debugger with makeDebugWindow) +
// nameFunctions. An earlier shipped lfc-debug.js was mistakenly built from
// `--option debug=true` (source-location format with debugger STUBS, NO
// makeDebugWindow) — that phantom is wrong and broke `?debug=true`. The gold is
// modern-build/compiler/lfc-build/gold/LFCdhtml-debug.js = 1179351 bytes
// (makeDebugWindow=2, displayName=1723).
//
//   (a) use_css_sprites: false — flip LzSprite.quirks.use_css_sprites from the
//       pristine `true` to `false`. The Java-free distro renders multi-frame
//       resources from individual frame PNGs, not CSS sprite-sheets, so the
//       sprite-sheet code path is disabled.
//   (b) iOS touchcancel recovery — an appended self-contained IIFE that releases a
//       stuck mouse-down when mobile Safari fires `touchcancel` instead of `touchend`.
//       Source: distro-deltas/01-touchcancel.js
//   (c) colortransform / setColorTransform — an appended IIFE that implements the
//       missing DHTML sprite-kernel primitive LzSprite#setColorTransform (an SVG
//       feColorMatrix filter) and flips the `colortransform` capability on, so the
//       dashboard's window/scrollbar tinting works through the proper view API.
//       Source: distro-deltas/02-colortransform.js
//
// These deltas apply identically to BOTH the production and the debug LFC. The earlier
// shipped lfc-debug.js was a stale prebuilt that carried only (a)+(b) but NOT (c), so
// window tinting was broken in debug/backtrace mode. This script fixes that by applying
// all three to both builds from one source of truth.
//
// PIPELINE (the reproducible build):
//   runtime/lfc-src/  --[ TS compiler  --lfc ]-->  pristine LFC (== gold)
//                     --[ apply-distro-deltas.mjs ]-->  runtime/lfc/{lfc.js, lfc-debug.js}
//
// runtime/lfc-src/ stays PRISTINE — the deltas are NEVER folded into source, so the
// golds stay 426874 / 1179351.
//
// USAGE:
//   node apply-distro-deltas.mjs
//       Full pipeline: build both pristine LFCs from ../lfc-src/LaszloLibrary.lzs via
//       the distro compiler (../../compiler/dist/cli.js), apply the 3 deltas, and write
//       ./lfc.js (production) and ./lfc-debug.js (debug).
//
//   node apply-distro-deltas.mjs <pristine-in.js> <shipped-out.js>
//       Apply the 3 deltas to a single already-built pristine LFC (prod or debug — the
//       deltas auto-detect compressed vs spaced formatting). Use this to re-patch a
//       pristine build produced elsewhere.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DELTAS = join(HERE, "distro-deltas");
const LFC_SRC_ROOT = join(HERE, "..", "lfc-src", "LaszloLibrary.lzs");
const COMPILER_CLI = join(HERE, "..", "..", "compiler", "dist", "cli.js");

// --- the appended IIFE delta blocks (canonical source-of-truth files) -----------------
const TOUCHCANCEL = readFileSync(join(DELTAS, "01-touchcancel.js"), "utf8");
const COLORTRANSFORM = readFileSync(join(DELTAS, "02-colortransform.js"), "utf8");

/**
 * Apply all three distro deltas to a pristine LFC string and return the shipped string.
 * Works on both production (compressed: `use_css_sprites:true`) and debug (spaced:
 * `use_css_sprites: true`) builds.
 */
export function applyDistroDeltas(pristine, label = "LFC") {
  // Delta (a): flip the single LzSprite.quirks.use_css_sprites flag definition true->false.
  // The regex matches ONLY the object-literal definition (`use_css_sprites:` + optional
  // space + `true`), never the bracket reads (`use_css_sprites"]=`) or the conditionals
  // (`use_css_sprites&&` / `use_css_sprites){`). Assert exactly one hit so a future build
  // shape-change can't silently no-op the flip.
  const flagRe = /use_css_sprites(\s*):(\s*)true\b/g;
  const hits = (pristine.match(flagRe) || []).length;
  if (hits !== 1) {
    throw new Error(
      `[${label}] expected exactly 1 \`use_css_sprites:true\` definition to flip, found ${hits}`,
    );
  }
  let out = pristine.replace(flagRe, "use_css_sprites$1:$2false");

  // Deltas (b) + (c): append the two self-contained IIFE blocks. The pristine body ends
  // with `...lz["lzcontextmenu"]=$lzc$class_lzcontextmenu;` (no trailing newline); the
  // blocks are leading-`;`-guarded IIFEs, so join with a single newline (matches the
  // historical shipped layout).
  if (!out.endsWith("\n")) out += "\n";
  out += TOUCHCANCEL;        // already newline-terminated
  out += COLORTRANSFORM;     // already newline-terminated
  return out;
}

/** Build a pristine LFC from lfc-src via the distro TS compiler. mode = "prod" |
 *  "debug" | "backtrace" | "profile". The backtrace variant (LFCdhtml-backtrace.js =
 *  2207074) is the debug LFC + the DEBUG_BACKTRACE per-function call-stack-frame
 *  instrumentation. The profile variant (LFCdhtml-profile.js = 1463386) is the
 *  nameFunctions LFC + the `$lzprofiler` per-function call/return timing meter
 *  ($debug=false), selected via LZC_PROFILE=1. */
function buildPristine(mode) {
  const env =
    mode === "backtrace" ? { ...process.env, LZC_BACKTRACE: "1" }
    : mode === "profile" ? { ...process.env, LZC_PROFILE: "1" }
    : mode === "debug" ? { ...process.env, LZC_DEBUG_FORCE: "1" }
    : process.env;
  return execFileSync("node", [COMPILER_CLI, "--lfc", LFC_SRC_ROOT], {
    env, maxBuffer: 256 * 1024 * 1024,
  }).toString();
}

// --- CLI ------------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 2) {
  // Single-file mode: apply deltas to one pre-built pristine LFC.
  const pristine = readFileSync(args[0], "utf8");
  const shipped = applyDistroDeltas(pristine, args[0]);
  writeFileSync(args[1], shipped);
  console.log(`wrote ${args[1]} (${shipped.length} bytes) <- ${args[0]} (${pristine.length})`);
} else if (args.length === 0) {
  // Full pipeline: build all three pristine LFCs, apply deltas, write the shipped runtime.
  for (const [mode, label, outName] of [
    ["prod", "production", "lfc.js"],
    ["debug", "debug", "lfc-debug.js"],
    ["backtrace", "backtrace", "lfc-backtrace.js"],
    ["profile", "profile", "lfc-profile.js"],
  ]) {
    const pristine = buildPristine(mode);
    const shipped = applyDistroDeltas(pristine, label);
    const outPath = join(HERE, outName);
    writeFileSync(outPath, shipped);
    console.log(
      `${label}: pristine ${pristine.length} -> shipped ${outName} ${shipped.length} bytes`,
    );
  }
} else {
  console.error("usage: apply-distro-deltas.mjs            (full pipeline -> lfc.js + lfc-debug.js)");
  console.error("       apply-distro-deltas.mjs <in> <out> (apply deltas to one pristine LFC)");
  process.exit(2);
}
