// Debug-build (readable / source-mapped) backend support — a faithful port of
// the source-location annotation stream + makeTranslationUnits post-pass from
// org.openlaszlo.sc.ParseTreePrinter (the `compress=false, trackLines=true`
// configuration the oracle uses for `canvas debug="true"`).
//
// The sc Printer (in debug mode) and compile.ts emit an ANNOTATED string: each
// emitted construct is prefixed by a file/line annotation `\u0001 f <file>#<n> \u0001`
// when its (file,line) differs from the annotation already in effect. A final
// `translateAnnotated` pass walks the stream tracking a per-translation-unit
// GENERATED line counter and turns the annotations into the visible
// `/* -*- file: X#N -*- */` source-location directives (and blank-line padding),
// exactly as ParseTreePrinter.makeTranslationUnits does.
//
// NOTE on operand encoding: the Java code keys filenames through a fid table and
// encodes the operand as `<fid>#<line>`. We encode the filename directly
// (`<filename>#<line>`) since lzx filenames never contain `#` — this lets any
// Printer instance emit annotations without sharing a fid table, and the decode
// (extractFileName/extractLineNumber) is identical in behaviour.
export const ANNOTATE_MARKER = "\u0001";
export const OP_FILE_LINENUM = "f";
export const OP_FILE_LINENUM_FORCE = "F";
export const OP_CLASSNAME = "C";
export const OP_CLASSEND = "c";
export const OP_BINDER = "B";
export const OP_PATHRESET = "R";
export const OP_PATHRESET_ONLY = "r";
export const OP_REG = "G";
export const OP_SETPATH = "P";
// A source-literal attr value (`id: "x"`, `text: "…"`, a plain immediate value) is
// serialized by the oracle wrapped in `<key>: #beginAttribute\n\n#file <app>\n#line
// <srcLine>\n<value>\n#file \n#endAttribute`, whose trailing empty `#file ` resets
// Token.currentPathname to "". So at the `#endAttribute` the lexer's currentLine =
// srcLine + 2 (value line, #file line, #endAttribute line) and currentPathname = "".
// We don't model the full #beginAttribute machinery, but we DO emit this marker so:
//   (1) the running-currentPathname tracker sees the reset (Pattern-A discriminator);
//   (2) the running source-line tracker advances to srcLine + 2 (the Pattern-A binder
//       $reportException line N — the oracle's cumulative positional line, which for a
//       binder following a literal attr's #endAttribute equals srcLine + 2).
// The marker is consumed (no output) by the pass.
export function litReset(srcLine) {
    return ANNOTATE_MARKER + OP_PATHRESET + srcLine + ANNOTATE_MARKER;
}
/** pathOnlyReset: resets the running Token.currentPathname to "" (Pattern-A
 *  discriminator) after a constraint value's trailing empty `#file ` (compileAttribute
 *  wraps the value in `#beginAttribute ... #file #endAttribute`). `nLine` sets the
 *  running source-line counter to the positional N a following Pattern-A binder reports
 *  in `$reportException("", N)`: the binder's `function` token line in the concatenated
 *  NodeModel script, which the JavaCC lexer counts relative to the constraint's last
 *  `#line` directive. (Used by a `$datapath`-constraint-preceded `$lzc$bind_id`.) */
export function pathOnlyReset(nLine) {
    return ANNOTATE_MARKER + OP_PATHRESET_ONLY + nLine + ANNOTATE_MARKER;
}
/** setPathname: a no-output marker appended to the END of a top-level statement that
 *  explicitly sets the threaded Token.currentPathname for the NEXT statement (S46).
 *  Used to encode the S36 instance-trailing-file discriminator (a hidden re-set the
 *  serialized literal-attr markers alone don't capture: a top-level id/name's name
 *  registration / inline content `#beginContent` silently re-establishes the app
 *  file). file="" → Pattern A (currentPathname reset); a real file → Pattern B. */
export function setPathname(file) {
    return ANNOTATE_MARKER + OP_SETPATH + file + ANNOTATE_MARKER;
}
let BINDER_TABLE = [];
export function resetBinderTable() { BINDER_TABLE = []; }
export function registerBinder(spec) {
    const idx = BINDER_TABLE.length;
    BINDER_TABLE.push(spec);
    return ANNOTATE_MARKER + OP_BINDER + idx + ANNOTATE_MARKER;
}
/** The mutable spec of the most-recently-registered binder. The compile pass uses
 *  this to override a class-def-first-child binder's funcLine (it must be the anon
 *  class's ctorLine − 4, not el.endLine; resolved once the ctorLine is known in
 *  emitAnonClassDebug). */
