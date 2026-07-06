import { test } from "node:test";
import assert from "node:assert/strict";
import { installJsonRuntime } from "../dist/json-runtime.js";

export function makeHost(over = {}) {
  const warnings = [];
  return {
    warnings,
    lzNodeProto: {},
    warn: (m) => warnings.push(m),
    setTimeoutFn: (cb) => { cb(); },   // immediate for tests
    ...over,
  };
}

test("register inline: data ready immediately; ondata fires on setData/updateData", () => {
  const jd = installJsonRuntime(makeHost());
  const ds = jd.register("b", { json: { list: [1, 2] } });
  assert.equal(ds.ready, true);
  const seen = [];
  ds.onData(() => seen.push(structuredClone(ds.data)));
  ds.updateData("/list/0", 9);
  assert.deepEqual(ds.data.list, [9, 2]);
  ds.setData({ list: [] });
  assert.equal(seen.length, 2);
});

test("updateData: unresolvable pointer warns, no mutation, no event", () => {
  const host = makeHost();
  const jd = installJsonRuntime(host);
  const ds = jd.register("b", { json: { x: 1 } });
  let fired = 0;
  ds.onData(() => fired++);
  assert.equal(ds.updateData("/nope/deep", 5), false);
  assert.equal(fired, 0);
  assert.equal(host.warnings.length, 1);
});

test("whenRegistered: fires immediately when present, later on register", () => {
  const jd = installJsonRuntime(makeHost());
  const order = [];
  jd.whenRegistered("later", () => order.push("later"));
  jd.register("now", { json: 1 });
  jd.whenRegistered("now", () => order.push("now"));
  jd.register("later", { json: 2 });
  assert.deepEqual(order, ["now", "later"]);
});

// ── replication harness: a minimal LzNode-ish fake that MODELS THE QUEUE ──
// The real LFC idle-queues instantiation: createChildren enqueues; the
// instantiator later calls parent.makeChild(spec, true) per spec; makeChild
// constructs synchronously and RETURNS the node. Mirroring that here pins the
// contract the runtime actually relies on — a synchronous fake would pass with
// broken scan-based tracking.
export function makeFakeLfc() {
  const queue = [];
  const proto = {
    makeChild(e, _async) {
      const node = { __proto__: proto, __LZdeleted: false, destroyed: false, subnodes: [], immediateparent: this };
      for (const [k, v] of Object.entries(e.attrs ?? {})) node[k] = v;
      node.setAttribute = function (n, v) { this[n] = v; (this.sets ??= []).push([n, v]); };
      node.destroy = function () { this.destroyed = true; this.__LZdeleted = true; this.immediateparent.subnodes = this.immediateparent.subnodes.filter((s) => s !== this); };
      this.subnodes.push(node);
      for (const c of e.children ?? []) node.makeChild(c, true); // subtree: same funnel, sync (createImmediate-like)
      return node;
    },
    createChildren(carr) { for (const spec of carr ?? []) queue.push([this, spec]); }, // idle-queued
  };
  const root = { __proto__: proto, __LZdeleted: false, subnodes: [], immediateparent: null };
  root.setAttribute = function (n, v) { this[n] = v; };
  const drain = () => { while (queue.length) { const [parent, spec] = queue.shift(); parent.makeChild(spec, true); } };
  return { proto, root, drain };
}

test("replication: nothing before the queue drains; N tracked clones after (makeChild return values)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  jd.register("b", { json: { bicycle: [{ color: "red" }, { color: "green" }] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/bicycle[*]", height: 20 } }]);
  assert.equal(root.subnodes.length, 0);          // queued, not instantiated — the real-LFC contract
  drain();
  assert.equal(root.subnodes.length, 2);
  assert.equal(root.subnodes[0].cloneManager.clones.length, 2); // tracked via return values, no scan
  assert.deepEqual(root.subnodes.map((n) => n.data.color), ["red", "green"]);
  assert.deepEqual(root.subnodes.map((n) => n.clonenumber), [0, 1]);
  assert.equal(root.subnodes[0].jsondatapath, undefined);
  assert.equal(root.subnodes[0].height, 20);
});

test("canvas-level bound view: diverted at makeChild directly (the LzInstantiator call shape)", () => {
  const { proto, root } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { l: ["x", "y"] } });
  const ret = root.makeChild({ class: "view", attrs: { jsondatapath: "$b/l[*]" } }, true);
  assert.equal(ret, null);                        // diverted spec constructs no view itself
  assert.equal(root.subnodes.length, 2);          // …but its clones do, synchronously via origMakeChild
  assert.deepEqual(root.subnodes.map((n) => n.data), ["x", "y"]);
});

test("reconcile default: destroy + recreate on ondata; zero matches → zero clones", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: [1, 2, 3] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]" } }]);
  drain();
  const first = [...root.subnodes];
  ds.setData({ l: [7] });
  assert.ok(first.every((n) => n.destroyed));
  assert.equal(root.subnodes.length, 1);
  assert.equal(root.subnodes[0].data, 7);
  ds.setData({ l: [] });
  assert.equal(root.subnodes.length, 0);
});

