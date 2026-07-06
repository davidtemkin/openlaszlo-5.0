# Dev Live Reload (Slice 5)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** Slices 1–4. Depends on the shared WebSocket upgrade dispatcher
introduced by the bus (Slice 3, Task 1) and reused by `/api/data` (Slice 4).
**Influences:** dreem2's `core/filewatcher.js` (mtime polling) and its
dev-server reload loop.

## Goal

Edit the source of a served app; every browser showing it reloads. No
configuration, no build step, no compiler coupling: the dev server watches
what it serves and tells the page when it changed. Server restarts (toolchain
rebuilds) also reload connected pages, for free, via reconnect.

## Principles

1. **Dev tooling stays out of the app protocol.** Reload gets its own
   endpoint (`/api/dev-reload`) on the shared upgrade dispatcher — never the
   bus socket, which is application state and only connects when `<server>`
   exists.
2. **The server injects; static hosting is untouched.** The reload client is
   added to HTML responses by the server (the `window.__OL_COMPILE`
   injection point). Files on disk never change; a static host never sees
   reload code.
3. **Watch what was actually served.** The watch set is the app document
   plus source files the page fetched — discovered from live traffic, not by
   parsing anything.
4. **Full-page reload only.** No hot module swap, no state patching. (Bus
   state lives on the server and survives reloads naturally — the reconnect
   snapshot restores it.)

## Architecture

| Unit | Location | Purpose |
| --- | --- | --- |
| reload hub | `server/dev-reload.mjs` (new) | per-app watch sets, mtime poller, WS handler for `/api/dev-reload`, `noteRequest()` hook |
| reload client | `startup/dev-reload-client.js` (new) | opens the WS, sends `watch`, reloads on `changed`; reconnect with capped backoff |
| injection + hook | `server/index.mjs` (touch) | register the handler on the upgrade dispatcher; inject `<script src="…/dev-reload-client.js">` into served HTML; call `noteRequest(path, referer)` from the static handler |

If this slice lands before the bus's dispatcher refactor, Task 1 of the plan
performs that refactor here instead (one dispatcher owns `upgrade`; handlers
register by path; unclaimed paths destroyed exactly once) — whichever slice
lands first brings it.

## Watching

- **mtime polling, not `fs.watch`.** `fs.watch` silently loses files on
  atomic saves (vim, VS Code write-temp-then-rename) — exactly the editing
  this feature exists for. One `setInterval` (500 ms) stats the union of all
  watch sets; dreem2's `filewatcher.js` is the reference. A change is any
  mtime difference, a deletion, or a reappearance.
- **Debounce:** 100 ms after the last observed change, broadcast once.
- A stat error on a watched file counts as a single change (deletion is
  usually a rename-in-progress; the reload re-serves whatever exists now).

## Watch-set formation

- Created when a client sends `{op:"watch", app:<path>}`. The set starts as
  the app document itself; for `.lzx` app URLs, the `.lzx` source file
  behind the wrapper.
- **Includes via the Referer heuristic:** when the static handler serves a
  source-typed file (`.lzx`, `.html`, `.ts`, `.js`) whose `Referer` is a
  watched app page, the file joins that app's watch set. Two filters:
  - the file must resolve under the served root — toolchain URLs (LFC,
    `lzc-browser.js`, `startup/*`) are excluded, or every page would watch
    the framework;
  - at most 100 files per app (log when the cap drops one — no silent
    truncation).
- The common single-file demo needs nothing: its watch set is one file.

## Protocol (JSON text frames)

| Direction | Message | Notes |
| --- | --- | --- |
| C→S | `{op:"watch", app:<path>}` | one per socket; path resolved under the served root, traversal refused |
| S→C | `{op:"changed", path}` | after debounce; client calls `location.reload()` |
| S→C | `{op:"error", message}` | protocol-level; socket then closed |

Reconnect behavior: the client reconnects with capped exponential backoff; a
successful **re**connect (not the first connect) triggers one reload — the
server restarted, so the toolchain likely changed.

## Lifecycle & degradation

- On by default (`server/index.mjs` is the dev server); `--no-reload` skips
  both injection and endpoint registration.
- Watch sets are per-app: created on first `watch`, torn down (poller entries
  removed) when the app's last socket closes.
- No WS support or endpoint absent (e.g. `--no-reload` server, or the page
  saved to disk and opened elsewhere): the client logs one console line and
  goes quiet.

## Error handling

- Malformed frames → `error` frame, socket closed.
- `watch` for a path outside the served root → refused with a close reason.
- Watching a nonexistent app path → accepted; the file joining the world
  later counts as a change (supports create-then-edit workflows).

## Testing

1. **Unit** — watch-set formation (Referer filter: source types in,
   toolchain URLs out, cap enforced) and debounce as pure functions; mtime
   poller against a temp directory (change, delete, reappear).
2. **Integration** — `node --test` starts the real server on an ephemeral
   port (reusing the bus's dependency-free WS test client and frame codec):
   `watch` + touch fixture → `changed`; a Referer-tracked include triggers;
   a toolchain URL does not; outside-root `watch` refused; last-socket
   close stops polling (observable via the hub's exposed watch-set size).
3. **E2E** — one Playwright test: open a demo, append a byte to its file,
   assert the page navigates.

## Non-goals (v1)

Hot module swap, `<server>`-section hot reload (still Slice 3's non-goal),
CSS-only injection, watching toolchain sources, multi-server coordination.