export function lastBinderSpec() {
    return BINDER_TABLE.length > 0 ? BINDER_TABLE[BINDER_TABLE.length - 1] : undefined;
}
let REG_TABLE = [];
export function resetRegTable() { REG_TABLE = []; }
export function registerReg(spec) {
    const idx = REG_TABLE.length;
    REG_TABLE.push(spec);
    return ANNOTATE_MARKER + OP_REG + idx + ANNOTATE_MARKER;
}
function isActualFile(str) {
    return str !== "" && !str.startsWith("[");
}
/** annotateFileLineNumber: a file/line annotation marker. A non-real filename
 *  (empty or `[...]`) collapses to the generated-code marker `#0`. */
export function annoFileLine(filename, line, force = false) {
    let f = filename ?? "";
    let n = line;
    if (!isActualFile(f)) {
        f = "";
        n = 0;
    }
    const op = force ? OP_FILE_LINENUM_FORCE : OP_FILE_LINENUM;
    return ANNOTATE_MARKER + op + f + "#" + n + ANNOTATE_MARKER;
}
/** forceBlankLnum: a forced blank-line annotation emitted after every function
 *  close `}` (ParseTreePrinter.forceBlankLnum) → renders `/* -*- file: -*- *​/`. */
export function forceBlankLnum() {
    return "\n" + annoFileLine(null, 0, true);
}
export const OP_CLASSNAME_ANNO = (name) => ANNOTATE_MARKER + OP_CLASSNAME + name + ANNOTATE_MARKER;
export const OP_CLASSEND_ANNO = () => ANNOTATE_MARKER + OP_CLASSEND + ANNOTATE_MARKER;
// ---- decode helpers (operand = `<filename>#<line>`) ----
function extractLineNumber(operand) {
    const pos = operand.indexOf("#");
    return parseInt(operand.substring(pos + 1), 10);
}
function extractFileName(operand) {
    const pos = operand.indexOf("#");
    return operand.substring(0, pos);
}
/** The first annotation in a string (used by the Printer's lnum to decide
 *  whether a node's line info is already present). Returns null if the string
 *  does not begin with an annotation. */
export function firstAnnotation(str) {
    if (str.length < 1 || str[0] !== ANNOTATE_MARKER)
        return null;
    const end = str.indexOf(ANNOTATE_MARKER, 1);
    if (end < 0)
        return null;
    return { op: str[1], operand: str.substring(2, end) };
}
/** fileLineNumberNeeded (ParseTreePrinter:1158): does this node give new line
 *  info beyond the annotation already at the head of str? */
export function fileLineNumberNeeded(ann, filename, line) {
    if (ann == null || (ann.op !== OP_FILE_LINENUM && ann.op !== OP_FILE_LINENUM_FORCE))
        return false;
    let nodeFile = filename ?? "";
    let nodeLine = line;
    let annLine = extractLineNumber(ann.operand);
    let annFile = extractFileName(ann.operand);
    if (nodeFile === "") {
        nodeFile = "";
        nodeLine = 0;
    }
    if (!isActualFile(nodeFile)) {
        nodeFile = "";
        nodeLine = 0;
    }
    if (annFile === "") {
        annFile = "";
        annLine = 0;
    }
    return !nodeFile.startsWith("[") && (annFile !== nodeFile || annLine !== nodeLine);
}
function newLineNumberState() {
    return { filename: "", hasfile: false, linenum: Number.MIN_SAFE_INTEGER, linediff: Number.MIN_SAFE_INTEGER };
}
function countLines(s) {
    let c = 0;
    for (let i = 0; i < s.length; i++)
        if (s[i] === "\n")
            c++;
    return c;
}
/** A translation unit: an output buffer plus a 1-based GENERATED line counter
 *  (TranslationUnit.linenum, advanced by countLines on every addText). */
class TranslationUnit {
    constructor() {
        this.text = "";
        this.linenum = 1;
    }
    addText(s) { this.text += s; this.linenum += countLines(s); }
    getTextLineNumber() { return this.linenum; }
}
function getLineNumberState(tu, operand) {
    const s = newLineNumberState();
    s.filename = extractFileName(operand);
    s.hasfile = isActualFile(s.filename);
    if (s.hasfile) {
        s.linenum = extractLineNumber(operand);
        s.linediff = tu.getTextLineNumber() - s.linenum;
    }
    return s;
}
/** shouldShowSourceLocation (ParseTreePrinter:1426). */
function shouldShowSourceLocation(os, ns, op, atBol) {
    const fileSame = os.filename === ns.filename;
    const lineSame = os.linediff === ns.linediff;
    if (!fileSame) {
        if (atBol && (ns.hasfile || os.hasfile))
            return true;
    }
    else if (op === OP_FILE_LINENUM_FORCE && ns.filename.length > 0) {
        return true;
    }
    else if (atBol && ns.linenum > 0 && (!lineSame || !fileSame)) {
        return true;
    }
    return false;
}
/** Iterate the annotation stream, calling notify(op, operand). op === "" means
 *  a plain text chunk. (AnnotationProcessor.process.) */
