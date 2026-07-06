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

// ── Task 3: carrier semantics ────────────────────────────────────────────────

const T = (s) => "/*T*/" + s; // fake transpile marker

test("carrier: text/typescript inside <method> becomes the method body, wrapper elided", () => {
  const dom = el("laszlo-app", {},
    el("method", { name: "f", args: "n" }, text("\n  "),
      el("script", { type: "text/typescript" }, text("return n*2;")), text("\n")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const m = out.children.find((c) => c.type === "elem");
  assert.equal(m.name, "method");
  assert.deepEqual(m.children, [{ type: "text", value: "/*T*/return n*2;", cdata: false }]);
});

test("carrier: text/lzs passes through untranspiled", () => {
  const dom = el("laszlo-app", {},
    el("handler", { name: "onclick" },  // LZX handlers use name=, not event=
      el("script", { type: "text/lzs" }, text("if (this is LzView) x();"))));
  const out = domToXmlElem(dom, { transpileTs: T });
  const h = out.children.find((c) => c.type === "elem");
  assert.deepEqual(h.children, [{ type: "text", value: "if (this is LzView) x();", cdata: false }]);
});

test("carrier: plain text inside <method> is TypeScript", () => {
  const dom = el("laszlo-app", {}, el("method", { name: "g" }, text("return 1;")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const m = out.children.find((c) => c.type === "elem");
  assert.deepEqual(m.children, [{ type: "text", value: "/*T*/return 1;", cdata: false }]);
});

test("carrier: TS without transpileTs throws", () => {
  const dom = el("laszlo-app", {}, el("method", { name: "g" }, text("return 1;")));
  assert.throws(() => domToXmlElem(dom), DomDialectError);
});

test("carrier: standalone typed script maps to a real <script> element, type elided", () => {
  const dom = el("laszlo-app", {},
    el("script", { type: "text/lzs" }, text("var a = 1;")));
  const out = domToXmlElem(dom, { transpileTs: T });
  const s = out.children.find((c) => c.type === "elem");
  assert.equal(s.name, "script");
  assert.deepEqual(s.attrs, {});
  assert.deepEqual(s.children, [{ type: "text", value: "var a = 1;", cdata: false }]);
});

test("carrier: bare <script> is a dialect error", () => {
  const dom = el("laszlo-app", {}, el("script", {}, text("alert(1)")));
  assert.throws(() => domToXmlElem(dom, { transpileTs: T }), DomDialectError, /bare/i);
});

test("carrier: application/xml inside dataset grafts parsed XML", () => {
  const dom = el("laszlo-app", {},
    el("dataset", { name: "d" },
      el("script", { type: "application/xml" }, text('<items><item x="1"></item></items>'))));
  const out = domToXmlElem(dom, { transpileTs: T });
  const ds = out.children.find((c) => c.type === "elem");
  const items = ds.children[0];
  assert.equal(items.name, "items");
  assert.equal(items.children[0].name, "item");
  assert.equal(items.children[0].attrs.x, "1");
});

test("carrier: application/xml outside dataset is a dialect error", () => {
  const dom = el("laszlo-app", {},
    el("view", {}, el("script", { type: "application/xml" }, text("<x></x>"))));
  assert.throws(() => domToXmlElem(dom, { transpileTs: T }), DomDialectError);
});

// ── Task 5: adopt-id stamping ────────────────────────────────────────────────

test("stamping: off by default — no lzdomadopt anywhere (byte-parity guard)", () => {
  const dom = el("laszlo-app", {}, el("view", {}, el("view", {})));
  assert.ok(!JSON.stringify(domToXmlElem(dom)).includes("lzdomadopt"));
});

test("stamping: on — plain views get sequential ids on BOTH the XmlElem and the live element", () => {
  const inner = el("view", { width: "5" });
  const outer = el("view", {}, inner);
  const dom = el("laszlo-app", {}, outer);
  const out = domToXmlElem(dom, { domAdopt: true });
  assert.equal(out.attrs.lzdomadopt, undefined);            // root never stamped
  assert.equal(out.children[0].attrs.lzdomadopt, "1");
  assert.equal(out.children[0].children[0].attrs.lzdomadopt, "2");
  assert.equal(outer.getAttribute("data-lz-adopt"), "1");
  assert.equal(inner.getAttribute("data-lz-adopt"), "2");
});

test("stamping: excluded inside class/interface/mixin/dataset subtrees", () => {
  const tmplView = el("view", {});
  const dom = el("laszlo-app", {},
    el("class", { name: "rec", extends: "view" }, tmplView),
    el("dataset", { name: "d" }, el("script", { type: "application/xml" }, text("<r></r>"))));
  const out = domToXmlElem(dom, { domAdopt: true, transpileTs: (s) => s });
  assert.ok(!JSON.stringify(out).includes("lzdomadopt"));
  assert.equal(tmplView.getAttribute("data-lz-adopt"), null);
});

test("stamping: text/inputtext and non-visual tags excluded; user tags stamped", () => {
  const dom = el("laszlo-app", {},
    el("text", {}, text("hi")),
    el("inputtext", {}),
    el("simplelayout", { axis: "y" }),
    el("mybutton", {}));            // unknown tag = assumed user view class
  const out = domToXmlElem(dom, { domAdopt: true });
  const names = out.children.filter((c) => c.type === "elem");
  assert.equal(names.find((c) => c.name === "text").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "inputtext").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "simplelayout").attrs.lzdomadopt, undefined);
  assert.equal(names.find((c) => c.name === "mybutton").attrs.lzdomadopt, "1");
});

test("stamping: a stale data-lz-adopt on input is never emitted as source", () => {
  const dom = el("laszlo-app", {}, el("view", { "data-lz-adopt": "99" }));
  const out = domToXmlElem(dom); // domAdopt OFF
  assert.ok(!JSON.stringify(out).includes("99"));
  assert.ok(!JSON.stringify(out).includes("data-lz-adopt"));
});
