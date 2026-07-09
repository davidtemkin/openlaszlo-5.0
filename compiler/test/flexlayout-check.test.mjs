import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("flexlayout enums + hints: violations are findings, clean usage is not", () => {
  const src = read("flex-check.html");
  const r = checkApp(src, "flex-check.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const find = (needle) => r.findings.find((f) => f.line === at(needle));
  assert.ok(find('flexdirection="rows"'), "bad enum value should be a finding: " + JSON.stringify(r.findings));
  assert.ok(find('flex="x"'), "non-numeric hint should be a finding");
  assert.ok(!find('flexdirection="row-reverse"'), "good enum flagged");
  assert.ok(!find('flex="1"'), "good hint flagged");
  assert.ok(!find('alignself="center"'), "good alignself flagged");
});

test("setAttribute('flex', …) typechecks on views; clean fixture has zero findings", () => {
  const r = checkApp(read("flex-check-clean.html"), "flex-check-clean.html");
  assert.deepEqual(r.findings.map((f) => f.message), []);
});
