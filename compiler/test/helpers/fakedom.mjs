// fakedom.mjs — minimal structural DOM for domsource unit tests. Mirrors the
// subset domsource.ts consumes (DomElementLike / DomNodeLike). Real-HTML-parser
// behavior (lowercasing, <image> rewrite, raw-text <script>) is covered by the
// in-browser equivalence page, not here.
export function el(tag, attrs = {}, ...children) {
  const attrList = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(), // the DOM reports HTML-namespace tag names uppercased
    attributes: attrList,
    childNodes: children.map((c) => (typeof c === "string" ? text(c) : c)),
    getAttribute(n) { const a = attrList.find((x) => x.name === n); return a ? a.value : null; },
    setAttribute(n, v) {
      const a = attrList.find((x) => x.name === n);
      if (a) a.value = String(v); else attrList.push({ name: n, value: String(v) });
    },
  };
}
export function text(s) { return { nodeType: 3, nodeValue: s }; }
export function comment(s) { return { nodeType: 8, nodeValue: s }; }
