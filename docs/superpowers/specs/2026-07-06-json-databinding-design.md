# JSON Databinding — Design

**Date:** 2026-07-06 (rev 2, post adversarial review)
**Status:** Approved design, pre-implementation
**Provenance:** Ports dreem/dreem2's JSONPath databinding (`~/dreem/classes/{dataset,replicator}.dre`, `~/dreem2/classes/{dataset,datapath,replicator}.dre`) into openlaszlo-5.0's DOM-native authoring layer (slices 1–2).

## Goal

DOM-authored apps can declare native JSON datasets (inline, fetched, or live over
WebSocket), bind and replicate views over them with dreem's JSONPath dialect, and
have those bindings statically type-checked by lzx-check. Bound datums are raw
JavaScript values end to end. The XML dataset/XPath stack is untouched; the two
systems meet only at an explicit bridge.

## Non-goals

- Classic `.lzx` authoring of JSON datasets (DOM-authored HTML only).
- Automatic two-way binding (view edits do not flow back to datasets; the
  `updateData` API and the reserved outbound wire message are the doors for later).
- Recursive descent (`..`), dreem's undocumented `[0..10]` range form, and
  standard Goessner `$.a.b` syntax — the dialect below is the whole grammar.
- Server framework / RPC / device SDKs. The wire protocol is specified so any peer
  can conform; only the browser client and a reference node relay ship here.
- Protocol authentication/authorization. The relay trusts its network; production
  deployments should front it with wss:// and their own auth. Stated here so the
  omission is a decision, not an oversight.
- Lazy/resize replication variants; fine-grained (per-clone) update propagation.
- Dynamic datapaths: `setAttribute('datapath', …)` after init is unsupported in
  this slice (it would bypass the instantiation-time interception seam).

## Decisions (settled during brainstorming)

1. **Data model:** both layers — raw JS datums as the primary surface, plus an
   opt-in bridge to LzDataElement for existing XPath-bound components.
2. **Path dialect:** dreem slash dialect (`$name/store/book[*]/title`), not
   Goessner JSONPath.
3. **Replication:** OpenLaszlo-style implicit — a multi-match `datapath` on any
   view replicates it. No `<replicator>` tag.
4. **Attribute binding:** the bound view gets its datum as a `data` attribute;
   authors bind with the existing constraint system. No `$datapath{…}` syntax.
5. **Scope:** DOM-authored HTML apps only.
6. **Architecture:** parallel micro-runtime (patch module + shared TS evaluator),
   not translation onto the LFC stack, not subclassing frozen replication classes.
7. **Protocol:** designed protocol-first so non-JS peers (micropython, rust/wasm on
   microcontrollers) can drive datasets. This slice specs the protocol and ships
   the browser WS client + a node reference relay.

## Authoring surface

```html
<laszlo-app>
  <dataset name="bikeshop" type="json">
    <script type="application/json">
      { "bicycle": [
        { "color": "red",   "price": 19.95 },
        { "color": "green", "price": 29.95 } ] }
    </script>
  </dataset>
  <!-- fetched: --> <dataset name="bikes"   type="json" src="./bikes.json"></dataset>
  <!-- live:    --> <dataset name="sensors" type="json" src="ws://device.local/bus"></dataset>

  <lz-view datapath="$bikeshop/bicycle[*]">
    <lz-text text="${parent.data.color}"
             fgcolor="${parent.data.price > 20 ? '#999' : '#000'}"/>
  </lz-view>
</laszlo-app>
```

- `type="json"` on the existing `<dataset>` tag routes the subtree to the new
  machinery. Like XML datasets, JSON datasets are source-only (never adopted).
- A `datapath` beginning with `$` uses the JSON dialect; relative paths whose
  nearest datapath-bound ancestor is JSON-bound are also JSON-dialect (a static
  property — see Compiler routing). All other datapaths flow to the LFC XPath
  stack unchanged.
- Live/fetched datasets may declare a shape for typing:
  `<script type="application/lz-shape">{ temp: number, readings: number[] }</script>`.

**Where the datum lives (the author contract).** The `data` attribute is set on
the datapath-bound view itself — the view carrying the `datapath` attribute (each
clone, when replicated). Descendants reach it through the ancestor chain:
`${parent.data.color}` from a direct child (as above), or a named ancestor
reference from deeper nesting. `this.data` is only meaningful on the bound view
itself — e.g. terminal binding, dreem's own idiom:
`<lz-text datapath="$bikeshop/bicycle[*]/color" text="${this.data}"/>` (replicates
one text per color, datum is the string itself). lzx-check types `parent` as the
actual parent instance type (slice-2 machinery), so `${parent.data.colour}` is a
compile-time error while a stray `${this.data.x}` on an unbound view types as
`any` (base-class fallback) — documented limitation.

