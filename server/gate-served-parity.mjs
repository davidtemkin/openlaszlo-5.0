#!/usr/bin/env node
// gate-served-parity.mjs — the SERVER byte-parity gate.
//
// The compiler harness already proves the TS compiler matches the Java oracle byte-for-
// byte. THIS gate proves the SERVER serves that exact output: for a set of examples it
//   (a) compiles via the server adapter (compiler/index.mjs) and reads the served
//       <base>.lzx.js out of the assembled site dir, and
//   (b) compiles the same app directly with the Java oracle (compiler/oracle.mjs) and
//       reads ITS <base>.lzx.js,
// then asserts the two are byte-identical after the harness's appbuilddate/sprite
// normalization (the only nondeterministic fields). It also exercises the closure cache:
// a second compile must be a cache HIT, and touching a dependency must INVALIDATE it.
//
//   node server/gate-served-parity.mjs
//
// Exit 0 = all parity + cache checks pass; nonzero on any mismatch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile as adapterCompile } from "../compiler/server-api.mjs";
import { compile as oracleCompile, SCRATCH } from "../compiler/oracle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..");
const EXAMPLES = path.join(DIST, "examples");
const NORM = "1970-01-01T00:00:00Z";

// Verbatim normalizer from modern-build/compiler/harness/batch.mjs — the SAME one that
// gates the compiler-core byte parity, so "served == oracle" means exactly what the
// harness "TS == oracle" means.
function normalize(js) {
  js = js.replace(/appbuilddate:( ?)"[^"]*"/g, (_, sp) => `appbuilddate:${sp}"${NORM}"`);
  js = js.replace(/LzResourceLibrary\.[\w$]+=\{[^}]*\}/g, (def) => {
    def = def.replace(/(width|height):(\d+(?:\.\d+)?)/g, (_, k, v) => `${k}:${Math.round(+v)}`);
    def = def.replace(/frames:\[([^\]]*)\]/, (_, list) =>
      "frames:[" + (list.match(/'[^']*'/g) || []).sort().join(",") + "]");
    def = def.replace(/sprite:'([^']*\/)[^']*'/, "sprite:'$1'");
    return def;
  });
  js = js.replace(/__allcss=\{path:'[^']*'\}/g, "__allcss={path:'SPRITE'}");
  return js;
}

// Resolve an example dir to its main .lzx (dir-name match, then app.lzx / index.lzx).
function mainLzx(dir) {
  const name = path.basename(dir);
  for (const c of [`${name}.lzx`, "app.lzx", "index.lzx"]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  // else first .lzx
  const f = fs.readdirSync(dir).find((f) => f.endsWith(".lzx"));
  return f ? path.join(dir, f) : null;
}

// The examples to gate. A mix: sprite-free (pure TS) + sprite-bearing (TS-js over oracle
// assets) so we prove parity of the SERVED js on both adapter sub-paths.
const HELLO = path.join(EXAMPLES, "ten-minutes/hello.lzx");  // sprite-free, pure TS
const APPS = [
  HELLO,                                 // pure-TS path (no sprites, no Java)
  path.join(EXAMPLES, "calendar"),       // sprite-bearing (components) -> TS js + oracle assets
  path.join(EXAMPLES, "dashboard"),      // the DoD app, multi-file + resources
];

let pass = 0, fail = 0;
const detail = [];

for (const entry of APPS) {
  if (!fs.existsSync(entry)) { detail.push(`SKIP  ${path.relative(DIST, entry)} (missing)`); continue; }
  const main = entry.endsWith(".lzx") ? entry : mainLzx(entry);
  if (!main) { detail.push(`SKIP  ${path.relative(DIST, entry)} (no .lzx)`); continue; }
  const base = path.basename(main, ".lzx");
  const rel = path.relative(DIST, main);

  let servedJs, oracleJs, backend;
  try {
    const a = await adapterCompile(main, { lpsHome: SCRATCH });
    backend = a.backend;
    servedJs = fs.readFileSync(path.join(a.siteDir, base + ".lzx.js"), "utf8");
  } catch (e) { detail.push(`FAIL  ${rel}: adapter threw ${e.message}`); fail++; continue; }

  try {
    const o = oracleCompile(main, { lpsHome: SCRATCH });
    oracleJs = fs.readFileSync(path.join(o.siteDir, base + ".lzx.js"), "utf8");
  } catch (e) { detail.push(`FAIL  ${rel}: oracle threw ${e.message}`); fail++; continue; }

  const ns = normalize(servedJs), no = normalize(oracleJs);
  if (ns === no) { detail.push(`OK    ${rel}  (${backend}, ${servedJs.length}B)`); pass++; }
  else {
    fail++;
    // first divergence
    let i = 0; while (i < ns.length && i < no.length && ns[i] === no[i]) i++;
    detail.push(`FAIL  ${rel}  served≠oracle @${i}\n   served: …${JSON.stringify(ns.slice(Math.max(0, i - 20), i + 40))}\n   oracle: …${JSON.stringify(no.slice(Math.max(0, i - 20), i + 40))}`);
  }
}

// ---- cache hit + invalidation (on the pure-TS app) --------------------------------
const cacheApp = HELLO;
if (cacheApp) {
  const r1 = await adapterCompile(cacheApp, { lpsHome: SCRATCH });
  const r2 = await adapterCompile(cacheApp, { lpsHome: SCRATCH });
  if (r2.cached && r1.tag === r2.tag) { detail.push(`OK    cache: 2nd compile is a HIT (tag ${r2.tag})`); pass++; }
  else { detail.push(`FAIL  cache: expected a hit, got cached=${r2.cached} tag1=${r1.tag} tag2=${r2.tag}`); fail++; }

  // touch a sibling dependency the closure tracked, then expect a recompile (miss).
  const dir = path.dirname(cacheApp);
  // touch the main file itself (always in the closure)
  const now = new Date();
  fs.utimesSync(cacheApp, now, now);
  const r3 = await adapterCompile(cacheApp, { lpsHome: SCRATCH });
  if (!r3.cached) { detail.push(`OK    cache: touching a dep INVALIDATED the cache (recompiled)`); pass++; }
  else { detail.push(`FAIL  cache: dep change did NOT invalidate (still cached)`); fail++; }
}

console.log(detail.join("\n"));
console.log(`\n== served-parity gate: ${pass} ok, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
