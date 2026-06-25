#!/usr/bin/env node
// Split the refguide-multi.xsl blob (/tmp/ref-blob.html) into per-class pages with a
// shared, filterable sidebar (no frames). Writes docs/reference/{<key>.html, _nav.js,
// ref.css, index.html}. Dedupes by key (tags emitted first → win over same-named class
// and over runtime +variants).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../reference");        // openlaszlo/docs/reference
const blob = fs.readFileSync(process.argv[2] || "/tmp/ref-blob.html", "utf8");

// the original's documented public classes — used to drop internal implementation
// classes (kernels/sprites/loaders/expr/…) from the non-tag class category. A class is
// kept only if it is explicitly access="public" OR appears in this list.
const docFile = path.join(HERE, "documented-classes.txt");
const documented = new Set(fs.existsSync(docFile)
  ? fs.readFileSync(docFile, "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")) : []);

// each element div has no nested <div>, so a non-greedy match to </div> is safe
const re = /<div class="element" id="([^"]*)" data-cat="([^"]*)" data-name="([^"]*)" data-access="([^"]*)">([\s\S]*?)<\/div>/g;
const stripSvc = k => k.replace(/service$/, "");          // LzBrowserService→browser (4.9 renamed the originals' LzBrowser→LzBrowserService)
const entries = []; const seen = new Set(); let dropped = 0; let m;
while ((m = re.exec(blob))) {
  let [, key, cat, name, access, body] = m;
  if (cat === "class") {
    const sk = stripSvc(key), skc = sk + "class";          // browserservice→browser; trackservice→track→trackclass (4.9 renamed the originals' LzBrowser/LzTrackClass→…Service)
    if (documented.has(key)) { /* original used this exact name — keep */ }
    else if (sk !== key && documented.has(sk) && !seen.has(sk)) key = sk;     // →cursor/browser/timer
    else if (sk !== key && documented.has(skc) && !seen.has(skc)) key = skc;  // →trackclass/idleclass/instantiatorclass
    else if (access === "public") { /* explicitly-public class not in the list — keep as-is */ }
    else { dropped++; continue; }                          // internal (kernels/sprites/loaders/…)
  }
  if (!key || seen.has(key)) continue;                    // dedupe (first wins)
  seen.add(key);
  entries.push({ key, cat, name, body });
}
entries.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);

// dev-guide pages, to resolve doc-text cross-links into the guide
const devDir = path.resolve(OUT, "../developers");
const devPages = new Set();
if (fs.existsSync(devDir)) {
  for (const f of fs.readdirSync(devDir)) if (f.endsWith(".html")) devPages.add("../developers/" + f);
  const td = path.join(devDir, "tutorials");
  if (fs.existsSync(td)) for (const f of fs.readdirSync(td)) if (f.endsWith(".html")) devPages.add("../developers/tutorials/" + f);
}
// Rewrite doc-text <a> links to something that resolves, else DROP the href (→ plain text,
// as it was before): our #key anchors + the original lz.Foo.html scheme → <key>.html;
// the ${dguide}/${tutorials} template vars → the built guide; anything else unresolved → strip.
const fixLinks = s => s
  .replace(/href="#([^"]+)"/g, (full, k) => seen.has(k) ? `href="${k}.html"` : "")
  .replace(/href="(?:[^"]*\/)?(?:lz\.|Lz)([A-Za-z][A-Za-z0-9]*)(?:\+[a-z0-9+]*)?\.html"/g,
           (full, cls) => { const k = cls.toLowerCase(); return seen.has(k) ? `href="${k}.html"` : ""; })
  .replace(/href="\$\{dguide\}\/?/g, 'href="../developers/').replace(/href="\$\{tutorials\}\/?/g, 'href="../developers/tutorials/')
  .replace(/href="([^"]+)"/g, (full, h) => {
    const refpage = /^[A-Za-z0-9_-]+\.html$/.test(h) && seen.has(h.replace(/\.html$/, ""));
    return (refpage || devPages.has(h)) ? full : "";          // keep resolvable, else drop href
  });

const PAGE = (e) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${e.cat === "class" ? e.name : "&lt;" + e.name + "&gt;"} — LZX Reference</title>
<link rel="stylesheet" href="ref.css"></head>
<body><nav id="refnav"></nav>
<main class="refmain"><a class="up" href="index.html">LZX Reference</a>
${fixLinks(e.body).trim()}
</main><script src="_nav.js"></script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
// clear stale per-page html (keep nothing of the old single page)
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".html")) fs.rmSync(path.join(OUT, f));

for (const e of entries) fs.writeFileSync(path.join(OUT, e.key + ".html"), PAGE(e));

