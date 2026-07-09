# DOM-authored LZX (Slice 1)

Author LZX as native HTML inside `<laszlo-app>` (or a separate file via
`<laszlo-app src="app.html">`), served from the distro root:

    node tools/serve-static.mjs . 8087
    open http://localhost:8087/examples/dom-authoring/

## Dialect rules (full spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md)

- The app root is `<laszlo-app width height bgcolor …>` (= LZX `<canvas>`).
  A literal `<canvas>` tag is forbidden.
- Code is **TypeScript**, in typed carriers:
  `<script type="text/typescript">…</script>` inside
  `<method>/<handler>/<setter>` (or standalone for top-level scripts).
  `type="text/lzs"` passes raw LZX Script through (for `is` / `cast`).
  Bare `<script>` is an error (the page parser would execute it).
- Tags that collide with HTML need the `lz-` prefix:
  `lz-style`, `lz-image`, `lz-html`, `lz-form`, `lz-button`, `lz-label`,
  `lz-menu`, `lz-param`. (Any LZX tag may be prefixed.)
- Lowercase only: user class names, attribute and event names.
- No self-closing custom tags: write `<view></view>`, not `<view/>`.
- Inline datasets use `<script type="application/xml">…</script>` (single XML
  root) or `src=` files.
- Statically-authored plain `<view>`s are **adopted**: the element you wrote is
  the live `__LZdiv` of its sprite. `<text>`/`<inputtext>`, replicated and
  class-instantiated views render into created elements (Slice-1 fallback).
- Production build only (no `?debug` source-line mapping for DOM-authored apps).

## Type checking (Slice 2)

`lzx-check` validates the whole authored surface: TypeScript bodies get a
typed `this` (your `<attribute>` declarations, named children, the LFC API
derived from the compiler schema AND the LFC source — see the generated
`compiler/lfc.d.ts`), `setAttribute` names/values are checked, handler args
are typed from the attribute they observe, markup attribute literals are
validated against their types, `extends`/duplicate-id/duplicate-name refs
are checked, and `${…}` constraints are checked with the actual enclosing
instance types. Works on `.html` (DOM dialect) and `.lzx` (XML dialect —
ES4 bodies skipped, everything else validated).

    cd compiler
    node dist/lzx-check.js ../examples/dom-authoring/counter-app.html
    node dist/lzx-check.js ../docs/component-browser/components.lzx

Exit 1 + `file:line:col TS<code>` diagnostics on findings; non-TS bodies
(`text/lzs`, `.lzx`) are skipped and counted. Checking never blocks
running — the browser pipeline only strips types.

## Realtime bus (Slice 3)

A `<server>` section inside `<laszlo-app>` declares server-side reactive tags
(same dialect, same TypeScript carriers). Run under the Node server:

    node server/index.mjs 8090
    open http://localhost:8090/examples/dom-authoring/bus-demo.html   # in two browsers

Server attributes sync to every client (constraints track them:
`width="${100 + server.state.count * 12}"`); inline apps only in v1
(`src=`-loaded apps can't reach the bus yet); clients write back with
`server.state.setAttribute(...)` and call server `<method>`s as Promises.
State is server-authoritative and shared (one singleton per app).
`lzx-check` types both sides — server bodies run in Node (so `setInterval`
is legal there and flagged in client code). Static hosting: the section is
inert (console warning, defaults hold).

## Supabase transport (Slice 3b/3c) — shared state on STATIC hosting

`<server transport="supabase" supabase-url=… supabase-key=…>` runs the bus
over Supabase Realtime — no Node server:

    node tools/serve-static.mjs . 8087
    open http://localhost:8087/examples/dom-authoring/bus-supabase-demo.html  # two browsers

Ephemeral tags sync via broadcast + presence. Late joiners adopt the oldest
peer's non-empty state; because every client mirrors received deltas into
its own presence meta, ANY peer (not just the originator) can seed a joiner.
`server.presence.count` is a built-in; an empty room = declared defaults.

Tags with `table=` are DURABLE (3c): `rows` fills from the table and follows
inserts live (RLS-gated `insert()`); state survives everyone leaving. The
bridge also maintains an escaped `rowsText` — chat bodies are untrusted and
LzText renders via innerHTML, so text is escaped in ONE place (constraints
can't run computed calls anyway: the LZX dependency analyzer refuses them).

Methods/handlers have no execution home in supabase mode (lzx-check flags
them) — use the Node bus for server code. Presence meta rides every set;
real apps should throttle (free tier ~20/sec). Inline apps only (rooms key
on the page path). The demo project's publishable key is committed by
design; RLS is the security boundary; the free tier pauses after ~1 week
idle.
