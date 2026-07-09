import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { attachUpgradeDispatcher, encodeText, decodeFrames, acceptKey } from "../../server/connection.mjs";
import { wsClient, encodeTextMasked } from "./helpers/wsclient.mjs";

test("dispatcher: routes by prefix, destroys unclaimed exactly once", async () => {
  const hits = [];
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, {
    "/api/echo": (req, socket) => {
      hits.push(req.url);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        acceptKey(req.headers["sec-websocket-key"]) + "\r\n\r\n");
      socket.on("data", (chunk) => {
        const { messages } = decodeFrames(chunk);
        for (const m of messages) if (m.text != null) socket.write(encodeText(m.text));
      });
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const c = wsClient(port, "/api/echo?x=1");
  await c.ready;
  c.send({ hi: 1 });
  assert.deepEqual(await c.next(), { hi: 1 });
  assert.deepEqual(hits, ["/api/echo?x=1"]);
  c.close();

  // unclaimed path: connection must be refused (no 101)
  const bad = wsClient(port, "/api/nope");
  await assert.rejects(bad.ready);
  server.close();
});

// ── Task 3: the bus protocol ─────────────────────────────────────────────────

import { busUpgradeHandler } from "../../server/bus.mjs";

async function busServer() {
  const server = http.createServer(() => {});
  attachUpgradeDispatcher(server, { "/api/bus": busUpgradeHandler });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}
const FIXTURE = "compiler/test/fixtures/bus-app.html"; // distro-relative

test("bus: snapshot on connect; set round-trips; delta reaches BOTH clients", async () => {
  const { server, port } = await busServer();
  const a = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await a.ready;
  const snapA = await a.next();
  assert.equal(snapA.op, "snapshot");
  assert.deepEqual(snapA.tags.state, { count: 0, log: "" });

  const b = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await b.ready;
  assert.equal((await b.next()).op, "snapshot");

  a.send({ op: "set", tag: "state", attr: "count", value: 7 });
  const [da, db] = [await a.next(), await b.next()];
  assert.deepEqual(da, { op: "delta", tag: "state", attr: "count", value: 7 }); // sender gets the echo too
  assert.deepEqual(db, da);
  a.close(); b.close(); server.close();
});

test("bus: call (sync, promise, throwing) + declared-surface enforcement", async () => {
  const { server, port } = await busServer();
  const c = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await c.ready; await c.next(); // snapshot (count persists across tests: process-lifetime singleton)
  c.send({ op: "call", tag: "state", method: "bump", args: [5], uid: 1 });
  // bump broadcasts a delta AND returns a result — assert order-independently
  const m1 = await c.next(); const m2 = await c.next();
  const result = [m1, m2].find((m) => m.op === "result");
  const delta = [m1, m2].find((m) => m.op === "delta");
  assert.ok(result && delta);
  assert.equal(result.uid, 1);
  assert.equal(result.value, delta.value);

  c.send({ op: "call", tag: "state", method: "slow", args: [], uid: 2 });
  assert.deepEqual(await c.next(), { op: "result", uid: 2, value: "done" }); // Promise settled

  c.send({ op: "call", tag: "state", method: "boom", args: [], uid: 3 });
  const err = await c.next();
  assert.equal(err.op, "error"); assert.equal(err.uid, 3); assert.match(err.message, /kaboom/);

  c.send({ op: "set", tag: "state", attr: "nope", value: 1 });
  assert.equal((await c.next()).op, "error"); // undeclared attr

  c.send({ op: "call", tag: "state", method: "nope", args: [], uid: 4 });
  assert.equal((await c.next()).op, "error"); // undeclared method
  c.close(); server.close();
});

test("bus: reconnect gets a fresh snapshot with persisted state", async () => {
  const { server, port } = await busServer();
  const a = wsClient(port, `/api/bus?app=${FIXTURE}`);
  await a.ready;
  const before = (await a.next()).tags.state.count;
  a.send({ op: "set", tag: "state", attr: "count", value: before + 1 });
  await a.next(); // delta
  a.close();
  const b = wsClient(port, `/api/bus?app=${FIXTURE}`); // "reconnect"
  await b.ready;
  const snap = await b.next();
  assert.equal(snap.op, "snapshot");
  assert.equal(snap.tags.state.count, before + 1); // persisted, not defaults
  b.close(); server.close();
});

test("bus: unknown app path refused; traversal refused", async () => {
  const { server, port } = await busServer();
  for (const bad of ["nope/missing.html", "../etc/passwd"]) {
    const c = wsClient(port, `/api/bus?app=${bad}`);
    await c.ready; // handshake completes; refusal is an error frame + close
    const e = await c.next();
    assert.equal(e.op, "error");
  }
  server.close();
});
