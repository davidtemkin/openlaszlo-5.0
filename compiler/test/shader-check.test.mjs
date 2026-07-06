import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkApp } from "../dist/lzx-check.js";

const FIX = new URL("./fixtures/", import.meta.url);
const read = (f) => readFileSync(new URL(f, FIX), "utf8");

test("HERO CANARY: the spec's example checks finding-free end-to-end", () => {
  const r = checkApp(read("shader-check-clean.html"), "shader-check-clean.html");
  assert.deepEqual(r.findings.map(f => f.message), []);
  assert.ok(r.shaderBodiesChecked >= 1);
});

test("shader findings map to source lines; client program is untouched both ways", () => {
  const src = read("shader-check.html");
  const r = checkApp(src, "shader-check.html");
  const lines = src.split("\n");
  const at = (needle) => lines.findIndex(l => l.includes(needle)) + 1;
  const findAt = (needle) => r.findings.filter(f => f.line === at(needle));
  const msgs = r.findings.map(f => `${f.line}: ${f.message}`);
  assert.ok(findAt("let bad = noise.snoise2v(badarg").length, "call-arg finding: " + JSON.stringify(msgs, null, 1));
  assert.ok(findAt("let un = this.notdeclared").length, "undeclared uniform finding");
  assert.ok(findAt("return pal.pal1(m.xyz.x").length, "downstream-of-arithmetic wrong swizzle IS a finding");
  assert.ok(!findAt("let ok = uv * 8.0").length, "operator arithmetic itself is NOT a finding");
  assert.ok(findAt("vec4 leaked").length, "client body using vec4 is still a finding (isolation)");
  assert.ok(findAt('width="${parent.bogus}"').length || r.findings.some(f => f.message.includes("bogus")),
    "invalid constraint on the shader tag IS a finding (attrs still constraint-checked)");
  assert.ok(r.constraintsChecked >= 1);
});
