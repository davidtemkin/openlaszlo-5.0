import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";
import { generateAppDts, generateBodies, generateConstraintChecks } from "../dist/app-dts.js";

const app = (html) => extractApp(findLaszloApp(parseHtmlDialect(html)));

test("instances get document-order LzInst types; named children and ids recorded", () => {
  const m = app('<laszlo-app><view name="panel" id="p1"><view name="bar"></view></view></laszlo-app>');
  assert.equal(m.instances[0].tsName, "LzInst_1");        // the canvas root
  assert.equal(m.instances[0].baseTsName, "LzCanvas");
  assert.equal(m.instances[1].tsName, "LzInst_2");
  assert.equal(m.instances[1].baseTsName, "LzView");
  assert.equal(m.instances[1].id, "p1");
  assert.deepEqual(m.instances[0].namedChildren, [{ name: "panel", tsName: "LzInst_2" }]);
  assert.deepEqual(m.instances[1].namedChildren, [{ name: "bar", tsName: "LzInst_3" }]);
});

test("instance <attribute> declarations become typed attrs", () => {
  const m = app('<laszlo-app><view><attribute name="count" type="number" value="0"></attribute><attribute name="tag"></attribute></view></laszlo-app>');
  assert.deepEqual(m.instances[1].attrs, [{ name: "count", tsType: "number" }, { name: "tag", tsType: "any" }]);
});

test("user classes: attrs, method sigs, body owner; template makes no instances", () => {
  const m = app('<laszlo-app><class name="rec" extends="view"><attribute name="hue" type="color"></attribute><method name="f" args="a, b"><script type="text/typescript">return a;</script></method><view></view></class></laszlo-app>');
  assert.equal(m.classes.length, 1);
  assert.equal(m.classes[0].tsName, "LzUser_rec");
  assert.equal(m.classes[0].extTsName, "LzView");
  assert.deepEqual(m.classes[0].attrs, [{ name: "hue", tsType: "string | number" }]);
  assert.deepEqual(m.classes[0].methodSigs, ["f(a: any, b: any): any;"]);
  assert.equal(m.instances.length, 1);                    // only the canvas root
  assert.equal(m.bodies.length, 1);
  assert.equal(m.bodies[0].ownerType, "LzUser_rec");
  assert.deepEqual(m.bodies[0].params, [{ name: "a", tsType: "any" }, { name: "b", tsType: "any" }]);
});

test("handler payload typed from the declared attribute; setter arg likewise", () => {
  const m = app('<laszlo-app><view><attribute name="count" type="number"></attribute>' +
    '<handler name="oncount" args="c"><script type="text/typescript">return c;</script></handler>' +
    '<handler name="onwidth" args="w"><script type="text/typescript">return w;</script></handler>' +
    '<handler name="onclick" args="e"><script type="text/typescript">return e;</script></handler>' +
    '<setter name="count" args="v"><script type="text/typescript">return v;</script></setter>' +
    "</view></laszlo-app>");
  const [oncount, onwidth, onclick, setcount] = m.bodies;
  assert.deepEqual(oncount.params, [{ name: "c", tsType: "number" }]);  // declared attr
  assert.deepEqual(onwidth.params, [{ name: "w", tsType: "number" }]);  // schema size, RESOLVED for payloads
  assert.deepEqual(onclick.params, [{ name: "e", tsType: "any" }]);     // non-attr event
  assert.deepEqual(setcount.params, [{ name: "v", tsType: "number" }]);
  assert.equal(oncount.ownerType, "LzInst_2");
});

test("markup literals: bad number/boolean/color values are staticIssues; constraints are not", () => {
  const m = app('<laszlo-app>\n<view width="10p" visible="yes" bgcolor="#12" x="${parent.width}" y="12" opacity="0.5"></view>\n</laszlo-app>');
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("width"));
  assert.ok(msgs.includes("visible"));
  assert.ok(msgs.includes("bgcolor"));
  assert.equal(m.staticIssues.length, 3);           // x is a constraint; y/opacity are fine
  assert.equal(m.staticIssues[0].line, 2);
  assert.equal(m.constraints.length, 1);
});

test("size accepts percents; color accepts names and 0x", () => {
  const m = app('<laszlo-app><view width="50%" bgcolor="red" fgcolor="0xffcc00"></view></laszlo-app>');
  assert.deepEqual(m.staticIssues, []);
});

test("cross-refs: unknown extends, duplicate ids, duplicate sibling names", () => {
  const m = app('<laszlo-app><class name="a" extends="nosuch"></class><view id="x"></view><view id="x"></view><view name="n"></view><view name="n"></view></laszlo-app>');
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("nosuch"));
  assert.ok(msgs.includes('duplicate id "x"'));
  assert.ok(msgs.includes('duplicate sibling name "n"'));
});

