# The Realtime Bus — dreem2 Compositions for OpenLaszlo 5.0 (Slice 3)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** Slice 1 (DOM-native authoring, `docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md`) and Slice 2 (`lzx-check`). **Influences:** dreem2's compositions, BusServer, and RPC layer (`~/dreem2`: `core/busserver.js`, `core/rpcproxy.js`, `compositions/iot_1.dre`).

## Goal

One document holds the UI **and** its server: a `<server>` section inside
`<laszlo-app>` declares server-side reactive tags, authored in the same HTML
dialect with the same TypeScript carriers. Their attributes sync live to every
connected client over a WebSocket bus; client constraints bind them like any
other state (`x="${server.clock.seconds * 10}"`); clients write back via
`setAttribute` and call server `<method>`s as Promises. Everything is typed:
`lzx-check` validates server bodies, client bindings, and the RPC surface
from the same declarations.

This is dreem2's composition idea (`<screen>` + server device tags synced via
`teem.*`), transposed onto the Slice-1/2 toolchain — and typed.

## Principles

1. **One document, two extractions.** The client compile strips `<server>`;
   the bus server reads the same file and runs only `<server>`. Neither side
   ever sees the other's code.
2. **Reuse the toolchain, don't extend the compiler.** The server side parses
   with the compiler's own `parseHtmlDialect` and transpiles carriers with the
   existing `transpileTsBody` — server tags are evented TS objects in Node,
   never compiled LZX. The client side needs **zero compiler changes** for
   binding: proxies are real LFC node instances, so the compiler's existing
   static constraint-dependency analysis just works.
3. **Server-authoritative state.** Client writes do not apply locally; state
   changes only when the server's delta broadcast arrives. One source of
   truth, no divergence.
4. **The declared surface is the callable surface.** RPC accepts `set` only
   for declared `<attribute>`s and `call` only for declared `<method>`s —
   exactly what `lzx-check` can see and type.
5. **Additive, as always.** Static hosting still works (`<server>` is inert
   without the Node server); the `.lzx`-text path, byte parity, and Slices
   1–2 are untouched.

## Architecture

```
 app.html ──┬── client compile (domsource STRIPS <server>) ──► app JS
            │                                                    ▲
            │   bootstrap: lz-bus.js builds `server.*` proxies ──┘ (blob prelude,
            │   as LFC node instances w/ pre-declared events)      like lz-adopt-patch)
            │                    ▲ WebSocket /api/bus?app=<path>
            └── server: bus.mjs reads the SAME file, extracts <server>,
                transpileTsBody(carriers) → SrvNode instances (shared singletons)
```

### Components

| Unit | Location | Purpose |
| --- | --- | --- |
| `<server>` dialect rule | `compiler/src/domsource.ts` | strip the subtree from the client compile; direct-child-of-root only |
| server model extraction | `compiler/src/app-model.ts` | server tags → typed model (reusing `declKind` machinery); skipped by the client instance walk |
| `SrvNode` | `server/srvnode.mjs` (new, pure) | the server tag runtime: `setAttribute` + `on<attr>` handler dispatch + broadcast hook |
| `bus.mjs` | `server/` (new) | WebSocket endpoint `/api/bus`, per-app `BusApp` lifecycle, protocol, RPC dispatch |
| frame codec export | `server/connection.mjs` (small refactor) | export `encodeText`/`decodeFrames`/`acceptKey` for reuse by `bus.mjs` and tests |
| `lz-bus.js` | `startup/` (new) | client bus: proxy construction prelude, WebSocket client, reconnect, RPC promises |
| bootstrap hook | `startup/laszlo-dom.js` | detect `<server>`, extract declarations, prepend the proxy prelude, hand the section to `lz-bus` |
| checker integration | `compiler/src/app-model.ts`, `app-dts.ts`, `lzx-check.ts` | `LzSrv_<name>` types, typed `server` const, server-body checking |
| Demo | `examples/dom-authoring/bus-demo.html` | shared counter + RPC chat — two browsers, one state |

## Authoring & dialect

