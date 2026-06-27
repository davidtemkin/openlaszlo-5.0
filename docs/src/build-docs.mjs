#!/usr/bin/env node
// Build the OpenLaszlo 4 guides from their DocBook sources (docs/src/<name>/) into
// chunked, styled HTML (docs/<name>/) using the standard docbook-xsl chunker.
//
// The stock OL build pulled DocBook XSL from SourceForge (offline-broken) and used a
// Saxon/Xalan textinsert extension to pull external code examples. Here we instead:
//   - resolve the DTD via the local XML catalog (brew docbook),
//   - drop XInclude refs to chapters not present in this source snapshot,
//   - convert <textobject><textdata fileref=X/> -> <xi:include href=X parse="text"/>
//     so xsltproc inlines the .lzx example sources natively,
//   - chunk with docbook-xsl + our docs/includes/ol4-docs.css.
//
// Requires: xsltproc, brew `docbook-xsl` + `docbook`. Run: node build-docs.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SRCROOT = path.dirname(fileURLToPath(import.meta.url));   // docs/src
const DOCS = path.dirname(SRCROOT);                             // docs
const DBX = "/opt/homebrew/opt/docbook-xsl/docbook-xsl";
const CATALOG = "/opt/homebrew/etc/xml/catalog";
const env = { ...process.env, XML_CATALOG_FILES: CATALOG };

const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const cpR = (s, d) => execFileSync("cp", ["-R", s, d]);

// ---- live-example compile validation -------------------------------------
// Only attach a Run/Edit toolbar to a snippet that ACTUALLY COMPILES with the
// in-browser compiler. Otherwise malformed illustrative fragments (and examples
// whose companion file is missing) would ship a broken Run button. Data/network
// examples still compile (the data load is a runtime concern), so they keep their
// toolbar. Self-contained: we build a throwaway LPS_HOME from the distro's OWN
// runtime/ — the compiler's node resolver wants <home>/lps/{components,fonts,lfc}
// + <home>/WEB-INF/lps/misc/lzx-autoincludes.properties — and use the distro's own
// compiler bundle. If either isn't present (e.g. the compiler isn't built), the
// check is skipped with a warning and every <canvas>-rooted snippet keeps its toolbar.
const DISTRO = path.dirname(DOCS);
let validateCompile = null;   // (source, srcGuideDir, runName) => boolean
try {
  const { compile } = await import(path.join(DISTRO, "compiler/dist/compile.js"));
  const { nodeOptions } = await import(path.join(DISTRO, "compiler/dist/node-io.js"));
  const runtime = path.join(DISTRO, "runtime");
  const lpsHome = fs.mkdtempSync("/tmp/oldoc-lps-");
  fs.symlinkSync(runtime, path.join(lpsHome, "lps"));
  fs.mkdirSync(path.join(lpsHome, "WEB-INF/lps/misc"), { recursive: true });
  fs.symlinkSync(path.join(runtime, "lzx-autoincludes.properties"),
    path.join(lpsHome, "WEB-INF/lps/misc/lzx-autoincludes.properties"));
  validateCompile = (source, srcGuideDir, runName) => {
    try {
      const probe = path.join(srcGuideDir, "programs", runName);   // resolves siblings/resources
      const res = compile(source, { ...nodeOptions(probe, lpsHome), proxied: false, sprites: "none" });
      return !res.unsupported;
    } catch { return false; }   // parse / unresolved / refuse → not runnable
  };
} catch (e) {
  console.warn("  (live-example compile validation skipped: " + (e && e.message || e) + ")");
}

// ---- live examples -------------------------------------------------------
// The .dbk sources mark runnable snippets <example role="live-example">. The stock
// build embedded each as a running canvas + an "edit" link to editor.jsp. We restage
// the example .lzx files (sanitizing the `$` that breaks DeployMain's zip templating)
// and inject a Run/Edit toolbar after the matching <pre> in the chunked HTML.
const decodeEnt = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&#0*160;/g, " ").replace(/ /g, " ")
  .replace(/&amp;/g, "&");
const norm = s => decodeEnt(s).replace(/\r\n/g, "\n")
  .replace(/^\s*<\?xml[^>]*\?>\s*/i, "")                   // docbook-xsl drops the XML decl from the listing
  // an indented <textobject> in the .dbk leaves spurious leading indent on the inlined
  // first line → strip outer whitespace (per-line trailing too) so file==listing.
  .split("\n").map(l => l.replace(/\s+$/, "")).join("\n").trim();
const sanitizeName = n => n.replace(/\$/g, "_");          // $ breaks DeployUtils.buildZipFile replaceAll

