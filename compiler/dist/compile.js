// LZX -> DHTML JS compiler (port of the Java 4.9 oracle).
// Aims for byte-for-byte parity with the oracle.
import { parseXml } from "./xml.js";
import { emitObject, emitObjectSpaced, emitTyped, jsString } from "./value.js";
import { attrType, mapType } from "./schema.js";
import { canonicalColorHex, ColorFormatException, parseColor } from "./colors.js";
import { compileFunction, compileFunctionDebug, compileBinderDebug, collectDependencies, compileExpr, compileExprDebug, compileProgramDebug, compileStylesheetDebug, compileScriptBody, compileScriptBodyDebug, compileProgram, compileLibraryProgram, finalSourceLine, ScUnsupported, setScDebug, setScBacktrace, resetKnownClassnames, resetKnownIds, addKnownId } from "./sc.js";
import { schemaAttrType, schemaHasEvent } from "./schema-types.js";
import { javaDouble } from "./value.js";
import { buildStylesheetProgram, CssUnsupported } from "./css.js";
import { assembleDebugProgram, debugConstructor, debugConstructorPlain, renderDebugClassMake, annoFileLine, forceBlankLnum, registerBinder, lastBinderSpec, resetBinderTable, registerReg, resetRegTable, litReset, pathOnlyReset, setPathname, setDebugBacktrace } from "./debug.js";
/** Build constants the oracle bakes into every canvas (from 4.9.0 goldens). */
export const BUILD_CONSTANTS = {
    lpsbuild: "branches/4.9@17752 (17752)",
    lpsbuilddate: "2010-10-22T15:20:34Z",
    lpsrelease: "Production",
    lpsversion: "4.9.0",
    runtime: "dhtml",
};
/** Normalized in place of the live compile timestamp (harness normalizes the oracle to match). */
export const NORMALIZED_APPBUILDDATE = "1970-01-01T00:00:00Z";
/** The LFC (LaszloLibrary.lzs) production-build magic-constant banner — line 1 of
 *  `LFCdhtml.js`. The oracle emits the `compileTimeConstants` HashMap (JavascriptGenerator
 *  visitProgram, top=true under FLASH_COMPILER_COMPATABILITY) as `var <name>=<value>;`,
 *  iterated in Java-17 String-keyed HashMap order. For runtime=dhtml, --option debug
 *  unset, that order + these values are FIXED (14 keys; `:Boolean`/`:String` type
 *  annotations are stripped by the JS printer). Hardcoded byte-for-byte vs the gold. */
export const LFC_BANNER = 'var $swf10=false;var $runtime="dhtml";var $swf7=false;var $j2me=false;var $swf9=false;' +
    'var $swf8=false;var $dhtml=true;var $as3=false;var $as2=false;var $debug=false;' +
    'var $svg=false;var $backtrace=false;var $js1=true;var $profile=false;';
/** Debug-build (compress=false) magic-constant banner: a SEPARATE makeTranslation-
 *  Units unit emitted at LaszloLibrary.lzs#13 (the first real statement's line). The
 *  14 spaced `var $X = Y;` decls share one leading source directive; the trailing
 *  `\n` is the last decl's separator. The body unit (compileLibraryProgram debug)
 *  re-emits the directive for `_Copyright` (fresh translation-unit line state). */
export const LFC_BANNER_DEBUG = "/* -*- file: LaszloLibrary.lzs#13 -*- */\n" +
    'var $swf10 = false;\nvar $runtime = "dhtml";\nvar $swf7 = false;\nvar $j2me = false;\n' +
    'var $swf9 = false;\nvar $swf8 = false;\nvar $dhtml = true;\nvar $as3 = false;\n' +
    'var $as2 = false;\nvar $debug = true;\nvar $svg = false;\nvar $backtrace = false;\n' +
    'var $js1 = true;\nvar $profile = false;\n';
/** PROFILE-build magic-constant banner. nameFunctions (compress=false → the spaced
 *  `var $X = Y;` form) but TRACK_LINES is OFF, so — unlike the debug banner — there is
 *  NO leading `/* -*- file -*- *​/` directive and the body's first statement follows
 *  with none either. `$debug = false` (production folding), `$profile = true`. */
export const LFC_BANNER_PROFILE = 'var $swf10 = false;\nvar $runtime = "dhtml";\nvar $swf7 = false;\nvar $j2me = false;\n' +
    'var $swf9 = false;\nvar $swf8 = false;\nvar $dhtml = true;\nvar $as3 = false;\n' +
    'var $as2 = false;\nvar $debug = false;\nvar $svg = false;\nvar $backtrace = false;\n' +
    'var $js1 = true;\nvar $profile = true;\n';
/** Compile the LFC library root (`LaszloLibrary.lzs`) to a single production
 *  `LFCdhtml.js` string: the magic-constant banner + the include-expanded,
 *  constant-folded, compiled library body. `resolveInclude(path)` reads an
 *  include's raw source (path is root-relative; see compileLibraryProgram). This
 *  is an ADDITIVE entry — it does NOT touch the `<canvas>` app-compile path. */
export function compileLibrary(rootSource, rootFile, resolveInclude, debug = false, backtrace = false, profile = false) {
    // BACKTRACE LFC (`LFCdhtml-backtrace.js`) = the debug LFC (`$debug=true` +
    // nameFunctions) PLUS the DEBUG_BACKTRACE per-function call-stack-frame
    // instrumentation (the `Debug.backtraceStack` frame push/try/finally + per-call-
    // site `$lzsc$a.lineno=N` notes — the SAME machinery the app `compileroptions=
    // "backtrace:true"` build uses, proven byte-identical on backtrace.lzx). The
    // magic-constant banner is IDENTICAL to the debug banner (the oracle does NOT set
    // the `$backtrace` source-fold constant for DEBUG_BACKTRACE — verified vs the gold,
    // `var $backtrace = false;` in both), so reuse LFC_BANNER_DEBUG.
    if (backtrace)
        return LFC_BANNER_DEBUG + compileLibraryProgram(rootSource, rootFile, resolveInclude, true, true);
    if (debug)
        return LFC_BANNER_DEBUG + compileLibraryProgram(rootSource, rootFile, resolveInclude, true);
    // PROFILE LFC (`LFCdhtml-profile.js`) = nameFunctions (displayName-IIFEs, compress=
    // false) + the `$lzprofiler` per-function timing meter, but `$debug=false` (production
    // folding) and TRACK_LINES off (no directives). See compileLibraryProgram profile branch.
    if (profile)
        return LFC_BANNER_PROFILE + compileLibraryProgram(rootSource, rootFile, resolveInclude, false, false, true);
    return LFC_BANNER + compileLibraryProgram(rootSource, rootFile, resolveInclude);
}
/** Canvas attribute defaults (pre-typed), overridden by the source <canvas>. */
function canvasDefaults(proxied) {
    return {
        // SOLO build flips this one byte: proxied===false → "false" (oracle SOLO).
        __LZproxied: { kind: "string", v: proxied === false ? "false" : "true" },
        bgcolor: { kind: "number", v: 16777215 },
        embedfonts: { kind: "boolean", v: true },
        font: { kind: "string", v: "Verdana,Vera,sans-serif" },
        fontsize: { kind: "number", v: 11 },
        fontstyle: { kind: "string", v: "plain" },
        height: { kind: "string", v: "100%" },
        width: { kind: "string", v: "100%" },
    };
}
/** Tags whose class maps to a kernel `Lz*` name rather than `$lzc$class_<tag>`
 *  (ClassModel.LFCTag2JSClass) — the LZX is an interface over a kernel class. */
const LFC_TAG_CLASS = {
    node: "LzNode", view: "LzView", text: "LzText", inputtext: "LzInputText",
    canvas: "LzCanvas", script: "LzScript", animatorgroup: "LzAnimatorGroup",
    animator: "LzAnimator", layout: "LzLayout", state: "LzState",
    datapointer: "LzDatapointer", dataprovider: "LzDataProvider", datapath: "LzDatapath",
    dataset: "LzDataset", datasource: "LzDatasource", lzhttpdataprovider: "LzHTTPDataProvider",
    import: "LzLibrary", contextmenu: "LzContextMenu", contextmenuitem: "LzContextMenuItem",
};
/** The JS class name for a class tag (kernel name or `$lzc$class_<tag>`). */
function classJsName(tag) {
    return LFC_TAG_CLASS[tag] ?? `$lzc$class_${tag}`;
}
class Unsupported extends Error {
}
/** Port of `SymbolGenerator`: `prefix + Integer.toString(++mIndex, 36)`
 *  (base-36, pre-increment from 0). One `$m` generator is shared per compile
 *  by generated method names AND anonymous-class names (consumed in canonical
 *  traversal order — the byte-for-byte crux). */
class SymbolGenerator {
    constructor(prefix) {
        this.prefix = prefix;
        this.idx = 0;
    }
    next() {
        return this.prefix + (++this.idx).toString(36);
    }
}
/** Mouse events that default `clickable` to true (ViewSchema.sMouseEventAttributes). */
const MOUSE_EVENTS = new Set([
    "onclick", "ondblclick", "onmousedown", "onmouseup", "onmouseover",
    "onmousemove", "onmouseout",
]);
/** Event-handler attribute name (refused on instances for now — they compile to
 *  anonymous subclasses, handled in the constraints/instance-handler milestone). */
function isEventAttr(name) {
    return /^on[a-z]/.test(name);
}
/** Elements that declare properties (not child views). NodeModel.isPropertyElement. */
const PROPERTY_ELEMENTS = new Set([
    "attribute", "method", "handler", "setter", "event", "passthrough", "doc",
]);
function isPropertyElement(name) {
    return PROPERTY_ELEMENTS.has(name);
}
/** Parse a method/handler/setter `args` string into parameter names and their
 *  optional defaults (`"e = null, x"` → names [e,x], defaults [null, undefined]). */
function parseArgs(argsStr) {
    const names = [];
    const defaults = [];
    for (const part of argsStr.split(",")) {
        const p = part.trim();
        if (!p)
            continue;
        const eq = p.indexOf("=");
        const namePart = (eq >= 0 ? p.slice(0, eq) : p).trim();
        // Strip an ActionScript-style `:Type` annotation (erased, like `cast`).
        const colon = namePart.indexOf(":");
        const name = (colon >= 0 ? namePart.slice(0, colon) : namePart).trim();
        if (eq >= 0) {
            names.push(name);
            defaults.push(p.slice(eq + 1).trim());
        }
        else {
            names.push(name);
            defaults.push(undefined);
        }
    }
    return { names, defaults };
}
/** XML-encode text content for a `text` attribute (the oracle stores the literal
 *  text, so markup characters are entity-escaped). */
function xmlEncode(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/'/g, "&apos;").replace(/"/g, "&quot;");
}
/** `<text>` content normalization (JDOM getTextNormalize): collapse internal
 *  whitespace runs to a single space and trim. */
function normalizeTextContent(s) {
    return s.replace(/\s+/g, " ").trim();
}
/** JDOM XMLOutputter attribute-value escaping (escapeAttributeEntities). */
function escapeXmlAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}
/** JDOM XMLOutputter element-text escaping (escapeElementEntities). */
function escapeXmlText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}
// --- Rich text / HTML-in-text (TextCompiler + LineMetrics + ViewSchema) ---
/** XHTML markup tags recognized inside text content (ViewSchema.isHTMLElement). */
const HTML_ELEMENTS = new Set(["a", "b", "img", "br", "font", "i", "p", "pre", "u", "ul", "li", "ol"]);
function isHTMLElement(name) {
    return HTML_ELEMENTS.has(name);
}
/** Java Character.isWhitespace for the ASCII set the corpus uses. */
function isJavaWhitespace(c) {
    const i = c.charCodeAt(0);
    return i === 0x20 || i === 0x09 || i === 0x0a || i === 0x0d || i === 0x0c || i === 0x0b;
}
/** Concatenation of an element's immediate text/CDATA content (JDOM getText). */
function elemRawText(el) {
    return el.children.map((n) => (n.type === "text" ? n.value : "")).join("");
}
/** Port of LineMetrics — the HTML-text whitespace-normalization state machine
 *  (TextCompiler.getHTMLContent). Collapses runs of whitespace like browser HTML,
 *  with `<br>`/`<p>` linebreaks and `<pre>` verbatim regions; markup is serialized
 *  raw via addFormat, text spans are XML-escaped via addSpan. */
class LineMetrics {
    constructor() {
        this.verbatim = false;
        this.trim = true;
        this.last_space_pos = -1;
        this.last_newline_pos = 0;
        this.buf = "";
    }
    addHTML(rawtext, normalized) {
        if (rawtext.length === 0)
            return;
        const leading = isJavaWhitespace(rawtext[0]);
        const trailing = isJavaWhitespace(rawtext[rawtext.length - 1]);
        const allWs = normalized.length === 0;
        if (allWs) {
            normalized = !this.trim && (leading || trailing) ? " " : "";
            this.trim = true;
        }
        else {
            if (!this.trim && leading)
                normalized = " " + normalized;
            if (trailing)
                normalized = normalized + " ";
            this.trim = trailing;
        }
        this.addSpan(normalized);
    }
    setVerbatim(v) {
        this.verbatim = v;
        this.last_space_pos = -1; // resetLineWidth
    }
    addSpan(str) {
        if (str.length === 0)
            return;
        str = xmlEncode(str);
        if (!this.verbatim) {
            const buflen = this.buf.length;
            this.last_space_pos = str[str.length - 1] === " " ? buflen + str.length - 1 : -1;
            const nl = str.lastIndexOf("\n");
            if (nl >= 0)
                this.last_newline_pos = nl + buflen;
        }
        this.buf += str;
    }
    addFormat(str) {
        this.buf += str;
    }
    endOfLine() {
        if (!this.verbatim && this.last_space_pos > 0 && this.last_space_pos > this.last_newline_pos)
            this.buf = this.buf.slice(0, this.last_space_pos) + this.buf.slice(this.last_space_pos + 1);
        this.last_space_pos = -1;
    }
    newline() {
        this.endOfLine();
        this.trim = true;
        this.buf += "<br/>";
    }
    paragraphBreak() {
        if (this.buf.length === 0)
            return;
        let tn = 0;
        for (let i = this.buf.length - 1; i >= 0; i--) {
            const c = this.buf[i];
            if (c === "\t" || c === " ")
                continue;
            if (c === "\n")
                tn++;
            else if (this.buf.endsWith("<br/>")) {
                tn++;
                i -= "<br/>".length;
            }
            else
                break;
        }
        if (tn === 0)
            this.buf += "<br/><br/>";
        else if (tn === 1)
            this.buf += "<br/>";
        this.trim = true;
    }
}
/** Port of TextCompiler.getHTMLContent (3-arg recursive form). */
function getHTMLContentInto(el, lm) {
    for (const node of el.children) {
        if (node.type === "elem") {
            const tag = node.name;
            if (tag === "br") {
                lm.newline();
                getHTMLContentInto(node, lm);
                if (elemRawText(node) !== "")
                    lm.newline();
            }
            else if (tag === "p") {
                lm.paragraphBreak();
                // The oracle calls the 2-arg getHTMLContent here and DISCARDS its result
                // (a no-op on `lm`); the <p> content is intentionally dropped.
                lm.paragraphBreak();
            }
            else if (tag === "pre") {
                const prev = lm.verbatim;
                lm.setVerbatim(true);
                getHTMLContentInto(node, lm);
                lm.setVerbatim(prev);
            }
            else if (isHTMLElement(tag)) {
                lm.addFormat("<" + tag);
                for (const an of node.attrOrder)
                    lm.addFormat(" " + an + '="' + node.attrs[an] + '"');
                lm.addFormat(">");
                getHTMLContentInto(node, lm);
                lm.addFormat("</" + tag + ">");
            }
            // else: a non-HTML tag — ignored by the text compiler.
        }
        else {
            const raw = node.value;
            if (lm.verbatim)
                lm.addSpan(raw);
            else if (raw.length > 0)
                lm.addHTML(raw, normalizeTextContent(raw));
        }
    }
}
function getHTMLContent(el) {
    const lm = new LineMetrics();
    getHTMLContentInto(el, lm);
    lm.endOfLine();
    return lm.buf;
}
/** Port of TextCompiler.getInputText: inputtext fields understand no HTML except
 *  `<p>`/`<br>` (→ newline) and `<pre>` (verbatim text); other tags are ignored
 *  and text nodes are whitespace-normalized. */
function getInputText(el) {
    let text = "";
    for (const node of el.children) {
        if (node.type === "elem") {
            if (node.name === "p" || node.name === "br")
                text += "\n";
            else if (node.name === "pre")
                text += elemRawText(node);
        }
        else {
            text += normalizeTextContent(node.value);
        }
    }
    return text;
}
/** Whether a `<dataset>` is compiled to local data (DataCompiler.isElement):
 *  not type soap/http, and src not an http URL or a `$…{…}` constraint. */
function isLocalDataset(el) {
    const type = el.attrs["type"];
    if (type === "soap" || type === "http")
        return false;
    const src = el.attrs["src"];
    if (src != null && (/^https?:/.test(src) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(src)))
        return false;
    return true;
}
/** A `<dataset>` whose content is INLINE literal XML (or a compiled-in `src`
 *  file) — type≠soap/http, src not remote/constraint, not datafromchild. Mirrors
 *  the `datasetLiteral` gate in buildNode; the oracle sets includeChildren=false
 *  for these, so their XML-data children are NOT view subnodes. */
function isLiteralDatasetEl(el) {
    if (el.name !== "dataset")
        return false;
    const dtype = el.attrs["type"];
    const dsrc = el.attrs["src"];
    if (dtype === "soap" || dtype === "http")
        return false;
    if (dsrc != null && (/^https?:/.test(dsrc) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(dsrc)))
        return false;
    if (el.attrs["datafromchild"] === "true")
        return false;
    return true;
}
/** Shared body for compileDataset / compileDatasetDebug: register the global and
 *  compute the (name, content, trim, nsprefix) arguments for lzAddLocalData. */
function datasetArgs(el, globals, globalOrigins, opts) {
    const name = el.attrs["name"];
    if (!name)
        throw new Unsupported(`<dataset> without name`);
    const trim = el.attrs["trimwhitespace"] === "true";
    const nsprefix = el.attrs["nsprefix"] === "true";
    const src = el.attrs["src"];
    // Build a `<data>` element wrapping either the src file's root element or the
    // dataset's own inline children; raw-serialize it (so an empty one is `<data />`).
    let children;
    if (src != null) {
        const text = opts.resolveDatasetSrc?.(src, el.origin);
        if (text == null)
            throw new Unsupported(`unresolved dataset src: ${src}`);
        // The oracle reads the external file via JDOM SAXBuilder + XMLOutputter raw
        // format, which RETAINS comments in the serialized `<data>` content
        // (NodeModel.getDatasetContent). Parse with comments preserved here.
        children = [parseXml(text, { keepComments: true })];
    }
    else {
        children = el.children;
    }
    if (trim)
        throw new Unsupported(`dataset trimwhitespace`); // TODO: trimWhitespace pass
    const dataEl = { type: "elem", name: "data", attrs: {}, attrOrder: [], children };
    const content = serializeXmlRaw(dataEl);
    globals.push(name);
    addKnownId(name);
    globalOrigins.push(el.origin ?? "");
    return { name, content, trim, nsprefix };
}
/** Compile a local `<dataset>` to its global declaration + `lzAddLocalData`
 *  statement. The content is a `<data>` element wrapping either the src file's
 *  root element (read + serialized raw) or the dataset's own inline children. */
function compileDataset(el, globals, globalOrigins, opts) {
    const { name, content, trim, nsprefix } = datasetArgs(el, globals, globalOrigins, opts);
    return `${name}=canvas.lzAddLocalData(${jsString(name)},${jsString(content)},${trim},${nsprefix});${name}==true;`;
}
/** Debug-build variant: emit the dataset as TWO separate top-level translation
 *  units (`<name> = canvas.lzAddLocalData(...)` and `<name> == true`), spaced
 *  compress=false, each carrying the SAME leading source-location directive.
 *  DataCompiler.compile emits NO sourceLocationDirective of its own, so the
 *  oracle's lexer leaves the statements with the inherited cross-unit
 *  `Token.currentPathname`/line — passed in as `dir` ([file, line]). */
function compileDatasetDebug(el, globals, globalOrigins, opts, dir) {
    const { name, content, trim, nsprefix } = datasetArgs(el, globals, globalOrigins, opts);
    const src = `${name} = canvas.lzAddLocalData(${jsString(name)}, ${jsString(content)}, ${trim}, ${nsprefix});${name} == true`;
    const [dirFile, dirLine] = dir;
    // compileProgramDebug splits into the two statements (single logical lines —
    // the content's newlines are escaped inside the string literal) and annotates
    // each at `dirLine` of `dirFile` (its own first-statement line == dirLine).
    return compileProgramDebug(src, dirFile, dirLine);
}
/** Serialize an XML element in JDOM XMLOutputter raw format: attributes in
 *  document order, an empty element as `<tag … />` (space before `/>`), text
 *  preserved verbatim. Comments/PIs are dropped (SAXBuilder root extraction). */
function serializeXmlRaw(el) {
    let out = "<" + el.name;
    for (const a of el.attrOrder)
        out += ` ${a}="${escapeXmlAttr(el.attrs[a])}"`;
    if (el.children.length === 0)
        return out + " />";
    out += ">";
    for (const c of el.children) {
        if (c.type === "elem")
            out += serializeXmlRaw(c);
        else if (c.comment)
            out += `<!--${c.value}-->`;
        else
            out += escapeXmlText(c.value);
    }
    return out + `</${el.name}>`;
}
/** Parse a constraint value `${…}` / `$once{…}` etc. into its `when` keyword
 *  (empty for the default "always") and inner expression. Returns null if `raw`
 *  is not a constraint. Mirrors NodeModel.constraintPat. */
function parseConstraint(raw) {
    const m = /^\s*\$(\w*)\s*\{([\s\S]*)\}\s*$/.exec(raw);
    if (!m)
        return null;
    // `$always{…}` is the same as the default `${…}` (WHEN_ALWAYS).
    return { when: m[1] === "always" ? "" : m[1], expr: m[2] };
}
/** A constraint on an `<attribute>` element: either the `${…}`/`$once{…}` value
 *  syntax, OR an explicit `when="always|once|…"` with a plain value expression.
 *  `when="always"` normalizes to the default when (`""`). */
function attrConstraint(raw, whenAttr) {
    if (raw == null)
        return null;
    const c = parseConstraint(raw);
    if (c)
        return { ...c, literal: false };
    // A plain value with an explicit `when=` is a constant constraint: the value is
    // a LITERAL (type-compiled like a default attr), not a `${}` JS expression.
    if (whenAttr != null)
        return { when: whenAttr === "always" ? "" : whenAttr, expr: raw, literal: true };
    return null;
}
// The constraint dependency method is a fixed try/catch wrapper (from the sc
// `throwsError=true` pragma) around `return <deps>` (the `$debug` branch folds
// out). Wrapped in `with(this){…}` when a dependency base is a free reference.
const DEPS_INNER = (deps) => `try{\nreturn ${deps}\n}\ncatch($lzsc$e){\n` +
    'if(Error["$lzsc$isa"]?Error.$lzsc$isa($lzsc$e):$lzsc$e instanceof Error){\n' +
    "lz.$lzsc$thrownError=$lzsc$e\n};throw $lzsc$e\n}";
const depsMethod = (deps, hasFree) => hasFree
    ? `function(){\nwith(this){\n${DEPS_INNER(deps)}}}`
    : `function(){\n${DEPS_INNER(deps)}}`;
// CompilerUtils.sourceLocationDirective: `\n#file <path>\n#line <n>\n` opens a
// source region; endSourceLocationDirective `\n#file \n` resets to generated.
// `#beginAttribute`/`#endAttribute` bracket the user value within a generated
// body. The sc lexer honors these so a constraint body carries MIXED per-statement
// line tracking (the value at its .lzx line, the surrounding code at file="").
const srcDirective = (file, line) => `\n#file ${file}\n#line ${line}\n`;
const END_SRC_DIRECTIVE = "\n#file \n";
const attrSrc = (file, line, value) => "#beginAttribute" + srcDirective(file, line) + value + END_SRC_DIRECTIVE + "#endAttribute";
/** Debug-build variant of compileConstraint: render the setter (+ deps for
 *  `always`) via compileFunctionDebug with the oracle's embedded source-location
 *  directives, so the value tracks to its .lzx `srcLine` and the surrounding
 *  generated code to file="". `srcLine` is the attribute's source line (the
 *  element's SAX start line = the start-tag's closing `>` line). displayNames per
 *  NodeModel prettyBinderName (`<name>='$[once|path]{...}'`, `<name> dependencies`). */
function compileConstraintDebug(name, exprType, expr, when, mGen, file, srcLine) {
    const q = jsString(name);
    const setterName = mGen.next();
    const whenTag = when === "path" ? "path" : when === "once" ? "once" : "";
    const dnSetter = `${name}='$${whenTag}{...}'`;
    if (when === "once" || when === "path") {
        const installer = when === "path" ? "dataBindAttribute" : "setAttribute";
        const extra = when === "path" ? `,${jsString(exprType)}` : "";
        const setterBody = `this.${installer}(${q},${attrSrc(file, srcLine, expr)}${extra})`;
        const setterFn = compileFunctionDebug(dnSetter, ["$lzc$ignore"], setterBody, [undefined], file, srcLine, srcLine, false, "report", true, dnSetter);
        return {
            entries: [ent(setterName, setterFn)],
            // The debug build carries the binder's prettyBinderName as the init's last
            // arg (the production build passes `null`).
            initExpr: `new LzOnceExpr(${q}, ${jsString(exprType)}, ${jsString(setterName)}, ${jsString(dnSetter)})`,
            lastBody: setterBody, lastSrcLine: srcLine,
        };
    }
    const depsName = mGen.next();
    const setterBody = `var $lzc$newvalue = ${attrSrc(file, srcLine, expr)};\n` +
        `if ($lzc$newvalue !== this[${q}] || (! this.inited)) {\n` +
        `this.setAttribute(${q},$lzc$newvalue)\n}`;
    // The setter body, its catch/displayName, and the deps body/header all track at
    // the element's endLine (srcLine, RULE 8). The stock oracle's #line buffer bug
    // occasionally drifted bodies to endLine−1; the project's oracle buffer-fix
    // removes that, so everything is uniformly endLine (see modern-build/oracle/patch).
    const setterFn = compileFunctionDebug(dnSetter, ["$lzc$ignore"], setterBody, [undefined], file, srcLine, srcLine, false, "report", true, dnSetter);
    const deps = collectDependencies(expr);
    const depsBody = `if ($debug) {\n  return $lzc$validateReferenceDependencies(${deps.array}, ${deps.annotation});\n` +
        `} else {\n  return ${deps.array};\n}\n`;
    const depsFn = compileFunctionDebug(`${name} dependencies`, [], depsBody, [], file, srcLine, srcLine, false, "throws", true, `${name} dependencies`);
    return {
        entries: [ent(setterName, setterFn), ent(depsName, depsFn)],
        initExpr: `new LzAlwaysExpr(${q}, ${jsString(exprType)}, ${jsString(setterName)}, ${jsString(depsName)}, ${jsString(dnSetter)})`,
        lastBody: depsBody, lastSrcLine: srcLine,
    };
}
/** Compile a constraint on attribute `name` (schema type `exprType`). `when` is
 *  "" (always) or "once". `always` → setter (recompute + setAttribute) + deps
 *  method + `LzAlwaysExpr`; `once` → a plain setter + `LzOnceExpr`. Consumes the
 *  `$m` counter (setter before deps — the oracle's order). */
