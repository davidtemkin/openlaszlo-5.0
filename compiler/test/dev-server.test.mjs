import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseServerArgs, createDevServer } from "../../server/index.mjs";

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
