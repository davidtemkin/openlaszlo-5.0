import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";

const parse = (html) => findLaszloApp(parseHtmlDialect(html));
const APP = `<laszlo-app>
<view width="\${server.clock.seconds}"></view>
<server>
  <clock name="clock">
    <attribute name="seconds" type="number" value="0"></attribute>
    <handler name="oninit"><script type="text/typescript">setInterval(() => this.setAttribute('seconds', this.seconds + 1), 1000);</script></handler>
    <method name="reset" args="to"><script type="text/typescript">this.setAttribute('seconds', to);</script></method>
  </clock>
</server>
</laszlo-app>`;

test("domsource: <server> stripped from the client compile, never stamped", () => {
  const xml = domToXmlElem(parse(APP), { domAdopt: true, transpileTs: (s) => s });
  // NOTE: the client view's constraint STRING contains "server.clock", so assert
  // on markers that exist ONLY inside the <server> subtree:
  assert.ok(!JSON.stringify(xml).includes("setInterval"), "server body leaked into client compile");
  assert.ok(xml.children.every((c) => c.type !== "elem" || c.name !== "server"), "server section element leaked");
  // and nothing inside <server> got a live data-lz-adopt stamp
  const root = parse(APP);
  domToXmlElem(root, { domAdopt: true, transpileTs: (s) => s });
  const srv = [...root.childNodes].find((c) => c.nodeType === 1 && c.tagName === "SERVER");
  assert.ok(!JSON.stringify(srv).includes("data-lz-adopt"));
});

test("domsource: non-root or duplicate <server> is a dialect error", () => {
  assert.throws(() => domToXmlElem(parse("<laszlo-app><view><server></server></view></laszlo-app>"), { transpileTs: (s) => s }), DomDialectError);
  assert.throws(() => domToXmlElem(parse("<laszlo-app><server></server><server></server></laszlo-app>"), { transpileTs: (s) => s }), DomDialectError);
});

test("app-model: serverTags extracted with RAW bodies; client walk skips subtree", () => {
  const m = extractApp(parse(APP));
  assert.equal(m.serverTags.length, 1);
  const t = m.serverTags[0];
  assert.equal(t.name, "clock");
  assert.equal(t.tsName, "LzSrv_clock");
  assert.deepEqual(t.attrs, [{ name: "seconds", tsType: "number", declKind: "number" }]);
  assert.equal(t.methods.length, 1);
  assert.deepEqual(t.methods[0].args, ["to"]);
  assert.ok(t.methods[0].code.includes("this.setAttribute('seconds', to)"));
  assert.ok(t.handlers[0].code.includes("setInterval"), "raw TS preserved");
  assert.ok(t.handlers[0].code.includes("=>"), "server bodies must stay untranspiled in the model");
  // the client instance walk never saw <clock>: canvas root + one client view
  assert.equal(m.instances.length, 2);
});

test("app-model: reserved identifier `server` + server-tag name rules", () => {
  const m = extractApp(parse('<laszlo-app><view id="server"></view><view name="server"></view>' +
    '<server><a name="dup"></a><b name="dup"></b><c name="my-tag"></c></server></laszlo-app>'));
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes('id "server" is reserved'));
  assert.ok(msgs.includes('name "server" is reserved'));
  assert.ok(msgs.includes('duplicate server tag name "dup"'));
  assert.ok(m.nameIssues.some((i) => i.message.includes("my-tag")));
  // rule pinned: first "dup" kept; second "dup" skipped (staticIssue);
  // invalid "my-tag" skipped (nameIssue) -> exactly ONE tag survives
  assert.equal(m.serverTags.length, 1);
  // structural guards: the reserved id/name were NEVER registered
  assert.ok(!m.instances.some((i) => i.id === "server"));
  assert.ok(!m.instances[0].namedChildren.some((c) => c.name === "server"));
});
