# Server-track packaging log — TS-first compiler backend

Milestones (UTC). Tail this for progress.

## 2026-06-24T20:25Z — TS-first backend wired, gate green
- **Adapter landed** `compiler/index.mjs`: `compile(lzxAbsPath, {debug, lpsHome})` tries the
  byte-exact TypeScript compiler (`modern-build/compiler/dist/node.js` →
  `compileFileCached`, closure cache in `server/.cache-ts/`), falls back to the Java oracle.
  Same `{siteDir, base, hash}` shape (+ `backend`, `tag`, `cached`) so `index.mjs` is
  unchanged in shape.
- **Oracle relocated verbatim** `compiler/oracle.mjs` (was `server/compile.mjs`); the old
  `server/compile.mjs` is now a thin re-export shim of the adapter.
- **Wrapper from scratch** `server/wrapper.mjs` `renderWrapper({base,debug})` reproduces the
  oracle's post-`rewriteWrapper` `index.html` byte-for-byte (`/runtime/embed.js`,
  `lz.embed.__serverroot`, `/runtime/lfc/lfc.js|lfc-debug.js`, `embed.dhtml({url:'<base>.lzx.js'})`,
  `#appcontainer` + `#lzsplash`).
- **ETag/304** in `index.mjs` `runApp`: `ETag = "<closure-content-hash>"` (TS path only);
  `If-None-Match` match → 304. `runApp`/`editCompile` made async (TS path is async ESM).
- **Backend selection per app**:
  - sprite-FREE (e.g. `hello`) → PURE TS path (TS JS + generated wrapper + app assets, NO Java).
  - sprite-BEARING (e.g. `calendar`, `dashboard`) → TS-js over oracle-built assets: the oracle
    builds the sprite montages + packed resources once (cached), then the served `<base>.lzx.js`
    is overwritten with the byte-exact TS output.
  - debug builds / unsupported constructs / first-time sprite apps → full oracle fallback.
- **New gate** `server/gate-served-parity.mjs`: proves the SERVED `<base>.lzx.js` == oracle
  output (same harness `normalize()` — appbuilddate + sprite-sheet name), on hello (TS),
  calendar (TS+assets), dashboard (TS+assets, the DoD app); plus a cache HIT and a
  dep-touch INVALIDATION. **Result: 5 ok, 0 fail.**
- **Invariants confirmed**: compiler core `batch.mjs check` = 266/0/80; `check-dashboard`
  BYTE-IDENTICAL; `test:closure` all passed.
- **Server smoke** (port 8099): `/` (explore-nav → oracle) 200; `/examples/ten-minutes/hello.lzx`
  (TS) 200 + ETag + `If-None-Match`→304 + stale→200; `/examples/calendar/calendar.lzx` (TS+assets)
  page/`.lzx.js`/`.sprite.png` all 200; `?debug`→oracle 200; `?pane` offset injected;
  `/runtime/embed.js`,`/runtime/lfc/lfc.js` 200.

### Known sub-gap (documented, fallback in place)
- **Sprite-montage generation**: the TS compiler emits `sprite:'…/foo.sprite.png'` references
  but does not pack the montage PNG sheets (the oracle's `DeployImage`/`PNG` step). Sprite-
  bearing apps therefore still invoke the oracle to BUILD the montages + packed resources; the
  served *JS* is the TS output, so byte-parity of the JS holds. A future TS sprite-packer would
  let those apps go pure-TS.
