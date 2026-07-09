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

import { compileInBrowser, BrowserCache, COMPILER_VERSION } from "./compiler/lzc-browser.js";
import { toSourceUrl, ROOT_FILES } from "./startup/urlmap.mjs";
import { classifyLzxRequest, OP } from "./startup/reqtypes.mjs";
import { framesetHtml, srcTextHtml, editorHtml } from "./startup/views.mjs";

// COMPILE_MODE — "server" or "browser". index.html registers this worker as
// `service-worker.js?compile=<mode>`: the live Node server injects window.__OL_COMPILE=
// "server" into the index.html it serves → "server"; a dumb static host serves index.html
// verbatim → undefined → "browser" (the safe default). So the SAME distro compiles
// in-browser when served statically and delegates to the Node server when run under it —
// the only difference is this one flag (no host-probing, which static-404 behavior makes
// unreliable).
// NOTE: a module Service Worker can't dynamic-import(), so the compiler bundle above is a
// static import (loaded in both modes). In server mode it simply isn't used — compilation
// is delegated to the server.
const COMPILE_MODE = new URLSearchParams(self.location.search).get("compile") || "browser";

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

// BUILD_ID — stamped by tools/stamp-version.mjs at package time (a content hash of the
// runtime + compiler bundle + this worker). It changes whenever the deployed platform
// changes, which (a) changes THIS worker's bytes so the browser installs a fresh SW and
// (b) busts every cached asset. Host-agnostic: works on ANY static host (GitHub Pages,
// S3, nginx, Cloudflare Pages…) with no build pipeline — just re-run the stamp before you
// deploy. Left as "dev" when unstamped (local serving).
const BUILD_ID = "74b2d17a721b";

// Per-build cache bucket: a new BUILD_ID -> a new bucket -> the old one is dropped on
// activate, and compiled output is re-keyed, so a runtime/compiler change recompiles.
const COMPILE_CACHE = "lzc-compile-" + BUILD_ID;
const cache = new BrowserCache(BUILD_ID + ":" + COMPILER_VERSION, { store: "cachestorage", cacheName: COMPILE_CACHE });

// Always revalidate distro asset fetches against the host (conditional GET via ETag /
// Last-Modified — supported by every static host). A changed runtime/source/coverpage is
// re-fetched immediately; an unchanged one is a cheap 304. This is what keeps the served
// runtime fresh after a deploy without manual cache-clearing; BUILD_ID handles the
// separate compiled-app cache. Merge so callers can still override (e.g. Range).
function fresh(init) { return Object.assign({ cache: "no-cache" }, init); }

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle — take control ASAP so newly-loaded clients (the Explorer iframe and
// its content panes) are intercepted from their first request.
// ───────────────────────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  // A new SW means a new BUILD_ID: drop every cache that isn't this build's compile
  // bucket (old builds' compiled apps + any stale cache), then tell open clients to
  // reload onto the fresh version (index.html guards against reload loops by build id).
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== COMPILE_CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "ol-updated", build: BUILD_ID });
})()));

