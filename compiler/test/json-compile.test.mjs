import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { compileInBrowser } from "../dist/browser.js";
import { parseXml } from "../dist/xml.js";
import { el, text } from "./helpers/fakedom.mjs";

const app = (...children) => el("laszlo-app", {}, ...children);
const jsonDs = (name, json) => el("dataset", { name, type: "json" },
  el("script", { type: "application/json" }, text(json)));

test("json dataset: JSON body becomes a text child; lz-shape dropped", () => {
  const root = domToXmlElem(app(
    el("dataset", { name: "b", type: "json" },
      el("script", { type: "application/json" }, text('{"x":1}')),
      el("script", { type: "application/lz-shape" }, text("{ x: number }")))));
  const ds = root.children.find((c) => c.type === "elem" && c.name === "dataset");
  const texts = ds.children.filter((c) => c.type === "text" && c.value.trim() !== "");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].value, '{"x":1}');
});

test("json dataset: must be a direct child of laszlo-app", () => {
  assert.throws(() => domToXmlElem(app(el("view", {}, jsonDs("b", "{}")))), DomDialectError);
});

test("datapath renaming: absolute $ paths become jsondatapath", () => {
  const root = domToXmlElem(app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/list[*]" }, el("lz-text", { text: "${parent.data}" }))));
  const v = root.children.find((c) => c.type === "elem" && c.name === "view");
  assert.equal(v.attrs.jsondatapath, "$b/list[*]");
  assert.equal(v.attrs.datapath, undefined);
});

test("datapath renaming: relative under a JSON-bound ancestor; classic resets", () => {
  const root = domToXmlElem(app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/genres[*]" },
      el("view", { datapath: "/subgenres[*]" }),
      el("view", { datapath: "dset:/employee" },
        el("view", { datapath: "/child" })))));      // classic ancestor → classic
  const outer = root.children.find((c) => c.type === "elem" && c.name === "view");
  const [inner, classic] = outer.children.filter((c) => c.type === "elem");
  assert.equal(inner.attrs.jsondatapath, "/subgenres[*]");
  assert.equal(classic.attrs.datapath, "dset:/employee");
  const classicChild = classic.children.find((c) => c.type === "elem");
  assert.equal(classicChild.attrs.datapath, "/child");
  assert.equal(classicChild.attrs.jsondatapath, undefined);
});

test("constraint datapath is never json-renamed", () => {
  const root = domToXmlElem(app(el("view", { datapath: "${this.pathexpr}" })));
  const v = root.children.find((c) => c.type === "elem" && c.name === "view");
  assert.equal(v.attrs.datapath, "${this.pathexpr}");
});

test("json-bound subtrees are never adopt-stamped (template semantics)", () => {
  const live = app(jsonDs("b", "{}"),
    el("view", { datapath: "$b/list[*]" }, el("view", {})),
    el("view", {}));
  domToXmlElem(live, { domAdopt: true });
  const [, bound, plain] = live.childNodes.filter((c) => c.nodeType === 1);
  assert.equal(bound.getAttribute("data-lz-adopt"), null);
  assert.equal(bound.childNodes[0].getAttribute("data-lz-adopt"), null);
  assert.notEqual(plain.getAttribute("data-lz-adopt"), null);
});

test("json datapath inside <state> is a dialect error", () => {
  assert.throws(() => domToXmlElem(app(jsonDs("b", "{}"),
    el("view", {}, el("state", {}, el("view", { datapath: "$b/l[*]" }))))), DomDialectError);
});

// ── Task 4: compile emission ───────────────────────────────────────────────

const fetch404 = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });

async function compileApp(xml) {
  const r = await compileInBrowser("http://t.test/app.html", { rootXml: parseXml(xml), fetchFn: fetch404, maxRetries: 5 });
  assert.equal(r.unsupported, undefined, r.unsupported);
  return r.js;
}

test("compile: inline json dataset emits lz.jsondata.register, no lzAddLocalData, no global", async () => {
  const js = await compileApp(
    '<canvas><dataset name="bikeshop" type="json">{"bicycle":[{"color":"red"}]}</dataset></canvas>');
  assert.ok(js.includes('lz.jsondata.register("bikeshop",{json:{"bicycle":[{"color":"red"}]}});'));
  assert.ok(!js.includes("lzAddLocalData"));
  assert.ok(!/var bikeshop/.test(js)); // no global binding — name "server" can never clobber the bus root
});

test("compile: src and ws datasets", async () => {
  const js = await compileApp(
    '<canvas><dataset name="a" type="json" src="./a.json"/><dataset name="s" type="json" src="ws://h/api/data"/></canvas>');
  assert.ok(js.includes('lz.jsondata.register("a",{src:"./a.json"});'));
  assert.ok(js.includes('lz.jsondata.register("s",{ws:"ws://h/api/data"});'));
});

test("compile: malformed inline JSON is a compile error naming the dataset", async () => {
  const r = await compileInBrowser("http://t.test/app.html", {
    rootXml: parseXml('<canvas><dataset name="bad" type="json">{oops}</dataset></canvas>'),
    fetchFn: fetch404, maxRetries: 5 });
  assert.match(r.unsupported ?? "", /dataset "bad".*JSON/);
});

test("compile: jsondatapath flows through as a plain string attr", async () => {
  const js = await compileApp(
    '<canvas><dataset name="b" type="json">{"l":[1]}</dataset><view jsondatapath="$b/l[*]"/></canvas>');
  assert.ok(js.includes('jsondatapath:"$b/l[*]"'));
});