test("constraints carry actual context types + ownerMembers", () => {
  const m = app('<laszlo-app><view name="panel"><attribute name="grow" type="boolean"></attribute><view name="bar" width="${parent.width - 20}"></view></view></laszlo-app>');
  assert.equal(m.constraints.length, 1);
  const c = m.constraints[0];
  assert.equal(c.expr, "parent.width - 20");
  assert.equal(c.ownerType, "LzInst_3");   // bar
  assert.equal(c.parentType, "LzInst_2");  // panel
  assert.equal(c.classrootType, "LzInst_1");
  assert.ok(c.ownerMembers.includes("width"));  // schema attr, with(this)-legal
});

test(".lzx mode (es4Bodies): every body skipped, markup still validated", () => {
  const m = extractApp(findLaszloApp(parseHtmlDialect('<laszlo-app><view width="bad"><method name="f">return 1;</method></view></laszlo-app>')), { es4Bodies: true });
  assert.equal(m.bodies.length, 0);
  assert.equal(m.skippedLzs, 1);
  assert.equal(m.staticIssues.length, 1);
});

test("name validation: constructor / invalid identifiers become issues, not declarations", () => {
  const m = app('<laszlo-app><view id="my-id"><attribute name="constructor" type="number"></attribute></view></laszlo-app>');
  assert.equal(m.nameIssues.length, 2);
  assert.ok(m.nameIssues[0].message.includes("my-id"));
  assert.ok(m.nameIssues[1].message.includes("constructor"));
  assert.equal(m.instances[1].id, undefined);
  assert.deepEqual(m.instances[1].attrs, []);
});

test("stamping-like inputs: stale data-lz-adopt attrs never reach the model", () => {
  const m = app('<laszlo-app><view data-lz-adopt="9" width="10"></view></laszlo-app>');
  assert.deepEqual(m.staticIssues, []); // data-lz-adopt skipped by SKIP_LITERAL/data- rule
});

test("text/lzs carriers skipped and counted; dataset subtrees skipped; srcLine recorded", () => {
  const m = app('<laszlo-app>\n<view>\n<handler name="onclick"><script type="text/lzs">if (this is LzView) x();</script></handler>\n<method name="g">\n<script type="text/typescript">\nreturn 1;\n</script>\n</method>\n</view>\n<dataset name="d"><script type="application/xml"><r></r></script></dataset>\n</laszlo-app>');
  assert.equal(m.skippedLzs, 1);
  assert.equal(m.bodies.length, 1);
  assert.equal(m.bodies[0].srcLine, 5); // the <script> line; code starts right after '>'
});

// ── Task 4: emission ─────────────────────────────────────────────────────────

test("app dts: classes, instance types, named children, ids", () => {
  const m = app('<laszlo-app><class name="rec" extends="view"><attribute name="hue" type="color"></attribute><method name="f" args="a"><script type="text/typescript">return a;</script></method></class><view name="panel" id="p1"><attribute name="count" type="number"></attribute></view></laszlo-app>');
  const dts = generateAppDts(m);
  assert.ok(dts.includes("declare class LzUser_rec extends LzView {"));
  assert.ok(dts.includes("hue: string | number;"));
  assert.ok(dts.includes("f(a: any): any;"));
  assert.ok(dts.includes("declare class LzInst_1 extends LzCanvas {"));
  assert.ok(dts.includes("panel: LzInst_2;"));
  assert.ok(dts.includes("declare class LzInst_2 extends LzView {"));
  assert.ok(dts.includes("count: number;"));
  assert.ok(dts.includes("declare const p1: LzInst_2;"));
});

test("constraint checks: typed this/parent/classroot params, spans carry ownerMembers", () => {
  const m = app('<laszlo-app><view name="panel"><view width="${parent.width - 20}"></view></view></laszlo-app>');
  const { source, spans } = generateConstraintChecks(m);
  assert.ok(source.includes("function __lz_constraint_1(this: LzInst_3, parent: LzInst_2, immediateparent: LzInst_2, classroot: LzInst_1): any {"));
  assert.ok(source.includes("return (parent.width - 20);"));
  assert.equal(spans.length, 1);
  assert.ok(spans[0].ownerMembers.includes("width"));
});

test("bodies file: typed this + params, spans map generated lines to source lines", () => {
  const m = app('<laszlo-app>\n<view name="v">\n<handler name="onclick">\n<script type="text/typescript">\nconst a: number = 1;\nreturn a;\n</script>\n</handler>\n</view>\n</laszlo-app>');
  const { source, spans } = generateBodies(m);
  assert.ok(source.includes("function __lz_body_1(this: LzInst_2): any {"));
  assert.ok(source.includes("const a: number = 1;"));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].srcLine, 4);
  const genFirstCodeLine = source.split("\n").indexOf("const a: number = 1;") + 1;
  assert.equal(genFirstCodeLine, spans[0].genStartLine + 1);
});
