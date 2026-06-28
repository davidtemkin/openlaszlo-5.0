// data-proxy.mjs — the OpenLaszlo "proxied" data service (the `lzt=xmldata` request type).
//
// This is the server half of the runtime's proxied data path. When an app runs in proxied
// mode (a `<dataset proxied="true">`, a `<canvas proxied="true">`, or a `?lzproxied=true`
// URL override — see README), the DHTML runtime does NOT fetch a dataset's `src` URL
// directly. Instead `lz.Browser.makeProxiedURL` (LzBrowser.lzs) sends the request to the
// server that served the app, carrying the real target in a query arg:
//
//   GET <appbase>?lzt=xmldata&url=<absolute target>&reqtype=GET
//                 [&lzpostbody=…] [&headers="Name: v\nName2: v2\n"] [&timeout=…] [&…]
//
// We fetch <target> SERVER-SIDE and return the body — bypassing the browser's same-origin
// policy, which is the entire point of proxied mode (a SOLO/static app can only load data
// from its own origin). The DHTML data loader parses the body as XML, so we return it as
// text/xml. This mirrors ResponderDATA + HTTPDataSource in the original Java server.
//
// SECURITY — this is a server-side fetch driven by a client-supplied URL, i.e. a potential
// SSRF / open relay. So a target is allowed only if it is:
//   * same-host as the app (the common case — localhost in development), OR
//   * on the configured ALLOWED_HOSTS list below.
// Everything else gets a 403. (Same-HOST, not same-origin-incl-port, so any localhost:PORT
// is reachable in dev, per the distro's local-first use.)

import http from "node:http";
import https from "node:https";

// Configured cross-host allowlist. Same-host targets are always allowed; add external
// hosts here to permit them. An entry beginning with "." matches that domain and all
// subdomains (".example.com" → example.com, api.example.com). Exact host otherwise.
export const ALLOWED_HOSTS = [
  // "api.flickr.com",       // example: uncomment to let proxied apps reach Flickr
];

/** Is `targetHost` reachable, given the app was served from `originHost`? */
export function hostAllowed(targetHost, originHost) {
  if (!targetHost) return false;
  if (originHost && targetHost === originHost) return true;            // same-host (localhost &c.)
  return ALLOWED_HOSTS.some((h) =>
    h.startsWith(".") ? targetHost === h.slice(1) || targetHost.endsWith(h)
                      : targetHost === h);
}

// Hop-by-hop headers never forwarded to the client (per RFC 2616 §13.5.1).
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding",
]);

const xmlAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wrap fetched XML in the `<resultset><body>…</body><headers>…</headers></resultset>`
 *  envelope the DHTML runtime's PROXIED data path expects (XMLGrabber.java; consumed by
 *  LzHTTPDataProvider — proxied reads body = childNodes[0].childNodes[0], headers =
 *  childNodes[1]). A raw passthrough leaves the dataset empty. */
function resultset(rawXml, upstreamHeaders, sendheaders) {
  const body = rawXml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");   // an XML decl can't sit inside <body>
  let hdrs = "";
  if (sendheaders) {
    for (const [k, v] of Object.entries(upstreamHeaders || {})) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      const val = Array.isArray(v) ? v.join(", ") : v;
      hdrs += `<header name="${xmlAttr(k)}" value="${xmlAttr(val)}"/>`;
    }
  }
  return `<resultset><body>${body}</body><headers>${hdrs}</headers></resultset>`;
}

/** The error envelope the proxied path recognizes (LzHTTPDataProvider checks
 *  `childNodes[0].nodeName == "error"`). */
const errorset = (msg) => `<resultset><error msg="${xmlAttr(msg)}"/></resultset>`;

/** Read a request body to a string (bounded). */
function readBody(req, max = 1 << 20) {
  return new Promise((resolve) => {
    let data = "", over = false;
    req.on("data", (c) => { if (!over) { data += c; if (data.length > max) { over = true; data = data.slice(0, max); } } });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(data));
  });
}

/** Parse the runtime's newline-joined `headers` query arg into an object. */
function parseHeaders(raw) {
  const out = {};
  if (!raw) return out;
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * If `url` is a proxied-data request (`lzt=xmldata`/`data`), handle it and return true.
 * Otherwise return false so the caller continues normal routing.
 */
export async function handleDataProxy(req, res, url) {
  // The runtime sends the proxy args either in the query (GET form) or, as observed in the
  // DHTML loader, in a `application/x-www-form-urlencoded` POST body. Read the body for
  // non-/api POSTs (the proxied request rides the app's own `<name>.lzx.js`; /api bodies
  // belong to the example-data handlers) and merge it with the query.
  let params = url.searchParams;
  const ct = (req.headers["content-type"] || "");
  if (req.method === "POST" && !url.pathname.startsWith("/api/") && ct.includes("application/x-www-form-urlencoded")) {
    const bp = new URLSearchParams(await readBody(req));
    if (bp.get("lzt")) params = bp;            // a data POST → use the body params
  }
  const lzt = params.get("lzt");
  if (lzt !== "xmldata" && lzt !== "data") return false;

  const end = (status, body, type = "text/plain") =>
    res.writeHead(status, { "Content-Type": type + ";charset=UTF-8", "Cache-Control": "no-cache" }) && res.end(body);

  const target = params.get("url");
  if (!target) return end(400, "data proxy: missing `url`"), true;

  let t;
  try { t = new URL(target); }
  catch { return end(400, "data proxy: malformed `url`: " + target), true; }
  if (t.protocol !== "http:" && t.protocol !== "https:")
    return end(400, "data proxy: unsupported scheme: " + t.protocol), true;

  const originHost = (req.headers.host || "").split(":")[0];
  if (!hostAllowed(t.hostname, originHost))
    return end(403, `data proxy: host not allowed: ${t.hostname}\n` +
                    `(allowed: same host as the app — ${originHost || "?"} — or add to ALLOWED_HOSTS in server/data-proxy.mjs)`), true;

  const method = (params.get("reqtype") || "GET").toUpperCase();
  const postbody = params.get("lzpostbody");
  const headers = parseHeaders(params.get("headers"));
  if (method === "POST" && postbody != null && !headers["Content-Type"])
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";

  const sendheaders = params.get("sendheaders") !== "false";   // default true (XMLGrabber)
  const sendXml = (body, type = "text/xml") =>
    res.writeHead(200, { "Content-Type": type + ";charset=UTF-8", "Cache-Control": "no-cache" }) && res.end(body);

  const lib = t.protocol === "https:" ? https : http;
  const preq = lib.request(t, { method, headers }, (pres) => {
    const chunks = [];
    pres.on("data", (c) => chunks.push(c));
    pres.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (pres.statusCode && pres.statusCode >= 400)
        return sendXml(errorset(`upstream HTTP ${pres.statusCode}`));
      // Wrap in the <resultset><body>…</body><headers>…</headers></resultset> envelope the
      // runtime's proxied data path requires (a raw passthrough leaves the dataset empty).
      sendXml(resultset(raw, pres.headers, sendheaders));
    });
  });
  preq.on("error", (e) => { if (!res.headersSent) sendXml(errorset("upstream error: " + e.message)); });
  const timeout = parseInt(params.get("timeout") || "30000", 10);
  if (timeout > 0 && isFinite(timeout)) preq.setTimeout(timeout, () => preq.destroy(new Error("timeout")));
  if (method === "POST" && postbody != null) preq.write(postbody);
  preq.end();
  return true;
}