function processAnnotations(annotated, notify) {
    let endann = -1;
    let startann = annotated.indexOf(ANNOTATE_MARKER);
    while (startann >= 0) {
        notify("", annotated.substring(endann + 1, startann));
        const op = annotated[startann + 1];
        endann = annotated.indexOf(ANNOTATE_MARKER, startann + 2);
        if (endann < 0)
            throw new Error("bad annotation markers");
        notify(op, annotated.substring(startann + 2, endann));
        startann = annotated.indexOf(ANNOTATE_MARKER, endann + 1);
    }
    notify("", annotated.substring(endann + 1));
}
export function translateAnnotatedUnit(annotated, incoming) {
    const defaulttu = new TranslationUnit();
    const tunits = [defaulttu];
    // Shared mutable state so the binder re-entrant call (op B) processes its stream
    // through the SAME generated-line counter + line-state continuum as the outer.
    const st = {
        curtu: defaulttu,
        atBol: true,
        curLstate: newLineNumberState(),
        newLstate: newLineNumberState(),
        srcloc: null,
        diff: 0,
        // The oracle's Token.currentPathname at the current serialize position: set by a
        // real `#file` directive, reset to "" by a literal-attr `#endAttribute` (R marker).
        // Drives the Pattern-A binder discriminator (independent of curLstate, which is the
        // directive-DISPLAY state and is polluted by generated/forceBlankLnum markers).
        // SEEDED from the previous top-level statement's trailing context (cross-unit
        // threading) so a directive-less reg/trailer statement inherits it (S46).
        runningPathname: incoming?.runningPathname ?? "",
        // The oracle's cumulative source-line at the current serialize position. After a
        // literal attr's #endAttribute it is (attr srcLine + 2). A Pattern-A binder that
        // follows reads this as its $reportException line N.
        runningSrcLine: incoming?.runningSrcLine ?? 0,
    };
    const notify = (op, operand) => {
        if (op === "") {
            if (operand.length > 0) {
                if (st.srcloc != null && st.srcloc.length > 0) {
                    st.curtu.addText(st.srcloc);
                    st.newLstate.linediff += st.diff;
                    st.curLstate = st.newLstate;
                    st.srcloc = null;
                }
                st.curtu.addText(operand);
                st.atBol = operand.endsWith("\n");
            }
            return;
        }
        if (op === OP_PATHRESET) {
            st.runningPathname = "";
            st.runningSrcLine = parseInt(operand, 10) + 2; // value line, #file line, #endAttribute line
            return;
        }
        if (op === OP_PATHRESET_ONLY) {
            st.runningPathname = ""; // constraint value's trailing #file reset
            st.runningSrcLine = parseInt(operand, 10); // positional N for a following binder
            return;
        }
        if (op === OP_SETPATH) {
            // Explicit cross-statement pathname override (the S36 instance-trailing-file
            // discriminator). Captures hidden re-sets the literal-attr R markers don't.
            st.runningPathname = operand;
            return;
        }
        if (op === OP_FILE_LINENUM || op === OP_FILE_LINENUM_FORCE) {
            st.newLstate = getLineNumberState(st.curtu, operand);
            // Track the running currentPathname: a real-file directive sets it; a
            // generated (#0) directive does NOT change it (the oracle's #file <reset>
            // comes via #endAttribute = the R marker, not a generated annotation).
            if (st.newLstate.hasfile)
                st.runningPathname = st.newLstate.filename;
            if (shouldShowSourceLocation(st.curLstate, st.newLstate, op, st.atBol)) {
                const offset = st.curLstate.linediff - st.newLstate.linediff;
                if (st.atBol) {
                    st.srcloc = "";
                    st.diff = 0;
                }
                else {
                    st.srcloc = "\n";
                    st.diff = 1;
                }
                if (st.newLstate.filename.length === 0) {
                    st.srcloc += "/* -*- file: -*- */\n";
                    st.diff += 1;
                }
                else if (op === OP_FILE_LINENUM_FORCE || st.curLstate.filename !== st.newLstate.filename) {
                    st.srcloc += "/* -*- file: " + st.newLstate.filename + "#" + st.newLstate.linenum + " -*- */\n";
                    st.diff += 1;
                }
                else {
                    const update = "/* -*- file: #" + st.newLstate.linenum + " -*- */\n";
                    if (st.atBol && offset > 0 && offset < update.length) {
                        for (let i = 0; i < offset; i++)
                            st.srcloc += "\n";
                        st.diff += offset;
                    }
                    else {
                        st.srcloc += update;
                        st.diff += 1;
                    }
                }
            }
            return;
        }
        if (op === OP_BINDER) {
            const spec = BINDER_TABLE[parseInt(operand, 10)];
            // Flush any pending source-location so curtu.linenum reflects the binder's
            // position. Then the binder's `function` token sits at the generated line
            // ONE below the `(function () {` opener — N = curtu.linenum + 1.
            if (st.srcloc != null && st.srcloc.length > 0) {
                st.curtu.addText(st.srcloc);
                st.newLstate.linediff += st.diff;
                st.curLstate = st.newLstate;
                st.srcloc = null;
            }
            const patternA = st.runningPathname === ""; // currentPathname reset → Pattern A
            const stream = patternA
                ? spec.render("", st.runningSrcLine)
                : spec.render(spec.file, spec.funcLine);
            // Process the binder's own annotation stream through the SAME state, so
            // Pattern-B directive collapse / line tracking continue from the outer context.
            processAnnotations(stream, notify);
            return;
        }
        if (op === OP_REG) {
            const spec = REG_TABLE[parseInt(operand, 10)];
            // Pattern A (currentPathname reset to "") → INLINE, no directive. Pattern B →
            // the sequential real-file directive, processed through the same state.
            const patternA = st.runningPathname === "";
            const stream = patternA
                ? spec.body
                : annoFileLine(spec.file, spec.seq) + spec.body;
            processAnnotations(stream, notify);
            return;
        }
        if (op === OP_CLASSNAME) {
            st.curtu = new TranslationUnit();
            tunits.push(st.curtu);
            return;
        }
        if (op === OP_CLASSEND) {
            st.curtu = defaulttu;
            return;
        }
    };
    processAnnotations(annotated, notify);
    return {
        text: tunits.map((t) => t.text).join(""),
        ctx: { runningPathname: st.runningPathname, runningSrcLine: st.runningSrcLine },
    };
}
/** The synthetic class CONSTRUCTOR (`$lzsc$initialize`), rendered compress=false
 *  as an annotation stream. Every LZX class gets an identical generated
 *  constructor (ClassModel.emitClassDeclaration: body `super(parent, attrs,
 *  children, async)`, args `parent/attrs/children/async` with defaults) — only
 *  the (file, source-line) vary, so this is a fixed template:
 *
 *  - the JavascriptGenerator displayName IIFE wrapper `(function () { var
 *    $lzsc$temp = <fn>; $lzsc$temp["displayName"]="$lzsc$initialize"; return
 *    $lzsc$temp })()`;
 *  - the debug try/catch + `$reportException` structural wrapper around the body;
 *  - the `switch (arguments.length)` default-param prologue + the super dispatch.
 *
 *  The constructor's source line (`ctorLine`) is the line of the class's LAST
 *  code-generating member (the constructor is appended last to the class attrs
 *  with no source location of its own, so sc tracks it to the preceding member's
 *  line); for a member-less class it falls back to classLine + offset. The body
 *  (default assignments + super) sits one line below the `function` header
 *  (`ctorLine + 1`). Verified byte-for-byte vs the dbg3 gold (debug class). */
