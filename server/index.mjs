// server/index.mjs — the dynamic OpenLaszlo distro server.
//
// Serves the static distro AND compiles `<name>.lzx.js` on demand (TS compiler, disk-cached),
// runs the `/api` example-data handlers, and hosts the persistent-connection WebSocket.
//
// It pairs with the SAME Service Worker the static build uses: when this server serves
// `index.html` it injects `window.__OL_COMPILE="server"`, so the SW registers in *server
// mode* and forwards `<name>.lzx.js` + `/api` here (the wrapper, runtime-resource proxy and
// namespace map stay in the SW). A dumb static host serves index.html verbatim → the SW
// compiles in-browser. One distro, two modes, one Explorer.
//
//   node server/index.mjs [port=8090]   →  http://localhost:8090/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { toSourceUrl } from "../urlmap.mjs";
import { compileApp, DISTRO } from "./compile.mjs";
import { attachConnectionServer } from "./connection.mjs";
import { handleApi } from "./example-data/index.mjs";

const PORT = parseInt(process.argv[2] || "8090", 10);

const MIME = {
  ".html": "text/html;charset=utf-8", ".htm": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8", ".mjs": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8", ".json": "application/json;charset=utf-8",
  ".xml": "text/xml;charset=utf-8", ".lzx": "text/xml;charset=utf-8",
  ".properties": "text/plain;charset=utf-8", ".txt": "text/plain;charset=utf-8",
  ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".m4v": "video/mp4",
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
const JS_HDR = { "Content-Type": "text/javascript;charset=utf-8" };
const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };

// A JS "program" that paints a compile error instead of running an app (mirrors the SW).
const errStub = (msg) => {
  const safe = JSON.stringify(String(msg));
  return `console.error("[OpenLaszlo compile] " + ${safe});
(function(){try{var sp=document.getElementById("lzsplash");if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);
var p=document.createElement("div");p.style.cssText="position:fixed;inset:0;z-index:2147483647;padding:24px;background:#fff;color:#444;overflow:auto;font:13px/1.55 ui-monospace,Menlo,monospace";
p.textContent=${safe};(document.body||document.documentElement).appendChild(p);}catch(e){console.error(e);}})();`;
};

// ── <name>.lzx.js → compile the sibling .lzx (TS, disk-cached) + ETag/304 ──────────────
function compileEndpoint(req, res, url) {
  const lzxPath = url.pathname.replace(/\.js$/, "");        // /…/<name>.lzx
  const srcAbs = path.join(DISTRO, toSourceUrl(lzxPath));   // same namespace map as the SW
  if (!fs.existsSync(srcAbs)) return send(res, 200, errStub("404 source: " + lzxPath), JS_HDR);
  const dbg = url.searchParams.get("debug");
  const debug = dbg !== null && dbg !== "false";
  let r;
  try { r = compileApp(srcAbs, { debug }); }
  catch (e) { return send(res, 200, errStub("compile error: " + (e && e.message || e)), JS_HDR); }
  if (r.unsupported) return send(res, 200, errStub("compile UNSUPPORTED: " + r.unsupported), JS_HDR);
  const etag = `"${r.tag}"`;
  if (req.headers["if-none-match"] === etag) return send(res, 304, undefined, { ETag: etag });
  send(res, 200, r.js, { ...JS_HDR, ETag: etag, "Cache-Control": "no-cache" });
}

// ── static file (ETag / Last-Modified / Range; index.html gets the server-mode marker) ──
function serveStatic(req, res, abs, { inject = false } = {}) {
  let st;
  try { st = fs.statSync(abs); } catch { return notFound(req, res); }
  if (st.isDirectory()) return serveStatic(req, res, path.join(abs, "index.html"), { inject });

  // index.html → inject window.__OL_COMPILE="server" so the SW registers in server mode.
  if (inject) {
    let html = fs.readFileSync(abs, "utf8");
    html = html.replace(/<\/head>/i, '<script>window.__OL_COMPILE="server"</script></head>');
    return send(res, 200, html, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache" });
  }

  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": mimeOf(abs), "Cache-Control": "no-cache", "Accept-Ranges": "bytes",
    "Last-Modified": st.mtime.toUTCString(), "ETag": etag,
  };
  if (req.headers["if-none-match"] === etag) return send(res, 304, undefined, headers);
  const m = /^bytes=(\d*)-(\d*)/.exec(req.headers["range"] || "");
  if (m) {   // Range — required by HTML5 <video>/<audio>
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= st.size) end = st.size - 1;
    if (start > end || start >= st.size) return send(res, 416, undefined, { "Content-Range": `bytes */${st.size}` });
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  fs.createReadStream(abs).pipe(res);
}

// Missing path → plain 404. Deep/shared Explorer links need NO host 404 handling: the
// shareable address lives in the URL fragment (index.html#/…), so the path is always
// index.html (served fine) and the SW + Explorer route the fragment client-side. The only
// 404s here are genuine missing files (a bad URL, an LZX referencing an absent asset).
function notFound(req, res) {
  send(res, 404, "404 Not Found\n", { "Content-Type": "text/plain" });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch { return send(res, 400, "bad request\n"); }
  const p = decodeURIComponent(url.pathname);

  try {
    // 1) /api/<name> (not the WS) → dynamic example-data handlers (fall back to fixtures).
    if (p.startsWith("/api/") && p !== "/api/connection") {
      if (await handleApi(req, res, p, url.searchParams)) return;
      return notFound(req, res);
    }
    // 2) <name>.lzx.js → compile on demand.
    if (p.endsWith(".lzx.js")) return compileEndpoint(req, res, url);
    // 3) everything else → static, via the shared namespace map.
    const isIndex = (p === "/" || p === "/index.html");
    let rel = toSourceUrl(p);
    if (rel === "/" || rel.endsWith("/")) rel += "index.html";
    const abs = path.normalize(path.join(DISTRO, rel));
    if (!abs.startsWith(DISTRO)) return send(res, 403, "forbidden\n");
    serveStatic(req, res, abs, { inject: isIndex });
  } catch (e) {
    send(res, 500, "500 " + (e && e.message || e) + "\n", { "Content-Type": "text/plain" });
  }
});

attachConnectionServer(server);   // WebSocket persistent connection at /api/connection
server.listen(PORT, () => {
  console.log(`OpenLaszlo dynamic server → http://localhost:${PORT}/`);
  console.log("  server-side compile (TS, disk-cached) + /api + persistent connection");
});
