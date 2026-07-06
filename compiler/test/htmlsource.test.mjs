import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDialect, findLaszloApp, HtmlDialectError } from "../dist/htmlsource.js";

test("elements, attrs, text, comments, lowercasing, lines", () => {
  const tops = parseHtmlDialect('<!doctype html>\n<!-- hi -->\n<LASZLO-APP Width="10">\n  <view x="1">t &amp; u</view>\n</LASZLO-APP>');
  assert.equal(tops.length, 1);
  const app = tops[0];
  assert.equal(app.tagName, "LASZLO-APP");          // DOM-style uppercase tagName
  assert.equal(app.getAttribute("width"), "10");     // attr names lowercased
  assert.equal(app.line, 3);
  assert.equal(app.attrLine("width"), 3);            // per-attribute line
  assert.equal(app.attrLine("nope"), 3);             // unknown -> element line
  const view = app.childNodes.find((c) => c.nodeType === 1);
  assert.equal(view.tagName, "VIEW");
  assert.equal(view.line, 4);
  assert.equal(view.childNodes[0].nodeValue, "t & u"); // entities decoded in text
});

test("script is raw text (no entity decode, markup chars survive)", () => {
  const [app] = parseHtmlDialect('<laszlo-app><method name="f"><script type="text/typescript">if (a < b && c) { return `x${a}`; }</script></method></laszlo-app>');
  const method = app.childNodes[0];
  const script = method.childNodes[0];
  assert.equal(script.tagName, "SCRIPT");
  assert.equal(script.childNodes[0].nodeValue, "if (a < b && c) { return `x${a}`; }");
});

test("script raw-text line number points at the code start", () => {
  const [app] = parseHtmlDialect('<laszlo-app>\n<handler name="onclick">\n<script type="text/typescript">\nreturn 1;\n</script>\n</handler>\n</laszlo-app>');
  const handler = app.childNodes.find((c) => c.nodeType === 1);
  const script = handler.childNodes.find((c) => c.nodeType === 1);
  assert.equal(script.childNodes[0].line, 3); // the text node BEGINS on the <script> line (right after '>')
});

test("void elements take no children; style is raw text", () => {
  const tops = parseHtmlDialect('<html><head><meta charset="utf-8"><style>a{}</style></head><body><laszlo-app></laszlo-app></body></html>');
  const app = findLaszloApp(tops);
  assert.equal(app.tagName, "LASZLO-APP");
});

test("self-closing slash on a custom tag is ignored (HTML behavior), so it must still be closed", () => {
  const [app] = parseHtmlDialect("<laszlo-app><view/></view></laszlo-app>");
  assert.equal(app.childNodes[0].tagName, "VIEW");
});

test("mismatched close tag throws with line", () => {
  assert.throws(() => parseHtmlDialect("<laszlo-app><view>\n</wiew></laszlo-app>"), HtmlDialectError, /line 2/);
});

test("findLaszloApp throws when absent", () => {
  assert.throws(() => findLaszloApp(parseHtmlDialect("<div></div>")), HtmlDialectError);
});