export function debugConstructor(file, ctorLine) {
    const L = ctorLine, B = ctorLine + 1;
    const A = (n) => annoFileLine(file, n);
    const Agen = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    const superDispatch = '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"]' +
        ' || this.nextMethod(arguments.callee, "$lzsc$initialize")).call(this, parent_$0, attrs_$1, children_$2, async_$3)';
    const switchText = "switch (arguments.length) {\ncase 0:\n" + A(B) +
        "parent_$0 = null;;case 1:\nattrs_$1 = null;;case 2:\nchildren_$2 = null;;case 3:\nasync_$3 = false\n}";
    const catchBody = 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error)' +
        ' && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + JSON.stringify(file) + ", " + L +
        ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
    const tryText = "try {\n" + A(L) + switchText + ";\n" + A(B) + superDispatch + "\n}\n" +
        Agen + "catch ($lzsc$e) {\n" + catchBody + "}";
    const funcBlock = "{\n" + Agen + tryText + "}";
    const FUNC = A(L) + "function  (parent_$0, attrs_$1, children_$2, async_$3) " + funcBlock + FB;
    const S1 = A(L) + "var $lzsc$temp = " + FUNC + ";";
    const S2 = A(L) + '$lzsc$temp["displayName"] = "$lzsc$initialize";';
    const S3 = A(L) + "return $lzsc$temp";
    return "(function () {\n" + S1 + "\n" + S2 + "\n" + S3 + "\n}" + FB + ")()";
}
/** The synthetic constructor for a MEMBER-RICH class — rendered with NO
 *  source-location directives (file=""): the constructor (loc=null) inherits sc's
 *  position AFTER the last member, whose `#endContent` / endSourceLocationDirective
 *  reset the file to "" (generated), so no `/* -*- file -*- *​/` directives and no
 *  forceBlankLnum padding appear, and `$reportException("", <line>)`. The `line`
 *  is the last code-member's close-tag line + an offset (5 for method/setter, 6
 *  for handler). Verified vs the dbg3 gold (basefocusview, style, basecomponent…). */
