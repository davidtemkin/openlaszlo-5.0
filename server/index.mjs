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
import { toSourceUrl } from "../startup/urlmap.mjs";
import { classifyLzxRequest, OP } from "../startup/reqtypes.mjs";
import { compileApp, DISTRO, RUNTIME } from "./compile.mjs";
import { attachUpgradeDispatcher, connectionUpgradeHandler } from "./connection.mjs";
import { busUpgradeHandler } from "./bus.mjs";
import { dataUpgradeHandler } from "./data-relay.mjs";
import { handleApi } from "./example-data/index.mjs";
import { handleDataProxy } from "./data-proxy.mjs";
import { wrapperFor } from "./wrapper.mjs";
import { serveSource, serveSrcText, serveEditor, editCompile, editToken, serveEditApp } from "./dev-views.mjs";

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
  // ?backtrace / ?lzbacktrace → DEBUG_BACKTRACE build (implies debug). Mirrors the SW.
  const bt = url.searchParams.get("backtrace") ?? url.searchParams.get("lzbacktrace");
  const backtrace = bt !== null && bt !== "false";
  const debug = backtrace || (dbg !== null && dbg !== "false");
  // ?profile / ?lzprofile → profile build (cache-keyed); pairs with the lfc-profile.js
  // runtime the SW's renderWrapper selects. Independent of debug.
  const pf = url.searchParams.get("profile") ?? url.searchParams.get("lzprofile");
  const profile = pf !== null && pf !== "false";
  // ?lzr=canvas → compile for the own-pixels canvas kernel (dhtml-family: byte-identical
  // app JS, only $canvas flips + cache-keyed separately). The wrapper loads LFCcanvas.js.
  const rt = url.searchParams.get("lzr") ?? url.searchParams.get("lzt");
  const canvas = rt !== null && /canvas/i.test(rt);
  let r;
  try { r = compileApp(srcAbs, { debug, backtrace, profile, canvas }); }
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

// Is a browser loading this URL as a PAGE? (`Accept: text/html` — the server's analogue of
// the SW's `req.mode === "navigate"`.) The shared classifier uses this to decide a bare
// `.lzx` between RUN (navigation) and RAWXML (a programmatic fetch by the runtime/includes).
function lzxIsNavigation(req) {
  return req.method === "GET" && (req.headers["accept"] || "").includes("text/html");
}

// Serve the HTML wrapper for a `.lzx` navigation (the app, running). Source on disk via the
// shared namespace map; canvas bgcolor/size are read from it for the page chrome.
function serveWrapper(req, res, p, url) {
  const srcAbs = path.normalize(path.join(DISTRO, toSourceUrl(p)));
  if (!srcAbs.startsWith(DISTRO) || !fs.existsSync(srcAbs)) return notFound(req, res);
  const r = wrapperFor(p, srcAbs, url.searchParams);
  if (r.unsupported) return send(res, 200, errStub("compile UNSUPPORTED: " + r.unsupported), JS_HDR);
  send(res, 200, r.html, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache" });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch { return send(res, 400, "bad request\n"); }
  const p = decodeURIComponent(url.pathname);

  try {
    // Classify any `.lzx`/`.lzx.js` request up front via the SHARED request table (startup/
    //    reqtypes.mjs) — the Service Worker classifies the SAME way for static hosting, so
    //    the two deployments answer one request vocabulary identically.
    const op = /\.lzx(\.js)?$/.test(p)
      ? classifyLzxRequest(p, url.searchParams, req.method, lzxIsNavigation(req)) : null;

    // The editor's Run is an unambiguous `?edit` POST and reads the body ITSELF — handle it
    // before the data proxy, which would otherwise consume the (form-encoded) body.
    if (op === OP.EDIT_POST) return editCompile(req, res, p);

    // 0) proxied data service (lzt=xmldata): a `<dataset>` request from an app in proxied
    //    mode. Server-side fetch of `?url=…` (CORS bypass). Arrives on any path (proxyurl =
    //    the app's base URL — its `.lzx.js`), so it must be checked before path routing.
    if (await handleDataProxy(req, res, url)) return;
    // 1) /api/<name> (not the WS) → dynamic example-data handlers (fall back to fixtures).
    if (p.startsWith("/api/") && p !== "/api/connection") {
      if (await handleApi(req, res, p, url.searchParams)) return;
      return notFound(req, res);
    }
    // 1c) RUNTIME resource the running app fetches as `…/lps/resources/lps/{components,fonts}/…`
    //     → serve from the flat runtime/ tree (the SW's proxyRuntime, server-side).
    if (p.includes("/lps/resources/")) {
      const tail = p.replace(/^.*\/lps\/resources\//, "").replace(/^lps\//, "");
      return serveStatic(req, res, path.normalize(path.join(RUNTIME, tail)));
    }
    // 2) the rest of the shared `.lzx`/`.lzx.js` dispatch.
    if (op) {
      const t = editToken(p);                              // `.edit-<token>` editor preview
      if (t) return serveEditApp(res, p, t);
      switch (op) {
        case OP.COMPILED:  return compileEndpoint(req, res, url);
        case OP.RUN:       return serveWrapper(req, res, p, url);
        case OP.SOURCE:    return serveSource(res, p);
        case OP.SRCTEXT:   return serveSrcText(res, p);
        case OP.EDIT:      return serveEditor(res, p);
        case OP.RAWXML:    break;     // fall through to static → the raw `.lzx` (text/xml)
      }
    }
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

attachUpgradeDispatcher(server, {
  "/api/connection": connectionUpgradeHandler,
  "/api/bus": busUpgradeHandler,           // realtime bus (spec 2026-07-06-realtime-bus-design.md)
  "/api/data": dataUpgradeHandler,         // JSON-dataset relay (spec 2026-07-06-json-databinding-design.md)
});
console.log("  connection (WebSocket) server on /api/connection");
server.listen(PORT, () => {
  console.log(`OpenLaszlo dynamic server → http://localhost:${PORT}/`);
  console.log("  server-side compile (TS, disk-cached) + /api + persistent connection");
});
