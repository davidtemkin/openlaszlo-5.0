# Dev Live Reload (Slice 5)

**Date:** 2026-07-06 (rev 2 — adversarial review findings applied; injection
mechanism, wrapper-app watch seeding, and toolchain denylist redesigned)
**Status:** Approved design, pre-implementation
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
   browser-compiled pages it is observed source traffic. (Rev 1's
   "live traffic only" principle was wrong for wrapper apps — their includes
   are resolved in-process by the compiler and generate no browser traffic.)
4. **Full-page reload only.** No hot module swap, no state patching. (Bus
   state lives on the server and survives reloads naturally — the reconnect
   snapshot restores it.)

## Architecture

| Unit | Location | Purpose |
| --- | --- | --- |
| reload hub | `server/dev-reload.mjs` (new) | per-app watch sets, mtime poller, WS handler for `/api/dev-reload`, `noteRequest()` + `noteClosure()` hooks |
| reload client | `startup/dev-reload-client.js` (new) | opens the WS, sends `watch`, reloads on `changed`; reconnect with capped backoff; boot-id comparison |
| inject helper + hooks | `server/index.mjs`, `server/wrapper.mjs` (touch) | one shared `injectReloadClient(html)` applied to **every** HTML emitter; `noteRequest`/`noteClosure` calls |
| server testability refactor | `server/index.mjs` (refactor) | export `createDevServer(opts)` (start/stop, port 0 supported); the CLI entry parses argv and calls it |

### Dependencies brought by whichever slice lands first

- **Upgrade dispatcher:** `server/connection.mjs` on main destroys every
  upgrade that isn't `/api/connection` (connection.mjs:98-99). The bus
  worktree already implements `attachUpgradeDispatcher` (one listener,
  path-routed, unclaimed destroyed once). If this slice lands first, it
  performs that refactor identically.
- **`/startup/*` routing:** on main, `startup/urlmap.mjs` ROOT_FILES covers
  only `urlmap.mjs` and `version.json`; other `/startup/*` URLs remap to a
  nonexistent `explorer/startup/` (verified: `GET /startup/laszlo-dom.js` →
  404 under the dynamic server). The bus worktree adds the pass-through. The
  reload client script needs it; if this slice lands first, it brings the
  routing fix. (Note: this is a pre-existing main-branch bug that also 404s
  the DOM-authoring bootstrap under the dynamic server — fix deliberately,
  with a test.)

## HTML injection

Rev 1 claimed the `window.__OL_COMPILE` injection point; that injection
applies **only** to `/` and `/index.html` (index.mjs:183,188). The pages this
feature exists for bypass it. Instead: one shared helper,
`injectReloadClient(html)` — insert `<script src=".../dev-reload-client.js">`
before `</head>`, falling back to before `</body>`, else append — applied at
every HTML-producing emitter:

- `serveStatic` responses with `Content-Type: text/html` (all of them, not
  just the index),
- `renderWrapper` output (`server/wrapper.mjs`),
- dev-views editor/preview pages (`server/dev-views.mjs`).

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
- **Quiet-sweep coalescing** (replaces rev 1's inert 100 ms debounce, which
  could never outlast the 500 ms poll): changes observed in a sweep are
  accumulated; the broadcast fires on the first subsequent sweep that
  observes **no** new changes. Multi-file saves spanning sweeps produce one
  reload; latency is one to two poll intervals.

## Watch-set formation

A set is keyed by app path, created on `{op:"watch"}`:

