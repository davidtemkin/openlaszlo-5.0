#!/usr/bin/env node
// OpenLaszlo server — serves the whole distribution (no Java at runtime, no JSP).
//   /                         the Explorer homepage
//   /examples/<app>/          run an example   (…/<app>.lzx also runs it; ?source / ?debug)
//   /runtime/…                the platform runtime (LFC, components, fonts, debugger)
//   /api/<name>               example data services (auto-discovered) ; /api/connection = WS
//
//   node index.mjs [port]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compile, DIST, WEBAPP } from "./compile.mjs";
import { attachConnectionServer } from "./connection.mjs";
import { handleApi } from "./example-data/index.mjs";

const PORT = parseInt(process.argv[2] || "8090");
const RUNTIME = path.join(DIST, "runtime");
const EXPLORER = path.join(DIST, "explorer");
const EXAMPLES = path.join(DIST, "examples");
// / is the canonical SWF-free tree (compiled against the converted components by default).
// /png/* now serves the PRE-conversion snapshot (openlaszlo-snapshot-1, the original SWF tree)
// for A/B — it compiles against the original autoPng component library (WEBAPP).
const PNG_DIST = path.resolve(DIST, "..", "openlaszlo-snapshot-1");
const PNG_RUNTIME = path.join(PNG_DIST, "runtime"), PNG_EXPLORER = path.join(PNG_DIST, "explorer"), PNG_EXAMPLES = path.join(PNG_DIST, "examples");

const MIME = { ".html":"text/html;charset=utf-8", ".htm":"text/html;charset=utf-8",
  ".js":"application/javascript;charset=utf-8", ".css":"text/css;charset=utf-8",
  ".xml":"application/xml;charset=utf-8", ".json":"application/json", ".lzx":"text/plain;charset=utf-8",
  ".png":"image/png", ".gif":"image/gif", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml",
  ".ttf":"font/ttf", ".mp4":"video/mp4", ".webm":"video/webm", ".mp3":"audio/mpeg", ".swf":"application/x-shockwave-flash",
  ".txt":"text/plain;charset=utf-8" };
const mime = p => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";

// app-mount registry: URL dir of a compiled app -> its site dir (so its assets resolve)
const mounts = new Map();
const longestMount = urlPath => [...mounts.keys()]
  .filter(m => urlPath === m || urlPath.startsWith(m)).sort((a, b) => b.length - a.length)[0];

