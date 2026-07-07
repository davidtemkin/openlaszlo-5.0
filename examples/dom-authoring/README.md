# DOM-authored LZX

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

## Live reload (Slice 5)

The Node server is the dev loop — on by default, no configuration:

    node server/index.mjs 8090
    open http://localhost:8090/examples/dom-authoring/flex-demo.html
    # edit the file → the tab reloads (~1s)

The server watches what it serves: the page itself, plus (for `.lzx` apps)
the full compile closure — so editing an `<include>`d library reloads too —
plus source files the page fetched (`.lzx/.html/.ts/.js`; toolchain paths
are never watched). Changes are polled by mtime+size (survives editors'
atomic saves) and coalesced, so a multi-file save is one reload. A server
restart also reloads connected pages (boot-id handshake), which makes
toolchain rebuilds land automatically. Bus state survives reloads — it
lives on the server and the reconnect snapshot restores it. Opt out with
`--no-reload`; static hosting never sees any of this (injection is
server-side, spec: docs/superpowers/specs/2026-07-06-live-reload-design.md).

## `<flexlayout>` (Slice 6)

CSS flexbox as an ordinary LZX layout — it positions (and, for flex/stretch
children, sizes) its parent's direct subviews:

    <view width="640" height="48">
      <flexlayout flexdirection="row" justifycontent="space-between"
                  alignitems="center" padding="8"></flexlayout>
      <text text="logo"></text>
      <view flex="1" height="1"></view>     <!-- the spacer grows -->
      <text text="menu"></text>
    </view>

Container attributes: `flexdirection` (`row`/`column`/`*-reverse`),
`justifycontent`, `alignitems`, `flexwrap`, `padding`. Hints on any subview:
`flex` (grow factor — grow-only, this engine has no flex-shrink),
`alignself`, `margin` (uniform; there is no `gap` — use margins). All typed:
`flexdirection="rows"` and `flex="x"` are lzx-check findings.

**Only genuinely-auto dimensions belong to the engine**: authored,
constrained, or previously-set sizes are inputs, never outputs — a
`<view width="50">` keeps its width under `flex="1"`, and un-stretching a
child restores what it had. Nested flex = nested flexlayouts, one per
container. One flexlayout per parent (it claims x, y, width, height).
Engine: Facebook's css-layout, vendored via dreemgl (BSD; header has
provenance). Demo: flex-demo.html · spec:
docs/superpowers/specs/2026-07-06-flexlayout-design.md.

## `<shader>` (Slice 7)

A view whose surface is a WebGL fragment shader — authored in the same
TypeScript carriers as everything else, statically type-checked, compiled
to GLSL at app-compile time (DOM-dialect apps only):

    <shader width="640" height="360">
      <attribute name="speed" type="number" value="1"></attribute>
      <method name="color"><script type="text/typescript">
        let n = noise.snoise2v(uv * 8.0 + time * this.speed);
        return pal.pal1(n * 0.5 + 0.5);
      </script></method>
    </shader>

`color()` returns the fragment's `vec4`. Built-ins: `uv`, `time`, `mouse`,
`size`. **Declared `number`/`color` attributes are uniforms** — a
`setAttribute`, a `${…}` constraint, or a bus delta animates the GPU with no
extra machinery. Extra `<method name="glow" args="p: vec2" returns="vec4">`
elements become GLSL helper functions. The shaderlib rides along in five
namespaces — `noise.*` (simplex/cellular), `shape.*` (SDFs), `pal.*`
(palettes), `color.*` (HSL/HSV), `math.*` — ported from dreemgl; only
functions you call are compiled in.

The dialect is the GLSL-expressible TS subset (vec swizzles, arithmetic,
`if`, bounded `for`, no strings/arrays/closures) and lzx-check validates it
for real: `uv * 8.0` types as `vec2` end-to-end, a wrong swizzle or a
`vec2 + vec3` is a finding before the GL driver ever sees the source.
Fallbacks: no WebGL, a driver compile failure, or the `.lzx` path (no GLSL
emission) → the view shows its `bgcolor` with one debug warning.

Gotcha worth knowing: `time * this.speed` JUMPS when speed changes (you are
rescaling accumulated time). Integrate instead — a `phase` attribute advanced
`phase += speed * dt` per frame; speed then changes the rate, never the
position (shader-demo.html does exactly this).

Demos: shader-demo.html (sliders constraint-bound to the zoom/glow uniforms;
integrated-phase speed) and shader-validate.html — a self-checking GL conformance
page that compiles generator output for every shaderlib namespace on YOUR
GPU and must show ALL PASS. Spec:
docs/superpowers/specs/2026-07-06-shader-view-design.md. Textures, vertex
shaders, and `#extension`s are v1 non-goals.