function compileConstraint(name, exprType, expr, when, mGen) {
    const q = jsString(name);
    const setterName = mGen.next();
    if (when === "once" || when === "path") {
        // `$path{expr}` is `$once` with a dataBindAttribute installer (the type is
        // passed as a 3rd arg); both emit `new LzOnceExpr(name,type,binder,null)`.
        const body = when === "path"
            ? `this.dataBindAttribute(${q},${expr},${jsString(exprType)})`
            : `this.setAttribute(${q},${expr})`;
        const setterFn = compileFunction(["$lzc$ignore"], body);
        return {
            entries: [`${jsString(setterName)},${setterFn}`],
            initExpr: `new LzOnceExpr(${q},${jsString(exprType)},${jsString(setterName)},null)`,
        };
    }
    const depsName = mGen.next();
    const setterBody = `var $lzc$newvalue = ${expr};\n` +
        `if ($lzc$newvalue !== this[${q}] || (! this.inited)) {\n` +
        `this.setAttribute(${q},$lzc$newvalue)\n}`;
    const setterFn = compileFunction(["$lzc$ignore"], setterBody);
    const deps = collectDependencies(expr);
    return {
        entries: [`${jsString(setterName)},${setterFn}`, `${jsString(depsName)},${depsMethod(deps.array, deps.hasFree)}`],
        initExpr: `new LzAlwaysExpr(${q},${jsString(exprType)},${jsString(setterName)},${jsString(depsName)},null)`,
    };
}
/** Compile a `type="color"` attribute value. A color attribute is `when="once"`
 *  (NodeModel/ViewSchema), so a value that resolves to a compile-time constant
 *  is constant-folded to a plain `convertColor("0xRRGGBB")` literal; a value the
 *  palette CANNOT resolve (a runtime/style color name like "gray90") instead
 *  becomes the once-constraint — a setter that wraps the RAW value in
 *  `convertColor` at runtime plus an `LzOnceExpr` init (verified vs the oracle
 *  for both instance and class-default attributes). */
function colorValue(name, raw, declared, mGen, file, srcLine) {
    try {
        return { plain: `LzColorUtils.convertColor(${jsString(canonicalColorHex(raw))})` };
    }
    catch (e) {
        if (!(e instanceof ColorFormatException))
            throw e;
        const expr = `LzColorUtils.convertColor(${jsString(raw)})`;
        const cc = COMPILE_DEBUG && file !== undefined
            ? compileConstraintDebug(name, declared, expr, "once", mGen, file, srcLine ?? 0)
            : compileConstraint(name, declared, expr, "once", mGen);
        return { entries: cc.entries, init: cc.initExpr, cc };
    }
}
/** A `$style{'prop'}` constraint on a constant (quoted-identifier) property →
 *  the compact `new LzStyleConstraintExpr(name, type, prop)` init (NodeModel
 *  getInitialValue, WHEN_STYLE + constantValue). Consumes no `$m` counter; a
 *  non-constant `$style{…}` binding is unsupported (refused cleanly). */
function styleConstraintExpr(name, exprType, value, fallback) {
    const v = value.trim();
    if (!/^(?:'\S*'|"\S*")$/.test(v))
        throw new Unsupported(`non-constant $style binding: ${name}`);
    // A debug build renders the pre-compiled value uncompressed (`, ` arg sep).
    const sep = COMPILE_DEBUG ? ", " : ",";
    // A `style=`+`value=` attribute passes the original value as a fallback
    // expression plus a warn=false flag (NodeModel.java:448).
    const fb = fallback !== undefined ? `${sep}${fallback}${sep}false` : "";
    return `new LzStyleConstraintExpr(${jsString(name)}${sep}${jsString(exprType)}${sep}${jsString(v.slice(1, -1))}${fb})`;
}
/** ViewSchema type aliases (ViewSchema.java:61): `html` is an alias for the
 *  CDATA type whose name is `text`, so a `type="html"` attribute's constraint
 *  type string is emitted as `text`. */
function aliasType(t) {
    return t === "html" ? "text" : t;
}
/** ORACLE FIX #3 (LPP-3949) TS mirror. Under backtrace, a CLASS-DEFAULT constraint
 *  init `new CTOR(args)` placed in the class's `mergeAttributes` object is
 *  noteCallSite-wrapped so the backtrace frame ($3) records the attribute's
 *  DECLARATION source line `line` (the start-tag closing `>`/`/>` line = endLine),
 *  matching the patched oracle which now anchors these inits with a #beginAttribute
 *  srcloc directive (NodeModel.getInitialValue). The CTOR is a checked free ref, so
 *  it is doubly noted: the outer `new`-expression and the inner callee ref, both at
 *  `line`. Inert (returns the init verbatim) outside backtrace, so instance-context
 *  inits and all non-backtrace builds are unchanged. */
function btNoteConstraintInit(initExpr, line, file) {
    if (!COMPILE_BACKTRACE)
        return initExpr;
    const m = /^new ([A-Za-z_$][\w$.]*)\(([\s\S]*)\)$/.exec(initExpr);
    if (!m)
        return initExpr;
    // noteCallSite marker = `#0#0` (the generated ASTExpressionList). For a
    // DIRECTIVE-FORM (state-class) constructor the fragment also carries `#<file>#1`
    // (currentPathname = source file); for a plain constructor it stays `#0#0`. These
    // inits are MID-OBJECT (never at statement head) so the `#<file>#1` does not emit a
    // visible directive — the bare `#0#0` matches both forms byte-for-byte in practice.
    // (file retained for a future directive-form refinement if a visible case appears.)
    void file;
    const note = `${annoFileLine(null, 0)}$3.lineno = ${line}`;
    return `(${note}, new (${note}, ${m[1]})(${m[2]}))`;
}
/** Backtrace: a CLASS-DEFAULT plain color value `LzColorUtils.convertColor("0x…")`
 *  in the mergeAttributes object is a CALL (and its `LzColorUtils` receiver a checked
 *  free ref), so it is doubly noteCallSite-wrapped at the attribute's source line:
 *  `($3.lineno=N, ($3.lineno=N, LzColorUtils).convertColor(…))`. The `#0#0` markers
 *  are mid-object (invisible). Inert outside backtrace / for non-call plain values. */
function btNoteColorInit(plain, line) {
    if (!COMPILE_BACKTRACE)
        return plain;
    const m = /^([A-Za-z_$][\w$.]*)\.([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/.exec(plain);
    if (!m)
        return plain;
    const note = `${annoFileLine(null, 0)}$3.lineno = ${line}`;
    return `(${note}, (${note}, ${m[1]}).${m[2]}(${m[3]}))`;
}
/** LZX `<attribute type=…>` -> our AttrType (subset; others fall back to schema). */
const LZX_TYPE = {
    number: "number",
    string: "string",
    boolean: "boolean",
    color: "color",
};
function asNumber(raw) {
    const s = raw.trim();
    if (/^-?\d+$/.test(s))
        return { kind: "number", v: parseInt(s, 10) };
    if (/^-?\d*\.\d+$/.test(s))
        return { kind: "number", v: parseFloat(s) };
    return { kind: "string", v: raw }; // e.g. "100%"
}
/** Compile an attribute value to a JS literal expression, honoring its type.
 *  inCanvas resolves colors to ints (the LzCanvas constructor takes constants);
 *  elsewhere a color compiles to an LzColorUtils.convertColor(...) call. */
function compileAttr(tag, name, raw, inCanvas, typeOf = attrType) {
    if (/^\$(once|always|immediately)?\{/.test(raw) || /^\$\{/.test(raw)) {
        throw new Unsupported(`constraint expression: ${name}=${raw}`);
    }
    if (isEventAttr(name)) {
        throw new Unsupported(`event-handler attribute: ${name} (anon-subclass milestone)`);
    }
    if (name === "id" || name === "name") {
        // Handled by buildNode (binder + global); refuse elsewhere (e.g. class
        // default children) where the binder machinery isn't wired.
        throw new Unsupported(`${name}= outside a top-level instance`);
    }
    // fontstyle is canonicalized ("bold italic"/"italic bold" → "bolditalic").
    if (name === FONTSTYLE_ATTRIBUTE)
        raw = normalizeStyleString(raw);
    return compileTypedValue(typeOf(tag, name), raw, inCanvas);
}
const FONTSTYLE_ATTRIBUTE = "fontstyle";
/** Canonicalize a `fontstyle` value (FontInfo.normalizeStyleString, whitespace
 *  off): tokenize on whitespace, OR the bold(1)/italic(2)/plain(0) bits, and map
 *  back — `bolditalic` joined without a space. */
function normalizeStyleString(style) {
    let bits = 0;
    for (const tok of style.trim().split(/\s+/)) {
        if (tok === "")
            continue;
        else if (tok === "bold")
            bits |= 1;
        else if (tok === "italic")
            bits |= 2;
        else if (tok === "plain")
            bits |= 0;
        else if (tok === "bolditalic")
            bits |= 3;
        else
            throw new Unsupported(`unknown fontstyle token: ${tok}`);
    }
    return ["plain", "bold", "italic", "bolditalic"][bits];
}
/** Compile a raw value given an explicit attribute type. */
function compileTypedValue(t, raw, inCanvas) {
    switch (t) {
        case "color":
            if (inCanvas)
                return emitTyped({ kind: "number", v: parseColor(raw) });
            try {
                return `LzColorUtils.convertColor(${jsString(canonicalColorHex(raw))})`;
            }
            catch (e) {
                if (e instanceof ColorFormatException)
                    return `LzColorUtils.convertColor(${jsString(raw)})`;
                throw e;
            }
        case "number":
            // Number/size/numberExpression values are emitted raw (then sc-normalized:
            // `40`, `Infinity`, ` 10`→`10`). A `%` value stays a string (the canvas
            // keeps width/height like "100%"; the view % → constraint is TODO).
            if (raw.trim().endsWith("%"))
                return emitTyped({ kind: "string", v: raw });
            return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
        case "boolean":
            // Boolean-typed values pass through as raw expressions (ViewSchema
            // BOOLEAN_TYPE makes "No change"): `true`/`false`/`null`/any expression —
            // sc-normalized, never quoted (so value="null" → null, not "null").
            return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
        case "expression":
            // An immediate expression value is emitted raw, then sc-normalized. In a
            // debug build a constant object/array literal value renders compress=false
            // (spaced `, `/`: ` — e.g. calMonths' array, unreservedChars' object).
            return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
        case "css":
            return compileCss(raw);
        case "string":
            return emitTyped({ kind: "string", v: raw });
    }
}
/** Compile a `css`-typed value (e.g. `layout="axis: x; spacing: 5"`) into a
 *  sorted object literal `{axis:"x",spacing:5}`. Mirrors the LFC CSSParser:
 *  `;`-separated `prop[: value]` declarations; a value is a number (int/float),
 *  a quoted string, an identifier (→ string), or true/false; a bare property
 *  (no `:value`) is `true`. Comments (`/* *​/`) and whitespace are skipped. */
function compileCss(raw) {
    const props = {};
    // Strip /* */ comments, then split on ';'.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const decl of text.split(";")) {
        const d = decl.trim();
        if (d === "")
            continue;
        const ci = d.indexOf(":");
        if (ci < 0) {
            // Bare property → true.
            const key = d.trim();
            if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key))
                throw new Unsupported(`css property: ${key}`);
            props[key] = "true";
            continue;
        }
        const key = d.slice(0, ci).trim();
        const valRaw = d.slice(ci + 1).trim();
        if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key))
            throw new Unsupported(`css property: ${key}`);
        props[key] = compileCssTerm(valRaw);
    }
    return COMPILE_DEBUG ? emitObjectSpaced(props) : emitObject(props);
}
/** Compile a CSS Term: a signed int (`[1-9][0-9]*`), a float, a quoted string,
 *  an identifier (→ quoted string), or true/false. */
function compileCssTerm(v) {
    let m;
    if ((m = /^([+-]?)([1-9][0-9]*)$/.exec(v))) {
        const n = parseInt(m[2], 10);
        return emitTyped({ kind: "number", v: m[1] === "-" ? -n : n });
    }
    if ((m = /^([+-]?)((?:[0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?)$/.exec(v))) {
        const n = parseFloat(m[2]);
        return emitTyped({ kind: "number", v: m[1] === "-" ? -n : n });
    }
    if ((m = /^'([^'\\]*)'$/.exec(v)) || (m = /^"([^"\\]*)"$/.exec(v)))
        return emitTyped({ kind: "string", v: m[1] });
    if (v === "true" || v === "false")
        return v;
    if (/^[A-Za-z][A-Za-z0-9-]*$/.test(v))
        return emitTyped({ kind: "string", v });
    throw new Unsupported(`css value: ${v}`);
}
/** Build a view instantiation spec recursively. `classDepth` is non-null only
 *  for the default children of a NAMED class definition (assignClassRoot runs
 *  only for `isclassdef`), injecting `$classrootdepth` and incrementing per
 *  level. Refuses nested property elements (they need anon subclasses). */
function buildSpec(el, resolve, classDepth = null) {
    const cls = resolve(el.name);
    const attrs = {};
    if (classDepth != null)
        attrs["$classrootdepth"] = String(classDepth);
    for (const name of el.attrOrder) {
        attrs[name] = compileAttr(el.name, name, el.attrs[name], false);
    }
    const children = [];
    let textParts = [];
    const childDepth = classDepth == null ? null : classDepth + 1;
    for (const c of el.children) {
        if (c.type !== "elem") {
            textParts.push(c.value);
            continue;
        }
        if (c.name === "doc")
            continue; // documentation
        if (isHTMLElement(c.name))
            continue; // folded into `text` by getHTMLContent
        if (isPropertyElement(c.name))
            throw new Unsupported(`<${c.name}> in plain view (nested anon-subclass milestone)`);
        children.push(buildSpec(c, resolve, childDepth));
    }
    // <text>CONTENT</text> -> text attribute (HTML markup serialized + normalized).
    if (el.name === "text" && !("text" in attrs)) {
        const t = getHTMLContent(el);
        if (t.length !== 0)
            attrs["text"] = jsString(t);
    }
    else if (textParts.join("").trim() && children.length === 0 && el.name !== "text") {
        throw new Unsupported(`unexpected text content in <${el.name}>`);
    }
    return { attrs, children, cls };
}
/** Emit a view spec object: {attrs:{...},children:[...],"class":Cls} (sorted keys). */
function emitSpec(s) {
    const obj = { class: s.cls };
    if (Object.keys(s.attrs).length > 0)
        obj.attrs = emitObject(s.attrs);
    if (s.children.length > 0) {
        obj.children = "[" + s.children.map(emitSpec).join(",") + "]";
    }
    return emitObject(obj);
}
/** View-child elements of an element (excludes property elements + doc). */
function childViews(el) {
    return el.children.filter((c) => c.type === "elem" && c.name !== "doc" && c.name !== "datapath" &&
        !isPropertyElement(c.name) && !isHTMLElement(c.name));
}
/** Build the `children` class-property value: a `[…]` array of child maps, or
 *  `LzNode.mergeChildren([…], Super['children'])` when the superclass itself has
 *  children. Returns null when there are no own children and none inherited. */
function buildChildrenProp(childEls, resolve, superTag, classDepth, classDefChildCount) {
    const inherits = classDefChildCount(superTag) > 0;
    if (childEls.length === 0 && !inherits)
        return null;
    const arr = "[" + childEls.map((c) => emitSpec(buildSpec(c, resolve, classDepth))).join(",") + "]";
    return inherits ? `LzNode.mergeChildren(${arr}${COMPILE_DEBUG ? ", " : ","}${resolve(superTag)}['children'])` : arr;
}
/** The default generated constructor function, identical for every class without
 *  an explicit constructor. */
const LZSC_INIT_FN = "function($0,$1,$2,$3){\nswitch(arguments.length){\ncase 0:\n$0=null;\n" +
    "case 1:\n$1=null;\ncase 2:\n$2=null;\ncase 3:\n$3=false;\n\n" +
    '};(arguments.callee["$superclass"]&&arguments.callee.$superclass.prototype["$lzsc$initialize"]' +
    '||this.nextMethod(arguments.callee,"$lzsc$initialize")).call(this,$0,$1,$2,$3)\n}';
// A `"name",value` instance-property entry uses a tight `,` separator in
// production and a spaced `, ` in the debug (compress=false) build. Slots and
// detection must tolerate both forms.
function ent(name, value) { return jsString(name) + (COMPILE_DEBUG ? ", " : ",") + value; }
/** Emit an object literal honoring the build mode: spaced `{k: v, …}` (sorted)
 *  for the debug backend, tight `{k:v,…}` for production. */
function emitObj(o) { return COMPILE_DEBUG ? emitObjectSpaced(o) : emitObject(o); }
function voidSlot(name) { return jsString(name) + (COMPILE_DEBUG ? ", void 0" : ",void 0"); }
/** FileUtils.adjustRelativePath: express `p` (relative to `source` dir) relative
 *  to `dest` dir. Same algorithm as the harness's node-io copy. */
function adjustRelativePathJ(p, source, dest) {
    const norm = (parts) => {
        const out = [];
        for (const c of parts) {
            if (c === "." || c === "")
                continue;
            if (c === ".." && out.length && out[out.length - 1] !== "..")
                out.pop();
            else
                out.push(c);
        }
        return out;
    };
    if (p.endsWith("/"))
        return p;
    const sd = norm(source.replace(/\/+$/, "").split("/"));
    const dd = norm(dest.replace(/\/+$/, "").split("/"));
    while (sd.length && dd.length && sd[0] === dd[0]) {
        sd.shift();
        dd.shift();
    }
    const comps = [];
    for (let i = 0; i < sd.length; i++)
        comps.push("..");
    for (const d of dd)
        comps.push(d);
    comps.push(p);
    return comps.join("/");
}
/** Faithful port of the oracle's `resource="<url>"` → `source` reduction
 *  (ViewCompiler.compileResources, lines ~412-433, + CompilationEnvironment
 *  .adjustRelativeURL). The value is parsed as a java.net.URL:
 *   - a URL with a non-empty host (http://www.x.com/p) OR an absolute path
 *     (http:/abs) keeps its scheme verbatim;
 *   - a host-empty, relative-path URL (http:resource / http:../r/x.jpg) is first
 *     RELATIVIZED (its path re-expressed from the defining file's dir to the app
 *     dir) and then reduced to its bare path+query.
 *  Per CompilationEnvironment.adjustRelativeURL the relativization is
 *  `adjustRelativePath(path, appDir, fileDir)` — `srcDir`=app-source dir,
 *  `destDir`=defining-file dir (both absolute); when equal (resource in the app
 *  root) the relativization is a no-op. */
function urlSchemeSource(raw, srcDir, destDir) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/.exec(raw);
    if (!m)
        return raw;
    const rest = m[2];
    // java.net.URL: a leading "//" introduces an authority (host[:port]).
    if (rest.startsWith("//")) {
        const after = rest.slice(2);
        const slash = after.indexOf("/");
        const authority = slash < 0 ? after : after.slice(0, slash);
        if (authority.length > 0)
            return raw; // non-empty host → keep verbatim
        const path = slash < 0 ? "" : after.slice(slash);
        return path.startsWith("/") ? raw : (path || raw);
    }
    // No "//": host is empty, path = rest (split off ?query and #frag).
    const hash = rest.indexOf("#");
    const noFrag = hash < 0 ? rest : rest.slice(0, hash);
    const q = noFrag.indexOf("?");
    let path = q < 0 ? noFrag : noFrag.slice(0, q);
    const query = q < 0 ? "" : noFrag.slice(q + 1);
    if (path.startsWith("/"))
        return raw; // absolute path → keep verbatim
    // adjustRelativeURL: relativize the (relative) path from the defining file's
    // dir to the app dir, then reduce to the bare path+query.
    if (srcDir && destDir && srcDir !== destDir)
        path = adjustRelativePathJ(path, srcDir, destDir);
    return query.length > 0 ? path + "?" + query : path;
}
/** Directory part of an absolute path id (java getParentFile equivalent). */
function dirOf(id) {
    const s = id.replace(/\\/g, "/");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(0, i) : "";
}
function isVoidSlot(e) { return e.endsWith(",void 0") || e.endsWith(", void 0"); }
function splitEntry(e) {
    const m = /^"((?:[^"\\]|\\.)*)",\s?([\s\S]*)$/.exec(e);
    return m ? { name: m[1], value: m[2] } : null;
}
/** For a state class, reroute method-valued instance entries into attribute
 *  inits: each `"name",fn` entry becomes a `"name",void 0` decl slot while `fn`
 *  is added to `inits` (the mergeAttributes object). Plain `"name",void 0` slots
 *  pass through unchanged. Mutates `inits`; returns the rewritten entry list. */
function routeStateMethods(instEntries, inits) {
    return instEntries.map((e) => {
        const m = splitEntry(e);
        if (!m || isVoidSlot(e))
            return e;
        inits[m.name] = m.value;
        return voidSlot(m.name);
    });
}
function emitClassBlock(name, superJs, instEntries, defaultAttrs, childrenJs, classAllocEntries = [], datapathSlot = false, dbg) {
    const lzcName = classJsName(name);
    if (dbg) {
        // The synthetic constructor: member-rich → plain (file="", no directives);
        // member-less → the directive form at classLine + 3.
        const ctor = dbg.memberRich ? debugConstructorPlain(dbg.ctorLine) : debugConstructor(dbg.file, dbg.ctorLine);
        const tailEntries = [`"$lzsc$initialize", ${ctor}`];
        if (datapathSlot)
            tailEntries.push(`"$datapath", void 0`);
        const allocPart = classAllocEntries.length ? classAllocEntries.join(", ") + ", " : "";
        const childrenPart = childrenJs ? `"children", ${childrenJs}, ` : "";
        const classPropsInner = `${allocPart}"tagname", ${jsString(name)}, ${childrenPart}"attributes", new LzInheritedHash(${superJs}.attributes)`;
        const make = renderDebugClassMake(dbg.file, dbg.classLine, `"${lzcName}"`, [...instEntries, ...tailEntries], superJs, classPropsInner);
        if (Object.keys(defaultAttrs).length === 0)
            return make;
        const merge = debugMergeAttributes(dbg.file, dbg.classLine, dbg.bodyLine, lzcName, emitObjectSpaced(defaultAttrs), dbg.memberRich ? undefined : dbg.ctorLine + 4, dbg.ctorLine + 4);
        return `{\n${make};\n${merge}\n}`;
    }
    // A class-level <datapath> declares `"$datapath",void 0` AFTER the constructor
    // (NodeModel.updateAttrs adds $datapath last, after the $lzsc$initialize method).
    const tail = `"$lzsc$initialize",${LZSC_INIT_FN}` + (datapathSlot ? `,"$datapath",void 0` : "");
    const props = [...instEntries, tail].join(",");
    const childrenPart = childrenJs ? `"children",${childrenJs},` : "";
    // `allocation="class"` attributes are class (static) properties, prepended to
    // the class-property array before `tagname` (e.g. `lz.command.DisplayKeys`).
    const allocPart = classAllocEntries.length ? classAllocEntries.join(",") + "," : "";
    const classProps = `[${allocPart}"tagname",${jsString(name)},${childrenPart}"attributes",new LzInheritedHash(${superJs}.attributes)]`;
    const make = `Class.make("${lzcName}",[${props}],${superJs},${classProps});`;
    if (Object.keys(defaultAttrs).length === 0)
        return make;
    const merge = `(function($0){\nwith($0)with($0.prototype){\n{\nLzNode.mergeAttributes(${emitObject(defaultAttrs)},${lzcName}.attributes)\n}}})(${lzcName})`;
    return `{\n${make}${merge}\n};`;
}
/** Emit a bare anonymous-subclass `Class.make(…)` (no mergeAttributes — the
 *  instance carries the attrs): uses `displayName` instead of `tagname`. */
function emitAnonClass(lzcName, superJs, superTag, instEntries, childrenJs) {
    const props = [...instEntries, `"$lzsc$initialize",${LZSC_INIT_FN}`].join(",");
    const dn = jsString(`<anonymous extends='${superTag}'>`);
    const childrenPart = childrenJs ? `"children",${childrenJs},` : "";
    const classProps = `["displayName",${dn},${childrenPart}"attributes",new LzInheritedHash(${superJs}.attributes)]`;
    return `Class.make("${lzcName}",[${props}],${superJs},${classProps});`;
}
/** Debug-build variant of emitAnonClass: the compress=false `Class.make` opened by
 *  the anon-class source directive (`endLine − 1`), with the synthetic member-rich
 *  constructor (its `$reportException("", N)` line N computed via the ScriptClass.
 *  toString line arithmetic — `finalSourceLine(lastMember toString) + 1 +
 *  trailing var-decls`), and spaced `displayName`/`children` classprops. */
function emitAnonClassDebug(lzcName, superJs, superTag, instEntries, childrenJs, node) {
    const file = node.el ? debugFile(node.el) : "";
    const classLine = (node.el?.endLine ?? node.el?.line ?? 1) - 1; // start-tag `>` line − 1
    if (node.lastMemberBody === undefined)
        throw new Unsupported(`debug anon class without a tracked code member`);
    // finalLine(lastCodeMember) = the line sc reaches after its Method.toString
    // (`<srcloc>body<endsrc>\n}`), then +1 (ScriptClass `\n` join) + one per trailing
    // void-0 var-decl (`var x;\n`) between the last method and the appended ctor.
    const finalLine = finalSourceLine(srcDirective(file, node.lastMemberSrcLine) + node.lastMemberBody + END_SRC_DIRECTIVE + "\n}");
    let lastMethodIdx = -1;
    for (let i = 0; i < instEntries.length; i++)
        if (!isVoidSlot(instEntries[i]))
            lastMethodIdx = i;
    const trailingVarDecls = instEntries.length - 1 - lastMethodIdx;
    const ctorLine = finalLine + 1 + trailingVarDecls;
    const ctor = ent("$lzsc$initialize", debugConstructorPlain(ctorLine));
    // A first-child id-binder: when this anon class's FIRST child instance leads its
    // attrs with a `$lzc$bind_id`, that binder is serialized as the very first entry of
    // the `children` static array, immediately after the two leading class statics
    // (displayName, then the children-array open). The ScriptClass emits the class
    // header `#line` at classLine+1 (= node.el.endLine), `displayName` on the next line,
    // and the children-array's first `#line` (the binder's funcLine) one line further —
    // so funcLine = classLine + 3 (= parent.el.endLine + 2), NOT the child's own
    // el.endLine. (color-$3 tName/explicitTExpression; dataimage yellowRect #132,
    // weather forecastData #222, lzpix agroup #527 — all classLine+3.)
    const firstChildBinder = node.children[0]?.idBinderSpec;
    if (firstChildBinder)
        firstChildBinder.funcLine = classLine + 3;
    const dn = jsString(`<anonymous extends='${superTag}'>`);
    const childrenPart = childrenJs ? `"children", ${childrenJs}, ` : "";
    const classPropsInner = `"displayName", ${dn}, ${childrenPart}"attributes", new LzInheritedHash(${superJs}.attributes)`;
    return renderDebugClassMake(file, classLine, `"${lzcName}"`, [...instEntries, ctor], superJs, classPropsInner);
}
/** Port of NodeModel.collectNamedChildren: the names of all named children of an
 *  instance/class — recursing INTO state children (their names hoist up) and UP
 *  the superclass chain (class-default named children). `superTag` is the class
 *  whose definition supplies inherited children (null to stop). */
function collectNamedChildren(childEls, superTag, ctx) {
    const names = [];
    for (const c of childEls) {
        if (ctx.isStateClass(c.name)) {
            names.push(...collectNamedChildren(childViews(c), c.name, ctx));
        }
        else if (c.attrs["name"] != null) {
            names.push(c.attrs["name"]);
        }
    }
    if (superTag) {
        const def = ctx.classes.get(superTag);
        if (def)
            names.push(...collectNamedChildren(childViews(def.el), def.superTag, ctx));
    }
    return names;
}
/** A `%`-valued `numberExpression`/`size` attribute becomes an `always`
 *  constraint relative to the immediate parent: `width`/`height`→
 *  `immediateparent.<name>`, `x`→`immediateparent.width`, `y`→
 *  `immediateparent.height`, scaled by `<pct>/100` (via float then double, as the
 *  oracle) when ≠ 1.0. Returns the constraint expression, or null. Mirrors
 *  NodeModel.java's numberExpression/sizeExpression percent handling. */
function percentConstraintExpr(schemaType, name, raw) {
    if (schemaType !== "size" && schemaType !== "numberExpression")
        return null;
    const v = raw.trim();
    if (!v.endsWith("%"))
        return null;
    const f = parseFloat(v.slice(0, -1));
    if (Number.isNaN(f))
        return null;
    const scale = Math.fround(f) / 100.0; // new Float(numstr).floatValue()/100.0
    const ref = name === "x" ? "width" : name === "y" ? "height" : name;
    let expr = "immediateparent." + ref;
    if (scale !== 1.0)
        expr += "\n * " + javaDouble(scale);
    return expr;
}
/** Pass 1 — build a node and recursively its children, allocating method `$m`
 *  gensyms in document order (attributes before child elements). `parentTag` is
 *  the DOM parent's tag (for the <state> attribute-type DOM-parent rule). */
