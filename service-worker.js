// openlaszlo/service-worker.js — the DISTRO Service Worker: a static-hostable Laszlo Explorer.
//
// THE STORY: serve the `openlaszlo/` tree from a PLAIN static fileserver (S3, GitHub
// Pages, nginx, `python3 -m http.server`). `index.html` registers this module Service
// Worker at the ROOT scope. From then on, navigating to ANY `…/<name>.lzx` URL makes
// the SW (1) return a wrapper HTML page pointing a <script> at `<name>.lzx.js`, then
// (2) intercept that `<name>.lzx.js`, fetch-traverse the app's whole dependency
// closure, compile it IN-BROWSER (sheet-free `sprites:"none"`, SOLO `proxied:false`),
// cache it by closure, and return the running JS. No dynamic compile server, no Java.
//
// This is the GENERALIZED form of modern-build/compiler/demo/sw.js. Three adaptations
// turn the 3-app demo into the whole Explorer:
//   (A) NAMESPACE — mirror server/index.mjs `urlToSource`: the Explorer is the default
//       `/` namespace (`/coverpages/…`, `/nav_dhtml.xml`, `/explore-nav.lzx` → the
//       `explorer/` dir), while `/examples/`, `/runtime/`, `/docs/` are real. So the
//       nav's mixed `/coverpages/…` + `/examples/…` links all resolve. No APPS registry
//       (a `.lzx` URL maps directly to its source) and no Referer asset-proxy (app
//       assets are real files at their natural mapped paths).
//   (B) COMPONENTS PATH — browser-io builds `lpsUrl/lps/{components,fonts,lfc}` +
//       `lpsUrl/WEB-INF/lps/misc/lzx-autoincludes.properties`; the distro serves them
//       flat under `runtime/`, so `distroFetch` collapses the `lps/` segment. The
//       byte-exact compiler core is untouched.
//   (C) SHEET-FREE — `sprites:"none"`: the running app fetches INDIVIDUAL frame PNGs,
//       which the SW proxies from `runtime/`. Never re-add sprite sheets.
//
// Module SW (registered {type:"module"}); imports the self-contained compiler bundle.

import {
  compileInBrowser, BrowserCache, COMPILER_VERSION,
} from "./compiler/lzc-browser.js";

// ───────────────────────────────────────────────────────────────────────────
// CONFIG — resolved against the SW's own location, so the distro works at any
// host/port. The SW lives at <root>/service-worker.js; the runtime at <root>/runtime/.
// ───────────────────────────────────────────────────────────────────────────
const ROOT = new URL("./", self.location).href;                       // <origin>/…/
const ORIGIN = new URL("./", self.location).origin;
const RUNTIME_URL = new URL("runtime", ROOT).href.replace(/\/$/, ""); // <root>/runtime

