// Minimal dependency-free XML parser for LZX.
// Produces an element tree preserving attribute order and text nodes.
// Handles: elements, self-closing tags, attributes (single/double quoted),
// comments, CDATA, processing instructions, and basic entity decoding.
const ENTITIES = {
    lt: "<",
    gt: ">",
    amp: "&",
    quot: '"',
    apos: "'",
};
function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
        if (body[0] === "#") {
            const code = body[1] === "x" || body[1] === "X"
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
        }
        return body in ENTITIES ? ENTITIES[body] : m;
    });
}
export function parseXml(src, opts) {
    const keepComments = opts?.keepComments === true;
    let i = 0;
    const n = src.length;
    // Newline positions for O(log n) line lookup. `lineAt(pos)` = 1-based line.
    const nls = [];
    for (let k = 0; k < n; k++)
        if (src[k] === "\n")
            nls.push(k);
    function lineAt(pos) {
        // count of newlines strictly before pos, via binary search
        let lo = 0, hi = nls.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (nls[mid] < pos)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo + 1;
    }
    function colAt(pos) {
        // 1-based column = pos − (index of the last '\n' before pos). The char
        // immediately after that newline is column 1.
        let lo = 0, hi = nls.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (nls[mid] < pos)
                lo = mid + 1;
            else
                hi = mid;
        }
        const prevNl = lo > 0 ? nls[lo - 1] : -1;
        return pos - prevNl;
    }
    function error(msg) {
        // crude line/col for diagnostics
        let line = 1, col = 1;
        for (let k = 0; k < i && k < n; k++) {
            if (src[k] === "\n") {
                line++;
                col = 1;
            }
            else
                col++;
        }
        throw new Error(`XML parse error at ${line}:${col}: ${msg}`);
    }
    function skipMisc() {
        // skip whitespace, comments, PIs, doctype between/around top-level content
        for (;;) {
            // whitespace
            while (i < n && /\s/.test(src[i]))
                i++;
            if (src.startsWith("<!--", i)) {
                const end = src.indexOf("-->", i + 4);
                if (end < 0)
                    error("unterminated comment");
                i = end + 3;
                continue;
            }
            if (src.startsWith("<?", i)) {
                const end = src.indexOf("?>", i + 2);
                if (end < 0)
                    error("unterminated processing instruction");
                i = end + 2;
                continue;
            }
            if (src.startsWith("<!", i)) {
                // DOCTYPE or similar — skip to matching '>'
                const end = src.indexOf(">", i + 2);
                if (end < 0)
                    error("unterminated declaration");
                i = end + 1;
                continue;
            }
            break;
        }
    }
    function parseName() {
        const start = i;
        while (i < n && /[^\s/>=]/.test(src[i]))
            i++;
        if (i === start)
            error("expected name");
        return src.slice(start, i);
    }
    function parseElement() {
        if (src[i] !== "<")
            error("expected '<'");
        const startLine = lineAt(i);
        i++;
        const name = parseName();
        const attrs = {};
        const attrOrder = [];
        const attrLines = {};
        let endTagLine = startLine;
        let endTagCol = 0;
        for (;;) {
            while (i < n && /\s/.test(src[i]))
                i++;
            if (src[i] === "/" && src[i + 1] === ">") {
                const endLine = lineAt(i + 1);
                const endCol = colAt(i + 1);
                i += 2;
                return { type: "elem", name, attrs, attrOrder, attrLines, children: [], line: startLine, endLine, endCol, closeLine: endLine };
            }
            if (src[i] === ">") {
                endTagLine = lineAt(i);
                endTagCol = colAt(i);
                i++;
                break;
            }
            // attribute
            const attrLine = lineAt(i);
            const aname = parseName();
            while (i < n && /\s/.test(src[i]))
                i++;
            let aval = "";
            if (src[i] === "=") {
                i++;
                while (i < n && /\s/.test(src[i]))
                    i++;
                const q = src[i];
                if (q !== '"' && q !== "'")
                    error("expected quoted attribute value");
                i++;
                const start = i;
                while (i < n && src[i] !== q)
                    i++;
                if (i >= n)
                    error("unterminated attribute value");
                // XML attribute-value normalization: each literal whitespace character
                // (tab, CR, LF) in an attribute value is replaced by a single space (the
                // SAX/JDOM parser the oracle uses does this). This collapses a multi-line
                // `setter=`/`onclick=`/`${…}` body to one logical line — significant for the
                // debug build's per-statement source-line tracking (a multi-line setter
                // attribute reports every statement on the same line). Done on the raw slice
                // so character references (`&#10;`) keep their literal char. Production-
                // neutral (the script stage re-tokenizes; whitespace between tokens is
                // insignificant).
                aval = decodeEntities(src.slice(start, i).replace(/[\t\r\n]/g, " "));
                i++; // closing quote
            }
            if (!(aname in attrs)) {
                attrOrder.push(aname);
                attrLines[aname] = attrLine;
            }
            attrs[aname] = aval;
        }
        // children until </name>
        const children = [];
        let closeLine = endTagLine;
        for (;;) {
            if (i >= n)
                error(`unterminated element <${name}>`);
            if (src.startsWith("</", i)) {
                closeLine = lineAt(i);
                i += 2;
                const close = parseName();
                while (i < n && /\s/.test(src[i]))
                    i++;
                if (src[i] !== ">")
                    error("expected '>' in closing tag");
                i++;
                if (close !== name)
                    error(`mismatched closing tag </${close}> for <${name}>`);
                break;
            }
            if (src.startsWith("<!--", i)) {
                const end = src.indexOf("-->", i + 4);
                if (end < 0)
                    error("unterminated comment");
                if (keepComments) {
                    children.push({ type: "text", value: src.slice(i + 4, end), cdata: false, comment: true, line: lineAt(i + 4) });
                }
                i = end + 3;
                continue;
            }
            if (src.startsWith("<![CDATA[", i)) {
                const end = src.indexOf("]]>", i + 9);
                if (end < 0)
                    error("unterminated CDATA");
                children.push({ type: "text", value: src.slice(i + 9, end), cdata: true, line: lineAt(i + 9) });
                i = end + 3;
                continue;
            }
            if (src.startsWith("<?", i)) {
                const end = src.indexOf("?>", i + 2);
                if (end < 0)
                    error("unterminated PI");
                i = end + 2;
                continue;
            }
            if (src[i] === "<") {
                children.push(parseElement());
                continue;
            }
            // text run
            const start = i;
            while (i < n && src[i] !== "<")
                i++;
            children.push({ type: "text", value: decodeEntities(src.slice(start, i)), cdata: false, line: lineAt(start) });
        }
        return { type: "elem", name, attrs, attrOrder, attrLines, children, line: startLine, endLine: endTagLine, endCol: endTagCol, closeLine };
    }
    skipMisc();
    const root = parseElement();
    return root;
}
