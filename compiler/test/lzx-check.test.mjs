import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("clean fixture: zero findings, bodies counted", () => {
  const r = checkApp(read("check-clean.html"), "check-clean.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
  assert.equal(r.bodiesChecked, 2);
  assert.equal(r.skippedLzs, 0);
});

test("errors fixture: bodies, literals, refs, constraints — all mapped to source lines", () => {
  const src = read("check-errors.html");
  const r = checkApp(src, "check-errors.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find((f) => f.line === at(needle));
  // the spec's body triple
  const wrongType = find("setAttribute('count', 'oops')");
  assert.ok(wrongType, "wrong-typed setAttribute not found: " + JSON.stringify(r.findings, null, 1));
  assert.equal(wrongType.code, 2345);
  const misspelled = find("this.cuont");
  assert.ok(misspelled, "misspelled member not found");
  assert.ok([2339, 2551].includes(misspelled.code));
  assert.ok(r.findings.some((f) => f.message.includes("toUpperCase")), "bad handler-arg use not found");
  // markup literals + refs
  assert.ok(r.findings.some((f) => f.message.includes('height="12px"')));
  assert.ok(r.findings.some((f) => f.message.includes('visible="maybe"')));
  assert.ok(r.findings.some((f) => f.message.includes("notacolor")));
  assert.ok(r.findings.some((f) => f.message.includes('duplicate id "dup"')));
  // constraints: typed-member error + bare-unknown error; bare OWNER member suppressed
  assert.ok(r.findings.some((f) => f.message.includes("nosuchthing")));
  assert.ok(r.findings.some((f) => f.message.includes("'wat'")));
  assert.ok(!r.findings.some((f) => f.message.includes("'width'")), "with(this)-legal bare width must be suppressed");
  assert.equal(r.constraintsChecked, 3);
});

test(".lzx dialect: markup/constraints validated, ES4 bodies skipped", () => {
  const r = checkApp(read("check-errors.lzx"), "check-errors.lzx");
  assert.ok(r.findings.some((f) => f.message.includes('width="oops"')));
  assert.ok(r.findings.some((f) => f.message.includes("'nope'")));  // constraint bare unknown
  assert.equal(r.bodiesChecked, 0);
  assert.equal(r.skippedLzs, 1);
});

test("lzs carriers are skipped, not failed", () => {
  const r = checkApp('<laszlo-app><view><handler name="onclick"><script type="text/lzs">if (this is LzView) x();</script></handler></view></laszlo-app>', "x.html");
  assert.equal(r.skippedLzs, 1);
  assert.equal(r.findings.length, 0);
});

test("invalid names surface as findings instead of corrupting the check", () => {
  const r = checkApp('<laszlo-app><view id="my-id"><attribute name="constructor"></attribute><handler name="onclick"><script type="text/typescript">return 1;</script></handler></view></laszlo-app>', "x.html");
  assert.equal(r.findings.filter((f) => f.element === "(name validation)").length, 2);
  // the body still checks (and is clean) despite the rejected declarations
  assert.equal(r.bodiesChecked, 1);
});
