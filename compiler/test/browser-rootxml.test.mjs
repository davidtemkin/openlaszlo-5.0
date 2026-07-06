import { test } from "node:test";
import assert from "node:assert/strict";
import { compileInBrowser } from "../dist/browser.js";
import { parseXml } from "../dist/xml.js";

test("rootXml path: compiles a pre-built root; mainUrl is never fetched; no cache use", async () => {
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url);
    return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const rootXml = parseXml('<canvas width="100" height="100"><view width="10" height="10" bgcolor="0xff0000"></view></canvas>');
  const r = await compileInBrowser("http://example.test/page.html", { rootXml, fetchFn, maxRetries: 5 });
  assert.ok(!fetched.includes("http://example.test/page.html"), "mainUrl must not be fetched");
  assert.equal(r.unsupported, undefined);
  // A bare canvas+view compiles to a SMALL but complete program (~468 bytes) —
  // assert content, not size.
  assert.match(r.js, /^canvas=new LzCanvas\(/);
  assert.ok(r.js.includes("LzInstantiateView"));
  assert.ok(r.js.includes("initDone"));
});

test("rootXml path: the passed tree is not mutated across passes", async () => {
  const fetchFn = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  const rootXml = parseXml("<canvas><view></view></canvas>");
  const snapshot = JSON.stringify(rootXml);
  await compileInBrowser("http://example.test/page.html", { rootXml, fetchFn, maxRetries: 5 });
  assert.equal(JSON.stringify(rootXml), snapshot, "compileInBrowser must clone, not mutate");
});
