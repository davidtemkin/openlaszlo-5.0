# OpenLaszlo 5.0

**The OpenLaszlo platform, reimplemented without Java.** OpenLaszlo 5.0 compiles
LZX applications to DHTML (browser-native JavaScript) — in the browser, on the
command line, or in Node — and is **byte-for-byte compatible** with the original
OpenLaszlo 4.9 compiler.

> ### ▶ Live demo: **https://davidtemkin.github.io/openlaszlo-5.0/**
> The Laszlo Explorer, compiled entirely in your browser. No server, no plugins,
> no Java. (Requires a current browser — Chrome / Edge / Firefox / Safari.)

---

## What's new in 5.0

- **No more Java.** The LZX→DHTML compiler is rewritten in TypeScript. There is no
  JDK, no servlet container, and no JSP anywhere in the toolchain or runtime.
- **In-browser compilation.** The same compiler is packaged as a small, self-contained
  browser bundle. A Service Worker intercepts requests for `.lzx` applications, compiles
  them to DHTML on the fly, runs them, and caches the result — no build step, no
  server round-trip.
- **100% compatible with OpenLaszlo 4.9.** Differential-tested against the original Java
  compiler, the TypeScript compiler produces **byte-for-byte identical** output across the
  documentation example corpus, the Laszlo Explorer, and complete applications, in
  production, debug, and `backtrace` builds. Existing LZX source compiles unchanged.
- **Statically hostable.** Because compilation happens in the browser, the whole distro
  runs off any plain static host — S3, GitHub Pages, nginx, `python3 -m http.server`.
- **Bonus: the Dashboard demo**, ported forward from OpenLaszlo 3.x, runs in DHTML.

## Quick start

Run the whole distribution locally from any static server:

```sh
# from the repo root
node tools/serve-static.mjs . 8087
# then open http://localhost:8087/  → the Explorer, compiled in your browser
```

Any static host works — the only requirement is a "secure context" (`https://` or
`http://localhost`), which module Service Workers need. No build step is required to
*run* the distro; the compiler bundle (`compiler/lzc-browser.js`) is prebuilt.

## The compiler

The compiler is a standalone TypeScript package under [`compiler/`](compiler/):

```sh
cd compiler
npm install
npm run dist          # tsc  +  esbuild browser bundle
```

It produces three faces from one source (`compiler/src`):

| Face | Built artifact | Used by |
| --- | --- | --- |
| **Browser** | `compiler/lzc-browser.js` | the Service Worker (in-browser compile) |
| **CLI** | `compiler/dist/cli.js` (`lzc`) | `node dist/cli.js app.lzx` |
| **Node** | `compiler/dist/node.js` | programmatic / server-side use |

## How it works (static hosting)

```
index.html ──registers──▶ service-worker.js ──imports──▶ compiler/lzc-browser.js
     │                          │
  loads the Explorer        intercepts every  *.lzx  navigation,
  in a full-page frame      compiles it to DHTML in-browser, runs it,
                            caches the JS (ETag / CacheStorage), and
                            proxies runtime assets from  runtime/
```

The Service Worker is **base-agnostic** — it adapts to whatever URL serves it
(origin root, a `/openlaszlo-5.0/` GitHub-Pages project path, etc.), so the same
files work on any host with no build configuration.

## Repository layout

| Path | What |
| --- | --- |
| `compiler/` | the TypeScript LZX→DHTML compiler (source, build output, browser bundle) |
| `runtime/` | the DHTML runtime (LFC + components) |
| `explorer/` | the Laszlo Explorer application |
| `examples/` | demo applications (including the Dashboard ported from 3.x) |
| `docs/` | documentation and the developer example corpus |
| `server/` | demo-backend data (`example-data/`) + a dep-free WebSocket server (`connection.mjs`) |
| `tools/` | `serve-static.mjs`, a zero-dependency static file server for local testing |
| `index.html`, `service-worker.js` | the static bootstrap + the in-browser-compile Service Worker |

## Status

Static / in-browser hosting is complete and self-contained. A clean, Java-free **Node
server** for server-side compilation and dynamic backends (the WebSocket chat demo, etc.)
is the next step — the data and WebSocket building blocks live under `server/`.

## History & credits

OpenLaszlo was created by Laszlo Systems and released as open source under the Common
Public License. OpenLaszlo 4.x compiled LZX to both Flash (SWF) and DHTML. **OpenLaszlo 5.0**
drops Flash and Java entirely, reproducing the proven 4.9 DHTML compiler in TypeScript so
LZX applications keep running on the modern web. The bundled runtime, documentation, and
example sources are the original OpenLaszlo 4.x material, © 2001–2010 Laszlo Systems, Inc.

## License

- **New 5.0 code** (the TypeScript compiler, the static bootstrap, the Service Worker,
  and other 5.0-original tooling) — **MIT**, see [LICENSE](LICENSE).
- **Bundled original OpenLaszlo 4.x components** (`runtime/`, original `docs/`, original
  LZX examples) — © 2001–2010 Laszlo Systems, Inc., under the **Common Public License 1.0**,
  the license under which OpenLaszlo was originally released.
