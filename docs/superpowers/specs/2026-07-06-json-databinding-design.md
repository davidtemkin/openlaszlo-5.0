# JSON Databinding — Design

**Date:** 2026-07-06
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
- Recursive descent (`..`) and standard Goessner `$.a.b` syntax — dreem dialect only.
- Server framework / RPC / device SDKs. The wire protocol is specified so any peer
  can conform; only the browser client and a reference node relay ship here.
- Lazy/resize replication variants; fine-grained (per-clone) update propagation.

## Decisions (settled during brainstorming)

1. **Data model:** both layers — raw JS datums as the primary surface, plus an
   opt-in bridge to LzDataElement for existing XPath-bound components.
2. **Path dialect:** dreem slash dialect (`$name/store/book[*]/title`), not
   Goessner JSONPath.
3. **Replication:** OpenLaszlo-style implicit — a multi-match `datapath` on any
   view replicates it. No `<replicator>` tag.
4. **Attribute binding:** each clone gets its datum as a `data` attribute; authors
   bind with the existing constraint system (`text="${this.data.title}"`). No
   `$datapath{…}` syntax.
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
    <lz-text text="${this.data.color}"
             fgcolor="${this.data.price > 20 ? '#999' : '#000'}"/>
  </lz-view>
</laszlo-app>
```

- `type="json"` on the existing `<dataset>` tag routes the subtree to the new
  machinery. Like XML datasets, JSON datasets are source-only (never adopted).
- A `datapath` beginning with `$` uses the JSON dialect; relative paths under a
  JSON-replicated ancestor are also JSON-dialect. All other datapaths flow to the
  LFC XPath stack unchanged.
- Live/fetched datasets may declare a shape for typing:
  `<script type="application/lz-shape">{ temp: number, readings: number[] }</script>`.

## Path dialect

Grammar (dreem-compatible):

```
path       := absolute | relative
absolute   := "$" name segments?         // $bikeshop, $bikeshop/bicycle[*]
relative   := segments                   // /subgenres[*]/name
segments   := ("/" property selector*)+
selector   := "[*]"                      // every element of an array
            | "[" int "]"                // index
            | "[" int "," int ("," int)? "]"   // start,end(,step) range
            | "[@]"                      // filterfunction hook (phase 5)
pointer    := ("/" (property | int))+    // updateData/wire addressing; no selectors
```

Evaluation returns the array of matches. Wildcards/ranges fan out; plain segments
select one property. `updateData` and wire `update.path` accept only pointer paths.

## Architecture

Three code locations, one shared core:

1. **`compiler/src/json-path.ts`** — parser + evaluator + pointer resolver as pure
   functions. Single source of truth with two consumers: bundled into
   `lzc-browser.js` for compile-time validation, and emitted by a build step as a
   standalone runtime artifact (no compiler in the browser runtime).
2. **`startup/lz-json-data.js`** — runtime patch module, loaded like
   `lz-adopt-patch.js` (after LFC, before app JS). Contains the `JsonDataset`
   registry, the three sources, the mutation API, and the replication manager.
3. **Compiler extensions** — `domsource.ts` recognizes `type="json"` datasets and
   JSON script bodies; compiled output keeps `$`-datapaths away from the LFC XPath
   parser; `app-model.ts` + `lzx-check.ts` gain JSON shape inference and typed
   `data` (see Typing).

`runtime/lfc-src` is not touched. `data` is an ordinary attribute, so the frozen
constraint system re-evaluates `${this.data.*}` bindings on `setAttribute('data', …)`
with zero modification.

## Runtime components

### JsonDataset

Registered by name in a window-level registry. Holds the raw parsed value as
`data`; fires `ondata` on change, `onerror` on failure.

Sources (all just callers of the same two entry points):
- **Inline** — parsed at compile time; malformed JSON is a compile-time error.
- **Fetch** — `src` with http(s)/relative URL; `setData(parsed)` on arrival.
- **Live** — `src` with ws(s) URL; speaks the wire protocol; reconnects with
  capped backoff and re-subscribes.

Mutation API (the only mutation primitives):
- `setData(value)` — replace the whole value, fire `ondata`.
- `updateData(pointerPath, value)` — resolve pointer, mutate in place, fire `ondata`.

Bridge: `toLzDataset(name?, {live}?)` converts the current value via the frozen
`LzDataElement.__LZv2E()` into a real LzDataset for XPath-bound components.
One-shot by default; `live: true` re-converts on every `ondata`. One-directional —
edits to the converted tree do not flow back.

### Wire protocol

JSON Lines over WebSocket. Four message shapes:

```
client → server:  {"lz": 1, "subscribe": "sensors"}
server → client:  {"dataset": "sensors", "data": {…}}                              // full snapshot
server → client:  {"dataset": "sensors", "update": {"path": "/temp", "value": 22.4}}
client → server:  {"dataset": "sensors", "update": {…}}   // outbound; shape reserved, NOT sent in this slice
```

No JSONPath on the wire: peers address with pointer paths only, so a conforming
peer needs a socket and a JSON encoder. A ~40-line node relay ships in `examples/`
as the reference server; a micropython peer sketch is documentation:

```python
import usocket, ujson  # ~15 lines total with a ws handshake helper
ws.send(ujson.dumps({"dataset": "sensors",
                     "update": {"path": "/temp", "value": read_temp()}}))