const send = (res, code, body, type = "text/html;charset=utf-8") => {
  res.writeHead(code, { "Content-Type": type }); res.end(body);
};
const sendFile = (res, fp, req) => {                          // with HTTP Range (for video)
  const type = mime(fp), stat = fs.statSync(fp), range = req && req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const start = s ? +s : 0, end = e ? +e : stat.size - 1;
    if (start <= end && end < stat.size) {
      res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": stat.size });
  fs.createReadStream(fp).pipe(res);
};
const errorPage = (t, d) => `<!doctype html><meta charset=utf-8><body style="font:13px monospace;padding:20px">
  <h2>${t}</h2><pre style="white-space:pre-wrap;color:#a00">${String(d).replace(/</g,"&lt;")}</pre>`;

// URL path -> source file on disk. Root namespace is the explorer; /examples/ is examples.
function urlToSource(p) {
  if (p === "/png" || p.startsWith("/png/")) {               // converted clone namespace
    const inner = p.slice(4) || "/";                         // strip "/png"
    if (inner.startsWith("/examples/")) return path.join(PNG_EXAMPLES, inner.slice("/examples/".length));
    if (inner.startsWith("/runtime/"))  return path.join(PNG_RUNTIME, inner.slice("/runtime/".length));
    if (inner.startsWith("/docs/"))     return path.join(PNG_DIST, inner.replace(/^\//, ""));
    return path.join(PNG_EXPLORER, inner.replace(/^\//, ""));
  }
  if (p.startsWith("/examples/")) return path.join(EXAMPLES, p.slice("/examples/".length));
  if (p.startsWith("/runtime/"))  return path.join(RUNTIME, p.slice("/runtime/".length));
  if (p.startsWith("/docs/"))     return path.join(DIST, p.replace(/^\//, ""));  // built documentation (openlaszlo/docs/)
  return path.join(EXPLORER, p.replace(/^\//, ""));          // /, /coverpages/…, /basics/…
}

// run an app: compile its .lzx, register the mount, serve the wrapper (the running page).
// pane=true offsets the canvas down from the top edge (for apps shown in the explorer's
// content pane, vs. a popup window where it should sit flush).
async function runApp(res, urlLzxPath, debug, pane = false, req = null) {
  const png = urlLzxPath === "/png" || urlLzxPath.startsWith("/png/");
  const src = urlToSource(urlLzxPath);
  if (!fs.existsSync(src)) return send(res, 404, errorPage("404", urlLzxPath));
  let info;
  try { info = await compile(src, { debug, ...(png ? { lpsHome: WEBAPP } : {}) }); }
  catch (e) { return send(res, 500, errorPage("compile failed: " + urlLzxPath, (e.stderr || e.stdout || e.message || "").toString())); }
  // a dir can host several compiled apps (the doc examples/programs/) → keep a SET of
  // their site dirs; asset lookup tries each (base-specific files live in one site,
  // shared runtime/resources in all).
  const _ad = path.posix.dirname(urlLzxPath);                     // root app (explore-nav at /) -> "/", NOT "//"
  const mdir = _ad === "/" ? "/" : _ad + "/";                     // e.g. /examples/calendar/
  (mounts.get(mdir) ?? mounts.set(mdir, new Set()).get(mdir)).add(info.siteDir);
  // ETag/304: the TS backend supplies a content tag (hash of the dependency closure).
  // The wrapper's tag folds in the pane flag so the two variants don't collide.
  const tag = info.tag ? `"${info.tag}${pane ? "-p" : ""}"` : null;
  if (tag && req && req.headers["if-none-match"] === tag) {
    res.writeHead(304, { ETag: tag }); return res.end();
  }
  if (pane) {
    // the app canvas (.lzappoverflow) is position:absolute; making #appcontainer a
    // positioned, offset containing block pushes the whole app down from the top edge.
    const html = fs.readFileSync(path.join(info.siteDir, "index.html"), "utf8")
      .replace(/<\/head>/i, '<style>#appcontainer{position:relative!important;top:44px!important}</style></head>');
    const headers = { "Content-Type": "text/html;charset=utf-8" };
    if (tag) headers.ETag = tag;
    res.writeHead(200, headers); return res.end(html);
  }
  const html = fs.readFileSync(path.join(info.siteDir, "index.html"), "utf8");
  const headers = { "Content-Type": "text/html;charset=utf-8" };
  if (tag) headers.ETag = tag;
  res.writeHead(200, headers); res.end(html);
}

// view source: a frameset with the LZX text beside the running app
function sourceView(res, lzxPath) {
  send(res, 200, `<!doctype html><html><head><title>OpenLaszlo — Source</title></head>
    <frameset cols="50%,50%" frameborder="1" framespacing="2">
      <frame name="src" src="${lzxPath}?srctext">
      <frame name="app" src="${lzxPath}">
    </frameset></html>`);
}
function sourceText(res, lzxPath) {
  const src = urlToSource(lzxPath);
  if (!fs.existsSync(src)) return send(res, 404, errorPage("404", lzxPath));
  const code = fs.readFileSync(src, "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  send(res, 200, `<!doctype html><html><head><meta charset=utf-8><title>${lzxPath}</title>
    <link rel="stylesheet" href="/runtime/theme/explore.css">
    <style>body{margin:0;font:12px monospace}h3{font:bold 13px sans-serif;margin:6px 8px;color:#335}
      pre{margin:0 8px;white-space:pre;overflow:auto}</style></head>
    <body class="source-view"><h3>${lzxPath}</h3><pre>${code}</pre></body></html>`);
}

// live editor: an editable source pane beside the running app. "Run" POSTs the edited
// source back here; the server compiles it to a throwaway sibling and reloads the frame.
function editorPage(res, lzxPath) {
  const src = urlToSource(lzxPath);
  if (!fs.existsSync(src)) return send(res, 404, errorPage("404", lzxPath));
  const code = fs.readFileSync(src, "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const name = lzxPath.split("/").pop();
  send(res, 200, `<!doctype html><html><head><meta charset=utf-8><title>Edit — ${name}</title>
  <style>
    html,body{margin:0;height:100%;font:13px -apple-system,sans-serif}
    #bar{height:34px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#2b3a55;color:#fff}
    #bar b{font-weight:600} #bar .sp{flex:1}
    #bar button{font:12px sans-serif;padding:4px 12px;border:0;border-radius:3px;background:#5a78c0;color:#fff;cursor:pointer}
    #bar button:hover{background:#6f8ad0} #status{font-size:12px;color:#cdd6ea;min-width:90px}
    #wrap{display:flex;height:calc(100% - 34px)}
    #ed{width:50%;height:100%;border:0;resize:none;font:12px/1.5 monospace;padding:8px;box-sizing:border-box;background:#fbfbfd}
    #out{width:50%;height:100%;border:0;border-left:1px solid #ccd}
  </style></head><body>
  <div id="bar"><b>${name}</b><span class="sp"></span><span id="status"></span>
    <button id="reset">Reset</button><button id="run">▶ Run (⌘↵)</button></div>
  <div id="wrap"><textarea id="ed" spellcheck="false">${code}</textarea>
    <iframe id="out" src="${lzxPath}"></iframe></div>
  <script>
    var orig=document.getElementById('ed').value, st=document.getElementById('status');
    function run(){ st.textContent='compiling…';
      fetch(location.pathname+'?edit',{method:'POST',headers:{'Content-Type':'text/plain'},body:document.getElementById('ed').value})
        .then(function(r){return r.json()}).then(function(j){
          if(j.ok){ st.textContent='✓ compiled'; document.getElementById('out').src=j.url+'?t='+(new Date().getTime()); }
          else { st.textContent='✗ compile error'; document.getElementById('out').srcdoc='<pre style="white-space:pre-wrap;color:#a00;font:12px monospace;padding:12px">'+(j.error||'compile failed').replace(/[&<]/g,function(c){return c==='&'?'&amp;':'&lt;'})+'</pre>'; }
        }).catch(function(){ st.textContent='error'; });
    }
    document.getElementById('run').onclick=run;
    document.getElementById('reset').onclick=function(){document.getElementById('ed').value=orig; run();};
    document.getElementById('ed').addEventListener('keydown',function(e){ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();run();} });
  </script></body></html>`);
}

function editCompile(req, res, lzxPath) {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", async () => {
    try {
      const origSrc = urlToSource(lzxPath);
      const dir = path.dirname(origSrc);
      if (!fs.existsSync(dir)) return send(res, 200, JSON.stringify({ ok: false, error: "no such app dir" }), "application/json");
      const hash = crypto.createHash("md5").update(body).digest("hex").slice(0, 10);
      const tmpBase = ".edit-" + hash;                       // dot-prefixed → skipped by closureHash (no cache churn)
      fs.writeFileSync(path.join(dir, tmpBase + ".lzx"), body);
      let info;
      try { info = await compile(path.join(dir, tmpBase + ".lzx"), { debug: false }); }
      catch (e) { return send(res, 200, JSON.stringify({ ok: false, error: (e.stderr || e.stdout || e.message || "").toString() }), "application/json"); }
      const urlDir = path.posix.dirname(lzxPath);
      (mounts.get(urlDir + "/") ?? mounts.set(urlDir + "/", new Set()).get(urlDir + "/")).add(info.siteDir);
      send(res, 200, JSON.stringify({ ok: true, url: urlDir + "/" + tmpBase + ".lzx" }), "application/json");
    } catch (e) { send(res, 200, JSON.stringify({ ok: false, error: String(e && e.message) }), "application/json"); }
  });
}

function serveStaticOrMount(res, p, req) {
  // 1) inside a compiled app's mount? (its bundled .lzx.js / resources / assets)
  const m = longestMount(p);
  if (m) {
    for (const siteDir of mounts.get(m)) {
      const fp = path.join(siteDir, p.slice(m.length));
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return sendFile(res, fp, req);
    }
  }
  // 2) static from disk (explorer namespace at /, examples at /examples/, runtime at /runtime/)
  let fp = urlToSource(p);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {     // dir -> index.html or .proto
    // redirect /dir -> /dir/ so the browser's base URL keeps the dir (else a page's
    // relative links resolve one level too high and all 404).
    if (!p.endsWith("/")) { res.writeHead(302, { Location: p + "/" }); return res.end(); }
    const idx = path.join(fp, "index.html"), proto = path.join(fp, "index.html.proto");
    if (fs.existsSync(idx)) return sendFile(res, idx, req);
    if (fs.existsSync(proto)) return send(res, 200, fs.readFileSync(proto, "utf8").replace(/@VERSIONID@/g, "5.0"));
  }
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return sendFile(res, fp, req);
  send(res, 404, errorPage("404 Not Found", p));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(u.pathname);
  const debug = u.searchParams.has("debug");
  try {
    if (p === "/favicon.ico") { res.writeHead(204); return res.end(); }
    // data services (/api/connection is the WebSocket upgrade, handled elsewhere)
    if (p.startsWith("/api/") && p !== "/api/connection") {
      if (await handleApi(req, res, p, u.searchParams)) return;
    }
    // phase-A shim: coverpages have baked /lps/includes/explore.css refs → serve from runtime
    if (p === "/lps/includes/explore.css") return sendFile(res, path.join(RUNTIME, "theme/explore.css"), req);
    if (p.startsWith("/lps/includes/")) {
      const f = path.join(RUNTIME, "includes", p.slice("/lps/includes/".length));
      if (fs.existsSync(f)) return sendFile(res, f, req);
    }
    if (p === "/" || p === "/index.html") return await runApp(res, "/explore-nav.lzx", debug, false, req);
    if (p === "/png" || p === "/png/" || p === "/png/index.html") return await runApp(res, "/png/explore-nav.lzx", debug, false, req);  // SWF-free clone
    if (p.endsWith(".lzx")) {                                  // .lzx → run; ?source view; ?edit live editor
      if (u.searchParams.has("source")) return sourceView(res, p);
      if (u.searchParams.has("srctext")) return sourceText(res, p);
      if (u.searchParams.has("edit")) return req.method === "POST" ? editCompile(req, res, p) : editorPage(res, p);
      return await runApp(res, p, debug, u.searchParams.has("pane"), req);
    }
    // /examples/<app>/  → run its main .lzx (dir-name match, else app.lzx / index.lzx)
    if ((p.startsWith("/examples/") || p.startsWith("/png/examples/")) && p.endsWith("/")) {
      const dir = urlToSource(p), name = p.replace(/\/$/, "").split("/").pop();
      for (const cand of [`${name}.lzx`, "app.lzx", "index.lzx"]) {
        if (fs.existsSync(path.join(dir, cand))) { res.writeHead(302, { Location: p + cand }); return res.end(); }
      }
    }
    return serveStaticOrMount(res, p, req);
  } catch (e) { send(res, 500, errorPage("server error", e.stack || e)); }
});

attachConnectionServer(server, "/api/connection");
server.listen(PORT, () => {
  console.log(`OpenLaszlo → http://localhost:${PORT}/`);
  console.log(`  dist=${DIST}`);
  if (fs.existsSync(PNG_DIST)) console.log(`  pre-conversion snapshot (A/B) → http://localhost:${PORT}/png/`);
});
