#!/usr/bin/env node
// tools/stamp-version.mjs — stamp a content-hash BUILD_ID into service-worker.js (and write
// version.json). Host-agnostic cache-busting: run this once before every deploy
//   node tools/stamp-version.mjs
// then deploy the tree however you deploy (commit+push for GitHub Pages; upload for S3 /
// nginx / Cloudflare Pages / any static host — no build pipeline required).
//
// The hash covers the "platform" — the DHTML runtime, the in-browser compiler bundle, the
// static shell, and this worker. When any of those change, the hash changes, which changes
// service-worker.js's bytes; the browser then installs the new SW, whose `activate` clears
// every cache and reloads open clients onto the fresh build. (App SOURCE changes don't need
// a re-stamp — the compiled-app cache already revalidates LZX sources by ETag.)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW = join(ROOT, "service-worker.js");
const BUILD_RE = /const BUILD_ID = "[^"]*";/;

// Platform inputs whose change should bust all caches.
const INPUTS = ["index.html", "compiler/lzc-browser.js", "runtime"];

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) for (const e of readdirSync(p).sort()) yield* walk(join(p, e));
  else yield p;
}

const h = createHash("sha256");
// Hash this worker with its BUILD_ID line normalized, so stamping isn't self-referential.
const swText = readFileSync(SW, "utf8");
if (!BUILD_RE.test(swText)) {
  console.error('stamp-version: could not find `const BUILD_ID = "...";` in service-worker.js');
  process.exit(1);
}
h.update(swText.replace(BUILD_RE, 'const BUILD_ID = "";'));
for (const input of INPUTS) {
  for (const f of walk(join(ROOT, input))) {
    h.update(relative(ROOT, f));      // path (so renames/moves count)
    h.update(readFileSync(f));        // content
  }
}
const build = h.digest("hex").slice(0, 12);

// Idempotent: only touch files when the build id actually changed (so a pre-commit hook
// produces no churn when nothing platform-relevant changed).
const current = (swText.match(/const BUILD_ID = "([^"]*)";/) || [])[1];
if (current === build) {
  console.log("stamp-version: unchanged (BUILD_ID =", build + ")");
  process.exit(0);
}
writeFileSync(SW, swText.replace(BUILD_RE, `const BUILD_ID = "${build}";`));
writeFileSync(join(ROOT, "version.json"), JSON.stringify({ build }, null, 2) + "\n");
console.log("stamp-version: BUILD_ID", current || "(none)", "->", build);