## Path dialect

Grammar (dreem-compatible):

```
path       := absolute | relative
absolute   := "$" name segments?         // $bikeshop, $bikeshop/bicycle[*]
relative   := segments                   // /subgenres[*]/name
segments   := ("/" property selector*)+ filter?
selector   := "[*]"                      // every element of an array
            | "[" int "]"                // index
            | "[" int "," int ("," int)? "]"   // start,end(,step) range
filter     := "[@]"                      // filterfunction hook, terminal position only (phase 5)
pointer    := ("/" (property | int))+    // updateData/wire addressing; no selectors
```

Evaluation returns the array of matches. Wildcards/ranges fan out; plain segments
select one property. Notes:

- `$name` alone binds the whole dataset value.
- No escaping: property names containing `/`, `[`, or a leading `$` are not
  addressable (matches dreem).
- Pointer segments that parse as integers index arrays and are property keys
  otherwise; a pointer cannot address the root (that is `setData`'s job).
- `updateData` and wire `update.path` accept only pointer paths.

## Architecture

Three code locations, one shared core:

1. **`compiler/src/json-path.ts`** — parser + evaluator + pointer resolver as pure
   functions. Single source of truth with two consumers: bundled into
   `lzc-browser.js` for compile-time validation, and emitted as a standalone
   IIFE runtime artifact (`startup/lz-json-data.js` includes it) by an esbuild
   script alongside the existing `bundle:lzts` → `startup/lz-ts.js` precedent in
   `compiler/package.json`. No compiler in the browser runtime.
2. **`startup/lz-json-data.js`** — runtime patch module, loaded like
   `lz-adopt-patch.js`: prepended as raw text into the app-JS blob by
   `laszlo-dom.js` (order: LFC → adopt patch → json-data module → app JS), so it
   must be a plain IIFE, not an ES module. Contains the `JsonDataset` registry +
   the three sources + the mutation API + the replication manager.
3. **Compiler extensions** — see Compiler routing below.

`runtime/lfc-src` is not touched.

**Why `${parent.data.color}` re-evaluates with zero LFC modification:** compiled
constraints emit dependency pairs, and the pair `(boundView, "data")` registers a
delegate on the LFC's declared `ondata` event; `$lzc$set_data` fires it. (The
sub-object pair `(datum, "color")` is nullified for non-eventable raw datums —
which is why propagation of in-place mutations works by the manager re-setting
`data`, never by expecting datums to be evented.) Note `data` is *not* an ordinary
attribute: `$lzc$set_data` also instantiates a classic LzDatapath when handed an
`LzDataNodeMixin` value. Raw JSON values skip that branch; to keep it skipped, the
replication manager refuses (console error, clone skipped) any datum that is an
LzDataNodeMixin instance — relevant once the phase-6 bridge exists. JSON datums
containing LzDataElement values are unsupported.

## Compiler routing

- **`domsource.ts`**: accept `<script type="application/json">` (and
  `application/lz-shape`) inside `type="json"` datasets; the dataset subtree stays
  source-only (existing `NO_STAMP_SUBTREE` behavior).
- **Dataset compilation**: `type="json"` datasets bypass the existing
  `datasetArgs`/`lzAddLocalData` path entirely (which parses dataset bodies and
  `src` targets as XML at compile time and would choke on JSON/ws URLs). Instead
  the compiler emits a registration call into the app JS —
  `lz.jsondata.register(name, {json: <literal>} | {src: <url>} | {ws: <url>},
  shape?)` — consumed by the runtime module. `src` is never fetched at compile
  time.
- **Datapath routing**: whether a datapath is JSON-dialect is decided statically:
  `$`-prefixed, or relative with a nearest datapath-bound ancestor that is
  JSON-bound. The compiler emits JSON datapaths under a distinct instantiation key
  (`jsondatapath`) so the LFC's `$lzc$set_datapath`/XPath parser never sees them,
  and lzx-check applies the identical static rule — compiler, checker, and runtime
  cannot disagree. Classic relative XPaths in XML-bound apps are unaffected.