- **`<server>`** is a dialect element allowed only as a **direct child of
  `<laszlo-app>`** (anywhere else: dialect error). At most one per app
  (a second is a dialect error). Its subtree is stripped from the client
  compile, never adopt-stamped, and skipped by the client model walk.
- Inside `<server>`, **any tag name declares a generic server object** — no
  special vocabulary. The `name` attribute is its bus identity (required,
  must be a TS identifier, unique within `<server>`; violations are checker
  findings and bus-refusal errors). Contents: `<attribute>`, `<method>`,
  `<handler>` with the same TS carrier rules as client code.
- **Lifecycle:** tags instantiate once (shared singletons) when the app's
  first bus client connects, and live for the server's lifetime. `oninit`
  fires at instantiation. `on<attr>` handlers fire on every attribute change
  (LZX semantics), BEFORE the delta is broadcast.
- **TS bodies run in real Node** — `setInterval`, `fetch`, `console` are
  available; no special timer/device vocabulary is needed (dreem2's
  `<arduino>` equivalents are just tags whose `oninit` opens the device).
- **Values are JSON-serializable** (documented; a non-serializable
  `setAttribute` on the server throws at the call site).

Example:

```html
<laszlo-app width="640" height="400">
  <text text="${'up ' + server.clock.seconds + 's'}"></text>

  <server>
    <clock name="clock">
      <attribute name="seconds" type="number" value="0"></attribute>
      <handler name="oninit"><script type="text/typescript">
        setInterval(() => this.setAttribute('seconds', this.seconds + 1), 1000);
      </script></handler>
      <method name="reset"><script type="text/typescript">
        this.setAttribute('seconds', 0);
      </script></method>
    </clock>
  </server>
</laszlo-app>
```

## Server runtime

- **`SrvNode`** (~100 lines, dependency-free, pure construction): built from
  extracted declarations `{name, attrs:[{name, value, type}], methods,
  handlers}`. Carrier bodies are transpiled with the existing
  `transpileTsBody` and compiled with `new Function("...args", body)`,
  invoked with `this` bound to the instance. `setAttribute(name, v)`:
  validate JSON-serializability, apply, fire `on<attr>` handlers, then call
  the injected `onDelta(tag, attr, value)` hook. Attribute defaults are
  coerced by declared type (`number` → Number, `boolean` → `=== "true"`),
  matching LZX semantics.
- **`bus.mjs`**: attaches to the existing HTTP server's `upgrade` event
  alongside `connection.mjs` (dispatch by URL path: `/api/connection` vs
  `/api/bus`), reusing the exported RFC 6455 codec. Key: `/api/bus?app=<distro-relative-path>` —
  resolved under DISTRO with traversal refusal. Per app path, one **BusApp**:
  - lazily created on the first client connection; parses the file with the
    compiler's `parseHtmlDialect` + `findLaszloApp` (imported from
    `compiler/dist/`), extracts `<server>`, instantiates SrvNodes, fires
    `oninit`s;
  - tracks connected sockets; `onDelta` broadcasts to all;
  - dispatches `set`/`call` per the declared-surface rule;
  - a file re-read/instance rebuild happens only on server restart (no hot
    reload in v1 — documented).

## Protocol (JSON text frames)

| Direction | Message | Notes |
| --- | --- | --- |
| S→C | `{op:"snapshot", tags:{<name>:{<attr>:<value>,…},…}}` | on every (re)connect — full state, no delta replay |
| S→C | `{op:"delta", tag, attr, value}` | broadcast on every server-side attribute change |
| C→S | `{op:"set", tag, attr, value}` | declared attributes only |
| C→S | `{op:"call", tag, method, args, uid}` | declared methods only; `uid` client-generated |
| S→C | `{op:"result", uid, value}` / `{op:"error", uid?, message}` | RPC completion; `error` without `uid` = protocol-level |

Reserved for later (protocol room, not built): `scope:"session"` tags,
presence/`clients`, delta versioning.

## Client runtime (`lz-bus.js`)

