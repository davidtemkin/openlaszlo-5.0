# Dev Live Reload (Slice 5)

**Date:** 2026-07-06 (rev 3 — round-2 review applied: service-worker
passthrough, closure-store lifecycle, sweep liveness bound, closure
filtering)
**Status:** Implemented — 2026-07-06 (branch dom-authoring-slice5; 105 tests green; one plan deviation: `createDevServer.close()` tracks and destroys sockets itself — upgraded WS sockets escape `closeAllConnections`)
**Builds on:** Slices 1–4. Depends on two pieces of bus (Slice 3) plumbing —
the shared WebSocket upgrade dispatcher (`attachUpgradeDispatcher`) and the
`/startup/*` URL-map pass-through; whichever slice lands first brings them
(details below).
**Influences:** dreem2's `core/filewatcher.js` (mtime polling) and its
dev-server reload loop.

## Goal

Edit the source of a served app; every browser showing it reloads. No
configuration, no build step: the dev server watches what it serves and
tells the page when it changed. Server restarts (toolchain rebuilds) also
reload connected pages via reconnect.

## Principles

1. **Dev tooling stays out of the app protocol.** Reload gets its own
   endpoint (`/api/dev-reload`) on the shared upgrade dispatcher — never the
   bus socket, which is application state and only connects when `<server>`
   exists.
2. **The server injects; static hosting is untouched.** The reload client is
   added to HTML responses by the server. Files on disk never change; a
   static host never sees reload code.
3. **Watch what the server knows was used.** For server-compiled apps that
   knowledge is the compile closure the server already computed; for
   browser-compiled pages it is observed source traffic.
4. **Full-page reload only.** No hot module swap, no state patching. (Bus
   state lives on the server and survives reloads naturally — the reconnect
   snapshot restores it.)

## Architecture

| Unit | Location | Purpose |
| --- | --- | --- |
| reload hub | `server/dev-reload.mjs` (new) | per-app watch sets + closure store, mtime poller, WS handler for `/api/dev-reload`, `noteRequest()`/`noteClosure()` hooks |
| reload client | `startup/dev-reload-client.js` (new) | opens the WS, sends `watch` (with its load timestamp), reloads on `changed`; reconnect with capped backoff; boot-id comparison |
| inject helper + hooks | `server/index.mjs`, `server/wrapper.mjs` (touch) | one shared `injectReloadClient(html)` applied to **every** server-side HTML emitter; `noteRequest`/`noteClosure` calls |
| service-worker passthrough | `service-worker.js` (repo root; touch) | server-mode passthrough for RUN/SOURCE/EDIT (see below) |
| server testability refactor | `server/index.mjs` (refactor) | export `createDevServer(opts)` (start/stop, port 0 via the bound address — request URLs must not be built from the module-level `PORT`); the CLI entry parses argv and calls it |

### Dependencies brought by whichever slice lands first

- **Upgrade dispatcher:** `server/connection.mjs` on main destroys every
  upgrade that isn't `/api/connection` (connection.mjs:98-99). The bus
  worktree already implements `attachUpgradeDispatcher` (one listener,
  path-routed, unclaimed destroyed once). If this slice lands first, it
  performs that refactor identically. (Neither branch has the
  `createDevServer` refactor — this slice owns it; the plan must note the
  merge ordering.)
- **`/startup/*` routing:** on main, `startup/urlmap.mjs` ROOT_FILES covers
  only `urlmap.mjs` and `version.json`; other `/startup/*` URLs remap to a
  nonexistent `explorer/startup/` (verified: `GET /startup/laszlo-dom.js` →
  404 under the dynamic server). The bus worktree adds the pass-through. The
  reload client script needs it; if this slice lands first, it brings the
  routing fix. (This is a pre-existing main-branch bug that also 404s the
  DOM-authoring bootstrap under the dynamic server — fix deliberately, with
  a test.)

## HTML injection

