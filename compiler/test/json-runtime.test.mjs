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
