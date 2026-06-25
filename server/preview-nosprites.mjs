// Interactive preview + validation of sprite-sheet-FREE ("none") compilation.
// Compiles an app with sprites:"none" (no montage, no oracle), assembles a fully
// static site from the INDIVIDUAL frame PNGs, asserts every referenced resource
// resolves to a real file (the validation), then serves it for browser testing.
//
//   node server/preview-nosprites.mjs [examples/calendar/calendar.lzx] [port]
//
// Open the printed URL; hover/click buttons to exercise multi-frame (state) resources.

import { compileFile } from "../compiler/dist/node.js";
import { renderWrapper } from "./wrapper.mjs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OL = path.resolve(HERE, "..");                 // openlaszlo/
const REPO = path.resolve(OL, "..");
const LPS = path.join(REPO, "modern-build/swf-canon/scratch-lps");  // SWF-free component lib
const RUNTIME = path.join(OL, "runtime");
const OUT = "/tmp/ol-preview";

const rel = process.argv[2] || "examples/calendar/calendar.lzx";
const PORT = Number(process.argv[3] || 8123);
const APP = path.join(OL, rel);
const base = path.basename(APP, ".lzx");
const appDir = path.dirname(APP);

// 1. compile sprite-sheet-free
const r = compileFile(APP, { lpsHome: LPS, sprites: "none" });
if (r.unsupported) { console.error("UNSUPPORTED:", r.unsupported); process.exit(1); }
const sheetRefs = (r.js.match(/sprite:'/g) || []).length;
console.log(`compiled ${rel} sprites:"none"  →  ${r.js.length} bytes, ${sheetRefs} sprite-sheet refs (expect 0)`);

// 2. assemble a static site. The wrapper sets serverroot:'lps/resources/', so the
// runtime fetches "sr" (server-root) resources at  lps/resources/<relPath>  and "ar"
// (app-relative) resources at the page root. Mirror that layout on disk.
const SR = "lps/resources";   // must match wrapper.mjs serverroot
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(appDir, OUT, { recursive: true, filter: (s) => !/\.(lzx|lzx\.js|sprite\.png|wgt)$/.test(s) });        // app assets (ar) → root
fs.cpSync(path.join(LPS, "lps/components"), path.join(OUT, SR, "lps/components"), { recursive: true });          // component resources (sr) → serverroot
fs.cpSync(path.join(LPS, "lps/fonts"), path.join(OUT, SR, "lps/fonts"), { recursive: true });                    // fonts (sr)
fs.cpSync(RUNTIME, path.join(OUT, "runtime"), { recursive: true });                                             // lfc/embed/includes
fs.writeFileSync(path.join(OUT, base + ".lzx.js"), r.js);
fs.writeFileSync(path.join(OUT, "index.html"), renderWrapper({ base }));

// 3. VALIDATE per-resource: resolve each frame at the SAME URL the runtime will use
// (ar → root, sr → serverroot prefix), and check it's on disk.
let missing = 0, multi = 0, total = 0;
for (const m of r.js.matchAll(/LzResourceLibrary\.\w+=\{ptype:"(ar|sr)",frames:\[([^\]]*)\]/g)) {
  const ptype = m[1];
  const frames = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (frames.length > 1) multi++;
  for (const ref of frames) {
    total++;
    const url = ptype === "sr" ? path.join(SR, ref) : ref;     // the served URL path
    if (!fs.existsSync(path.join(OUT, url))) { console.log("  MISSING:", url); missing++; }
  }
}
console.log(`validation: ${total} frame PNGs referenced, ${multi} multi-frame resources, ${missing} MISSING`);
if (missing) { console.error("✗ some individual frames are not present — fix before browser test"); }
else console.log("✓ every individual frame PNG resolves on disk — frame-mode has all it needs");

// 4. serve
const MIME = { ".js":"text/javascript", ".html":"text/html", ".css":"text/css", ".png":"image/png", ".gif":"image/gif", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ttf":"font/ttf", ".xml":"text/xml", ".lzx":"text/xml" };
const served = new Set();
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = path.join(OUT, p);
  if (!fp.startsWith(OUT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    if (p.endsWith(".png") || p.endsWith(".gif")) console.log("  404", p);   // surface missing resources
    res.writeHead(404); return res.end("404 " + p);
  }
  served.add(p);
  res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => {
  console.log(`\n▶ preview serving at  http://localhost:${PORT}/   (Ctrl-C to stop)`);
  console.log(`  open it, hover/click the calendar buttons to exercise multi-frame (state) resources.`);
  console.log(`  any 404 on a .png/.gif will print here.`);
});
