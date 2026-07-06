import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const read = (f) => readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8");

test("bus checker: client + server surfaces, program isolation", () => {
  const src = read("bus-check-errors.html");
  const r = checkApp(src, "bus-check-errors.html");
  const msgs = r.findings.map((f) => f.code + ":" + f.message).join("\n");
  // reserved identifier
  assert.ok(msgs.includes('id "server" is reserved'), msgs);
  // client: wrong-typed set on the typed proxy
  assert.ok(r.findings.some((f) => f.code === 2345 && f.message.includes("'number'")), msgs);
  // client: setInterval must NOT be legal in client bodies (program isolation)
  assert.ok(r.findings.some((f) => f.code === 2304 && f.message.includes("setInterval")), msgs);
  // client constraint: server.state.count typechecks (no finding), nope doesn't
  assert.ok(r.findings.some((f) => f.message.includes("nope")), msgs);
  assert.ok(!msgs.includes("'count'"), "count must typecheck: " + msgs);
  // server body: misspelled setAttribute name is a finding
  assert.ok(r.findings.some((f) => f.message.includes("cuont")), msgs);
  // server body: canvas must NOT be visible (isolation, reverse direction)
  assert.ok(r.findings.some((f) => f.code === 2304 && f.message.includes("canvas")), msgs);
  assert.equal(r.serverBodiesChecked, 2);
});

test("bus checker: clean bus fixture has zero findings", () => {
  const r = checkApp(read("bus-app.html"), "bus-app.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
  assert.equal(r.serverBodiesChecked, 3); // bump, boom, slow; no handlers
});