// BASE — the deploy path prefix (the SW's own directory, == its scope). "/" at origin
// root, "/openlaszlo/" under a GitHub-Pages project page, etc. The distro adapts to
// WHATEVER URL serves it, with no build step: the namespace rules below are written in
// BASE-agnostic "logical" space (a leading-slash distro-relative path), and every network
// target is mapped back to the real on-host path with physical().
const BASE = new URL(ROOT).pathname;                                  // "/" | "/openlaszlo/"
const BASE_PFX = BASE.replace(/\/$/, "");                             // ""  | "/openlaszlo"
// strip BASE off an incoming request pathname → distro-relative "/…"
function logical(p) {
  if (BASE === "/") return p;
  if (p === BASE_PFX) return "/";
  if (p.startsWith(BASE)) return "/" + p.slice(BASE.length);
  return p;                                                          // out-of-base (e.g. "/api" hit at root) → unchanged
}
// map a distro-relative "/…" back to the real on-host path
function physical(p) { return BASE_PFX + p; }
// rebase root-absolute same-origin refs in served HTML/XML onto BASE (no-op when BASE="/").
// Needed for explorer/nav_dhtml.xml (122 root-absolute src="/…" links + `popup="/…"` app
// launches) and any coverpage that uses absolute refs; relative ("../…") and external
// ("http://…") refs never match.
function rebaseHtml(text) {
  if (BASE === "/") return text;
  return text.replace(/\b(src|href|url|popup)="\/(?!\/)/g, `$1="${BASE_PFX}/`);
}

// One closure-validated cache (CacheStorage-backed), shared across every compile.
const cache = new BrowserCache(COMPILER_VERSION, { store: "cachestorage" });

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle — take control ASAP so newly-loaded clients (the Explorer iframe and
// its content panes) are intercepted from their first request.
// ───────────────────────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ───────────────────────────────────────────────────────────────────────────
// (A) toSourceUrl — the URL→source namespace map, mirroring server/index.mjs
// urlToSource. The Explorer is served at `/`, so its OWN files (coverpages, basics,
// nav xml, explore-nav.lzx, images…) live physically under `explorer/`. `/examples/`,
// `/runtime/`, `/docs/` and the root bootstrap files are real paths. Returns the
// pathname to FETCH for a given request pathname.
// ───────────────────────────────────────────────────────────────────────────
const ROOT_FILES = new Set(["/", "/index.html", "/service-worker.js", "/favicon.ico", "/manifest.webmanifest"]);
function toSourceUrl(path) {
  if (path.startsWith("/examples/")) return path;
  if (path.startsWith("/runtime/")) return path;
  if (path.startsWith("/docs/")) return path;
  if (path.startsWith("/compiler/")) return path;   // the browser compiler bundle lives here
  // Coverpage HTML (demos_cover.html etc.) carries baked `../../lps/includes/explore.css`
  // refs → serve them from the flat runtime/ tree (mirrors server/index.mjs:223-226). Without
  // this the cover CSS 404s and the section landings render as unstyled serif text.
  if (path === "/lps/includes/explore.css") return "/runtime/theme/explore.css";
  if (path.startsWith("/lps/includes/")) return "/runtime/includes/" + path.slice("/lps/includes/".length);
  if (ROOT_FILES.has(path)) return path;
  return "/explorer" + path;   // Explorer default namespace (/coverpages/…, /nav_dhtml.xml, /explore-nav.lzx)
}

// ───────────────────────────────────────────────────────────────────────────
// (B) distroFetch — collapse the compiler's `lps/`-structured input paths onto the
// distro's flat `runtime/` layout. Only the network target changes; the URLs the
// compiler RECORDS (closure keys) and EMITS (the `lps/components/…` paths baked into
// the JS) are unchanged, so output stays byte-identical to the Node compile and the
// runtime proxy (proxyRuntime) resolves the emitted paths consistently.
// ───────────────────────────────────────────────────────────────────────────
function distroFetch(url, init) {
  const u = String(url)
    .replace("/lps/components/", "/components/")
    .replace("/lps/fonts/", "/fonts/")
    .replace("/lps/lfc/", "/lfc/")
    .replace("/WEB-INF/lps/misc/lzx-autoincludes.properties", "/lzx-autoincludes.properties");
  return fetch(u, init);
}

// Read the app's `<canvas>` bgcolor + width + height so the wrapper can embed it EXACTLY
// as the compiler's site index.html does. The dynamic server serves that compiler-generated
// index.html (server runApp): its body bg IS the canvas bgcolor (e.g. #eaeaea for the grey
// Explorer/covers) and it embeds at the canvas's DECLARED size (e.g. 800×600 for lzpix).
// The SW builds its own wrapper, so without this it defaulted to white + 100%×100% — which
// (a) showed white below fixed-size canvases, and (b) stretched a fixed-size canvas to the
// window so `canvas.height`-relative views (lzpix's tools bar / tray) drifted off the design
// area. Defaults match the compiler: white bg (16777215), 100% width/height.
async function canvasAttrs(srcUrl) {
  const def = { bgcolor: "#ffffff", width: "100%", height: "100%" };
  try {
    const txt = await (await distroFetch(srcUrl)).text();
    const tag = (txt.match(/<canvas\b[^>]*>/i) || [""])[0];
    const get = (n) => ((tag.match(new RegExp("\\b" + n + "\\s*=\\s*[\"']([^\"']+)[\"']", "i")) || [])[1] || "").trim();
    const bg = get("bgcolor");
    return {
      bgcolor: /^0x[0-9a-fA-F]{6}$/.test(bg) ? "#" + bg.slice(2)            // 0xeaeaea → #eaeaea
             : /^#[0-9a-fA-F]{3,6}$/.test(bg) ? bg                          // #EAEAEA → as-is
             : (bg || def.bgcolor),                                        // named CSS color / default
      width: get("width") || def.width,
      height: get("height") || def.height,
    };
  } catch { return def; }
}

// ───────────────────────────────────────────────────────────────────────────
// (D) URL compiler/runtime flags — the old OpenLaszlo server's query contract
// (server/index.mjs + server/wrapper.mjs), ported to the in-browser compiler.
//   ?debug[=true]        → debug build (lfc-debug.js + per-line /* file */ annotations);
//                          implies lzconsoledebug (the in-app debug console), as on the old server.
//   ?lzconsoledebug=true → debug console without a debug build.
// Unsupported on the SOLO static distro (reported, never silently dropped):
//   ?proxied=true / ?lzproxied=true   (no data-proxy server — distro is SOLO),
//   ?backtrace / ?lzbacktrace         (lzc -g2; needs the 1.6MB backtrace runtime + per-node lines),
//   ?lzr=swf / ?lzt=swf               (the SWF runtime is retired; DHTML only).
// The compiler cache already keys on {debug,proxied,sprites} (compileProps), so debug and
// production builds of the same app never collide.
// ───────────────────────────────────────────────────────────────────────────
function parseFlags(sp) {
  const on = (v) => v !== null && v !== "false";
  const debug = on(sp.get("debug"));
  const flags = { debug, lzconsoledebug: on(sp.get("lzconsoledebug")) || debug, proxied: false, unsupported: null };
  const proxiedReq = sp.get("proxied") ?? sp.get("lzproxied");
  const rt = sp.get("lzr") || sp.get("lzt");
  if (on(sp.get("backtrace")) || on(sp.get("lzbacktrace")))
    flags.unsupported = "backtrace (lzc -g2) is not supported by the in-browser compiler.";
  else if (proxiedReq === "true")
    flags.unsupported = "proxied=true needs a data-proxy server; the static distro is SOLO (proxied=false).";
  else if (rt && /swf/i.test(rt))
    flags.unsupported = "the SWF runtime is retired; only the DHTML runtime is available.";
  return flags;
}
// the query appended to the wrapper's `<name>.lzx.js` so compileResponse (handler 3) sees the flags
function flagQuery(flags) {
  const q = [];
  if (flags.debug) q.push("debug=true");
  if (flags.lzconsoledebug) q.push("lzconsoledebug=true");
  return q.length ? "?" + q.join("&") : "";
}
function unsupportedHtml(reason) {
  return `<!doctype html><meta charset=utf-8><title>OpenLaszlo — unsupported option</title>
<body style="font:14px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#444;margin:40px">
<h2 style="color:#b00020;font-weight:600">Unsupported compiler option</h2><p>${reason}</p></body>`;
}

// ───────────────────────────────────────────────────────────────────────────
// fetch routing.
// ───────────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== ORIGIN) return;            // cross-origin → network
  const path = logical(url.pathname);            // BASE-stripped; query excluded (fixes app-name matching)

  // 1) RUNTIME resource (an `sr` component/font frame the running app fetches as
  //    `<page>/lps/resources/lps/{components,fonts}/…`). Proxy to the flat runtime/ tree.
  if (path.includes("/lps/resources/")) {
    event.respondWith(proxyRuntime(path, req));
    return;
  }

  // 1b) Example-data services (`/api/<name>/…`). The STATIC-data demos (videolib, lzpix,
  //     weather, amazon, image-loading, AND survey) no longer fetch this at runtime: their
  //     data is bundled in the app dir and referenced RELATIVE to the program, so it serves
  //     as a plain file under /examples/ and works at any served-root (no /api, no subpath
  //     caveat). survey defaults to its static data/survey.xml; its POST-to-/api/survey
  //     backend is a commented opt-in (handler dormant in server/example-data/survey/).
  //     The only ACTIVELY-dynamic /api consumer is lzproject (REST CRUD over POST), which
  //     needs the Node server. `/api/connection` (chat WebSocket) has no static equivalent.
  //     This handler stays so those server-backed demos still reach their fixtures.
  if (path.startsWith("/api/") && path !== "/api/connection") {
    const range = req.headers.get("range");   // forward Range so <video>/<audio> get 206 (seek + reliable playback)
    event.respondWith(fetch(url.origin + physical("/server/example-data/" + path.slice(5)) + url.search,
      range ? { headers: { range } } : undefined));
    return;
  }

  // 2) `…/<name>.lzx` requests — run the app, or the source/edit views that mirror
  //    server/index.mjs: `?source` (source frameset), `?srctext` (the source pane),
  //    `?edit` (the live editor), and the editor's POST `?edit` (recompile in-browser).
  //    The query lives in url.search, not `path`.
  if (/\.lzx$/.test(path)) {
    const q = url.searchParams;
    if (req.method === "POST" && q.has("edit")) { event.respondWith(editCompile(url, req)); return; }
    if (req.mode === "navigate") {
      if (q.has("srctext")) { event.respondWith(sourceTextResponse(path)); return; }
      if (q.has("source"))  { event.respondWith(htmlResponse(sourceViewHtml(path))); return; }
      if (q.has("edit"))    { event.respondWith(editorResponse(path)); return; }
      event.respondWith(navResponse(path, url.search)); return;   // bare .lzx → run the app
    }
  }

  // 3) `…/<name>.lzx.js` → compile the sibling `…/<name>.lzx` in-browser.
  if (/\.lzx\.js$/.test(path)) {
    event.respondWith(compileResponse(url, req));
    return;
  }

  // 4) Everything else: apply the namespace map. Explorer-namespace files
  //    (/coverpages/…, /nav_dhtml.xml, /images/…) must be fetched from /explorer/…;
  //    real namespaces (/examples/, /runtime/, /docs/, root) pass straight through.
  const src = toSourceUrl(path);
  if (src !== path) {
    event.respondWith(serveMapped(url.origin + physical(src) + url.search, req));
    return;
  }
  // real path → default network fetch.
});

// ───────────────────────────────────────────────────────────────────────────
// Handlers.
// ───────────────────────────────────────────────────────────────────────────

// Serve a namespace-mapped resource. HTML/XML get their root-absolute same-origin refs
// rebased onto BASE (so nav_dhtml.xml's 122 `src="/…"` links + any absolute coverpage refs
// resolve under a subpath deploy); everything else streams through with Range support.
// No-op rewrite when BASE="/", so a root deploy is byte-identical to before.
async function serveMapped(target, req) {
  const isText = /\.(x?html?|xml)(\?|$)/i.test(target);
  if (BASE !== "/" && isText) {
    const res = await fetch(target);
    if (!res.ok) return res;
    const body = rebaseHtml(await res.text());
    const headers = new Headers(res.headers);
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  }
  const range = req.headers.get("range");
  return fetch(target, range ? { headers: { range } } : undefined);
}

// The wrapper HTML for a navigation to `…/<name>.lzx`. Mirrors server/wrapper.mjs:
// runtime/embed/lfc/serverroot point at the static RUNTIME_URL; the app url is the
// SIBLING `<name>.lzx.js` (relative), whose request the SW intercepts (handler 3).
async function navResponse(path, search = "") {
  const flags = parseFlags(new URLSearchParams(search));
  if (flags.unsupported) return htmlResponse(unsupportedHtml(flags.unsupported));
  const base = path.replace(/.*\//, "").replace(/\.lzx$/, "");
  const { bgcolor, width, height } = await canvasAttrs(self.location.origin + physical(toSourceUrl(path)));
  const html = renderWrapper({
    base, runtimeUrl: RUNTIME_URL, bgcolor, width, height,
    debug: flags.debug, appQuery: flagQuery(flags),
  });
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html;charset=utf-8" } });
}

// Compile `…/<name>.lzx` (the sibling of the requested `…/<name>.lzx.js`) in-browser.
// The source URL is the request URL with `.js` stripped, mapped through the namespace.
async function compileResponse(url, request) {
  // A live-editor recompile result, stashed by editCompile and served at the synthetic
  // `…/.edit-<token>.lzx.js` the editor's preview iframe loads.
  const ed = url.pathname.match(/\.edit-([A-Za-z0-9]+)\.lzx\.js$/);
  if (ed && edits.has(ed[1])) {
    return new Response(edits.get(ed[1]), {
      status: 200, headers: { "Content-Type": "text/javascript;charset=utf-8", "Cache-Control": "no-cache" },
    });
  }
  const flags = parseFlags(url.searchParams);                  // (D) ?debug etc. (query carried from the wrapper)
  if (flags.unsupported) return new Response(errStub(`unsupported: ${flags.unsupported}`), jsHeaders());
  const lzxPath = logical(url.pathname.replace(/\.js$/, ""));  // logical …/<name>.lzx
  const srcUrl = url.origin + physical(toSourceUrl(lzxPath));  // file-space (…/explorer/… for Explorer)
  try {
    const r = await compileInBrowser(srcUrl, {
      fetchFn: distroFetch,        // (B) lps/* → runtime/* path adaptation
      lpsUrl: RUNTIME_URL,         // distro runtime root (collapsed by distroFetch)
      cache,
      sprites: "none",             // (C) sheet-free: individual frame PNGs, no montages
      proxied: false,              // SOLO static distro — no dynamic data proxy
      debug: flags.debug,          // (D) debug build → cache keys on it (compileProps), no prod collision
    });
    if (r.unsupported) {
      return new Response(errStub(`compile UNSUPPORTED: ${r.unsupported}`), jsHeaders());
    }
    const etag = `"${r.tag}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { "ETag": etag } });
    }
    return new Response(r.js, {
      status: 200,
      headers: {
        "Content-Type": "text/javascript;charset=utf-8",
        "ETag": etag,
        "Cache-Control": "no-cache",  // revalidate via ETag; CacheStorage does real caching
      },
    });
  } catch (e) {
    return new Response(errStub(`compile error: ${e && e.message ? e.message : e}`), jsHeaders());
  }
}

