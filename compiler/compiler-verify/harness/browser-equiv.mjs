// ACCEPTANCE GATE for the browser track: prove the fetch→sync bridge + URL provider
// produce output BYTE-IDENTICAL to the Node disk path. We run compileInBrowser with
// a `fetchFn` SHIM that reads the local filesystem (returning file bytes + a
// synthetic ETag/Last-Modified derived from statSync mtime+size), and assert:
//   1. browser-driver JS  ===  compileFile(app,{lpsHome,sprites:"none"}).js   (THE proof)
//   2. the recorded closure file-set matches the Node closure file-set
//   3. a 2nd compileInBrowser is a cache HIT (same tag)
//   4. changing a dep's validator invalidates the cache
// plus reports how many fault-and-retry passes each app took to converge.
//
// Run: npm run test:browser   (after npm run build)

import { statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFile } from "../../dist/node.js";
import { compileInBrowser, BrowserCache, COMPILER_VERSION } from "../../dist/browser.js";

// Distro port: apps are distro-resident examples/. The LPS_HOME is the NESTED 4.9.0 servlet
// — the same external dep the oracle uses ($OL_ORACLE_JAR). Both the Node and browser paths
// read this one nested tree, so they emit matching `lps/components/…` serverroot paths and
// byte-identity isolates the in-browser compiler's LOGIC. (Against the flat runtime/ the two
// emit different serverroot *prefixes* by design — a config diff, not a logic diff — so this
// proof needs a single shared layout, and the nested servlet is the natural choice.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISTRO = path.resolve(HERE, "../../..");          // openlaszlo-5.0
const LPS_DISK = process.env.OL_ORACLE_JAR;             // the unpacked OL 4.9.0 servlet (LPS tree)
if (!LPS_DISK || !existsSync(LPS_DISK)) {
  console.log("SKIP browser-equiv: set OL_ORACLE_JAR to the unpacked OpenLaszlo 4.9.0 servlet");
  console.log("  (the same prerequisite the oracle uses; see compiler-verify/README.md §1b).");
  process.exit(0);
}
const LPS_URL = "https://host/lps";        // maps to LPS_DISK
const APP_BASE = "https://host/app";       // maps to each app's directory on disk

const APPS = [
  { name: "hello",     file: path.join(DISTRO, "examples/ten-minutes/hello.lzx") },
  { name: "calendar",  file: path.join(DISTRO, "examples/calendar/calendar.lzx") },
  { name: "dashboard", file: path.join(DISTRO, "examples/dashboard/dashboard.lzx") },
];

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "OK   " : "FAIL ") + name + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

// --- URL <-> disk mapping for the shim -------------------------------------
// A given app lives at APP_BASE/<basename>, its siblings at APP_BASE/<rel>. The
// LPS tree lives under LPS_URL. We translate a request URL back to a disk path,
// then read it (or 404). A per-app `appDir` is set before each compile.
let appDir = null;
function urlToDisk(url) {
  if (url.startsWith(LPS_URL + "/")) return LPS_DISK + "/" + url.slice(LPS_URL.length + 1);
  if (url === LPS_URL) return LPS_DISK;
  if (url.startsWith(APP_BASE + "/")) return appDir + "/" + url.slice(APP_BASE.length + 1);
  if (url === APP_BASE) return appDir;
  return null;
}

// Synthetic, deterministic validators from statSync (mtime+size). ETag = a quoted
// "size-mtimeMs"; Last-Modified = the mtime as an HTTP-date. Used to prove cache
// hit/invalidate without a real server.
let mtimeOverride = null; // {disk: extraMs} to simulate a changed dep
function makeHeaders(disk) {
  const s = statSync(disk);
  let mt = Math.floor(s.mtimeMs);
  if (mtimeOverride && mtimeOverride.disk === disk) mt += mtimeOverride.add;
  const etag = `"${s.size}-${mt}"`;
  const lastMod = new Date(mt).toUTCString();
  const h = new Map([["etag", etag], ["last-modified", lastMod], ["content-length", String(s.size)]]);
  return { get: (n) => h.get(n.toLowerCase()) ?? null };
}

