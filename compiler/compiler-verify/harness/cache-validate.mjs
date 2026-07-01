// cache-validate — empirical validation of the dependency-closure cache (mtime validators
// + ETag): hit when nothing changed, invalidate when ANY tracked dependency (main /
// transitive lib / resource) changes, distinct entries per compiler-prop, stable+changing
// ETags, and the mtime-vs-content tradeoff. Asserts the cache behaves like Java's
// DependencyTracker.
//
// Distro port of modern-build/compiler/harness/cache-validate.mjs: retargeted at the
// distro's examples/dashboard + flat runtime/ LPS_HOME, mutating only a /tmp COPY so the
// distro tree stays pristine.
//
//   cd openlaszlo-5.0/compiler && npm run build
//   node compiler-verify/harness/cache-validate.mjs

import { compileFileCached, compileFile, DiskCache, validatorsEqual } from "../../dist/node.js";
import { utimesSync, statSync, rmSync, cpSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISTRO = path.resolve(HERE, "../../..");          // openlaszlo-5.0
const LPS = path.join(DISTRO, "runtime");               // flat LPS_HOME
const WORK = "/tmp/cv-cache-dashboard";                 // mutation-safe copy of the app
rmSync(WORK, { recursive: true, force: true });
cpSync(path.join(DISTRO, "examples", "dashboard"), WORK, { recursive: true });
const APP = path.join(WORK, "dashboard.lzx");
const UNRELATED = "/tmp/cv-unrelated.lzx";
writeFileSync(UNRELATED, "<canvas/>\n");                // a real file NOT in the app's closure
const CACHE_DIR = "/tmp/cache-validate";

let fails = 0, n = 0;
const ok = (name, cond, extra = "") => { n++; console.log((cond ? "OK   " : "FAIL ") + name + (extra ? "  — " + extra : "")); if (!cond) fails++; };
const ms = (f) => { const t = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };
const fresh = () => { rmSync(CACHE_DIR, { recursive: true, force: true }); return new DiskCache(CACHE_DIR, "v1"); };
const bump = (p) => { const s = statSync(p); const t = s.mtimeMs / 1000 + 50; utimesSync(p, t, t); };

// Discover a transitive dep (an app lib) + a resource from the closure — both IN THE COPY.
const base = compileFile(APP, { lpsHome: LPS });
const files = base.closure.entries.filter((e) => e.kind === "file");
const lib = files.find((e) => e.id.startsWith(WORK) && e.id.endsWith(".lzx") && !e.id.endsWith("dashboard.lzx")).id;
const png = files.find((e) => /\.(png|gif|jpe?g)$/i.test(e.id)).id;   // a raster dep (runtime component resource)
console.log(`closure: ${base.closure.entries.length} deps | probe lib=${lib.split("/").pop()} png=${png.split("/").pop()}\n`);

// 1. cold miss vs warm hit (+ timing)
let cache = fresh();
const [a, t1] = ms(() => compileFileCached(APP, { lpsHome: LPS }, cache));
const [b, t2] = ms(() => compileFileCached(APP, { lpsHome: LPS }, cache));
ok("cold compile is a MISS", a.cached === false, `${t1.toFixed(0)}ms`);
ok("warm compile is a HIT", b.cached === true, `${t2.toFixed(0)}ms`);
ok("HIT is ≥10× faster than a compile", t2 * 10 < t1, `${t1.toFixed(0)}ms → ${t2.toFixed(0)}ms`);
ok("HIT returns identical JS + ETag", b.js === a.js && b.tag === a.tag);

// 2. invalidation on each dependency CATEGORY (main, transitive lib, resource).
//    `restore` re-stamps the file's original mtime afterward — used for the png, which is a
//    runtime/ component resource (the dashboard's own img/ loads at runtime, not compile-time),
//    so runtime/ is left byte- AND mtime-pristine.
const inval = (label, p, restore = false) => {
  const c = fresh(); compileFileCached(APP, { lpsHome: LPS }, c);
  const s = restore ? statSync(p) : null;
  bump(p);
  const r = compileFileCached(APP, { lpsHome: LPS }, c);
  if (restore) utimesSync(p, s.atimeMs / 1000, s.mtimeMs / 1000);
  ok(`touching ${label} INVALIDATES`, r.cached === false);
};
inval("the MAIN app", APP);
inval("a transitive app lib", lib);
inval("a RESOURCE (runtime png, mtime restored)", png, true);

// 3. an UNTOUCHED app stays a hit even when an UNRELATED file changes
cache = fresh();
compileFileCached(APP, { lpsHome: LPS }, cache);
bump(UNRELATED); // not in this app's closure
ok("unrelated file change does NOT invalidate", compileFileCached(APP, { lpsHome: LPS }, cache).cached === true);

// 4. compiler PROPS gate the cache (debug vs non-debug are distinct entries)
cache = fresh();
const nd = compileFileCached(APP, { lpsHome: LPS, debug: false }, cache);
const db = compileFileCached(APP, { lpsHome: LPS, debug: true }, cache);
ok("debug build is a separate cache entry (own MISS)", db.cached === false);
ok("debug + non-debug ETags differ", nd.tag !== db.tag);
ok("re-fetching non-debug is still a HIT (entries coexist)", compileFileCached(APP, { lpsHome: LPS, debug: false }, cache).cached === true);

// 5. ETag semantics: stable across hits, NEW after a dep change (drives HTTP 304/200)
cache = fresh();
const e1 = compileFileCached(APP, { lpsHome: LPS }, cache).tag;
const e2 = compileFileCached(APP, { lpsHome: LPS }, cache).tag;
ok("ETag stable while unchanged (→ conditional 304)", e1 === e2);
bump(lib);
const e3 = compileFileCached(APP, { lpsHome: LPS }, cache).tag;
ok("ETag CHANGES after a dep change (→ 200 + new body)", e3 !== e1);

// 6. the validator tradeoff, at the unit level: mtime+size is the fast path (Java's exact
//    property — blind to a byte edit that preserves mtime+size); the content-hash floor catches it.
ok("mtime+size validator: equal mtime+size ⇒ treated as fresh (the fast path)",
   validatorsEqual({ mtime: 100, size: 42 }, { mtime: 100, size: 42 }) === true);
ok("mtime+size validator: a changed mtime ⇒ stale",
   validatorsEqual({ mtime: 100, size: 42 }, { mtime: 200, size: 42 }) === false);
ok("content-hash floor: different bytes ⇒ stale even at equal mtime (browser/ETag path)",
   validatorsEqual({ hash: "aaa" }, { hash: "bbb" }) === false);

console.log(`\n${n - fails}/${n} checks passed${fails ? ` — ${fails} FAILED` : ""}`);
process.exit(fails ? 1 : 0);
