import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXml } from "../dist/xml.js";
import { el, text } from "./helpers/fakedom.mjs";

test("harness: dist import + fakedom shape", () => {
  const root = parseXml("<canvas><view/></canvas>");
  assert.equal(root.name, "canvas");
  const fake = el("view", { width: "10" }, text("hi"));
  assert.equal(fake.tagName, "VIEW");
  assert.equal(fake.getAttribute("width"), "10");
  fake.setAttribute("width", "20");
  assert.equal(fake.getAttribute("width"), "20");
});