- **Server-compiled (`.lzx` wrapper) apps:** seeded from the **compile
  closure** — `compileFileCached` already returns the full dependency
  closure and the disk cache validates against it (compiler/dist/
  cache-disk.js `isUpToDate(man.closure, …)`). The hub's `noteClosure(app,
  files)` is called from the compile endpoint on every (re)compile,
  replacing the set's include list. Referer sniffing cannot see these
  includes (they never cross the wire); the closure is authoritative.
- **Browser-compiled (DOM-authored) pages:** the document itself, plus
  Referer-tracked source fetches: when `serveStatic` serves a source-typed
  file (`.lzx`, `.html`, `.ts`, `.js`) whose Referer resolves (via the same
  `toSourceUrl` normalization the server uses) to a watched app page, it
  joins that app's set. **304 revalidations count as served** — watch sets
  must survive warm caches.
- **Toolchain denylist (normative, not derived):** requests whose source URL
  begins with `/runtime/`, `/compiler/`, `/startup/`, or `/lps/` never join
  a watch set. Rev 1 claimed the served-root check excluded the toolchain;
  it excludes nothing (everything served resolves under DISTRO, and wrapper
  pages `<script src>` the LFC with the page as Referer). The denylist is
  the mechanism. Exact prefix list pinned against `urlmap.mjs` at plan time.
- **Cap:** 100 files per app; log every drop (no silent truncation).
- **Race hardening:** the page's own source fetches begin before the reload
  client's `watch` frame arrives — on every load, since reload tears the
  socket down. Two rules: (a) watch sets linger for a 10 s grace period
  after their last socket closes (covers the reload gap); (b) the hub keeps
  a short ring buffer of recent `(servedPath, refererApp)` pairs and replays
  it when a `watch` registers (covers first load).

## Protocol (JSON text frames)

| Direction | Message | Notes |
| --- | --- | --- |
| S→C | `{op:"hello", bootId}` | on connect; client stores `bootId`, and on a **re**connect reloads iff it differs (server actually restarted — not laptop sleep or a dropped socket) |
| C→S | `{op:"watch", app:<path>}` | one per socket; path resolved via `toSourceUrl` under the served root, traversal refused |
| S→C | `{op:"changed", paths:[…]}` | after quiet-sweep coalescing; client calls `location.reload()` |
| S→C | `{op:"error", message}` | protocol-level; socket then closed |

## Lifecycle & degradation

- On by default; `--no-reload` skips injection and endpoint registration.
  Argv convention (new — today `index.mjs` reads only a positional port and
  `--no-reload` would parse as `PORT = NaN`): arguments starting with `--`
  are flags; the first non-flag argument is the port.
- Watch sets: created on first `watch`, torn down (poller entries removed)
  10 s after the app's last socket closes.
- Multiple apps per page is moot — `startup/laszlo-dom.js` hard-caps one
  `<laszlo-app>` per window; the one-`watch`-per-socket rule matches.
- No WS support or endpoint absent: the client logs one console line and
  goes quiet.

## Error handling

- Malformed frames → `error` frame, socket closed.
- `watch` outside the served root → refused with a close reason.
- Watching a nonexistent path → accepted; the file appearing later counts
  as a change (create-then-edit workflows).

## Testing

1. **Unit** — watch-set formation (closure seeding replaces include lists;
   Referer filter: source types in, denylist out; cap logs drops; replay
   ring; grace-period teardown) and quiet-sweep coalescing as pure
   functions; the poller against a temp directory (change, delete,
   reappear, same-second rewrite via size change).
2. **Integration** — `node --test` against `createDevServer()` on port 0
   (the refactor exists precisely so this test can): `watch` + touch →
   `changed`; editing a **closure include** of a wrapper app triggers (the
   rev-1 design missed this case entirely); a Referer-tracked include
   triggers; a denylisted toolchain URL does not; 304 still registers;
   reconnect with same `bootId` does not reload, different does;
   last-socket close + grace stops polling. The WS test client is the bus
   slice's dependency-free client if landed, else a local copy.
3. **E2E** — one Playwright test: open a demo, append a byte to its file,
   assert the page navigates.

## Non-goals (v1)

Hot module swap, `<server>`-section hot reload (still Slice 3's non-goal),
CSS-only injection, watching toolchain sources, multi-server coordination.