export function debugConstructorPlain(line) {
    // A leading generated-file annotation: emits `/* -*- file: -*- */` ONLY when the
    // file context in effect before the ctor is a real source file (the child-only
    // member-rich case, where the ctor is the first instance prop and follows the
    // class directive). When a preceding code member already reset the context to
    // generated (its forceBlankLnum), the annotation collapses to nothing — so the
    // constraint/method-rich plain ctors are byte-unchanged.
    return ("(function () {\n" +
        annoFileLine(null, 0) +
        "var $lzsc$temp = function  (parent_$0, attrs_$1, children_$2, async_$3) {\n" +
        "try {\n" +
        "switch (arguments.length) {\ncase 0:\n" +
        "parent_$0 = null;;case 1:\nattrs_$1 = null;;case 2:\nchildren_$2 = null;;case 3:\nasync_$3 = false\n};\n" +
        '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"]' +
        ' || this.nextMethod(arguments.callee, "$lzsc$initialize")).call(this, parent_$0, attrs_$1, children_$2, async_$3)\n' +
        "}\n" +
        "catch ($lzsc$e) {\n" +
        'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error)' +
        ' && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException("", ' + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}}}\n" +
        ";\n" +
        '$lzsc$temp["displayName"] = "$lzsc$initialize";\n' +
        "return $lzsc$temp\n" +
        "}\n" +
        ")()");
}
/** Render a `Class.make(name, [props], super, [classprops])` top-level statement
 *  compress=false as an annotation stream, opened by the class-definition source-
 *  location directive. `classLine` is the directive line (= the start-tag's
 *  closing `>` line − 1). `instProps` are the already-rendered instance-property
 *  entries (the synthetic constructor entry `"$lzsc$initialize", <debugConstructor>`
 *  is the last); `classPropsInner` is the comma-joined class-property body. Run
 *  through translateAnnotatedUnit / assembleDebugProgram for the final text. */
export function renderDebugClassMake(file, classLine, classNameJs, instProps, superJs, classPropsInner) {
    return annoFileLine(file, classLine) +
        "Class.make(" + classNameJs + ", [" + instProps.join(", ") + "], " +
        superJs + ", [" + classPropsInner + "])";
}
/** Assemble a list of top-level annotated statements into the final program,
 *  mirroring JavascriptGenerator.compileBlock: each top-level statement is its
 *  own makeTranslationUnits call (a fresh generated-line counter), and a ";" is
 *  appended after any unit whose contents do not already end in ";". */
export function assembleDebugProgram(topLevelAnnotated) {
    let out = "";
    // The cross-unit running context (Token.currentPathname / cumulative source line)
    // threaded across top-level statements. Each statement starts fresh in the oracle
    // (its own makeTranslationUnits/AnnotationProcessor for the DISPLAY state), but the
    // JavaCC lexer's currentPathname is a STATIC that persists — so a directive-less
    // reg/trailer statement inherits the prior statement's trailing pathname (S46).
    let ctx = { runningPathname: "", runningSrcLine: 0 };
    for (const stmt of topLevelAnnotated) {
        const r = translateAnnotatedUnit(stmt, ctx);
        ctx = r.ctx;
        out += r.text;
        if (!r.text.endsWith(";"))
            out += ";";
    }
    return out;
}
