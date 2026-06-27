// server/compile.mjs — server-side LZX→JS compile for the dynamic distro server.
//
// The byte-exact TypeScript compiler ONLY (no Java oracle), sheet-free (`sprites:"none"`,
// exactly like the in-browser SW path), with an on-disk closure cache. The sprite-montage /
// oracle-fallback machinery the old server-api had is unnecessary here: the distro is
// sheet-free, so the TS path is the whole story.
//
//   compileApp(srcAbs, { debug }) -> { js, tag, cached } | { unsupported }

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFileCached, DiskCache } from "../compiler/dist/node.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DISTRO = path.resolve(HERE, "..");
export const RUNTIME = path.join(DISTRO, "runtime");
const CACHE_DIR = path.join(HERE, ".cache-ts");

// node-io (the Node resolver inside compileFile) looks up the compiler's `sr` resources
// under lpsHome. It auto-detects layout: the original webapp NESTS them under
// `<home>/lps/{components,fonts,lfc}` + `<home>/WEB-INF/lps/misc/lzx-autoincludes.properties`,
// while the FLATTENED distro stores them directly at `<home>/{components,fonts,lfc}` +
// `<home>/lzx-autoincludes.properties`. Since the distro is flat, lpsHome=runtime resolves
// natively — no symlink overlay needed. Emitted resource paths come out as "components/…",
// which the SW's `proxyRuntime` serves from runtime/ (it strips `lps/resources/` + an
// optional `lps/`, then prepends RUNTIME).

// Cache version — bump when the compiler dist changes (its mtime), so a rebuild re-keys.
function compilerVersion() {
  let mt = "0";
  try { mt = String(Math.floor(fs.statSync(path.join(DISTRO, "compiler/dist/node.js")).mtimeMs)); } catch {}
  return "ts-4.9.0+" + mt;
}
const cache = new DiskCache(CACHE_DIR, compilerVersion());

export function compileApp(srcAbs, { debug = false } = {}) {
  return compileFileCached(
    srcAbs,
    { lpsHome: RUNTIME, sprites: "none", proxied: false, debug },
    cache,
  );
}