function buildNode(el, ctx, topLevel, classDepth, parentTag) {
    const { resolve, resolveConstraintType, valueTypeOf, isInherited, mGen, globals, globalOrigins, registerResource } = ctx;
    const superTag = el.name;
    const methodEntries = [];
    const delegateList = [];
    const delegateEvents = new Set();
    const attrs = {};
    const slotNames = [];
    const inlineSlots = [];
    const attrSlots = [];
    // Debug reg/trailer discriminator (S36): does THIS node emit any SOURCE-literal
    // value attribute (wrapped by the oracle in `#beginAttribute`, leaving a trailing
    // `#file ` reset)? Aggregated with children's flags into the BuiltNode. Set ONLY
    // in the attr-loop branches that emit a literal value (NOT constraints, handlers,
    // binders, $delegates, void-slots, or auto-injected attrs — those carry no
    // `#file`). Folded text content (`<text>…</text>`) is a literal value attr
    // (Pattern A, below), not a `#beginContent` reset.
    let hasLiteralAttr = false;
    // Debug build: the last code member's body source + source line (for the
    // anon-class constructor source-line simulation in emitNode).
    let lastMemberBody;
    let lastMemberSrcLine;
    // The bind_id binder spec for THIS node (if it has an `id`), captured so an
    // enclosing anon class can re-point its funcLine when this node is the first child.
    let idBinderSpec;
    const noteCodeMember = (body, srcLine) => {
        if (body !== undefined) {
            lastMemberBody = body;
            lastMemberSrcLine = srcLine;
        }
    };
    // The oracle (ToplevelCompiler.computeDeclarations) adds a node's `id` global
    // BEFORE its `name` global regardless of source attribute order, so the
    // `var <sym>=null;` prefix lists id before name per node. Defer the name
    // global until after the attr loop so id (pushed in-loop) always precedes it.
    let pendingNameGlobal;
    let pendingNameBinderRaw;
    // <script> compiles to an `lz.script` instance carrying a `script` function.
    if (el.name === "script") {
        if (el.attrs["when"] === "immediate")
            throw new Unsupported(`<script when="immediate">`);
        // `<script src="file.js"/>`: the referenced JS is read (relative to the
        // including file) and its raw text becomes the script body, PREFIXED with a
        // `#file <src>\n#line 1\n` directive (ScriptElementCompiler.compile). The
        // wrapper (the `script: function(){…}` displayName-IIFE + try/catch) still
        // tracks at the `<script>` ELEMENT's own line/file (sourceLocationDirective
        // on the element); the embedded `#file <src>` switches the BODY content to the
        // src file's lines (so `JSON = {}` is `json.js#59`, not the element line).
        let body = el.children.map((n) => (n.type === "text" ? n.value : "")).join("");
        const src = el.attrs["src"];
        if (src) {
            const text = SCRIPT_SRC?.(src, el.origin ?? DEBUG_SOURCE_ID);
            if (text == null)
                throw new Unsupported(`<script src="${src}"> not found`);
            body = `#file ${src}\n#line 1\n` + text;
        }
        // Debug build: the script function value carries the displayName-IIFE +
        // try/catch wrapper. The generated anonymous-function displayName column
        // (JavascriptGenerator:1115) = the element's `>` column + the fixed asMap
        // prefix length (`canvas.LzInstantiateView({'class': lz.script, attrs: {script: `
        // = 62 chars, then `function` is 1 past) → endCol + 63.
        const script = COMPILE_DEBUG
            ? compileScriptBodyDebug(body, debugFile(el), el.line ?? 0, (el.endCol ?? 0) + 63)
            : compileScriptBody(body);
        // A `<script>` instance ends its source with a `#beginContent …#file <reset>
        // #endContent` body, NOT a value-attr `#beginAttribute` — its reset is silently
        // re-established by the oracle (the color-$3/databinding-$10 Pattern-B anomaly),
        // so an instance ending on script content must NOT classify as Pattern A. Flag
        // it as content-bearing so the reg/trailer discriminator keeps it Pattern B.
        return { superTag, methodEntries, attrs, delegateList, delegateEvents, children: [], slotNames: [], inlineSlots: [], attrSlots: [], script, subtreeHasScriptOrContent: true };
    }
    // NOTE: the debug build's constraint setter/deps bodies all track at the
    // element's endLine (RULE 8) with NO per-element off-by-one. The stock 4.9.0
    // oracle had a debug-only #line drift bug (a JavaCC SimpleCharStream 4096-char
    // buffer-boundary artifact in `adjustBeginLineColumn`) that nudged a few bodies
    // to endLine−1; the project's oracle carries a buffer-size fix that removes it
    // (see modern-build/oracle/patch/README.md). With that fix the line numbers are
    // drift-free everywhere, so the former `specialDepsAttr` (S26-1) and
    // `firstSetterBodyQuirkAttr` quirk detectors are gone — bodies use endLine.
    // A NON-top-level `<dataset>` holding literal XML data is a normal instance:
    // the oracle (NodeModel.addAttributes:615-631) adds an `initialdata` instance
    // property = the serialized `<data>…</data>` content and does NOT include the
    // dataset's children (they are the literal data, already captured). Top-level
    // datasets take the lzAddLocalData path (compileDataset) and never reach here.
    // The init is added BEFORE the attr loop so `initialdata` precedes `name` in
    // the emitted attrs map (matching the oracle's property order).
    let datasetLiteral = false;
    if (el.name === "dataset") {
        const dtype = el.attrs["type"];
        const dsrc = el.attrs["src"];
        const datafromchild = el.attrs["datafromchild"] === "true";
        const literal = !(dtype === "soap" || dtype === "http")
            && !(dsrc != null && (/^https?:/.test(dsrc) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(dsrc)))
            && !datafromchild;
        if (literal) {
            datasetLiteral = true;
            let dchildren;
            if (dsrc != null) {
                const text = DATASET_SRC?.(dsrc, el.origin);
                if (text == null)
                    throw new Unsupported(`unresolved dataset src: ${dsrc}`);
                dchildren = [parseXml(text, { keepComments: true })];
            }
            else {
                dchildren = el.children;
            }
            if (el.attrs["trimwhitespace"] === "true")
                throw new Unsupported(`dataset trimwhitespace`);
            const dataEl = { type: "elem", name: "data", attrs: {}, attrOrder: [], children: dchildren };
            attrs["initialdata"] = jsString(serializeXmlRaw(dataEl));
            hasLiteralAttr = true;
        }
    }
    for (const name of el.attrOrder) {
        const raw = el.attrs[name];
        if (name === "resource" && !parseConstraint(raw) && /^(?:https?|ftp|file|soap):/.test(raw)) {
            // A URL-scheme resource (`resource="http://host/path"`) is runtime-loaded,
            // not compiled into the resource library: the oracle renames it to the
            // `source` attribute. It does NOT blindly drop the scheme — it parses the
            // value as a java.net.URL (ViewCompiler.compileResources):
            //   - if the URL has a non-empty host (e.g. http://www.x.com/p) OR an
            //     absolute path (http:/abs), the value is kept VERBATIM (scheme intact);
            //   - only the host-empty + relative-path form (e.g. "http:resource") is
            //     relativized (defining-file dir → app dir) then reduced to its bare
            //     path, which the runtime treats as a plain name.
            attrs["source"] = jsString(urlSchemeSource(raw, dirOf(DEBUG_SOURCE_ID), dirOf(el.origin ?? DEBUG_SOURCE_ID))) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
            hasLiteralAttr = true; // a `source: "…"` string literal wraps in #beginAttribute
        }
        else if (name === "resource" && !parseConstraint(raw)) {
            // resource="file" → import the media + a $LZ library entry; the attr
            // value becomes the resource's gensym name.
            attrs["resource"] = jsString(registerResource(raw, el.origin)) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
            hasLiteralAttr = true; // a `resource: "$LZN"` string literal wraps in #beginAttribute
        }
        else if (name === "id") {
            // id is always a global reference: var <id>=null + bind_id binder.
            globals.push(raw);
            addKnownId(raw);
            globalOrigins.push(el.origin ?? "");
            attrs["$lzc$bind_id"] = COMPILE_DEBUG
                ? idBinderDebug(raw, true, debugFile(el), el.endLine ?? el.line ?? 0)
                : idBinder(raw, true);
            // Capture the bind_id spec so emitAnonClassDebug can re-point its funcLine to
            // the enclosing anon class's ctorLine − 4 when this instance is the FIRST child
            // of an anon class (a class-def-first Pattern-B binder: its serialized position
            // is the anon-ctor's trailing line, not el.endLine — see emitNode).
            if (COMPILE_DEBUG)
                idBinderSpec = lastBinderSpec();
            attrs["id"] = jsString(raw) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
            hasLiteralAttr = true; // `id: "…"` is a source literal (wraps in #beginAttribute)
        }
        else if (name === "name") {
            attrs["name"] = jsString(raw) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
            hasLiteralAttr = true; // `name: "…"` is a source literal (wraps in #beginAttribute)
            if (topLevel) {
                // A top-level name is also a global (with bind_name). Pushed after the
                // attr loop so the node's `id` global (if any) precedes it. The binder's
                // source line is computed below (it follows the id binder in a shared,
                // un-reset line counter — see emitNameBinder).
                pendingNameGlobal = raw;
                pendingNameBinderRaw = raw;
            }
            // A nested name instead makes the PARENT declare a slot (added below).
        }
        else if (isEventAttr(name)) {
            const h = emitHandler(name, raw, undefined, undefined, undefined, mGen, methodEntries, delegateList, delegateEvents, el, true);
            noteCodeMember(h.body, h.srcLine);
        }
        else {
            let con = parseConstraint(raw);
            // A `%` value on a size/numberExpression attribute becomes a constraint.
            let ctype = null;
            let literal = false;
            if (!con && raw.trim().endsWith("%")) {
                try {
                    ctype = resolveConstraintType(superTag, name, parentTag);
                }
                catch {
                    ctype = null;
                }
                const pexpr = percentConstraintExpr(ctype, name, raw);
                if (pexpr)
                    con = { when: "", expr: pexpr };
            }
            // A plain value on an attribute whose INHERITED declaration is
            // when="once|always" becomes a literal constant constraint with that
            // timing (e.g. `<multistatebutton reference="parent">`, where `reference`
            // is declared when="once" in basebutton). Standard once/always setter via
            // setAttribute — NOT the inherited attribute's custom setter.
            if (!con && !isEventAttr(name)) {
                const iw = ctx.inheritedWhen(superTag, name);
                if (iw === "once" || iw === "always") {
                    const ac = attrConstraint(raw, iw);
                    if (ac) {
                        con = { when: ac.when, expr: ac.expr };
                        literal = ac.literal;
                    }
                }
            }
            if (con) {
                if (con.when === "style") {
                    attrs[name] = styleConstraintExpr(name, resolveConstraintType(superTag, name, parentTag), con.expr);
                }
                else if (con.when === "immediately") {
                    // $immediately{expr}: evaluated once and set directly as the value (no
                    // constraint, no $m) — a computed immediate, like a plain value. The debug
                    // build prints it compress=false (spaced binary ops: `60 - 11`, not `60-11`
                    // — calendar infopanel basebutton x="$immediately{60-11}").
                    attrs[name] = (COMPILE_DEBUG ? compileExprDebug(con.expr) : compileExpr(con.expr)) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
                    hasLiteralAttr = true; // a $immediately value wraps in #beginAttribute (verified)
                }
                else {
                    if (con.when !== "" && con.when !== "once" && con.when !== "path")
                        throw new Unsupported(`$${con.when}{} constraint`);
                    const declared = ctype ?? resolveConstraintType(superTag, name, parentTag);
                    // A literal color value wraps the raw value in convertColor (the
                    // once/always setter is not canonicalized).
                    const setterExpr = literal && declared === "color"
                        ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
                    const endLn = el.endLine ?? el.line ?? 0;
                    // Setter/deps bodies track at the element's SAX startLineNumber (= the
                    // `>`-line = endLine; RULE 8). The oracle's stock 4096-char parser buffer
                    // produced an occasional #line off-by-one drift here; the project's oracle
                    // carries a buffer-size fix (modern-build/oracle/patch) that removes it, so
                    // ALL setter/deps bodies are drift-free at endLine — no per-element quirk.
                    const cc = COMPILE_DEBUG
                        ? compileConstraintDebug(name, declared, setterExpr, con.when, mGen, debugFile(el), endLn)
                        : compileConstraint(name, declared, setterExpr, con.when, mGen);
                    noteCodeMember(cc.lastBody, cc.lastSrcLine);
                    if (name === "datapath") {
                        // A `datapath` constraint is `canHaveMethods=false` (NodeModel.java:
                        // 1046): its binder/deps methods are moved to the instance (compiled
                        // as closures in the attrs map) with void-0 decl slots in the class.
                        for (const e of cc.entries) {
                            // `splitEntry` consumes the `,`/`, ` separator (debug uses a spaced
                            // `, ` from `ent`), so the value has NO leading space — otherwise it
                            // would double the `: ` space in the emitted attrs object ($m63:  fn).
                            const m = splitEntry(e);
                            methodEntries.push(voidSlot(m.name));
                            attrs[m.name] = m.value;
                        }
                    }
                    else {
                        methodEntries.push(...cc.entries);
                    }
                    attrs[name] = cc.initExpr;
                }
            }
            else if (valueTypeOf(superTag, name) === "color") {
                // A color attribute is when="once": a non-canonicalizable color value
                // becomes a once-constraint (setter + LzOnceExpr), else a plain literal.
                const cv = colorValue(name, raw, resolveConstraintType(superTag, name, parentTag), mGen, debugFile(el), el.endLine ?? el.line ?? 0);
                if ("plain" in cv) {
                    attrs[name] = cv.plain + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
                    hasLiteralAttr = true;
                } // a plain color literal wraps in #beginAttribute
                else {
                    methodEntries.push(...cv.entries);
                    attrs[name] = cv.init;
                    noteCodeMember(cv.cc.lastBody, cv.cc.lastSrcLine);
                }
            }
            else {
                attrs[name] = compileAttr(superTag, name, raw, false, valueTypeOf) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
                hasLiteralAttr = true; // a plain immediate value attr wraps in #beginAttribute
            }
        }
    }
    if (pendingNameBinderRaw !== undefined) {
        // bind_name follows bind_id in a shared line counter that is NOT reset between
        // the two binders (both are compiled in the same NodeModel text). So when this
        // element ALSO declares an `id`, the name binder's source line starts after the
        // id binder's full function text (el.endLine + the id binder's line span);
        // otherwise it sits at el.endLine. (NodeModel:966/980 — id added before name.)
        const baseLine = el.endLine ?? el.line ?? 0;
        const nameLine = el.attrs["id"] != null ? baseLine + binderLineSpan(true) : baseLine;
        attrs["$lzc$bind_name"] = COMPILE_DEBUG
            ? idBinderDebug(pendingNameBinderRaw, false, debugFile(el), nameLine)
            : idBinder(pendingNameBinderRaw, false);
    }
    // A top-level `name` is also a global — UNLESS this element's `id` already
    // declared the same name (e.g. dashboard's `id="dailyContent" name="dailyContent"`):
    // the oracle registers each `var <name>=null` once, so the id's global covers it.
    // (The bind_name binder above is still emitted — only the duplicate global is
    // suppressed.)
    if (pendingNameGlobal !== undefined && pendingNameGlobal !== el.attrs["id"]) {
        globals.push(pendingNameGlobal);
        addKnownId(pendingNameGlobal);
        globalOrigins.push(el.origin ?? "");
    }
    // Child elements in document order: handlers/methods → methods (allocate now);
    // view children → recurse (allocates their subtree's gensyms, interleaved).
    // A named child declares a `<name>:void 0` reference slot on this node.
    const children = [];
    let datapathNode;
    let textParts = "";
    // A literal `<dataset>`'s children ARE the XML data (captured in `initialdata`
    // above); the oracle sets includeChildren=false so they are not view children.
    for (const c of datasetLiteral ? [] : el.children) {
        if (c.type === "text") {
            textParts += c.value;
            continue;
        }
        if (c.name === "doc")
            continue;
        // HTML markup elements are never view children (NodeModel.addChildren:1246 —
        // ignored; the text compiler folds them into the `text` attribute below).
        if (isHTMLElement(c.name))
            continue;
        if (c.name === "handler") {
            const h = compileHandler(c, mGen, methodEntries, delegateList, delegateEvents);
            noteCodeMember(h.body, h.srcLine);
        }
        else if (c.name === "method") {
            methodEntries.push(compileMethod(c));
            noteCodeMember(c.children.map((n) => (n.type === "text" ? n.value : "")).join("") + "\n#endContent", c.line ?? 0);
        }
        else if (c.name === "attribute") {
            // Instance-level <attribute>: a void-0 decl slot (in the anon class) plus
            // its value (instance attrs) and optional setter method.
            const an = c.attrs["name"];
            if (!an)
                throw new Unsupported(`<attribute> without name`);
            const raw = "value" in c.attrs ? c.attrs["value"] : null;
            const con = attrConstraint(raw, c.attrs["when"]);
            // A state instance installs its members inline (no anon class), so an
            // <attribute> declares no void-0 slot — its value/constraint goes in attrs.
            const slot = isInherited(superTag, an) || ctx.isStateClass(superTag) ? [] : [voidSlot(an)];
            const setLine = c.endLine ?? c.line ?? 0;
            const setterEntry = c.attrs["setter"] != null
                ? [COMPILE_DEBUG
                        ? ent("$lzc$set_" + an, compileFunctionDebug("set " + an, [an], c.attrs["setter"], [], debugFile(c), setLine, setLine + 1, false, "report", true, "set " + an))
                        : `${jsString("$lzc$set_" + an)},${compileFunction([an], c.attrs["setter"])}`]
                : [];
            if (con && con.when === "immediately") {
                // $immediately{expr} on an <attribute>: an eager value (NodeModel
                // WHEN_IMMEDIATELY), emitted as a plain raw expression (sc-folded), NOT a
                // constraint — same as a default attr value but from the constraint syntax.
                methodEntries.push(...slot, ...setterEntry);
                if (!isInherited(superTag, an))
                    attrSlots.push(an);
                attrs[an] = COMPILE_DEBUG ? compileExprDebug(con.expr) : compileExpr(con.expr);
            }
            else if (con && con.when === "style") {
                const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(superTag, an);
                methodEntries.push(...slot, ...setterEntry);
                attrs[an] = styleConstraintExpr(an, declared, con.expr);
            }
            else if (con) {
                if (con.when !== "" && con.when !== "once" && con.when !== "path")
                    throw new Unsupported(`$${con.when}{} constraint`);
                const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(superTag, an);
                // A literal `when=` color value wraps the RAW value in convertColor (the
                // constraint setter is not canonicalized, unlike a default attr).
                const litType = con.literal ? (c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(superTag, an)) : null;
                const setterExpr = litType === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
                // A `<attribute name="resource" value=… when=…/>` element child is HOISTED
                // by the oracle (ViewCompiler.compileResources) onto the parent view as a
                // `resource="$when{value}"` tag-attribute, then the `<attribute>` element is
                // REMOVED. So the constraint's source location is the PARENT view's start-tag
                // (el), not the `<attribute>` element (c) — verified via -SS: only `resource`
                // (uniquely hoisted) anchors at the parent's endLine; every other attribute
                // keeps its own. (calendar cal-button iconv #148 / amazon classlib tabButton #65.)
                const conSrc = an === "resource" ? el : c;
                const cc = COMPILE_DEBUG
                    ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(conSrc), conSrc.endLine ?? conSrc.line ?? 0)
                    : compileConstraint(an, declared, setterExpr, con.when, mGen);
                noteCodeMember(cc.lastBody, cc.lastSrcLine);
                methodEntries.push(...cc.entries, ...slot, ...setterEntry);
                attrs[an] = cc.initExpr;
            }
            else {
                // The void-0 slot stays in document order within the class decls, but a
                // pure-value attribute (no setter) does NOT by itself force an anon class
                // (see emitNode's real-method check); `attrSlots` records it so a
                // valueless one still defaults to `name:void 0` in a plain instance.
                methodEntries.push(...slot, ...setterEntry);
                // A non-inherited <attribute> with no value defaults to `name:void 0` in
                // the instance attrs (emitNode only applies it if no value is set, so a
                // setter-with-value attribute keeps its value).
                if (!isInherited(superTag, an))
                    attrSlots.push(an);
                if (raw != null) {
                    if (an === "resource" && !c.attrs["type"] && !parseConstraint(raw) && !/^(?:https?|ftp|file|soap):/.test(raw)) {
                        // `<attribute name="resource" value="x"/>` is the longhand of a
                        // `resource="x"` attr: the oracle resolves it through resource import
                        // (a `<state>`'s state-applied `resource` is registered + quoted as a
                        // name string), NOT the untyped-attribute "expression" path — so it
                        // must register the media + emit the gensym/named-resource NAME string
                        // (cal-button `<state><attribute name="resource" value="leftcap_oval"/>`
                        // → `resource:"leftcap_oval"`, not the bare identifier).
                        attrs[an] = jsString(registerResource(raw, c.origin));
                    }
                    else {
                        // An untyped <attribute> declares a NEW attribute → type "expression"
                        // (raw, sc-compiled). A redeclared (inherited) one keeps the inherited
                        // type; an explicit type= always wins.
                        const declared = c.attrs["type"]
                            ? mapType(c.attrs["type"])
                            : isInherited(superTag, an) ? valueTypeOf(superTag, an) : mapType("expression");
                        attrs[an] = compileTypedValue(declared, raw, false);
                    }
                }
            }
        }
        else if (c.name === "event") {
            const en = c.attrs["name"];
            if (!en)
                throw new Unsupported(`<event> without name`);
            if (!isInherited(superTag, en))
                methodEntries.push(voidSlot(en));
            attrs[en] = "LzDeclaredEvent";
        }
        else if (c.name === "setter") {
            const sn = c.attrs["name"];
            if (!sn)
                throw new Unsupported(`<setter> without name`);
            const { names, defaults } = parseArgs(c.attrs["args"] || "");
            const sbody = c.children.map((n) => (n.type === "text" ? n.value : "")).join("");
            methodEntries.push(COMPILE_DEBUG
                ? ent("$lzc$set_" + sn, compileFunctionDebug("set " + sn, names, sbody, defaults, debugFile(c), c.line ?? 0, bodyLineOf(c), false, "report", true, "set " + sn))
                : `${jsString("$lzc$set_" + sn)},${compileFunction(names, sbody, defaults)}`);
            // A `<setter>` element is a code member: its body (with the `#endContent`
            // sentinel, RULE 9) feeds the synthetic-ctor source-line sim. Base it at the
            // body's first source line (bodyLineOf), matching compileFunctionDebug.
            noteCodeMember(sbody + "\n#endContent", bodyLineOf(c));
        }
        else if (isPropertyElement(c.name)) {
            // other property elements (passthrough, etc.) — ignored
        }
        else if (c.name === "datapath") {
            // A <datapath> child → the node's `$datapath` (not a regular child, no
            // $classrootdepth). A method/handler-bearing datapath is `canHaveMethods
            // =false` like a <state>: its methods/handlers install INLINE in the
            // $datapath asMap's `attrs` (no anon subclass), so it is routed via the
            // isState path in emitNode.
            if (datapathNode)
                throw new Unsupported(`multiple <datapath> children`);
            datapathNode = buildNode(c, ctx, false, null, superTag);
            if (datapathNode.datapath)
                throw new Unsupported(`nested <datapath>`);
            if (datapathNode.methodEntries.some((e) => !isVoidSlot(e)))
                datapathNode.isState = true;
        }
        else {
            // A named view child: its `"name",void 0` reference slot interleaves with
            // methods/attrs in document order (NodeModel emits child decls inline), and
            // also appears as `name:void 0` in the instance attrs (slotNames).
            if (c.attrs["name"] != null) {
                slotNames.push(c.attrs["name"]);
                // A state instance installs members inline (no anon class, no void-0
                // decl slots), so its named-child slots stay in attrs only.
                if (!ctx.isStateClass(superTag)) {
                    methodEntries.push(voidSlot(c.attrs["name"]));
                    inlineSlots.push(c.attrs["name"]);
                }
            }
            // assignClassRoot increments depth per level EXCEPT through a state node
            // (NodeModel.java:2276 — `if (!parentClassModel.isstate) depth++`).
            const childDepth = classDepth == null ? null : classDepth + (ctx.isStateClass(superTag) ? 0 : 1);
            children.push(buildNode(c, ctx, false, childDepth, superTag));
        }
    }
    // addStateChildren (NodeModel.java:639): a non-state node hoists the named
    // children of any state-instance child up as its own reference slots (so they
    // resolve by name), appended after the regular named-child slots.
    if (!ctx.isStateClass(superTag)) {
        for (const c of childViews(el)) {
            if (!ctx.isStateClass(c.name))
                continue;
            for (const h of collectNamedChildren(childViews(c), c.name, ctx))
                if (!slotNames.includes(h) && !(h in attrs))
                    slotNames.push(h);
        }
    }
    // addText (NodeModel.addText): if this element's class has a `text` instance
    // attribute, its HTML/text content folds into the `text` attribute. An element
    // that is itself an inputtext gets getInputText (no HTML); anything else with
    // text content gets getHTMLContent (XHTML markup serialized + normalized).
    if (ctx.hasTextContent(superTag) && !("text" in attrs)) {
        const text = ctx.isInputTextTag(superTag) ? getInputText(el) : getHTMLContent(el);
        // Text folded from element CONTENT (not a `text=` attr) is NEUTRAL for the
        // reg-trailer Pattern A/B discriminator: it neither sets `hasLiteralAttr` (so a
        // canvas child whose ONLY literal is folded text — e.g. basics `<text>Hello
        // World!</text>` — stays Pattern B, gold-verified) NOR
        // `subtreeHasScriptOrContent` (so it does NOT block Pattern A when the element
        // ALSO has a genuine literal value attr — e.g. dragdrop `<text x="5" y="5">…`,
        // animation/button/edittext/slider trailers are Pattern A, gold-verified). The
        // `color-$3`/`databinding-$10` Pattern-B anomaly is a trailing `<script>` element
        // (a SEPARATE instance via the script path, which sets subtreeHasScriptOrContent
        // directly), not folded text.
        if (text.length !== 0) {
            attrs["text"] = jsString(text);
        }
    }
    else if (textParts.trim() && !ctx.hasTextContent(superTag)) {
        // Stray text content on a class with no `text` attribute: the oracle warns
        // and drops it. We refuse cleanly rather than silently miscompile.
        throw new Unsupported(`unexpected text content in <${el.name}>`);
    }
    // Class-defined descendants carry `$classrootdepth` (assignClassRoot), added
    // last so its anon-class void-0 slot follows the constraint/handler methods.
    if (classDepth != null)
        attrs["$classrootdepth"] = String(classDepth);
    // Aggregate the reg/trailer discriminator flags (S36). A node's OWN source-literal
    // value attrs are always in its `LzInstantiateView({attrs:…})` source. Its CHILDREN
    // are inlined into that instance source (`children:[…]`) ONLY for a PLAIN instance;
    // a method-bearing node becomes an anon class whose children are hoisted into the
    // CLASS `Class.make` body (a SEPARATE earlier translation unit), so those children's
    // literals do NOT affect THIS instance's closing `#file` context. So only inline
    // (non-anon-class) children contribute. (viewresource: outer `<view>` has an oninit
    // handler → anon class mh1, its `<view bgcolor="red"/>` child is class-hoisted → the
    // instance attrs are just `$delegates` → no literal → Pattern B, matching the gold.)
    // A `<datapath>` child compiles to an instance attr (`$datapath:<asMap>`), so it
    // IS in the instance source and contributes regardless.
    const becomesAnonClass = methodEntries.some((e) => !isVoidSlot(e)) && !ctx.isStateClass(superTag);
    const subtreeHasLiteralAttr = hasLiteralAttr
        || (!becomesAnonClass && children.some((c) => c.subtreeHasLiteralAttr))
        || (datapathNode?.subtreeHasLiteralAttr ?? false);
    const subtreeHasScriptOrContent = (!becomesAnonClass && children.some((c) => c.subtreeHasScriptOrContent))
        || (datapathNode?.subtreeHasScriptOrContent ?? false);
    // The LAST `#line` the children static block emits, in serialization order:
    // this node's own literal attrs serialize BEFORE its children's, so the answer is
    // the LAST child (document order) that has a literal in its subtree → recurse; if
    // no child does, fall back to this node's own literal-attr line (el.endLine).
    let subtreeLastLiteralLine = hasLiteralAttr ? (el.endLine ?? el.line ?? undefined) : undefined;
    if (!becomesAnonClass)
        for (const c of children)
            if (c.subtreeLastLiteralLine != null)
                subtreeLastLiteralLine = c.subtreeLastLiteralLine;
    return { superTag, methodEntries, attrs, delegateList, delegateEvents, children, slotNames, inlineSlots, attrSlots, datapath: datapathNode, isState: ctx.isStateClass(superTag), isInterface: ctx.interfaces.has(superTag), el, lastMemberBody, lastMemberSrcLine, idBinderSpec, subtreeHasLiteralAttr, subtreeHasScriptOrContent, subtreeLastLiteralLine, topLevelHasIdOrName: topLevel && (el.attrs["name"] != null || el.attrs["id"] != null) };
}
/** Pass 2 — emit a built node: allocate this node's anon-class name BEFORE
 *  recursing (pre-order), emit child class defs BEFORE this node's class def,
 *  and return the class definitions plus this node's instantiation map. */