// ── source / live-editor views — mirror server/index.mjs sourceView/sourceText/
//    editorPage/editCompile, but the editor's recompile runs IN-BROWSER (the SW). ──

let editSeq = 0;
const edits = new Map();   // token → compiled JS for a live edit (served at …/.edit-<token>.lzx.js)

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });
}
function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
}
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// `?source` — a frameset: the source pane beside the running app.
function sourceViewHtml(path) {
  const phys = physical(path);   // frame srcs are resolved by the browser → must carry BASE
  return `<!doctype html><html><head><title>OpenLaszlo — Source</title></head>
    <frameset cols="50%,50%" frameborder="1" framespacing="2">
      <frame name="src" src="${phys}?srctext">
      <frame name="app" src="${phys}">
    </frameset></html>`;
}

// `?srctext` — the LZX source, read-only.
async function sourceTextResponse(path) {
  const res = await fetch(self.location.origin + physical(toSourceUrl(path)));
  if (!res.ok) return htmlResponse(`<h3>404 — ${path}</h3>`, 404);
  const code = escHtml(await res.text());
  return htmlResponse(`<!doctype html><html><head><meta charset=utf-8><title>${path}</title>
    <link rel="stylesheet" href="${physical("/runtime/theme/explore.css")}">
    <style>body{margin:0;font:12px monospace}h3{font:bold 13px sans-serif;margin:6px 8px;color:#335}
      pre{margin:0 8px;white-space:pre;overflow:auto}</style></head>
    <body class="source-view"><h3>${path}</h3><pre>${code}</pre></body></html>`);
}

