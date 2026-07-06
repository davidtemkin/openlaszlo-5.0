import { test } from "node:test";
import assert from "node:assert/strict";
import { SrvNode } from "../../server/srvnode.mjs";

const CLOCK = {
  name: "clock",
  attrs: [{ name: "seconds", tsType: "number", declKind: "number" }],
  // bodies here are TRANSPILED JS (the bus transpiles; unit tests hand JS in)
  methods: [
    { name: "reset", args: ["to"], code: "this.setAttribute('seconds', to); return 'ok';" },
    { name: "later", args: [], code: "return Promise.resolve(42);" },
  ],
  handlers: [
    { name: "oninit", args: [], code: "this.inited = true;" },
    { name: "onseconds", args: ["v"], code: "this.last = v;" },
  ],
};
const make = (deltas) => new SrvNode(CLOCK, { defaults: { seconds: "0" }, onDelta: (t, a, v) => deltas.push([t, a, v]) });

test("defaults coerced by declKind; oninit fires on init()", () => {
  const d = [];
  const n = make(d);
  assert.equal(n.seconds, 0);           // "0" -> number 0
  assert.equal(n.inited, undefined);
  n.init();
  assert.equal(n.inited, true);
  assert.deepEqual(d, []);              // init does not broadcast
});

test("setAttribute: applies, fires on<attr> handler BEFORE delta hook", () => {
  const d = [];
  const n = make(d);
  n.setAttribute("seconds", 5);
  assert.equal(n.seconds, 5);
  assert.equal(n.last, 5);              // handler saw it
  assert.deepEqual(d, [["clock", "seconds", 5]]);
});

test("JSON guard: non-serializable value throws at the call site", () => {
  const n = make([]);
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => n.setAttribute("seconds", cyc), /JSON|circular/i);
});

test("callMethod: sync result, Promise result, unknown method", () => {
  const n = make([]);
  assert.equal(n.callMethod("reset", [9]), "ok");
  assert.equal(n.seconds, 9);
  return n.callMethod("later", []).then((v) => assert.equal(v, 42))
    .then(() => { assert.ok(!n.hasMethod("nope")); });
});

test("snapshot reflects current attrs only (declared)", () => {
  const n = make([]);
  n.setAttribute("seconds", 3);
  assert.deepEqual(n.snapshot(), { seconds: 3 });
});