test("reconcile pooling=true: reuse by index, hide surplus, grow shortfall", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: ["a", "b", "c"] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]", pooling: true } }]);
  drain();
  const first = [...root.subnodes];
  ds.setData({ l: ["x"] });
  assert.equal(first[0].destroyed, false);
  assert.equal(first[0].data, "x");
  assert.equal(first[1].visible, false);          // hidden, not destroyed
  ds.setData({ l: ["p", "q", "r", "s"] });
  assert.equal(root.subnodes.filter((n) => n.visible !== false).length, 4);
  assert.equal(first[1].visible, true);            // resurrected from the pool
});

test("relative path binds against nearest ancestor datum (nested replication)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("g", { json: { genres: [{ name: "jazz", sub: ["cool", "free"] }] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$g/genres[*]" },
    children: [{ class: "view", attrs: { jsondatapath: "/sub[*]" } }] }]);
  drain();
  const outer = root.subnodes[0];
  assert.deepEqual(outer.subnodes.map((n) => n.data), ["cool", "free"]);
});

test("single non-fanout match binds one view; unknown dataset warns then binds on register", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$late/title" } }]);
  drain();
  assert.equal(root.subnodes.length, 0);
  assert.equal(host.warnings.length, 1);
  jd.register("late", { json: { title: "hi" } });
  assert.equal(root.subnodes.length, 1);
  assert.equal(root.subnodes[0].data, "hi");
});

test("onclones fires on the parent when an event exists; destroyed parent unbinds", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  const ds = jd.register("b", { json: { l: [1] } });
  const clonesSeen = [];
  root.onclones = { sendEvent: (c) => clonesSeen.push(c.length) };
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*]" } }]);
  drain();
  assert.deepEqual(clonesSeen, [1]);
  root.__LZdeleted = true;
  ds.setData({ l: [1, 2] });
  assert.deepEqual(clonesSeen, [1]);              // no refresh after parent death
});

// ── LzDataElement bridge (Task 12) ─────────────────────────────────────────

function makeBridgeGlobals() {
  const made = [];
  class FakeLDE { constructor() { this.appendChild = () => {}; this.ownerDocument = {}; } }
  FakeLDE.__LZv2E = (v) => [{ converted: structuredClone(v) }];
  class FakeDataset { constructor(parent, attrs) { this.attrs = attrs; made.push(this); }
    setChildNodes(kids) { this.kids = kids; } }
  return { made, globals: { canvas: {}, lz: { dataset: FakeDataset }, LzDataElement: FakeLDE } };
}

test("toLzDataset: one-shot converts via __LZv2E; live re-converts on ondata", () => {
  const b = makeBridgeGlobals();
  const jd = installJsonRuntime(makeHost({ globals: b.globals }));
  const ds = jd.register("b", { json: { x: 1 } });
  const xml = ds.toLzDataset("b_xml");
  assert.equal(b.made.length, 1);
  assert.equal(xml.attrs.name, "b_xml");
  assert.deepEqual(xml.kids[0].converted, { x: 1 });
  ds.setData({ x: 2 });
  assert.deepEqual(xml.kids[0].converted, { x: 1 });   // one-shot: unchanged

  const live = ds.toLzDataset(undefined, { live: true });
  assert.equal(live.attrs.name, "b_xml");              // default name = "<name>_xml"
  ds.setData({ x: 3 });
  assert.deepEqual(live.kids[0].converted, { x: 3 });
});

test("toLzDataset without LFC globals throws a clear error", () => {
  const jd = installJsonRuntime(makeHost());
  const ds = jd.register("b", { json: 1 });
  assert.throws(() => ds.toLzDataset(), /LFC/);
});

// ── filter + sort (Task 11) ────────────────────────────────────────────────

test("[@] filter: parent-hosted filterfunction accumulates (dreem signature)", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { bicycle: [
    { color: "red", price: 19.95 }, { color: "green", price: 29.95 }, { color: "blue", price: 59.95 } ] } });
  root.filterfunction = function (obj, accum) { if (obj.price > 20) accum.unshift(obj.color); return accum; };
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/bicycle[*][@]" } }]);
  drain();
  assert.deepEqual(root.subnodes.map((n) => n.data), ["blue", "green"]);
});

test("[@] without a parent filterfunction warns and yields zero clones", () => {
  const { proto, root, drain } = makeFakeLfc();
  const host = makeHost({ lzNodeProto: proto });
  const jd = installJsonRuntime(host);
  jd.register("b", { json: { l: [1, 2] } });
  root.createChildren([{ class: "view", attrs: { jsondatapath: "$b/l[*][@]" } }]);
  drain();
  assert.equal(root.subnodes.length, 0);
  assert.ok(host.warnings.some((w) => /filterfunction/.test(w)));
});

