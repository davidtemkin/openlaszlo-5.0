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

test("vec types are nominally distinct: vec4+vec4 stays vec4; vec4 into a vec2 param is a finding", () => {
  const mk = (body) => `<laszlo-app width="100" height="100"><shader width="100" height="100">
<method name="color"><script type="text/typescript">
${body}
</script></method></shader></laszlo-app>`;
  // regression: structural subsumption made __add(vec4, vec4) match the (vec2, vec2)
  // overload (vec4 has every vec2 property), inferring vec2 and failing the return check.
  const good = checkApp(mk("let base = pal.pal1(0.5);\nreturn base + vec4(0.1, 0.1, 0.1, 0.0);"), "t.html");
  assert.deepEqual(good.findings.map(f => f.message), []);
  const bad = checkApp(mk("let q = vec4(1.0, 1.0, 1.0, 1.0);\nlet n = noise.snoise2v(q);\nreturn vec4(n, n, n, 1.0);"), "t.html");
  assert.ok(bad.findings.length >= 1, "vec4 into vec2 param must be a finding");
});

test("declaration default + same-tag constraint = the constraint is silently dead — now a finding", () => {
  const src = `<laszlo-app width="100" height="100">
<view name="src" width="10" height="10"></view>
<view name="tgt" zoom="\${parent.src.width * 2}">
  <attribute name="zoom" type="number" value="8"></attribute>
</view>
</laszlo-app>`;
  const r = checkApp(src, "t.html");
  assert.ok(r.findings.some(f => /constraint.*value|value.*constraint|dead/i.test(f.message)),
    "expected a dead-constraint finding: " + JSON.stringify(r.findings));
  // declaring WITHOUT a value is the sanctioned pattern — no finding
  const ok = checkApp(src.replace(' value="8"', ""), "t.html");
  assert.deepEqual(ok.findings.map(f => f.message), []);
});

test("helper methods are callable in checked bodies; wrong-arity helper call is a finding", () => {
  const mk = (colorBody) => `<laszlo-app width="100" height="100"><shader width="100" height="100">
<method name="fbm" args="p: vec2" returns="float"><script type="text/typescript">
let f = 0.0;
let amp = 0.5;
let q = p;
for (let i = 0; i < 5; i++) { f = f + amp * noise.snoise2v(q); q = q * 2.03; amp = amp * 0.5; }
return f;
</script></method>
<method name="color"><script type="text/typescript">
${colorBody}
</script></method></shader></laszlo-app>`;
  const good = checkApp(mk("let v = fbm(uv * 4.0);\nreturn vec4(v, v, v, 1.0);"), "t.html");
  assert.deepEqual(good.findings.map(f => f.message), []);
  const bad = checkApp(mk("let v = fbm(uv, 2.0);\nreturn vec4(v, v, v, 1.0);"), "t.html");
  assert.ok(bad.findings.length >= 1, "wrong-arity helper call must be a finding");
});