// Doc embeds run debug-OFF. The distro ships the PRODUCTION runtime (no on-canvas debugger —
// Debug.makeDebugWindow / $reportException are absent), so a snippet with canvas debug="true" or
// a <debug> tag throws at init and hangs forever on the loading splash. Strip both from the staged
// (Run/Edit) copy — the source LISTING above each example still shows the original. No-op otherwise.
const stripDebug = s => s
  .replace(/<debug\b[^>]*\/>/g, "")
  .replace(/<debug\b[^>]*>[\s\S]*?<\/debug>/g, "")
  .replace(/(<canvas\b[^>]*?)\s+debug\s*=\s*(["'])(?:true|TRUE)\2/g, "$1");

// A live example's iframe should be as tall as its canvas. The CSS default is a fixed 240px, which
// clips taller apps (and over-pads short ones); read the declared canvas height ("100%"/absent →
// null = keep the CSS default), clamped to a sane range, and emit it as data-height for lzRun.
const canvasHeight = s => {
  const m = /<canvas\b[^>]*?\bheight\s*=\s*["'](\d+)(?:px)?["']/i.exec(s);
  return m ? Math.max(96, Math.min(620, +m[1])) : null;
};

// Strip the trailing X_LZ_COPYRIGHT_* legal block + the @LZX_VERSION@ marker comment from a
// displayed source listing (the stock docs never showed them). Handles both the raw `<!--` form
// (the staged file / map key) and the HTML-escaped `&lt;!--` form (the chunked <pre> listing).
const stripCopyright = s => s
  .replace(/\s*(?:<|&lt;)!--[\s\S]*?X_LZ_COPYRIGHT_BEGIN[\s\S]*?X_LZ_COPYRIGHT_END[\s\S]*?--(?:>|&gt;)/gi, "")
  .replace(/\s*(?:<|&lt;)!--\s*@LZX_VERSION@[\s\S]*?--(?:>|&gt;)/gi, "");

// Faithful to the stock docs, EVERY runnable LZX program gets a Run button (the compile gate above
// already excludes non-canvas / non-compiling fragments). An example DECLARING the debugger — a
// <debug> view or canvas debug="true" — was compiled in debug mode and shown WITH the on-canvas
// debugger by the stock SWF docs; in the distro the production runtime has no debugger, so run those
// debug-ON (lzRun appends ?debug → the SW loads lfc-debug.js and the framed LzDebugWindow shows their
// output, as the original did). NOTE: gated on the DECLARATION only — NOT a bare Debug.* call, which
// the stock server compiled in production (Debug inert, no window) — so this matches exactly when the
// original showed a debugger.
const usesDebug = s => /<debug\b/.test(s) || /\bdebug\s*=\s*(["'])true\1/i.test(s);

// scan a guide's .dbk for live-examples → { map: normSource -> runUrl, inlines: name->content }
function collectLiveExamples(srcGuideDir, outSub) {
  const map = new Map(), inlines = new Map(), heights = new Map(), debugUrls = new Set();
  const reEx = /<(example|informalexample)\b[^>]*role="live-example"[^>]*>([\s\S]*?)<\/\1>/g;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".dbk")) {
        const s = fs.readFileSync(p, "utf8"); let m;
        while ((m = reEx.exec(s))) {
          const body = m[2], fm = /<textdata\s+fileref="([^"]+)"/.exec(body);
          let source, runName;
          if (fm) {
            const fp = path.join(srcGuideDir, fm[1]);
            if (!fs.existsSync(fp)) continue;
            source = fs.readFileSync(fp, "utf8"); runName = sanitizeName(path.basename(fm[1]));
          } else {
            const pl = /<programlisting[^>]*>([\s\S]*?)<\/programlisting>/.exec(body);
            if (!pl) continue;
            source = decodeEnt(pl[1]);
            runName = "inline-" + crypto.createHash("md5").update(norm(source)).digest("hex").slice(0, 10) + ".lzx";
            inlines.set(runName, source.replace(/^\n+/, ""));
          }
          if (!/<canvas[\s>/]/.test(source)) continue;     // only runnable LZX programs get a toolbar
          if (validateCompile && !validateCompile(source, srcGuideDir, runName)) continue;  // …that compile
          const url = "/docs/" + outSub + "/programs/" + runName;
          map.set(norm(stripCopyright(source)), url);      // match the copyright-stripped <pre> listing
          if (usesDebug(source)) debugUrls.add(url);       // run debug-on so the framed debugger shows output
          const ch = canvasHeight(source); if (ch) heights.set(url, ch);
        }
      }
    }
  })(srcGuideDir);
  return { map, inlines, heights, debugUrls };
}

