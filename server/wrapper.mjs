// wrapper.mjs — generate the app HTML page (the running page) from scratch for the
// TS-compiled backend. Mirrors the structure the Java oracle's DeployMain emits, AFTER
// compile.mjs's rewriteWrapper() points it at the SHARED /runtime instead of a bundled
// copy. The reference is an oracle-produced site/index.html (see server/.cache/*/site/).
//
// Differences vs the raw oracle page (all intentional, all served the same way the
// rewritten oracle page is):
//   - <script src="/runtime/embed.js">                 (shared embed, not embed-compressed)
//   - lz.embed.__serverroot="/runtime/includes/";      (where the embed helpers load from)
//   - lfcurl: '/runtime/lfc/lfc.js' (or lfc-debug.js)  (shared LFC)
//   - url: '<base>.lzx.js' (+ ?lzconsoledebug=true in debug)
//   - #appcontainer div + #lzsplash spinner
// The <base>.lzx.js itself is the byte-exact TS compiler output.

// The exact page the oracle emits (then rewriteWrapper mutates). We reproduce the
// post-rewrite form directly. `title` is cosmetic; `base` drives the url.
export function renderWrapper({ base, debug = false }) {
  const url = debug ? `${base}.lzx.js?lzconsoledebug=true` : `${base}.lzx.js`;
  const lfcurl = debug ? "/runtime/lfc/lfc-debug.js" : "/runtime/lfc/lfc.js";
  return `<!DOCTYPE html
  PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
   <meta http-equiv="X-UA-Compatible" content="chrome=1"><link rel="SHORTCUT ICON" href="http://www.laszlosystems.com/favicon.ico"><meta name="viewport" content="width=device-width; initial-scale=1.0;"><title>OpenLaszlo 5.0: ${base}</title><script type="text/javascript" src="/runtime/embed.js"></script><!--[if lt IE 9]><script type="text/javascript" src="/runtime/includes/excanvas.js"></script><![endif]--><style type="text/css">
            html, body
            {
                /* http://www.quirksmode.org/css/100percheight.html */
                height: 100%;
                /* prevent browser decorations */
                margin: 0;
                padding: 0;
                border: 0 none;
            }
            body {
                background-color: #ffffff;
            }
            img { border: 0 none; }
        </style><!--[if IE]>
        <style type="text/css">
            /* Fix IE scrollbar braindeath */
            html { overflow: auto; overflow-x: hidden; }
        </style>
        <![endif]--></head><body><div id="appcontainer"></div><div id="lzsplash" style="z-index: 10000000; top: 0; left: 0; width: 100%; height: 100%; position: fixed; display: table"><p style="display: table-cell; vertical-align: middle;"><img src="/runtime/includes/spinner.gif" style="display: block; margin: 20% auto" alt="application initializing"></p></div><script type="text/javascript" defer>
                  lz.embed.resizeWindow('100%', '100%');
                  lz.embed.__serverroot="/runtime/includes/";lz.embed.dhtml({url: '${url}', lfcurl: '${lfcurl}', serverroot: 'lps/resources/', bgcolor: '#ffffff', width: '100%', height: '100%', id: 'lzapp', accessible: 'false', cancelmousewheel: false, cancelkeyboardcontrol: false, skipchromeinstall: false, usemastersprite: false, approot: '', appenddivid: 'appcontainer'});
                  lz.embed.applications.lzapp.onload = function loaded() {
                    // called when this application is done loading
                    var el = document.getElementById('lzsplash');
                    if (el.parentNode) {
                        el.parentNode.removeChild(el);
                    }
                  }
                </script><noscript>
                Please enable JavaScript in order to use this application.
            </noscript></body></html>`;
}