- The bootstrap (`laszlo-dom.js`) already holds the parsed DOM. When a
  `<server>` section exists it extracts the declarations
  (names/attrs/defaults/methods) BEFORE `domToXmlElem` strips the section,
  and prepends a **proxy prelude** to the app JS blob (the `lz-adopt-patch`
  mechanism): after the LFC loads, `server.<name>` is created as a **real LFC
  node instance** — attributes initialized to declared defaults, `on<attr>`
  events pre-declared as real `LzDeclaredEvent`s. Compiled constraints
  (`${server.clock.seconds}`) therefore bind with zero compiler changes: the
  compiler's static dependency analysis registered on `server.clock.onseconds`,
  which the bus fires on each delta.
- **Proxy semantics:** `setAttribute` is overridden to SEND `{op:"set"}` (no
  local echo — principle 3); deltas apply through the original setter → events
  fire → constraints update. Declared methods are Promise-returning stubs
  (`server.clock.reset()` → `{op:"call"}`, settled by `result`/`error`).
- **Connection:** same-origin `ws(s)://<host>/api/bus?app=<location.pathname>`;
  auto-reconnect with capped exponential backoff; every (re)connect applies
  the fresh snapshot through the original setters (constraints converge).
- **Degradation:** no `<server>` section → lz-bus never loads (zero cost).
  Section present but WS unavailable (static host / server down): one console
  warning, proxies hold their declared defaults, the app runs.

## Checker integration (`lzx-check`)

- `app-model` walks `<server>`: each tag → `LzSrv_<name>` with attrs via the
  existing `declKind` machinery and method signatures; the client model gets
  `declare const server: { clock: LzSrv_clock; … }`.
- **Server bodies** check with `this: LzSrv_<name>` extending a small curated
  `SrvNode` base (strict generic `setAttribute`, and Node timer/global
  declarations — `setInterval`/`clearInterval`/`console`/`fetch` — since
  server bodies run outside the LFC).
- **Client side**: method stubs type as `(…args) => Promise<any>`; client
  bodies and `${…}` constraints referencing `server.*` typecheck against the
  same declarations. Client-side `server.x.setAttribute` is the strict
  generic, so wrong-typed `set`s are findings before they ever hit the wire.

## Error handling

- Malformed/unparseable frames → socket closed with a reason.
- `set` on an undeclared attribute / `call` on an undeclared method →
  `{op:"error"}` frame + server log; the socket stays open.
- A throwing server handler/method → caught and logged; the tag stays alive;
  a `call`'s error propagates as `{op:"error", uid}` → the client Promise
  rejects.
- App file missing / no `<server>` section / parse error / duplicate-or-
  invalid tag names → the bus refuses the connection with a close reason;
  `lz-bus` surfaces it in the console.
- Non-JSON-serializable `setAttribute` on the server → throws at the call
  site (a server-code bug, surfaced where it happens).

## Demo & testing

**Demo** (`examples/dom-authoring/bus-demo.html`, served by
`node server/index.mjs`): a shared counter (click → `server.state.setAttribute`
path), and a chat log (`<inputtext>` + send → RPC `say(text)` method appending
to a `log` string attribute rendered in a `<text>`). Open two browsers: one
state.

**Testing:**
1. **Unit** — `<server>` extraction + client-compile strip (domsource,
   app-model); `SrvNode` semantics (defaults/coercion, handler dispatch order,
   delta hook, JSON guard); checker typing (`LzSrv_*`, `server` const, a
   wrong-typed `server.*.setAttribute` finding).
2. **Integration** — `node --test` starts the real server on an ephemeral
   port with a fixture app; a minimal dependency-free WS test client (reusing
   the exported frame codec) asserts: snapshot on connect, delta broadcast to
   a second client, `set` round-trip, `call` result and error, undeclared-`set`
   error, reconnect snapshot.
3. **E2E** — two Playwright tabs on the demo: click in tab A, assert tab B's
   counter; chat message crosses tabs.

## Non-goals (v1)

Sessions (`scope="session"`), presence, auth beyond same-origin, delta
replay/versioning, hot reload of the `<server>` section, `.lzx`-dialect
`<server>`, multi-screen targets, the dreem2 visual editor, horizontal
scaling. `SrvNode` is deliberately factored so plain-Node-module server
objects (approach C) can register on the bus later without protocol changes.
