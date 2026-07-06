import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
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
