// wrapper.mjs — the server-side HTML wrapper for a `<name>.lzx` navigation.
//
// This is the original OpenLaszlo server's DEFAULT request type (`lzt=html`): a bare app
// URL returns an HTML page that BOOTS the app — it pulls in the DHTML runtime (lfc.js, the
// debug/backtrace/profile variant chosen by the URL flags), points a loader at the COMPILED
// `<name>.lzx.js`, gives the app a container div, and shows a splash until onload. (An
// explicit/programmatic `.lzx` fetch still gets the raw XML source — the old `lzt=xml`.)
//
// Ported from the Service Worker's `renderWrapper`/`navResponse`/`canvasAttrs`/flag helpers
// so the Node server can serve apps WITHOUT the Service Worker (the SW is now static-only;
// see README + service-worker.js). The runtime references resolve against `/runtime`, which
// the server serves directly.

import { readFileSync } from "node:fs";

const RUNTIME_URL = "/runtime";   // the server serves runtime/ at the origin root

const DEF_ATTRS = { bgcolor: "#ffffff", width: "100%", height: "100%" };

/** Pull the canvas bgcolor/width/height from `.lzx` SOURCE TEXT (for the page chrome, so the
 *  splash/body don't flash the wrong color before the app paints). */
export function canvasAttrsFromText(txt) {
  try {
    const tag = (txt.match(/<canvas\b[^>]*>/i) || [""])[0];
    const get = (n) => ((tag.match(new RegExp("\\b" + n + "\\s*=\\s*[\"']([^\"']+)[\"']", "i")) || [])[1] || "").trim();
    const bg = get("bgcolor");
    return {
      bgcolor: /^0x[0-9a-fA-F]{6}$/.test(bg) ? "#" + bg.slice(2)
             : /^#[0-9a-fA-F]{3,6}$/.test(bg) ? bg
             : (bg || DEF_ATTRS.bgcolor),
      width: get("width") || DEF_ATTRS.width,
      height: get("height") || DEF_ATTRS.height,
    };
  } catch { return DEF_ATTRS; }
}

/** Same, reading from a `.lzx` file on disk. */
export function canvasAttrs(srcAbs) {
  try { return canvasAttrsFromText(readFileSync(srcAbs, "utf8")); } catch { return DEF_ATTRS; }
}

/** Parse the build-mode flags from a `.lzx` navigation's query. Unlike the SW's copy, a
 *  proxied request is NOT refused here — the server HAS a data proxy (server/data-proxy.mjs).
 *  The SWF runtime is still gone. */
export function parseFlags(sp) {
  const on = (v) => v !== null && v !== "false";
  const backtrace = on(sp.get("backtrace")) || on(sp.get("lzbacktrace"));
  const debug = on(sp.get("debug")) || backtrace;
  const profile = on(sp.get("profile")) || on(sp.get("lzprofile"));
  const flags = { debug, backtrace, profile, lzconsoledebug: on(sp.get("lzconsoledebug")), unsupported: null };
  const rt = sp.get("lzr") || sp.get("lzt");
  if (rt && /swf/i.test(rt))
    flags.unsupported = "the SWF runtime is retired; only the DHTML runtime is available.";
  return flags;
}

/** The query appended to the wrapper's `<name>.lzx.js` so the compile sees the build flags. */
export function flagQuery(flags) {
  const q = [];
  if (flags.debug) q.push("debug=true");
  if (flags.backtrace) q.push("lzbacktrace=true");   // the embed-preserved spelling
  if (flags.profile) q.push("lzprofile=true");
  if (flags.lzconsoledebug) q.push("lzconsoledebug=true");
  return q.length ? "?" + q.join("&") : "";
}

/** The wrapper HTML (post-rewrite oracle page shape), parameterized so runtime references
 *  resolve against RUNTIME_URL and the app loads its SIBLING `<name>.lzx.js`. */
export function renderWrapper({ base, runtimeUrl = RUNTIME_URL, bgcolor = "#ffffff", width = "100%", height = "100%", debug = false, backtrace = false, profile = false, appQuery = "" }) {
  const rt = runtimeUrl.replace(/\/$/, "");
  const url = `${base}.lzx.js${appQuery}`;
  const lfcurl = `${rt}/lfc/${backtrace ? "lfc-backtrace.js" : profile ? "lfc-profile.js" : debug ? "lfc-debug.js" : "lfc.js"}`;
  return `<!DOCTYPE html
  PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
   <meta http-equiv="X-UA-Compatible" content="chrome=1"><link rel="SHORTCUT ICON" href="/favicon.ico"><meta name="viewport" content="width=device-width; initial-scale=1.0;"><title>OpenLaszlo: ${base}</title><script type="text/javascript" src="${rt}/embed.js"></script><!--[if lt IE 9]><script type="text/javascript" src="${rt}/includes/excanvas.js"></script><![endif]--><style type="text/css">
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

/** Build the wrapper for a `.lzx` navigation. `lzxRel` is the app's distro-relative path
 *  (e.g. `/examples/calendar/calendar.lzx`); `srcAbs` is the on-disk source (for canvas
 *  attrs). Returns `{ html }` or `{ unsupported }`. */
export function wrapperFor(lzxRel, srcAbs, searchParams) {
  const flags = parseFlags(searchParams);
  if (flags.unsupported) return { unsupported: flags.unsupported };
  const base = lzxRel.replace(/.*\//, "").replace(/\.lzx$/, "");
  const { bgcolor, width, height } = canvasAttrs(srcAbs);
  return {
    html: renderWrapper({
      base, bgcolor, width, height,
      debug: flags.debug, backtrace: flags.backtrace, profile: flags.profile, appQuery: flagQuery(flags),
    }),
  };
}