function emitNode(node, resolve, inheritsChildren, mGen, compileClass) {
    if (node.script != null)
        return {
            defs: "",
            map: COMPILE_DEBUG
                ? `{"class": lz.script, attrs: {script: ${node.script}}}`
                : `{"class":lz.script,attrs:{script:${node.script}}}`,
        };
    // An instance becomes an anon class only for REAL methods (function-valued
    // entries) — bare void-0 slots (pure-value <attribute>/<event>/named-child
    // references) don't force a class; their values live in the instance attrs.
    const hasMethods = node.methodEntries.some((e) => !isVoidSlot(e));
    // A method-bearing instance of an `<interface>` (e.g. a richinputtext with a
    // `width="${…}"` constraint) becomes an anon subclass that EXTENDS the
    // interface's implementation class `$lzc$class_<name>` — resolved by NAME (the
    // `<interface>` itself emits no class def via compileClass, which returns "";
    // the real class comes from the library's AS3 `<script>`). The anon-class path
    // below (className) handles this uniformly: resolve(superTag) yields
    // $lzc$class_richinputtext, inheritsChildren(interface)=true gives
    // mergeChildren([], $lzc$class_richinputtext["children"]).
    // Anon-class name allocated before children (asMap creates the class, then
    // recurses into childrenMaps). A state instance never gets an anon class — its
    // methods install inline in the attrs map (canHaveMethods=false), so it
    // consumes no `$m` for a class name.
    const className = hasMethods && !node.isState ? `$lzc$class_${mGen.next().slice(1)}` : null;
    // Forward-reference emission (NodeModel.asMap): an anon subclass compiles its
    // super FIRST (emitClassDeclaration ClassModel.java:698, before childrenMaps),
    // so a not-yet-emitted user superclass is emitted before this node's children.
    // (For a plain instance the instantiated class is compiled AFTER children — see
    // below — matching asMap's forward-ref at line 2255, which fires post-childrenMaps.)
    const anonSuperDef = className ? compileClass(node.superTag) : "";
    const childResults = node.children.map((c) => emitNode(c, resolve, inheritsChildren, mGen, compileClass));
    let childDefs = childResults.map((r) => r.defs).join("");
    const childMaps = childResults.map((r) => r.map);
    // Finalize non-method props: clickable + $delegates.
    const attrs = { ...node.attrs };
    // A <datapath> child → `$datapath:<asMap>` + `datapath:LzNode._ignoreAttribute`.
    if (node.datapath) {
        const dp = emitNode(node.datapath, resolve, inheritsChildren, mGen, compileClass);
        childDefs += dp.defs;
        // A $datapath sub-map ending with a CONSTRAINT value (e.g. `p: new LzAlwaysExpr`,
        // from `<datapath p="${...}"/>`) leaves the running Token.currentPathname reset to
        // "" via the constraint's compileAttribute `#file ` — but unlike a literal attr, a
        // constraint emits NO litReset, so the OUTER instance's following `$lzc$bind_id`
        // (alphabetically after `$datapath`) would wrongly stay Pattern B. We emit a
        // pathOnlyReset so it becomes Pattern A. N (its $reportException("", N) positional
        // line) is the binder `function`'s line in the concatenated NodeModel script,
        // counted by the JavaCC lexer relative to the deps body's last `#line`
        // (= datapath.lastMemberSrcLine); the datapath-map tail between that #line and the
        // binder is 8 source lines (deps fn body close + `#file ` + `p: new LzAlwaysExpr` +
        // binder). Verified via -SS calendar-src dump (infopanel: deps@166 → binder@174).
        // A datapath ending in a LITERAL attr (amazon `xpath: "..."`) is EXCLUDED: that attr
        // already emits its own litReset (correct path + N), so no double-reset here.
        const dpHasConstraint = node.datapath.lastMemberSrcLine !== undefined;
        const dpReset = COMPILE_DEBUG && dpHasConstraint
            ? pathOnlyReset(node.datapath.lastMemberSrcLine + 8) : "";
        attrs["$datapath"] = dp.map + dpReset;
        attrs["datapath"] = "LzNode._ignoreAttribute";
    }
    if (!("clickable" in attrs)) {
        const mouseAttr = Object.keys(attrs).some((k) => MOUSE_EVENTS.has(k));
        const mouseDelegate = [...node.delegateEvents].some((e) => MOUSE_EVENTS.has(e));
        if (attrs["cursor"] === "true" || mouseAttr || mouseDelegate)
            attrs["clickable"] = "true";
    }
    if (node.delegateList.length > 0)
        attrs["$delegates"] = "[" + node.delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
    // Named-child reference slots appear as `name:void 0` in the instance attrs
    // (asMap inits) — and additionally as array decls in the anon class below.
    for (const s of node.slotNames)
        attrs[s] = "void 0";
    // A pure-value <attribute> with no value defaults to `name:void 0` in the
    // instance attrs (its value, if any, is already present).
    for (const s of node.attrSlots)
        if (!(s in attrs))
            attrs[s] = "void 0";
    // State instance: its methods (constraint setters, <method>s, handlers) install
    // INLINE in the attrs map rather than in an anon subclass (canHaveMethods=false).
    if (node.isState) {
        for (const e of node.methodEntries) {
            // `splitEntry` consumes the `,`/`, ` separator (debug `ent` is spaced), so
            // the inlined value has no leading space — otherwise the emitted attrs
            // object doubles the `: ` space (`$m63:  (function …`).
            const m = splitEntry(e);
            if (!m)
                throw new Unsupported(`state instance with declaration slot`);
            // A void-0 declaration slot is a state/datapath canHaveMethods=false node's
            // `<attribute name=X value=V/>`: its real value V is already in `attrs[X]`
            // (set during buildNode, keyed by name so the sorted asMap keeps document
            // order) — the slot has NO separate decl form inline (NodeModel installs the
            // value directly), so keep the existing value rather than overwriting with
            // void 0. (explore-nav menubutton's <datapath><attribute name="doneDel"
            // value="null"/> → `doneDel:null` inline in the $datapath attrs.) A void-0
            // slot with NO backing attr value is a genuine declaration slot we don't yet
            // model on a state instance → refuse.
            if (m.value === "void 0") {
                if (m.name in attrs)
                    continue;
                throw new Unsupported(`state instance with declaration slot`);
            }
            attrs[m.name] = m.value;
        }
    }
    if (className) {
        // Method-bearing instance → anonymous subclass; children are its class
        // defaults (no $classrootdepth — anon instance classes aren't isclassdef),
        // merged with the super's children when it inherits any.
        const inherits = inheritsChildren(node.superTag);
        let childrenJs = null;
        if (childMaps.length > 0 || inherits) {
            const arr = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
            childrenJs = inherits ? `LzNode.mergeChildren(${arr}${COMPILE_DEBUG ? ", " : ","}${resolve(node.superTag)}["children"])` : arr;
        }
        // Anon-class instance props: methods (with regular named-child slots already
        // interleaved in document order), then any state-HOISTED named-child slots
        // (not inlined), then `$classrootdepth` for class-defined nodes.
        const slotEntries = node.slotNames
            .filter((s) => !node.inlineSlots.includes(s))
            .map((s) => voidSlot(s));
        const crd = "$classrootdepth" in node.attrs ? [voidSlot("$classrootdepth")] : [];
        // A class-defined node with a <datapath> declares a `$datapath` slot too,
        // after $classrootdepth (in addition to the `$datapath:<asMap>` instance attr).
        const dpSlot = node.datapath ? [voidSlot("$datapath")] : [];
        const instEntries = [...node.methodEntries, ...slotEntries, ...crd, ...dpSlot];
        const classDef = COMPILE_DEBUG
            ? emitAnonClassDebug(className, resolve(node.superTag), node.superTag, instEntries, childrenJs, node)
            : emitAnonClass(className, resolve(node.superTag), node.superTag, instEntries, childrenJs);
        const spec = { class: className };
        if (Object.keys(attrs).length > 0)
            spec.attrs = emitObj(attrs);
        // Order: anon's super (compiled first), then its children's defs, then its own.
        if (DEBUG_STMTS) {
            pushDebug(classDef);
            return { defs: "", map: emitObj(spec) };
        }
        return { defs: anonSuperDef + childDefs + classDef, map: emitObject(spec) };
    }
    // Plain instance → no class; own children go in the instance map. The
    // instantiated user class is compiled AFTER children (asMap's post-childrenMaps
    // forward-ref) — its def (with its own transitive forward-refs) follows.
    // An `<interface>` instance instead uses `tag:"name"` deferred indirection
    // (NodeModel.asMap: `"class":<ref>` only for anonymous/builtin/class-defined
    // tags) and pulls in no class definition.
    const plainSuperDef = node.isInterface ? "" : compileClass(node.superTag);
    const spec = node.isInterface
        ? { tag: jsString(node.superTag) }
        : { class: resolve(node.superTag) };
    if (Object.keys(attrs).length > 0)
        spec.attrs = emitObj(attrs);
    // First-child id-binder on a PLAIN instance: when this plain instance has NO own
    // attrs (so its asMap is `{class:…, children:[{attrs:{$lzc$bind_id:…}}]}` and the
    // first child's binder is serialized immediately after the parent's instantiation
    // `#line` directive — no intervening attr `#line` reset), the binder's funcLine is
    // the PARENT's instantiation line (= node.el.endLine, the `>`-line emitted at the
    // LzInstantiateView directive), NOT the child's own el.endLine. (lzunit-$5 bluebox:
    // parent `<view>`@5 wraps `<view id="bluebox">`@6 → binder funcLine 5, gold-verified
    // via -SS lzunit-$5-src-165: `#line 5` precedes the bind_id function.) Mirrors the
    // anon-class re-point (classLine+3) for the plain-instance/no-attrs case.
    if (COMPILE_DEBUG && Object.keys(attrs).length === 0) {
        const fb = node.children[0]?.idBinderSpec;
        if (fb)
            fb.funcLine = node.el?.endLine ?? node.el?.line ?? fb.funcLine;
    }
    if (childMaps.length > 0)
        spec.children = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
    if (DEBUG_STMTS)
        return { defs: "", map: emitObj(spec) };
    return { defs: childDefs + plainSuperDef, map: emitObject(spec) };
}
/** The `$lzc$bind_id` / `$lzc$bind_name` binder function (a constant template;
 *  the `$debug`/`$as3` branches fold out). `setId` (true for id) also assigns
 *  the node's DOM `.id`. Mirrors NodeModel.buildIdBinderBody. */
function idBinder(symbol, setId) {
    const s = jsString(symbol);
    const onBind = setId ? `$0.id=${s};${symbol}=$0` : `${symbol}=$0`;
    const onUnbind = setId ? `${symbol}=null;$0.id=null` : `${symbol}=null`;
    return (`function($0,$1){\nswitch(arguments.length){\ncase 1:\n$1=true;\n\n};` +
        `if($1){\n${onBind}\n}else if(${symbol}===$0){\n${onUnbind}\n}}`);
}
/** The buildIdBinderBody SOURCE (NodeModel:787), with `$debug`/`$as3` left intact
 *  for the constant-folder (debug: `$debug`→true keeps the Debug.warn block;
 *  `$as3`→false drops the `global[…]` lines, preserving their source lines as
 *  blank padding). The `#pragma userFunctionName=…` line is consumed by the lexer;
 *  the displayName is passed explicitly to compileFunctionDebug. Lexed from
 *  bodyBaseLine = methodLine+1 so the pragma sits on methodLine+1 and the
 *  `if ($lzc$bind)` body opens at methodLine+2 (matching the oracle). */
function idBinderBodySource(symbol, setId) {
    const q = jsString(symbol);
    return (`#pragma "userFunctionName=bind #${symbol}"\n` +
        `if ($lzc$bind) {\n` +
        `  if ($debug) {\n` +
        `    if (${symbol} && (${symbol} !== $lzc$node)) {\n` +
        `      Debug.warn('Redefining #${symbol} from %w to %w', \n` +
        `        ${symbol}, $lzc$node);\n` +
        `    }\n` +
        `  }\n` +
        (setId ? `  $lzc$node.id = ${q};\n` : ``) +
        `  ${symbol} = $lzc$node;\n` +
        `  if ($as3) { global[${q}] = $lzc$node; }\n` +
        `} else if (${symbol} === $lzc$node) {\n` +
        `  ${symbol} = null;\n` +
        `  if ($as3) { global[${q}] = null; }\n` +
        (setId ? `  $lzc$node.id = null;\n` : ``) +
        `}\n`);
}
/** Debug rendering of the id/name binder: a `Function("$lzc$node:LzNode,
 *  $lzc$bind:Boolean=true", buildIdBinderBody(...))` (NodeModel:966), routed
 *  through compileFunctionDebug → the displayName-IIFE + default-param switch +
 *  try/catch form. `elemLine` is the binding element's source line (its `>`). */
function idBinderDebug(symbol, setId, file, elemLine) {
    const userName = "bind #" + symbol;
    const body = idBinderBodySource(symbol, setId);
    // Register a B<idx> marker resolved at assembly time (translateAnnotatedUnit):
    // Pattern A (running currentPathname reset to "") → render file=""/N positional;
    // Pattern B → render with the real (file, elemLine). The renderer re-runs
    // compileBinderDebug for whichever (file, funcLine) the assembly pass selects.
    return registerBinder({
        render: (f, n) => compileBinderDebug(userName, body, f, n),
        file,
        funcLine: elemLine,
    });
}
/** The number of source lines a binder Function occupies in the shared (un-reset)
 *  line counter — so a following binder (bind_name after bind_id) starts at
 *  `funcLine + binderLineSpan`. The binder text is `function (…) {\n<body>}`: the
 *  header sits on funcLine, the body on the next N lines (N = body newlines), the
 *  closing `}` on funcLine+N+1, and the next construct on funcLine+N+2. The
 *  `symbol` only affects the body's CONTENT, not its line count, so use a dummy. */
function binderLineSpan(setId) {
    const body = idBinderBodySource("x", setId);
    const bodyNewlines = (body.match(/\n/g) || []).length;
    return bodyNewlines + 2;
}
/** Core of a handler (element or attribute): emit its reference and body
 *  methods into `methodEntries` (consuming `$m` in the oracle's order —
 *  reference method BEFORE body method) and append the
 *  `[event, method, reference|null]` triple to `delegateList`.
 *  Mirrors NodeModel.addHandlerInternal. */
function emitHandler(event, body, argsAttr, reference, methodAttr, mGen, methodEntries, delegateList, delegateEvents, srcEl, isAttr) {
    if (!event || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(event))
        throw new Unsupported(`<handler> needs a valid name`);
    if (reference === "")
        throw new Unsupported(`empty handler reference`);
    // The `<handler>` ELEMENT form trims a whitespace-only body to null
    // (addHandlerElement) → an empty element handler is a no-op the oracle refuses
    // ("declare the event instead"). The ATTRIBUTE form (onclick="…",
    // addHandlerFromAttribute) does NOT trim-to-null: an empty-string value
    // (onclick="") is a real (empty) body → emits a `function($0){}` method.
    const hasBody = isAttr ? body != null : body != null && body.trim().length > 0;
    if (!hasBody && methodAttr == null)
        throw new Unsupported(`empty <handler> (declare the event instead)`);
    const file = srcEl ? debugFile(srcEl) : "";
    // JDOM/SAX reports an element's line at its start-tag CLOSE (`>`/`/>`), so a
    // handler method (and an ATTRIBUTE handler's inline body, e.g. `onclick="…"`)
    // tracks at endLine — NOT the `<`-line and NOT the attribute's own line (a
    // multi-line start tag puts the attribute above the `>`). A `<handler>` ELEMENT's
    // body keeps its own text-content line (bodyLineOf).
    const isAttrHandler = !!(srcEl?.attrLines && event && srcEl.attrLines[event] != null);
    const hLine = srcEl?.endLine ?? srcEl?.line ?? 0;
    // reference="…" → a method computing the sender, allocated FIRST.
    let referencename = null;
    if (reference != null) {
        referencename = mGen.next();
        const refBody = `return (${reference});`;
        // NodeModel:1466 wraps the reference in a Function (forced withThis when
        // canHaveMethods=false) named `get <reference>`. For views (canHaveMethods),
        // it is a Method (withThis from free vars) — the common case here.
        methodEntries.push(COMPILE_DEBUG
            ? ent(referencename, compileFunctionDebug("get " + reference, [], refBody, [], file, hLine, hLine, false, "report", true, "get " + reference))
            : `${jsString(referencename)},${compileFunction([], refBody)}`);
    }
    else {
        delegateEvents.add(event);
    }
    // body → a generated method, allocated AFTER the reference method.
    let method = methodAttr ?? null;
    const bLine = isAttrHandler ? hLine : (srcEl ? bodyLineOf(srcEl) : hLine);
    if (hasBody) {
        if (method == null)
            method = mGen.next();
        // Handlers default to a single ignored argument ($lzc$ignore → $0).
        const { names, defaults } = argsAttr === undefined ? { names: ["$lzc$ignore"], defaults: [] } : parseArgs(argsAttr);
        if (COMPILE_DEBUG) {
            const dn = "handle " + (reference != null ? reference + "." : "") + event;
            // The `#pragma userFunctionName=handle …` is emitted ONLY for an
            // auto-generated method (NodeModel:1480 — when `method == null`); an
            // explicit method="…" carries no pragma, so it does NOT propagate the name
            // into nested function values.
            const propagate = methodAttr == null ? dn : null;
            methodEntries.push(ent(method, compileFunctionDebug(dn, names, body, defaults, file, hLine, bLine, false, "report", true, propagate)));
        }
        else {
            methodEntries.push(`${jsString(method)},${compileFunction(names, body, defaults)}`);
        }
    }
    delegateList.push(jsString(event));
    delegateList.push(method != null ? jsString(method) : "null");
    delegateList.push(referencename != null ? jsString(referencename) : "null");
    // The LAST code member this handler emits feeds the debug anon-class constructor
    // source-line simulation. When the handler has a body, that body method is last
    // (the reference method, if any, precedes it); its ScriptClass form is
    // `<body>\n#endContent\n` (NodeModel.addHandlerInternal:1488). When there is NO
    // body (a `method="X"` handler with only a `reference=`), the REFERENCE method
    // (`get <ref>`) is the last code member: its body is NodeModel:1465's
    // `return (#beginAttribute<srcloc><ref><endsrc>#endAttribute);` at the handler's
    // line — finalSourceLine of that drives the constructor line (explore-nav menu's
    // `<handler onbookmark reference="canvas" method="dataBound"/>` → ctor #386).
    if (hasBody)
        return { body: body + "\n#endContent\n", srcLine: bLine };
    if (reference != null)
        return { body: `return (${attrSrc(file, hLine, reference)});`, srcLine: hLine };
    return {};
}
/** Compile a `<handler>` child element. */
function compileHandler(c, mGen, methodEntries, delegateList, delegateEvents) {
    const body = c.children.map((n) => (n.type === "text" ? n.value : "")).join("");
    return emitHandler(c.attrs["name"], body, c.attrs["args"], c.attrs["reference"], c.attrs["method"], mGen, methodEntries, delegateList, delegateEvents, c);
}
/** The source line where an element's text-body content begins (the first text
 *  child's line), used as the lexer base line for an embedded method/handler body
 *  (so the body's statements carry true .lzx file lines). Falls back to the
 *  element's start line. */
function bodyLineOf(c) {
    for (const n of c.children)
        if (n.type === "text")
            return n.line ?? c.line ?? 0;
    return c.line ?? 0;
}
/** Compile a `<method>` child element to its `"name",function(…){…}` entry. */
function compileMethod(c) {
    const mn = c.attrs["name"];
    if (!mn)
        throw new Unsupported(`<method> without name`);
    const { names, defaults } = parseArgs(c.attrs["args"] || "");
    const body = c.children.map((n) => (n.type === "text" ? n.value : "")).join("");
    // A `<method allocation="class">` is a static (class-allocated) method: its
    // body is compiled WITHOUT the `with(this)` wrapper (NodeModel.addMethodInternal
    // omits the `#pragma 'withThis'` for ALLOCATION_CLASS — line 1619). The caller
    // routes it to the class-property array (not the instance member list).
    const isStatic = c.attrs["allocation"] === "class";
    if (COMPILE_DEBUG) {
        // The method's source-location directive (funcLine) and its body-lexer base
        // both derive from the element's START location, which SAX/JDOM reports at the
        // start tag's CLOSING `>` (CompilerUtils.attributeLocationDirective → sourceLocation
        // Directive(elt,true) → Parser.getSourceLocation(LINENO,start=true)). For a method
        // whose open tag spans lines (e.g. `<method name="x"\n args="…"><![CDATA[`), that `>`
        // is on `endLine`, not the `<` line — so a multi-line open tag tracks one line later.
        const startLine = c.endLine ?? c.line ?? 0;
        return ent(mn, compileFunctionDebug(mn, names, body, defaults, debugFile(c), startLine, startLine, false, "report", !isStatic));
    }
    return `${jsString(mn)},${compileFunction(names, body, defaults, !isStatic)}`;
}
/** Runtime compile-time constants for the DHTML target (CompilationEnvironment
 *  .setRuntimeConstants with runtime="dhtml"; $debug/$profile/$backtrace false in
 *  a non-debug build). Drives `<switch>`/`<when>`/`<unless>` selection. */
const COMPILE_CONSTANTS = {
    $runtime: "dhtml",
    $swf7: false, $swf8: false, $as2: false, $swf9: false, $swf10: false,
    $as3: false, $dhtml: true, $j2me: false, $svg: false, $js1: true,
    $debug: false, $profile: false, $backtrace: false,
};
/** Evaluate a `<when>`/`<unless>` condition (Parser.evaluateConditions): a
 *  `property=` resolves a compile-time constant (Boolean → its value; String →
 *  equality with `value=`); a `runtime=` compares the target runtime. */
function evalSwitchCondition(el) {
    const propname = el.attrs["property"];
    if (propname != null) {
        const prop = propname === "$debug" ? COMPILE_DEBUG : COMPILE_CONSTANTS[propname];
        if (prop === undefined)
            return false;
        if (typeof prop === "boolean")
            return prop;
        const value = el.attrs["value"];
        return value != null ? prop === value : false;
    }
    if (el.attrs["runtime"] != null)
        return COMPILE_CONSTANTS.$runtime === el.attrs["runtime"];
    throw new Unsupported(`<${el.name}> requires a property or runtime attribute`);
}
/** Evaluate a `<switch>` (Parser.evaluateSwitchStatement) → the selected arm's
 *  element children. First true `<when>`, then first false `<unless>` (which
 *  overrides), else `<otherwise>`. */
function evaluateSwitch(el) {
    for (const c of el.children)
        if (c.type === "elem" && c.name !== "when" && c.name !== "unless" && c.name !== "otherwise")
            throw new Unsupported(`<switch> clause <${c.name}>`);
    let selected = null;
    for (const c of el.children)
        if (c.type === "elem" && c.name === "when" && evalSwitchCondition(c)) {
            selected = c;
            break;
        }
    for (const c of el.children)
        if (c.type === "elem" && c.name === "unless" && !evalSwitchCondition(c)) {
            selected = c;
            break;
        }
    if (!selected)
        for (const c of el.children)
            if (c.type === "elem" && c.name === "otherwise") {
                selected = c;
                break;
            }
    return selected ? selected.children.filter((n) => n.type === "elem") : [];
}
/** Splice `<include href=…>` elements in place with the referenced file's
 *  top-level element children (recursively expanded; idempotent per file).
 *  Includes are resolved relative to the including file (`currentId`).
 *  Also evaluates `<switch>` blocks (the selected arm's children are spliced in,
 *  before include resolution so unselected arms' includes are never resolved). */
function expandIncludes(el, currentId, opts, seen, recordOrigins) {
    el.origin = currentId;
    recordOrigins?.add(currentId);
    // Assign this file its computeDeclarations rank the first time it is entered
    // (host files are always entered before the libraries they include).
    if (!ORIGIN_RANK.has(currentId))
        ORIGIN_RANK.set(currentId, ORIGIN_RANK_NEXT++);
    const out = [];
    const processChild = (c) => {
        if (c.type === "elem" && c.name === "include") {
            const href = c.attrs["href"];
            if (!href)
                throw new Unsupported(`<include> without href`);
            // `type="text"` embeds the referenced file's raw content as a text node
            // (Parser: a text include splices the file text in place — here it folds
            // into the enclosing element's text content via addText).
            if (c.attrs["type"] === "text") {
                const inc = opts.resolveInclude?.(href, currentId);
                if (!inc)
                    throw new Unsupported(`unresolved text include: ${href}`);
                out.push({ type: "text", value: inc.source, cdata: false });
                return;
            }
            // `type="binary"` embeds raw bytes — not supported; refuse cleanly.
            if (c.attrs["type"] != null && c.attrs["type"] !== "lzx")
                throw new Unsupported(`<include type="${c.attrs["type"]}">`);
            const inc = opts.resolveInclude?.(href, currentId);
            if (!inc)
                throw new Unsupported(`unresolved include: ${href}`);
            let incRoot;
            try {
                incRoot = parseXml(inc.source);
            }
            catch (e) {
                throw new Unsupported(`include ${href} parse: ${e.message}`);
            }
            if (incRoot.name === "library") {
                // A `<library>` root: the compiler processes it as a library
                // (LibraryCompiler) — idempotent (included once), its children spliced
                // in place (Parser.java:727, the isAtToplevel+isElement branch). Its
                // globals are declared by computeDeclarations as a SEPARATE library unit
                // (after the app's own tree → orderGlobals cat 2).
                if (seen.has(inc.id))
                    return;
                seen.add(inc.id);
                LIBRARY_ORIGINS.add(inc.id);
                expandIncludes(incRoot, inc.id, opts, seen, recordOrigins);
                for (const ic of incRoot.children)
                    if (ic.type === "elem")
                        out.push(ic);
            }
            else {
                // Any other file: the `<include>` is replaced with the included file's
                // ROOT element ITSELF (Parser.java:739) — NOT deduped, so repeated
                // includes each expand (e.g. two `<include>`s of a `<button>` file).
                // A non-library include is INLINED into the tree, so the oracle's
                // computeDeclarations visits its globals at this document position (same
                // unit as the host) — it is NOT a deferred library unit. Pre-seed its
                // origin rank to the host's so its globals stay in document order.
                if (!ORIGIN_RANK.has(inc.id))
                    ORIGIN_RANK.set(inc.id, ORIGIN_RANK.get(currentId) ?? 0);
                expandIncludes(incRoot, inc.id, opts, seen, recordOrigins);
                out.push(incRoot);
            }
        }
        else if (c.type === "elem" && c.name === "switch") {
            // Evaluate the switch, then re-dispatch each selected child through the
            // SAME per-child logic (the selected arm may itself contain <include> or a
            // nested <switch> that must be expanded — e.g. welcome.lzx's
            // <when><include href="rclock/clock.lzx"/></when>).
            for (const sel of evaluateSwitch(c))
                processChild(sel);
        }
        else {
            if (c.type === "elem")
                expandIncludes(c, currentId, opts, seen, recordOrigins);
            out.push(c);
        }
    };
    for (const c of el.children)
        processChild(c);
    el.children = out;
}
/** A `layout=` CSS attribute autoincludes its layout class (the CSS `class`
 *  property, default `simplelayout`) — ViewCompiler.collectLayoutElement.
 *  Constraint forms (`${…}`/`$once{…}`) aren't CSS, so they trigger nothing. */
