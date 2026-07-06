// domsource.ts — the DOM→XmlElem front-end for the DOM-authored dialect
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Emits the SAME XmlElem structure parseXml produces (minus source positions),
// so everything downstream of the compiler is reused verbatim. Operates on a
// minimal structural DOM interface (DomElementLike) so it runs against the real
// browser DOM and against the test fake alike — no lib.dom dependency.

import { parseXml, XmlElem, XmlNode, XmlText } from "./xml.js";

export interface DomNodeLike { nodeType: number; nodeValue?: string | null }
export interface DomElementLike extends DomNodeLike {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  childNodes: ArrayLike<DomNodeLike>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}
export interface DomSourceOptions {
  /** Stamp adopt-ids: data-lz-adopt on live elements + lzdomadopt XmlElem attrs. */
  domAdopt?: boolean;
  /** TypeScript carrier transpile (injected; typically ts-carrier's transpileTsBody). */
  transpileTs?: (code: string) => string;
}
export class DomDialectError extends Error {}

const ELEMENT = 1, TEXT = 3, CDATA = 4, COMMENT = 8;
const PREFIX = "lz-";

// Spec "Tag-collision inventory": LZX tags that cannot be authored bare.
const FORBIDDEN_BARE: Record<string, string> = {
  canvas: "the app root is <laszlo-app>; a literal <canvas> is an HTML canvas element",
  style: "HTML parses <style> as raw CSS and applies it to the page; write <lz-style>",
  image: "HTML rewrites <image> to a void <img>, destroying children; write <lz-image>",
  img: "HTML rewrote your <image> to <img>; write <lz-image>",
  html: "an in-body <html> start tag merges into the document; write <lz-html>",
  form: "HTML drops nested <form> start tags; write <lz-form>",
  button: "an adopted <button> carries UA chrome/semantics; write <lz-button>",
  label: "write <lz-label>",
  menu: "write <lz-menu>",
  param: "<param> is a void element; write <lz-param>",
};

const CODE_PARENTS = new Set(["method", "handler", "setter"]);
// Spec Seam 1: never stamp inside these subtrees (templates / data).
const NO_STAMP_SUBTREE = new Set(["class", "interface", "mixin", "dataset"]);
// Tags never stamped: non-visual declarations + the Slice-1 text fallback.
// Over-stamping an unknown tag that turns out non-visual is benign (only
// LzView.__makeSprite consumes adopt-ids; an unclaimed registry entry is inert).
const NO_STAMP_TAGS = new Set([
  "canvas", "attribute", "method", "handler", "setter", "script", "include",
  "font", "resource", "dataset", "datapath", "datapointer", "class",
  "interface", "mixin", "node", "state", "animator", "animatorgroup",
  "layout", "simplelayout", "stableborderlayout", "constantlayout",
  "wrappinglayout", "text", "inputtext", "splash", "switch", "when", "otherwise",
]);

interface Ctx {
  opts: DomSourceOptions;
  counter: { n: number };
  inTemplate: boolean;
}

function localName(el: DomElementLike): string {
  return el.tagName.toLowerCase();
}

/** Dialect tag name: strip the lz- escape prefix; reject forbidden bare tags. */
function dialectName(raw: string): string {
  if (raw.startsWith(PREFIX)) return raw.slice(PREFIX.length);
  const why = FORBIDDEN_BARE[raw];
  if (why) throw new DomDialectError(`<${raw}> cannot be authored bare: ${why}`);
  return raw;
}

/** XML attribute-value normalization (mirror of xml.ts): tab/CR/LF → space. */
const normAttr = (v: string) => v.replace(/[\t\r\n]/g, " ");

function textContentOf(el: DomElementLike): string {
  let s = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as DomNodeLike;
    if (c.nodeType === TEXT || c.nodeType === CDATA) s += c.nodeValue ?? "";
    else if (c.nodeType === ELEMENT) s += textContentOf(c as DomElementLike);
  }
  return s;
}

function transpile(ctx: Ctx, code: string, owner: string): string {
  if (!ctx.opts.transpileTs)
    throw new DomDialectError(
      "TypeScript code present but no transpileTs was provided (text/lzs carriers pass through)");
  try {
    return ctx.opts.transpileTs(code);
  } catch (e) {
    // Spec Error handling: transpile errors name the owning element.
    throw new DomDialectError(`in <${owner}>: ${(e as Error).message}`);
  }
}

