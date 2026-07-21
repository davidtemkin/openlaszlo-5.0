// laszlo-dom.js — bootstrap for DOM-authored LZX apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Finds every <laszlo-app>, compiles its live DOM subtree with the in-browser
// compiler (rootXml path), and boots the result via lz.embed with the adoption
// patch prepended — so the authored view elements BECOME the running app's DOM.
// Independent of the service worker; the .lzx-text path is untouched.

import { compileInBrowser, domToXmlElem } from "../compiler/lzc-browser.js";

const HERE = new URL(".", import.meta.url);              // …/startup/
const DISTRO = new URL("..", HERE);                      // distro root
const RUNTIME = new URL("runtime/", DISTRO).href.replace(/\/$/, "");

// Hide app hosts before first paint; revealed per-app on embed onload.
const css = document.createElement("style");
css.textContent = "laszlo-app{visibility:hidden;display:block;position:relative}";
document.head.appendChild(css);

function fail(host, err) {
  host.style.visibility = "visible";
  host.textContent = "";
  const pre = document.createElement("pre");
  pre.style.cssText = "color:#a00;font:12px monospace;white-space:pre-wrap;padding:12px;margin:0";
  pre.textContent = String((err && err.message) || err);
  host.appendChild(pre);
}

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => bad(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

// Collapse the compiler's `lps/`-structured input paths onto the distro's flat
// runtime/ layout — EXACTLY the service worker's distroFetch (service-worker.js,
// section B). Without this, the autoincludes properties and component includes
// 404 and the compile fails with e.g. "unknown tag <simplelayout>".
function distroFetch(url, init) {
  const u = String(url)
    .replace("/lps/components/", "/components/")
    .replace("/lps/fonts/", "/fonts/")
    .replace("/lps/lfc/", "/lfc/")
    .replace("/WEB-INF/lps/misc/lzx-autoincludes.properties", "/lzx-autoincludes.properties");
  return fetch(u, init);
}

/** Drop source-only elements from the live tree, keeping stamped views (and any
 *  ancestors of stamped views). Adopted elements are re-attached under the app's
 *  lzcanvasdiv by the LFC's own addChildSprite appendChilds, in document order. */
function cleanup(el) {
  for (const c of [...el.children]) {
    if (c.hasAttribute("data-lz-adopt") || c.querySelector("[data-lz-adopt]")) cleanup(c);
    else c.remove();
  }
}

async function boot(host) {
  // FILE path: fetch + DOMParser (parsed scripts never execute), inline the subtree
  // so it is live and inspectable — then identical to the inline path.
  const src = host.getAttribute("src");
  if (src) {
    const res = await fetch(new URL(src, document.baseURI));
    if (!res.ok) throw new Error("laszlo-app src fetch failed: " + res.status + " " + src);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const app = doc.querySelector("laszlo-app");
    if (!app) throw new Error("no <laszlo-app> element in " + src);
    for (const a of [...app.attributes])
      if (!host.hasAttribute(a.name)) host.setAttribute(a.name, a.value);
    host.replaceChildren(...app.childNodes);
  }

  // Realtime bus: extract <server> declarations before cleanup() removes the
  // live section (spec: 2026-07-06-realtime-bus-design.md). NOTE: the
  // querySelector below also matches carriers inside <server> — harmless,
  // do NOT "fix" it (domToXmlElem skips the subtree, so nothing server-side
  // is transpiled client-side).
  let busDecls = null;
  const serverEl = [...host.children].find((c) => c.tagName === "SERVER");
  if (serverEl) {
    const busMod = await import(new URL("lz-bus.js", HERE).href);
    busDecls = { decls: busMod.extractServerDecls(serverEl), mod: busMod };
  }

  // TS transpile, lazy-loaded only when the app has code to transpile.
  let transpileTs;
  if (host.querySelector("method,handler,setter,script")) {
    transpileTs = (await import(new URL("lz-ts.js", HERE).href)).transpileTsBody;
  }

  // DOM → XmlElem. Stamps data-lz-adopt on live plain-view elements.
  const rootXml = domToXmlElem(host, { domAdopt: true, transpileTs });

  // Adoption registry (consume-once; read by lz-adopt-patch.js).
  const reg = new Map();
  for (const el of host.querySelectorAll("[data-lz-adopt]"))
    reg.set(el.getAttribute("data-lz-adopt"), el);
  window.__lzDomAdoptRegistry = reg;

  // The authored tree is source; drop what won't be adopted.
  cleanup(host);

  // Compile in-browser. The page URL is the base for relative refs; the runtime
  // root + distroFetch mirror the service worker's compile setup.
  const r = await compileInBrowser(document.baseURI, {
    rootXml, lpsUrl: RUNTIME, sprites: "none", proxied: false, fetchFn: distroFetch,
  });
  if (r.unsupported) throw new Error("compile: " + r.unsupported);

  // Assemble: adoption patch + app JS in ONE script. lz.embed loads the LFC
  // first, then this blob — so the patch installs before any view constructs.
  const patch = await (await fetch(new URL("lz-adopt-patch.js", HERE))).text();
  const prelude = busDecls ? busDecls.mod.busPrelude(busDecls.decls) : "";
  const appUrl = URL.createObjectURL(new Blob([prelude, patch, "\n", r.js], { type: "text/javascript" }));

  if (typeof window.lz === "undefined" || !window.lz.embed) {
    await loadScript(RUNTIME + "/embed.js");
  }

  // embed.js unconditionally appends "?"+query to the app URL, and a blob: URL
  // with a trailing "?" FAILS to load (the blob-URL-store lookup includes the
  // query) — the app would silently never start. Wrap the loader to strip it.
  // runtime/embed.js itself stays untouched.
  const origLoad = window.lz.embed.loadJSLib;
  window.lz.embed.loadJSLib = function (url, cb) {
    return origLoad.call(this, /^blob:/.test(url) ? url.replace(/\?$/, "") : url, cb);
  };

  const container = document.createElement("div");
  container.id = "lzappcontainer";
  host.appendChild(container);

  window.lz.embed.__serverroot = RUNTIME + "/includes/";
  window.lz.embed.dhtml({
    url: appUrl,
    lfcurl: RUNTIME + "/lfc/lfc.js",
    // NOTE: page-relative without the SW's proxyRuntime; fine for Slice 1
    // (no component skin resources in the demos). Component-using DOM apps
    // are a follow-up alongside text/inputtext adoption.
    serverroot: "lps/resources/",
    bgcolor: host.getAttribute("bgcolor") || "#ffffff",
    width: host.getAttribute("width") || "100%",
    height: host.getAttribute("height") || "100%",
    id: "lzapp",
    accessible: "false",
    cancelmousewheel: false,
    cancelkeyboardcontrol: false,
    skipchromeinstall: false,
    usemastersprite: false,
    approot: "",
    appenddivid: "lzappcontainer",
  });
  window.lz.embed.applications.lzapp.onload = function () {
    host.style.visibility = "visible";
  };
  if (busDecls) {
    if (busDecls.decls.transport === "supabase") {
      const supaMod = await import(new URL("lz-bus-supabase.js", HERE).href);
      supaMod.connectSupabase(busDecls.decls, location.pathname);
    } else {
      busDecls.mod.connectBus(location.pathname);
    }
  }
}

// embed.js hard-caps ONE DHTML app per window (dhtmlapploaded guard), so boot
// only the first <laszlo-app>; surface the limit on any others.
const hosts = [...document.querySelectorAll("laszlo-app")];
if (hosts.length) boot(hosts[0]).catch((e) => fail(hosts[0], e));
for (const extra of hosts.slice(1))
  fail(extra, new Error("only one <laszlo-app> per page (lz.embed loads a single DHTML app per window)"));