function shimFetch(url, init = {}) {
  const disk = urlToDisk(url);
  const method = init.method ?? "GET";
  if (!disk) return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" });
  let bytes;
  try { bytes = readFileSync(disk); }
  catch { return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" }); }
  const headers = makeHeaders(disk);
  return Promise.resolve({
    ok: true, status: 200, headers,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString("utf8"),
  });
}

// The closure file-set for comparison: basenames-with-parent (disk uses absolute
// paths, the browser uses URLs; we compare by the tail path so they line up).
function tailSet(entries, prefixes) {
  const out = new Set();
  for (const e of entries) {
    let id = e.id;
    for (const p of prefixes) if (id.startsWith(p)) { id = id.slice(p.length); break; }
    // strip any leading scheme/host or drive-root noise → keep from last 3 segments
    const segs = id.replace(/^[a-z]+:\/\/[^/]*/i, "").split("/").filter(Boolean);
    out.add(segs.slice(-3).join("/"));
  }
  return out;
}

for (const app of APPS) {
  console.log(`\n=== ${app.name} (${app.file.split("/").pop()}) ===`);
  appDir = app.file.replace(/\/[^/]*$/, "");
  const mainUrl = APP_BASE + "/" + app.file.split("/").pop();
  mtimeOverride = null;

  // Node reference.
  const node = compileFile(app.file, { lpsHome: LPS_DISK, sprites: "none" });
  ok(`Node compile ok (${node.js.length} bytes, no unsupported)`, node.js.length > 0 && !node.unsupported, node.unsupported ?? "");

  // Browser driver (no cache for the equivalence proof).
  let br;
  try {
    br = await compileInBrowser(mainUrl, { fetchFn: shimFetch, lpsUrl: LPS_URL, sprites: "none" });
  } catch (e) {
    ok(`browser compile threw`, false, String(e));
    continue;
  }
  ok(`browser compile ok (${br.js.length} bytes, no unsupported)`, br.js.length > 0 && !br.unsupported, br.unsupported ?? "");
  console.log(`     converged in ${br.passes} fault-and-retry pass(es)`);

  // 1. THE PROOF: byte-identical JS.
  const same = br.js === node.js;
  ok(`browser JS is BYTE-IDENTICAL to Node`, same);
  if (!same) {
    let i = 0;
    while (i < br.js.length && i < node.js.length && br.js[i] === node.js[i]) i++;
    console.log(`     first divergence @${i}: node ...${JSON.stringify(node.js.slice(i, i + 60))}`);
    console.log(`                            browser ...${JSON.stringify(br.js.slice(i, i + 60))}`);
    console.log(`     lengths node=${node.js.length} browser=${br.js.length}`);
  }

  // 2. closure file-set match (compare by path tails; node ids are abs disk paths,
  //    browser ids are URLs).
  const nodeFiles = node.closure.entries.filter((e) => e.kind === "file");
  const brFiles = br.closure.entries.filter((e) => e.kind === "file");
  const nodeTails = tailSet(nodeFiles, [LPS_DISK + "/", appDir + "/"]);
  const brTails = tailSet(brFiles, [LPS_URL + "/", APP_BASE + "/"]);
  // The browser closure may carry negative (missing) deps the node search short-
  // circuited differently; compare the PRESENT (non-missing) sets for parity.
  const nodePresent = new Set([...nodeTails]);
  const brPresent = tailSet(brFiles.filter((e) => !e.v.missing), [LPS_URL + "/", APP_BASE + "/"]);
  const missingFromBrowser = [...nodePresent].filter((t) => !brPresent.has(t));
  const extraInBrowser = [...brPresent].filter((t) => !nodePresent.has(t));
  ok(`closure file-set matches Node (${nodePresent.size} files)`,
     missingFromBrowser.length === 0 && extraInBrowser.length === 0,
     missingFromBrowser.length || extraInBrowser.length
       ? `missing=[${missingFromBrowser.slice(0,4)}] extra=[${extraInBrowser.slice(0,4)}]` : "");

  // 3. cache HIT on a 2nd compile.
  const cache = new BrowserCache(COMPILER_VERSION, { store: "memory" });
  const c1 = await compileInBrowser(mainUrl, { fetchFn: shimFetch, lpsUrl: LPS_URL, sprites: "none", cache });
  ok(`cached compile #1 is a MISS (tag set)`, c1.cached === false && !!c1.tag);
  const c2 = await compileInBrowser(mainUrl, { fetchFn: shimFetch, lpsUrl: LPS_URL, sprites: "none", cache });
  ok(`cached compile #2 is a HIT (same js + tag)`, c2.cached === true && c2.js === c1.js && c2.tag === c1.tag);

  // 4. invalidation: bump a dependency's validator (synthetic mtime) → re-probe
  //    sees a new ETag → isUpToDate fails → MISS.
  const depEntry = brFiles.find((e) => !e.v.missing && e.id.endsWith(".lzx") && e.id !== mainUrl)
                || brFiles.find((e) => !e.v.missing && e.id !== mainUrl);
  if (depEntry) {
    mtimeOverride = { disk: urlToDisk(depEntry.id), add: 5000 };
    const c3 = await compileInBrowser(mainUrl, { fetchFn: shimFetch, lpsUrl: LPS_URL, sprites: "none", cache });
    ok(`changing a dep's validator INVALIDATES the cache (${depEntry.id.split("/").pop()})`, c3.cached === false);
    mtimeOverride = null;
  } else {
    ok(`(no dep to invalidate)`, true);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
