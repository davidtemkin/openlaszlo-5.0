// dev-views.mjs — the server-native dev views (source pane, source|app frameset, live
// editor + Run). The Service Worker emulates the SAME requests in-browser for static
// hosting; both classify requests via startup/reqtypes.mjs and render via startup/views.mjs,
// so the two deployments behave identically. This module is the server half: it reads source
// from disk and recompiles edited source with the real TypeScript compiler.

import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { srcTextHtml, framesetHtml, editorHtml } from "../startup/views.mjs";
import { renderWrapper, canvasAttrsFromText } from "./wrapper.mjs";
import { compileApp, DISTRO } from "./compile.mjs";
import { toSourceUrl } from "../startup/urlmap.mjs";

const CSS = "/runtime/theme/explore.css";
const edits = new Map();   // token -> { js, src }  (an edited app's compiled JS + its source)
let editSeq = 0;

const sendHtml = (res, body, status = 200) => { res.writeHead(status, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache" }); res.end(body); };
const sendJson = (res, obj) => { res.writeHead(200, { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-cache" }); res.end(JSON.stringify(obj)); };
const sendJs = (res, js) => { res.writeHead(200, { "Content-Type": "text/javascript;charset=utf-8", "Cache-Control": "no-cache" }); res.end(js); };

function readBody(req, max = 1 << 20) {
  return new Promise((resolve) => {
    let d = "", over = false;
    req.on("data", (c) => { if (!over) { d += c; if (d.length > max) { over = true; d = d.slice(0, max); } } });
    req.on("end", () => resolve(d));
    req.on("error", () => resolve(d));
  });
}

/** Resolve a request path to its on-disk `.lzx` source, or null. */
function srcOf(reqPath) {
  const abs = path.normalize(path.join(DISTRO, toSourceUrl(reqPath)));
  if (!abs.startsWith(DISTRO) || !existsSync(abs)) return null;
  return abs;
}

// ── the read-only views ───────────────────────────────────────────────────────────────
export function serveSource(res, reqPath) {            // ?source / lzt=source
  sendHtml(res, framesetHtml(reqPath));
}
export function serveSrcText(res, reqPath) {           // ?srctext
  const abs = srcOf(reqPath);
  if (!abs) return sendHtml(res, `<h3>404 — ${reqPath}</h3>`, 404);
  sendHtml(res, srcTextHtml(reqPath, readFileSync(abs, "utf8"), CSS));
}
export function serveEditor(res, reqPath) {            // ?edit (GET)
  const abs = srcOf(reqPath);
  if (!abs) return sendHtml(res, `<h3>404 — ${reqPath}</h3>`, 404);
  sendHtml(res, editorHtml(reqPath.split("/").pop(), readFileSync(abs, "utf8"), reqPath));
}

// ── the editor's Run: compile edited source, stash by token ─────────────────────────────
export async function editCompile(req, res, reqPath) { // ?edit (POST)
  const body = await readBody(req);
  const orig = path.normalize(path.join(DISTRO, toSourceUrl(reqPath)));
  if (!orig.startsWith(DISTRO)) return sendJson(res, { ok: false, error: "bad path" });
  const token = "e" + (++editSeq);
  // Compile the edited source by writing it as a sibling temp file (so `<include>`s resolve
  // against the app's own dir), compiling with the real compiler, then deleting it. The JS
  // is stashed in memory and served at `.edit-<token>.lzx.js`; nothing persists on disk.
  const tmp = path.join(path.dirname(orig), `.${token}.lzx`);
  try {
    writeFileSync(tmp, body);
    const r = compileApp(tmp, {});
    if (r.unsupported) return sendJson(res, { ok: false, error: "compile UNSUPPORTED: " + r.unsupported });
    edits.set(token, { js: r.js, src: body });
    if (edits.size > 40) edits.delete(edits.keys().next().value);   // bound memory
    sendJson(res, { ok: true, url: reqPath.replace(/\/[^/]*$/, "") + "/.edit-" + token + ".lzx" });
  } catch (e) {
    sendJson(res, { ok: false, error: (e && e.message) ? e.message : String(e) });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ── serving an edited app's preview (`.edit-<token>.lzx` wrapper + `.lzx.js`) ────────────
/** If `reqPath` is an edit-preview URL, returns { token, js } else null. */
export function editToken(reqPath) {
  const m = reqPath.match(/\/\.edit-(e\d+)\.lzx(\.js)?$/);
  return m ? { token: m[1], js: !!m[2] } : null;
}
export function serveEditApp(res, reqPath, t) {
  const e = edits.get(t.token);
  if (!e) return t.js ? sendJs(res, 'console.error("[OpenLaszlo] edit preview expired")')
                      : sendHtml(res, "<h3>edit preview expired — re-run from the editor</h3>", 410);
  if (t.js) return sendJs(res, e.js);
  const { bgcolor, width, height } = canvasAttrsFromText(e.src);
  sendHtml(res, renderWrapper({ base: ".edit-" + t.token, bgcolor, width, height }));
}
