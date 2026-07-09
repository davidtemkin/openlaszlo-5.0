import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../server/index.mjs";
import { wsClient } from "./helpers/wsclient.mjs";

const DISTRO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = path.join(DISTRO, "examples/.tmp-reload");
const APP = "/examples/.tmp-reload/app.lzx";
const INC = path.join(FIX, "inc.lzx");

const get = (port, p, headers = {}) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port, path: p, headers, agent: false }, (r) => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on("error", rej);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let srv;
before(async () => {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(INC, `<library><class name="tmphello" extends="text"/></library>`);
  fs.writeFileSync(path.join(FIX, "app.lzx"),
    `<canvas width="100" height="100"><include href="inc.lzx"/><tmphello text="hi"/></canvas>`);
  srv = await createDevServer({ port: 0 });
});
after(async () => { await srv.close(); fs.rmSync(FIX, { recursive: true, force: true }); });

async function watched(appPath, loadedAt = Date.now()) {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready;
  assert.equal((await ws.next()).op, "hello");
  ws.send({ op: "watch", app: appPath, loadedAt });
  return ws;
}

test("closure include: compile first, then watch, then edit include → changed", async () => {
  const r = await get(srv.port, APP + ".js");              // compile → noteClosure (pre-watch!)
  assert.equal(r.status, 200);
  const ws = await watched(APP);
  await sleep(700);                                        // let a baseline sweep pass
  fs.appendFileSync(INC, "<!-- edit -->");
  const msg = await ws.next();                             // ~1-1.5s: busy sweep + quiet sweep
  assert.equal(msg.op, "changed");
  assert.ok(msg.paths.some(p => p.endsWith("inc.lzx")));
  ws.close();
});

test("watch outside root refused with error frame", async () => {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready; await ws.next();                          // hello
  ws.send({ op: "watch", app: "/../../etc/passwd", loadedAt: 0 });
  const msg = await ws.next();
  assert.equal(msg.op, "error");
  ws.close();
});

test("stale loadedAt gets immediate changed", async () => {
  const ws = wsClient(srv.port, "/api/dev-reload");
  await ws.ready; await ws.next();
  ws.send({ op: "watch", app: APP, loadedAt: 1 });          // loaded before the file existed
  const msg = await ws.next();
  assert.equal(msg.op, "changed");
  ws.close();
});

test("referer-tracked source fetch joins a DOM-authored page's set; denylisted does not; 304 registers", async () => {
  // A DOM-authored page (no compile closure!) — the referer path must do ALL the work here.
  const PAGE = "/examples/.tmp-reload/page.html";
  fs.writeFileSync(path.join(FIX, "page.html"), "<html><head></head><body>x</body></html>");
  fs.writeFileSync(path.join(FIX, "code.ts"), "export const x: number = 1;");
  const ws = await watched(PAGE);
  const referer = `http://127.0.0.1:${srv.port}${PAGE}`;
  const first = await get(srv.port, "/examples/.tmp-reload/code.ts", { referer });   // 200 → joins
  await get(srv.port, "/runtime/lfc/lfc.js", { referer });                            // denylisted → no
  assert.ok(srv.hub.watchedFiles(PAGE).some(f => f.endsWith("code.ts")));
  assert.ok(!srv.hub.watchedFiles(PAGE).some(f => f.includes("runtime")));
  // 304 registers too: re-fetch with the validator on a SECOND page's set
  const PAGE2 = "/examples/.tmp-reload/page2.html";
  fs.writeFileSync(path.join(FIX, "page2.html"), "<html><head></head><body>y</body></html>");
  const ws2 = await watched(PAGE2);
  const etag = first.headers.etag;
  const not = await get(srv.port, "/examples/.tmp-reload/code.ts",
    { referer: `http://127.0.0.1:${srv.port}${PAGE2}`, "if-none-match": etag });
  assert.equal(not.status, 304);
  assert.ok(srv.hub.watchedFiles(PAGE2).some(f => f.endsWith("code.ts")), "304 joined the set");
  ws.close(); ws2.close();
});

test("bootId is stable across connections to one server instance", async () => {
  const a = wsClient(srv.port, "/api/dev-reload"); await a.ready;
  const b = wsClient(srv.port, "/api/dev-reload"); await b.ready;
  const ha = await a.next(), hb = await b.next();
  assert.equal(ha.op, "hello"); assert.equal(ha.bootId, hb.bootId);
  a.close(); b.close();
});
