// views.mjs — SHARED HTML for the dev views (source pane, source|app frameset, live editor).
//
// Pure templates so the Node server and the Service Worker render the SAME inspect/edit UI.
// Each runtime resolves its own URLs (the server runs at "/", the SW carries a BASE prefix
// and an explicit RUNTIME_URL) and passes them in; the markup is identical either way.

export const escHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `?source` — a frameset: read-only source (left) beside the running app (right).
 *  `physPath` is the app's `.lzx` URL with any BASE prefix already applied. */
export function framesetHtml(physPath) {
  return `<!doctype html><html><head><title>OpenLaszlo — Source</title></head>
    <frameset cols="50%,50%" frameborder="1" framespacing="2">
      <frame name="src" src="${physPath}?srctext">
      <frame name="app" src="${physPath}">
    </frameset></html>`;
}

/** `?srctext` — the read-only LZX source pane. `code` is the RAW source (escaped here);
 *  `cssUrl` points at the distro's explore.css. */
export function srcTextHtml(path, code, cssUrl) {
  return `<!doctype html><html><head><meta charset=utf-8><title>${path}</title>
    <link rel="stylesheet" href="${cssUrl}">
    <style>body{margin:0;font:12px monospace}h3{font:bold 13px sans-serif;margin:6px 8px;color:#335}
      pre{margin:0 8px;white-space:pre;overflow:auto}</style></head>
    <body class="source-view"><h3>${path}</h3><pre>${escHtml(code)}</pre></body></html>`;
}

/** `?edit` — the live editor: editable source (left) + preview iframe (right) + Run, which
 *  POSTs the edited source to `…?edit` and reloads the preview to the returned URL. `physPath`
 *  is the app's `.lzx` URL (preview src); `code` is the RAW source (escaped here). */
export function editorHtml(name, code, physPath) {
  return `<!doctype html><html><head><meta charset=utf-8><title>Edit — ${name}</title>
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
  <div id="wrap"><textarea id="ed" spellcheck="false">${escHtml(code)}</textarea>
    <iframe id="out" src="${physPath}"></iframe></div>
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
  </script></body></html>`;
}