One shared helper, `injectReloadClient(html)` — insert
`<script src=".../dev-reload-client.js">` before `</head>`, falling back to
before `</body>`, else append; composes with (runs after) the existing
`__OL_COMPILE` head injection on the index — applied at every HTML-producing
emitter:

- `serveStatic` responses with `Content-Type: text/html` (all of them, not
  just the index),
- `renderWrapper` output (`server/wrapper.mjs`),
- dev-views editor/preview pages (`server/dev-views.mjs`).

**Injected HTML must not be served through unmodified validators**: the
existing ETag derives from the on-disk stat, so a client caching a
pre-injection copy would revalidate to a 304 and keep the reload-less page.
Injected responses get a suffixed ETag (or skip conditionals, as the index
injection does today).

**The service worker (round-2 catch — without this, the whole injection
design is moot for wrapper pages):** in server mode the SW still registers
(the index sets `__OL_COMPILE="server"` → `service-worker.js?compile=server`,
scope = origin root) and then synthesizes wrapper, source-view, and editor
HTML **in-worker** with its own copy of `renderWrapper` — those pages never
touch the server's emitters, and behavior flips with SW installation state.
Fix: **server-mode passthrough** for the RUN/SOURCE/EDIT ops (`return
fetch(request)`), exactly mirroring the SW's existing server-mode
passthroughs for `/api` and COMPILED. This keeps "the server injects"
true, needs no `--no-reload` propagation into the SW (the server decides),
and removes a class of SW-vs-server drift for dev pages generally.

Skipped entirely under `--no-reload`.

## Watching

- **mtime polling, not `fs.watch`** — `fs.watch` silently loses files on
  atomic saves (vim, VS Code write-temp-then-rename), exactly the editing
  this feature exists for. One `setInterval` (500 ms) stats the union of all
  watch sets; dreem2's `filewatcher.js` is the reference.
- **Change detection:** compare `(mtimeMs, size)` pairs (mtime alone misses
  same-second rewrites on 1 s-resolution filesystems). A change is any
  difference, a deletion, or a reappearance; a stat error counts as a single
  change (deletion is usually a rename-in-progress).
- **Quiet-sweep coalescing with a liveness bound:** changes observed in a
  sweep are accumulated; the broadcast fires on the first subsequent sweep
  that observes **no** new changes — **or after 6 consecutive busy sweeps
  (~3 s), whichever comes first**. Multi-file saves produce one reload; a
  pathological always-changing file (auto-save loop, a generator writing a
  watched include) cannot starve the reload forever.

## Watch-set formation

A set is keyed by app path, created on `{op:"watch"}`:

- **Server-compiled (`.lzx` wrapper) apps — the closure store:**
  `compileFileCached` returns the full dependency closure on both cache hit
  and miss (compiler/dist/api-node.js:31-42; cache-disk.js validates
  `isUpToDate(man.closure, …)`). The compile endpoint calls
  `noteClosure(app, closure)` **unconditionally and before its 304
  early-return** — the closure is in hand before the ETag check. The hub
  stores the latest closure keyed by app path **whether or not a watch set
  exists yet** (the browser fetches `<name>.lzx.js` before the reload
  client's `watch` frame can possibly arrive — rev 2's "replace the set's
  include list" dropped the closure on the floor in exactly the flagship
  case); watch-set creation seeds from the store.
  **Closure filtering (disk-path analogue of the URL denylist):** closure
  entries include everything the compile read — component sources,
  autoincludes, fonts, and `kind:"dir"` entries, under RUNTIME as well as
  DISTRO. Seed only `kind:"file"` entries under DISTRO and outside the
  RUNTIME/compiler/startup trees; the 100-file cap applies after
  filtering, and every drop is logged.
- **Browser-compiled (DOM-authored) pages:** the document itself, plus
  Referer-tracked source fetches: when `serveStatic` serves a source-typed
  file (`.lzx`, `.html`, `.ts`, `.js`) whose Referer resolves (via the same
  `toSourceUrl` normalization the server uses) to a watched app page, it
  joins that app's set. **304 revalidations count as served.**