- **`app-model.ts` / `lzx-check.ts`**: `datapath` leaves `SKIP_LITERAL` for the
  JSON case; shape inference and typed `data` per bound instance (see Typing).

## Runtime components

### JsonDataset

Registered by name in a window-level registry. Holds the raw parsed value as
`data`; fires `ondata` on change, `onerror` on failure.

Sources (all just callers of the same two entry points):
- **Inline** — parsed at compile time; malformed JSON is a compile-time error.
- **Fetch** — `src` with http(s)/relative URL; `setData(parsed)` on arrival.
- **Live** — `src` with ws(s) URL; speaks the wire protocol below; reconnects with
  capped backoff and re-subscribes.

Mutation API (the only mutation primitives):
- `setData(value)` — replace the whole value, fire `ondata`.
- `updateData(pointerPath, value)` — resolve pointer, mutate in place, fire `ondata`.

Bridge: `toLzDataset(name?, {live}?)` converts the current value via the frozen
`LzDataElement.__LZv2E()` into a real LzDataset for XPath-bound components.
One-shot by default; `live: true` re-converts on every `ondata`. One-directional —
edits to the converted tree do not flow back. Bridged values must not be fed back
into JSON bindings (see the LzDataNodeMixin guard above).

### Wire protocol

JSON Lines over WebSocket. One socket per dataset (a multiplexing handshake is
future work; no unsubscribe message — close the socket). Message shapes:

```
client → server:  {"lz": 1, "subscribe": "sensors"}
server → client:  {"dataset": "sensors", "data": {…}}                              // snapshot
server → client:  {"dataset": "sensors", "update": {"path": "/temp", "value": 22.4}}
server → client:  {"dataset": "sensors", "error": "<human-readable reason>"}
client → server:  {"dataset": "sensors", "update": {…}}   // outbound; shape reserved, NOT sent in this slice
```

Lifecycle rules (the conformance surface):

- A server MUST reply to `subscribe` with a snapshot message: the retained data,
  or `{"dataset": name, "data": null}` if nothing has been published yet.
- Publishers send the same snapshot/update shapes; the relay retains the latest
  snapshot per dataset (applying updates to it) and forwards messages to all
  subscribers.
- The client drops `update` messages until it has received a snapshot with
  non-null data (dropped with a console warning).
- Concurrency is last-write-wins in arrival order; no conflict resolution.
- `"lz": 1` on `subscribe` is the protocol version; servers reject unknown
  versions with an `error` message.
- Unknown or malformed messages are logged and skipped on both ends — a
  misbehaving peer cannot wedge the app.

No JSONPath on the wire: peers address with pointer paths only, so a conforming
peer needs a socket and a JSON encoder. A ~40-line node relay ships in `examples/`
as the reference server; a micropython peer sketch is documentation:

```python
import usocket, ujson  # ~15 lines total with a ws handshake helper
ws.send(ujson.dumps({"dataset": "sensors",
                     "update": {"path": "/temp", "value": read_temp()}}))
```

### Replication

The interception seam is `LzNode.prototype.createChildren` (wrapped by the patch
module, same pattern as `lz-adopt-patch.js` wrapping `__makeSprite`): child specs
carrying `jsondatapath` are diverted to a lightweight replication manager instead
of plain instantiation.

1. Evaluate the path against the dataset → N matches.
2. Instantiate N clones of the authored template into the parent. `data` and
   `clonenumber` are passed in the clone's *construction attrs* (the LFC applies
   plain values before constraints, so initial constraint evaluation sees the
   datum); each clone also gets a `cloneManager` reference, mirroring the classic
   system.
3. On `ondata`, re-evaluate and reconcile per the `pooling` attribute, matching
   dreem's semantics:
   - `pooling="false"` (default): destroy all clones, recreate from the new
     matches. No stale per-clone state, ever.
   - `pooling="true"`: reuse clones by index via `setAttribute('data', newDatum)`
     (constraints re-run; imperative per-clone state is the author's
     responsibility), create the shortfall, hide the surplus.
   After reconcile the manager fires `onclones` (classic LFC event name).

Zero matches → zero clones (not an error). A non-wildcard path with exactly one
match binds the single view without cloning, mirroring classic datapath behavior.

Relative paths nest: `<lz-view datapath="/subgenres[*]">` inside a clone evaluates
against that clone's datum (dreem's genres example).

