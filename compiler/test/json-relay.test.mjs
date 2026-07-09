import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { attachUpgradeDispatcher } from "../../server/connection.mjs";
import { dataUpgradeHandler, _resetForTests } from "../../server/data-relay.mjs";
import { wsClient } from "./helpers/wsclient.mjs";

async function rig() {
  _resetForTests();
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, { "/api/data": dataUpgradeHandler });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

test("subscribe before publish: null snapshot, then live snapshot + updates flow", async () => {
  const { server, port } = await rig();
  const sub = wsClient(port, "/api/data");
  await sub.ready;
  sub.send({ lz: 1, subscribe: "sensors" });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: null });

  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "sensors", data: { temp: 20 } });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: { temp: 20 } });
  pub.send({ dataset: "sensors", update: { path: "/temp", value: 22.4 } });
  assert.deepEqual(await sub.next(), { dataset: "sensors", update: { path: "/temp", value: 22.4 } });

  sub.close(); pub.close(); server.close();
});

test("late subscriber gets the RETAINED snapshot with updates applied", async () => {
  const { server, port } = await rig();
  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "sensors", data: { temp: 20 } });
  pub.send({ dataset: "sensors", update: { path: "/temp", value: 25 } });
  await new Promise((r) => setTimeout(r, 50));

  const sub = wsClient(port, "/api/data");
  await sub.ready;
  sub.send({ lz: 1, subscribe: "sensors" });
  assert.deepEqual(await sub.next(), { dataset: "sensors", data: { temp: 25 } });
  sub.close(); pub.close(); server.close();
});

test("bad pointer errors the sender only; unknown version rejected; malformed skipped", async () => {
  const { server, port } = await rig();
  const pub = wsClient(port, "/api/data");
  await pub.ready;
  pub.send({ dataset: "s", data: { x: 1 } });
  pub.send({ dataset: "s", update: { path: "/nope/deep", value: 2 } });
  const err = await pub.next();
  assert.equal(err.dataset, "s");
  assert.match(err.error, /resolves nothing/);

  pub.send({ lz: 99, subscribe: "s" });
  assert.match((await pub.next()).error, /version/);

  pub.send({ what: "ever" });                       // skipped, socket alive
  pub.send({ lz: 1, subscribe: "s" });
  assert.deepEqual(await pub.next(), { dataset: "s", data: { x: 1 } });
  pub.close(); server.close();
});
