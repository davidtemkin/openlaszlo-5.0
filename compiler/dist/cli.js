// CLI: compile an LZX file to DHTML JS on stdout.
//   lzc-ts <file.lzx> [--solo | --proxied=false]
// SOLO build flag (or env LZC_SOLO=1) flips the single `__LZproxied` byte to
// "false" — the oracle's SOLO mode. Default is the proxied (normal) build.
import { readFileSync } from "node:fs";
import { compile } from "./compile.js";
import { nodeOptions } from "./node-io.js";
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));
const file = positional[0];
if (!file) {
    console.error("usage: lzc-ts <file.lzx> [--solo | --proxied=false]");
    process.exit(2);
}
const src = readFileSync(file, "utf8");
const opts = nodeOptions(file, process.env.LPS_HOME);
// FORCED-DEBUG (development only): LZC_DEBUG_FORCE=1 drives the in-progress
// readable/source-mapped backend, bypassing the `canvas debug="true"` refusal.
if (process.env.LZC_DEBUG_FORCE === "1")
    opts.debug = true;
// SOLO build: emit __LZproxied="false" (the one-byte oracle SOLO delta).
if (process.env.LZC_SOLO === "1" || flags.includes("--solo") || flags.includes("--proxied=false"))
    opts.proxied = false;
// Sheet-free output: drop the sprite-sheet machinery (multi-frame resources render
// from individual frame PNGs). Default for the Java-free distro.
if (process.env.LZC_SPRITES === "none" || flags.includes("--no-sprites"))
    opts.sprites = "none";
const res = compile(src, opts);
if (res.unsupported) {
    console.error("UNSUPPORTED: " + res.unsupported);
    process.exit(3);
}
process.stdout.write(res.js);