// ---- shared sidebar (_nav.js) ----
const navData = entries.map(e => ({ k: e.key, n: e.name, c: e.cat }));
fs.writeFileSync(path.join(OUT, "_nav.js"),
`var REFNAV=${JSON.stringify(navData)};
(function(){
  var host=document.getElementById('refnav'); if(!host) return;
  var cur=(location.pathname.split('/').pop()||'').replace(/\\.html$/,'');
  var cats=[['all','All'],['tag','Tags'],['class','Classes'],['lang','Lang']];
  var h='<div class="navtitle"><a href="index.html">LZX Reference</a></div>';
  h+='<input id="navq" placeholder="filter\\u2026" autocomplete="off">';
  h+='<div class="navcats">'+cats.map(function(c){return '<button data-c="'+c[0]+'"'+(c[0]==='all'?' class="on"':'')+'>'+c[1]+'</button>';}).join('')+'</div>';
  h+='<ul class="navlist">'+REFNAV.map(function(e){
      var lbl=e.c==='class'?e.n:'&lt;'+e.n+'&gt;';
      return '<li data-c="'+e.c+'" data-n="'+e.n.toLowerCase()+'"'+(e.k===cur?' class="cur"':'')+'><a href="'+e.k+'.html">'+lbl+'</a></li>';
    }).join('')+'</ul>';
  host.innerHTML=h;
  var cat='all', q='', lis=host.querySelectorAll('.navlist li');
  function apply(){ for(var i=0;i<lis.length;i++){ var li=lis[i];
    var ok=(cat==='all'||li.getAttribute('data-c')===cat)&&(q===''||li.getAttribute('data-n').indexOf(q)>=0);
    li.style.display=ok?'':'none'; } }
  host.querySelector('#navq').addEventListener('input',function(e){q=e.target.value.toLowerCase();apply();});
  var bs=host.querySelectorAll('.navcats button');
  for(var i=0;i<bs.length;i++) bs[i].addEventListener('click',function(e){ cat=e.target.getAttribute('data-c');
    for(var j=0;j<bs.length;j++) bs[j].className=''; e.target.className='on'; apply(); });
  var c=host.querySelector('.navlist li.cur'); if(c) c.scrollIntoView({block:'center'});
})();`);

// ---- shared stylesheet (ref.css) ----
fs.writeFileSync(path.join(OUT, "ref.css"),
`*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#222}
#refnav{position:fixed;top:0;left:0;width:250px;height:100vh;overflow:auto;background:#f7f8fb;border-right:1px solid #dde1ea;padding:12px 0}
.navtitle{font-weight:700;font-size:15px;padding:4px 16px 10px;color:#394660}
.navtitle a{color:#394660;text-decoration:none}
#navq{width:calc(100% - 24px);margin:0 12px 8px;padding:5px 8px;border:1px solid #cbd2e0;border-radius:4px;font:13px sans-serif}
.navcats{display:flex;gap:3px;padding:0 12px 8px;flex-wrap:wrap}
.navcats button{font:11px sans-serif;padding:3px 8px;border:1px solid #cbd2e0;background:#fff;border-radius:3px;cursor:pointer;color:#556}
.navcats button.on{background:#3f6fd1;color:#fff;border-color:#3f6fd1}
.navlist{list-style:none;margin:0;padding:0}
.navlist li{margin:0}
.navlist a{display:block;padding:2px 16px;font-family:Menlo,monospace;font-size:12px;color:#345;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.navlist a:hover{background:#e9eef9}
.navlist li.cur a{background:#3f6fd1;color:#fff}
.refmain{margin-left:250px;max-width:880px;padding:24px 40px 80px}
.up{font-size:12px;color:#36c;text-decoration:none}.up:hover{text-decoration:underline}
.refmain h1{font-size:25px;color:#394660;border-bottom:2px solid #394660;padding-bottom:8px;margin:.3em 0 .2em}
.refmain h1 .ang{color:#8a94a6;font-weight:normal}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#778;margin:1.6em 0 .4em}
.short{font-style:italic;color:#445;margin:.2em 0 .6em;font-size:15px}
.meta{font-size:13px;color:#778;margin:0 0 1em}.meta code{background:none;color:#36c}
code{background:#f2f3f6;padding:1px 4px;border-radius:3px;font-family:Menlo,monospace;font-size:.9em;color:#234}
pre{background:#f6f7f9;border:1px solid #e2e4ea;border-left:3px solid #8aa;padding:10px 14px;overflow:auto;font:12.5px/1.45 Menlo,monospace;border-radius:3px}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:.3em 0 1.2em;font-size:13px}
th,td{border:1px solid #dde;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#eef;color:#394660}
td.nm{font-family:Menlo,monospace;white-space:nowrap;color:#225}
td.ty{font-family:Menlo,monospace;color:#778;font-size:12px;white-space:nowrap}
ul.events{list-style:none;padding-left:0}ul.events li{margin:.25em 0}ul.events code{color:#638}
ul.methods{columns:2;-webkit-columns:2;list-style:none;padding-left:0;font-size:13px}ul.methods code{color:#262}
a{color:#36c;text-decoration:none}a:hover{text-decoration:underline}
.idx{columns:4;-webkit-columns:4;list-style:none;padding:0;font-family:Menlo,monospace;font-size:12.5px}
@media(max-width:700px){#refnav{position:static;width:auto;height:auto;border-right:0;border-bottom:1px solid #dde}.refmain{margin-left:0}}`);

// ---- landing index ----
const counts = { tag: 0, class: 0, lang: 0 }; entries.forEach(e => counts[e.cat]++);
fs.writeFileSync(path.join(OUT, "index.html"),
`<!doctype html><html><head><meta charset="utf-8"><title>LZX Element Reference</title>
<link rel="stylesheet" href="ref.css"></head>
<body><nav id="refnav"></nav>
<main class="refmain"><h1>LZX Element Reference</h1>
<p class="short">Reference for the LZX tags, components, classes and language tags, generated from the LFC source.</p>
<p class="meta">${entries.length} entries &#183; ${counts.tag} tags &#183; ${counts.class} classes &#183; ${counts.lang} language tags &#183; see also the <a href="../developers/index.html">Developer's Guide</a>. Use the sidebar to filter and search.</p>
<ul class="idx">${entries.map(e => `<li><a href="${e.key}.html">${e.cat === "class" ? e.name : "&lt;" + e.name + "&gt;"}</a></li>`).join("")}</ul>
</main><script src="_nav.js"></script></body></html>`);

console.log(`reference: ${entries.length} pages (${counts.tag} tags, ${counts.class} classes, ${counts.lang} lang; dropped ${dropped} internal classes) -> ${OUT}`);