// ───────────────────────────────────────────────────────────────────────────
// (A) toSourceUrl — the URL→source namespace map, now SHARED with the Node server
// (urlmap.mjs) so the two compile modes resolve sources identically. The Explorer is
// served at `/`, so its files live physically under `explorer/`; `/examples/`,
// `/runtime/`, `/docs/`, `/compiler/` and the root bootstrap files are real paths.
// ───────────────────────────────────────────────────────────────────────────
// (toSourceUrl + ROOT_FILES imported at the top from ./urlmap.mjs)

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
  return fetch(u, fresh(init));
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
//   ?debug[=true]        → debug build (lfc-debug.js + per-line /* file */ annotations); shows the
//                          framed on-canvas LzDebugWindow (title bar, drag grabber, resize handle,
//                          drop shadows), as in classic OpenLaszlo: ResponderCompile.java defaulted
//                          lzconsoledebug=false for a plain debug build, so makeDebugWindow calls
//                          `new LzDebugWindow()`. (An earlier version forced lzconsoledebug on here,
//                          which mis-routed every ?debug to the frameless console — corrected.)
//   ?lzconsoledebug=true → the bare HTML/iframe console (LzDHTMLDebugConsole) — an explicit,
//                          INDEPENDENT opt-in (the old remote-debug console), NOT implied by ?debug.
//   ?backtrace / ?lzbacktrace → DEBUG_BACKTRACE build (lzc -g2): per-function call-stack
//                          frames + per-call-site line notes, byte-for-byte vs the oracle
//                          (backtrace.lzx). Implies debug (it is a debug add-on); loads the
//                          dedicated lfc-backtrace.js runtime (the full LzBacktrace stack +
//                          frame machinery, not just lfc-debug.js's Debug.backtrace stub).
// Unsupported on the SOLO static distro (reported, never silently dropped):
//   ?proxied=true / ?lzproxied=true   (no data-proxy server — distro is SOLO),
//   ?lzr=swf / ?lzt=swf               (the SWF runtime is retired; DHTML only).
// The compiler cache keys on {debug,backtrace,proxied,sprites} (compileProps), so debug,
// backtrace, and production builds of the same app never collide.
// ───────────────────────────────────────────────────────────────────────────
function parseFlags(sp) {
  const on = (v) => v !== null && v !== "false";
  const backtrace = on(sp.get("backtrace")) || on(sp.get("lzbacktrace"));
  const debug = on(sp.get("debug")) || backtrace;   // backtrace is a debug add-on → forces debug on
  // ?profile / ?lzprofile → load the profile runtime (lfc-profile.js): every LFC function
  // is `$lzprofiler`-metered and the Profiler auto-starts ($profile init block). Independent
  // of debug ($debug stays false — production folding + the timing meter).
  const profile = on(sp.get("profile")) || on(sp.get("lzprofile"));
  const rt = sp.get("lzr") || sp.get("lzt");
  // ?lzr=canvas → the own-pixels canvas kernel (LFCcanvas.js). DHTML-family: the app
  // compiles byte-identically; only the LFC the wrapper loads (and the $canvas compile-
  // time constant) differ. `lzr=swf*` stays retired (handled below).
  const canvas = rt != null && /canvas/i.test(rt);
  const flags = { debug, backtrace, profile, canvas, lzconsoledebug: on(sp.get("lzconsoledebug")), proxied: false, unsupported: null };
  const proxiedReq = sp.get("proxied") ?? sp.get("lzproxied");
  if (proxiedReq === "true")
    flags.unsupported = "proxied=true needs a data-proxy server; the static distro is SOLO (proxied=false).";
  else if (rt && /swf/i.test(rt))
    flags.unsupported = "the SWF runtime is retired; only the DHTML runtime is available.";
  return flags;
}
// the query appended to the wrapper's `<name>.lzx.js` so compileResponse (handler 3) sees the flags
function flagQuery(flags) {
  const q = [];
  if (flags.debug) q.push("debug=true");
  // Use the `lzbacktrace` spelling: it is in lz.embed's preserved-option list (embed.js),
  // so the runtime carries it through to the `<name>.lzx.js` compile request (and turns on
  // the runtime `$backtrace` recording). A plain `backtrace` param is dropped by embed.
  if (flags.backtrace) q.push("lzbacktrace=true");
  // Carry the profile flag to the `<name>.lzx.js` compile request (cache-keyed via
  // compileProps) so a profile build never collides with the production cache.
  if (flags.profile) q.push("lzprofile=true");
  // Carry the canvas target to the `<name>.lzx.js` compile request so compileResponse
  // (handler 3) compiles with $canvas set + cache-keys it separately from the dhtml build.
  if (flags.canvas) q.push("lzr=canvas");
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

  // NOTE on PROXIED DATA: this Service Worker is the STATIC-hosting capability, and a static
  // deployment is SOLO — there is no server to proxy a cross-origin `<dataset>` through. The
  // proxied data service (`lzt=xmldata`) is handled entirely by the Node server, which does
  // NOT register this worker (see index.html). So nothing about proxied mode is handled here.

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
    // SERVER mode: let the live server's dynamic handler answer (lzproject CRUD, survey
    // POST, …). BROWSER/static mode: serve the canned fixtures from server/example-data.
    if (COMPILE_MODE === "server") { event.respondWith(fetch(req)); return; }
    const range = req.headers.get("range");   // forward Range so <video>/<audio> get 206 (seek + reliable playback)
    event.respondWith(fetch(url.origin + physical("/server/example-data/" + path.slice(5)) + url.search,
      range ? { headers: { range } } : undefined));
    return;
  }

  // 2) `…/<name>.lzx` / `.lzx.js` → classify via the SHARED request table (startup/
  //    reqtypes.mjs, the SAME one the Node server uses) and EMULATE the operation in-browser.
  //    One request vocabulary, two implementations: static hosting (this worker) and the
  //    server answer bare-`.lzx`=run, `?source`/`?srctext`/`?edit`, `.lzx.js`/`lzt=js`, and
  //    the legacy-docs `lzt=html/source/xml` aliases identically.
  {
    const op = classifyLzxRequest(path, url.searchParams, req.method, req.mode === "navigate");
    // SERVER mode: the Node server owns the page-synthesizing ops (wrapper/source/editor)
    // so dev-mode injection (live reload) is authoritative — mirrors the /api and COMPILED
    // passthroughs. COMPILED keeps its own passthrough inside compileResponse (edit tokens).
    if (COMPILE_MODE === "server" &&
        (op === OP.RUN || op === OP.SOURCE || op === OP.SRCTEXT || op === OP.EDIT || op === OP.EDIT_POST)) {
      event.respondWith(fetch(req));
      return;
    }
    if (op === OP.EDIT_POST) { event.respondWith(editCompile(url, req)); return; }
    if (op === OP.SRCTEXT)   { event.respondWith(sourceTextResponse(path)); return; }
    if (op === OP.SOURCE)    { event.respondWith(htmlResponse(framesetHtml(physical(path)))); return; }
    if (op === OP.EDIT)      { event.respondWith(editorResponse(path)); return; }
    if (op === OP.RUN)       { event.respondWith(navResponse(path, url.search)); return; }
    if (op === OP.COMPILED)  { event.respondWith(compileResponse(url, req)); return; }
    // OP.RAWXML (a non-navigation `.lzx` fetch — include/dataset) → fall through to serveMapped.
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
    const res = await fetch(target, fresh());
    if (!res.ok) return res;
    const body = rebaseHtml(await res.text());
    const headers = new Headers(res.headers);
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  }
  const range = req.headers.get("range");
  return fetch(target, fresh(range ? { headers: { range } } : undefined));
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
    debug: flags.debug, backtrace: flags.backtrace, profile: flags.profile, canvas: flags.canvas, appQuery: flagQuery(flags),
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
  // SERVER mode: the Node server compiles `<name>.lzx.js` (TS compiler, disk-cached) and
  // serves it with an ETag. Pass the request straight through — including If-None-Match,
  // so the server's 304 flows back. (The wrapper, runtime proxy and namespace stay here.)
  if (COMPILE_MODE === "server") return fetch(request);

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
      backtrace: flags.backtrace,  // (D) DEBUG_BACKTRACE add-on → cache keys on it too
      profile: flags.profile,      // (D) profile build → cache keys on it; app runs on lfc-profile.js
      canvas: flags.canvas,        // (D) canvas target → $canvas set + cache-keyed; app runs on LFCcanvas.js
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

