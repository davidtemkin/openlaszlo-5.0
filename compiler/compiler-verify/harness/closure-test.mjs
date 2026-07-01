// closure-test — dependency-closure capture + cache hit/invalidation gate, on a real
// multi-file app (the Dashboard: libs + components + resources + fonts). Verifies the
// compiler's DiskCache behaves like Java's DependencyTracker.
//
// Distro port of modern-build/compiler/harness/closure-test.mjs: retargeted at the
// distro's own examples/dashboard + the flat runtime/ LPS_HOME, and compiling a /tmp
// COPY so the mtime-invalidation probe never mutates examples/ or runtime/ (read-only).
//
//   cd openlaszlo-5.0/compiler && npm run build      # produce dist/
//   node compiler-verify/harness/closure-test.mjs

import { compileFile, compileFileCached, DiskCache } from "../../dist/node.js";
import { utimesSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISTRO = path.resolve(HERE, "../../..");          // openlaszlo-5.0
const LPS = path.join(DISTRO, "runtime");               // the distro's flat LPS_HOME
const WORK = "/tmp/cv-closure-dashboard";               // mutation-safe copy of the app
rmSync(WORK, { recursive: true, force: true });
cpSync(path.join(DISTRO, "examples", "dashboard"), WORK, { recursive: true });
const APP = path.join(WORK, "dashboard.lzx");

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "OK   " : "FAIL ") + name); if (!cond) fails++; };

// 1. closure capture
const r = compileFile(APP, { lpsHome: LPS });
const files = r.closure.entries.filter((e) => e.kind === "file");
ok(`compiles (${r.js.length} bytes, no unsupported)`, r.js.length > 0 && !r.unsupported);
ok(`closure captured (${r.closure.entries.length} entries)`, r.closure.entries.length > 50);
ok("closure has the main app", r.closure.entries.some((e) => e.id.endsWith("dashboard.lzx")));
ok("closure has an app lib", r.closure.entries.some((e) => /dashwindowlib|musiclib/.test(e.id)));
ok("closure has a component", r.closure.entries.some((e) => e.id.includes("/components/")));
ok("closure has a raster resource", files.some((e) => /\.(png|gif|jpe?g)$/i.test(e.id)));
ok("closure has the autoincludes.properties", r.closure.entries.some((e) => e.id.includes("lzx-autoincludes.properties")));
ok("validators present (mtime+size)", files.every((e) => e.v.size !== undefined && (e.v.mtime !== undefined || e.v.missing)));

// 2. cache hit + invalidation — touch an app-local dep IN THE COPY (never the distro tree)
const CACHE_DIR = "/tmp/closure-test-cache";
rmSync(CACHE_DIR, { recursive: true, force: true });
const cache = new DiskCache(CACHE_DIR, "test-v1");
const a = compileFileCached(APP, { lpsHome: LPS }, cache);
ok("compile #1 is a cache MISS", a.cached === false && !!a.tag);
const b = compileFileCached(APP, { lpsHome: LPS }, cache);
ok("compile #2 is a cache HIT (same js + tag)", b.cached === true && b.js === a.js && b.tag === a.tag);
const dep = files.find((e) => e.id.endsWith(".lzx") && e.id.startsWith(WORK) && !e.id.endsWith("dashboard.lzx"))?.id;
const future = Date.now() / 1000 + 100;
utimesSync(dep, future, future);
const c = compileFileCached(APP, { lpsHome: LPS }, cache);
ok(`touching a dep (${dep.split("/").pop()}) INVALIDATES the cache`, c.cached === false);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