```

Unknown or malformed messages are logged and skipped — a misbehaving peer cannot
wedge the app.

### Replication

At instantiation time the runtime intercepts views whose compiled datapath is
JSON-dialect. Instead of one view it creates a lightweight replication manager:

1. Evaluate the path against the dataset → N matches.
2. Instantiate N clones of the authored template into the parent; set each clone's
   `data` (and `clonenumber`) attributes.
3. On `ondata`: re-evaluate, then reconcile **pooling by index** (dreem2's model):
   reuse existing clones via `setAttribute('data', newDatum)`, create the
   shortfall, destroy — or hide, when `pooling="true"` — the surplus.

Zero matches → zero clones (not an error). A non-wildcard path with exactly one
match binds the single view without cloning, mirroring classic datapath behavior.

Relative paths nest: `<lz-view datapath="/subgenres[*]">` inside a clone evaluates
against that clone's datum (dreem's genres example).

Filter/sort (phase 5): a `filterfunction(obj, accum)` method hook via `[@]`, and
`sortfield` / `sortasc` attributes, applied between evaluate and reconcile.

### End-to-end change propagation

device `update` → `updateData` mutates + fires `ondata` → replication managers
re-evaluate and reconcile → surviving clones get `setAttribute('data', datum)` →
the LFC constraint system re-runs `${this.data.*}` bindings. The frozen machinery
does the last mile unmodified.

## Compile-time typing (lzx-check)

- **Shape acquisition:** inline datasets infer a TS type from the JSON literal
  (array element shapes unify; `null` widens to `| null`). Fetched/live datasets
  use the optional `application/lz-shape` declaration; absent that, the dataset
  types as `any` with a lint note (not an error).
- **Path validation:** dataset name must exist; each segment walks the shape —
  unknown property is an error, `[*]`/index/range on a non-array is an error.
  Performed by the same shared `json-path.ts` parser, so compiler and runtime
  cannot disagree on the grammar.
- **Datum typing:** a replicated view's `data` attribute is typed as the path's
  result element type, so `${this.data.color}` checks and `${this.data.colour}`
  is a TS2339 — the slice-2 ACTUAL-instance-type approach, reusing the existing
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
| Malformed/unknown wire message | Logged and skipped |
| `updateData` path resolves nothing | Console warning; no mutation, no event |
| Path matches nothing | Zero clones; not an error |

## Testing

Node tests in `compiler/`, pure functions first (slice-2 pattern):

1. **Evaluator** — parse/evaluate/resolvePointer over the dreem corpus (property
   access, `[*]`, `[0]`, `[0,3,2]`, nested wildcards, relative paths, pointers),
   ported from dreem's documented examples so dialect compatibility is proven.
2. **Shape inference + lzx-check** — inferred types, path validation errors,
   `this.data` constraint typing (positive and negative).
3. **Reconcile logic** — initial stamp, growth, shrink, pooled datum swap, nested
   replication, filter/sort.
4. **Protocol** — message round-trips against a mock socket; reconnect/re-subscribe.
5. **Byte-parity guard** — existing oracle tests pass untouched.
6. **Examples as living demos** — bikeshop (inline + updateData button, porting
   dreem2's `dataset_example2`) and live sensors against the node relay.

## Phasing (each lands green before the next)

1. Evaluator + inline datasets + replication + `${this.data.*}` constraints
2. Fetch source + `setData`/`updateData`
3. lzx-check typing (shape inference, path validation, typed `data`)
4. WS source + wire protocol + node relay example
5. Filter/sort
6. LzDataElement bridge

## Future work (explicitly out of this slice)

Outbound `update` publishing (two-way sync), device SDK examples in-repo,
fine-grained per-clone updates keyed by pointer path, lazy replication for large
arrays, `.lzx` authoring support, and the wider dreem2 backlog (compositions,
RPC proxies, multi-screen, visual editor).
