// CSS <stylesheet> compiler — faithful port of org.openlaszlo.css.CSSHandler +
// compiler.StyleSheetCompiler. Parses the inline CSS into the JS source for the
// `(function(){ var $lzc$style=LzCSSStyle,$lzc$rule=LzCSSStyleRule; … })();`
// preamble, one `$lzc$style._addRule(new $lzc$rule(<selector>,<properties>))`
// per rule. The resulting source is fed through the `sc` script stage (which
// renames the two locals to $0/$1, folds hex colors to ints, and requotes
// strings), exactly as the oracle's `mEnv.compileScript` does.
//
// Unsupported CSS (refused cleanly so the file UNSUPs rather than miscompiles):
// `!important`, percentages/dimensions, `url(...)`, `resource(...)`, functions
// other than `rgb()`, pseudo-classes, the `>`/`+`/`~` combinators, and compound
// (AND) conditions on a single simple selector.
import { jsString } from "./value.js";
export class CssUnsupported extends Error {
}
/** Build the `<stylesheet>` IIFE program source, or null if there are no rules.
 *  The returned string is meant to be passed to `compileProgram` (the sc stage).
 *  In a DEBUG build (`debugFile != null`) each rule carries two extra
 *  `_addRule` args — the source message pathname and the rule index — per
 *  StyleSheetCompiler.compile:179. */
export function buildStylesheetProgram(cssText, debugFile) {
    const rules = parseRules(cssText);
    if (rules.length === 0)
        return null;
    let script = "";
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const dbgArgs = debugFile != null ? `, ${jsString(debugFile)}, ${i}` : "";
        script += `$lzc$style._addRule(new $lzc$rule(${r.selector}, ${r.props}${dbgArgs}));\n`;
    }
    // Mirrors StyleSheetCompiler.compile (the LPP-4083 leading `;` is emitted by
    // the caller). The source-location directive is empty in non-debug builds.
    return ` (function() { var $lzc$style = LzCSSStyle, $lzc$rule = LzCSSStyleRule;\n${script}})();`;
}
/** Strip CSS comments and split into `selectorList { body }` rules. */
function parseRules(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const out = [];
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf("{", i);
        if (open < 0) {
            if (css.slice(i).trim() !== "")
                throw new CssUnsupported("trailing CSS text");
            break;
        }
        const close = css.indexOf("}", open);
        if (close < 0)
            throw new CssUnsupported("unbalanced braces");
        const selectorList = css.slice(i, open).trim();
        const body = css.slice(open + 1, close);
        const props = buildProperties(body);
        // A selector list (comma-separated) shares the same property map → one rule
        // per selector (CSSHandler.endSelector iterates the SelectorList).
        for (const sel of splitTopLevel(selectorList, ","))
            out.push({ selector: buildSelector(sel.trim()), props });
        i = close + 1;
    }
    return out;
}
/** Split on a separator char, ignoring occurrences inside `[...]` or quotes. */
function splitTopLevel(s, sep) {
    const parts = [];
    let depth = 0, quote = "", cur = "";
    for (const ch of s) {
        if (quote) {
            cur += ch;
            if (ch === quote)
                quote = "";
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
        }
        else if (ch === "[") {
            depth++;
            cur += ch;
        }
        else if (ch === "]") {
            depth--;
            cur += ch;
        }
        else if (ch === sep && depth === 0) {
            parts.push(cur);
            cur = "";
        }
        else
            cur += ch;
    }
    if (cur.trim() !== "" || parts.length === 0)
        parts.push(cur);
    return parts;
}
/** Build a selector → a JS object literal, or a JS array literal for a
 *  descendant selector (space-separated simple selectors, ancestor-first). */
function buildSelector(sel) {
    // Descendant combinator: whitespace between simple selectors (not inside []).
    const simples = splitSimples(sel);
    if (simples.length === 0)
        throw new CssUnsupported(`empty selector`);
    if (simples.length === 1)
        return buildSimple(simples[0]);
    return "[" + simples.map(buildSimple).join(", ") + "]";
}
/** Split a compound selector into simple selectors on descendant (whitespace)
 *  combinators, respecting `[...]` brackets. Rejects `>`/`+`/`~` combinators. */
function splitSimples(sel) {
    if (/[>+~]/.test(sel.replace(/\[[^\]]*\]/g, "")))
        throw new CssUnsupported(`CSS combinator in selector: ${sel}`);
    const out = [];
    let depth = 0, cur = "";
    for (const ch of sel) {
        if (ch === "[") {
            depth++;
            cur += ch;
        }
        else if (ch === "]") {
            depth--;
            cur += ch;
        }
        else if (/\s/.test(ch) && depth === 0) {
            if (cur !== "") {
                out.push(cur);
                cur = "";
            }
        }
        else
            cur += ch;
    }
    if (cur !== "")
        out.push(cur);
    return out;
}
/** Build a single simple selector (element + optional condition) → JS object. */
function buildSimple(sel) {
    // Leading element/universal part, then one condition (#id, .class, [attr…]).
    const m = /^([a-zA-Z_*][\w-]*)?(.*)$/.exec(sel);
    const element = m[1];
    const rest = m[2];
    if (rest === "") {
        // Pure element (or universal) selector: {s:1[, t:"name"]}.
        const map = { s: "1" };
        if (element && element !== "*")
            map.t = jsString(element);
        return emitMap(map);
    }
    return buildCondition(rest, element);
}
/** Build a conditional selector (#id, .class, [attr], [attr=val]). `element` is
 *  the optional element part (adds `t` + 1 to specificity for attribute/class). */
