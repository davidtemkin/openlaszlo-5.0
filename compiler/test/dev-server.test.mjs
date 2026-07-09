import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseServerArgs, createDevServer } from "../../server/index.mjs";
import { wsClient } from "./helpers/wsclient.mjs";

const get = (port, path, headers = {}) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port, path, headers, agent: false }, (r) => {   // agent:false — no keep-alive sockets to hang close()
    let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on("error", rej);
});

test("parseServerArgs: flags anywhere, first non-flag is the port", () => {
  assert.deepEqual(parseServerArgs([]), { port: 8090, reload: true });
  assert.deepEqual(parseServerArgs(["9000"]), { port: 9000, reload: true });
  assert.deepEqual(parseServerArgs(["--no-reload", "9000"]), { port: 9000, reload: false });
  assert.deepEqual(parseServerArgs(["9000", "--no-reload"]), { port: 9000, reload: false });
});

test("createDevServer boots on port 0 and serves the Explorer index", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    assert.ok(srv.port > 0);
    const r = await get(srv.port, "/");
    assert.equal(r.status, 200);
    assert.match(r.body, /__OL_COMPILE="server"/);
  } finally { await srv.close(); }
});

test("dev-reload endpoint answers hello over a real socket", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    const ws = wsClient(srv.port, "/api/dev-reload");
    await ws.ready;
    const hello = await ws.next();
    assert.equal(hello.op, "hello");
    assert.ok(hello.bootId);
    ws.close();
  } finally { await srv.close(); }
});

test("--no-reload leaves the endpoint unregistered", async () => {
  const srv = await createDevServer({ port: 0, reload: false });
  try {
    const ws = wsClient(srv.port, "/api/dev-reload");
    await assert.rejects(ws.ready);       // dispatcher destroys unclaimed paths
  } finally { await srv.close(); }
});

test("wrapper, static html, and editor pages carry the reload client; index keeps __OL_COMPILE", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    const idx = await get(srv.port, "/");
    assert.match(idx.body, /__OL_COMPILE="server"/);
    assert.match(idx.body, /dev-reload-client\.js/);
    const wrap = await get(srv.port, "/examples/calendar/calendar.lzx", { accept: "text/html" });
    assert.match(wrap.body, /dev-reload-client\.js/);
    const ed = await get(srv.port, "/examples/calendar/calendar.lzx?edit", { accept: "text/html" });
    assert.match(ed.body, /dev-reload-client\.js/);
  } finally { await srv.close(); }
});

test("--no-reload injects nothing", async () => {
  const srv = await createDevServer({ port: 0, reload: false });
  try {
    const wrap = await get(srv.port, "/examples/calendar/calendar.lzx", { accept: "text/html" });
    assert.doesNotMatch(wrap.body, /dev-reload-client\.js/);
  } finally { await srv.close(); }
});

test("injected static html gets a distinct etag (no stale 304 from pre-injection caches)", async () => {
  const srv = await createDevServer({ port: 0 });
  try {
    const one = await get(srv.port, "/examples/dom-authoring/file-demo.html");
    assert.match(one.body, /dev-reload-client\.js/);
    assert.match(one.headers.etag || "", /-r"$/);
    const not = await get(srv.port, "/examples/dom-authoring/file-demo.html", { "if-none-match": one.headers.etag });
    assert.equal(not.status, 304);
  } finally { await srv.close(); }
});

test("reload client file serves from /startup/", async () => {
  const srv = await createDevServer({ port: 0 });
  try { assert.equal((await get(srv.port, "/startup/dev-reload-client.js")).status, 200); }
  finally { await srv.close(); }
});
