// xml-adapter.ts — XmlElem (parseXml) → HtmlElem-shaped tree, so .lzx apps
// feed the same model extractor as the DOM dialect (spec "Beyond bodies").
// parseXml already carries element lines and attrLines.
export function xmlToHtml(e) {
    const attributes = e.attrOrder.map((n) => ({
        name: n, value: e.attrs[n], line: e.attrLines?.[n] ?? e.line ?? 0,
    }));
    const el = {
        nodeType: 1, line: e.line ?? 0, tagName: e.name.toUpperCase(), attributes,
        childNodes: [],
        getAttribute(n) { const a = attributes.find((x) => x.name === n); return a ? a.value : null; },
        attrLine(n) { const a = attributes.find((x) => x.name === n); return a ? a.line : (e.line ?? 0); },
        setAttribute(n, v) {
            const a = attributes.find((x) => x.name === n);
            if (a)
                a.value = String(v);
            else
                attributes.push({ name: n, value: String(v), line: e.line ?? 0 });
        },
    };
    el.childNodes = e.children.map((c) => c.type === "elem" ? xmlToHtml(c) : { nodeType: 3, nodeValue: c.value, line: c.line ?? 0 });
    return el;
}
