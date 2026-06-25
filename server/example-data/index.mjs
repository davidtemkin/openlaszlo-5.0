// example-data registry — auto-discovers server/example-data/<name>/index.mjs and
// mounts each at /api/<name>. A handler returns true if it handled the request; the
// registry falls back to serving static files from the example's dir (covers, videos,
// posters), so runtime media lives beside the example's data — partitioned by name.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readBody = req => new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => r(new URLSearchParams(b))); });

// discover handlers (top-level await — ESM)
const handlers = {};
for (const e of fs.readdirSync(HERE, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const idx = path.join(HERE, e.name, "index.mjs");
  if (fs.existsSync(idx)) handlers[e.name] = (await import(pathToFileURL(idx).href)).handle;
}
console.log("  /api services:", Object.keys(handlers).join(", ") || "(none)");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".xml": "application/xml", ".json": "application/json" };

function serveFile(req, res, fp) {
  const stat = fs.statSync(fp), range = req.headers.range, type = MIME[path.extname(fp).toLowerCase()] || "application/octet-stream";
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [s, e] = range.replace("bytes=", "").split("-"); const start = s ? +s : 0, end = e ? +e : stat.size - 1;
    if (start <= end && end < stat.size) {
      res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": stat.size });
  fs.createReadStream(fp).pipe(res);
}

// /api/<name>/<subpath> -> dynamic handler, else static media from example-data/<name>/
export async function handleApi(req, res, p, query) {
  const rest = p.slice("/api/".length);
  const slash = rest.indexOf("/");
  const name = slash < 0 ? rest : rest.slice(0, slash);
  const subpath = slash < 0 ? "" : rest.slice(slash + 1);
  const h = handlers[name];
  if (h) {
    const body = req.method === "POST" ? await readBody(req) : query;
    if (await h(req, res, subpath, query, body)) return true;
  }
  const fp = path.join(HERE, name, subpath);
  if (subpath && !subpath.includes("..") && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    serveFile(req, res, fp); return true;
  }
  return false;
}
