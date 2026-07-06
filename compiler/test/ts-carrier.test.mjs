import { test } from "node:test";
import assert from "node:assert/strict";
import { transpileTsBody } from "../dist/ts-carrier.js";

test("type annotations are erased", () => {
  const out = transpileTsBody("var x: number = 1; return x;");
  assert.ok(!out.includes(": number"));
  assert.ok(out.includes("return x;"));
});

test("as-casts are erased (ES4 cast equivalent)", () => {
  const out = transpileTsBody("return (this.parent as any).width;");
  assert.ok(!/\bas\b/.test(out));
});

test("arrows downlevel to functions with _this capture", () => {
  const out = transpileTsBody("const f = () => this.width; return f();");
  assert.ok(!out.includes("=>"));
  assert.ok(out.includes("_this"), "arrow this must be captured for function-body semantics");
});

test("template literals and let/const downlevel", () => {
  const out = transpileTsBody("let n = 2; const s = `v=${n}`; return s;");
  assert.ok(!out.includes("`"));
  assert.ok(!/\blet\b|\bconst\b/.test(out));
});

test("top-level return is legal (bodies are function bodies)", () => {
  assert.ok(transpileTsBody("return 42;").includes("return 42;"));
});

test("no 'use strict' prologue is injected", () => {
  assert.ok(!transpileTsBody("return 1;").includes("use strict"));
});

test("syntax errors throw", () => {
  assert.throws(() => transpileTsBody("const = ;"), /TypeScript syntax error/);
});
