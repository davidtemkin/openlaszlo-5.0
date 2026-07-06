import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp } from "../dist/htmlsource.js";
import { extractApp } from "../dist/app-model.js";
import { checkApp } from "../dist/lzx-check.js";

const parse = (html) => findLaszloApp(parseHtmlDialect(html));
const SUPA = `<laszlo-app>
<view width="\${server.state.count}" x="\${server.presence.count}"></view>
<text text="\${server.chat.rowsText}"></text>
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

// ── Task 3: decls + prelude ──────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { extractServerDecls, busPrelude } from "../../startup/lz-bus.js";

// GOLDEN: the PRE-CHANGE Slice-3 busPrelude output for NODE_DECLS_INPUT,
// captured to a fixture before the object-shape change. assert.equal → byte parity.
const GOLDEN = readFileSync(new URL("./fixtures/prelude-node.golden", import.meta.url), "utf8");

// minimal live-DOM stub: lz-bus uses .children + getAttribute
const elS = (tag, attrs = {}, ...children) => ({
  tagName: tag.toUpperCase(),
  children,
  getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
});

const NODE_DECLS_INPUT = elS("server", {},
  elS("clock", { name: "clock" },
    elS("attribute", { name: "seconds", type: "number", value: "0" }),
    elS("method", { name: "reset" })));

test("extractServerDecls: object shape; node default; supabase attrs + table", () => {
  const node = extractServerDecls(NODE_DECLS_INPUT);
  assert.deepEqual(node, {
    transport: "node",
    tags: [{ tag: "clock", attrs: [{ name: "seconds", value: "0", type: "number" }], methods: [{ name: "reset" }] }],
  });
  const supa = extractServerDecls(elS("server",
    { transport: "supabase", "supabase-url": "https://x.supabase.co", "supabase-key": "k" },
    elS("chat", { name: "chat", table: "bus_messages" })));
  assert.equal(supa.transport, "supabase");
  assert.equal(supa.url, "https://x.supabase.co");
  assert.equal(supa.key, "k");
  assert.equal(supa.tags[0].table, "bus_messages");
});

test("busPrelude: NODE output is byte-identical to Slice 3 (FULL-STRING golden)", () => {
  const out = busPrelude(extractServerDecls(NODE_DECLS_INPUT));
  assert.equal(out, GOLDEN);
});

test("busPrelude: supabase mode adds presence proxy + table rows/insert stubs", () => {
  const out = busPrelude(extractServerDecls(elS("server",
    { transport: "supabase", "supabase-url": "u", "supabase-key": "k" },
    elS("state", { name: "state" }, elS("attribute", { name: "count", type: "number", value: "0" })),
    elS("chat", { name: "chat", table: "bus_messages" }))));
  assert.ok(out.includes("window.server.presence"));
  assert.ok(out.includes("o.rows = []"));
  assert.ok(out.includes('o.rowsText = ""'));
  assert.ok(out.includes('op: "insert"'));
  assert.ok(!out.includes('op: "call"'));       // no declared methods here -> no call machinery
  assert.ok(out.includes('is read-only (table-backed)'));
});

// ── Task 4: bridge pure helpers ──────────────────────────────────────────────
import { pickAdoptionSource, dedupeAppend } from "../../startup/lz-bus-supabase.js";

test("pickAdoptionSource: oldest joined_at wins; malformed/empty ignored; empty null", () => {
  assert.equal(pickAdoptionSource({}), null);
  const st = pickAdoptionSource({
    a: [{ joined_at: 200, state: { s: { count: 2 } } }],
    b: [{ joined_at: 100, state: { s: { count: 9 } } }],
    c: [{ nope: true }, { joined_at: 50 }, { joined_at: 10, state: {} }], // malformed / empty state: ignored
  });
  assert.deepEqual(st, { s: { count: 9 } });
});

test("dedupeAppend: id-deduped, immutable append", () => {
  const rows = [{ id: 1, body: "a" }];
  assert.equal(dedupeAppend(rows, { id: 1, body: "a" }), null);
  const next = dedupeAppend(rows, { id: 2, body: "b" });
  assert.equal(next.length, 2);
  assert.equal(rows.length, 1); // immutable
});
