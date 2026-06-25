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

// scan a guide's .dbk for live-examples → { map: normSource -> runUrl, inlines: name->content }
function collectLiveExamples(srcGuideDir, outSub) {
  const map = new Map(), inlines = new Map();
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
          if (!/<canvas[\s>/]/.test(source)) continue;     // only runnable apps get a toolbar
          map.set(norm(source), "/docs/" + outSub + "/programs/" + runName);
        }
      }
    }
  })(srcGuideDir);
  return { map, inlines };
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
      if (e.isDirectory()) cp(sp, dp); else fs.copyFileSync(sp, dp);
    }
  })(srcP, dstP);
  if (inlines.size) { fs.mkdirSync(dstP, { recursive: true }); for (const [n, c] of inlines) fs.writeFileSync(path.join(dstP, n), c); }
}

const liveWidget = url =>
  `<div class="live-example"><div class="live-toolbar">` +
  `<button class="live-run" type="button" data-run="${url}" onclick="lzRun(this)">&#9654;&#xfe0e; Run</button>` +
  `<a class="live-edit" href="${url}?edit" target="_blank" rel="noopener">&#9998;&#xfe0e; Edit</a>` +
  `</div></div>`;
const liveScript =
  `<script>function lzRun(b){var d=b.parentNode.parentNode,f=d.querySelector('iframe.live-frame');` +
  `if(!f){f=document.createElement('iframe');f.className='live-frame';f.title='live example';d.appendChild(f);b.innerHTML='&#8635;&#xfe0e; Reload';}` +
  `f.src=b.getAttribute('data-run');}</script>`;

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
  const { map: liveMap, inlines } = collectLiveExamples(src, outSub);
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
          const url = liveMap.get(norm(inner));
          if (!url) return full;
          injected++; live++; matchedUrls.add(url); return full + liveWidget(url);
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