- **Toolchain denylist (normative, not derived):** source URLs beginning
  with `/runtime/`, `/compiler/`, `/startup/`, or `/lps/` — **or containing
  `/lps/resources/`** (runtime resources arrive mid-path) — never join a
  watch set. Exact list pinned against `urlmap.mjs` at plan time.
- **Race hardening:** (a) watch sets linger for a 10 s grace period after
  their last socket closes (covers the reload gap); (b) the hub keeps a
  short ring buffer of recent `(servedPath, refererApp)` pairs and replays
  it when a `watch` registers (covers first load; the closure store plays
  this role for the compile path); (c) the `watch` frame carries the
  client's load timestamp — if any seed file's mtime exceeds it, the server
  answers `changed` immediately (covers edits during sleep or a dropped
  socket, where the boot-id rule correctly does not fire).

## Protocol (JSON text frames)

| Direction | Message | Notes |
| --- | --- | --- |
| S→C | `{op:"hello", bootId}` | on connect; client stores `bootId`, and on a **re**connect reloads iff it differs (server actually restarted — not laptop sleep or a dropped socket) |
| C→S | `{op:"watch", app:<path>, loadedAt:<ms>}` | one per socket; path resolved via `toSourceUrl` under the served root, traversal refused; `loadedAt` triggers an immediate `changed` if the set is already stale |
| S→C | `{op:"changed", paths:[…]}` | after coalescing; client calls `location.reload()` |
| S→C | `{op:"error", message}` | protocol-level; socket then closed |

## Lifecycle & degradation

- On by default; `--no-reload` skips injection and endpoint registration.
  Argv convention (new — today `index.mjs` reads only a positional port and
  `--no-reload` would parse as `PORT = NaN`): arguments starting with `--`
  are flags; the first non-flag argument is the port.
- Watch sets: created on first `watch`, torn down (poller entries removed)
  10 s after the app's last socket closes. The closure store outlives watch
  sets (it is refreshed on every compile).
- Multiple apps per page is moot — `startup/laszlo-dom.js` hard-caps one
  `<laszlo-app>` per window; the one-`watch`-per-socket rule matches.
- No WS support or endpoint absent: the client logs one console line and
  goes quiet.
- `createDevServer` note: module-level state (dev-views `edits` map, the
  compile DiskCache) means one instance per test process — acceptable,
  documented.

## Error handling

- Malformed frames → `error` frame, socket closed.
- `watch` outside the served root → refused with a close reason.
- Watching a nonexistent path → accepted; the file appearing later counts
  as a change (create-then-edit workflows).

## Testing

1. **Unit** — watch-set formation (closure store survives no-set arrival
   order; closure filtering: dirs and RUNTIME entries excluded, cap after
   filter, drops logged; Referer filter incl. `/lps/resources/`; replay
   ring; grace teardown; `loadedAt` staleness) and coalescing (quiet sweep,
   liveness bound) as pure functions; the poller against a temp directory
   (change, delete, reappear, same-second rewrite via size change).
2. **Integration** — `node --test` against `createDevServer()` on port 0:
   `watch` + touch → `changed`; **editing a closure include of a wrapper
   app triggers — including when the edit precedes the `watch` frame**
   (the round-2 race case); a Referer-tracked include triggers; a
   denylisted toolchain URL does not; 304 still registers; injected HTML
   not served via a stale validator; reconnect with same `bootId` does not
   reload, different does; stale `loadedAt` reloads immediately;
   last-socket close + grace stops polling. The WS test client is the bus
   slice's dependency-free client if landed, else a local copy.
3. **E2E** — Playwright: open a demo, append a byte to its file, assert
   navigation — **run twice: with and without the service worker
   installed** (visit `/` first to install it; the round-2 review showed
   behavior used to flip on exactly this).

## Non-goals (v1)

Hot module swap, `<server>`-section hot reload (still Slice 3's non-goal),
CSS-only injection, watching toolchain sources, multi-server coordination.
