// urlmap.mjs — the URL→source-path namespace map, SHARED by the Service Worker
// (in-browser compile) and the Node dynamic server (server-side compile), so the two
// modes resolve every app's source the SAME way and can't drift.
//
// The Explorer is served at the `/` namespace but its files physically live under
// `explorer/`, so a request for `/coverpages/welcome/welcome.lzx` resolves to the source
// `explorer/coverpages/welcome/welcome.lzx`. `/examples/`, `/runtime/`, `/docs/`,
// `/compiler/` and the root bootstrap files are real paths. `toSourceUrl(path)` returns
// the distro-relative path to read/fetch for a given request path (leading-slash, BASE
// already stripped by the caller — the SW does this via logical(); the server runs at /).
//
// Pure string logic, no browser/Node APIs, so it imports cleanly into both.

export const ROOT_FILES = new Set([
  "/", "/index.html", "/service-worker.js", "/startup/urlmap.mjs", "/favicon.ico",
  "/manifest.webmanifest", "/startup/version.json",
]);

export function toSourceUrl(path) {
  // Idempotent: an already-resolved Explorer source path passes through unchanged. The SW
  // owns the namespace map and forwards the MAPPED url (…/explorer/…) to the Node server;
  // without this, the server's own toSourceUrl would prepend `/explorer` a SECOND time
  // (`/explorer/explorer/nav_dhtml.xml` → 404), breaking the whole Explorer namespace —
  // nav feed, coverpages, images — in dynamic-server mode. No user URL is ever `/explorer/…`
  // (those live at `/`), so this only ever fires on a re-map. Mirrors the real-namespace
  // pass-throughs below (`/examples/`, `/runtime/`, …).
  if (path.startsWith("/explorer/")) return path;
  if (path.startsWith("/examples/")) return path;
  if (path.startsWith("/runtime/")) return path;
  if (path.startsWith("/docs/")) return path;
  if (path.startsWith("/compiler/")) return path;   // the browser compiler bundle lives here
  if (path.startsWith("/startup/")) return path;    // DOM-dialect bootstrap modules (laszlo-dom, lz-bus, lz-ts, lz-adopt-patch)
  // Coverpage HTML (demos_cover.html etc.) carries baked `../../lps/includes/explore.css`
  // refs → serve them from the flat runtime/ tree. Without this the cover CSS 404s and the
  // section landings render as unstyled serif text.
  if (path === "/lps/includes/explore.css") return "/runtime/theme/explore.css";
  if (path.startsWith("/lps/includes/")) return "/runtime/includes/" + path.slice("/lps/includes/".length);
  if (ROOT_FILES.has(path)) return path;
  return "/explorer" + path;   // Explorer default namespace (/coverpages/…, /nav_dhtml.xml, /explore-nav.lzx)
}