// copy programs/ (sanitized names, minus oracle compile artifacts) + write inline files
function stagePrograms(srcGuideDir, htmlDir, inlines) {
  const srcP = path.join(srcGuideDir, "programs"), dstP = path.join(htmlDir, "programs");
  const SKIP = new Set(["lps", "config.xml", "widget-icon.png"]);
  if (fs.existsSync(srcP)) (function cp(s, d) {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      if (e.name.startsWith(".") || SKIP.has(e.name) || /\.(lzx\.js|sprite\.png|wgt)$/.test(e.name)) continue;
      const sp = path.join(s, e.name), dp = path.join(d, sanitizeName(e.name));
      if (e.isDirectory()) cp(sp, dp);
      else if (e.name.endsWith(".lzx")) fs.writeFileSync(dp, stripCopyright(stripDebug(fs.readFileSync(sp, "utf8"))));  // run debug-off, no legal footer
      else fs.copyFileSync(sp, dp);
    }
  })(srcP, dstP);
  if (inlines.size) { fs.mkdirSync(dstP, { recursive: true }); for (const [n, c] of inlines) fs.writeFileSync(path.join(dstP, n), stripCopyright(stripDebug(c))); }
}

const liveWidget = (url, height, isDebug) =>
  `<div class="live-example"><div class="live-toolbar">` +
  `<button class="live-run" type="button" data-run="${url}"${height ? ` data-height="${height}"` : ""}${isDebug ? ` data-debug="1"` : ""} onclick="lzRun(this)">&#9654;&#xfe0e; Run</button>` +
  `<a class="live-edit" href="${url}?edit" target="_blank" rel="noopener">&#9998;&#xfe0e; Edit</a>` +
  `</div></div>`;
const liveScript =
  `<script>function lzRun(b){var d=b.parentNode.parentNode,f=d.querySelector('iframe.live-frame');` +
  `if(!f){f=document.createElement('iframe');f.className='live-frame';f.title='live example';` +
  `var h=b.getAttribute('data-height');if(h)f.style.height=h+'px';` +
  `d.appendChild(f);b.innerHTML='&#8635;&#xfe0e; Reload';}` +
  `var u=b.getAttribute('data-run');if(b.getAttribute('data-debug'))u+=(u.indexOf('?')<0?'?':'&')+'debug=true';f.src=u;}</script>`;

function convertTextdata(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) convertTextdata(p);
    else if (e.name.endsWith(".dbk")) {
      const s = fs.readFileSync(p, "utf8");
      const n = s
        // flatten <programlistingco> (callout overlay) → its inner <programlisting>; the
        // areaspec otherwise renders an <em> annotation INSIDE the <pre> (breaking the
        // source match) and none of these carry a <calloutlist> worth keeping.
        .replace(/<programlistingco>([\s\S]*?)<\/programlistingco>/g,
          (_, inner) => { const pl = inner.match(/<programlisting[\s\S]*?<\/programlisting>/); return pl ? pl[0] : inner; })
        // drop the <parameter role="canvas"> embed hints (canvas bgcolor/size) — they
        // render as a stray <em> appended inside the <pre>, not part of the source.
        .replace(/[ \t]*<parameter role="canvas">[\s\S]*?<\/parameter>\s*/g, "")
        .replace(/<textobject>\s*<textdata\s+fileref="([^"]*)"\s*\/>\s*<\/textobject>/g,
          (_, f) => `<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="${f}" parse="text"/>`);
      if (n !== s) fs.writeFileSync(p, n);
    }
  }
}

