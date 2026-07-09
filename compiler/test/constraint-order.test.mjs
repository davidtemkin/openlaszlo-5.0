import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApp } from "../dist/lzx-check.js";

const FORWARD = `<laszlo-app width="200" height="100">
<view name="tgt" width="\${parent.controls.zoomrow.zv.value}" height="10"></view>
<view name="controls" width="100" height="50">
  <view name="zoomrow" width="100" height="20">
    <view name="zv" width="10" height="10">
      <attribute name="value" type="number" value="8"></attribute>
    </view>
  </view>
</view>
</laszlo-app>`;

test("constraint forward-referencing a later-declared instance is a finding", () => {
  const r = checkApp(FORWARD, "t.html");
  assert.ok(r.findings.some(f => /later|declared after|bind/i.test(f.message) && /controls/.test(f.message)),
    "expected forward-reference finding: " + JSON.stringify(r.findings));
});

test("same app with the source declared first is clean", () => {
  // move controls before tgt
  const ok = FORWARD.replace(/<view name="tgt"[^>]*><\/view>\n/, "")
    .replace("</laszlo-app>", '<view name="tgt" width="${parent.controls.zoomrow.zv.value}" height="10"></view>\n</laszlo-app>');
  const r = checkApp(ok, "t.html");
  assert.deepEqual(r.findings.map(f => f.message), []);
});

test("multi-hop parent chains resolve; unresolvable chains stay silent (conservative)", () => {
  const deep = `<laszlo-app width="200" height="100">
<view width="100" height="100">
  <view name="inner" width="\${parent.parent.late.width}" height="10"></view>
</view>
<view name="late" width="50" height="10"></view>
</laszlo-app>`;
  const r = checkApp(deep, "t.html");
  assert.ok(r.findings.some(f => /later|declared after/i.test(f.message) && /late/.test(f.message)), "parent.parent forward ORDER finding: " + JSON.stringify(r.findings.map(f=>f.message)));
  const dynamic = FORWARD.replace("parent.controls.zoomrow.zv.value", "parent[somekey].value");
  const r2 = checkApp(dynamic, "t.html");
  assert.ok(!r2.findings.some(f => /later|declared after/i.test(f.message)), "dynamic access: no order finding");
});
