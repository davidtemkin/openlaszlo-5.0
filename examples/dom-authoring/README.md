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

## JSON databinding (Slice 4)

Native JSON datasets with dreem's JSONPath slash dialect. A `<dataset
type="json">` holds inline JSON (`<script type="application/json">`), fetches
it (`src="./bikes.json"`), or subscribes live over WebSocket
(`src="ws://host/api/data"`). A `datapath` starting with `$` replicates the
view per match; the datum lands on the bound view's `data` attribute and
binds through ordinary `${}` constraints:

    <dataset name="bikeshop" type="json">
      <script type="application/json">
        { "bicycle": [ { "color": "red", "price": 19.95 } ] }
      </script>
    </dataset>
    <lz-view datapath="$bikeshop/bicycle[*]">
      <lz-text text="${parent.data.color + ' — $' + parent.data.price}"/>
    </lz-view>

Mutate with `lz.jsondata.get('bikeshop').updateData('/bicycle/0/price', 9.99)`
— bound views reconcile automatically. Selectors: `[*]`, `[2]`, `[0,4,2]`
(start,end,step), terminal `[@]` (calls `filterfunction(obj, accum)` on the
parent view); `sortfield`/`sortasc` sort matches. Relative paths
(`datapath="/sub[*]"`) nest inside replicated views. `lzx-check` infers a
type from inline JSON (or a `<script type="application/lz-shape">` TS literal)
and validates paths and `${parent.data.*}` members statically.

**Demos:** `bikeshop-demo.html` (inline + updateData button);
`sensors-demo.html` + `sensor-feeder.mjs` (live over the wire):

    node server/index.mjs 8090
    node examples/dom-authoring/sensor-feeder.mjs
    open http://localhost:8090/examples/dom-authoring/sensors-demo.html

**Wire protocol** (JSON over WebSocket text frames, `/api/data` relay): a
conforming peer needs only a socket and a JSON encoder — a micropython
device can BE the data source:

    client → server   {"lz":1, "subscribe":"sensors"}
    server → client   {"dataset":"sensors", "data":{...}}            (snapshot; null if none retained)
    either direction  {"dataset":"sensors", "update":{"path":"/temp", "value":22.4}}
    server → client   {"dataset":"sensors", "error":"..."}

    # micropython sketch
    ws.send(ujson.dumps({"dataset":"sensors",
                         "update":{"path":"/temp","value":read_temp()}}))

Spec: `docs/superpowers/specs/2026-07-06-json-databinding-design.md`.
