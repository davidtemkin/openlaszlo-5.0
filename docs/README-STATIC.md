# Static Laszlo Explorer — compile LZX in the browser, no server

The whole `openlaszlo/` tree is a **static site**: serve it from any plain file host
and the Laszlo Explorer + (almost) every demo runs, with the **OpenLaszlo 4.9 LZX→DHTML
compiler running in the browser** via a Service Worker. No dynamic compile server, no
Java, nothing pre-compiled — every app is compiled fresh from its `.lzx` source on
first visit and cached (CacheStorage) for instant, offline-capable revisits.

The byte-exact TypeScript compiler is byte-for-byte verified against the original Java
compiler ("the oracle"); the browser path produces identical JS (`npm run test:browser`).

## Quick start

```sh
# from the repo root — a real-host-faithful static server (404s directories):
node openlaszlo/tools/serve-static.mjs openlaszlo 8087
# open http://localhost:8087/   → the Explorer, compiled in your browser
```

`http://localhost` and any `https://` host are "secure contexts," which module Service
Workers require. Any static host that returns **404 for a missing file** works — the
default behavior of S3, GitHub Pages, Cloudflare Pages, nginx, and `serve-static.mjs`
(and `python3 -m http.server` too: the compiler's resolver only ever requests specific
files, never bare directories, so its listing behavior is never triggered). The one host
configuration to **avoid** is an SPA "catch-all → `index.html`" rewrite — it answers
missing files with `200` + HTML, which the resolver would mis-ingest as a component.

## Deploying to a real static host

Upload the `openlaszlo/` directory to any static **HTTPS** host. The files the static
runtime needs:

| file / dir | role |
|---|---|
| `index.html` | the SW-first bootstrap shell (registers `sw.js`, then loads the Explorer) |
| `sw.js` | the Service Worker — intercepts `*.lzx`, compiles in-browser, caches, proxies runtime resources |
| `lzc-browser.js` | the self-contained ~250 KB compiler bundle the SW imports |
| `runtime/` | LFC kernel (`lfc/lfc.js`), `embed.js`, component **sources** + individual frame PNGs (sheet-free), fonts, `lzx-autoincludes.properties` |
| `explorer/` | the Explorer nav app + coverpages + walkthrough programs |
| `examples/`, `docs/` | the demos + documentation (`.lzx` sources) |

`server/`, `compiler/`, `serve-static.mjs` are **not** needed for static hosting (they're
the optional Node server + dev tools). Configure the host to serve `index.html` for `/`.

## What works / what doesn't

**Works** (compiles + runs fully static): the Explorer (nav + welcome), and 69/91 example
canvas apps — calendar, dashboard, the component examples, most "Laszlo in 10 Minutes"
pieces, animations, constraints, etc. Everything is **sheet-free** (individual frame PNGs;
zero `.sprite.png` fetched).

**Needs a dynamic backend** (compiles, but a feature fails static — by design): `chat`
(WebSocket), `weather`/`amazon`/`survey`/`lzproject` (`/api` data), `youtube`/`videolibrary`
(media services). Run the Node server (`server/index.mjs`) for these.

**Known compiler gaps** (owned by the codegen effort, not packaging) — a handful of apps
return `unsupported`:
- `id= outside a top-level instance` — `examples/css/test*.lzx`
- `<interface> instance with methods` — `examples/extensions/drawing.lzx`, `lzpixmobile/*`
- `unknown tag <audio>` — `examples/ten-minutes/audio.lzx`

The SW shows a red banner (not a blank app) when a compile is unsupported or errors.

## How it works

1. `index.html` registers `sw.js` at root scope and loads the Explorer once the SW controls
   the page (one-time reload handshake; `clients.claim()`).
2. Navigating to any `…/<name>.lzx` → the SW returns a **wrapper HTML** page whose
   `<script>` points at `<name>.lzx.js`.
3. That `<name>.lzx.js` request → the SW runs `compileInBrowser()`: a preload-then-compile
   loop that fetch-traverses the app's full dependency closure and compiles it in-page
   (`sprites:"none"`, SOLO `proxied:false`), caches by closure validator (ETag /
   conditional-GET), and returns the JS.
4. The running app's runtime resources (`lps/resources/lps/{components,fonts}/…`) are
   **proxied** by the SW to `runtime/`.

The SW mirrors `server/index.mjs`'s namespace map (`urlToSource`): the Explorer is the
default `/` namespace (so `/coverpages/…` → `explorer/coverpages/…`), with `/examples/`,
`/runtime/`, `/docs/` as real paths. The compiler's `lps/{components,fonts,lfc}` inputs
are remapped to the distro's flat `runtime/` layout by `distroFetch` in `sw.js`.

## Rebuilding the compiler bundle

After any compiler change, rebuild + redeploy the bundle:

```sh
cd modern-build/compiler
npm run build                 # tsc
npm run test:browser          # parity gate (browser JS byte-== Node)
npx esbuild dist/browser.js --bundle --format=esm --platform=browser --outfile=dist/lzc-browser.js
cp dist/lzc-browser.js ../../openlaszlo/lzc-browser.js
```

(A stale `lzc-browser.js` is the #1 gotcha — it silently runs old codegen.)

## Follow-ups (not yet implemented)

- **Closure-prefetch**: ship a per-app closure manifest so the SW prefetches the whole
  closure in one parallel batch (one compile pass instead of ~graph-depth passes) — cuts
  cold-start latency.
- **Offline precache** of the runtime + bundle (PWA `manifest.webmanifest`).
- **Classic-SW fallback** for browsers without module Service Workers (an IIFE bundle +
  `importScripts`).
