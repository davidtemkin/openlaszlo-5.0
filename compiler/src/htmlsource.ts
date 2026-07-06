// htmlsource.ts — minimal HTML-dialect parser for lzx-check (Node has no DOM).
// Parses exactly the DOM-authoring dialect (spec: docs/superpowers/specs/
// 2026-07-05-dom-native-authoring-design.md): elements, attributes, comments,
// doctype, five core entities + numeric refs, RAW-TEXT script/style, HTML void
// elements — with 1-based line tracking (elements AND attributes) for
// diagnostics. Checker-scope only; the browser path keeps using the real HTML
// parser. Dependency-free.

export interface HtmlNode { nodeType: number; nodeValue?: string | null; line: number }
export interface HtmlElem extends HtmlNode {
  tagName: string;
  attributes: { name: string; value: string; line: number }[];
  childNodes: HtmlNode[];
  getAttribute(n: string): string | null;
  /** 1-based source line of the attribute (the element's line if absent). */
  attrLine(n: string): number;
  setAttribute(n: string, v: string): void;
}
export class HtmlDialectError extends Error {}

const ELEMENT = 1, TEXT = 3, COMMENT = 8;
const RAW_TEXT = new Set(["script", "style"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

function decodeEnt(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return body.toLowerCase() in ENTITIES ? ENTITIES[body.toLowerCase()] : m;
  });
}

function makeElem(tag: string, line: number): HtmlElem {
  const attributes: { name: string; value: string; line: number }[] = [];
  return {
    nodeType: ELEMENT, line, tagName: tag.toUpperCase(), attributes, childNodes: [],
    getAttribute(n) { const a = attributes.find((x) => x.name === n); return a ? a.value : null; },
    attrLine(n) { const a = attributes.find((x) => x.name === n); return a ? a.line : line; },
    setAttribute(n, v) {
      const a = attributes.find((x) => x.name === n);
      if (a) a.value = String(v); else attributes.push({ name: n, value: String(v), line });
    },
  };
}

export function parseHtmlDialect(src: string): HtmlElem[] {
  let i = 0, line = 1;
  const n = src.length;
  const err = (msg: string): never => { throw new HtmlDialectError(`${msg} (line ${line})`); };
  const advance = (to: number) => { for (; i < to; i++) if (src[i] === "\n") line++; };

  function skipDoctypeOrComment(): boolean {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) err("unterminated comment");
      advance(end + 3);
      return true;
    }
    if (src.startsWith("<!", i)) { // doctype / other declarations
      const end = src.indexOf(">", i);
      if (end < 0) err("unterminated <! declaration");
      advance(end + 1);
      return true;
    }
    return false;
  }

  /** Parse attributes up to (not consuming) the closing `>` or `/>`. */
  function parseAttrs(el: HtmlElem): void {
    for (;;) {
      while (i < n && /\s/.test(src[i])) advance(i + 1);
      if (i >= n) err(`unterminated <${el.tagName.toLowerCase()}> tag`);
      if (src[i] === ">" || (src[i] === "/" && src[i + 1] === ">")) return;
      const m = /^[^\s=/>]+/.exec(src.slice(i));
      if (!m) err("malformed attribute");
      const name = m![0].toLowerCase();
      const attrLine = line;
      advance(i + m![0].length);
      while (i < n && /\s/.test(src[i])) advance(i + 1);
      let value = "";
      if (src[i] === "=") {
        advance(i + 1);
        while (i < n && /\s/.test(src[i])) advance(i + 1);
        const q = src[i];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, i + 1);
          if (end < 0) err(`unterminated attribute value for ${name}`);
          value = decodeEnt(src.slice(i + 1, end));
          advance(end + 1);
        } else {
          const m2 = /^[^\s>]*/.exec(src.slice(i));
          value = decodeEnt(m2![0]);
          advance(i + m2![0].length);
        }
      }
      el.attributes.push({ name, value, line: attrLine });
    }
  }

  function parseElement(): HtmlElem {
    // at '<' followed by a name char
    const startLine = line;
    advance(i + 1);
    const m = /^[a-zA-Z][^\s/>]*/.exec(src.slice(i));
    if (!m) err("malformed start tag");
    const tag = m![0].toLowerCase();
    advance(i + m![0].length);
    const el = makeElem(tag, startLine);
    parseAttrs(el);
    if (src[i] === "/" && src[i + 1] === ">") advance(i + 2); // slash ignored (HTML) — still needs a close tag unless void
    else advance(i + 1); // consume '>'

    if (VOID.has(tag)) return el;

    if (RAW_TEXT.has(tag)) {
      const textLine = line;
      const close = src.toLowerCase().indexOf("</" + tag, i);
      if (close < 0) err(`unterminated <${tag}> raw text`);
      const raw = src.slice(i, close);
      if (raw.length) el.childNodes.push({ nodeType: TEXT, nodeValue: raw, line: textLine });
      advance(close);
      const end = src.indexOf(">", i);
      if (end < 0) err(`unterminated </${tag}>`);
      advance(end + 1);
      return el;
    }

    // children until matching close tag
    for (;;) {
      if (i >= n) err(`unclosed <${tag}>`);
      if (src.startsWith("</", i)) {
        advance(i + 2);
        const cm = /^[a-zA-Z][^\s>]*/.exec(src.slice(i));
        const closeName = cm ? cm[0].toLowerCase() : "";
        if (closeName !== tag) err(`mismatched </${closeName}>, expected </${tag}>`);
        advance(i + closeName.length);
        const end = src.indexOf(">", i);
        if (end < 0) err(`unterminated </${tag}>`);
        advance(end + 1);
        return el;
      }
      if (src[i] === "<" && skipDoctypeOrComment()) continue;
      if (src[i] === "<" && /[a-zA-Z]/.test(src[i + 1] ?? "")) { el.childNodes.push(parseElement()); continue; }
      // text run
      const textLine = line;
      let j = i;
      while (j < n && !(src[j] === "<" && (src[j + 1] === "/" || src[j + 1] === "!" || /[a-zA-Z]/.test(src[j + 1] ?? "")))) j++;
      if (j === i) j++; // lone '<' — consume as text
      const t = src.slice(i, j);
      advance(j);
      el.childNodes.push({ nodeType: TEXT, nodeValue: decodeEnt(t), line: textLine });
    }
  }

  const tops: HtmlElem[] = [];
  while (i < n) {
    if (src[i] === "<") {
      if (skipDoctypeOrComment()) continue;
      if (/[a-zA-Z]/.test(src[i + 1] ?? "")) { tops.push(parseElement()); continue; }
    }
    if (!/\s/.test(src[i])) err(`unexpected content at top level: ${JSON.stringify(src.slice(i, i + 12))}`);
    advance(i + 1);
  }
  return tops;
}

/** Breadth-first search for the <laszlo-app> element. */
export function findLaszloApp(tops: HtmlElem[]): HtmlElem {
  const stack = [...tops];
  while (stack.length) {
    const el = stack.shift()!;
    if (el.tagName === "LASZLO-APP") return el;
    for (const c of el.childNodes) if (c.nodeType === ELEMENT) stack.push(c as HtmlElem);
  }
  throw new HtmlDialectError("no <laszlo-app> element found");
}
