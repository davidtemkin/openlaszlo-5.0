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
  documentation example corpus, the Laszlo Explorer, complete applications, **and the
  entire DHTML runtime (the LFC) itself** — in all four build modes: **production, debug,
  `backtrace`, and `profile`**. Existing LZX source compiles unchanged.
- **Self-verifying.** A self-contained differential harness
  ([`compiler/compiler-verify/`](compiler/compiler-verify/)) regenerates every gold from the
  original Java oracle and asserts byte parity across all of the above — so anyone modifying
  the compiler can prove they haven't drifted. (Requires a JDK; see that directory's README.)
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

Or run the optional Node server, which compiles LZX server-side (disk-cached) and serves
the example-data backends + the WebSocket chat demo — same distro, same Service Worker:

```sh
node server/index.mjs 8090
# then open http://localhost:8090/
```

The Node server is also the dev loop: **live reload is on by default** — edit any served
app source (or an include it pulls in) and every browser showing it reloads. Opt out
with `node server/index.mjs 8090 --no-reload`.

## The DOM dialect & friends

A family of additive features — none touch the byte-frozen 4.9 compile path — that let
you author LZX as native HTML with TypeScript code carriers, statically type-check the
whole app surface, and share live state between clients. Every feature below was
spec'd and adversarially reviewed; the specs live in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the authoring guide is
[`examples/dom-authoring/README.md`](examples/dom-authoring/README.md).

| Feature | Try it | Spec |
| --- | --- | --- |
| **DOM-native authoring** — LZX as HTML custom tags in `<laszlo-app>`, TypeScript carriers, authored elements adopted as live sprites | [`file-demo`](examples/dom-authoring/file-demo.html) (the counter app) | [`dom-native-authoring`](docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md) |
| **`lzx-check`** — full-surface static type checking: typed `this`, strict `setAttribute`, markup literals, `${…}` constraints, server & shader bodies | `node compiler/dist/lzx-check.js <app>` | (Slice-2 section of the authoring guide) |
| **Realtime bus** — a `<server>` section of reactive tags; attributes sync to every client, methods are RPC Promises, state is server-authoritative | [`bus-demo`](examples/dom-authoring/bus-demo.html) (Node server, two browsers) | [`realtime-bus`](docs/superpowers/specs/2026-07-06-realtime-bus-design.md) |
| **Supabase transport** — the same bus over Supabase Realtime: shared state on *static* hosting, presence, durable table-backed tags | [`bus-supabase-demo`](examples/dom-authoring/bus-supabase-demo.html) | [`supabase-transport`](docs/superpowers/specs/2026-07-06-supabase-transport-design.md) |
| **JSON databinding** — dreem-style JSONPath datapaths, native JSON datasets, implicit replication, typed shapes | (demos land with the databinding branch) | [`json-databinding`](docs/superpowers/specs/2026-07-06-json-databinding-design.md) |
| **Live reload** — the dev server watches what it serves (compile closure + observed source traffic) and reloads every viewer | edit anything under `node server/index.mjs` | [`live-reload`](docs/superpowers/specs/2026-07-06-live-reload-design.md) |
| **`<flexlayout>`** — CSS flexbox as an ordinary LZX layout (vendored css-layout engine); `flex`/`alignself`/`margin` hints on any view, typed | [`flex-demo`](examples/dom-authoring/flex-demo.html) | [`flexlayout`](docs/superpowers/specs/2026-07-06-flexlayout-design.md) |
| **`<shader>`** — a view whose surface is a fragment shader, authored in TypeScript, compiled to GLSL at app-compile time; declared attributes bind as uniforms, so constraints (and bus deltas) animate the GPU | [`shader-demo`](examples/dom-authoring/shader-demo.html) · [`shader-validate`](examples/dom-authoring/shader-validate.html) (GL conformance, expect ALL PASS) | [`shader-view`](docs/superpowers/specs/2026-07-06-shader-view-design.md) |

These are ports of ideas from the [dreem](https://github.com/teem2/dreem) /
[dreem2](https://github.com/teem2/dreem2) / [dreemgl](https://github.com/dreemproject/dreemgl)
lineage, transposed onto the typed OpenLaszlo 5.0 toolchain. The `<flexlayout>` engine is
Facebook's css-layout (BSD, via dreemgl); the `<shader>` shaderlib (noise / shapes /
palettes / color / math) is a curated port of dreemgl's (Apache-2.0) — provenance and
licenses are recorded in the vendored file headers.

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

### Build modes

The same compiler emits four build modes, each byte-for-byte identical to the
corresponding OpenLaszlo 4.9 oracle build — selected by a URL flag in the browser/server
(`?debug`, `?backtrace`, `?profile`) or a CLI flag:

| Mode | Flag | What it adds |
| --- | --- | --- |
| **production** | *(default)* | minimal, fast |
| **debug** | `?debug` / `-D$debug=true` | the on-canvas runtime debugger (console, named functions) |
| **backtrace** | `?backtrace` / `--option debugBacktrace` | per-call-site instrumentation so the runtime stack includes LFC frames |
| **profile** | `?profile` / `--profile` | the `$lzprofiler` per-function call/return timing meter |

It also compiles the **entire DHTML runtime** — the Laszlo Foundation Classes (`runtime/lfc-src/`)
build to the shipped `runtime/lfc/*.js` byte-for-byte against the oracle in all four modes, so
the runtime is fully reproducible from source, not a prebuilt blob.

### Verifying the compiler

If you change the compiler, you can prove it still matches the original Java 4.9 compiler
bit-for-bit. The self-contained harness under
[`compiler/compiler-verify/`](compiler/compiler-verify/) regenerates every gold from the
oracle and diffs the TypeScript output across all four modes, the runtime (LFC), the
documentation corpus, the Laszlo Explorer, and whole apps. It needs a **JDK 17** and the
prebuilt OpenLaszlo 4.9 compiler jar — neither is bundled; setup is in
[`compiler/compiler-verify/README.md`](compiler/compiler-verify/README.md).

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
| `runtime/` | the DHTML runtime — the LFC source (`lfc-src/`), the compiled LFC (`lfc/`), and components |
| `explorer/` | the Laszlo Explorer application |
| `examples/` | demo applications (including the Dashboard ported from 3.x) |
| `docs/` | documentation and the developer example corpus |
| `server/` | the optional Java-free Node server — server-side compile (`index.mjs`, `compile.mjs`), example-data backends, and a dep-free WebSocket server (`connection.mjs`) |
| `tools/` | `serve-static.mjs`, a zero-dependency static file server for local testing |
| `index.html`, `service-worker.js` | the static bootstrap + the in-browser-compile Service Worker |

## Status

Both deployment modes are complete and self-contained:

- **Static / in-browser** — the Service Worker compiles LZX in the browser; runs off any
  plain static host (this is the GitHub Pages demo above).
- **Dynamic Node server** (`server/`) — a clean, Java-free server that compiles LZX
  server-side (TypeScript, disk-cached), serves the example-data backends, and hosts the
  WebSocket chat demo. One distro, one Service Worker, two modes.

The compiler reaches **byte-for-byte parity with OpenLaszlo 4.9 across every build mode and
the full runtime (LFC)**, verified by two independent harnesses; reproduce it from
[`compiler/compiler-verify/`](compiler/compiler-verify/).

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
