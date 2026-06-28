// reqtypes.mjs — the SHARED request-type table for a `<name>.lzx` URL.
//
// ONE request vocabulary, two implementations: the Node server (native, like the original
// LPS) and the Service Worker (in-browser emulation). Both import this classifier so a
// static deployment and a server deployment resolve every request identically — no parallel
// schemes. It covers the distro's clean spellings (bare `.lzx` = run, `?source`, `?srctext`,
// `?edit`) AND the original LPS `lzt=` aliases still emitted by the legacy docs
// (`lzt=html`/`source`/`js`/`xml`). Pure string logic — imports cleanly into both runtimes.

export const OP = {
  RUN:       "run",       // the HTML wrapper that boots the app   (clean: bare .lzx · lzt=html)
  SOURCE:    "source",    // the source|app frameset                (clean: ?source · lzt=source)
  SRCTEXT:   "srctext",   // the read-only source pane              (clean: ?srctext)
  EDIT:      "edit",      // the live editor page                   (clean: ?edit  [GET])
  EDIT_POST: "editPost",  // compile edited source                  (clean: ?edit  [POST])
  COMPILED:  "compiled",  // the compiled app JS                    (clean: .lzx.js · lzt=js)
  RAWXML:    "rawxml",    // the raw `.lzx` source as XML           (lzt=xml · programmatic fetch)
};

/**
 * Classify a `.lzx`/`.lzx.js` request into one operation. Returns an OP, or null if the path
 * is not a `.lzx`/`.lzx.js` (caller handles it as a normal static/resource request).
 *
 * @param pathname      the request path (BASE-stripped is fine; only the extension matters)
 * @param q             URLSearchParams
 * @param method        "GET" | "POST" | …
 * @param isNavigation  true when a browser is loading this as a PAGE (server: `Accept:
 *                      text/html`; SW: `req.mode === "navigate"`). A bare `.lzx` navigation
 *                      RUNS the app; a programmatic fetch of the same URL gets raw XML — the
 *                      original server's default-`lzt=html` vs explicit-`lzt=xml` split.
 */
export function classifyLzxRequest(pathname, q, method, isNavigation) {
  const lzt = q.get("lzt");
  if (/\.lzx\.js$/.test(pathname) || lzt === "js") return OP.COMPILED;
  if (!/\.lzx$/.test(pathname)) return null;

  if (method === "POST" && q.has("edit")) return OP.EDIT_POST;
  if (q.has("srctext"))                    return OP.SRCTEXT;
  if (q.has("source") || lzt === "source") return OP.SOURCE;
  if (q.has("edit"))                       return OP.EDIT;
  if (lzt === "xml")                       return OP.RAWXML;
  // bare `.lzx` (or `lzt=html`): a page navigation runs it; anything else gets the source.
  if (isNavigation || lzt === "html")      return OP.RUN;
  return OP.RAWXML;
}
