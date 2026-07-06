import { test } from "node:test";
import assert from "node:assert/strict";
import { domToXmlElem, DomDialectError } from "../dist/domsource.js";
import { parseXml } from "../dist/xml.js";
import { el, text, comment } from "./helpers/fakedom.mjs";

// Strip the fields the equivalence contract excludes (spec Seam 1): source
// positions + cdata. parseXml sets line/endLine/endCol/closeLine/attrLines.
function strip(n) {
  if (n.type === "elem") {
    delete n.line; delete n.endLine; delete n.endCol; delete n.closeLine;
    delete n.attrLines; delete n.origin;
    n.children.forEach(strip);
  } else { delete n.line; delete n.cdata; }
  return n;
}
const eq = (a, b) => assert.deepEqual(strip(a), strip(b));

test("basic tree equals parseXml", () => {
  const dom = el("laszlo-app", { width: "100", height: "50" },
    el("view", { x: "1", bgcolor: "#ff0000" },
      el("view", { width: "10" })));
  eq(domToXmlElem(dom), parseXml('<canvas width="100" height="50"><view x="1" bgcolor="#ff0000"><view width="10"></view></view></canvas>'));
});

test("text nodes and comments: text kept, comments dropped", () => {
  const dom = el("laszlo-app", {}, text("  "), comment("nope"), el("view", {}), text("\n"));
  eq(domToXmlElem(dom), parseXml("<canvas>  <view></view>\n</canvas>"));
});

test("attribute values: literal tab/CR/LF fold to spaces (xml.ts normalization)", () => {
  const dom = el("laszlo-app", {}, el("view", { onclick: "a=1;\n\tb=2;\r" }));
  const out = domToXmlElem(dom);
  assert.equal(out.children[0].attrs.onclick, "a=1;  b=2; ");
});

test("attrOrder preserves authored order", () => {
  const dom = el("laszlo-app", {}, el("view", { y: "2", x: "1", width: "9" }));
  assert.deepEqual(domToXmlElem(dom).children[0].attrOrder, ["y", "x", "width"]);
});

test("lz- prefix strips to the LZX tag", () => {
  const dom = el("laszlo-app", {}, el("lz-image", { src: "a.png" }), el("lz-style", {}));
  const out = domToXmlElem(dom);
  assert.equal(out.children[0].name, "image");
  assert.equal(out.children[1].name, "style");
});

test("forbidden bare tags throw DomDialectError", () => {
  for (const tag of ["canvas", "style", "img", "image", "html", "form", "button", "label", "menu", "param"]) {
    assert.throws(() => domToXmlElem(el("laszlo-app", {}, el(tag, {}))), DomDialectError, tag);
  }
});

test("root: laszlo-app maps to canvas; other roots pass through dialectName", () => {
  assert.equal(domToXmlElem(el("laszlo-app", {})).name, "canvas");
  assert.equal(domToXmlElem(el("view", {})).name, "view"); // e.g. equivalence fixtures
});
