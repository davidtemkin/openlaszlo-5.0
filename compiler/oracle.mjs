// oracle.mjs — the Java 4.9 oracle compiler path (dev-only; the only Java in the
// project). RELOCATED VERBATIM from server/compile.mjs as the FALLBACK backend behind
// the TS-first adapter (index.mjs). Behavior is unchanged: shells the 4.9 DeployMain to
// a self-contained .wgt, bsdtar-extracts a site dir, rewrites the wrapper to load the
// shared /runtime. Content-hash caching mirrors the Java cm/ dependency-closure key,
// approximated by the app dir's content hash + compiler version.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..");                       // openlaszlo/
const BASE = path.resolve(DIST, "..");                       // repo root
const WEBAPP = path.join(BASE, "downloads/ol-4.9.0-servlet"); // oracle classpath + original (autoPng) LPS source — dev-only
const SCRATCH = path.join(BASE, "modern-build/swf-canon/scratch-lps"); // SWF-free converted components: the default LPS_HOME for the canonical tree
const JH = "/opt/homebrew/opt/openjdk@17";
const CACHE = path.join(DIST, "server", ".cache");
const COMPILER_VERSION = "oracle-4.9.0-r3";

const CP = fs.readdirSync(path.join(WEBAPP, "WEB-INF/lib"))
  .filter(f => f.endsWith(".jar")).map(f => path.join(WEBAPP, "WEB-INF/lib", f)).join(":");

// Hash the app dir's contents (phase-A approximation of the dependency closure).
function closureHash(appDir) {
  const h = crypto.createHash("md5");
  const SKIP = new Set(["lps", "config.xml", "widget-icon.png"]);   // oracle-generated bundle/artifacts
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (e.name.startsWith(".") || SKIP.has(e.name) ||
          e.name.endsWith(".lzx.js") || e.name.endsWith(".sprite.png") || e.name.endsWith(".wgt")) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else { const st = fs.statSync(fp); h.update(e.name + ":" + st.size + ":" + Math.round(st.mtimeMs) + "\n"); }
    }
  };
  walk(appDir);
  h.update(COMPILER_VERSION);
  return h.digest("hex");
}

// Rewrite the oracle's wrapper to load the SHARED /runtime instead of the bundled copy.
function rewriteWrapper(siteDir, debug) {
  const idx = path.join(siteDir, "index.html");
  const html = fs.readFileSync(idx, "utf8")
    .replace(/src="[^"]*embed-compressed\.js"/g, 'src="/runtime/embed.js"')
    .replace(/src="[^"]*\/(spinner\.gif|excanvas\.js)"/g, 'src="/runtime/includes/$1"')
    // the embed helpers (iframemanager/json2/flash) load from the global serverroot
    .replace(/lz\.embed\.dhtml\(/, 'lz.embed.__serverroot="/runtime/includes/";lz.embed.dhtml(')
    .replace("lps/includes/lfc/LFCdhtml.js",
             debug ? "/runtime/lfc/lfc-debug.js" : "/runtime/lfc/lfc.js")
    .replace(/url: '([^']+\.lzx\.js)'/, debug ? "url: '$1?lzconsoledebug=true'" : "url: '$1'");
  fs.writeFileSync(idx, html);
}

// Stage the debugger console assets where the runtime asks for them (serverroot-mangled).
function enableDebugger(siteDir) {
  const dst = path.join(siteDir, "lps/resources/lps/includes");
  fs.mkdirSync(dst, { recursive: true });
  const inc = path.join(WEBAPP, "lps/includes");
  for (const [src, out] of [["laszlo-debugger.html", "laszlo-debugger.html"],
                            ["laszlo-debugger.css", "laszlo-debugger.css"],
                            ["OpenLaszlo-Debugger.gif", "OpenLaszlo-Debugger.gif"]])
    fs.copyFileSync(path.join(inc, src), path.join(dst, out));
}

// compile(lzxAbsPath) -> { siteDir, base, hash }.  Cached; recompiles only on change.
// lpsHome overrides the oracle LPS_HOME (used by the /png/ mount to compile the converted
// clone against the SWF-free scratch component library).
export function compile(lzxAbsPath, { debug = false, lpsHome = SCRATCH } = {}) {
  const appDir = path.dirname(lzxAbsPath);
  const base = path.basename(lzxAbsPath, ".lzx");
  // Cache key includes the app base so multiple apps compiled from ONE dir (e.g. the
  // doc examples in docs/<guide>/programs/, which also share sibling resources) get
  // distinct sites instead of colliding on closureHash(appDir) alone.
  const lpsTag = lpsHome === WEBAPP ? "" : "-" + crypto.createHash("md5").update(lpsHome).digest("hex").slice(0, 6);
  const hash = closureHash(appDir) + "-" + base.replace(/[^A-Za-z0-9._-]/g, "_") + (debug ? "-dbg" : "") + lpsTag;
  const cacheDir = path.join(CACHE, hash);
  const siteDir = path.join(cacheDir, "site");
  if (fs.existsSync(path.join(siteDir, "index.html"))) return { siteDir, base, hash };

  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
  // Compile a STAGED COPY in the cache — never the source. The oracle (DeploySOLODHTML) writes
  // .lzx.js/.sprite.png and the COPY_RESOURCES_LOCAL `lps/` tree in-place, so compiling the source
  // dir pollutes it. Staging keeps the source pristine: compilation only ever writes under .cache/.
  const buildDir = path.join(cacheDir, "build");
  execFileSync("rsync", ["-a", "--exclude=lps/", "--exclude=*.lzx.js", "--exclude=*.sprite.png",
    "--exclude=config.xml", "--exclude=*.wgt", "--exclude=.DS_Store", appDir + "/", buildDir + "/"]);
  const widget = path.join(cacheDir, "app.html");
  console.log(`>> compiling ${path.relative(DIST, lzxAbsPath)}${debug ? " (debug)" : ""} …`);
  execFileSync(`${JH}/bin/java`, [
    "-cp", CP, `-DLPS_HOME=${lpsHome}`, "org.openlaszlo.utils.DeployMain",
    "--runtime=dhtml", ...(debug ? ["-Ddebug=true", "-Dlzconsoledebug=true"] : []),
    "--output", widget, path.join(buildDir, base + ".lzx"),
  ], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("bsdtar", ["-xf", widget, "-C", siteDir]);
  rewriteWrapper(siteDir, debug);
  if (debug) enableDebugger(siteDir);
  return { siteDir, base, hash };
}

export { DIST, CACHE, WEBAPP, SCRATCH };