test("sortfield/sortasc: numeric sort, descending", () => {
  const { proto, root, drain } = makeFakeLfc();
  const jd = installJsonRuntime(makeHost({ lzNodeProto: proto }));
  jd.register("b", { json: { bicycle: [
    { color: "green", price: 29.95 }, { color: "red", price: 9.95 }, { color: "blue", price: 59.95 } ] } });
  root.createChildren([{ class: "view",
    attrs: { jsondatapath: "$b/bicycle[*]", sortfield: "price", sortasc: "false" } }]);
  drain();
  assert.deepEqual(root.subnodes.map((n) => n.data.color), ["blue", "green", "red"]);
});

// ── live (WebSocket) source ────────────────────────────────────────────────

function makeSocketRig() {
  const sockets = [];
  const makeSocket = (url) => {
    const ws = { url, sent: [], onopen: null, onmessage: null, onclose: null,
      send(s) { this.sent.push(JSON.parse(s)); }, close() {} };
    sockets.push(ws);
    return ws;
  };
  return { sockets, makeSocket, open: (ws) => ws.onopen(), msg: (ws, m) => ws.onmessage({ data: JSON.stringify(m) }) };
}

test("live: subscribe on open; snapshot then updates apply; pre-snapshot updates drop", () => {
  const rig = makeSocketRig();
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: () => {} });
  const ds = installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  const [ws] = rig.sockets;
  rig.open(ws);
  assert.deepEqual(ws.sent, [{ lz: 1, subscribe: "sensors" }]);
  rig.msg(ws, { dataset: "sensors", update: { path: "/temp", value: 1 } });   // before snapshot
  assert.equal(ds.ready, false);
  assert.ok(host.warnings.some((w) => /before snapshot/.test(w)));
  rig.msg(ws, { dataset: "sensors", data: { temp: 20 } });
  rig.msg(ws, { dataset: "sensors", update: { path: "/temp", value: 22.4 } });
  assert.equal(ds.data.temp, 22.4);
});

test("live: null snapshot keeps waiting; wrong-dataset and malformed skipped; error fires onError", () => {
  const rig = makeSocketRig();
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: () => {} });
  const ds = installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  const errs = [];
  ds.onError((m) => errs.push(m));
  const [ws] = rig.sockets;
  rig.open(ws);
  rig.msg(ws, { dataset: "sensors", data: null });
  assert.equal(ds.ready, false);
  rig.msg(ws, { dataset: "other", data: { x: 1 } });
  ws.onmessage({ data: "{not json" });
  assert.equal(ds.ready, false);
  rig.msg(ws, { dataset: "sensors", error: "refused" });
  assert.deepEqual(errs, ["refused"]);
});

test("live: reconnect with backoff, re-subscribe, backoff resets on open", () => {
  const rig = makeSocketRig();
  const delays = [];
  const timers = [];
  const host = makeHost({ makeSocket: rig.makeSocket,
    setTimeoutFn: (cb, ms) => { delays.push(ms); timers.push(cb); } });
  installJsonRuntime(host).register("sensors", { ws: "ws://h/api/data" });
  rig.sockets[0].onclose();                        // drop before ever opening
  assert.deepEqual(delays, [500]);
  timers.shift()();                                // fire reconnect → socket #2
  rig.sockets[1].onclose();
  assert.deepEqual(delays, [500, 1000]);           // doubled
  timers.shift()();
  rig.open(rig.sockets[2]);                        // success resets backoff
  assert.deepEqual(rig.sockets[2].sent, [{ lz: 1, subscribe: "sensors" }]);
  rig.sockets[2].onclose();
  assert.equal(delays[2], 500);
});

test("live: onerror fires ONCE after 8 consecutive failures; retries continue", () => {
  const rig = makeSocketRig();
  const timers = [];
  const host = makeHost({ makeSocket: rig.makeSocket, setTimeoutFn: (cb) => timers.push(cb) });
  const ds = installJsonRuntime(host).register("s", { ws: "ws://h/api/data" });
  const errs = [];
  ds.onError((m) => errs.push(m));
  for (let i = 0; i < 10; i++) { rig.sockets[rig.sockets.length - 1].onclose(); timers.shift()(); }
  assert.equal(errs.length, 1);
  assert.equal(rig.sockets.length, 11);            // still reconnecting after the error
});

test("fetch source: ok sets data; failure fires onError", async () => {
  const okHost = makeHost({ fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ v: 42 }) }) });
  const ds = installJsonRuntime(okHost).register("a", { src: "./a.json" });
  await new Promise((r) => ds.onData(r));
  assert.equal(ds.data.v, 42);

  const errs = [];
  const badHost = makeHost({ fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const ds2 = installJsonRuntime(badHost).register("a", { src: "./a.json" });
  ds2.onError((m) => errs.push(m));
  await new Promise((r) => setImmediate(r));
  assert.equal(errs.length, 1);
  assert.equal(ds2.ready, false);
});