function buildGuide(srcSub, indexFile, outSub) {
  const src = path.join(SRCROOT, srcSub);
  const build = fs.mkdtempSync("/tmp/oldoc-build-");
  const html = fs.mkdtempSync("/tmp/oldoc-html-");
  cpR(src + "/.", build);

  // drop XInclude refs to files not present in this snapshot
  const idx = fs.readFileSync(path.join(build, indexFile), "utf8")
    .replace(/[ \t]*<xi:include href="([^"]*)"\s*\/>\n?/g,
      (m, f) => fs.existsSync(path.join(build, f)) ? m : "");
  fs.writeFileSync(path.join(build, "index.build.dbk"), idx);
  convertTextdata(build);

  // chunked docbook -> html
  execFileSync("xsltproc", ["--xinclude", "--nonet",
    "--stringparam", "base.dir", html + "/",
    "--stringparam", "root.filename", "index",
    "--stringparam", "use.id.as.filename", "1",
    "--stringparam", "chunk.section.depth", "0",
    "--stringparam", "generate.toc", "book toc",
    "--stringparam", "toc.section.depth", "2",
    "--stringparam", "section.autolabel", "1",
    "--stringparam", "html.stylesheet", "../includes/ol4-docs.css",
    "--stringparam", "admon.graphics", "0",
    "--stringparam", "callout.graphics", "0",
    "--stringparam", "chunker.output.encoding", "UTF-8",
    `${DBX}/html/chunk.xsl`, path.join(build, "index.build.dbk")],
    { env, stdio: ["ignore", "ignore", "ignore"] });

  // flatten the book-id subdir the chunker creates — move ALL its contents up
  // (including nested subdirs like tutorials/, else they end up double-nested).
  for (const e of fs.readdirSync(html, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sub = path.join(html, e.name);
    if (!fs.existsSync(path.join(sub, "index.html"))) continue;  // only the book chunk dir
    for (const f of fs.readdirSync(sub)) fs.renameSync(path.join(sub, f), path.join(html, f));
    fs.rmdirSync(sub);
  }

  // live examples: map runnable sources -> staged .lzx, copy them into the built tree
  const { map: liveMap, inlines, heights, debugUrls } = collectLiveExamples(src, outSub);
  stagePrograms(src, html, inlines);
  let live = 0;
  const matchedUrls = new Set();

  // fix the over-deep stylesheet path + stamp the version, in every chunk at any depth
  let n = 0;
  (function fix(dir){
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) fix(p);
      else if (e.name.endsWith(".html")) {
        let h = fs.readFileSync(p, "utf8");
        // inject a Run/Edit toolbar after each live-example's <pre> (match raw source)
        let injected = 0;
        h = h.replace(/<pre class="programlisting">([\s\S]*?)<\/pre>/g, (full, inner) => {
          const clean = stripCopyright(inner);                          // drop the legal footer from EVERY listing
          const pre = `<pre class="programlisting">${clean}</pre>`;
          const url = liveMap.get(norm(clean));
          if (!url) return pre;
          injected++; live++; matchedUrls.add(url); return pre + liveWidget(url, heights.get(url), debugUrls.has(url));
        });
        if (injected) h = h.replace(/<\/body>/i, liveScript + "</body>");
        h = h
          .replace(/\.\.\/\.\.\/includes\//g, "../includes/")
          .replace(/@VERSIONID@/g, "5.0")            // project version (the .dbk sources carry the marker)
          .replace(/\/demos\//g, "/examples/")       // demos live under /examples/ here
          // the original per-class reference pages (reference/lz.Foo.html / LzFoo.html,
          // optionally a +runtime variant) -> our multi-page reference (reference/foo.html);
          // keep whatever path prefix (../reference/ or ../../reference/).
          .replace(/reference\/(?:lz\.|Lz)([A-Za-z]+)(?:\+[a-z0-9+]+)?\.html/g,
                   (m, cls) => "reference/" + cls.toLowerCase() + ".html");
        // de-link defunct external domains (keep the text)
        h = h.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi, (m, attrs, inner) => {
          const hm = attrs.match(/href\s*=\s*"([^"]*)"/i);
          return (hm && /^https?:\/\/(www\.)?(laszlosystems\.com|openlaszlo\.org|jira\.openlaszlo\.org|wiki\.openlaszlo\.org|macromedia\.com)/i.test(hm[1].replace(/&amp;/g, "&"))) ? inner : m;
        });
        fs.writeFileSync(p, h);
        n++;
      }
    }
  })(html);

  // images
  for (const rel of ["images", "tutorials/images"]) {
    const s = path.join(src, rel);
    if (fs.existsSync(s)) { const d = path.join(html, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); cpR(s, path.dirname(d) + "/"); }
  }

  // install
  const out = path.join(DOCS, outSub);
  rmrf(out); cpR(html, out);
  rmrf(build); rmrf(html);
  const unmatched = [...liveMap.values()].filter(u => !matchedUrls.has(u));
  console.log(`${outSub}: ${n} HTML pages built from ${srcSub}/ — ${live} live examples wired (${matchedUrls.size}/${liveMap.size} runnable sources matched, ${inlines.size} inline)`);
  if (unmatched.length) console.log(`  ${unmatched.length} sources unmatched, e.g.: ${unmatched.slice(0, 8).map(u => u.split("/").pop()).join(", ")}`);
}

buildGuide("developers", "index.dbk", "developers");
buildGuide("deployers", "deployers-index.dbk", "deployers");
console.log("done.");
