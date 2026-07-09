import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFile } from "../dist/node.js";

const DISTRO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LPS = path.join(DISTRO, "runtime");

test("an app using <flexlayout> + hints compiles; adapter/engine scripts are inlined", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flexcompile-"));
  const app = path.join(dir, "app.lzx");
  fs.writeFileSync(app, `<canvas width="300" height="100">
  <view width="300" height="60">
    <flexlayout flexdirection="row" justifycontent="space-between" padding="4"/>
    <view width="40" height="20" bgcolor="0x4488cc"/>
    <view flex="1" height="20" bgcolor="0x44cc88"/>
    <view width="40" height="20" bgcolor="0xcc8844"/>
  </view>
</canvas>`);
  const r = compileFile(app, { lpsHome: LPS, sprites: "none" });
  assert.ok(!r.unsupported, "compile unsupported: " + r.unsupported);
  assert.ok(r.js.includes("LzFlexAdapter"), "adapter script not inlined");
  assert.ok(r.js.includes("LzCssLayout"), "engine script not inlined");
  assert.ok(r.js.includes("flexlayout"), "class not compiled");
  fs.rmSync(dir, { recursive: true, force: true });
});