Filter/sort (phase 5): `[@]` invokes `filterfunction(obj, accum)`, authored as
`<method name="filterfunction">` on the datapath-bound view; `sortfield` /
`sortasc` attributes apply between evaluate and reconcile. (dreem2's `sortpath`
is omitted.)

### End-to-end change propagation

device `update` → `updateData` mutates + fires `ondata` → replication managers
re-evaluate and reconcile → surviving clones get `setAttribute('data', datum)` →
the LFC constraint system re-runs `${parent.data.*}` bindings. The frozen
machinery does the last mile unmodified.

## Compile-time typing (lzx-check)

- **Shape acquisition:** inline datasets infer a TS type from the JSON literal.
  Fetched/live datasets use the optional `application/lz-shape` declaration —
  its body is a **TypeScript type literal**, inserted verbatim as the dataset's
  root type in the generated d.ts; TS syntax errors in it surface as diagnostics
  mapped to the script's source line. Absent a shape, the dataset types as `any`
  with a lint note (not an error).
- **Array unification (inference rule):** element object shapes merge into a
  single object type; properties absent from some elements become optional;
  properties present with differing types union. `[{color:"red"},{price:1}]` →
  `{color?: string; price?: number}`; `[{x:1},{x:null}]` → `{x: number | null}`.
- **Path validation:** dataset name must exist; each segment walks the shape —
  unknown property is an error, `[*]`/index/range on a non-array is an error.
  Performed by the same shared `json-path.ts` parser, so compiler and runtime
  cannot disagree on the grammar.
- **Datum typing:** a bound view's `data` attribute is typed as the path's result
  element type, so `${parent.data.color}` checks and `${parent.data.colour}` is a
  TS2339 — the slice-2 ACTUAL-instance-type approach, reusing the existing
  virtual-file machinery (`__lzconstraints.ts` et al.).
- **Inline JSON syntax:** malformed JSON bodies produce diagnostics mapped to the
  script's source line.

## Error handling

| Failure | Behavior |
|---|---|
| Malformed inline JSON | Compile-time diagnostic (lzx-check + in-browser compile) |
| Unknown `$name` at runtime | Console warning once; binds if the dataset later registers |
| Fetch failure / bad JSON from URL | `onerror` on the dataset; bound views stay empty |
| WebSocket drop | Capped-backoff reconnect + re-subscribe; `onerror` after retries exhausted |
| Wire `error` message | `onerror` on the dataset, message logged |
| Update before first snapshot | Dropped with console warning |
| Malformed/unknown wire message | Logged and skipped |
| `updateData` path resolves nothing | Console warning; no mutation, no event |
| Path matches nothing | Zero clones; not an error |
| LzDataNodeMixin datum | Console error; clone skipped (see bridge guard) |

## Testing

Node tests in `compiler/`, pure functions first (slice-2 pattern):

1. **Evaluator** — parse/evaluate/resolvePointer over the dreem corpus (property
   access, `[*]`, `[0]`, `[0,3,2]`, nested wildcards, relative paths, pointers),
   ported from dreem's documented examples so dialect compatibility is proven.
2. **Shape inference + lzx-check** — inferred types (incl. the unification rules
   above), path validation errors, `parent.data` constraint typing (positive and
   negative).
3. **Reconcile logic** — initial stamp, growth, shrink, destroy-vs-pool per the
   `pooling` attribute, `onclones` firing, nested replication, filter/sort.
4. **Protocol** — message round-trips against a mock socket; snapshot-on-subscribe,
   update-before-snapshot dropping, reconnect/re-subscribe.
5. **Byte-parity guard** — existing oracle tests pass untouched.
6. **Examples as living demos** — bikeshop (inline + updateData button, porting
   dreem2's `dataset_example2`) and live sensors against the node relay.

## Phasing (each lands green before the next)

1. **1a** Evaluator + dual build artifacts (pure, node-testable).
   **1b** Inline datasets + compiler routing + replication + constraints.
2. Fetch source + `setData`/`updateData`
3. lzx-check typing (shape inference, path validation, typed `data`)
4. WS source + wire protocol + node relay example
5. Filter/sort
6. LzDataElement bridge

## Future work (explicitly out of this slice)

Outbound `update` publishing (two-way sync), socket multiplexing/unsubscribe,
device SDK examples in-repo, fine-grained per-clone updates keyed by pointer
path, lazy replication for large arrays, dynamic datapath changes, `.lzx`
authoring support, and the wider dreem2 backlog (compositions, RPC proxies,
multi-screen, visual editor).