function buildCondition(cond, element) {
    // #id — specificity 100; the element part is ignored (matches the oracle).
    let m = /^#([\w-]+)$/.exec(cond);
    if (m)
        return emitMap({ i: jsString(m[1]), s: "100" });
    // .class — styleclass attribute, ~= match, specificity 10 (+1 with element).
    m = /^\.([\w-]+)$/.exec(cond);
    if (m) {
        const map = { a: jsString("styleclass"), v: jsString(m[1]), m: jsString("~=") };
        return finishAttr(map, 10, element);
    }
    // [attr], [attr=val], [attr~=val], [attr|=val]
    m = /^\[\s*([\w-]+)\s*(?:([~|]?=)\s*(.+?)\s*)?\]$/.exec(cond);
    if (m) {
        const attr = m[1], op = m[2], rawVal = m[3];
        const map = { a: jsString(attr) };
        if (rawVal != null)
            map.v = jsString(unquote(rawVal));
        if (op === "~=")
            map.m = jsString("~=");
        else if (op === "|=")
            map.m = jsString("|=");
        else if (op && op !== "=")
            throw new CssUnsupported(`attribute operator ${op}`);
        return finishAttr(map, 10, element);
    }
    throw new CssUnsupported(`CSS selector condition: ${cond}`);
}
/** Append element part + specificity to an attribute/class condition map. */
function finishAttr(map, spec, element) {
    if (element && element !== "*") {
        map.t = jsString(element);
        spec += 1;
    }
    map.s = String(spec);
    return emitMap(map);
}
/** Parse a declaration block `prop: value; …` into a sorted JS object literal. */
function buildProperties(body) {
    const map = {};
    for (const decl of body.split(";")) {
        const d = decl.trim();
        if (d === "")
            continue;
        const idx = d.indexOf(":");
        if (idx < 0)
            throw new CssUnsupported(`CSS declaration: ${d}`);
        const name = d.slice(0, idx).trim();
        const value = d.slice(idx + 1).trim();
        if (!/^-?[a-zA-Z][\w-]*$/.test(name))
            throw new CssUnsupported(`CSS property name: ${name}`);
        map[name] = cssValueToJs(value);
    }
    return emitMap(map);
}
/** Convert a CSS property value to a JS expression string (CSSHandler.luToString
 *  semantics). Colors emit as `0xRRGGBB` literals (folded by sc to ints). */
function cssValueToJs(value) {
    if (/!\s*important\s*$/i.test(value))
        throw new CssUnsupported(`!important`);
    // Quoted string literal — pass through (sc requotes to double quotes).
    if (/^"[^"]*"$/.test(value) || /^'[^']*'$/.test(value))
        return value;
    // #RRGGBB / #RGB hex color.
    let m = /^#([0-9a-fA-F]{6})$/.exec(value);
    if (m)
        return "0x" + m[1];
    m = /^#([0-9a-fA-F]{3})$/.exec(value);
    if (m) {
        const h = m[1];
        return "0x" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    // rgb(r,g,b) — getRGBString: clamp percentages, hex with leading zeros.
    m = /^rgb\(\s*([^)]*)\)$/i.exec(value);
    if (m)
        return rgbToHex(m[1]);
    // Integer.
    if (/^-?\d+$/.test(value))
        return value;
    // Real (decimal). Risk: Java uses Float.toString; for the simple decimals in
    // the corpus this matches the JS double shortest form after sc parses it.
    if (/^-?\d*\.\d+$/.test(value))
        return value;
    // Bare identifier → LzStyleIdent (looked up against the attr type at runtime).
    if (/^[a-zA-Z_][\w-]*$/.test(value))
        return `new LzStyleIdent('${value}')`;
    throw new CssUnsupported(`CSS value: ${value}`);
}
/** CSSHandler.getRGBString: three int/percentage components → `0xRRGGBB`. */
function rgbToHex(args) {
    const parts = args.split(",").map((s) => s.trim());
    if (parts.length !== 3)
        throw new CssUnsupported(`rgb() args: ${args}`);
    let hex = "0x";
    for (const p of parts) {
        let n;
        const pm = /^(\d+)%$/.exec(p);
        if (pm)
            n = Math.round(Math.min((parseInt(pm[1], 10) * 255) / 100, 255));
        else if (/^\d+$/.test(p))
            n = parseInt(p, 10);
        else
            throw new CssUnsupported(`rgb() component: ${p}`);
        hex += (n < 16 ? "0" : "") + n.toString(16).toUpperCase();
    }
    return hex;
}
function unquote(s) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
        return s.slice(1, -1);
    return s;
}
/** Emit a JS object literal with keys sorted (TreeMap order; ASCII so plain
 *  `<`). Non-identifier keys are quoted. Values are already JS expressions. */
function emitMap(map) {
    const keys = Object.keys(map).sort();
    const parts = keys.map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsString(k)}: ${map[k]}`);
    return "{" + parts.join(", ") + "}";
}
