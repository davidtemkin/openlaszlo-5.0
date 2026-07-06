import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";
import { checkApp } from "../dist/lzx-check.js";

const parse = (html) => findLaszloApp(parseHtmlDialect(html));
const SUPA = `<laszlo-app>
<view width="\${server.state.count}" x="\${server.presence.count}"></view>
<text text="\${(function(rs){var s='';for(var i=0;i<rs.length;i++)s+=rs[i].body;return s})(server.chat.rows)}"></text>
<server transport="supabase" supabase-url="https://x.supabase.co" supabase-key="sb_publishable_x">
  <counter name="state"><attribute name="count" type="number" value="0"></attribute></counter>
  <chat name="chat" table="bus_messages"></chat>
</server>
</laszlo-app>`;

test("model: transport + table parsed; node default preserved", () => {
  const m = extractApp(parse(SUPA));
  assert.deepEqual(m.serverTransport, { mode: "supabase", url: "https://x.supabase.co", key: "sb_publishable_x" });
  assert.equal(m.serverTags.find((t) => t.name === "chat").table, "bus_messages");
  assert.equal(m.serverTags.find((t) => t.name === "state").table, undefined);
  const node = extractApp(parse("<laszlo-app><server><a name='a'></a></server></laszlo-app>"));
  assert.deepEqual(node.serverTransport, { mode: "node" });
});

test("model: supabase-mode findings — methods/handlers, reserved presence, missing url/key", () => {
  const m = extractApp(parse('<laszlo-app><server transport="supabase">' +
    '<a name="a"><method name="m"><script type="text/typescript">return 1;</script></method>' +
    '<handler name="oninit"><script type="text/typescript">return 1;</script></handler></a>' +
    '<b name="presence"></b></server></laszlo-app>'));
  const msgs = m.staticIssues.map((i) => i.message).join("|");
  assert.ok(msgs.includes("no execution home"));
  assert.ok(msgs.includes('"presence" is reserved'));
  assert.ok(msgs.includes("supabase-url"));
});

test("checker: table typing, rows excluded from setter, presence typed, no server program", () => {
  const r = checkApp(SUPA, "x.html");
  assert.deepEqual(r.findings.map((f) => f.message), []); // constraints on rows/count/presence all typecheck
  assert.equal(r.serverBodiesChecked, 0);                 // supabase mode: no second program
  // inline on*= attrs are never body-checked — the bad set must live in a
  // <handler> element body:
  const bad = checkApp(SUPA.replace("</view>",
    '<handler name="onclick"><script type="text/typescript">server.chat.setAttribute("rows", []);</script></handler></view>'), "x.html");
  assert.ok(bad.findings.some((f) => f.code === 2345), "setAttribute('rows', …) must be TS2345: " + JSON.stringify(bad.findings));
});

test("checker: node-mode apps unaffected (regression)", () => {
  const r = checkApp('<laszlo-app><server><a name="a"><method name="m"><script type="text/typescript">return 1;</script></method></a></server></laszlo-app>', "x.html");
  assert.equal(r.serverBodiesChecked, 1);
  assert.ok(!r.findings.some((f) => f.message.includes("no execution home")));
});