// `?edit` — the live editor: editable source + Run that POSTs back here to recompile.
async function editorResponse(path) {
  const res = await fetch(self.location.origin + physical(toSourceUrl(path)));
  if (!res.ok) return htmlResponse(`<h3>404 — ${path}</h3>`, 404);
  const code = escHtml(await res.text());
  const name = path.split("/").pop();
  return htmlResponse(`<!doctype html><html><head><meta charset=utf-8><title>Edit — ${name}</title>
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
    <iframe id="out" src="${physical(path)}"></iframe></div>
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

// POST `?edit` — compile the EDITED source IN-BROWSER and stash the JS under a token; the
// editor reloads its preview iframe to `…/.edit-<token>.lzx`, whose `.lzx.js` is served
// from `edits` (compileResponse). A fetchFn returns the edited body for the app URL and
// the real closure for everything else, so includes/components resolve normally.
async function editCompile(url, request) {
  const body = await request.text();
  const appSrcUrl = self.location.origin + physical(toSourceUrl(logical(url.pathname)));
  const token = "e" + (++editSeq);
  try {
    const editFetch = (u, init) => (String(u) === appSrcUrl
      ? Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/xml", "ETag": '"edit-' + token + '"' } }))
      : distroFetch(u, init));
    const r = await compileInBrowser(appSrcUrl, { fetchFn: editFetch, lpsUrl: RUNTIME_URL, sprites: "none", proxied: false });
    if (r.unsupported) return jsonResponse({ ok: false, error: "compile UNSUPPORTED: " + r.unsupported });
    edits.set(token, r.js);
    if (edits.size > 40) edits.delete(edits.keys().next().value);   // bound memory
    const dir = url.pathname.replace(/\/[^/]*$/, "");
    return jsonResponse({ ok: true, url: dir + "/.edit-" + token + ".lzx" });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e && e.message) ? e.message : String(e) });
  }
}

// Proxy a serverroot-prefixed runtime resource to the flat runtime/ tree. The app
// requests `…/lps/resources/lps/{components,fonts}/…`; strip the serverroot prefix AND
// the `lps/` segment to land on `runtime/{components,fonts}/…`.
async function proxyRuntime(path, request) {
  const tail = path.replace(/^.*\/lps\/resources\//, "")  // → lps/components|fonts/…
                   .replace(/^lps\//, "");                  // → components|fonts/…
  try {
    const range = request.headers.get("range");
    return await fetch(`${RUNTIME_URL}/${tail}`, range ? { headers: { range } } : undefined);
  } catch {
    return new Response("", { status: 502 });
  }
}

function jsHeaders() {
  return { status: 200, headers: { "Content-Type": "text/javascript;charset=utf-8" } };
}

// A JS "program" that DISPLAYS a compile error instead of running an app — returned as
// `<name>.lzx.js` when the compile is `unsupported` or throws. So browsing to any `.lzx`
// that doesn't compile shows the error (not a blank page or an endless spinner): it
// removes the loading splash and paints a clean error panel over the app area (or, when
// the app is the Explorer's content pane, over just that iframe), and logs to the console.
function errStub(msg) {
  const safe = JSON.stringify(String(msg));
  return `console.error("[OpenLaszlo compile] " + ${safe});
(function(){try{
  var sp=document.getElementById("lzsplash"); if(sp&&sp.parentNode){sp.parentNode.removeChild(sp);}
  var p=document.createElement("div"); p.setAttribute("role","alert");
  p.style.cssText="position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;background:#fff;color:#444;overflow:auto;box-sizing:border-box;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace";
  var h=document.createElement("div"); h.textContent="OpenLaszlo \\u2014 compile error";
  h.style.cssText="font:600 16px/1.4 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#b00020;margin:0 0 12px";
  var m=document.createElement("div"); m.style.whiteSpace="pre-wrap"; m.textContent=${safe};
  p.appendChild(h); p.appendChild(m);
  (document.body||document.documentElement).appendChild(p);
}catch(e){console.error(e);}})();`;
}

// renderWrapper — the post-rewrite oracle page shape (see server/wrapper.mjs),
// parameterized so runtime references resolve against RUNTIME_URL. `serverroot:
// 'lps/resources/'` kept verbatim; the app loads `lps/components|fonts` via app-relative
// URLs the SW proxies (handler 1).
function renderWrapper({ base, runtimeUrl, bgcolor = "#ffffff", width = "100%", height = "100%", debug = false, appQuery = "" }) {
  const rt = runtimeUrl.replace(/\/$/, "");
  const url = `${base}.lzx.js${appQuery}`;
  const lfcurl = `${rt}/lfc/${debug ? "lfc-debug.js" : "lfc.js"}`;
  return `<!DOCTYPE html
  PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
   <meta http-equiv="X-UA-Compatible" content="chrome=1"><link rel="SHORTCUT ICON" href="${physical("/favicon.ico")}"><meta name="viewport" content="width=device-width; initial-scale=1.0;"><title>OpenLaszlo: ${base}</title><script type="text/javascript" src="${rt}/embed.js"></script><!--[if lt IE 9]><script type="text/javascript" src="${rt}/includes/excanvas.js"></script><![endif]--><style type="text/css">
            html, body { height: 100%; margin: 0; padding: 0; border: 0 none; }
            body { background-color: ${bgcolor}; }
            img { border: 0 none; }
        </style></head><body><div id="appcontainer"></div><div id="lzsplash" style="z-index: 10000000; top: 0; left: 0; width: 100%; height: 100%; position: fixed; display: table"><p style="display: table-cell; vertical-align: middle;"><img src="${rt}/includes/spinner.gif" style="display: block; margin: 20% auto" alt="application initializing"></p></div><script type="text/javascript" defer>
                  lz.embed.resizeWindow('${width}', '${height}');
                  lz.embed.__serverroot="${rt}/includes/";lz.embed.dhtml({url: '${url}', lfcurl: '${lfcurl}', serverroot: 'lps/resources/', bgcolor: '${bgcolor}', width: '${width}', height: '${height}', id: 'lzapp', accessible: 'false', cancelmousewheel: false, cancelkeyboardcontrol: false, skipchromeinstall: false, usemastersprite: false, approot: '', appenddivid: 'appcontainer'});
                  lz.embed.applications.lzapp.onload = function loaded() {
                    var el = document.getElementById('lzsplash');
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                  }
                </script><noscript>Please enable JavaScript in order to use this application.</noscript></body></html>`;
}
