# OpenLaszlo — Java-free distribution

A self-contained OpenLaszlo distribution served by a Node server. No Tomcat, no
servlet, no JSP, no `lps/` paths. One runtime (DHTML). The Java compiler is a
dev-only backend behind an interface; it leaves entirely once the TS compiler lands.

This is the consolidation of `explorer-live/` (apps) + `modern-build/relay/` (server)
+ the LFC runtime into one tree. `explorer-live/` is kept as a backup until parity is
proven, then removed.

## Top-level layout

```
openlaszlo/
├─ explorer/            # the navigator homepage (its OWN thing); loads from examples/
│  ├─ explore-nav.lzx   #   the nav app
│  ├─ nav.xml           #   the menu (single file; dhtml-only — no nav_dhtml.xml)
│  ├─ coverpages/       #   section/demo cover pages (+ welcome.lzx cover app)
│  └─ basics/ classes/ constraints/ animation/ scripting/ data/   # walkthrough programs
├─ examples/            # demos + small examples, MERGED, partitioned by name
│  ├─ calendar/ dashboard/ chat/ amazon/ weather/ survey/ videolib/ lzproject/
│  └─ contactlist/ …    #   each = the LZX app + its COMPILE-TIME assets
├─ runtime/             # the platform runtime, mostly served static
│  ├─ lfc/lfc.js        #   kernel (was LFCdhtml.js); lfc-debug.js (was LFCdhtml-debug.js)
│  ├─ embed.js          #   was embed-compressed.js
│  ├─ components/       #   component LZX SOURCE (compiler input, compiled inline) + resources
│  │  └─ extensions/dhtml/   # NEW first-class components: videoview, connection
│  ├─ fonts/  resources/
│  ├─ debugger/         #   console.html/css (was laszlo-debugger.*)
│  └─ theme/explore.css
├─ server/              # the Node server (was modern-build/relay/server.mjs etc.)
│  ├─ index.mjs         #   http + ws bootstrap + the clean URL router
│  ├─ compile.mjs       #   compiler INTERFACE: compile(lzx) → {js, closure, assets}
│  ├─ wrapper.mjs       #   generates the app HTML page (was DeployMain index.html / JSPs)
│  ├─ source.mjs        #   the ?source view (was source.jsp/viewer.jsp)
│  ├─ connection.mjs    #   WebSocket persistent-connection server
│  └─ example-data/     #   auto-discovered → /api/<name>; partitioned by example
│     ├─ weather/ amazon/ survey/ lzproject/ videolib/
│     │   └─ index.mjs + fixtures + RUNTIME media (videos, covers) + state
├─ compiler/            # LZX→JS
│  ├─ oracle.mjs        #   PHASE A: shells to the 4.9 jar (dev-only; the only Java)
│  └─ ts/               #   PHASE B/C: the TS compiler (server-side, then in-browser)
└─ docs/                # static docs (one-time DocBook build output + installation + component-browser)
```

## Asset rule (compile-time vs runtime)
- **Compile-time assets** (the compiler bundles them into the app's output — e.g. the
  dashboard's converted chrome PNGs, an app's own images) live in `examples/<name>/`.
- **Runtime-loaded data AND media** (the running app fetches them — amazon covers,
  videolib videos, lzproject state) live in `server/example-data/<name>/`, served under
  `/api/<name>/…`. If the compiler bundles it → example asset; if the app fetches it →
  example-data.

## URL scheme (maps to the Java original; drops the Java-isms)

| Purpose | Original (Java/JSP) | New |
|---|---|---|
| Homepage | `/laszlo-explorer/index.html?lzr=dhtml` | `/` |
| Run an app | `…/calendar.lzx?lzt=html&lzr=dhtml` via `loading.jsp` | `/examples/calendar/` (and `…/calendar.lzx`) |
| Run + debugger | `?lzconsoledebug=true&debug=true` | `/examples/calendar/?debug` |
| View source | `content.jsp?...&action=source` | `/examples/calendar/?source` |
| Compiled JS (internal) | `…lzx?lzt=js` | `/examples/calendar/calendar.lzx.js` |
| App assets | `/demos/calendar/img/…` | `/examples/calendar/img/…` |
| Runtime kernel | `/lps/includes/lfc/LFCdhtml.js` | `/runtime/lfc/lfc.js` |
| Embed | `/lps/includes/embed-compressed.js` | `/runtime/embed.js` |
| Component resources | `/lps/components/lz/resources/…` | `/runtime/components/lz/resources/…` |
| Fonts | `/lps/fonts/…` | `/runtime/fonts/…` |
| Debugger console | `/lps/includes/laszlo-debugger.html` | `/runtime/debugger/console.html` |
| Data service | `survey.jsp` / Yahoo+ECS proxy | `/api/<name>` (auto-discovered from example-data) |
| Persistent connection | `LZServlet` SWF stream | `/api/connection` (WebSocket) |

Only `?source` and `?debug` query modifiers survive. No `lzr=`/`lzt=`/proxy flags. No `.jsp`.

`/<dir>/` → main lzx: file matching the dir name, else `app.lzx`, else `index.lzx`, else
an explicit `app` field in a per-dir `lzapp.json`.