// `?srctext` — the LZX source, read-only (shared template; `framesetHtml` handles `?source`).
async function sourceTextResponse(path) {
  const res = await fetch(self.location.origin + physical(toSourceUrl(path)));
  if (!res.ok) return htmlResponse(`<h3>404 — ${path}</h3>`, 404);
  return htmlResponse(srcTextHtml(path, await res.text(), physical("/runtime/theme/explore.css")));
}

// `?edit` — the live editor (shared template). The Run button POSTs the edited source to
// `…?edit` → editCompile compiles it in-browser and the preview reloads to `.edit-<token>.lzx`.
async function editorResponse(path) {
  const res = await fetch(self.location.origin + physical(toSourceUrl(path)));
  if (!res.ok) return htmlResponse(`<h3>404 — ${path}</h3>`, 404);
  return htmlResponse(editorHtml(path.split("/").pop(), await res.text(), physical(path)));
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
function renderWrapper({ base, runtimeUrl, bgcolor = "#ffffff", width = "100%", height = "100%", debug = false, backtrace = false, profile = false, canvas = false, appQuery = "" }) {
  const rt = runtimeUrl.replace(/\/$/, "");
  const url = `${base}.lzx.js${appQuery}`;
  // LFC variant selection: ?lzr=canvas → the own-pixels canvas kernel (LFCcanvas.js),
  // which runs the SAME compiled app; else ?lzbacktrace → lfc-backtrace.js (the full
  // LzBacktrace stack + per-call-site instrumentation, paired with the backtrace app
  // compile); ?profile → lfc-profile.js (every LFC function `$lzprofiler`-metered, Profiler
  // auto-started); ?debug → lfc-debug.js (runtime debugger); else the production lfc.js.
  // backtrace takes precedence over plain debug (it is a debug superset); profile is
  // independent of debug. Canvas takes precedence (a canvas debug/profile LFC is future work).
  const lfcurl = canvas
    ? `${rt}/lfc/kernel/canvas/LFCcanvas.js`
    : `${rt}/lfc/${backtrace ? "lfc-backtrace.js" : profile ? "lfc-profile.js" : debug ? "lfc-debug.js" : "lfc.js"}`;
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