function collectLayoutRef(el, referenced) {
    const layoutAttr = el.attrs["layout"];
    if (layoutAttr !== undefined && !/\$\{|\$once|\$path|\$style|^\s*\$/.test(layoutAttr)) {
        const m = /(?:^|;)\s*class\s*:\s*([A-Za-z_][\w-]*)/.exec(layoutAttr);
        referenced.add(m ? m[1] : "simplelayout");
    }
}
/** Collect defined class names and all referenced element tags in a tree. The
 *  root element's own `layout=` attribute is collected by the caller. */
function collectTags(el, defined, referenced) {
    for (const c of el.children) {
        if (c.type !== "elem")
            continue;
        if (c.name === "class" || c.name === "interface" || c.name === "mixin") {
            const n = c.attrs["name"];
            if (n)
                defined.add(n);
            // A class's superclass is a reference (ClassCompiler.collectReferences).
            const sup = c.attrs["extends"];
            if (sup)
                referenced.add(sup);
        }
        else if (!isPropertyElement(c.name) && c.name !== "doc") {
            referenced.add(c.name);
        }
        collectLayoutRef(c, referenced);
        collectTags(c, defined, referenced);
    }
}
/** Resolve component-library ordering — the oracle's getLibraries +
 *  handleAutoincludes (ToplevelCompiler). After explicit `<include>`s are spliced
 *  (`expandIncludes`, for reference discovery + non-library splices), this:
 *
 *  1. collects referenced tags from the full canvas tree (collectReferences);
 *  2. maps each referenced, autoincludable tag whose class is NOT defined inline
 *     in the canvas to its library — this INCLUDES libraries that were explicitly
 *     `<include>`d, because getLibraries (ToplevelCompiler.java:274-282) re-emits
 *     an explicitly-included library "where the auto-include would have been"
 *     (i.e. in sorted order, not at the include's document position);
 *  3. compiles those libraries in SORTED canonical-path order (a TreeSet),
 *     expanding each library's own `<include>`s depth-first with a shared `seen`
 *     so a dependency attaches to the first library that pulls it — exactly the
 *     order handleAutoincludes imports them, before any canvas content.
 *
 *  The library content is then a sorted prefix; canvas-direct content (inline
 *  classes, instances, non-library include splices, and explicitly-included
 *  libraries whose tag is NOT referenced) keeps its document position. */
function expandAutoincludes(root, opts, _seen) {
    const auto = opts.autoincludes;
    if (!auto)
        return 0;
    const sourceId = opts.sourceId ?? "";
    const defined = new Set();
    const referenced = new Set();
    // collectReferences scans the full (explicit-include-spliced) tree.
    collectTags(root, defined, referenced);
    collectLayoutRef(root, referenced); // the canvas's own layout= attribute
    // A referenced tag with a class definition already in the explicit-include tree
    // is NOT autoincluded — the existing definition shadows the LFC component. This
    // covers a class defined INLINE in the canvas (origin == source file) AND one
    // defined in an explicitly-`<include>`d app library (e.g. amazon's classlib.lzx
    // defines `<class name="radiobutton">`, which must NOT pull in lz/radio.lzx). The
    // ONE exception: a tag whose definition's origin IS the autoinclude target library
    // itself — that library was explicitly included, so it re-emits in sorted order
    // and the autoinclude is a redundant pull of the same file (handled by `seen`).
    // (AUTO_ORIGINS is still empty here — autoincludes haven't run — so every class in
    // the tree comes from the explicit-include expansion.)
    const definedOrigin = new Map(); // tag -> defining file
    for (const c of root.children)
        if (c.type === "elem" && (c.name === "class" || c.name === "interface" || c.name === "mixin")) {
            const n = c.attrs["name"];
            if (n && !definedOrigin.has(n))
                definedOrigin.set(n, c.origin ?? undefined);
        }
    // Map each app-referenced autoincludable tag (not already defined) to its lib.
    const libs = new Map(); // id -> lib
    for (const tag of referenced) {
        if (!auto[tag])
            continue;
        const inc = opts.resolveInclude?.(auto[tag], sourceId);
        if (!inc)
            continue;
        // If the tag is already defined somewhere OTHER than this very library, the
        // existing definition shadows the autoinclude — skip the pull.
        if (definedOrigin.has(tag) && definedOrigin.get(tag) !== inc.id)
            continue;
        libs.set(inc.id, inc);
    }
    // Compile the libraries in sorted canonical-id order (TreeSet), expanding each
    // library's <include>s depth-first with a shared `seen`. `seen` records every
    // library file pulled into this prefix, so the canvas tree can be partitioned.
    const seen = new Set();
    const prefix = [];
    for (const id of [...libs.keys()].sort()) {
        if (seen.has(id))
            continue;
        seen.add(id);
        const inc = libs.get(id);
        const libRoot = parseXml(inc.source);
        expandIncludes(libRoot, inc.id, opts, seen, AUTO_ORIGINS);
        for (const c of libRoot.children)
            if (c.type === "elem")
                prefix.push(c);
    }
    // Library content moves to the sorted prefix; everything whose origin is NOT a
    // pulled library (canvas-direct content, non-library include splices, and any
    // explicitly-included-but-unreferenced library) stays in document order.
    const canvasContent = root.children.filter((c) => !(c.type === "elem" && c.origin != null && seen.has(c.origin)));
    root.children = [...prefix, ...canvasContent];
    // Share the auto-prefix dedup with the caller's set (done AFTER the partition,
    // which needs `seen` to be JUST the auto-prefix libs). A later library splice —
    // the debugger closure (spliceDebuggerLibrary) — must NOT re-pull a library the
    // autoincludes already emitted (e.g. base/colors.lzx via base/style.lzx), which
    // would double-emit its `lz.colors.X = …` statements. The oracle's
    // computePropertiesAndGlobals dedups every library pass via ONE `visited` set.
    for (const id of seen)
        _seen.add(id);
    return prefix.length;
}
/** FORCED-DEBUG: pull in the debugger component library (debugger/library.lzx).
 *  ToplevelCompiler appends it after the sorted autoincludes and before canvas
 *  content; we splice its expanded element children at the FRONT of the canvas
 *  children (before expandAutoincludes runs, so its referenced component tags
 *  and transitive includes are collected/resolved), where they sort after the
 *  autoinclude prefix. The library root is `<library>` so its children splice
 *  in directly (the `<class name="debug">`, the swf-only `<switch>` → empty in
 *  dhtml, and `<include href="debugger.lzx">`). */
function spliceDebuggerLibrary(root, opts, seen, at) {
    const inc = opts.resolveInclude?.("debugger/library.lzx", opts.sourceId ?? "");
    if (!inc)
        throw new Unsupported(`debug build: cannot resolve debugger/library.lzx`);
    if (seen.has(inc.id))
        return;
    seen.add(inc.id);
    const libRoot = parseXml(inc.source);
    expandIncludes(libRoot, inc.id, opts, seen, AUTO_ORIGINS);
    const children = libRoot.children.filter((c) => c.type === "elem");
    // Insert as a document-order block after the sorted autoinclude prefix
    // (index `at`), before canvas content — matching ToplevelCompiler's
    // "libraries emit before canvas content, debugger appended last".
    root.children.splice(at, 0, ...children);
}
export function compile(source, opts = {}) {
    const root = parseXml(source);
    if (root.name !== "canvas") {
        return { js: "", unsupported: `root is <${root.name}>, expected <canvas>` };
    }
    // canvas debug="true" triggers the oracle's READABLE/debuggable script-compiler
    // backend (compress=false: spaced output, `/* -*- file: X#N -*- */` source-
    // location directives, blank-line source-line padding, debug variable naming
    // `name_$0`) AND pulls in the ~850KB debugger component library.
    //
    // INVESTIGATED (session 14, authoritative): the wall is the source-location
    // system (ParseTreePrinter.makeTranslationUnits). Every emitted `#N` is the
    // EXACT line of the construct in its ORIGINAL .lzx (verified: `<method>` at
    // line 3 → `#3`, its body at line 4 → `#4`), and the blank-line padding is
    // driven by `linediff = generatedLine - sourceLine`, so reproducing it
    // byte-for-byte demands an exact per-node source line on every AST node —
    // i.e. line tracking in the XML parser (currently none) matching JDOM/SAX,
    // PLUS embedded-script line offsets matching JavaCC, PLUS an exact cumulative
    // generated-line counter — reproduced across the ENTIRE debugger+component
    // closure with zero tolerance (one off-by-one cascades through linediff, and
    // the shared `$m` counter shifts ALL later gensyms — the app's own anon class
    // is `mh0`, hundreds in). There is no tractable subset: a debug build is
    // byte-for-byte (needs all of the above) or it is a diff, so a partial
    // readable backend would VIOLATE the refuse-don't-miscompile discipline.
    // This is exactly the "exact source-map positions" disproportionate case, for
    // a dev-only artifact of zero functional value to the DHTML-app DoD (the
    // runtime re-measures and production builds are non-debug). Clean UNSUP.
    //
    // FORCED-DEBUG (development only): `opts.debug` (set by the harness via
    // LZC_DEBUG_FORCE=1) bypasses this refusal to drive the readable backend. The
    // refusal stays the production default — a non-forced `debug="true"` build is
    // still refused. STATUS: the readable backend is BYTE-FOR-BYTE on dbg3.lzx (the
    // full debugger+component closure, 850579 B, verified), but the OTHER ~78 corpus
    // debug builds still have remaining divergences (file-path directives, `<debug>`
    // tag, a `parse: expected id` case) — see HANDOFF.md. Keep the refusal live until
    // ALL 83 debug builds are byte-for-byte, else flipping yields miscompiles (57
    // diffs), violating refuse-don't-miscompile.
    // A canvas is a debug build via `debug="true"` OR `compileroptions="debug: true…"`
    // (the latter also carries `backtrace: true` etc. — CanvasCompiler parses the
    // compileroptions string into compiler properties). Both route to the readable
    // backend; both are refused in production until all debug builds are byte-for-byte.
    const isDebugBuild = root.attrs["debug"] === "true"
        || /(?:^|;)\s*debug\s*:\s*true\b/.test(root.attrs["compileroptions"] ?? "");
    // A canvas `debug="false"` attribute (or `compileroptions="debug: false"`)
    // OVERRIDES the `--debug` command-line flag: Parser.java:418-422 runs
    // `env.setProperty(DEBUG_PROPERTY, dbg.equals("true"))` UNCONDITIONALLY when the
    // attribute is present, AFTER Main.java applied --debug, so the explicit attr
    // wins → a NON-debug build even under --debug. (lzproject's canvas carries
    // debug="false" → the oracle emits a plain production build despite --debug.)
    const canvasDebugOff = root.attrs["debug"] === "false"
        || /(?:^|;)\s*debug\s*:\s*false\b/.test(root.attrs["compileroptions"] ?? "");
    // `backtrace: true` (a compileroptions debug add-on) emits the LzBacktrace stack-
    // frame prefix in every function (DEBUG_BACKTRACE). The TS readable backend now
    // emits it BYTE-FOR-BYTE (verified RAW IDENTICAL on backtrace.lzx, 1340227 bytes;
    // see HANDOFF). It is a debug feature → it forces the debug backend on.
    const wantsBacktrace = opts.backtrace === true
        || /(?:^|;)\s*backtrace\s*:\s*true\b/.test(root.attrs["compileroptions"] ?? "");
    // The debug backend runs when `opts.debug` is set (the FORCED-DEBUG path, via
    // LZC_DEBUG_FORCE) — MIRRORING the oracle's `--debug` (`-g1`) flag (forces
    // DEBUG_PROPERTY=true for ANY canvas, Main.java:314) — OR when the SOURCE itself
    // declares the debug build (`debug="true"` / `compileroptions="debug: true"`),
    // which the oracle ALWAYS honors regardless of the CLI flag (CanvasCompiler sets
    // DEBUG_PROPERTY from the canvas attr). So a `debug="true"` source produces a
    // debug build EVEN in the non-debug batch — to match, honor it here. A canvas
    // that explicitly sets debug="false" (canvasDebugOff) suppresses the build (the
    // oracle's Parser honors the attr over the flag); a `backtrace: true` request is
    // refused (unimplemented feature) rather than miscompiled.
    const debug = (opts.debug === true || isDebugBuild || wantsBacktrace) && !canvasDebugOff;
    // `backtrace: true` (DEBUG_BACKTRACE) adds the per-function call-stack frame
    // instrumentation (noteCallSite + prelude/prefix/suffix; see sc.ts/debug.ts). The
    // architecture is implemented and byte-identical for the first ~133KB of the SOLO
    // LFC (the deps-body warnUndefinedReferences=false and super-dispatch nextMethod
    // notes ARE handled; the HANDOFF's "instance-property refinement" residual was a
    // MISDIAGNOSIS — setter bodies DO note instance props like `classroot`, only the
    // DEPS body suppresses them via #pragma warnUndefinedReferences=false). The
    // former class-default `mergeAttributes` constraint-init line-state blocker
    // (@133424) is now CLOSED by ORACLE FIX #3 (NodeModel anchors each `new
    // LzXxxExpr(...)` init to its declaration line, LPP-3949; TS mirror =
    // btNoteConstraintInit). The noteCallSite MARKER line-state was cracked via the
    // oracle -SS lineann dump → Printer.btSuperSeen models `Token.currentPathname`
    // (#0#0 vs #<file>#1): set file by a super-dispatch, a function-value, OR the `is`
    // operator's generated `$lzsc$isa` call (each re-lexes source). The backtrace
    // backend is now BYTE-FOR-BYTE on backtrace.lzx (RAW IDENTICAL, 1340227 bytes), so
    // a `backtrace: true` canvas COMPILES in production (no longer refused).
    const backtraceWanted = wantsBacktrace;
    const backtrace = backtraceWanted && debug;
    try {
        setScDebug(debug);
        setScBacktrace(backtrace);
        setDebugBacktrace(backtrace);
        resetKnownClassnames();
        resetKnownIds();
        resetBinderTable();
        resetRegTable();
        COMPILE_DEBUG = debug;
        COMPILE_BACKTRACE = backtrace;
        DEBUG_FILE = opts.debugFileName ?? ((id) => id);
        DEBUG_SOURCE_ID = opts.sourceId ?? "";
        SCRIPT_SRC = opts.resolveScriptSrc ?? null;
        DATASET_SRC = opts.resolveDatasetSrc ?? null;
        return compileInner(root, opts, debug);
    }
    finally {
        setScDebug(false); // never let the debug fold leak into the next compile
        setScBacktrace(false);
        setDebugBacktrace(false);
        COMPILE_DEBUG = false;
        COMPILE_BACKTRACE = false;
        DEBUG_FILE = (id) => id;
        DEBUG_STMTS = null;
        SCRIPT_SRC = null;
        DATASET_SRC = null;
    }
}
// The `<script src=…>` resolver (set in compile()'s try) — reads the referenced
// JS relative to the including file. null when unconfigured (→ refuse the feature).
let SCRIPT_SRC = null;
// The `<dataset src=…>` resolver (set in compile()'s try) — reads the referenced
// XML file relative to the including file, for non-top-level literal datasets.
let DATASET_SRC = null;
// The debug source-location filename resolver (set in compile()'s try). Maps an
// element's origin id to the directive filename. `debugFile(el)` is the filename
// for `el`'s defining file (the app source for elements with no origin).
let DEBUG_FILE = (id) => id;
let DEBUG_SOURCE_ID = "";
function debugFile(el) {
    return DEBUG_FILE(el.origin ?? DEBUG_SOURCE_ID);
}
/** The class-body `mergeAttributes` IIFE, rendered compress=false as an
 *  annotation stream (the `(function () { var $lzsc$temp = function ($0) { try {
 *  with ($0) with ($0.prototype) { { LzNode.mergeAttributes(<obj>, name.attributes)
 *  }}} catch {…} }; $lzsc$temp["displayName"]="<file>#<line>/1"; return $lzsc$temp
 *  })(name)` form). `classLine` is the class-open directive line (endLine−1);
 *  `bodyLine` is the class start-tag closing-`>` line (endLine) used for the
 *  with-statement + displayName. Verified vs the dbg3 gold. */
function debugMergeAttributes(file, classLine, bodyLine, classNameJs, objSpaced, mergeLine, noteLine) {
    const A = (n) => annoFileLine(file, n);
    const GEN = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    const bt = COMPILE_BACKTRACE;
    // Backtrace: the mergeAttributes call (and its `LzNode` receiver, a checked free
    // ref) get noteCallSite at the merge line (ctorLine+4). The frame uses fixed
    // registers $1/$2/$3 (one param $lzsc$c → $0).
    const M = noteLine ?? bodyLine;
    // noteCallSite marker = `#0#0` + (for a DIRECTIVE-FORM / state-class constructor
    // only) the `$lzsc$a.lineno=N` fragment's `#<file>#1`. currentPathname is the real
    // source file ONLY when the synthetic constructor is directive-form (mergeLine !=
    // null, ≡ !memberRich): its source-anchored ctor leaves the lexer static on the
    // file, so the mergeAttributes inherits `#<file>#1`. A PLAIN constructor leaves it
    // generated → `#0#0` (basefocusview etc.). Verified vs the -SS lineann dump
    // (resizestate → `#1`; basefocusview → none). N1 gated on mergeLine.
    const N1 = mergeLine != null ? annoFileLine(file, 1) : "";
    const mergeCall = bt
        ? `${GEN}${N1}$3.lineno = ${M}, (${GEN}${N1}$3.lineno = ${M}, LzNode).mergeAttributes(${objSpaced}, ${classNameJs}.attributes)`
        : `LzNode.mergeAttributes(${objSpaced}, ${classNameJs}.attributes)`;
    // A directive-form (state-class) constructor leaves the file context set to the
    // source file, so the following mergeAttributes statement tracks to a real
    // source line (= ctorLine + 4, the 4-line synthetic constructor span). A plain
    // constructor (file="") leaves the context generated → no directive here.
    const mergeDir = mergeLine != null ? A(mergeLine) : "";
    const withPart = `with ($0) with ($0.prototype) {\n${GEN}{\n${mergeDir}${mergeCall}\n}}`;
    // Backtrace frame prelude/prefix/suffix + catch reporting $3.lineno.
    const btPrelude = bt ? `var $1 = Debug;\nvar $2 = $1.backtraceStack;\n` : "";
    const btPrefix = bt
        ? `if ($2) {\nvar $3 = ["$lzsc$c", $0];\n$3.callee = arguments.callee;\n$3["this"] = this;\n` +
            `$3.filename = ${jsString(file)};\n$3.lineno = ${bodyLine};\n$2.push($3);\n` +
            `if ($2.length > $2.maxDepth) {\n$1.stackOverflow()\n}};\n`
        : "";
    const catchBody = bt
        ? `if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error)` +
            ` && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(${jsString(file)}, $3.lineno, $lzsc$e)\n} else {\nthrow $lzsc$e\n}`
        : debugCatchBody(file, bodyLine);
    const btFinally = bt ? `\n${GEN}finally {\nif ($2) {\n$2.length--\n}}` : "";
    const tryWrap = `try {\n${btPrefix}${A(bodyLine)}${withPart}}\n${GEN}catch ($lzsc$e) {\n${catchBody}}${btFinally}`;
    const funcBlock = `{\n${GEN}${btPrelude}${tryWrap}}`;
    const innerFn = `function ($0) ${funcBlock}${FB}`;
    const S1 = `var $lzsc$temp = ${innerFn};`;
    const S2 = `${A(bodyLine)}$lzsc$temp["displayName"] = ${jsString(file + "#" + bodyLine + "/1")};`;
    const S2bt = bt ? `\n${A(bodyLine)}$lzsc$temp["_dbg_filename"] = ${jsString(file)};` +
        `\n${A(bodyLine)}$lzsc$temp["_dbg_lineno"] = ${bodyLine};` : "";
    const S3 = `${A(bodyLine)}return $lzsc$temp`;
    const iife = `(function () {\n${S1}\n${S2}${S2bt}\n${S3}\n}${FB})()`;
    return `${A(classLine)}${iife}(${classNameJs})`;
}
/** The debug try/catch catch-clause body (re-exported shape of sc's
 *  debugCatchBody for use in compile.ts mergeAttributes/constructor rendering). */
function debugCatchBody(file, line) {
    return ('if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error)' +
        ' && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' +
        jsString(file) + ", " + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}");
}
// Per-compile debug flag (compile.ts side), mirroring sc's SC_DEBUG. Lets
// evalSwitchCondition fold `$debug` true for `<switch property="$debug">` deep
// in include expansion without threading the flag through every signature. Set
// in compile()'s try, reset in its finally — never leaks into production.
let COMPILE_DEBUG = false;
// Per-compile backtrace flag (compile.ts side), mirroring SC_BACKTRACE. Drives the
// generated mergeAttributes IIFE's backtrace frame instrumentation.
let COMPILE_BACKTRACE = false;
// Debug-build top-level-statement sink: in a debug build, each emitted top-level
// statement (class `Class.make(…)` block, instance/LzInstantiateView, colors,
// registration) is collected here in emission order, then assembled (each its own
// translation unit) via assembleDebugProgram. null in production. Class defs are
// pushed at their emission point (compileClass/emitClassDef/emitNode) so the
// forward-ref DFS order — and the shared `$m` gensym order — is preserved.
let DEBUG_STMTS = null;
function pushDebug(stmt) { if (DEBUG_STMTS)
    DEBUG_STMTS.push(stmt); }
/** The Token.currentPathname a top-level INSTANCE leaves for a directive-less
 *  following statement (S35/S36 Pattern A/B). Pattern A — a source-literal value
 *  attr's `#beginAttribute` left a `#file ` reset that was never restored (no
 *  inline `<script>`/content re-set, no top-level id/name re-set) → "" (the
 *  generated context). Pattern B (the common case) → the real `file`. */
function instanceTrailingFile(built, file) {
    // The reg-trailer / following directive-less statement inherits the LAST
    // top-level instance's trailing `Token.currentPathname` (a JavaCC static).
    // Pattern A = "" (no directive); Pattern B = the real app file (sequential
    // `/* file: app#k */`). This STRUCTURAL approximation (literal-attr subtree, no
    // script/content, no top-level id/name) holds for dbg3 + all 61 passing
    // explorer-debug programs, but the true discriminator is the oracle's internal
    // `cg.translate` parseFragment order — NOT derivable from the node tree.
    //
    // PROVEN (2026-06-24, oracle-instrumented `Token.getCurrentPathname()` logged at
    // ToplevelCompiler.outputTagMap): component_sampler's last canvas child `s1`
    // leaves currentPathname="" → Pattern A; contactlist's last child leaves
    // `contactlist.lzx` → Pattern B — yet BOTH instances end their serialized stream
    // BYTE-IDENTICALLY (`…{axis:"x"},"class":simplelayout}],"class":LzView},N)`, last
    // attr a literal). The difference is purely the interleaved order in which the
    // instance's constraint (`LzAlwaysExpr`/`$mN`) and binder fragments are parsed
    // during code-gen (the last fragment either re-establishes the app file or not).
    // No structural rule separates them: the `!topLevelHasIdOrName` gate makes
    // component_sampler Pattern B (its `s1` HAS id) — gold is Pattern A; but DROPPING
    // that gate flips 15 passing programs (debugger/methods/events/music/…) from B→A.
    // component_sampler is therefore the one documented permanent gap (see
    // known-gaps.md + the CONTRADICTION MATRIX in HANDOFF.md). Do NOT re-derive.
    const patternA = (built?.subtreeHasLiteralAttr ?? false)
        && !(built?.subtreeHasScriptOrContent ?? false)
        && !(built?.topLevelHasIdOrName ?? false);
    return patternA ? "" : file;
}
// Origins (source-file ids) pulled in via `getLibraries` — the sorted app
// autoincludes plus the debugger component library (debug builds). Used to order
// the `var X=null;` global declarations the way the oracle's
// ToplevelCompiler.computePropertiesAndGlobals does: getLibraries' globals first
// (cat 0), then the app's OWN tree via computeDeclarations (cat 1, origin ==
// sourceId), then explicit `<include>` libraries via the collectObjectProperties
// child-loop (cat 2). Mine pushes globals in instance-walk order, which places
// an explicit include's content at its document position (often BEFORE a later
// app child like a named <button>); the cat sort restores the oracle order.
let AUTO_ORIGINS = new Set();
// Origins of explicit `<include>`d `<library>` roots — their globals are declared
// by computeDeclarations as a SEPARATE library unit (cat 2, after the app tree).
// A non-library include (a bare `<view>`/fragment, e.g. lzpix views/tools.lzx) is
// spliced INLINE as a canvas child, so its globals interleave in document order
// like the app's own tree (cat 1) — NOT bumped to the end.
let LIBRARY_ORIGINS = new Set();
// Per-origin "computeDeclarations" rank: the order in which the oracle's
// ToplevelCompiler.collectObjectProperties visits each file's globals. The
// oracle gathers a file's OWN class/instance ids (computeDeclarations descends
// element children but NOT through nested <include>s) BEFORE recursing into the
// libraries that file `<include>`s — so a host library's globals precede its
// includes' globals regardless of the include's document position. Each origin
// gets a rank assigned the FIRST time expandIncludes enters it; because a host
// is always entered before any library it pulls in, entry-order == this DFS
// "own-content-before-includes" order. orderGlobals sorts by (category, rank,
// push-index) so cross-library globals land in the oracle's exact order.
let ORIGIN_RANK = new Map();
let ORIGIN_RANK_NEXT = 0;
/** Reorder the collected globals into the oracle's declaration order: cat 0 =
 *  getLibraries (auto-includes + debugger, in AUTO_ORIGINS), cat 1 = the app's
 *  OWN tree (the source file + inline-spliced non-library fragment includes),
 *  cat 2 = explicit `<include>` LIBRARY roots (separate units). A STABLE sort by
 *  category preserves each tier's document order (the instance walk already
 *  visits them in that order within a tier). Mine pushes globals in walk order,
 *  which interleaves an explicit library include's globals at its document
 *  position (before later app children); this restores the oracle order. */
function orderGlobals(globals, origins, sourceId) {
    const cat = (o) => (AUTO_ORIGINS.has(o) ? 0 : LIBRARY_ORIGINS.has(o) ? 2 : 1);
    // Within a category, order by origin-file computeDeclarations rank (a host
    // library's globals before its includes'), then by push-index inside that
    // file (document order). A 0 default keeps the app's own source first.
    const rank = (o) => ORIGIN_RANK.get(o) ?? 0;
    return globals
        .map((g, i) => ({ g, c: cat(origins[i] ?? ""), r: rank(origins[i] ?? ""), i }))
        .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
        .map((e) => e.g);
}
function compileInner(root, opts, debug) {
    try {
        const seenIncludes = new Set();
        AUTO_ORIGINS = new Set();
        LIBRARY_ORIGINS = new Set();
        ORIGIN_RANK = new Map();
        ORIGIN_RANK_NEXT = 0;
        expandIncludes(root, opts.sourceId ?? "", opts, seenIncludes);
        const prefixLen = expandAutoincludes(root, opts, seenIncludes);
        // FORCED-DEBUG: the debugger component library (debugger/library.lzx) is
        // imported as ONE library unit (ToplevelCompiler.getLibraries appends it
        // LAST in the libraries list — after the sorted app autoincludes — and all
        // libraries emit before canvas content). Its component closure is pulled via
        // the debugger's OWN <include>s (basebutton.lzx, utils/layouts, lz/window.lzx,
        // lz/slider.lzx, …) in document order, NOT via app autoincludes — the oracle
        // collects autoincludes from the APP tree only. So it MUST be spliced AFTER
        // expandAutoincludes: splicing it first would let the autoinclude partition
        // re-sort the debugger's carefully-ordered DFS closure. Insert it at the end
        // of the sorted autoinclude prefix (index = prefixLen), before canvas content.
        if (debug)
            spliceDebuggerLibrary(root, opts, seenIncludes, prefixLen);
        // canvas attributes: defaults + build constants + appbuilddate (overrides
        // applied after the type resolvers are defined, below).
        const cattrs = {};
        const defs = canvasDefaults(opts.proxied);
        for (const k of Object.keys(defs))
            cattrs[k] = emitTyped(defs[k]);
        cattrs["appbuilddate"] = emitTyped({ kind: "string", v: NORMALIZED_APPBUILDDATE });
        for (const [k, v] of Object.entries(BUILD_CONSTANTS))
            cattrs[k] = emitTyped({ kind: "string", v });
        // Pre-scan: register user classes (and interfaces) so instances/extends
        // resolve in any order. An `<interface>` emits NOTHING (NodeModel.asMap uses
        // `tag:"name"` deferred indirection for its instances, not `"class":<ref>`),
        // but is registered in `classes` too so its declared attribute types resolve.
        const classes = new Map();
        const interfaces = new Set();
        for (const child of root.children) {
            if (child.type === "elem" && (child.name === "class" || child.name === "interface")) {
                const name = child.attrs["name"];
                if (!name)
                    throw new Unsupported(`<${child.name}> without name`);
                classes.set(name, { name, superTag: child.attrs["extends"] || "view", el: child });
                if (child.name === "interface")
                    interfaces.add(name);
            }
        }
        const resolve = (tag) => {
            if (classes.has(tag))
                return classJsName(tag);
            const b = LFC_TAG_CLASS[tag];
            if (b)
                return b;
            throw new Unsupported(`unknown tag <${tag}>`);
        };
        // Resolve an attribute's schema type string (for LzAlwaysExpr), walking the
        // user-class chain (honoring `<attribute type=…>` decls) down to the
        // built-in schema. Refuses untyped/unknown attributes.
        const declaredType = (className, attr) => {
            const def = classes.get(className);
            if (!def)
                return undefined; // not a user class
            for (const c of def.el.children) {
                if (c.type === "elem" && c.name === "attribute" && c.attrs["name"] === attr)
                    return c.attrs["type"] != null ? aliasType(c.attrs["type"]) : null; // null = declared but untyped
            }
            return undefined; // not declared here
        };
        // The inherited constraint `when` for an attribute, walking the user-class
        // chain to the first `<attribute name=… when=…>` declaration (the attribute
        // spec's `when` field). A plain value set on a `when="once|always"` attribute
        // becomes a constraint with that timing (NodeModel's getInitialValue/when).
        const inheritedWhen = (className, attr) => {
            let cur = className;
            while (cur && classes.has(cur)) {
                for (const c of classes.get(cur).el.children) {
                    if (c.type === "elem" && c.name === "attribute" && c.attrs["name"] === attr && c.attrs["when"] != null)
                        return c.attrs["when"];
                }
                cur = classes.get(cur).superTag;
            }
            return undefined;
        };
        // Resolve an attribute's schema type string (or null), walking user classes
        // then the built-in schema. `undefined` from declaredType = not declared
        // here; `null` = declared but untyped (treated as unknown).
        const schemaTypeOf = (tag, attr) => {
            let cur = tag;
            let sawUntyped = false;
            while (cur && classes.has(cur)) {
                const t = declaredType(cur, attr);
                if (t === null)
                    sawUntyped = true; // declared here but untyped; try parent
                else if (t !== undefined)
                    return t;
                cur = classes.get(cur).superTag;
            }
            const builtin = cur ? schemaAttrType(cur, attr) : null;
            if (builtin != null)
                return builtin;
            // Untyped <attribute> with no parent type defaults to expression.
            return sawUntyped ? "expression" : null;
        };
        const resolveConstraintType = (tag, attr, parentTag) => {
            const t = schemaTypeOf(tag, attr);
            if (t != null)
                return t;
            // A <state> can carry any attribute of its DOM parent node; an attribute
            // not on the state resolves against the parent's class (NodeModel.java:902).
            if (parentTag && isStateClass(tag)) {
                const pt = schemaTypeOf(parentTag, attr);
                if (pt != null)
                    return pt;
            }
            // Otherwise unknown — the oracle warns then types it "expression"
            // (NodeModel.java:947 / :1904).
            return "expression";
        };
        // Value-compilation type for a literal attribute, via the schema (with the
        // user-class chain), falling back to the name-based curated table.
        const valueTypeOf = (tag, attr) => {
            const t = schemaTypeOf(tag, attr);
            return t ? mapType(t) : attrType(tag, attr);
        };
        // Whether a member name (attribute or event) is declared by a superclass (so
        // an `<attribute>`/`<event>` redeclaring it gets NO void-0 declaration slot).
        // Walks the user-class chain (checking each class's <attribute>/<event> decls)
        // down to the built-in base, then the built-in attribute + event schema.
        const declaresMemberHere = (className, name) => {
            const def = classes.get(className);
            if (!def)
                return false;
            for (const c of def.el.children) {
                if (c.type === "elem" && (c.name === "attribute" || c.name === "event") && c.attrs["name"] === name)
                    return true;
            }
            return false;
        };
        const isInherited = (superTag, attr) => {
            let cur = superTag;
            while (cur && classes.has(cur)) {
                if (declaresMemberHere(cur, attr))
                    return true;
                cur = classes.get(cur).superTag;
            }
            return cur != null && (schemaAttrType(cur, attr) != null || schemaHasEvent(cur, attr));
        };
        // Whether a class transitively extends `<state>` (LzState). State classes
        // install their methods (constraint setters/deps, <method>s, handlers) as
        // attribute INITS (mergeAttributes), not inline Class.make decls, because
        // states apply their methods to the parent (ClassModel.java:803 — the
        // `!isstate` guard). The generated constructor stays a decl regardless.
        const isStateClass = (tag) => {
            let cur = tag;
            const seen = new Set();
            while (cur && !seen.has(cur)) {
                if (cur === "state")
                    return true;
                seen.add(cur);
                const def = classes.get(cur);
                if (!def)
                    return false; // a non-state built-in base
                cur = def.superTag;
            }
            return false;
        };
        // Whether the tag's class transitively extends `<inputtext>` (ClassModel
        // isInputText). Input-text fields take getInputText (no HTML) content.
        const isInputTextTag = (tag) => {
            let cur = tag;
            const seen = new Set();
            while (cur && !seen.has(cur)) {
                if (cur === "inputtext")
                    return true;
                seen.add(cur);
                const def = classes.get(cur);
                if (!def)
                    return false;
                cur = def.superTag;
            }
            return false;
        };
        // Whether the tag's class has a `text` instance attribute — the addText
        // trigger (NodeModel.addText: parentClassModel.getAttribute("text")!=null).
        const hasTextContent = (tag) => schemaTypeOf(tag, "text") != null;
        // Canvas attribute overrides (now that the type resolvers exist). `debug` is
        // a compile directive, not a runtime attribute — the oracle never emits it on
        // the canvas (verified for debug="false" and debug="true").
        for (const name of root.attrOrder) {
            if (name === "debug")
                continue;
            // An event-handler ATTRIBUTE on the canvas (oninit="…") is NOT a plain
            // attribute: it makes the canvas an anonymous LzCanvas subclass with a
            // generated handler method + `$delegates` entry (handled below via the
            // synthesized member node, mirroring a child `<handler>`). Skip it here.
            if (isEventAttr(name))
                continue;
            cattrs[name] = compileAttr("canvas", name, root.attrs[name], true, valueTypeOf);
        }
        // Whether a class (or its superclass chain) declares any default view
        // children — drives `LzNode.mergeChildren` (ClassModel.inheritsChildren).
        // Structural (order-independent); used only as a `> 0` boolean.
        const childCountMemo = new Map();
        const classDefChildCount = (tag) => {
            if (childCountMemo.has(tag))
                return childCountMemo.get(tag);
            if (interfaces.has(tag))
                return 0; // an interface contributes no default children
            const def = classes.get(tag);
            if (!def)
                return 0; // built-in: no LZX default children
            childCountMemo.set(tag, 0); // cycle guard
            let n = classDefChildCount(def.superTag); // inherited children
            n += childViews(def.el).length;
            childCountMemo.set(tag, n);
            return n;
        };
        // Whether a node whose SUPER is `tag` should use `LzNode.mergeChildren`
        // (ClassModel.inheritsChildren): a kernel-builtin super has no children
        // (false); an `<interface>` (or any class with no compile-time node model)
        // is assumed to (true); a `<class>` is recursively asked.
        const inheritsMemo = new Map();
        const inheritsChildren = (tag) => {
            if (inheritsMemo.has(tag))
                return inheritsMemo.get(tag);
            if (!classes.has(tag))
                return false; // built-in
            inheritsMemo.set(tag, true); // cycle guard / null-model assumption
            const def = classes.get(tag);
            const r = interfaces.has(tag) || childViews(def.el).length > 0 || inheritsChildren(def.superTag);
            inheritsMemo.set(tag, r);
            return r;
        };
        // NodeModel.totalSubnodes — the LzInstantiateView node count. This is
        // ORDER-DEPENDENT: it is computed at a class's build time (getNodeModel /
        // addChildren) seeded from the superclass's stored count, then incremented by
        // each default child's totalSubnodes(). A child that instantiates another
        // class contributes that class's full subtree ONLY if the class was already
        // compiled when this class was built (its nodeModel exists, NodeModel.java:707)
        // — otherwise it counts as a single node (1). A child that instantiates a
        // state class counts as 1 (totalSubnodes() returns 1 when parentClassModel
        // .isstate). `storedCount` holds each class's count, set in emitClassDef.
        const storedCount = new Map();
        // The effective initstage of an instance: its own `initstage` attribute, or
        // (when absent) the one inherited from the instantiated user-class's node
        // model — the class def's `initstage` attr, walking the user-class chain. The
        // oracle inherits a class's initstage only if that class is already compiled
        // (NodeModel ctor seeds from parentClassModel.nodeModel.initstage, which is
        // null until the class compiles); a built-in class carries none.
        const effectiveInitstage = (el) => {
            const own = el.attrs["initstage"];
            if (own != null)
                return own;
            let cur = el.name;
            while (cur && classes.has(cur) && storedCount.has(cur)) {
                const cdef = classes.get(cur);
                const ci = cdef.el.attrs["initstage"];
                if (ci != null)
                    return ci;
                cur = cdef.superTag;
            }
            return undefined;
        };
        const instanceContribution = (el) => {
            if (isStateClass(el.name))
                return 1; // parentClassModel.isstate → delayed
            // `initstage="late"|"defer"` defers the WHOLE subtree off the instantiation
            // queue, so it contributes 0 nodes (NodeModel.totalSubnodes():709). The
            // initstage may be inherited from the instantiated class def, not just the
            // instance element's own attribute.
            const initstage = effectiveInitstage(el);
            if (initstage === "late" || initstage === "defer")
                return 0;
            // Seed from the instantiated class's stored count if it was compiled before
            // this node was built; a built-in or not-yet-compiled class seeds 1.
            let n = classes.has(el.name) && storedCount.has(el.name) ? storedCount.get(el.name) : 1;
            // A literal `<dataset>`'s XML-data children are captured in `initialdata`
            // (includeChildren=false), so they are NOT view subnodes — the dataset
            // contributes only itself, never its `<foo>`/`<persons>` data subtree.
            if (isLiteralDatasetEl(el))
                return n;
            for (const c of childViews(el))
                n += instanceContribution(c); // the node's own children
            return n;
        };
        const classStoredCount = (def) => {
            let n = classes.has(def.superTag) ? storedCount.get(def.superTag) ?? 1 : 1;
            for (const c of childViews(def.el))
                n += instanceContribution(c);
            return n;
        };
        // One `$m` generator shared across the whole compile (method + anon-class
        // names), consumed in document/traversal order — the byte-for-byte crux.
        const mGen = new SymbolGenerator("$m");
        // Globals from id/top-level-name declarations → `var <sym>=null;` prefix,
        // collected (in document order) during the build pass. `globalOrigins` is
        // parallel: each global's source-file origin, used by `orderGlobals` to
        // reproduce the oracle's getLibraries → app-tree → explicit-include order.
        const globals = [];
        const globalOrigins = [];
        // Media resources: a `$LZ` library entry per unique file, named by the
        // second per-compile gensym counter. Deduped by resolved path.
        const lzGen = new SymbolGenerator("$LZ");
        // Resource-library defs and font addFont() lines append to ONE buffer in
        // compilation (document) order — the oracle's single `mResourceDefs`
        // StringBuffer (DHTMLWriter) — with `__allcss` appended last.
        const preamble = [];
        let hasResource = false;
        const declaredResources = new Set(); // all <resource name=…> names (known up-front)
        const emittedResources = new Set(); // <resource name=…> declarations already emitted
        const anonResEntries = [];
        // `<font>` → LzFontManager.addFont lines. The oracle compiles fonts in its
        // schema phase too, but appends them to mResourceDefs AFTER all named
        // `<resource>` declarations (verified across every gold: no font ever precedes
        // a named resource, even when the `<font>` is declared first in source — see
        // dataimage, whose `<font>`s at lines 10-11 precede its `<resource>`s but emit
        // after them). Fonts carry no sprite, so this is order-only — collect them here
        // and flush between the named resources and the anon `$LZ` resources.
        const fontEntries = [];
        let spriteOffset = 0;
        const registerResource = (ref, originId) => {
            // A reference to a declared <resource name=…> resolves to that name directly.
            if (declaredResources.has(ref))
                return ref;
            const info = opts.resolveResource?.(ref, originId);
            if (!info)
                throw new Unsupported(`unresolved resource: ${ref}`);
            // The oracle does NOT dedupe inline `resource="path"` view references: its
            // ObjectWriter.mResourceMap is PUT keyed by relPath (DHTMLWriter:238, the
            // `[pga] was fileName` mismatch) but GET keyed by the full canonical path
            // (ObjectWriter:331 / DHTMLWriter:232), so the lookup never hits — every
            // reference allocates a fresh `$LZ` entry and advances the sprite counter,
            // even for two views pointing at the SAME image (button_example's two
            // `icons/plane_icon.swf` → `$LZ1` + `$LZ2`, same path, distinct offsets).
            const name = lzGen.next();
            hasResource = true;
            anonResEntries.push({
                height: Math.round(info.height),
                render: (off) => `LzResourceLibrary.${name}={ptype:${jsString(info.ptype)},frames:['${info.relPath}']` +
                    `,width:${javaDouble(info.width)},height:${javaDouble(info.height)}` +
                    // "none" mode drops ALL sprite machinery — incl. the (master-sprite-inert)
                    // spriteoffset on single-frame anon resources — so the JS references nothing
                    // sprite-related and is a TOTAL reduction of the oracle output.
                    (opts.sprites === "none" ? "" : `,spriteoffset:${off}`) + `};`,
            });
            return name;
        };
        // A `<resource name=X>` declaration: a named LzResourceLibrary entry with one
        // or more frames (`<frame src=…>` children, or a single `src=` attribute).
        // Multi-frame entries carry a `sprite:` montage path. GIF frames are refused
        // (their montage dims need the SWF fixed-point codec, which the harness round
        // cannot bridge — see openlaszlo-compiler-plan).
        const registerNamedResource = (el) => {
            const name = el.attrs["name"];
            if (!name)
                throw new Unsupported(`<resource> without name`);
            if (emittedResources.has(name))
                return;
            const frameRefs = [];
            for (const c of el.children) {
                if (c.type === "text") {
                    if (c.value.trim())
                        throw new Unsupported(`text in <resource>`);
                    continue;
                }
                if (c.name === "frame") {
                    const src = c.attrs["src"];
                    if (!src)
                        throw new Unsupported(`<frame> without src`);
                    frameRefs.push(src);
                }
                else
                    throw new Unsupported(`<${c.name}> in <resource>`);
            }
            // A `<resource>` with explicit `<frame>` children routes through the
            // oracle's multi-frame descriptor (DHTMLWriter.writeResourceLibraryDescriptor),
            // whose sprite/spriteoffset is emitted ONLY for `sources.size() > 1` (the
            // `== 0` else-branch is dead code). So a SINGLE-frame `<frame>` resource
            // gets neither `sprite:` nor `spriteoffset`, and does NOT advance the
            // master-sprite offset counter — unlike a `src=` single resource (the
            // single writeResourceLibrary path, which always addToMasterSprite).
            const hadFrameChildren = frameRefs.length > 0;
            const srcAttr = el.attrs["src"];
            // A `src` naming a directory or a `.swf` enumerates to multiple frames
            // (the pre-rendered PNG siblings); otherwise `src`/`<frame>`s are single
            // file references resolved individually.
            const enumerated = srcAttr && frameRefs.length === 0 ? opts.resolveResourceFrames?.(srcAttr, el.origin) : null;
            let infos;
            if (enumerated) {
                infos = enumerated;
            }
            else {
                if (srcAttr)
                    frameRefs.unshift(srcAttr);
                if (frameRefs.length === 0)
                    throw new Unsupported(`<resource> without frames`);
                infos = frameRefs.map((r) => {
                    const i = opts.resolveResource?.(r, el.origin);
                    if (!i)
                        throw new Unsupported(`unresolved resource: ${r}`);
                    return i;
                });
            }
            // NOTE: frames stay in SOURCE (`<frame>`) order — the oracle emits them in
            // document order in BOTH proxied and SOLO builds (its `sources` Vector is the
            // JDOM child order; the `sprite:` name is `sources.get(0)` = the document-first
            // frame). The SOLO golds APPEAR alpha-sorted only because the harness
            // `normalize()` sorts each frames array (the order is treated as non-portable);
            // it sorts BOTH sides, so source order matches. (An earlier attempt to sort the
            // array in SOLO mismatched the `sprite:` name, which follows the UNSORTED first
            // frame — reverted.)
            // GIF cell dims: a GIF frame is routed through GIF89a.gifToSwf, which scales
            // by `.999` stored as 16.16 fixed-point (round(.999*65536)/65536 = 65470/65536).
            // The MONTAGE path (infos.length > 1) floors the scaled pixel dim directly
            // (105x110 GIF → 104x109). The SINGLE-frame path goes through the SWF shape's
            // TWIP bounds (1/20 px): `round(floor(d*20*scale)/20)` — which is an identity
            // for normal dims but shaves 1px once `d*20*scale` drops below `d*20-1` twips,
            // i.e. only for very wide frames (calendar gripper.gif 800x7 → 799x7; topbar
            // 240x16 → 240x16 unchanged). Non-GIF frames keep pixel dims (the `.999` is
            // specific to gifToSwf). Avoids porting the full SWF DefineShape codec.
            const GIF_SCALE = 65470 / 65536;
            const cell = (i, dim) => {
                if (!/\.gif$/i.test(i.relPath))
                    return dim;
                return infos.length > 1
                    ? Math.floor(dim * GIF_SCALE)
                    : Math.round(Math.floor(dim * 20 * GIF_SCALE) / 20);
            };
            const w = Math.max(...infos.map((i) => cell(i, i.width)));
            const h = Math.max(...infos.map((i) => cell(i, i.height)));
            const frames = infos.map((i) => `'${i.relPath}'`).join(",");
            // Single-frame explicit-`<frame>` resource: no sprite, no spriteoffset,
            // no counter advance (the writeResourceLibraryDescriptor fall-through).
            const noSprite = hadFrameChildren && !enumerated && infos.length === 1;
            // An ALL-GIF montage (every frame a `.gif`) sprites through GIF89a.gifToSwf,
            // whose master-sprite cell carries only the source DIRECTORY (`images/`) as
            // its `sprite:` path — not the `<first>.sprite.png` montage filename a non-all-
            // GIF (mixed) montage uses (the corpus `logo.gif`+`sky.jpg` case). And the
            // master-sprite OFFSET advances by the UNSCALED pixel height (the `.999` cell
            // scale applies to the displayed `width/height` only, not the addToMasterSprite
            // step — verified against amazon radio_rsc/stars_rsc: displayed 11, advance 12).
            // An ALL-GIF montage (every frame a `.gif`) sprites through GIF89a.gifToSwf;
            // a DIRECTORY `src` (trailing `/`) enumerates real on-disk frames. In BOTH
            // the master-sprite OFFSET advances by the UNSCALED pixel height (the `.999`
            // cell scale applies to the displayed `width/height` only, not the
            // addToMasterSprite step — verified vs amazon radio_rsc/stars_rsc: displayed
            // 11, advance 12). The `sprite:` PATH normalizes away in the harness, so it is
            // not load-bearing: a directory uses `<dir>/`, an explicit montage uses
            // `<first>.sprite.png` (both normalize to `<dir>/`).
            const allGif = infos.length > 1 && infos.every((i) => /\.gif$/i.test(i.relPath));
            const isDir = !!(enumerated && srcAttr && srcAttr.endsWith("/"));
            const unscaledAdvance = allGif || isDir;
            // "none" mode (Java-free distro): omit the sprite-sheet ref so the runtime
            // renders multi-frame resources from their individual frame PNGs (frame mode).
            const noSheets = opts.sprites === "none";
            const spriteKey = noSheets || infos.length <= 1
                ? ""
                : isDir
                    ? `,sprite:'${infos[0].relPath.slice(0, infos[0].relPath.lastIndexOf("/") + 1)}'`
                    : `,sprite:'${infos[0].relPath.replace(/\.[^./]+$/, "")}.sprite.png'`;
            const offsetKey = noSprite || noSheets ? "" : `,spriteoffset:${spriteOffset}`;
            declaredResources.add(name);
            emittedResources.add(name);
            hasResource = true;
            preamble.push(`LzResourceLibrary.${name}={ptype:${jsString(infos[0].ptype)},frames:[${frames}]` +
                `,width:${javaDouble(w)},height:${javaDouble(h)}${spriteKey}${offsetKey}};`);
            const advanceH = unscaledAdvance ? Math.max(...infos.map((i) => i.height)) : h;
            if (!noSprite)
                spriteOffset += Math.round(advanceH);
        };
        // A `<font name=… src=…>` (and/or `<face>` children) → `LzFontManager.addFont`
        // preamble lines. The font src resolves via the font search path; the LZX
        // `style` is converted to a CSS (style, weight) pair (DHTMLWriter.importFontStyle).
        const compileFontTag = (el) => {
            const fontOrigin = el.origin ?? "";
            const name = el.attrs["name"];
            if (!name)
                throw new Unsupported(`<font> without name`);
            if (el.attrs["device"] === "true")
                throw new Unsupported(`device <font>`);
            const emitFace = (face) => {
                const src = face.attrs["src"];
                if (!src)
                    return;
                const info = opts.resolveFont?.(src);
                if (!info)
                    throw new Unsupported(`unresolved font: ${src}`);
                let style = face.attrs["style"] || "";
                if (style === "")
                    style = "plain";
                let weight = "normal";
                if (style === "plain") {
                    weight = "normal";
                    style = "normal";
                }
                else if (style === "bold") {
                    weight = "bold";
                    style = "normal";
                }
                else if (style === "italic") {
                    weight = "normal";
                    style = "italic";
                }
                else if (style === "bold italic" || style === "bolditalic") {
                    weight = "bold";
                    style = "italic";
                }
                fontEntries.push({ line: `LzFontManager.addFont('${name}','${style}','${weight}','${info.relPath}','${info.ptype}');`, origin: fontOrigin });
            };
            if (el.attrs["src"])
                emitFace(el);
            for (const c of el.children) {
                if (c.type === "text") {
                    if (c.value.trim())
                        throw new Unsupported(`text in <font>`);
                    continue;
                }
                if (c.name === "face")
                    emitFace(c);
                else
                    throw new Unsupported(`<${c.name}> in <font>`);
            }
        };
        const ctx = { resolve, resolveConstraintType, valueTypeOf, isInherited, mGen, globals, globalOrigins, registerResource, isStateClass, inheritedWhen, hasTextContent, isInputTextTag, classes, interfaces };
        const registrations = [];
        // The tag-map registration block + the trailer scripts (debug-window /
        // makeDebugWindow / initDone) are emitted by the oracle as fresh one-line
        // synthetic sources with NO #file directive, so they INHERIT the file context
        // left by the last top-level statement compiled (the last instance, or the last
        // class def if there are no canvas instances). Tracked here, updated at each
        // class/instance push, used as `regFile` in the debug trailer.
        let lastTopFile = debugFile(root);
        // S36 reg/trailer discriminator: the BuiltNode of the LAST top-level instance,
        // and whether the last top-level statement WAS that instance (vs a Class.make /
        // dataset / immediate-script, which end on generated context). Used to decide
        // whether the tag-map registrations + trailer inherit a generated `#file ` reset
        // (Pattern A — emitted INLINE, no directives) or a real file context (Pattern B
        // — each reg/trailer carries a `/* file: app#k */` directive).
        let lastTopInstance;
        let lastTopWasInstance = false;
        // Cross-unit lexer context (Token.currentPathname) that a directive-less
        // top-level statement inherits. A `<dataset>` (DataCompiler.compile →
        // env.compileScript(script) with NO sourceLocationDirective) emits its two
        // statements at `<currentPathname>#1` — the line is always 1 (each addScript
        // resets the parser line) and only the FILE (the persistent Token static)
        // varies. In a debug build the debugger library is always loaded, so the
        // initial currentPathname is `debugger/debugger.lzx`; a preceding top-level
        // INSTANCE whose trailing context is the real app file (Pattern B) shifts it
        // to the app file. (Pattern A — an instance ending on a `#beginAttribute`
        // reset → currentPathname "" — is the documented-hard remainder.)
        let crossUnitFile = "debugger/debugger.lzx";
        // Set true immediately after a `<debug>` element that produced an anon subclass
        // ($lzc$class_mhN extends LzDebugWindow); a `<dataset>` immediately following
        // (no intervening top-level statement) then emits its lzAddLocalData in
        // GENERATED context (blank file, no directive) — the anon Class.make leaves
        // Token.currentPathname blank. Cleared by the dataset (or any other top-level
        // statement that runs the loop body and resets it).
        let debugAnonClassPending = false;
        // The `new $lzc$class_LzDebugWindow(canvas, {…}.attrs)` script stored by a user
        // `<debug>` element (DebugCompiler.compile); emitted in the trailer in place of
        // Debug.makeDebugWindow(). Empty when the source has no `<debug>`.
        let debugWindowScript = "";
        // On-demand class compilation (ClassModel.compile / emitClassDeclaration):
        // a class is emitted at most once, in the oracle's forward-reference DFS
        // order — its superclass first (ClassModel.java:698), then its instantiated
        // default-child classes (triggered in NodeModel.asMap during the emit pass),
        // then its own `Class.make`. `compileClass` returns the emitted JS for `name`
        // plus everything it transitively pulls in (super + forward refs), or "" if
        // already compiled / not a user class. The shared `$m`/`$LZ` counters are
        // consumed in exactly this order (build pass allocates method names, emit pass
        // allocates anon-class names) — the byte-for-byte crux.
        const compiled = new Set();
        const compileClass = (name) => {
            if (!classes.has(name))
                return ""; // built-in / unknown — not LZX-emitted here
            if (interfaces.has(name))
                return ""; // an <interface> emits nothing
            if (compiled.has(name))
                return "";
            compiled.add(name); // mark before recursing (matches declarationEmitted=true)
            const def = classes.get(name);
            const superDef = compileClass(def.superTag); // forward ref: super emitted first
            return superDef + emitClassDef(def);
        };
        // Emit one class definition: build pass (class-tag attrs + child models —
        // allocates method `$m`) then emit pass (emitNode — allocates anon-class
        // names and triggers forward-ref `compileClass` for instantiated classes, in
        // child order). Returns the child/forward-ref defs followed by this class's
        // own `Class.make`; pushes its `lz[name]=…` registration (in emission order).
        const emitClassDef = (def) => {
            const child = def.el;
            const superJs = resolve(def.superTag);
            // totalSubnodes is computed at build time (before the emit pass below
            // compiles any forward-referenced child classes), so child classes not yet
            // compiled count as 1 — the order-dependent count (NodeModel.addChildren).
            storedCount.set(def.name, classStoredCount(def));
            // Instance properties: attribute slots ("name",void 0) + defaults +
            // methods + handler methods ("name",function…), in document order.
            // Class-tag attributes are processed before child elements (matching
            // addAttributes-before-addChildren), so their constraint methods come
            // first in the instance-props array.
            const instEntries = [];
            // For the debug build's synthetic-constructor source line: the last
            // code-generating member's close-tag line + an offset (member-rich classes
            // only). `noteMember` records it as members emit in document order.
            let lastMemberClose = -1;
            let lastMemberHandler = false;
            // When the LAST code member is an always-constraint, its synthetic-ctor line
            // is NOT closeLine+offset: the constraint's deps body (unfolded `$debug`
            // branches) spans several source lines, so the lexer position the ctor
            // inherits is finalSourceLine(depsBody) + 1 + trailingVoidSlots — exactly the
            // anon-class path (emitAnonClassDebug). slidertrack: showfill deps from #50 →
            // finalSourceLine 58, +1 +4 trailing = 63 (crude #50+5+4=59 was too low).
            let lastMemberConBody;
            let lastMemberConSrcLine;
            // The `<attribute name="defaultplacement">` element's source line (set in the
            // class-member loop), used to anchor the childOnlyRich synthetic-ctor line.
            let placementAttrSrcLine;
            // The close line of the LAST `<method allocation="class">` (a class-static
            // method). Static methods are serialized at the TOP of the ScriptClass body
            // (before the `tagname`/`attributes` statics) and their `#endContent` resets
            // the JavaCC `#file` context to "" — so a class with ONLY static methods and
            // no instance code member has a PLAIN synthetic ctor (generated context),
            // tracked at lastStaticMethodClose + 7 (the same +5 method→ctor span as an
            // instance method PLUS the 2 always-present statics that, for static methods,
            // sit AFTER the methods). (iso8601 leadingZero @40 → ctor 47.)
            let lastStaticMethodClose;
            const noteMember = (el, handler) => {
                lastMemberConBody = undefined; // a non-constraint member clears the override
                lastMemberClose = el.closeLine ?? el.endLine ?? el.line ?? lastMemberClose;
                lastMemberHandler = handler;
            };
            // `allocation="class"` attributes → class (static) properties, prepended
            // to the class-property array (before `tagname`).
            const classAllocEntries = [];
            // `$delegates` list entries and the set of non-reference event names
            // (used to default `clickable` to true for mouse events).
            const delegateList = [];
            const delegateEvents = new Set();
            const defaultAttrs = {};
            for (const an of child.attrOrder) {
                if (an === "name" || an === "extends")
                    continue;
                const raw = child.attrs[an];
                let con = parseConstraint(raw) && { ...parseConstraint(raw), literal: false } || null;
                // A `%` value on a size/numberExpression attribute is a constraint
                // (mirrors the instance path); its setter/deps `$m` allocate here in
                // document order, so they interleave correctly with `${}` constraints.
                let pctType = null;
                if (!con && raw.trim().endsWith("%")) {
                    try {
                        pctType = resolveConstraintType(def.name, an);
                    }
                    catch {
                        pctType = null;
                    }
                    const pexpr = percentConstraintExpr(pctType, an, raw);
                    if (pexpr)
                        con = { when: "", expr: pexpr, literal: false };
                }
                // A plain value on an attribute whose INHERITED declaration is
                // `when="once|always"` becomes a literal constant constraint with that
                // timing (e.g. a style subclass setting `canvascolor="silver"`).
                if (!con && !isEventAttr(an)) {
                    const iw = inheritedWhen(def.name, an);
                    if (iw === "once" || iw === "always")
                        con = attrConstraint(raw, iw);
                }
                if (isEventAttr(an)) {
                    // Event handler declared as a class-tag attribute. It IS a code member
                    // (a `$mhN` method): its body's `#line` directive tracks at the class
                    // START-TAG `>` line (el.endLine, RULE 8 — the same line a tag-attribute
                    // handler body anchors at), so the synthetic ctor's member cursor advances
                    // to el.endLine, NOT the attribute's own line. These differ only for a
                    // MULTI-LINE class start tag whose handler attr sits above the `>`
                    // (views-$13 `dragBox` onmouseup@4 but `>`@5 → ctor anchors at 5; a
                    // single-line tag has attrLine == endLine, so this is a no-op there).
                    emitHandler(an, raw, undefined, undefined, undefined, mGen, instEntries, delegateList, delegateEvents, child, true);
                    lastMemberConBody = undefined;
                    lastMemberClose = child.endLine ?? child.closeLine ?? child.attrLines?.[an] ?? lastMemberClose;
                    lastMemberHandler = true;
                }
                else if (con && con.when === "immediately") {
                    // $immediately{expr} as a class-tag attribute → an eager class default
                    // value (raw sc-folded expression), not a constraint.
                    defaultAttrs[an] = compileExpr(con.expr);
                }
                else if (con && con.when === "style") {
                    // A `$style` constraint on an (inherited) class attribute → just the
                    // compact init in mergeAttributes; no void-0 declaration slot.
                    defaultAttrs[an] = btNoteConstraintInit(styleConstraintExpr(an, resolveConstraintType(def.name, an), con.expr), child.endLine ?? child.line ?? 0, debugFile(child));
                }
                else if (con) {
                    if (con.when !== "" && con.when !== "once" && con.when !== "path")
                        throw new Unsupported(`$${con.when}{} constraint`);
                    const declared = pctType ?? resolveConstraintType(def.name, an);
                    // A literal constant constraint with a color type wraps the raw value
                    // in convertColor (the once-setter is not canonicalized).
                    const setterExpr = con.literal && declared === "color"
                        ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
                    const c = COMPILE_DEBUG
                        ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(child), child.endLine ?? child.line ?? 0)
                        : compileConstraint(an, declared, setterExpr, con.when, mGen);
                    instEntries.push(...c.entries);
                    defaultAttrs[an] = btNoteConstraintInit(c.initExpr, child.endLine ?? child.line ?? 0, debugFile(child));
                    // A class-tag CONSTRAINT attribute is a code member: its binder/deps
                    // methods (`$reportException` bodies) make the class member-rich, so the
                    // synthetic ctor takes the plain (file="") form tracked off the deps
                    // body's final source line — mirroring the `<attribute value="${…}">`
                    // path. (color-$6 box1: bgcolor='${…}' @6 → deps finalLine 14 → ctor 15.)
                    if (COMPILE_DEBUG && "lastBody" in c) {
                        noteMember(child, false);
                        lastMemberConBody = c.lastBody;
                        lastMemberConSrcLine = c.lastSrcLine;
                    }
                }
                else if (valueTypeOf(def.name, an) === "color") {
                    // A non-canonicalizable color class-default is a once-constraint
                    // (color attributes are when="once"; constant colors fold to a literal).
                    const cv = colorValue(an, raw, resolveConstraintType(def.name, an), mGen, debugFile(child), child.endLine ?? child.line ?? 0);
                    if ("plain" in cv)
                        defaultAttrs[an] = btNoteColorInit(cv.plain, child.endLine ?? child.line ?? 0);
                    else {
                        instEntries.push(...cv.entries);
                        defaultAttrs[an] = btNoteConstraintInit(cv.init, child.endLine ?? child.line ?? 0, debugFile(child));
                        // The `$once` color constraint is a CODE MEMBER (its `$mh` setter body
                        // resets `#file`), so it makes the class member-rich — the synthetic
                        // ctor tracks off the setter's deps span (plain file="" form), NOT the
                        // childOnlyRich last-literal path. Mirrors the instance-path
                        // noteCodeMember for this same color branch. (viewvisibility `demo`
                        // bgcolor='gray90' @42 → ctor 49, was wrongly childOnly @52.)
                        if (COMPILE_DEBUG && cv.cc.lastBody !== undefined) {
                            noteMember(child, false);
                            lastMemberConBody = cv.cc.lastBody;
                            lastMemberConSrcLine = cv.cc.lastSrcLine;
                        }
                    }
                }
                else {
                    defaultAttrs[an] = compileAttr(def.name, an, raw, false, valueTypeOf);
                }
            }
            const childNodes = [];
            let classDatapath;
            for (const c of child.children) {
                if (c.type === "text")
                    continue; // stray text in a class body is ignored
                if (c.name === "doc")
                    continue;
                if (c.name === "handler") {
                    compileHandler(c, mGen, instEntries, delegateList, delegateEvents);
                    noteMember(c, true);
                    continue;
                }
                if (c.name === "attribute") {
                    const an = c.attrs["name"];
                    if (!an)
                        throw new Unsupported(`<attribute> without name`);
                    // The `defaultplacement` <attribute>'s source line drives the
                    // childOnlyRich synthetic-ctor line (it is the LAST `#line` the
                    // ScriptClass static block emits, via the placement sentinel's quoted
                    // target value). Capture the attribute element's start-tag line.
                    if (an === "defaultplacement")
                        placementAttrSrcLine = c.line ?? c.endLine ?? placementAttrSrcLine;
                    const raw = "value" in c.attrs ? c.attrs["value"] : null;
                    // allocation="class" → a class (static) property (e.g.
                    // `lz.command.DisplayKeys`): prepended to the class-property array, no
                    // instance void-0 slot, not in mergeAttributes (ClassModel allocation).
                    if (c.attrs["allocation"] === "class") {
                        if (c.attrs["setter"] != null || c.attrs["when"] != null || (raw != null && parseConstraint(raw)))
                            throw new Unsupported(`allocation="class" with setter/constraint`);
                        const allocType = c.attrs["type"] ? mapType(c.attrs["type"]) : mapType("expression");
                        // In a debug build a nested object/array value renders compress=false
                        // (the outer asMap spacing doesn't reach into a pre-compiled value).
                        const value = raw == null
                            ? "void 0"
                            : COMPILE_DEBUG && (allocType === "expression" || allocType === "boolean" || allocType === "number")
                                ? compileExprDebug(raw)
                                : compileTypedValue(allocType, raw, false);
                        classAllocEntries.push(COMPILE_DEBUG ? ent(an, value) : `${jsString(an)},${value}`);
                        continue;
                    }
                    let con = attrConstraint(raw, c.attrs["when"]);
                    // A plain value (no `${}`, no explicit `when=`) on an `<attribute>` whose
                    // INHERITED declaration is `when="once|always"` becomes a literal constant
                    // constraint with that inherited timing — the redeclaration re-emits the
                    // once/always setter even though the slot is inherited (mirrors the
                    // class-tag short-form path above). E.g. `grid` (extends `basegrid`)
                    // redeclaring `<attribute name="_columnclass" value="lz.gridtext"/>`
                    // where basegrid declares it `when="once"` → an LzOnceExpr setter, no slot.
                    if (!con && raw != null && c.attrs["style"] == null && c.attrs["setter"] == null && !isEventAttr(an)) {
                        const iw = inheritedWhen(def.name, an);
                        if (iw === "once" || iw === "always")
                            con = attrConstraint(raw, iw);
                    }
                    // A redeclared (inherited) attribute gets no void-0 declaration slot.
                    const slot = isInherited(def.superTag, an) ? [] : [voidSlot(an)];
                    // setter="…" → a $lzc$set_<name> method (param = attr name), emitted
                    // AFTER the slot, whether or not the attribute is also constrained.
                    // The setter method line is the attribute element's SAX line (the
                    // start-tag `>`/`/>` line = endLine); its body inherits the
                    // `userFunctionName=set <attr>` pragma line, so the body is endLine + 1.
                    const setLine = c.endLine ?? c.line ?? 0;
                    const setterEntry = c.attrs["setter"] != null
                        ? [COMPILE_DEBUG
                                ? ent("$lzc$set_" + an, compileFunctionDebug("set " + an, [an], c.attrs["setter"], [], debugFile(c), setLine, setLine + 1, false, "report", true, "set " + an))
                                : `${jsString("$lzc$set_" + an)},${compileFunction([an], c.attrs["setter"])}`]
                        : [];
                    if (c.attrs["style"] != null) {
                        // A `style="prop"` attribute → `$style{'prop'}` constraint
                        // (NodeModel.java:1954: value = "$style{" + quote(style) + "}").
                        // A constant style folds to the compact `new LzStyleConstraintExpr`
                        // init in mergeAttributes; no void-0 declaration slot (the attr is
                        // inherited). Mirrors the instance-level style path (L1304).
                        const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(def.name, an);
                        instEntries.push(...slot, ...setterEntry);
                        if (c.attrs["setter"] != null)
                            noteMember(c, false);
                        // A `value=` alongside `style=` is passed as the fallback expression
                        // (NodeModel.java:1959/1987 setFallbackExpression), compiled as the
                        // attribute's declared type.
                        const fb = raw != null
                            ? compileTypedValue(c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an), raw, false)
                            : undefined;
                        defaultAttrs[an] = btNoteConstraintInit(styleConstraintExpr(an, declared, jsString(c.attrs["style"]), fb), c.endLine ?? c.line ?? 0, debugFile(c));
                    }
                    else if (con && con.when === "immediately") {
                        // $immediately{expr} class <attribute>: an eager default value
                        // (NodeModel WHEN_IMMEDIATELY) — a plain void-0 slot + a raw sc-folded
                        // value in mergeAttributes, NOT a constraint (no setter/$m). The value
                        // is emitted unadulterated (e.g. `$immediately{null}` → null,
                        // `$immediately{0xff0000}` → 16711680) — verified vs the oracle.
                        instEntries.push(...slot, ...setterEntry);
                        if (c.attrs["setter"] != null)
                            noteMember(c, false);
                        defaultAttrs[an] = compileExpr(con.expr);
                    }
                    else if (con) {
                        // Constrained default: setter + deps methods come BEFORE the
                        // attribute's void-0 slot (single addProperty insertion order).
                        if (con.when !== "" && con.when !== "once" && con.when !== "path")
                            throw new Unsupported(`$${con.when}{} constraint`);
                        // The constraint's type arg is the canonical schema-type NAME (the
                        // `dataBindAttribute`/`LzOnceExpr`/`LzAlwaysExpr` 2nd/3rd arg), so an
                        // explicit `type=` must run through the ViewSchema alias map
                        // (`html`→`text`, ViewSchema.java:61) — NOT the raw declared string.
                        const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(def.name, an);
                        // A literal `when=` color value wraps the RAW value in convertColor.
                        const litType = con.literal ? (c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an)) : null;
                        const setterExpr = litType === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
                        const cc = COMPILE_DEBUG
                            ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(c), c.endLine ?? c.line ?? 0)
                            : compileConstraint(an, declared, setterExpr, con.when, mGen);
                        instEntries.push(...cc.entries, ...slot, ...setterEntry);
                        defaultAttrs[an] = btNoteConstraintInit(cc.initExpr, c.endLine ?? c.line ?? 0, debugFile(c));
                        noteMember(c, false);
                        lastMemberConBody = cc.lastBody;
                        lastMemberConSrcLine = cc.lastSrcLine;
                    }
                    else {
                        instEntries.push(...slot, ...setterEntry);
                        if (c.attrs["setter"] != null)
                            noteMember(c, false);
                        if (raw != null) {
                            // Declared type wins over the name-based schema for defaults.
                            const declared = c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an);
                            defaultAttrs[an] = compileTypedValue(declared, raw, false);
                        }
                    }
                }
                else if (c.name === "method") {
                    // A `<method allocation="class">` is a static (class-allocated) member:
                    // it is prepended to the class-property array (before `tagname`), in
                    // document order — NOT an instance member. The synthetic constructor
                    // (`$lzsc$initialize`) then becomes the first instance member.
                    // (NodeModel.addProperty routes ALLOCATION_CLASS to classProps.)
                    if (c.attrs["allocation"] === "class") {
                        classAllocEntries.push(compileMethod(c));
                        lastStaticMethodClose = c.closeLine ?? c.endLine ?? c.line ?? lastStaticMethodClose;
                    }
                    else {
                        instEntries.push(compileMethod(c));
                        noteMember(c, false);
                    }
                }
                else if (c.name === "event") {
                    // <event name="X"/> → a void-0 slot + X:LzDeclaredEvent default. Under
                    // backtrace, the `LzDeclaredEvent` value is a checked free ref → noted at
                    // the event element's source line (the mergeAttributes IIFE frame is $3).
                    const en = c.attrs["name"];
                    if (!en)
                        throw new Unsupported(`<event> without name`);
                    if (!isInherited(def.superTag, en))
                        instEntries.push(voidSlot(en));
                    defaultAttrs[en] = COMPILE_BACKTRACE
                        ? `(${annoFileLine(null, 0)}$3.lineno = ${c.line ?? 0}, LzDeclaredEvent)`
                        : "LzDeclaredEvent";
                }
                else if (c.name === "setter") {
                    // <setter name="X" args="v">body</setter> → a $lzc$set_X method. The
                    // setter body inherits the `userFunctionName=set X` pragma line (+1).
                    const sn = c.attrs["name"];
                    if (!sn)
                        throw new Unsupported(`<setter> without name`);
                    const { names, defaults } = parseArgs(c.attrs["args"] || "");
                    const body = c.children.map((n) => (n.type === "text" ? n.value : "")).join("");
                    instEntries.push(COMPILE_DEBUG
                        ? ent("$lzc$set_" + sn, compileFunctionDebug("set " + sn, names, body, defaults, debugFile(c), c.line ?? 0, bodyLineOf(c), false, "report", true, "set " + sn))
                        : `${jsString("$lzc$set_" + sn)},${compileFunction(names, body, defaults)}`);
                    noteMember(c, false);
                }
                else if (c.name === "datapath") {
                    // A class-level <datapath> child → the class's `$datapath` (NodeModel
                    // .updateAttrs: `$datapath:<asMap>` + `datapath:LzNode._ignoreAttribute`
                    // in mergeAttributes, added AFTER the constructor, so the `"$datapath",
                    // void 0` decl slot follows $lzsc$initialize). Method/handler-bearing
                    // datapaths (the isdatapath inline-method asMap) are refused for now.
                    if (classDatapath)
                        throw new Unsupported(`multiple <datapath> children`);
                    classDatapath = buildNode(c, ctx, false, null, def.name);
                    if (classDatapath.datapath)
                        throw new Unsupported(`nested <datapath>`);
                    // A method/handler-bearing class datapath is `canHaveMethods=false`
                    // (like a <state>): its binder/method members install INLINE in the
                    // $datapath asMap's `attrs` (no anon subclass), routed via the isState
                    // path in emitNode — mirroring the instance-level datapath (~1483).
                    if (classDatapath.methodEntries.some((e) => !isVoidSlot(e)))
                        classDatapath.isState = true;
                }
                else if (isPropertyElement(c.name)) {
                    // other property elements (passthrough, etc.) — ignored for now
                }
                else {
                    // A view child: declare its name slot (if any), then build it as a
                    // class-defined child ($classrootdepth starts at 1, or 0 when the
                    // class is a state — assignClassRoot skips the root increment if the
                    // class's superclass isstate, NodeModel.java:2276).
                    // method gensyms in document order. A named child whose name is an
                    // INHERITED (redeclared) attribute declares NO void-0 slot
                    // (ClassModel.emitClassDeclaration: a null-valued attr is only
                    // `decls.put` when `!redeclared` — superModel.getAttribute(key)!=null).
                    if (c.attrs["name"] != null && !isInherited(def.superTag, c.attrs["name"]))
                        instEntries.push(voidSlot(c.attrs["name"]));
                    childNodes.push(buildNode(c, ctx, false, isStateClass(def.name) ? 0 : 1, def.name));
                }
            }
            // declareNamedChildren (NodeModel.java:639): a non-state class hoists the
            // named children of any <state> child up as its own reference slots
            // (deduped), appended after the document-order slots/methods.
            if (!isStateClass(def.name)) {
                for (const c of childViews(child)) {
                    if (!isStateClass(c.name))
                        continue;
                    for (const h of collectNamedChildren(childViews(c), c.name, ctx))
                        if (!instEntries.includes(voidSlot(h)) && !(h in defaultAttrs))
                            instEntries.push(voidSlot(h));
                }
            }
            // `clickable` defaults to true if the class declares a mouse-event
            // handler (and didn't set clickable explicitly). Also honored: an
            // explicit cursor="true" or a mouse-event attribute key.
            if (!("clickable" in defaultAttrs)) {
                const mouseAttr = Object.keys(defaultAttrs).some((k) => MOUSE_EVENTS.has(k));
                const mouseDelegate = [...delegateEvents].some((e) => MOUSE_EVENTS.has(e));
                if (defaultAttrs["cursor"] === "true" || mouseAttr || mouseDelegate)
                    defaultAttrs["clickable"] = "true";
            }
            if (delegateList.length > 0)
                defaultAttrs["$delegates"] = "[" + delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
            // Emit class-defined children (emit pass): their anon classes + any
            // forward-referenced instantiated classes come before this class def; their
            // maps go in the `children` class-property.
            const childResults = childNodes.map((n) => emitNode(n, resolve, inheritsChildren, mGen, compileClass));
            let childDefs = childResults.map((r) => r.defs).join("");
            const childMaps = childResults.map((r) => r.map);
            // The class-level <datapath>'s asMap is built in updateAttrs (after the
            // children's childrenMaps), installing `$datapath` + `datapath` inits.
            if (classDatapath) {
                const dp = emitNode(classDatapath, resolve, inheritsChildren, mGen, compileClass);
                childDefs += dp.defs;
                defaultAttrs["$datapath"] = dp.map;
                defaultAttrs["datapath"] = "LzNode._ignoreAttribute";
            }
            const inherits = inheritsChildren(def.superTag);
            // A class with `defaultplacement` appends a placement-sentinel child
            // (NodeModel.childrenMaps); its `attrs` is the placement name string.
            // BUT ClassModel.emitClassDeclaration only invokes childrenMaps() — and
            // therefore only inserts the sentinel + removes the `defaultplacement`
            // attr — when the class already emits a `children` slot, i.e. it has its
            // OWN children or inherits children (ClassModel.java:772-785 gate
            // `hasChildren || inheritsChildren`). A childless class (e.g.
            // basetabpanecontent) keeps `defaultplacement` as a plain default-attr
            // init in mergeAttributes and gets NO `children` slot.
            let defaultPlacementTarget;
            if ("defaultplacement" in defaultAttrs && (childMaps.length > 0 || inherits)) {
                defaultPlacementTarget = defaultAttrs["defaultplacement"];
                childMaps.push(emitObj({ attrs: defaultAttrs["defaultplacement"], class: "$lzc$class_userClassPlacement" }));
                delete defaultAttrs["defaultplacement"]; // consumed for placement, not a default attr
            }
            let childrenJs = null;
            if (childMaps.length > 0 || inherits) {
                const arr = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
                childrenJs = inherits ? `LzNode.mergeChildren(${arr}${COMPILE_DEBUG ? ", " : ","}${superJs}["children"])` : arr;
            }
            // State classes install their methods as inits (mergeAttributes), not
            // inline decls — the constructor is appended later, so it's unaffected.
            const emitEntries = isStateClass(def.name)
                ? routeStateMethods(instEntries, defaultAttrs)
                : instEntries;
            let dbg;
            if (COMPILE_DEBUG) {
                const classLine = (child.endLine ?? child.line ?? 0) - 1;
                const stateClass = isStateClass(def.name);
                // A state class routes ALL its methods/setters to mergeAttributes inits
                // (ClassModel.java:803), so its ScriptClass body has NO #pragma-bearing
                // method decls — only `var name;` void slots + the appended constructor.
                // So the constructor (loc=null) tracks to the GENERATED-line count from
                // the class header, not a member's source line → the directive form.
                // A class with own view children but NO code member is still member-rich
                // (plain ctor form): the children's instantiation content advances the
                // re-lex line counter, so the ctor (loc=null) inherits a generated-file
                // context at the LAST child's close line + 4 (the trailing static
                // `attributes` decl + the synthetic ctor's structural span). debugger
                // shadow_bottom: last <view> closes @124 → ctor 128; shadow_right @137→141.
                const lastOwnChild = childNodes.length ? childNodes[childNodes.length - 1] : undefined;
                // A state class with USER VIEW CHILDREN (not the attribute-only built-in
                // dragstate/resizestate or dbg3's _dbg_lzhdrag/_dbg_lzvdrag) emits a
                // `children` static whose literal value attrs reset the JavaCC `#file` to ""
                // (`#beginAttribute … #file <reset> #endAttribute`), so the synthetic ctor
                // (loc=null) inherits GENERATED context → the PLAIN ctor form, tracked at the
                // SAME childOnlyRich re-lex count as a plain class: lastLiteralLine + 4 +
                // voidSlots (`-SS`-confirmed states-$7 fadeDragger: vShadow el.endLine 16 + 4
                // + 4 void slots [$mh0/$mh1/hShadow/vShadow] = ctor line 24, generated context
                // `$reportException("", 24)`). Requires a source-literal child attr (a `#file`
                // reset); an all-constraint state subtree keeps the directive form.
                let stateChildRich = false;
                if (stateClass && lastOwnChild !== undefined) {
                    for (const cn of childNodes)
                        if (cn.subtreeLastLiteralLine != null) {
                            stateChildRich = true;
                            break;
                        }
                }
                const childOnlyRich = !stateClass && lastMemberClose < 0 && lastOwnChild !== undefined;
                // A childOnlyRich class whose children static emits NO source `#line` — every
                // child is an anon-class reference / constraint with no source-literal value
                // attr (subtreeLastLiteralLine undefined) and there is no `defaultplacement`
                // sentinel — never resets the JavaCC `#file` context to "" inside the children
                // array, so the synthetic ctor inherits the CLASS HEADER's source-file context:
                // it takes the DIRECTIVE form (member-LESS), not the plain/generated form,
                // tracked at the member-less ctorLine (classLine + 4 + extraStatic + voidSlots).
                // (tabsbarview3 #44, tabsbarviewcomplete #52, tabsview #78 — the single child
                // is `{…ref to $lzc$class_muw}` with only a `width` constraint, no literal.)
                let childOnlyNoLiteral = false;
                if (childOnlyRich && defaultPlacementTarget === undefined) {
                    childOnlyNoLiteral = true;
                    for (const cn of childNodes)
                        if (cn.subtreeLastLiteralLine != null) {
                            childOnlyNoLiteral = false;
                            break;
                        }
                }
                // A class with ONLY class-static methods (no instance code member, no view
                // children) is member-rich in the PLAIN sense: the static methods' bodies
                // reset `#file`, so the synthetic ctor inherits generated context.
                const staticMethodRich = !stateClass && lastMemberClose < 0 && lastOwnChild === undefined && lastStaticMethodClose !== undefined;
                const memberRich = stateClass
                    ? stateChildRich
                    : (lastMemberClose >= 0 || childOnlyRich || staticMethodRich) && !childOnlyNoLiteral;
                let ctorLine;
                if (stateChildRich) {
                    // State class with literal-bearing view children → PLAIN form, same
                    // re-lex count as childOnlyRich: anchor (last child's last source-literal
                    // line) + 4 (the `#file ` reset, `}];` children close, `static var
                    // attributes`, `function ctor`) + one `var name;` decl per void slot.
                    const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
                    let lastLit;
                    for (const cn of childNodes)
                        if (cn.subtreeLastLiteralLine != null)
                            lastLit = cn.subtreeLastLiteralLine;
                    const anchor = lastLit ?? lastOwnChild.el?.closeLine ?? lastOwnChild.el?.endLine ?? classLine;
                    ctorLine = anchor + 4 + voidSlotDecls;
                }
                else if (stateClass) {
                    // ScriptClass.toString: `dynamic class X extends Y {`(gen 1) + static
                    // vars (tagname/attributes [+children][+class-alloc]) + ndecls void
                    // slots + the constructor. gen-line(ctor) maps source gen-1 → classLine
                    // + 1, so ctorLine = classLine + 4 + ndecls + extra-static-vars.
                    // (resizestate: 2+10 → 16; dragstate: 2+16 → 22; member-less: +0.)
                    const ndecls = emitEntries.length;
                    const extraStatic = (childrenJs ? 1 : 0) + classAllocEntries.length;
                    ctorLine = classLine + 4 + ndecls + extraStatic;
                }
                else {
                    // member-rich → last code-member close + offset (handler 6, method/
                    // setter 5); member-less → classLine + 4 (synthetic ScriptClass string
                    // `class X {` / static tagname / static attributes / $lzsc$initialize).
                    // The ScriptClass body emits ONE `var name;` decl line per named-child
                    // void slot. Slots that come AFTER the last code member (e.g. button's
                    // `_outerbezel`…`_title` view children, declared after `_applystyle`)
                    // push the synthetic constructor down by that many lines — `noteMember`
                    // only tracks code members, so add the trailing-void-slot count.
                    let trailingVoidSlots = 0;
                    for (let k = emitEntries.length - 1; k >= 0 && isVoidSlot(emitEntries[k]); k--)
                        trailingVoidSlots++;
                    // A member-less class's synthetic ScriptClass.toString maps generated
                    // line G → source endLine + (G−1). The ctor sits after the `dynamic
                    // class X {` header (gen 1) and ALL static class attributes. The base
                    // `classLine + 4` (= endLine + 3) accounts for the 2 always-present
                    // statics (tagname/displayName + attributes); a `children` static (when
                    // the class declares/inherits children) and any class-allocation attrs
                    // each push the ctor down one more line — exactly the state-class
                    // `extraStatic`. (sliderthumb: +1 for inherited children → endLine+4=74.)
                    const extraStatic = (childrenJs ? 1 : 0) + classAllocEntries.length;
                    if (childOnlyRich && !childOnlyNoLiteral) {
                        // The synthetic ctor's `$reportException` line is the source line the
                        // re-lexer reaches at the ctor's `function` keyword. It anchors on the
                        // LAST `#line` the children static block emits, then counts the fixed
                        // generated lines between that `#line` and the ctor:
                        //   anchor + 1(`#file ` reset) + 1(`}];` children-array close)
                        //          + 1(`static var attributes …`) + V(one `var <name>;` decl
                        //            per void slot — named children + pure-value `<attribute>`s)
                        //          + 1(the ctor `function`)
                        // = anchor + 4 + voidSlotDecls.
                        // The void-decl block (`var a; var b; …`) is emitted AFTER the children
                        // array regardless of where each child's source line falls, so ALL void
                        // slots count — NOT only those trailing the last child (the literal
                        // anchor is INSIDE the children array, so every var-decl follows it).
                        // The LAST `#line` is:
                        //  * a `defaultplacement`-bearing class appends a placement SENTINEL as
                        //    the LAST children-array entry — `{attrs: "<target>", "class":
                        //    $lzc$class_userClassPlacement}` — whose `"<target>"` string carries
                        //    the `#line` of the placement source. An ELEMENT placement
                        //    (`<attribute name="defaultplacement">`) → that attribute's own line;
                        //    a TAG placement (`defaultplacement="…"`) → the class start-tag line
                        //    (= classLine + 1). Either way the sentinel is the LAST `#line`.
                        //    (tabscontent element placement @365, 1 slot → 370; scrollview tag
                        //    placement @5, 4 slots → 5 + 4 + 4 = 13.)
                        //  * otherwise the LAST source-literal value attr in DFS document order
                        //    (subtreeLastLiteralLine) — equals the last child's closeLine when
                        //    the last child carries the last literal (shadow_bottom @124 → 128),
                        //    but a deeper grandchild literal before its own close wins
                        //    (datepickercombobox: basebutton styleable @54 → 58). When the last
                        //    literal is FAR above the close (addresslist: scrollpane name @36,
                        //    children close @68), the var-decls still all follow it: 36 + 4 + 2
                        //    (addressSelection, scrollpane) = 42.
                        // Fall back to closeLine when the subtree has no literal at all.
                        const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
                        const placementAttrLine = defaultPlacementTarget !== undefined ? placementAttrSrcLine : undefined;
                        if (placementAttrLine != null) {
                            // Element-form `<attribute name="defaultplacement">`: the placement
                            // sentinel's `#line` is the attribute element's own source line.
                            ctorLine = placementAttrLine + 4 + voidSlotDecls;
                        }
                        else if (defaultPlacementTarget !== undefined) {
                            // Tag-form `defaultplacement="…"`: the placement sentinel's `#line` is
                            // the class start-tag line (classLine + 1).
                            ctorLine = (classLine + 1) + 4 + voidSlotDecls;
                        }
                        else {
                            let lastLit;
                            for (const cn of childNodes)
                                if (cn.subtreeLastLiteralLine != null)
                                    lastLit = cn.subtreeLastLiteralLine;
                            const anchor = lastLit ?? lastOwnChild.el?.closeLine ?? lastOwnChild.el?.endLine ?? classLine;
                            ctorLine = anchor + 4 + voidSlotDecls;
                        }
                    }
                    else if (staticMethodRich) {
                        // ONLY class-static methods (no instance member, no children): the ctor
                        // tracks at the last static method's close line + 5 (method→ctor span)
                        // + 2 (the `tagname`/`attributes` statics that, for static methods, sit
                        // AFTER the methods in the ScriptClass body). (probe1 m1 @5 → 12; probe2
                        // m2 @13 → 20; iso8601 leadingZero @40 → 47.)
                        ctorLine = lastStaticMethodClose + 7;
                    }
                    else if (memberRich && lastMemberConBody !== undefined) {
                        // Last code member is an always-constraint: track its deps body span.
                        const finalLine = finalSourceLine(srcDirective(debugFile(child), lastMemberConSrcLine) + lastMemberConBody + END_SRC_DIRECTIVE + "\n}");
                        ctorLine = finalLine + 1 + trailingVoidSlots;
                    }
                    else {
                        // A member-less class's ScriptClass body is: `dynamic class X {`(gen 1)
                        // + displayName/tagname static(2) + `attributes` static(3) [+ children/
                        // class-alloc statics] + one `var name;` decl per void slot(N) + the
                        // synthetic ctor. So ctorLine = classLine + 4 + extraStatic + N, where N
                        // is the void-slot decl count (each `<attribute>` decl with no setter/
                        // method). The state path already counts these via `ndecls`; the
                        // non-state member-less path must too. (amazon classlib.lzx `<class sel>`:
                        // 2 `<attribute>` decls (selectedItem, val) → 9 + 4 + 0 + 2 = ctor #15.)
                        const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
                        ctorLine = memberRich
                            ? lastMemberClose + (lastMemberHandler ? 6 : 5) + trailingVoidSlots
                            : classLine + 4 + extraStatic + voidSlotDecls;
                    }
                }
                dbg = { file: debugFile(child), classLine, bodyLine: child.endLine ?? child.line ?? 0, ctorLine, memberRich };
            }
            const out = childDefs + emitClassBlock(def.name, superJs, emitEntries, defaultAttrs, childrenJs, classAllocEntries, classDatapath != null, dbg);
            registrations.push(`lz[${jsString(def.name)}]=${classJsName(def.name)};`);
            if (DEBUG_STMTS) {
                lastTopFile = debugFile(child);
                lastTopWasInstance = false;
                // A top-level class emission leaves the JavaCC Token.currentPathname at the
                // class's own file (its `)()($lzc$class_…)` tail tracks at `<file>#…`), so a
                // directive-less FOLLOWING top-level statement (a `<dataset>`/lzAddLocalData)
                // inherits THAT file — not the stale debugger-library default. (datepicker's
                // datepicker_strings_en dataset follows basecomponent → base/basecomponent.lzx;
                // contactlist's mydata follows tabelement → lz/tabelement.lzx.)
                crossUnitFile = debugFile(child);
                pushDebug(out);
                return "";
            }
            return out;
        };
        // Canvas-level members: `<method>`/`<handler>`/`<attribute>`/`<event>`/
        // `<setter>` children make the canvas an anonymous subclass of LzCanvas
        // (`canvas=new $lzc$class_mN(null,{…})`). The canvas node is built first, so
        // its anon-class name is the FIRST `$m` (before any component-closure class).
        // The members go in the anon class; the canvas's view children are still
        // instantiated separately in the loop below.
        const CANVAS_MEMBER_TAGS = new Set(["method", "handler", "attribute", "event", "setter"]);
        const memberEls = root.children.filter((c) => c.type === "elem" && CANVAS_MEMBER_TAGS.has(c.name));
        // Event-handler ATTRIBUTES on the canvas (oninit="…") are routed through the
        // same synth member node as child `<handler>`s — each becomes a generated
        // method + `$delegates` entry on the anonymous LzCanvas subclass.
        const canvasEventAttrs = {};
        const canvasEventOrder = [];
        const canvasAttrLines = {};
        for (const name of root.attrOrder) {
            if (isEventAttr(name)) {
                canvasEventAttrs[name] = root.attrs[name];
                canvasEventOrder.push(name);
                canvasAttrLines[name] = root.endLine ?? root.line ?? 0;
            }
        }
        let canvasClass = "LzCanvas";
        let canvasAnonDef = "";
        let canvasAnonDefDebug = "";
        if (memberEls.length > 0 || canvasEventOrder.length > 0) {
            const synth = { type: "elem", name: "canvas", attrs: canvasEventAttrs, attrOrder: canvasEventOrder, attrLines: canvasAttrLines, children: memberEls, origin: root.origin, line: root.line, endLine: root.endLine };
            const built = buildNode(synth, ctx, true, null, "canvas");
            // $delegates/clickable and any pure-value <attribute> defaults are instance
            // attrs of the canvas (merged into cattrs); methods become the anon class.
            const attrs = { ...built.attrs };
            if (built.delegateList.length > 0)
                attrs["$delegates"] = "[" + built.delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
            for (const s of built.attrSlots)
                if (!(s in attrs))
                    attrs[s] = "void 0";
            for (const [k, v] of Object.entries(attrs))
                cattrs[k] = v;
            // Only real (function-valued) members force an anon class; a pure-value
            // `<attribute>` declaration (no method) just adds its value to the canvas
            // instance attrs (no decl slot, no subclass), like a plain instance.
            const hasMethods = built.methodEntries.some((e) => !isVoidSlot(e));
            if (hasMethods) {
                canvasClass = `$lzc$class_${mGen.next().slice(1)}`;
                canvasAnonDef = emitAnonClass(canvasClass, "LzCanvas", "canvas", built.methodEntries, null);
                // Debug build: the canvas's own anon class is a top-level `Class.make`
                // emitted (in document order) right BEFORE the `canvas = new …` line; the
                // production path inlines it as a raw prefix instead.
                if (debug)
                    canvasAnonDefDebug = emitAnonClassDebug(canvasClass, "LzCanvas", "canvas", built.methodEntries, null, built);
            }
        }
        const canvasLine = `canvas=new ${canvasClass}(null,${emitObject(cattrs)});`;
        // `js` accumulates the program BODY (everything after the canvas line):
        // class defs, instances/LzInstantiateView, registrations, initDone. The
        // canvas line + global var decls are prepended at return (in debug mode they
        // render compress=false; see below). In a debug build, top-level statements
        // are ALSO collected (in emission order) into DEBUG_STMTS — each its own
        // translation unit — and assembled via assembleDebugProgram at the end.
        DEBUG_STMTS = debug ? [] : null;
        // Pre-register every named `<resource name=…>` declaration's NAME up-front, so a
        // `resource="name"` reference resolves to the name regardless of where the
        // declaring file (a sibling `<include>`d library, e.g. amazon's resources.lzx)
        // sits relative to the REFERENCING file (classlib.lzx) or to on-demand class
        // compilation order. The oracle resolves named resources in its schema phase
        // (LzResourceLibrary, before view compilation); the actual emission below still
        // happens in document order (so sprite offsets stay correct — GAP-12).
        for (const child of root.children)
            if (child.type === "elem" && child.name === "resource") {
                const rn = child.attrs["name"];
                if (rn)
                    declaredResources.add(rn);
            }
        let js = "";
        for (const child of root.children) {
            // Canvas-level members are compiled into the anon class above, not here.
            if (child.type === "elem" && CANVAS_MEMBER_TAGS.has(child.name))
                continue;
            if (child.type === "text") {
                if (child.value.trim())
                    throw new Unsupported(`text directly under <canvas>`);
                continue; // inter-element whitespace doesn't break <debug>→<dataset> adjacency
            }
            // Capture-and-clear the "<debug> anon class just emitted" flag: it is true ONLY
            // on the iteration immediately following such a <debug> (the <debug> branch set
            // it then `continue`d; whitespace text was skipped above without clearing).
            const debugAnonPrev = debugAnonClassPending;
            debugAnonClassPending = false;
            if (child.name === "class") {
                // Emit on demand (forward-ref DFS); already done if pulled in earlier.
                js += compileClass(child.attrs["name"]);
                continue;
            }
            // An `<interface>` declaration emits nothing (its instances use `tag:`).
            if (child.name === "interface")
                continue;
            // A top-level `<script when="immediate">` emits its body inline here.
            // Program pieces join with the oracle's `;` rule: a script whose output
            // doesn't end in `;` (e.g. a bare `Mixin.make(…)`/`Class.make(…)` as its
            // last statement) gets a trailing separator before the next piece.
            if (child.name === "script" && child.attrs["when"] === "immediate") {
                let body = child.children.map((n) => (n.type === "text" ? n.value : "")).join("");
                // `<script src="file.js" when="immediate"/>`: the referenced JS is read
                // (relative to the including file) and prefixed with a `#file <src>` /
                // `#line 1` directive (ScriptElementCompiler.compile), exactly like the
                // instance-form `<script src>` path. md5.js (an AS3 `class md5 {…}`) is
                // emitted inline at the script's document position.
                const ssrc = child.attrs["src"];
                if (ssrc) {
                    const stext = SCRIPT_SRC?.(ssrc, child.origin ?? DEBUG_SOURCE_ID);
                    if (stext == null)
                        throw new Unsupported(`<script src="${ssrc}"> not found`);
                    body = `#file ${ssrc}\n#line 1\n` + stext;
                }
                if (DEBUG_STMTS) {
                    for (const u of compileProgramDebug(body, debugFile(child), bodyLineOf(child)))
                        pushDebug(u);
                    lastTopWasInstance = false; // an immediate-script body ends on generated context
                    continue;
                }
                const prog = compileProgram(body);
                if (prog)
                    js += prog.endsWith(";") ? prog : prog + ";";
                continue;
            }
            // A `<resource name=…>` declaration registers a named LzResourceLibrary
            // entry (no instance is emitted); referenced later by `resource="name"`.
            if (child.name === "resource") {
                registerNamedResource(child);
                continue;
            }
            // `<splash>` is a SWF-only preloader directive; the DHTML backend emits
            // nothing for it (verified against the oracle).
            if (child.name === "splash")
                continue;
            // `<security>` is a top-level SERVER-side directive: SecurityCompiler.compile
            // merely calls canvas.setSecurityOptions(element) and emits NO client output
            // (Compiler.java dispatches it to SecurityCompiler, never to instance/view
            // compilation). Its `<allow>/<deny>` children carry `<pattern>` regex text the
            // instance path would reject; skip the whole subtree.
            if (child.name === "security")
                continue;
            // A `<font>` declaration emits LzFontManager.addFont preamble lines.
            if (child.name === "font") {
                compileFontTag(child);
                continue;
            }
            // A `<stylesheet>` becomes an IIFE that registers LzCSSStyleRule rules,
            // emitted in document order (StyleSheetCompiler). The CSS-to-rules source
            // runs through the sc stage (rename locals, fold hex colors, requote).
            if (child.name === "stylesheet") {
                if (child.attrs["src"])
                    throw new Unsupported(`<stylesheet src=…>`);
                const cssText = child.children.map((n) => (n.type === "text" ? n.value : "")).join("");
                if (DEBUG_STMTS) {
                    // Debug: each rule carries `, "<file>", <i>` debug args (StyleSheetCompiler
                    // :179); the whole `; (function(){…})()` is compileScript'd WITH the element
                    // (sourceLocationDirective(element,true) → the `<stylesheet>` line). Routed
                    // through compileProgramDebug → the empty `;` stmt + the displayName-IIFE.
                    const progD = buildStylesheetProgram(cssText, debugFile(child));
                    if (progD) {
                        const styleLine = child.line ?? 0;
                        // displayName col of the inner generated `function ()` = the element's
                        // start-tag `>` column (sourceLocationDirective(element,true) pads that
                        // many spaces) + len("; (") + 1 = endCol + 4 (StyleSheetCompiler).
                        const styleCol = (child.endCol ?? 0) + 4;
                        for (const u of compileStylesheetDebug(progD, debugFile(child), styleLine, styleCol))
                            pushDebug(u);
                        lastTopWasInstance = false; // a stylesheet IIFE ends on generated context
                    }
                    continue;
                }
                const prog = buildStylesheetProgram(cssText);
                // The leading `;` (LPP-4083 workaround) is part of the oracle's output.
                if (prog)
                    js += ";" + compileProgram(prog);
                continue;
            }
            // A local `<dataset>` (literal/src content, not http/url/constraint) becomes
            // a global + a `name=canvas.lzAddLocalData(name,'<data>…',trim,nsprefix)`
            // statement, emitted in document order (DataCompiler).
            if (child.name === "dataset" && isLocalDataset(child)) {
                if (DEBUG_STMTS) {
                    // Immediately after a constraint/method `<debug>` anon class, the running
                    // Token.currentPathname is blank → this dataset emits in GENERATED context
                    // (no leading directive). Otherwise it inherits crossUnitFile#1 (the leaked
                    // static from the preceding class/instance). (databinding-$15 vs data_app-$1.)
                    const dsDir = debugAnonPrev ? ["", 0] : [crossUnitFile, 1];
                    for (const u of compileDatasetDebug(child, globals, globalOrigins, opts, dsDir))
                        pushDebug(u);
                    lastTopWasInstance = false; // a dataset ends on the inherited cross-unit context
                    continue;
                }
                js += compileDataset(child, globals, globalOrigins, opts);
                continue;
            }
            // A `<debug>` element is renamed to `LzDebugWindow` and does NOT emit a view
            // instance (DebugCompiler.compile). It builds the node-map and STORES a
            // `new $lzc$class_LzDebugWindow(canvas, {…}.attrs)` script, which the trailer
            // emits in place of Debug.makeDebugWindow(). The LzDebugWindow class itself is
            // already pulled in by the debug closure; the `<debug>` attrs (e.g. x/y/height)
            // become the instance attrs. (Non-debug builds emit nothing for `<debug>`.)
            if (child.name === "debug") {
                if (debug) {
                    const dbgEl = { ...child, name: "LzDebugWindow" };
                    const dbgBuilt = buildNode(dbgEl, ctx, true, null, "canvas");
                    const dbgR = emitNode(dbgBuilt, resolve, inheritsChildren, mGen, compileClass);
                    // The instantiated class is the map's own `"class"` value: a plain `<debug>`
                    // resolves to LzDebugWindow, but a `<debug>` with constraint/method attrs
                    // (e.g. dynamiccss's `width="65%"` %-constraints) becomes an anon subclass
                    // (`$lzc$class_mhN`), and the trailer's `new` uses THAT class — not the bare
                    // LzDebugWindow. (dbg3's plain `<debug>` stays LzDebugWindow.)
                    const clsMatch = dbgR.map.match(/"class": *([^,}]+)\}?$/);
                    const dbgClass = clsMatch ? clsMatch[1].trim() : resolve("LzDebugWindow");
                    debugWindowScript = `new ${dbgClass}(canvas, ${dbgR.map}.attrs)`;
                    // A `<debug>` with constraint/method attrs (x="50%" etc.) becomes an anon
                    // subclass `$lzc$class_mhN extends LzDebugWindow`, whose Class.make
                    // registration leaves the running Token.currentPathname BLANK ("") — so a
                    // directive-less DATASET immediately following emits in GENERATED context
                    // (no `/* file */` directive). Verified via -SS databinding-$15: the onion
                    // dataset unit is entirely `#fileline 0#0`. Scoped to the dataset path only
                    // (a flag), NOT a blanket crossUnitFile reset (which broke databinding-$28/
                    // $29/rpc-$20/rpc-soap-$8 by blanking the reg-trailer/instance context).
                    // ONLY a generated anon subclass ($lzc$class_mhN) blanks the running
                    // pathname; a LITERAL-attr `<debug y="100">` stays $lzc$class_LzDebugWindow
                    // and its following dataset KEEPS the debugger.lzx#1 directive (data_app-$1
                    // / databinding-$28/$29 pattern). So exclude the bare LzDebugWindow class.
                    debugAnonClassPending = !!(clsMatch && /^\$lzc\$class_/.test(dbgClass)
                        && dbgClass !== resolve("LzDebugWindow"));
                }
                continue;
            }
            // An instance: build (allocate method gensyms) then emit (allocate anon
            // class names + class defs). Anon classes (if any) are emitted before the
            // instantiate; nesting is handled to arbitrary depth.
            const built = buildNode(child, ctx, true, null, "canvas");
            const r = emitNode(built, resolve, inheritsChildren, mGen, compileClass);
            if (DEBUG_STMTS) {
                // A canvas-direct instance carries a LEADING source-location directive at
                // the element's endLine — JDOM/SAX reports an element at its start-tag close
                // (`>`/`/>`), so a multi-line open tag tracks at the `>` line, not the `<`
                // line (CompilerUtils.sourceLocationDirective on the element; RULE 8).
                const dir = annoFileLine(debugFile(child), child.endLine ?? child.line ?? 0);
                lastTopFile = debugFile(child);
                lastTopInstance = built;
                lastTopWasInstance = true;
                // The instance's trailing Token.currentPathname (S35/S36 Pattern A/B):
                // Pattern A (a source-literal value attr's `#beginAttribute` left a `#file `
                // reset, never restored) → "" (generated); Pattern B → the real app file.
                // A directive-less following statement (a `<dataset>`) inherits this.
                // Every top-level instance shifts the running Token.currentPathname (the
                // JavaCC static) to its trailing context, so a directive-less FOLLOWING
                // top-level statement (a `<dataset>`/lzAddLocalData) inherits it. This
                // includes library-origin instances spliced inline in document order
                // (lzpix's classes/dataman.lzx http-datasets: the `sizeds` instance leaves
                // classes/dataman.lzx, which the immediately-following `userds` local
                // dataset inherits). The debugger library is emitted as a MONOLITHIC closure
                // (not individual instances in this loop), so it never reaches here — no
                // origin gate is needed. (Before the top-level-CLASS crossUnitFile update
                // existed, an app-origin gate was a workaround; it is now removed.)
                crossUnitFile = instanceTrailingFile(built, debugFile(child));
                // Encode the trailing Token.currentPathname explicitly for the threaded
                // cross-statement context (S46) via the S36 structural discriminator, so a
                // directive-less following statement (the tag-map regs / trailer) inherits the
                // right Pattern A/B context. (The pure-positional last-`#file` model is NOT
                // sufficient: ci8/datapointer-basics want A while ci26/color-$6/ci19/readonly
                // want B despite structurally-similar trailing literals — the id/name binder
                // re-set is not derivable from the serialized stream alone. See S46 notes.)
                pushDebug(`${dir}canvas.LzInstantiateView(${r.map}, ${instanceContribution(child)})${setPathname(instanceTrailingFile(built, debugFile(child)))}`);
                continue;
            }
            js += r.defs + `canvas.LzInstantiateView(${r.map},${instanceContribution(child)});`;
        }
        if (DEBUG_STMTS) {
            // The global class registrations (`lz["name"] = $lzc$class_name`) and the
            // main-app trailer are each parsed by the oracle with NO leading `#file`
            // directive (ToplevelCompiler.outputTagMap / DHTMLWriter.finish addScript), so
            // they INHERIT the JavaCC lexer's `Token.currentPathname` left by the LAST
            // `#file` token of the LAST top-level instance's source. Two outcomes:
            //   Pattern B — currentPathname is the real app file (the last instance ended
            //     on its leading `#file <app>`, i.e. NO source-literal attr left a `#file `
            //     reset): each reg gets a SEQUENTIAL `/* file: app#k */` directive and the
            //     trailer `/* file: app#1 */`. (dbg3, lzunit, the `<script>`-last files.)
            //   Pattern A — currentPathname was reset to "" (the last instance ended on a
            //     source-literal attr's trailing empty `#file `, never restored): the regs
            //     and trailer emit INLINE with NO directive (generated line-state). (The
            //     canvas-direct literal-attr view apps: class-inheritance-$30/$31,
            //     debugging-$4, input-devices-$7/$10, methods-events-attributes-$20.)
            // GUARD (S36, conservative): Pattern A only when the LAST top-level statement
            // WAS an instance whose subtree has a source-literal value attr AND no
            // `<script>`/folded-content (whose `#beginContent` reset the oracle silently
            // re-establishes — the color-$3/databinding-$10 Pattern-B anomaly). Otherwise
            // take Pattern B (the prior working path; dbg3 MUST stay Pattern B). Spaced
            // `= ` (debug).
            // The reg/trailer Pattern-A vs Pattern-B discriminator is the THREADED
            // running Token.currentPathname left by the LAST top-level statement (S46):
            // each reg/trailer line is emitted as a deferred `G<idx>` marker, resolved at
            // assembly (translateAnnotatedUnit) against the threaded runningPathname.
            // Pattern A (currentPathname reset to "" by a trailing literal attr) → INLINE,
            // no directive; Pattern B (real app file) → sequential `/* file: app#k */`.
            // (Supersedes the structural `regsGenerated`/`topLevelHasIdOrName` guard — the
            // litReset markers already leave runningPathname="" after a literal-attr-ending
            // statement, so the running state now decides this exactly as the oracle does.)
            const regFile = lastTopFile;
            // ORACLE-PATCH MIRROR (2026-06-24): the oracle now resets Token.currentPathname
            // to "" immediately before compiling the generated tag map
            // (ToplevelCompiler.outputTagMap), so the registrations + trailer are ALWAYS
            // Pattern A (inline, no `#file` directive) regardless of what the last instance
            // left behind. Thread the identical reset here by prefixing the FIRST reg/trailer
            // statement with setPathname("") — runningPathname="" then threads through the
            // whole block. This supersedes the instanceTrailingFile/topLevelHasIdOrName
            // discriminator for the reg block (that leaked the last instance's parse-order
            // residue into a generated, file-less statement — see oracle/patch/README.md).
            // (instanceTrailingFile still threads per-instance context for binders, so it
            // stays; only its influence on the reg block is overridden.)
            let regResetPrefix = setPathname("");
            const pushReg = (marker) => { pushDebug(regResetPrefix + marker); regResetPrefix = ""; };
            registrations.forEach((reg, i) => pushReg(registerReg({ body: reg.replace(/;$/, "").replace("]=", "] = "), file: regFile, seq: i + 1 })));
            // Debug main-app trailer (DHTMLWriter:473-488): if the user's source has its
            // own `<debug>` element, emit the stored `new LzDebugWindow(canvas,…)` script;
            // otherwise bring up the default debugger with `Debug.makeDebugWindow()`. Then
            // `canvas.initDone()`. Each is an `addScript` one-line synthetic source that
            // inherits the same generated-or-real context as the regs.
            if (debugWindowScript) {
                // The stored user-debug script source ends with `;\n` (DebugCompiler), so the
                // following `canvas.initDone()` continues in the SAME translation unit with NO
                // directive of its own — unlike the `Debug.makeDebugWindow()` path (each its
                // own one-line addScript → each carries a directive). Verified vs the gold.
                pushReg(registerReg({ body: debugWindowScript + ";canvas.initDone()", file: regFile, seq: 1 }));
            }
            else {
                pushReg(registerReg({ body: "Debug.makeDebugWindow()", file: regFile, seq: 1 }));
                pushReg(registerReg({ body: "canvas.initDone()", file: regFile, seq: 1 }));
            }
        }
        js += registrations.join("");
        js += "canvas.initDone();";
        // Emission order (the oracle's mResourceDefs): all named `<resource>` resources
        // (already in `preamble`), then all fonts, then the deferred anonymous `$LZ`
        // view resources — the anon offsets continue the shared sprite counter from its
        // final named value.
        // Fonts emit AFTER named resources, ordered by origin category like globals:
        // app/host fonts (cat 1) before included-library fonts (cat 2) — the oracle
        // compiles library fonts as a separate (later) unit. Stable within a category
        // (document order). E.g. welcome.lzx's host headerfont/Helmet precede the
        // rclock library's Kgr even though the <include> is spliced earlier in source.
        const fontCat = (o) => (AUTO_ORIGINS.has(o) ? 0 : LIBRARY_ORIGINS.has(o) ? 2 : 1);
        preamble.push(...fontEntries
            .map((e, i) => ({ e, c: fontCat(e.origin), r: ORIGIN_RANK.get(e.origin) ?? 0, i }))
            .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
            .map((x) => x.e.line));
        for (const e of anonResEntries) {
            preamble.push(e.render(spriteOffset));
            spriteOffset += e.height;
        }
        let lib = preamble.join("");
        if (hasResource && opts.sprites !== "none")
            lib += `LzResourceLibrary.__allcss={path:'${opts.spritePath ?? "app.sprite.png"}'};`;
        // Preamble order: resources/fonts (document order), then id/name globals, then canvas.
        if (debug) {
            // Debug build (compress=false): the whole program is a list of top-level
            // statements — the `var X = null` globals, the `canvas = new LzCanvas(…)`
            // line, then every collected body statement (class `Class.make(…)` blocks,
            // instances, colors, registrations, initDone) — each rendered spaced and
            // source-annotated, assembled (each its own translation unit) via
            // assembleDebugProgram. The resource preamble (`lib`) stays a compressed raw
            // prefix (the oracle's mResourceDefs StringBuffer).
            const allStmts = [
                ...orderGlobals(globals, globalOrigins, opts.sourceId ?? "").map((g) => `var ${g} = null`),
                ...(canvasAnonDefDebug ? [canvasAnonDefDebug] : []),
                `canvas = new ${canvasClass}(null, ${emitObjectSpaced(cattrs)})`,
                ...(DEBUG_STMTS ?? []),
            ];
            return { js: lib + assembleDebugProgram(allStmts) };
        }
        const globalDecls = orderGlobals(globals, globalOrigins, opts.sourceId ?? "").map((g) => `var ${g}=null;`).join("");
        return { js: lib + globalDecls + canvasAnonDef + canvasLine + js };
    }
    catch (e) {
        if (e instanceof Unsupported || e instanceof ScUnsupported || e instanceof CssUnsupported)
            return { js: "", unsupported: e.message };
        throw e;
    }
}