## Request lifecycle (server serves .lzx like LZServlet did)
```
GET /examples/calendar/            → 302 /examples/calendar/calendar.lzx
GET /examples/calendar/calendar.lzx → wrapper.mjs:
     compile.mjs(calendar.lzx) → cached .lzx.js (+ closure + assets)
     return HTML: <script src=/runtime/embed.js> embed({url:'calendar.lzx.js', lfc:'/runtime/lfc/lfc.js'})
GET …/calendar.lzx.js              → served from cache
GET …/?source                      → source.mjs (editable source | live app)
GET /api/weather?p=10001           → example-data/weather
WS  /api/connection?app=chat       → connection.mjs
```

## Compile cache (robust; superset of the Java approach)
The Java server tracked the full include/asset closure (`TrackingFileResolver` →
`DependencyTracker` in `CachedInfo`) and recompiled only when the closure's max mtime
changed (+ `If-Modified-Since`/304). We do the content-hash variant:
- `compile.mjs` returns the **dependency closure** (files read). Oracle adapter captures
  it; the TS compiler knows it natively.
- Cache the compiled blob keyed by **content-hash(closure) + compiler version**.
- Serve with **ETag = that hash** → conditional requests still 304 (no lost feature).
- Dev: `fs.watch` the closure → invalidate on edit.
- Whole-app granularity (global gensym makes per-unit caching impossible — per the
  compiler plan), so the blob is the resolved-closure output, not per-fragment.

## Compiler phasing
- **A (now):** `compiler/oracle.mjs` shells to the 4.9 jar (dev-only). Apps ship
  **pre-compiled** in the cache → a downloaded distro runs on Node alone (Java-free).
- **B:** `compiler/ts/` replaces the oracle; `openlaszlo serve` compiles in Node.
- **C (compiler-plan target):** TS compiler runs **in-browser** (wrapper loads
  `/runtime/lzc.js`); server degrades to static + `/api` + WebSocket; static-hostable.
The `compile.mjs` interface and URL contract are identical across all three.

PHASE-A pragmatics: the Java oracle expects an `lps/`-structured `LPS_HOME` (components,
lfc, fonts). The served `runtime/` is the curated browser subset; the oracle keeps
compiling against the existing webapp `LPS_HOME` (`downloads/ol-4.9.0-servlet`) until
the TS compiler resolves directly from `runtime/components/`.

## Data services (regularized)
`server/example-data/index.mjs` auto-discovers subdirs (each exports a handler) and
mounts them at `/api/<name>` + serves the dir's static media at `/api/<name>/…`.
The old per-demo JSPs (`survey.jsp`, `youtube.jsp`, `host.jsp`, Yahoo/ECS proxies) are
gone. Done so far: weather, amazon, survey, lzproject (move them in); add videolib media.

## Docs
`docs/` is a plain static dir served at `/docs/`. Reality on disk: `installation/` is
built; `guide/developers/deployers/reference` are **DocBook source only**
(`docs/src/...`) and need a **one-time offline Ant+DocBook build** (a content step, not a
runtime dependency) committed as static HTML. Root pages `release-notes.html`,
`tools/index.html` served at `/`. The **component-browser** ("Components Hierarchy") is
an LZX app → compile it as an example. Reference popups (`lz.button.html`) work after
the docs build.

## Migration checklist
1. [in progress] copy the tree into `openlaszlo/` with the new layout.
2. assemble `runtime/` from the webapp `lps/` (rename lfc/embed/debugger).
3. fold the relay into `server/` (index/compile/wrapper/source/connection) with the
   clean URL router; drop the JSP emulations.
4. move `backend.mjs`/`fixtures/` → `server/example-data/<name>/`; auto-discover.
5. move `htmlvideoview`/`connection` components → `runtime/components/extensions/dhtml/`.
6. rewrite the wrapper to reference `/runtime/...` and emit clean URLs.
7. update `nav.xml` paths: `/laszlo-explorer/`→`/explorer/`, `/demos/`→`/examples/`.
8. [DONE] content-hash compile cache + ETag. TS-first backend (`compiler/index.mjs`,
   byte-exact TypeScript compiler via `compileFileCached`, dependency-closure cache in
   `server/.cache-ts/`) with Java-oracle fallback (`compiler/oracle.mjs`) for debug builds,
   unsupported constructs, and sprite-montage generation. `compiler/wrapper.mjs` →
   served `index.html`; ETag = closure content-hash; `If-None-Match` → 304. Gate:
   `node server/gate-served-parity.mjs` proves the SERVED `<base>.lzx.js` is byte-identical
   to the oracle (normalized) + cache hit + invalidation. Remaining sub-gap: the TS compiler
   references but does not GENERATE sprite-montage PNGs, so sprite-bearing apps take a
   TS-js-over-oracle-assets path (oracle builds the montages/resources once; the served JS
   is the TS output). See `server/README`.
9. one-time docs build; wire `/docs/`, `/release-notes.html`, `/tools/`.
10. prove homepage + every example at parity; then retire `explorer-live/`.
```