/** A <script> child of `parentName`. Returns the node(s) grafted into the parent. */
function scriptNodes(el: DomElementLike, parentName: string, ctx: Ctx): XmlNode[] {
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (type === "application/xml") {
    if (parentName !== "dataset")
      throw new DomDialectError('<script type="application/xml"> is only valid inside <dataset>');
    return [parseXml(textContentOf(el).trim())]; // single-root XML grafted verbatim
  }
  let body: string;
  if (type === "text/typescript")
    // Error context: name the code-bearing element (a standalone script IS the element).
    body = transpile(ctx, textContentOf(el), CODE_PARENTS.has(parentName) ? parentName : "script");
  else if (type === "text/lzs") body = textContentOf(el);
  else
    throw new DomDialectError(
      "bare or JavaScript-typed <script> is not allowed (the page parser would execute it); " +
      'use <script type="text/typescript"> or <script type="text/lzs">');
  const textNode: XmlText = { type: "text", value: body, cdata: false };
  if (CODE_PARENTS.has(parentName)) return [textNode]; // body carrier: wrapper elided
  // Standalone script element: only the carrier `type` is elided; other
  // authored attributes pass through (spec: "the type attribute elided").
  const attrs: Record<string, string> = {};
  const attrOrder: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === "type" || a.name === "data-lz-adopt") continue;
    if (!(a.name in attrs)) { attrOrder.push(a.name); attrs[a.name] = normAttr(a.value); }
  }
  return [{ type: "elem", name: "script", attrs, attrOrder, children: [textNode] }];
}

function walkElem(el: DomElementLike, ctx: Ctx, isRoot: boolean): XmlElem {
  const raw = localName(el);
  const name = isRoot && raw === "laszlo-app" ? "canvas" : dialectName(raw);

  const attrs: Record<string, string> = {};
  const attrOrder: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === "data-lz-adopt") continue; // live-DOM stamp, never source
    if (!(a.name in attrs)) { attrOrder.push(a.name); attrs[a.name] = normAttr(a.value); }
  }

  const childCtx: Ctx = ctx.inTemplate || !NO_STAMP_SUBTREE.has(name)
    ? { ...ctx, inTemplate: ctx.inTemplate }
    : { ...ctx, inTemplate: true };

  // Adopt-id stamping (spec Seam 1) — allocated BEFORE the child walk so ids
  // run in DOCUMENT order (parent before children; the contract the stamping
  // tests and the runtime patch pin). Root (canvas) is never adopted.
  let adoptId: string | null = null;
  if (ctx.opts.domAdopt && !isRoot && !ctx.inTemplate && !NO_STAMP_TAGS.has(name)) {
    adoptId = String(ctx.counter.n++);
    el.setAttribute("data-lz-adopt", adoptId);
  }

  const children: XmlNode[] = [];
  const isCodeParent = CODE_PARENTS.has(name);
  let sawCarrier = false;
  let sawServer = false;
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as DomNodeLike;
    if (c.nodeType === COMMENT) continue;
    if (c.nodeType === TEXT || c.nodeType === CDATA) {
      children.push({ type: "text", value: c.nodeValue ?? "", cdata: false });
      continue;
    }
    if (c.nodeType !== ELEMENT) continue;
    const ce = c as DomElementLike;
    if (localName(ce) === "server") {
      // Realtime-bus section (spec 2026-07-06-realtime-bus-design.md):
      // stripped from the client compile BEFORE stamping and BEFORE the child
      // walk — load-bearing: an unstamped subtree is removed from the live
      // page by the bootstrap's existing cleanup().
      if (!isRoot) throw new DomDialectError("<server> must be a direct child of <laszlo-app>");
      if (sawServer) throw new DomDialectError("at most one <server> section per app");
      sawServer = true;
      continue;
    }
    if (localName(ce) === "script") {
      children.push(...scriptNodes(ce, name, childCtx));
      if (isCodeParent) sawCarrier = true;
      continue;
    }
    children.push(walkElem(ce, childCtx, false));
  }

  // A code parent's PLAIN text body is TypeScript (spec "Code carriers"). With a
  // carrier present, surrounding whitespace-only text is dropped (the carrier IS
  // the body, and the XML dialect has no such wrapper whitespace).
  if (isCodeParent) {
    if (sawCarrier) {
      const kept = children.filter((k) => !(k.type === "text" && k.value.trim() === ""));
      children.length = 0;
      children.push(...kept);
    } else if (children.length && children.every((k) => k.type === "text")) {
      const joined = children.map((k) => (k as XmlText).value).join("");
      if (joined.trim() !== "") {
        children.length = 0;
        children.push({ type: "text", value: transpile(childCtx, joined, name), cdata: false });
      }
    }
  }

  const elem: XmlElem = { type: "elem", name, attrs, attrOrder, children };
  if (adoptId !== null) {
    elem.attrs["lzdomadopt"] = adoptId;
    elem.attrOrder.push("lzdomadopt");
  }
  return elem;
}

/** DOM subtree → XmlElem tree (the DOM dialect's parseXml). */
export function domToXmlElem(root: DomElementLike, opts: DomSourceOptions = {}): XmlElem {
  return walkElem(root, { opts, counter: { n: 1 }, inTemplate: false }, true);
}
