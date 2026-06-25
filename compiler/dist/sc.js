// Minimal port of the OpenLaszlo `sc` script stage for the DHTML target:
// parse a JS method/expression body, rename params+locals to $0,$1,…, and
// pretty-print with the oracle's conventions (compress=true,obfuscate=false:
// SPACE="", NEWLINE="\n"). Covers a common subset; grows as the corpus demands.
import { jsString } from "./value.js";
import { annoFileLine, forceBlankLnum, firstAnnotation, fileLineNumberNeeded, ANNOTATE_MARKER } from "./debug.js";
export class ScUnsupported extends Error {
}
const PUNCT = [
    ">>>=", "===", "!==", ">>>", "<<=", ">>=", "&&=", "||=", "**=",
    "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=",
    "%=", "&=", "|=", "^=", "<<", ">>", "**",
    "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/",
    "%", "&", "|", "^", "!", "~", "?", ":", "=", "...", ".",
];
const KEYWORDS = new Set([
    "var", "return", "if", "else", "for", "while", "do", "function", "new",
    "typeof", "delete", "void", "instanceof", "in", "this", "true", "false",
    "null", "break", "continue", "switch", "case", "default", "throw", "try",
    "catch", "finally", "super", "with",
]);
/** Lex `src` to tokens, tracking 1-based source line per token. `baseLine` is the
 *  absolute line in the enclosing .lzx file where `src` begins (so an embedded
 *  `<script>`/`<method>` body's tokens carry true file lines for the debug build's
 *  source directives); defaults to 1. Newlines inside whitespace, comments and
 *  string literals all advance the line counter, matching JavaCC.
 *
 *  `baseFile` sets the initial source filename context for the per-token `file`
 *  (used by the debug backend's source directives). The lexer also HONORS the
 *  oracle's embedded source-location directives in a generated body string
 *  (CompilerUtils.sourceLocationDirective): `#file <path>` sets the current file
 *  ("" = generated code), `#line <n>` sets the next line's number; the
 *  `#beginAttribute`/`#endAttribute`/`#pragma …` markers are skipped. This lets a
 *  single generated function body (e.g. a constraint setter `var $lzc$newvalue =
 *  <srcloc>expr<endsrcloc>; if(…){…}`) carry MIXED per-statement file/line — the
 *  expr at its true .lzx line, the surrounding generated code at file="". */
function lex(src, baseLine = 1, baseFile) {
    const toks = [];
    let i = 0;
    let line = baseLine;
    let lineStart = 0; // index of the current line's first char → 1-based column = i - lineStart + 1
    let curFile = baseFile;
    const n = src.length;
    const countNl = (from, to) => { for (let k = from; k < to; k++)
        if (src[k] === "\n") {
            line++;
            lineStart = k + 1;
        } };
    while (i < n) {
        const c = src[i];
        if (/\s/.test(c)) {
            if (c === "\n") {
                line++;
                lineStart = i + 1;
            }
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            while (i < n && src[i] !== "\n")
                i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            const e = src.indexOf("*/", i + 2);
            const end = e < 0 ? n : e + 2;
            countNl(i, end);
            i = end;
            continue;
        }
        // Embedded compiler directive (generated bodies only — `#` is never valid JS,
        // so this is inert for user source). `#file <path>` / `#line <n>` are
        // whole-line source-location directives (CompilerUtils.sourceLocationDirective);
        // `#pragma …` is a whole-line marker; `#beginAttribute`/`#endAttribute` are
        // INLINE markers (the `;` after `#endAttribute` must survive as a token).
        if (c === "#") {
            let w = i + 1;
            while (w < n && /[A-Za-z]/.test(src[w]))
                w++;
            const word = src.slice(i, w);
            if (word === "#file" || word === "#line" || word === "#pragma") {
                let eol = src.indexOf("\n", w);
                if (eol < 0)
                    eol = n;
                const rest = src.slice(w, eol).trim();
                i = eol < n ? eol + 1 : n; // consume through the trailing newline
                lineStart = i; // a directive line is whole-line; the next line starts at i
                if (word === "#file") {
                    curFile = rest;
                    line++;
                } // rest="" → generated code
                else if (word === "#line")
                    line = parseInt(rest, 10); // the FOLLOWING line is N
                else
                    line++; // #pragma: skip + count the consumed newline
            }
            else {
                i = w; // inline marker (#beginAttribute/#endAttribute): consume just the word
            }
            continue;
        }
        const tokLine = line;
        const tokCol = i - lineStart + 1;
        const tokFile = curFile;
        if (c === '"' || c === "'") {
            let j = i + 1, s = "";
            while (j < n && src[j] !== c) {
                if (src[j] === "\\") {
                    s += unescapeChar(src, j);
                    j += escLen(src, j);
                }
                else {
                    if (src[j] === "\n") {
                        line++;
                        lineStart = j + 1;
                    }
                    s += src[j++];
                }
            }
            toks.push({ t: "str", v: s, line: tokLine, col: tokCol, file: tokFile });
            i = j + 1;
            continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
            let j = i;
            if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
                j += 2;
                while (j < n && /[0-9a-fA-F]/.test(src[j]))
                    j++;
            }
            else {
                while (j < n && /[0-9.eE]/.test(src[j])) {
                    if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-"))
                        j++;
                    j++;
                }
            }
            toks.push({ t: "num", v: src.slice(i, j), line: tokLine, col: tokCol, file: tokFile });
            i = j;
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i;
            while (j < n && /[A-Za-z0-9_$]/.test(src[j]))
                j++;
            const w = src.slice(i, j);
            toks.push({ t: KEYWORDS.has(w) ? w : "id", v: w, line: tokLine, col: tokCol, file: tokFile });
            i = j;
            continue;
        }
        let matched = "";
        for (const p of PUNCT)
            if (src.startsWith(p, i)) {
                matched = p;
                break;
            }
        if (!matched)
            throw new ScUnsupported(`lex: unexpected char ${JSON.stringify(c)}`);
        toks.push({ t: matched, v: matched, line: tokLine, col: tokCol, file: tokFile });
        i += matched.length;
    }
    toks.push({ t: "eof", v: "", line, col: i - lineStart + 1, file: curFile });
    return toks;
}
function escLen(s, j) {
    const c = s[j + 1];
    if (c === "x")
        return 4;
    if (c === "u")
        return 6;
    return 2;
}
function unescapeChar(s, j) {
    const c = s[j + 1];
    switch (c) {
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        case "b": return "\b";
        case "f": return "\f";
        case "v": return "\v";
        case "0": return "\0";
        case "x": return String.fromCharCode(parseInt(s.substr(j + 2, 2), 16));
        case "u": return String.fromCharCode(parseInt(s.substr(j + 2, 4), 16));
        default: return c;
    }
}
// AS3 declaration keywords (not in our lexer's KEYWORDS so they stay usable as
// member names / object keys, but refused at statement start).
const AS3_DECL = new Set(["class", "interface", "import", "package"]);
// Modifiers that may precede a top-level `class`/`mixin` declaration (ignored in
// output — `dynamic`/`final`/access modifiers do not affect the DHTML codegen).
const CLASS_MODIFIERS = new Set(["public", "private", "protected", "final", "internal", "dynamic"]);
/** The OpenLaszlo `a is B` type-test operator expands to the conditional
 *  `B["$lzsc$isa"]?B.$lzsc$isa(a):a instanceof B` (operands duplicated, as the
 *  oracle does). The printer's precedence logic re-adds any needed parens. */
function makeIsExpr(a, b) {
    return {
        k: "cond",
        c: { k: "index", o: b, i: { k: "str", v: "$lzsc$isa" } },
        t: { k: "call", c: { k: "member", o: b, p: "$lzsc$isa" }, args: [a] },
        f: { k: "bin", op: "instanceof", l: a, r: b },
    };
}
/** True iff a statement's expression is a `super` method/constructor call —
 *  `super(args)`, `super.X(args)`, or `super.X.call/apply(args)`. These are the
 *  ONLY statements that exhibit the JJTree node-line quirk in the OUTPUT: the
 *  super-call rewrite (CommonGenerator.translateSuperCallExpression) re-PARSES its
 *  whole expansion via `substitute(node,…)` at `node.getLineNumber()`, so every
 *  token of the expansion inherits the (quirk-affected) statement-node line. A
 *  normal expression statement keeps its tokens' real source lines, so even if its
 *  JJTree node line is the preceding `}`, the emitted directives use the real
 *  lines. (Verified: componentmanager `super.init()` tracked at the `}` line vs
 *  basecomponent `this._style = s` / `_setstyle(s)` keeping their own lines.) */
function isSuperCallExpr(e) {
    if (e.k !== "call")
        return false;
    const c = e.c;
    if (c.k === "super")
        return true;
    if (c.k === "member" && c.o.k === "super")
        return true;
    if (c.k === "member" && (c.p === "call" || c.p === "apply") &&
        c.o.k === "member" && c.o.o.k === "super")
        return true;
    return false;
}
/** True iff `s` is a control (compound) statement — one with a controlled body
 *  (if/loop/with/try/switch/block). NOT recursing into it. */
function isControlStmt(s) {
    switch (s.s) {
        case "block":
        case "if":
        case "while":
        case "dowhile":
        case "with":
        case "for":
        case "forin":
        case "try":
        case "switch":
            return true;
        default: return false;
    }
}
/** RULE A refinement (super-call JJTree line quirk). A super statement adjacent to
 *  its predecessor is line-tracked at the predecessor's end line ("triggers the
 *  quirk") in the common case. It does NOT trigger ONLY when the predecessor is an
 *  ELSE-LESS `if` statement whose then-branch is either:
 *   (i)  not a `}`-block — `if(cond) expr;` (baseformitem `destroy`); or
 *   (ii) a `}`-block whose LAST nested statement is itself a control statement —
 *        baseformitem `init`'s outer `if`, then-tail = the folded `if($debug){…}`.
 *  Confirmed FIRE cases (none match the no-fire shape, so they trigger):
 *   - layout `destroy` `this.releaseLayout(true);` (bare expr, not an `if`);
 *   - componentmanager `init` `if(fclass){…reset()}` (then-`}`-block, simple tail);
 *   - checkbox `setValue` `if(){}else if(){}else val=!!val;` (HAS an `else`).
 *  Computed PRE-fold (folding splices nested blocks flat, erasing the signal) and
 *  carried on the statement as `.superQuirkPredecessor`. `endsBrace` is the
 *  last-token-is-`}` test (recorded separately, since fold rebuilds the node). */
function predecessorTriggersRuleA(s, endsBrace) {
    // Only an else-less `if` can suppress the quirk.
    if (s.s !== "if" || s.e)
        return true;
    const then = s.t;
    if (then.s !== "block") {
        // else-less `if(cond) <stmt>` (non-block then-branch). It suppresses the
        // quirk ONLY when the then-body is on a DIFFERENT source line from the `if`
        // — a MULTI-line if (baseformitem `destroy`: `if(p)\n  p.remove();`). A
        // SINGLE-line `if(cond) expr;` (e.g. _internalinputtext `construct`'s
        // `if(parent['multiline']!=null) args.multiline = parent.multiline;`) still
        // triggers it, so the following super tracks at the if's line (and emits a
        // rewinding `/* -*- file: #N -*- */` directive).
        return then.line === s.line;
    }
    if (!endsBrace)
        return false;
    const last = then.body[then.body.length - 1];
    // The then-block's last nested statement suppresses the quirk ONLY when it is a
    // BLOCK-TERMINATED control statement (itself ends in `}`) — baseformitem init's
    // tail `if($debug){…}` (no-fire). A control statement whose last token is NOT a
    // `}` (a braceless `if(c) expr;` / `else if(c) expr;` chain — baselistitem
    // dataBindAttribute's `if(attr=='text')…; else if(attr=='value')…;`) does NOT
    // suppress: the super still tracks at the outer `}` line (FIRE, #52). So we
    // require the control tail to be brace-terminated to suppress.
    return last ? !(isControlStmt(last) && last.endsBrace === true) : false;
}
// ---------- Parser (Pratt) ----------
class Parser {
    constructor(toks) {
        this.pos = 0;
        this.toks = toks;
    }
    peek(o = 0) { return this.toks[this.pos + o]; }
    next() { return this.toks[this.pos++]; }
    eat(t) {
        if (this.peek().t !== t)
            throw new ScUnsupported(`parse: expected ${t}, got ${this.peek().t} '${this.peek().v}'`);
        return this.next();
    }
    is(t) { return this.peek().t === t; }
    /** Skip an ActionScript-style `:Type` annotation (erased from output, like the
     *  `cast` operator). A type is `*`, or a (possibly dotted) name — keywords
     *  `void`/`null`/`function` are also valid type names — with an optional
     *  `.<…>` vector parameter and an optional trailing `?` (nullable type). */
    skipTypeAnnotation() {
        if (!this.is(":"))
            return;
        this.next();
        this.typeExpr();
    }
    typeExpr() {
        if (this.is("*")) {
            this.next();
        }
        else {
            if (this.is("id") || this.is("void") || this.is("null") || this.is("function"))
                this.next();
            else
                throw new ScUnsupported(`type: unexpected ${this.peek().t} '${this.peek().v}'`);
            while (this.is(".")) {
                this.next();
                if (this.is("<")) { // Vector.<T>
                    this.next();
                    this.typeExpr();
                    this.eat(">");
                }
                else
                    this.eat("id");
            }
        }
        if (this.is("?"))
            this.next(); // nullable type marker (`LzNode?`)
    }
    parseProgram() {
        const body = [];
        while (!this.is("eof"))
            body.push(this.statement());
        return body;
    }
    parseExpr() {
        const e = this.expression();
        this.eat("eof");
        return e;
    }
    statement() {
        // Record the 1-based source line of the statement's first token (the debug
        // build prefixes each statement with its `/* -*- file: X#N -*- */` directive;
        // the production path ignores `.line`).
        const line = this.peek().line;
        const file = this.peek().file;
        const s = this.statementInner();
        if (s.line === undefined)
            s.line = line;
        if (s.file === undefined && file !== undefined)
            s.file = file;
        // Record the statement's END source line (the last consumed token — e.g. a
        // block's closing `}`). The debug build uses this to reproduce a JJTree
        // line-assignment quirk: a statement on the line immediately after a brace
        // block is tracked at the block's `}` line (getToken(1) at node-open).
        if (s.endLine === undefined)
            s.endLine = this.toks[this.pos - 1]?.line ?? line;
        // Record whether this statement's LAST consumed token is a `}` (block-
        // terminated). Recorded on EVERY statement (including nested ones) so a
        // super-call predicate can inspect a controlled block's last nested
        // statement's brace-termination.
        if (s.endsBrace === undefined)
            s.endsBrace = this.toks[this.pos - 1]?.t === "}";
        // RULE A refinement signal (super-call line quirk): record, PRE-fold, whether
        // this statement — as a super-call predecessor — triggers the line quirk.
        // Folding later splices nested blocks flat (erasing the structure), so we
        // capture it here on the statement.
        if (s.superQuirkPredecessor === undefined) {
            const endsBrace = s.endsBrace;
            s.superQuirkPredecessor = predecessorTriggersRuleA(s, endsBrace);
            // Single-line block-if predecessor (`if(cond){ a; b; }` entirely on one
            // source line). A super on the line right after a BLANK line below such a
            // predecessor still triggers the quirk (the if-block emits >1 output line,
            // so the rewinding resolution offsets it forward by one). Recorded so the
            // gap-tolerant Rule A only fires for this exact shape (dbg3 has none).
            s.singleLineBlockIf = s.s === "if" && !s.e
                && s.line === s.endLine && endsBrace;
        }
        return s;
    }
    statementInner() {
        const t = this.peek().t;
        // AS3 `class` declarations compile to `Class.make(...)` (see classDecl).
        // Other top-level declarations (interface/import/package) are a separate
        // subsystem — refuse cleanly rather than misparse them as expressions.
        // (Only at statement start, so `foo.class` member access and object keys
        // are unaffected.)
        if (t === "id") {
            // `[modifiers] (class|mixin) NAME …` is an AS3 class/mixin declaration.
            let k = 0;
            while (this.peek(k).t === "id" && CLASS_MODIFIERS.has(this.peek(k).v))
                k++;
            if ((this.peek(k).v === "class" || this.peek(k).v === "mixin") && this.peek(k + 1).t === "id")
                return this.classDecl();
        }
        if (t === "id" && AS3_DECL.has(this.peek().v))
            throw new ScUnsupported(`unsupported declaration: ${this.peek().v}`);
        if (t === "{")
            return this.block();
        if (t === ";") {
            this.next();
            return { s: "empty" };
        }
        if (t === "var" || (t === "id" && this.peek().v === "const" && this.peek(1).t === "id"))
            return this.varStmt();
        if (t === "return") {
            this.next();
            let e = null;
            if (!this.is(";") && !this.is("}") && !this.is("eof"))
                e = this.expression();
            this.semi();
            return { s: "return", e };
        }
        if (t === "if")
            return this.ifStmt();
        if (t === "while") {
            this.next();
            this.eat("(");
            const c = this.expression();
            this.eat(")");
            return { s: "while", c, body: this.statement() };
        }
        if (t === "do") {
            this.next();
            const body = this.statement();
            this.eat("while");
            this.eat("(");
            const c = this.expression();
            this.eat(")");
            this.semi();
            return { s: "dowhile", c, body };
        }
        if (t === "with") {
            this.next();
            this.eat("(");
            const c = this.expression();
            this.eat(")");
            return { s: "with", c, body: this.statement() };
        }
        if (t === "throw") {
            this.next();
            const e = this.expression();
            this.semi();
            return { s: "throw", e };
        }
        if (t === "try") {
            this.next();
            const block = this.block();
            let param = null;
            let handler = null;
            let handlerLine;
            if (this.is("catch")) {
                handlerLine = this.peek().line;
                this.next();
                this.eat("(");
                param = this.eat("id").v;
                this.skipTypeAnnotation();
                this.eat(")");
                handler = this.block();
            }
            let finalizer = null;
            let finalizerLine;
            if (this.is("finally")) {
                finalizerLine = this.peek().line;
                this.next();
                finalizer = this.block();
            }
            return { s: "try", block, param, handler, handlerLine, finalizer, finalizerLine };
        }
        if (t === "function") {
            // A `function` at statement start is a function DECLARATION (hoisted by
            // compileFunction); a named one becomes a `funcdecl`, an anonymous one is
            // treated as an expression statement.
            const fn = this.functionExpr();
            if (fn.name)
                return { s: "funcdecl", name: fn.name, fn };
            this.semi();
            return { s: "expr", e: fn };
        }
        if (t === "for")
            return this.forStmt();
        if (t === "switch")
            return this.switchStmt();
        if (t === "break") {
            this.next();
            this.semi();
            return { s: "break" };
        }
        if (t === "continue") {
            this.next();
            this.semi();
            return { s: "continue" };
        }
        const e = this.expression();
        this.semi();
        return { s: "expr", e };
    }
    semi() { if (this.is(";"))
        this.next(); }
    block() {
        this.eat("{");
        const body = [];
        while (!this.is("}"))
            body.push(this.statement());
        this.eat("}");
        return { s: "block", body };
    }
    // AS3 `class Name [extends Super] { ... }`. Members: `[modifiers] var n[:T]
    // [=init];` and `[modifiers] function m(args)[:T] { body }`. Only `static`
    // affects output (→ class properties); other modifiers are ignored. The
    // constructor is the method whose name equals the class name.
    classDecl() {
        // The class definition's begin line (the first token — a modifier or the
        // `class`/`mixin` keyword). The debug Class.make's leading source directive
        // tracks at this line MINUS ONE (CommonGenerator visitClassDefinition emits
        // the generated Class.make node at the class node's beginLine − 1, the same
        // quirk as a `<class>` element's classLine = endLine − 1).
        const classBeginLine = this.peek().line;
        while (this.is("id") && CLASS_MODIFIERS.has(this.peek().v))
            this.next(); // dynamic/final/…
        const xtor = this.next().v === "mixin" ? "Mixin" : "Class"; // `class`/`mixin`
        const name = this.eat("id").v;
        let sup = null;
        if (this.is("id") && this.peek().v === "extends") {
            this.next();
            sup = this.eat("id").v;
            while (this.is(".")) {
                this.next();
                sup += "." + this.eat("id").v;
            }
        }
        // `with Mixin1, Mixin2`: mixins precede the superclass in the make() super
        // array (CommonGenerator.visitClassDefinition's mixinsandsuper).
        const mixins = [];
        if (this.is("with")) { // `with` is a lexer keyword token
            this.next();
            do {
                let mn = this.eat("id").v;
                while (this.is(".")) {
                    this.next();
                    mn += "." + this.eat("id").v;
                }
                mixins.push(mn);
            } while (this.is(",") && this.next());
        }
        if (this.is("id") && this.peek().v === "implements")
            throw new ScUnsupported("AS3 class implements");
        this.eat("{");
        const members = [];
        const MODIFIERS = new Set(["public", "private", "protected", "static", "final", "override", "internal", "dynamic"]);
        while (!this.is("}")) {
            if (this.is(";")) {
                // A stray `;` at class level is an EMPTY statement (e.g. the `;` after a
                // `static function f(){};`), NOT just a separator. The oracle
                // (translateClassDirectivesBlock: not a var/method/pragma → the generic
                // `else` → stmts.add) moves it into the post-Class.make initializer's
                // statement list — so a class with such a `;` emits the `{ Class.make(…);
                // (function…)(Name) }` block scope even though the init body prints empty.
                this.next();
                members.push({ kind: "stmt", stmt: { s: "empty" } });
                continue;
            }
            let isStatic = false;
            while (this.is("id") && MODIFIERS.has(this.peek().v)) {
                if (this.peek().v === "static")
                    isStatic = true;
                this.next();
            }
            if (this.is("var") || (this.is("id") && this.peek().v === "const")) {
                this.next(); // var/const
                do {
                    const vn = this.eat("id").v;
                    this.skipTypeAnnotation();
                    let init = null;
                    if (this.is("=")) {
                        this.next();
                        init = this.assign();
                    }
                    members.push({ kind: "var", name: vn, init, static: isStatic });
                } while (this.is(",") && this.next());
                this.semi();
            }
            else if (this.is("function") && this.peek(1).t === "id") {
                const fn = this.functionExpr();
                members.push({ kind: "method", name: fn.name, fn, static: isStatic });
                // A `;` after `function f(){}` is a SEPARATE empty-statement directive
                // (not the method's terminator) — leave it for the loop's stray-`;` branch
                // so it lands in `stmts` and triggers the post-make `{ … }` block (oracle
                // translateClassDirectivesBlock generic `else`). Matches a `static
                // function f(){};` class (e.g. LzRPC) getting the block scope.
            }
            else {
                // Any other directive (e.g. `foo.dependencies = function(){…}`) is an
                // arbitrary statement, moved to the post-Class.make initializer block.
                members.push({ kind: "stmt", stmt: this.statement() });
            }
        }
        this.eat("}");
        const semi = this.is(";");
        if (semi)
            this.next();
        return { s: "as3class", name, sup, mixins, xtor, members, semi, classLine: classBeginLine };
    }
    varStmt() {
        this.next(); // `var` or `const` (both emit as `var`)
        const decls = [];
        do {
            const name = this.eat("id").v;
            this.skipTypeAnnotation();
            let init = null;
            if (this.is("=")) {
                this.next();
                init = this.assign();
            }
            decls.push({ name, init });
        } while (this.is(",") && this.next());
        this.semi();
        return { s: "var", decls };
    }
    ifStmt() {
        this.eat("if");
        this.eat("(");
        const c = this.expression();
        this.eat(")");
        const t = this.statement();
        let e = null;
        let elseLine;
        if (this.is("else")) {
            elseLine = this.peek().line;
            this.next();
            e = this.statement();
        }
        return { s: "if", c, t, e, elseLine };
    }
    forStmt() {
        this.eat("for");
        this.eat("(");
        let init = null;
        if (this.is(";"))
            this.next();
        else if (this.is("var")) {
            // Parse the var declarations without consuming a terminator, so a trailing
            // `in` can be recognised as the for-in form (`for (var x in obj)`).
            this.eat("var");
            const decls = [];
            do {
                const name = this.eat("id").v;
                this.skipTypeAnnotation();
                let dinit = null;
                if (this.is("=")) {
                    this.next();
                    dinit = this.assign();
                }
                decls.push({ name, init: dinit });
            } while (this.is(",") && this.next());
            if (decls.length === 1 && decls[0].init == null && this.is("in")) {
                this.next();
                const obj = this.expression();
                this.eat(")");
                return { s: "forin", varName: decls[0].name, lhs: { k: "id", name: decls[0].name }, obj, body: this.statement() };
            }
            init = { s: "var", decls };
            this.eat(";");
        }
        else {
            // `for (lhs in obj)` (no `var`): parse the lhs with `in` suppressed so the
            // for-in `in` isn't swallowed as a binary operator.
            const head = this.assign(true);
            if (this.is("in")) {
                this.next();
                const obj = this.expression();
                this.eat(")");
                return { s: "forin", varName: null, lhs: head, obj, body: this.statement() };
            }
            init = this.is(",") ? this.commaTail(head) : head;
            this.eat(";");
        }
        let test = null;
        if (!this.is(";"))
            test = this.expression();
        this.eat(";");
        let upd = null;
        if (!this.is(")"))
            upd = this.expression();
        this.eat(")");
        return { s: "for", init, test, upd, body: this.statement() };
    }
    switchStmt() {
        this.eat("switch");
        this.eat("(");
        const disc = this.expression();
        this.eat(")");
        this.eat("{");
        const cases = [];
        while (!this.is("}")) {
            let test = null;
            const labelTok = this.peek();
            if (this.is("case")) {
                this.next();
                test = this.expression();
            }
            else {
                this.eat("default");
            }
            this.eat(":");
            const body = [];
            while (!this.is("case") && !this.is("default") && !this.is("}"))
                body.push(this.statement());
            cases.push({ test, body, line: labelTok.line, file: labelTok.file });
        }
        this.eat("}");
        return { s: "switch", disc, cases };
    }
    expression() {
        const e = this.assign();
        return this.is(",") ? this.commaTail(e) : e;
    }
    /** Complete a comma expression whose first operand is already parsed. */
    commaTail(head) {
        const es = [head];
        while (this.is(",")) {
            this.next();
            es.push(this.assign());
        }
        return { k: "seq", es };
    }
    assign(noIn = false) {
        const l = this.cond(noIn);
        const t = this.peek().t;
        if (["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "**="].includes(t)) {
            this.next();
            return { k: "assign", op: t, l, r: this.assign(noIn) };
        }
        return l;
    }
    cond(noIn = false) {
        const c = this.binary(0, noIn);
        // OpenLaszlo `expr cast Type`: erased in output, but Type stays a free ref.
        let e = c;
        while (this.peek().t === "id" && this.peek().v === "cast") {
            this.next();
            e = { k: "cast", e, type: this.binary(0) };
        }
        if (this.is("?")) {
            this.next();
            const t = this.assign();
            this.eat(":");
            const f = this.assign();
            return { k: "cond", c: e, t, f };
        }
        return e;
    }
    binary(minPrec, noIn = false) {
        let left = this.unary();
        for (;;) {
            const op = this.peek().t;
            // OpenLaszlo `a is B` type-test operator (relational precedence, prec 9):
            // expands to `B["$lzsc$isa"]?B.$lzsc$isa(a):a instanceof B`.
            if (op === "id" && this.peek().v === "is") {
                if (9 < minPrec)
                    break;
                this.next();
                const right = this.binary(10, noIn);
                left = makeIsExpr(left, right);
                continue;
            }
            // In a for-init head, `in` must not be consumed as a binary operator so the
            // for-in form can be detected.
            if (noIn && op === "in")
                break;
            const prec = BINPREC[op];
            if (prec === undefined || prec < minPrec)
                break;
            this.next();
            const right = this.binary(prec + 1);
            left = LOGIC.has(op) ? { k: "logic", op, l: left, r: right } : { k: "bin", op, l: left, r: right };
        }
        return left;
    }
    unary() {
        const t = this.peek().t;
        if (["!", "~", "+", "-", "typeof", "void", "delete"].includes(t)) {
            this.next();
            return { k: "unary", op: t, e: this.unary(), prefix: true };
        }
        if (t === "++" || t === "--") {
            const line = this.peek().line;
            this.next();
            return { k: "unary", op: t, e: this.unary(), prefix: true, line };
        }
        return this.postfix();
    }
    postfix() {
        const opTokLine = this.peek().line;
        let e = this.callMember();
        if (this.is("++") || this.is("--")) {
            const op = this.next().t;
            e = { k: "unary", op, e, prefix: false, line: opTokLine };
        }
        return e;
    }
    callMember() {
        let e;
        if (this.is("new")) {
            this.next();
            const c = this.callMemberNoCall();
            const args = this.is("(") ? this.argList() : [];
            e = { k: "new", c, args };
        }
        else {
            e = this.primary();
        }
        for (;;) {
            if (this.is(".")) {
                this.next();
                e = { k: "member", o: e, p: this.eat("id").v };
            }
            else if (this.is("[")) {
                this.next();
                const i = this.expression();
                this.eat("]");
                e = { k: "index", o: e, i };
            }
            else if (this.is("(")) {
                e = { k: "call", c: e, args: this.argList() };
            }
            else
                break;
        }
        return e;
    }
    callMemberNoCall() {
        let e = this.primary();
        for (;;) {
            if (this.is(".")) {
                this.next();
                e = { k: "member", o: e, p: this.eat("id").v };
            }
            else if (this.is("[")) {
                this.next();
                const i = this.expression();
                this.eat("]");
                e = { k: "index", o: e, i };
            }
            else
                break;
        }
        return e;
    }
    /** A function expression `function [name] (params) [:RetType] { body }`. The
     *  optional name and return type are erased in compress mode. */
    functionExpr() {
        const ftok = this.peek(); // the `function` keyword: its line/col name the debug displayName
        this.eat("function");
        let name = null;
        if (this.is("id"))
            name = this.next().v;
        const { names, defaults, rest } = this.formalParams();
        this.skipTypeAnnotation(); // optional return type
        this.eat("{");
        const body = [];
        while (!this.is("}"))
            body.push(this.statement());
        this.eat("}");
        // Rest parameter desugar (CommonGenerator.translateFunctionInternal:588): the
        // `...name` formal is dropped and a `var name = Array.prototype.slice.call(
        // arguments, <argno>);` prologue is prepended (argno = the count of fixed
        // params before the rest). Free `Array`/`arguments` refs then drive with(this)
        // / the try-wrapper via the normal scope analysis, exactly as compileFunction
        // does for `args="...name"`.
        if (rest != null) {
            const m = (o, p) => ({ k: "member", o, p });
            const slice = m(m(m({ k: "id", name: "Array" }, "prototype"), "slice"), "call");
            const init = { k: "call", c: slice, args: [{ k: "id", name: "arguments" }, { k: "num", raw: String(names.length) }] };
            body.unshift({ s: "var", decls: [{ name: rest, init }] });
        }
        return { k: "func", name, params: names, defaults, body, line: ftok.line, col: ftok.col, file: ftok.file };
    }
    /** Formal parameter list `(a, b:Type, c=default)` → names + optional defaults. */
    formalParams() {
        this.eat("(");
        const names = [];
        const defaults = [];
        let rest = null;
        while (!this.is(")")) {
            // A rest parameter `...name` (the LAST formal) — desugared by the caller to a
            // body prologue `var name = Array.prototype.slice.call(arguments, N);`
            // (CommonGenerator.translateFunctionInternal:588). It carries no formal slot.
            if (this.is("...")) {
                this.next();
                rest = this.eat("id").v;
                this.skipTypeAnnotation();
                break;
            }
            const nm = this.eat("id").v;
            this.skipTypeAnnotation();
            let def = null;
            if (this.is("=")) {
                this.next();
                def = this.assign();
            }
            names.push(nm);
            defaults.push(def);
            if (this.is(","))
                this.next();
            else
                break;
        }
        this.eat(")");
        return { names, defaults, rest };
    }
    argList() {
        this.eat("(");
        const args = [];
        while (!this.is(")")) {
            args.push(this.assign());
            if (this.is(","))
                this.next();
            else
                break;
        }
        this.eat(")");
        return args;
    }
    primary() {
        const t = this.peek();
        switch (t.t) {
            case "num":
                this.next();
                return { k: "num", raw: t.v };
            case "str":
                this.next();
                return { k: "str", v: t.v };
            case "id":
                this.next();
                return { k: "id", name: t.v };
            case "this":
                this.next();
                return { k: "this" };
            case "super":
                this.next();
                return { k: "super" };
            case "function": return this.functionExpr();
            case "true":
            case "false":
            case "null":
                this.next();
                return { k: "lit", v: t.t };
            // Drop explicit parens — precedence-based wrapping re-adds only the
            // necessary ones (matching ParseTreePrinter, which does not preserve them).
            case "(": {
                this.next();
                const e = this.expression();
                this.eat(")");
                return e;
            }
            case "[": {
                this.next();
                const els = [];
                while (!this.is("]")) {
                    els.push(this.assign());
                    if (this.is(","))
                        this.next();
                    else
                        break;
                }
                this.eat("]");
                return { k: "array", els };
            }
            case "{": {
                this.next();
                const props = [];
                while (!this.is("}")) {
                    let key;
                    let keyKind;
                    const kt = this.peek();
                    if (kt.t === "str") {
                        this.next();
                        key = kt.v;
                        keyKind = "str";
                    }
                    else if (kt.t === "num") {
                        this.next();
                        key = kt.v;
                        keyKind = "num";
                    }
                    else {
                        this.next();
                        key = kt.v;
                        keyKind = "id";
                    } // id or keyword as key
                    this.eat(":");
                    props.push({ key, keyKind, computed: false, v: this.assign() });
                    if (this.is(","))
                        this.next();
                    else
                        break;
                }
                this.eat("}");
                return { k: "object", props };
            }
            default:
                throw new ScUnsupported(`parse: unexpected ${t.t} '${t.v}'`);
        }
    }
}
// Binary/logical precedences sit ABOVE cond(2)/assign(1)/seq(0) so that a
// logical operator used as a `?:` condition or assignment operand is NOT
// parenthesized (`a||b?c:d`, not `(a||b)?c:d`). Relative order is what the
// parser uses (binary(0)); the printer compares against cond/assign too.
const BINPREC = {
    "||": 3, "&&": 4, "|": 5, "^": 6, "&": 7,
    "==": 8, "!=": 8, "===": 8, "!==": 8,
    "<": 9, ">": 9, "<=": 9, ">=": 9, instanceof: 9, in: 9,
    "<<": 10, ">>": 10, ">>>": 10,
    "+": 11, "-": 11,
    "*": 12, "/": 12, "%": 12,
    "**": 13,
};
const LOGIC = new Set(["&&", "||"]);
// ---------- Local renamer ($0,$1,…) ----------
function collectLocals(params, body) {
    const order = [...params];
    const seen = new Set(order);
    const addName = (n) => { if (!seen.has(n)) {
        seen.add(n);
        order.push(n);
    } };
    const walkS = (st) => {
        switch (st.s) {
            case "var":
                for (const d of st.decls)
                    addName(d.name);
                break;
            case "funcdecl":
                addName(st.name);
                break;
            case "block":
                st.body.forEach(walkS);
                break;
            case "if":
                walkS(st.t);
                if (st.e)
                    walkS(st.e);
                break;
            case "while":
            case "dowhile":
                walkS(st.body);
                break;
            case "with":
                walkS(st.body);
                break;
            case "for":
                if (st.init && "s" in st.init)
                    walkS(st.init);
                walkS(st.body);
                break;
            case "forin":
                if (st.varName)
                    addName(st.varName);
                walkS(st.body);
                break;
            case "switch":
                st.cases.forEach((cl) => cl.body.forEach(walkS));
                break;
        }
    };
    body.forEach(walkS);
    const map = new Map();
    order.forEach((n, idx) => map.set(n, "$" + idx));
    return map;
}
// ---------- Constant folding of compiler-magic globals ----------
// The DHTML non-debug build defines `$debug`/`$as3`/`$swf*`/… as false and
// `$dhtml` as true; the oracle folds them and eliminates dead branches (so a
// `if ($debug) {…}` block disappears, taking its references out of scope).
// CompilationEnvironment.setRuntimeConstants for runtime="dhtml": these compile-
// time constants fold to false; $dhtml/$js1 fold to true (CompilationEnvironment.
// java:931). ($runtime folds to the string "dhtml" — string folding is TODO.)
const MAGIC_FALSE = new Set(["$swf7", "$swf8", "$as2", "$swf9", "$swf10", "$as3", "$j2me", "$svg", "$profile", "$backtrace"]);
const MAGIC_TRUE = new Set(["$dhtml", "$js1"]);
// Per-compile debug flag. A `canvas debug="true"` build folds `$debug` to TRUE
// (not false), so debug-only branches — the `$reportException` try/catch arms,
// the debugger window machinery — survive. Set by compile() at the start of a
// debug compile and reset in its finally; NEVER leaks into a production compile
// (the production fold below treats `$debug` as false). Consistent with the
// existing module-level MAGIC constant sets.
let SC_DEBUG = false;
export function setScDebug(v) { SC_DEBUG = v; }
const isFalse = (n) => n.k === "lit" && n.v === "false";
const isTrue = (n) => n.k === "lit" && n.v === "true";
// A compile-time magic constant — folded to a literal in bare if/?: test position
// (case "id"), but kept as a runtime reference as a direct && / || operand.
const isMagicConst = (name) => name === "$debug" || MAGIC_FALSE.has(name) || MAGIC_TRUE.has(name);
function foldNode(n) {
    switch (n.k) {
        case "id":
            if (n.name === "$debug")
                return { k: "lit", v: SC_DEBUG ? "true" : "false" };
            if (MAGIC_FALSE.has(n.name))
                return { k: "lit", v: "false" };
            if (MAGIC_TRUE.has(n.name))
                return { k: "lit", v: "true" };
            return n;
        case "logic": {
            // Magic compile-time constants ($debug/$as3/$as2/$swf*/…) are folded ONLY as
            // the BARE test of an if/?:/directive (the oracle's evaluateCompileTimeCondi-
            // tional requires an ASTIdentifier; there is no boolean constant folding). As
            // a DIRECT operand of && / || they stay runtime references — `$as3 || X` keeps
            // `$as3` (the ONLY surviving magic ref in the whole dbg3 gold: the debugger's
            // objToString `lzconsoledebug` test). So a magic-id operand folds to itself.
            const foldOp = (x) => (x.k === "id" && isMagicConst(x.name)) ? x : foldNode(x);
            const l = foldOp(n.l);
            if (n.op === "&&") {
                if (isFalse(l))
                    return { k: "lit", v: "false" };
                if (isTrue(l))
                    return foldOp(n.r);
            }
            else {
                if (isTrue(l))
                    return { k: "lit", v: "true" };
                if (isFalse(l))
                    return foldOp(n.r);
            }
            return { k: "logic", op: n.op, l, r: foldOp(n.r) };
        }
        case "cond": {
            const c = foldNode(n.c);
            if (isFalse(c))
                return foldNode(n.f);
            if (isTrue(c))
                return foldNode(n.t);
            return { k: "cond", c, t: foldNode(n.t), f: foldNode(n.f) };
        }
        case "unary": {
            // A magic-const id as a unary operand stays a RUNTIME reference (same as a
            // direct && / || operand — S30-5): the oracle folds magic consts ONLY as the
            // bare ASTIdentifier test of an if/?:, never inside `!$dhtml`. (databinding-$8
            // `lz.XMLHttpRequest.open`: GOLD keeps `… && !$dhtml`, not `… && false`.)
            const e = (n.e.k === "id" && isMagicConst(n.e.name)) ? n.e : foldNode(n.e);
            if (n.op === "!") {
                if (isFalse(e))
                    return { k: "lit", v: "true" };
                if (isTrue(e))
                    return { k: "lit", v: "false" };
            }
            return { k: "unary", op: n.op, e, prefix: n.prefix, line: n.line };
        }
        case "paren": return { k: "paren", e: foldNode(n.e) };
        case "cast": return { k: "cast", e: foldNode(n.e), type: foldNode(n.type) };
        case "func": return { k: "func", name: n.name, params: n.params, defaults: n.defaults.map((d) => d ? foldNode(d) : null), body: foldStmts(n.body), line: n.line, col: n.col, file: n.file };
        case "bin": return { k: "bin", op: n.op, l: foldNode(n.l), r: foldNode(n.r) };
        case "assign": return { k: "assign", op: n.op, l: foldNode(n.l), r: foldNode(n.r) };
        case "member": return { k: "member", o: foldNode(n.o), p: n.p };
        case "index": return { k: "index", o: foldNode(n.o), i: foldNode(n.i) };
        case "call": return { k: "call", c: foldNode(n.c), args: n.args.map(foldNode) };
        case "new": return { k: "new", c: foldNode(n.c), args: n.args.map(foldNode) };
        case "array": return { k: "array", els: n.els.map(foldNode) };
        case "object": return { k: "object", props: n.props.map((p) => ({ ...p, v: foldNode(p.v) })) };
        case "seq": return { k: "seq", es: n.es.map(foldNode) };
        default: return n; // num, str, lit, this, super
    }
}
/** Fold a statement, returning the (0+) statements it reduces to (a dead
 *  `if (false) …` collapses to its else branch, or nothing). The source line is
 *  carried onto each folded statement (the fold rebuilds objects) so the debug
 *  build's per-statement `/* -*- file: X#N -*- *​/` directives survive folding. */
function foldStmt(s) {
    const out = foldStmtInner(s);
    const line = s.line;
    if (line !== undefined)
        for (const r of out)
            if (r.line === undefined)
                r.line = line;
    const file = s.file;
    if (file !== undefined)
        for (const r of out)
            if (r.file === undefined)
                r.file = file;
    const endLine = s.endLine;
    if (endLine !== undefined)
        for (const r of out)
            if (r.endLine === undefined)
                r.endLine = endLine;
    const sqp = s.superQuirkPredecessor;
    if (sqp !== undefined)
        for (const r of out)
            if (r.superQuirkPredecessor === undefined)
                r.superQuirkPredecessor = sqp;
    const slbi = s.singleLineBlockIf;
    if (slbi !== undefined)
        for (const r of out)
            if (r.singleLineBlockIf === undefined)
                r.singleLineBlockIf = slbi;
    return out;
}
function foldStmtInner(s) {
    switch (s.s) {
        case "if": {
            const c = foldNode(s.c);
            // Dead-branch elimination replaces `if(true) S [else E]` with S (and
            // `if(false) S else E` with E). The surviving branch is kept as-is — a block
            // STAYS a block. Splicing a block's statements into the enclosing list is a
            // separate StatementList-level operation (foldStmts), so at statement-list
            // level `if($js1){return v}` collapses to `return v`, but in a branch context
            // (e.g. `else if($debug){warn()}` → `else { warn() }`) the block is preserved.
            if (isFalse(c))
                return s.e ? [foldOne(s.e)] : [];
            if (isTrue(c))
                return [foldOne(s.t)];
            let e = s.e ? foldOne(s.e) : null;
            if (e && isEmptyStmt(e))
                e = null; // an empty else is dropped (ParseTreePrinter)
            return [{ s: "if", c, t: foldOne(s.t), e, elseLine: s.elseLine }];
        }
        case "expr": return [{ s: "expr", e: foldNode(s.e) }];
        case "var": return [{ s: "var", decls: s.decls.map((d) => ({ name: d.name, init: d.init ? foldNode(d.init) : null })) }];
        case "return": return [{ s: "return", e: s.e ? foldNode(s.e) : null }];
        case "block": return [{ s: "block", body: foldStmts(s.body) }];
        case "while": return [{ s: "while", c: foldNode(s.c), body: foldOne(s.body) }];
        case "dowhile": return [{ s: "dowhile", c: foldNode(s.c), body: foldOne(s.body) }];
        case "with": return [{ s: "with", c: foldNode(s.c), body: foldOne(s.body) }];
        case "funcdecl": return [{ s: "funcdecl", name: s.name, fn: foldNode(s.fn) }];
        case "for":
            return [{
                    s: "for",
                    init: s.init == null ? null : "s" in s.init ? foldStmt(s.init)[0] ?? { s: "empty" } : foldNode(s.init),
                    test: s.test ? foldNode(s.test) : null,
                    upd: s.upd ? foldNode(s.upd) : null,
                    body: foldOne(s.body),
                }];
        case "forin":
            return [{ s: "forin", varName: s.varName, lhs: s.varName ? s.lhs : foldNode(s.lhs), obj: foldNode(s.obj), body: foldOne(s.body) }];
        case "switch":
            return [{ s: "switch", disc: foldNode(s.disc), cases: s.cases.map((cl) => ({ test: cl.test ? foldNode(cl.test) : null, body: foldStmts(cl.body), line: cl.line, file: cl.file })) }];
        case "throw": return [{ s: "throw", e: foldNode(s.e) }];
        case "try":
            return [{
                    s: "try", param: s.param,
                    block: foldOne(s.block),
                    handler: s.handler ? foldOne(s.handler) : null,
                    handlerLine: s.handlerLine,
                    finalizer: s.finalizer ? foldOne(s.finalizer) : null,
                    finalizerLine: s.finalizerLine,
                }];
        case "as3class":
            return [{
                    s: "as3class", name: s.name, sup: s.sup, mixins: s.mixins, xtor: s.xtor, semi: s.semi, classLine: s.classLine,
                    members: s.members.map((m) => m.kind === "var"
                        ? { ...m, init: m.init ? foldNode(m.init) : null }
                        : m.kind === "method"
                            ? { ...m, fn: foldNode(m.fn) }
                            : { kind: "stmt", stmt: foldStmt(m.stmt)[0] ?? { s: "empty" } }),
                }];
        default: return [s];
    }
}
function isEmptyStmt(s) {
    return s.s === "empty" || (s.s === "block" && s.body.length === 0);
}
function foldOne(s) {
    const r = foldStmt(s);
    return r.length === 1 ? r[0] : r.length === 0 ? { s: "empty" } : { s: "block", body: r };
}
function foldStmts(body) {
    // A StatementList splices its direct-child block statements: the oracle flattens
    // a `{ … }` block — whether user-written or the residue of a constant-folded
    // `if(true){…}` — into the enclosing list (verified vs the oracle). A block in a
    // branch position (then/else/loop body) is NOT spliced (that goes through foldOne).
    const out = [];
    for (const s of body)
        for (const f of foldStmt(s)) {
            if (f.s === "block")
                out.push(...f.body);
            else
                out.push(f);
        }
    return out;
}
// ---------- Free-variable analysis (for `with(this)` insertion) ----------
// A generated method gets wrapped in `with(this){…}` when its body has any free
// reference — an identifier that is not a local/param. The oracle does NOT
// subtract known globals here for instance (anonymous) classes: a free `lz` or
// `Math` still forces the wrapper (CodeGenerator: `withThis = isMethod &&
// !possibleInstance.isEmpty()`, and possibleInstance = the raw free set when the
// class's instance properties aren't known, as for anonymous subclasses).
// Auto-registers / always-available names (Instructions.Register.AUTO_REG +
// $flasm): never free, never renamed. `this`/`super` are distinct node kinds but
// listing them is harmless.
const AVAILABLE = new Set(["this", "arguments", "super", "_root", "_parent", "_global", "$flasm"]);
function freeVarsOfNode(n, declared, out) {
    switch (n.k) {
        case "id":
            if (!declared.has(n.name))
                out.add(n.name);
            break;
        // A nested function's free variables escape to the enclosing scope (the
        // analyzer's `innerFree`): closing over a variable counts as a use.
        case "func":
            for (const v of computeFree(n.params, n.body))
                if (!declared.has(v))
                    out.add(v);
            break;
        case "member":
            freeVarsOfNode(n.o, declared, out);
            break; // .p is a property name
        case "index":
            freeVarsOfNode(n.o, declared, out);
            freeVarsOfNode(n.i, declared, out);
            break;
        case "call":
            freeVarsOfNode(n.c, declared, out);
            n.args.forEach((a) => freeVarsOfNode(a, declared, out));
            break;
        case "new":
            freeVarsOfNode(n.c, declared, out);
            n.args.forEach((a) => freeVarsOfNode(a, declared, out));
            break;
        case "unary":
            freeVarsOfNode(n.e, declared, out);
            break;
        case "bin":
        case "logic":
        case "assign":
            freeVarsOfNode(n.l, declared, out);
            freeVarsOfNode(n.r, declared, out);
            break;
        case "cond":
            freeVarsOfNode(n.c, declared, out);
            freeVarsOfNode(n.t, declared, out);
            freeVarsOfNode(n.f, declared, out);
            break;
        case "paren":
            freeVarsOfNode(n.e, declared, out);
            break;
        case "cast":
            freeVarsOfNode(n.e, declared, out);
            freeVarsOfNode(n.type, declared, out);
            break;
        case "seq":
            n.es.forEach((e) => freeVarsOfNode(e, declared, out));
            break;
        case "array":
            n.els.forEach((e) => freeVarsOfNode(e, declared, out));
            break;
        case "object":
            n.props.forEach((p) => freeVarsOfNode(p.v, declared, out));
            break;
        // num, str, lit, this: no free vars
    }
}
function freeVarsOfStmts(declared, body) {
    const out = new Set();
    const walkS = (s) => {
        switch (s.s) {
            case "expr":
                freeVarsOfNode(s.e, declared, out);
                break;
            case "var":
                s.decls.forEach((d) => { if (d.init)
                    freeVarsOfNode(d.init, declared, out); });
                break;
            case "return":
                if (s.e)
                    freeVarsOfNode(s.e, declared, out);
                break;
            case "if":
                freeVarsOfNode(s.c, declared, out);
                walkS(s.t);
                if (s.e)
                    walkS(s.e);
                break;
            case "block":
                s.body.forEach(walkS);
                break;
            case "while":
            case "dowhile":
                freeVarsOfNode(s.c, declared, out);
                walkS(s.body);
                break;
            case "with":
                freeVarsOfNode(s.c, declared, out);
                walkS(s.body);
                break;
            case "funcdecl":
                freeVarsOfNode(s.fn, declared, out);
                break;
            case "for":
                if (s.init) {
                    if ("s" in s.init)
                        walkS(s.init);
                    else
                        freeVarsOfNode(s.init, declared, out);
                }
                if (s.test)
                    freeVarsOfNode(s.test, declared, out);
                if (s.upd)
                    freeVarsOfNode(s.upd, declared, out);
                walkS(s.body);
                break;
            case "forin":
                if (!s.varName)
                    freeVarsOfNode(s.lhs, declared, out);
                freeVarsOfNode(s.obj, declared, out);
                walkS(s.body);
                break;
            case "switch":
                freeVarsOfNode(s.disc, declared, out);
                s.cases.forEach((cl) => { if (cl.test)
                    freeVarsOfNode(cl.test, declared, out); cl.body.forEach(walkS); });
                break;
            case "throw":
                freeVarsOfNode(s.e, declared, out);
                break;
            case "try":
                walkS(s.block);
                if (s.handler)
                    walkS(s.handler);
                if (s.finalizer)
                    walkS(s.finalizer);
                break;
        }
    };
    body.forEach(walkS);
    return out;
}
// ---------- Scope analysis & register renaming ($0,$1,…; base-36) ----------
// Faithful port of JavascriptGenerator's local-variable renaming
// (VariableAnalyzer + the registerMap loop): each function scope renames its
// own params+locals to `$<base36>` registers, EXCEPT variables closed over by a
// nested function (those keep their name so the closure can see them). `withThis`
// (only for true methods with free instance references) changes the rule for
// closed *parameters*: they get a register AND are re-declared `var name=$n`
// inside the with-block so inner functions still see the original name.
/** Ordered non-parameter locals of a scope (var/for-var/for-in declarations),
 *  NOT descending into nested function bodies (they own their scope). */
/** Whether a function declaration appears nested (inside a block/if/while/etc.)
 *  rather than at the top level of a function body — those aren't hoisted by
 *  compileFunction yet, so they're refused rather than miscompiled. */
function hasNestedFuncDecl(body) {
    let found = false;
    const wS = (s) => {
        switch (s.s) {
            case "funcdecl":
                found = true;
                break;
            case "block":
                s.body.forEach(wS);
                break;
            case "if":
                wS(s.t);
                if (s.e)
                    wS(s.e);
                break;
            case "while":
            case "dowhile":
            case "with":
                wS(s.body);
                break;
            case "for":
                if (s.init && "s" in s.init)
                    wS(s.init);
                wS(s.body);
                break;
            case "forin":
                wS(s.body);
                break;
            case "switch":
                s.cases.forEach((cl) => cl.body.forEach(wS));
                break;
            case "try":
                wS(s.block);
                if (s.handler)
                    wS(s.handler);
                if (s.finalizer)
                    wS(s.finalizer);
                break;
        }
    };
    body.forEach(wS);
    return found;
}
function collectVariables(body) {
    const order = [];
    const seen = new Set();
    const add = (n) => { if (!seen.has(n)) {
        seen.add(n);
        order.push(n);
    } };
    const walkS = (st) => {
        switch (st.s) {
            case "var":
                for (const d of st.decls)
                    add(d.name);
                break;
            case "funcdecl":
                add(st.name);
                break;
            case "block":
                st.body.forEach(walkS);
                break;
            case "if":
                walkS(st.t);
                if (st.e)
                    walkS(st.e);
                break;
            case "while":
            case "dowhile":
            case "with":
                walkS(st.body);
                break;
            case "for":
                if (st.init && "s" in st.init)
                    walkS(st.init);
                walkS(st.body);
                break;
            case "forin":
                if (st.varName)
                    add(st.varName);
                walkS(st.body);
                break;
            case "switch":
                st.cases.forEach((cl) => cl.body.forEach(walkS));
                break;
            case "try":
                walkS(st.block);
                if (st.param)
                    add(st.param);
                if (st.handler)
                    walkS(st.handler);
                if (st.finalizer)
                    walkS(st.finalizer);
                break;
        }
    };
    body.forEach(walkS);
    return order;
}
/** The free variables of a function scope: identifiers used (including via
 *  nested-function captures) that are neither this scope's locals/params nor
 *  always-available auto-registers. */
function computeFree(params, body) {
    const declared = new Set([...params, ...collectVariables(body), ...AVAILABLE]);
    return freeVarsOfStmts(declared, body);
}
/** Function expressions appearing directly in a scope's statements/expressions
 *  (NOT inside a nested function — those are reached via the direct child's own
 *  free set). Used to compute `innerFree` → `closed`. */
function collectDirectFuncs(body) {
    const out = [];
    const wN = (n) => {
        switch (n.k) {
            case "func":
                out.push(n);
                return; // do not descend
            case "member":
                wN(n.o);
                break;
            case "index":
                wN(n.o);
                wN(n.i);
                break;
            case "call":
            case "new":
                wN(n.c);
                n.args.forEach(wN);
                break;
            case "unary":
                wN(n.e);
                break;
            case "bin":
            case "logic":
            case "assign":
                wN(n.l);
                wN(n.r);
                break;
            case "cond":
                wN(n.c);
                wN(n.t);
                wN(n.f);
                break;
            case "paren":
                wN(n.e);
                break;
            case "cast":
                wN(n.e);
                wN(n.type);
                break;
            case "seq":
                n.es.forEach(wN);
                break;
            case "array":
                n.els.forEach(wN);
                break;
            case "object":
                n.props.forEach((p) => wN(p.v));
                break;
        }
    };
    const wS = (s) => {
        switch (s.s) {
            case "expr":
                wN(s.e);
                break;
            case "var":
                s.decls.forEach((d) => { if (d.init)
                    wN(d.init); });
                break;
            case "return":
                if (s.e)
                    wN(s.e);
                break;
            case "if":
                wN(s.c);
                wS(s.t);
                if (s.e)
                    wS(s.e);
                break;
            case "block":
                s.body.forEach(wS);
                break;
            case "while":
            case "dowhile":
                wN(s.c);
                wS(s.body);
                break;
            case "with":
                wN(s.c);
                wS(s.body);
                break;
            case "funcdecl":
                wN(s.fn);
                break;
            case "for":
                if (s.init) {
                    if ("s" in s.init)
                        wS(s.init);
                    else
                        wN(s.init);
                }
                if (s.test)
                    wN(s.test);
                if (s.upd)
                    wN(s.upd);
                wS(s.body);
                break;
            case "forin":
                if (!s.varName)
                    wN(s.lhs);
                wN(s.obj);
                wS(s.body);
                break;
            case "switch":
                wN(s.disc);
                s.cases.forEach((cl) => { if (cl.test)
                    wN(cl.test); cl.body.forEach(wS); });
                break;
            case "throw":
                wN(s.e);
                break;
            case "try":
                wS(s.block);
                if (s.handler)
                    wS(s.handler);
                if (s.finalizer)
                    wS(s.finalizer);
                break;
        }
    };
    body.forEach(wS);
    return out;
}
/** VariableAnalyzer.dereferenced (VariableAnalyzer.java:156): true iff THIS
 *  scope's statements (not descending into nested function expressions/decls —
 *  those get their own analyzer) contain a property identifier/value reference
 *  (`a.b` / `a[b]`) or a call expression. */
function computeDereferenced(body) {
    let found = false;
    const wN = (n) => {
        if (found)
            return;
        switch (n.k) {
            case "member":
            case "index":
                found = true;
                return;
            // A super call is an ASTSuperCallExpression, NOT an ASTCallExpression
            // (VariableAnalyzer.java:122/159) — it does NOT mark `dereferenced`, and
            // only its ARGUMENTS (node.get(2)) are visited as references; the
            // `super`/selector callee is skipped. So `super.init()` (no derefs in its
            // args) is NOT dereferenced. (Grammar: super | super.X | super.X.call/apply.)
            case "call":
                if (isSuperCallExpr(n)) {
                    n.args.forEach(wN);
                    return;
                }
                found = true;
                return; // also descend for sub-derefs (harmless)
            case "func": return; // nested closure: own analyzer
            case "new":
                n.args.forEach(wN);
                wN(n.c);
                break;
            case "unary":
                wN(n.e);
                break;
            case "bin":
            case "logic":
            case "assign":
                wN(n.l);
                wN(n.r);
                break;
            case "cond":
                wN(n.c);
                wN(n.t);
                wN(n.f);
                break;
            case "paren":
                wN(n.e);
                break;
            case "cast":
                wN(n.e);
                wN(n.type);
                break;
            case "seq":
                n.es.forEach(wN);
                break;
            case "array":
                n.els.forEach(wN);
                break;
            case "object":
                n.props.forEach((p) => wN(p.v));
                break;
        }
    };
    const wS = (s) => {
        if (found)
            return;
        switch (s.s) {
            case "expr":
                wN(s.e);
                break;
            case "var":
                s.decls.forEach((d) => { if (d.init)
                    wN(d.init); });
                break;
            case "return":
                if (s.e)
                    wN(s.e);
                break;
            case "if":
                wN(s.c);
                wS(s.t);
                if (s.e)
                    wS(s.e);
                break;
            case "block":
                s.body.forEach(wS);
                break;
            case "while":
            case "dowhile":
                wN(s.c);
                wS(s.body);
                break;
            case "with":
                wN(s.c);
                wS(s.body);
                break;
            case "funcdecl": break; // nested closure: own analyzer
            case "for":
                if (s.init) {
                    if ("s" in s.init)
                        wS(s.init);
                    else
                        wN(s.init);
                }
                if (s.test)
                    wN(s.test);
                if (s.upd)
                    wN(s.upd);
                wS(s.body);
                break;
            case "forin":
                if (!s.varName)
                    wN(s.lhs);
                wN(s.obj);
                wS(s.body);
                break;
            case "switch":
                wN(s.disc);
                s.cases.forEach((cl) => { if (cl.test)
                    wN(cl.test); cl.body.forEach(wS); });
                break;
            case "throw":
                wN(s.e);
                break;
            case "try":
                wS(s.block);
                if (s.handler)
                    wS(s.handler);
                if (s.finalizer)
                    wS(s.finalizer);
                break;
        }
    };
    body.forEach(wS);
    return found;
}
function analyzeScope(params, body, isMethod, as3, debug = false) {
    const variables = collectVariables(body);
    const localSet = new Set([...params, ...variables]);
    const free = computeFree(params, body);
    const innerFree = new Set();
    for (const f of collectDirectFuncs(body))
        for (const x of computeFree(f.params, f.body))
            innerFree.add(x);
    const closed = new Set([...localSet].filter((n) => innerFree.has(n)));
    // possibleInstance: the raw free set, refined to the class's instance
    // properties when they are resolvable (a "complete" AS3 class).
    const possible = as3 !== undefined
        ? new Set([...free].filter((f) => as3.props.has(f)))
        : free;
    const withThis = isMethod && possible.size > 0;
    const fullMap = new Map();
    let regno = 0;
    for (const k of [...params, ...variables]) {
        // Skip renaming closed-over names; but a closed *parameter* under withThis is
        // still renamed (and re-declared inside the with-block).
        const skip = (!withThis && closed.has(k)) ||
            (withThis && closed.has(k) && !params.includes(k));
        if (skip)
            continue;
        let r;
        // Debug builds keep the source name as a prefix: `name_$<reg>` (the register
        // number is still assigned/collision-skipped the same way). Compress builds
        // use the bare register `$<reg>`. (Synthetic params with no source name —
        // e.g. a generated constraint-setter arg — still render bare; those are
        // handled at their generation site, not here.)
        // Synthetic compiler-generated identifiers (the handler's `$lzc$ignore` arg,
        // the constraint setter's `$lzc$newvalue` local, the postincrement-expansion
        // `$lzsc$tmp` — anything in the reserved `$lzc$`/`$lzsc$` namespaces) have no
        // source name → render bare `$<reg>` even in debug. (Verified: no gold carries
        // a `$lzsc$X_$N` debug-named form — these are always renamed to bare registers.)
        const synthetic = k.startsWith("$lzc$") || k.startsWith("$lzsc$");
        do {
            const reg = "$" + regno.toString(36);
            r = (debug && !synthetic) ? k + "_" + reg : reg;
            regno++;
        } while (localSet.has(r) || free.has(r));
        fullMap.set(k, r);
    }
    const closedParams = withThis ? params.filter((p) => closed.has(p)) : [];
    const bodyMap = new Map(fullMap);
    const closedRedecls = closedParams.map((p) => ({ name: p, reg: fullMap.get(p) }));
    for (const p of closedParams)
        bodyMap.delete(p);
    const newParams = params.map((p) => fullMap.get(p) ?? p);
    return { map: bodyMap, newParams, withThis, closedRedecls, free, dereferenced: computeDereferenced(body) };
}
// ---------- Printer (compress=true,obfuscate=false) ----------
const NL = "\n";
const UNARY_WORD = new Set(["typeof", "void", "delete"]);
class Printer {
    constructor(rename, compress = true) {
        // AS3 class descriptors accumulated across a program (built in source order so
        // a class extending an earlier AS3 class can resolve its instance properties).
        this.classDescriptors = new Map();
        // Debug (readable/source-mapped) backend context. `dbg` enables the lnum
        // source-line annotation stream; `dfile` is the current .lzx filename used in
        // the annotations. Only set in compress=false builds.
        this.dbg = false;
        this.dfile = "";
        this.dline = 0; // current source line context for statements lacking an explicit line
        this.joinDepth = 0; // joinStmts recursion depth (1 = function-body StatementList)
        // Source line of the control statement whose `{`-block body is about to be
        // joined (set right before bodyOf/forceBlock). A super-call that is the FIRST
        // statement of such a block tracks at the block's open-`{` line — the same
        // JJTree node-open quirk as the function-body firstStmtQuirk, but at nested
        // depth (basetabelement `_setSelected`: `if(s&&…){` @114, super @115 → #114).
        this.pendingBlockLine = -1;
        // Super-call JJTree line-quirk delta (Rule B, cascading form). When a super call
        // is shifted up one line (Rule A), the re-parse consumes a line in the lexer
        // stream, so EVERY subsequent source line in the SAME function body — at any
        // nesting depth — tracks one lower. This Printer-scoped delta applies that shift
        // in lnum; it does NOT leak into nested function expressions (each gets a fresh
        // Printer). Replaces the old per-statement Rule B (which only shifted the single
        // immediate expr successor, missing `if`/`if`-body/sibling cascades).
        this.dbgLineDelta = 0;
        // Set true by a method/function caller when the body has NO debug try/catch
        // wrapper (not dereferenced, no free refs) — enables the first-statement super
        // line quirk (the super directly follows the function's source `{`).
        this.dbgNoWrapper = false;
        // Debug postincrement/decrement expansion: a postfix `++`/`--` on a CHECKED
        // (free, bare-identifier) reference is rewritten by the oracle into a
        // source-capturing displayName-IIFE (JavascriptGenerator.visitPostfixExpression
        // `isChecked()` branch). `dfile` is the .lzx filename for the IIFE's displayName.
        // Only free identifiers are checked — property (`a.b++`) and index (`a[i]++`)
        // refs are NOT (their PropertyReference.checkedNode is commented out), nor are
        // local vars/params. The free set is the analyzed scope's free identifiers.
        this.dbgFree = null;
        // Names declared in an ENCLOSING lexical scope (script-level `var`/funcdecl, or
        // an outer function's locals) that RESOLVE a nested function's free reference —
        // so a postfix/prefix `++`/`--` on such a name is NOT "checked" (the oracle's
        // translateReference resolves it to a known binding) and is NOT IIFE-expanded.
        // Empty for an instance method/handler body (where free refs are instance
        // properties via `with(this)` — those ARE checked). E.g. performance-tuning's
        // script-level `var j` makes `j++` inside `globalReference` plain, while
        // databinding's instance attr `ind` (no outer var) makes `++ind` expand.
        this.dbgOuterVars = new Set();
        // An inherited `#pragma userFunctionName=…` (CodeGenerator: the option set in a
        // handler/setter/binder prologue persists down the options-copy into every
        // lexically-nested function), so a nested function VALUE's debug displayName is
        // the enclosing pretty name (`handle oninit`, `set url`) NOT its `file#line/col`
        // form. null = no inherited name (a plain method body / top-level script does
        // not propagate). Propagates recursively into the sub-Printers.
        this.outerUserName = null;
        this.rename = rename;
        this.c = compress;
        this.SP = compress ? "" : " ";
        this.COMMA = "," + this.SP;
        this.COLON = ":" + this.SP;
        this.ASSIGN = this.SP + "=" + this.SP;
        this.OPENP = this.SP + "("; // OPENPAREN: " (" readable, "(" compressed
        this.CLOSEP = ")" + this.SP; // CLOSEPAREN: ") " readable, ")" compressed
    }
    id(name) { return this.rename.get(name) ?? name; }
    // lnum (ParseTreePrinter:1184): in a debug build, prefix a source-line
    // annotation to a node's output unless an equivalent annotation is already at
    // the head of the string. `line` is the construct's source line in `dfile`
    // (0 / null = generated code → the `/* -*- file: -*- */` marker).
    lnum(line, str, fileOverride) {
        if (!this.dbg)
            return str;
        const file = fileOverride !== undefined ? fileOverride : (line == null ? "" : this.dfile);
        const eff = line == null ? null : line + this.dbgLineDelta;
        const ann = firstAnnotation(str);
        if (str.length <= 1 || str[0] !== ANNOTATE_MARKER || fileLineNumberNeeded(ann, file, eff ?? 0)) {
            return annoFileLine(file, eff ?? 0) + str;
        }
        return str;
    }
    // precedence for paren decisions
    prec(n) {
        switch (n.k) {
            case "seq": return 0;
            case "assign": return 1;
            case "cond": return 2;
            case "logic": return BINPREC[n.op];
            // The `in` operator is PARSED at relational precedence (BINPREC, used by the
            // parser) but the oracle's ParseTreePrinter deliberately moved it to the
            // ASSIGNMENT precedence row for paren decisions (ParseTreePrinter.prec table,
            // "to compensate for SWF9 3rd party compiler precedence bug") — so an `in`
            // expression used as an operand of `||`/`&&`/etc. is parenthesized:
            // `! (("x" in args) || …)`. Assignment level = 1 in this (printer-only) scale.
            case "bin": return n.op === "in" ? 1 : BINPREC[n.op];
            case "unary": return n.prefix ? 14 : 15;
            case "call":
            case "new":
            case "member":
            case "index": return 17;
            case "cast": return this.prec(n.e);
            // A function expression has assignment precedence (ParseTreePrinter:
            // ASTFunctionExpression → prec(ASSIGN)); it is parenthesized when used as a
            // call/member base, but not as an argument, var-initializer, or RHS. BUT in
            // the DEBUG build a function VALUE renders as the displayName-IIFE
            // `(function(){…})()` — itself a CALL expression (prec 17) that already
            // carries its parens — so a debug func used as a call/member base needs NO
            // extra wrap (the oracle's `(…IIFE…)()(arg)`, not `((…IIFE…)())(arg)`).
            case "func": return this.dbg ? 17 : 1;
            default: return 20;
        }
    }
    wrap(child, parentPrec, rightSide = false) {
        const cp = this.prec(child);
        if (cp < parentPrec || (cp === parentPrec && rightSide))
            return "(" + this.expr(child) + ")";
        return this.expr(child);
    }
    expr(n) {
        switch (n.k) {
            case "num": return printNumber(n.raw);
            case "str": return jsString(n.v);
            case "id": return this.id(n.name);
            case "this": return "this";
            case "super": return "super";
            case "lit": return n.v;
            case "paren": return this.expr(n.e); // parens reinserted by precedence
            case "cast": return this.expr(n.e); // `e cast Type` erases to `e`
            case "member": return this.wrap(n.o, 17) + "." + n.p;
            case "index": return this.wrap(n.o, 17) + "[" + this.expr(n.i) + "]";
            case "call": {
                // The superclass-method dispatch guard prefix, spaced in the debug build
                // (`["$superclass"] && … || this.nextMethod(arguments.callee, m)`).
                const A = this.SP, C = this.COMMA;
                const dispatch = (m) => `(arguments.callee["$superclass"]${A}&&${A}arguments.callee.$superclass.prototype[${m}]` +
                    `${A}||${A}this.nextMethod(arguments.callee${C}${m}))`;
                // Bare `super(args)` is the constructor super-call → dispatch to
                // $lzsc$initialize (CommonGenerator: a super with no selector).
                if (n.c.k === "super") {
                    const m = jsString("$lzsc$initialize");
                    const args = n.args.map((a) => this.expr(a)).join(C);
                    return `${dispatch(m)}.call(this${args ? C + args : ""})`;
                }
                // super.X.call(args) / super.X.apply(args) → the dispatch with the
                // user-supplied call/apply args passed verbatim (CommonGenerator
                // translateSuperCallExpression's `call`/`apply` patterns).
                if (n.c.k === "member" && (n.c.p === "call" || n.c.p === "apply") &&
                    n.c.o.k === "member" && n.c.o.o.k === "super") {
                    const m = jsString(n.c.o.p);
                    const args = n.args.map((a) => this.expr(a)).join(C);
                    return `${dispatch(m)}.${n.c.p}(${args})`;
                }
                // super.X(args) → the kernel superclass-method dispatch.
                if (n.c.k === "member" && n.c.o.k === "super") {
                    // super.setAttribute(prop, v) → a setter super-dispatch
                    // (CommonGenerator.translateSuperCallExpression). A constant property
                    // names the setter $lzc$set_<prop>; a dynamic one dispatches via
                    // '$lzc$set_'+prop (without the $superclass guard).
                    if (n.c.p === "setAttribute" && n.args.length === 2) {
                        const value = this.expr(n.args[1]);
                        const prop = n.args[0];
                        if (prop.k === "str") {
                            const m = jsString("$lzc$set_" + prop.v);
                            return `${dispatch(m)}.call(this${C}${value})`;
                        }
                        return `this.nextMethod(arguments.callee${C}${jsString("$lzc$set_")}${A}+${A}${this.expr(prop)}).call(this${C}${value})`;
                    }
                    const m = jsString(n.c.p);
                    const args = n.args.map((a) => this.expr(a)).join(C);
                    return `${dispatch(m)}.call(this${args ? C + args : ""})`;
                }
                return this.wrap(n.c, 17) + "(" + n.args.map((a) => this.expr(a)).join(this.COMMA) + ")";
            }
            case "new": return "new " + this.wrap(n.c, 18) + "(" + n.args.map((a) => this.expr(a)).join(this.COMMA) + ")";
            case "unary":
                // Debug: a `++`/`--` (PREFIX or POSTFIX) on a CHECKED reference (a free,
                // bare identifier — NOT a property/index ref, NOT a local, NOT an outer
                // resolvable var) expands to a source-capturing displayName-IIFE
                // (JavascriptGenerator.visitPostfix/Pre-Increment/Decrement, isChecked()
                // branch). POSTFIX returns the OLD value, PREFIX returns the NEW value:
                //   postfix `X++` →  var $0 = X; X = $0 + 1; return $0
                //   prefix  `++X` →  var $0 = X; return X = $0 + 1
                if (this.dbg && (n.op === "++" || n.op === "--") &&
                    n.e.k === "id" && this.dbgFree && this.dbgFree.has(n.e.name) &&
                    !this.dbgOuterVars.has(n.e.name)) {
                    const sym = n.e.name;
                    const step = n.op === "++" ? "+" : "-";
                    // The substituted IIFE-inner function body (sc source). `$lzsc$tmp` is a
                    // local var (analyzer renames it to `$0`); `sym` is free.
                    const innerSrc = n.prefix
                        ? `var $lzsc$tmp = ${sym}; return ${sym} = $lzsc$tmp ${step} 1;`
                        : `var $lzsc$tmp = ${sym}; ${sym} = $lzsc$tmp ${step} 1; return $lzsc$tmp;`;
                    const line = n.line ?? this.dline;
                    const fn = {
                        k: "func", name: null, params: [], defaults: [],
                        body: foldStmts(new Parser(lex(innerSrc, line, this.dfile)).parseProgram()),
                        line, col: 1, file: this.dfile,
                    };
                    // The IIFE's displayName inherits an enclosing handler/setter/binder's
                    // propagated pretty name (`handle onclick`) when present; otherwise it is
                    // the `file#line/1` form (a method body — lzunit-$2's `counter++`).
                    const userName = this.outerUserName != null ? this.outerUserName : this.dfile + "#" + line + "/1";
                    return renderDebugFuncNode(fn, userName, /*named*/ false, this.dfile, line, "report", false, undefined, this.outerUserName) + "()";
                }
                if (!n.prefix) {
                    return this.wrap(n.e, 15) + n.op;
                }
                // A prefix-unary operand parenthesizes when its precedence is <= the
                // operator's (ParseTreePrinter.maybeAddParens, default assoc=false), so a
                // nested prefix unary keeps parens: `!!x` → `!(!x)`, `- -x` → `-(-x)`.
                return n.op + (UNARY_WORD.has(n.op) ? " " : "") + this.wrap(n.e, 14, true);
            case "bin":
            case "logic": {
                // `in` uses assignment-level precedence for paren decisions (see prec()).
                const p = n.k === "bin" && n.op === "in" ? 1 : BINPREC[n.op];
                // Word operators always need surrounding spaces (`a instanceof b`);
                // symbol operators are tight in compress mode, spaced in debug mode.
                const sp = n.op === "instanceof" || n.op === "in" ? " " : this.SP;
                const r = this.wrap(n.r, p, true);
                // Disambiguate adjacent like-signed tokens (ParseTreePrinter
                // visitBinaryExpressionSequence/delimit): the right operand gets a forced
                // leading space when the operator's last char equals the operand's first
                // char (e.g. `a + +b` not `a++b`, `a - -b`) — UNLESS the operand is
                // parenthesized. Applies in BOTH compress and debug modes.
                const rsp = sp || (r.length > 0 && r[0] !== "(" && n.op[n.op.length - 1] === r[0] ? " " : "");
                return this.wrap(n.l, p) + sp + n.op + rsp + r;
            }
            case "assign":
                return this.wrap(n.l, 1) + this.SP + n.op + this.SP + this.wrap(n.r, 1);
            case "cond":
                // All three operands are parenthesized when their precedence is <= the
                // conditional's (ParseTreePrinter.visitConditionalExpression uses the
                // non-associative `thisPrec <= parentPrec` rule for each), so a nested
                // conditional in the then/else branch keeps its parens.
                return this.wrap(n.c, 2, true) + this.SP + "?" + this.SP + this.wrap(n.t, 2, true) + this.SP + ":" + this.SP + this.wrap(n.f, 2, true);
            case "array":
                return "[" + n.els.map((e) => this.expr(e)).join(this.COMMA) + "]";
            case "object":
                // A key preserves its source form: a string-literal key stays quoted, a
                // numeric key prints as a number, an identifier key stays bare.
                return "{" + n.props.map((p) => {
                    const k = p.keyKind === "str" ? jsString(p.key) : p.keyKind === "num" ? printNumber(p.key) : p.key;
                    return k + this.COLON + this.expr(p.v);
                }).join(this.COMMA) + "}";
            case "seq":
                return n.es.map((e) => this.expr(e)).join(this.COMMA);
            case "func":
                return this.printFunc(n);
        }
    }
    /** Print a function expression with its own renaming scope. Nested function
     *  expressions are never methods, so they never get `with(this)`; their
     *  params/locals are renamed per their own register map. */
    printFunc(n) {
        // Debug build: a function expression VALUE is rendered like a nested function
        // (displayName IIFE, name_$N idents, try/catch, directives). A named one's
        // displayName is its name; an anonymous one's is `<file>#<line>/<col>` (the
        // `function` keyword position — JavascriptGenerator:1115).
        if (this.dbg) {
            const fl = n.line ?? this.dline ?? 0;
            // An anonymous function's displayName + source directives use the function's
            // OWN file context (the `function` token's `#file`), not the enclosing
            // printer's dfile — these differ for a `<script src=…>` whose body switches
            // file (json.js inside a script whose element file is rpc.js). Defaults to
            // dfile when the node carries no file (most bodies share the enclosing file).
            const ffile = n.file !== undefined ? n.file : (this.dfile ?? "");
            // An inherited userFunctionName pragma (from an enclosing handler/setter/
            // binder) overrides BOTH the source name and the file#line/col default
            // (CodeGenerator: the explicit option wins over functionName). It then
            // propagates further into THIS function's own nested values.
            const userName = this.outerUserName != null ? this.outerUserName
                : n.name != null ? n.name : `${ffile}#${n.line}/${n.col}`;
            // This function's nested values see THIS scope's locals (rename-map source
            // names) + any names already resolvable from further out as outer (resolved)
            // vars — so a `++X` inside a deeper function where X is an outer `var` stays
            // plain.
            const childOuter = new Set([...this.dbgOuterVars, ...this.rename.keys()]);
            return renderDebugFuncNode(n, userName, n.name != null, ffile, fl, "report", false, undefined, this.outerUserName, childOuter);
        }
        const scope = analyzeScope(n.params, n.body, false);
        const sub = new Printer(scope.map, this.c);
        // Parameter-default prologue (same shape as a method): a fall-through
        // `switch(arguments.length){case i:<reg>=<default>;…}`.
        const cases = n.params
            .map((_, i) => (n.defaults[i] != null ? `case ${i}:\n${scope.newParams[i]}=${sub.expr(n.defaults[i])};` : null))
            .filter((c) => c != null);
        const prologue = cases.length > 0 ? `switch(arguments.length){\n${cases.join("\n")}\n\n};` : "";
        const text = prologue + sub.joinStmts(n.body);
        const block = text === "" ? "{}" : sub.makeBlock(text);
        return `function(${scope.newParams.join(",")})${block}`;
    }
    /** Emit a class method/constructor body as `function(…){…}` (a faithful
     *  port of compileFunction's body emission, but over a parsed func node with
     *  AS3-class `with(this)` refinement). Static methods are never `with(this)`
     *  (isMethod=false). */
    printAs3Method(fn, isMethod, as3) {
        const params = fn.params;
        const body = fn.body;
        const scope = analyzeScope(params, body, isMethod, as3);
        const printer = new Printer(scope.map, this.c);
        const funcdecls = body.filter((s) => s.s === "funcdecl");
        const rest = body.filter((s) => s.s !== "funcdecl");
        if (funcdecls.length && hasNestedFuncDecl(rest))
            throw new ScUnsupported("nested function declaration");
        const hoist = funcdecls.length
            ? funcdecls.map((d) => `var ${printer.id(d.name)};`).join("") +
                funcdecls.map((d) => `${printer.id(d.name)}=${printer.printFunc(d.fn)};`).join("")
            : "";
        const cases = params
            .map((_, i) => {
            if (fn.defaults[i] == null)
                return null;
            // A closed param under with(this) is re-declared `var name=$reg` inside
            // the with-block, so the default switch assigns the ORIGINAL name (that
            // local), not the register (CommonGenerator's closed-param handling).
            const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
            return `case ${i}:\n${lhs}=${printer.expr(foldNode(fn.defaults[i]))};`;
        })
            .filter((c) => c != null);
        const prologue = cases.length > 0 ? `switch(arguments.length){\n${cases.join("\n")}\n\n};` : "";
        const bodyText = hoist + printer.joinStmts(rest);
        let block;
        if (scope.withThis) {
            const redecls = scope.closedRedecls.map(({ name, reg }) => `var ${name}=${reg};`).join("");
            block = printer.makeBlock("with(this)" + printer.makeBlock(redecls + prologue + bodyText));
        }
        else {
            const combined = prologue + bodyText;
            block = combined === "" ? "{}" : printer.makeBlock(combined);
        }
        return `function(${scope.newParams.join(",")})${block}`;
    }
    /** Compile an AS3 `class` to `Class.make("Name", <instanceprops>[, <super>[,
     *  <classprops>]])` (CommonGenerator.visitClassDefinition). Instance/static
     *  vars become name/value pairs (no init → `void 0`); the constructor is
     *  renamed `$lzsc$initialize`; members appear in source order. No `$m`/`$LZ`
     *  gensym is consumed (names are literal). */
    printAs3Class(n) {
        // Own instance-property names (vars + methods; constructor → $lzsc$initialize).
        const ownProps = new Set();
        for (const m of n.members) {
            if (m.kind === "stmt" || m.static)
                continue;
            ownProps.add(m.kind === "method" && m.name === n.name ? "$lzsc$initialize" : m.name);
        }
        // Completeness: resolvable iff no super, or super is a complete AS3 class
        // declared earlier in this unit (else instanceprops are unknown → null).
        let complete;
        let refineProps;
        if (n.sup === null) {
            complete = true;
            refineProps = ownProps;
        }
        else {
            const sd = this.classDescriptors.get(n.sup);
            if (sd && sd.complete) {
                complete = true;
                refineProps = new Set([...ownProps, ...sd.props]);
            }
            else {
                complete = false;
                refineProps = null;
            }
        }
        this.classDescriptors.set(n.name, { complete, props: refineProps ?? ownProps });
        // A complete class refines `with(this)` by its instance properties; an
        // incomplete one (unknown supers) uses the raw free-set rule (undefined).
        const as3 = refineProps !== null ? { props: refineProps } : undefined;
        const inst = [];
        const stat = [];
        const stmts = [];
        for (const m of n.members) {
            if (m.kind === "stmt") {
                stmts.push(m.stmt);
                continue;
            }
            const target = m.static ? stat : inst;
            if (m.kind === "var") {
                target.push(jsString(m.name));
                target.push(m.init ? this.expr(foldNode(m.init)) : "void 0");
            }
            else {
                const isCtor = !m.static && m.name === n.name;
                target.push(jsString(isCtor ? "$lzsc$initialize" : m.name));
                // Static methods are never `with(this)` (isMethod=false); instance
                // methods use this class's instanceprops refinement.
                target.push(m.static ? this.printAs3Method(m.fn, false) : this.printAs3Method(m.fn, true, as3));
            }
        }
        // Class.make argument assembly (right-to-left null-filling, no interfaces).
        // `with` mixins precede the superclass in a `[mixin…, super]` array; a bare
        // super with no mixins is passed directly (CommonGenerator.mixinsandsuper).
        const instArr = inst.length ? "[" + inst.join(",") + "]" : null;
        const statArr = stat.length ? "[" + stat.join(",") + "]" : null;
        const superRef = n.mixins.length
            ? "[" + [...n.mixins, ...(n.sup !== null ? [n.sup] : [])].join(",") + "]"
            : n.sup;
        let args = "";
        if (statArr !== null)
            args = "," + statArr;
        if (superRef !== null)
            args = "," + superRef + args;
        else if (args.length)
            args = ",null" + args;
        if (instArr !== null)
            args = "," + instArr + args;
        else if (args.length)
            args = ",null" + args;
        const make = `${n.xtor}.make(${jsString(n.name)}${args})`;
        if (stmts.length === 0)
            return make;
        // Class-body statements run in a post-Class.make initializer:
        // `{Class.make(…);(function($0){with($0)with($0.prototype){{<stmts>}}})(Name)}`.
        const inner = this.makeBlock(this.joinStmts(stmts));
        const iife = `(function($0)${this.makeBlock("with($0)with($0.prototype)" + this.makeBlock(inner))})(${n.name})`;
        return `{${NL}${make};${iife}${NL}};`;
    }
    /** Debug (compress=false) rendering of a script-level AS3 `class` declaration.
     *  Mirrors printAs3Class but: the instance/static arrays are spaced (`, `), and
     *  each method VALUE is the full displayName-IIFE + try/catch + $reportException
     *  debug stream (renderDebugFuncNode), tracked at the method's own source line.
     *  (CommonGenerator.visitClassDefinition + the debug method machinery.) The
     *  class-body-statement initializer path is not yet handled in debug — refuse. */
    printAs3ClassDebug(n) {
        const ownProps = new Set();
        for (const m of n.members) {
            if (m.kind === "stmt" || m.static)
                continue;
            ownProps.add(m.kind === "method" && m.name === n.name ? "$lzsc$initialize" : m.name);
        }
        let complete;
        let refineProps;
        if (n.sup === null) {
            complete = true;
            refineProps = ownProps;
        }
        else {
            const sd = this.classDescriptors.get(n.sup);
            if (sd && sd.complete) {
                complete = true;
                refineProps = new Set([...ownProps, ...sd.props]);
            }
            else {
                complete = false;
                refineProps = null;
            }
        }
        this.classDescriptors.set(n.name, { complete, props: refineProps ?? ownProps });
        // The instance-property refinement for `with(this)`: passed when resolvable
        // (complete), else undefined (unknown super → raw free-set rule). Mirrors
        // printAs3Class.
        const as3 = refineProps !== null ? { props: refineProps } : undefined;
        const inst = [];
        const stat = [];
        const stmts = [];
        // The class's members track the class's OWN file context — a `<script src=
        // "md5.js">` body opens with `#file md5.js`, so the AS3 class node carries
        // `.file = md5.js` and its method directives use that, NOT the including .lzx.
        const file = n.file !== undefined ? n.file : this.dfile;
        for (const m of n.members) {
            if (m.kind === "stmt") {
                stmts.push(m.stmt);
                continue;
            }
            const target = m.static ? stat : inst;
            if (m.kind === "var") {
                target.push(jsString(m.name));
                target.push(m.init ? this.expr(foldNode(m.init)) : "void 0");
            }
            else {
                const isCtor = !m.static && m.name === n.name;
                const userName = isCtor ? "$lzsc$initialize" : m.name;
                target.push(jsString(userName));
                // Instance methods are isMethod=true with this class's instance-prop
                // refinement (→ `with(this)` when they reference instance props); static
                // methods are never `with(this)`.
                target.push(renderDebugFuncNode(m.fn, userName, /*named*/ true, file, m.fn.line ?? 0, "report", /*isMethod*/ !m.static, m.static ? undefined : as3));
            }
        }
        // Class.make argument assembly (right-to-left null-filling), arrays + args spaced.
        const instArr = inst.length ? "[" + inst.join(", ") + "]" : null;
        const statArr = stat.length ? "[" + stat.join(", ") + "]" : null;
        const superRef = n.mixins.length
            ? "[" + [...n.mixins, ...(n.sup !== null ? [n.sup] : [])].join(", ") + "]"
            : n.sup;
        let args = "";
        if (statArr !== null)
            args = ", " + statArr;
        if (superRef !== null)
            args = ", " + superRef + args;
        else if (args.length)
            args = ", null" + args;
        if (instArr !== null)
            args = ", " + instArr + args;
        else if (args.length)
            args = ", null" + args;
        const make = `${n.xtor}.make(${jsString(n.name)}${args})`;
        if (stmts.length === 0)
            return make;
        // Class-body statements run in a post-Class.make initializer (CommonGenerator
        // visitClassDefinition:514 — `(function ($lzsc$c) { with($lzsc$c) with(
        // $lzsc$c.prototype) { _6 }})(_1)`). In debug it is the displayName-IIFE
        // `(function () { var $lzsc$temp = function ($0) { try { with ($0) with (
        // $0.prototype) { { <stmts> } }} catch {…} }; …displayName="<file>#<cl>/1";
        // return $lzsc$temp })()(Name)` — the SAME structure as the LZX `<class>`
        // mergeAttributes init (debugMergeAttributes), with `<stmts>` in place of the
        // `LzNode.mergeAttributes(…)` call and the AS3 class name as the IIFE argument.
        // The `$0` parameter is a literal generated name (not renamed). The leading
        // directive + the `with`/`function` track at the class's begin line (classLine
        // — gold: LzRPC begin=20 → `with (…)`@20, $reportException 20, displayName
        // `…#20/1`); the make + init leading directive is classLine − 1.
        const cl = n.classLine ?? 0;
        const A = (k) => annoFileLine(file, k);
        const GEN = annoFileLine(null, 0);
        const FB = forceBlankLnum();
        // Render the body statements with a fresh debug printer (so the `$0` register is
        // not in scope and names stay literal — these are class-level globals/assigns).
        const sub = new Printer(new Map(), /*compress*/ false);
        sub.dbg = true;
        sub.dfile = file;
        const stmtsText = sub.joinStmts(stmts);
        // The `with ($0) with ($0.prototype) { { <stmts> } }` inner double-block: when
        // the statement list is empty (e.g. a class whose only body directive is a
        // stray `;`), the oracle's empty StatementList prints to nothing and the whole
        // with-body collapses to `{}` (gold: `with (…) with (…) {}}`). Otherwise the
        // stmts sit in a nested block.
        const withInner = unannotateStr(stmtsText).trim() === ""
            ? `with ($0) with ($0.prototype) {}`
            : `with ($0) with ($0.prototype) {\n${GEN}{\n${elideSemi(stmtsText)}\n}}`;
        const tryWrap = `try {\n${A(cl)}${withInner}}\n${GEN}catch ($lzsc$e) {\n${debugCatchBody(file, cl)}}`;
        const funcBlock = `{\n${GEN}${tryWrap}}`;
        const innerFn = `function ($0) ${funcBlock}${FB}`;
        const S1 = `var $lzsc$temp = ${innerFn};`;
        const S2 = `${A(cl)}$lzsc$temp["displayName"] = ${jsString(file + "#" + cl + "/1")};`;
        const S3 = `${A(cl)}return $lzsc$temp`;
        const iife = `(function () {\n${S1}\n${S2}\n${S3}\n}${FB})()`;
        const init = this.lnum(cl - 1, `${iife}(${n.name})`);
        // The whole class — `Class.make(…)` + post-make initializer — is wrapped in a
        // `{ … }` block scope so the initializer's statements do not interfere with the
        // following top-level statements (CommonGenerator visitClassDefinition:514
        // `{ Class.make(…);(function…)(Name) }`; the same `{make;merge}` block the LZX
        // `<class>` path emits in emitClassBlock). The make's leading directive (at
        // classLine − 1) sits INSIDE the `{`. compileProgramDebug detects the leading
        // `{` and does NOT prepend another directive. The trailing `}` is the unit's
        // last char (the unit-join then appends `;`).
        return "{\n" + this.lnum(cl - 1, make) + ";\n" + init + "\n}";
    }
    // Join statements with the oracle's sep rule: sep before each child is ";"
    // when the previous child did not end in ";", else "" (compress mode).
    joinStmts(body) {
        this.joinDepth++;
        try {
            return this.joinStmtsInner(body);
        }
        finally {
            this.joinDepth--;
        }
    }
    joinStmtsInner(body) {
        let out = "";
        let sep = "";
        // compress: statements join tight (";" only when needed). debug (compress=
        // false): statements are NEWLINE-separated (ParseTreePrinter's ASTStatement-
        // List conditional join: SEMI+NEWLINE when a child does not already end ";",
        // else NEWLINE).
        const NLsep = this.c ? "" : NL;
        // Debug JJTree line-quirk state. The quirk only manifests at the function-body
        // StatementList (joinDepth === 1), not nested blocks.
        const ruleActive = this.dbg && this.joinDepth === 1;
        // Whether the previous statement was a super-call that was itself SHIFTED by
        // Rule A: only then does the shift propagate to the following expression
        // statement (Rule B). A super call that kept its own line (e.g. the first
        // statement of a body) does not shift its successor.
        let prevWasShiftedSuper = false;
        // First-statement super quirk: when a method body has NO try/catch wrapper
        // (`dbgNoWrapper`, set by the caller iff the body is not dereferenced and has
        // no free refs), the super call is the DIRECT first child of the function and
        // its textual predecessor is the function's own source `{` (on `this.dline`,
        // the function-declaration line). The JJTree node-open quirk then tracks the
        // super at funcLine when it sits on funcLine+1 (immediately after the `{`).
        // (debugger LzDebugWindow.init: `<method>` @154, bare `super.init()` @155 → 154.)
        // A super not adjacent to the `{` keeps its own line (basecomponent init: a
        // `<![CDATA[` line sits between, super @145 != 143+1 → no shift). When the body
        // IS wrapped (with(this)/try), the super follows the GENERATED `try {` brace, so
        // it keeps its own line (basecomponent construct @129, funcLine 128 → 129); the
        // quirk for those supers is driven by the preceding STATEMENT, not the `{`.
        const firstStmtQuirk = ruleActive && this.dbgNoWrapper;
        // Nested-block first-super quirk: when THIS joinStmts is a control statement's
        // `{`-block body (pendingBlockLine set by the if/while/for printer), a super
        // that is the FIRST statement of the block and sits one line below the `{`
        // tracks at the block's open line — emitting a same-file `/* #N -*- */`
        // directive (basetabelement `_setSelected`: `if(s&&…){`@114, super@115 → #114).
        // Captured here (the printer resets pendingBlockLine after this call returns).
        const blockLine = this.dbg && this.joinDepth > 1 ? this.pendingBlockLine : -1;
        this.pendingBlockLine = -1;
        let nestedFirstSuperActive = blockLine >= 0; // cleared after the 1st statement
        let prevEndLine = firstStmtQuirk ? this.dline
            : nestedFirstSuperActive ? blockLine : -1;
        let prevTriggersQuirk0 = firstStmtQuirk || nestedFirstSuperActive;
        // RULE A refinement: whether the predecessor's controlled block's last nested
        // statement is itself a `}`-terminated control statement. When it is (e.g.
        // baseformitem's outer `if`, tail = the folded `if($debug){…}`), the super
        // quirk does NOT fire even though the super is adjacent to the predecessor's
        // `}`; the super keeps its own line.
        // RULE A refinement: whether the predecessor "triggers the quirk" (a simple
        // statement, or a `}`-terminated control statement with a simple last nested
        // statement). Folded `if($debug){…}` tails (baseformitem init) and braceless
        // `if(cond) expr;` predecessors (baseformitem destroy) do NOT trigger.
        let prevTriggersQuirk = prevTriggersQuirk0;
        // Whether the previous statement was a single-line block-if (enables the
        // gap-tolerant Rule A for a super one blank line below it).
        let prevSingleLineBlockIf = false;
        for (const s of body) {
            // Snapshot the cascade delta BEFORE printing the body: a nested super inside
            // this statement's body mutates dbgLineDelta (the Rule-B cascade), but THIS
            // statement's OWN line directive must resolve against the delta as it stood
            // before its body — the cascade only shifts SUBSEQUENT siblings.
            const deltaBefore = this.dbgLineDelta;
            let text = this.stmt(s);
            if (text === "")
                continue;
            // Debug: prefix each statement with its source-line annotation. The end-of-
            // statement test must look past trailing annotations (a function expr ends
            // in a forceBlankLnum marker), so unannotate before checking for ";".
            let raw = text;
            let ruleAFired = false;
            if (this.dbg) {
                // JJTree node-open quirk. Rule A: a SUPER-call statement adjacent to (on the
                // line right after) the previous statement's last token is tracked at that
                // previous end line, not its own — the super rewrite re-PARSES its expansion
                // via substitute() at the node's line number, which JJTree sets from
                // getToken(1) at node-open (the preceding token). Confirmed for a multi-line
                // if-block predecessor (componentmanager init → super.init at the `}` line)
                // and a single-line expr predecessor (layout destroy → super.destroy at the
                // releaseLayout line). Rule B: an EXPRESSION statement right after a SHIFTED
                // super inherits the same one-line shift (basecomponent addSubview's
                // this.update after the shifted super.addSubview); a super that kept its own
                // line (the first statement of a body, e.g. basecomponent init) does NOT
                // shift its successor, and `if`/`var`/`return` never shift. Adjacency-gated.
                let line = s.line ?? this.dline;
                const isSuper = s.s === "expr" && isSuperCallExpr(s.e);
                // Rule A (adjacent super): tracked at the predecessor's end line (prevEnd+1
                // == own line → prevEnd). Rule A' (gapped super): a super one BLANK line
                // below a single-line block-if predecessor (lzunit TestCase.construct: if
                // @559, blank 560, super @561) tracks at prevEnd+1 (== the blank line, 560)
                // — its OWN line minus the gap. Both reduce to "super tracks at prevEnd+1"
                // for an if-block predecessor; the adjacent case's prevEnd+1 is its own line.
                const ruleA = (ruleActive || nestedFirstSuperActive) && isSuper && prevTriggersQuirk
                    && line === prevEndLine + 1;
                const ruleAGap = ruleActive && isSuper && prevTriggersQuirk
                    && line === prevEndLine + 2 && prevSingleLineBlockIf;
                // Rule B (cascading): once a super is shifted, `dbgLineDelta` (applied in
                // lnum) shifts every subsequent source line in this function body by the
                // same one line — the immediate successor (expr OR `if`), its nested block
                // body, and any siblings — not just the single immediate expr. Verified:
                // addSubview's this.update (29→28), reverselayout's this.reset (45→44), and
                // debugger.lzx bottom `<setter name="height">` (if @805→804, if-body
                // @806→805). The delta is set AFTER this super's own lnum (below).
                if (ruleA)
                    line = prevEndLine;
                else if (ruleAGap)
                    line = prevEndLine + 1;
                ruleAFired = ruleA || ruleAGap;
                // Source paren-group / IIFE statement quirk (mirror of super Rule A). A
                // top-level expression statement whose PRINTED form begins with a `(`
                // (a `(function(){…})(…)` IIFE, or any parenthesized-group statement) is
                // line-tracked at N−1: JJTree's jjtreeOpenNodeScope sets the group node's
                // begin-line from getToken(1).beginLine — the `(` token, which lexes at
                // N−1 because it immediately follows the EOL special-token (`\n` is a
                // SPECIAL_TOKEN, not skipped). So the leading source directive sits one
                // line above the body; the body's own inner directive (the displayName-
                // IIFE wrapper's S1 at line N) is then SUPPRESSED by the translation-unit
                // dedup, because the one consumed text line (`(function () {`) makes its
                // linediff equal the N−1 directive's. Gated to joinDepth-1 statements
                // (ruleActive) — NOT the generated displayName-IIFE wrappers, which are
                // function VALUES emitted directly by renderDebugFuncNode (never reach
                // this statement loop) and already track at N−1 on their own.
                if (ruleActive && s.s === "expr" && !ruleAFired && raw.startsWith("(function")) {
                    line -= 1;
                }
                // Resolve THIS statement's own directive against the pre-body cascade delta
                // (a nested super in stmt(s) already mutated this.dbgLineDelta).
                const deltaNow = this.dbgLineDelta;
                this.dbgLineDelta = deltaBefore;
                // A nested-first super whose directive line was shifted to the block-open
                // line (ruleA via nestedFirstSuperActive) emits TWO annotations like the
                // oracle: first the super expression's OWN source line (inner), then the
                // block-open line (outer/prepended). The block-open one SHOWS; the own-line
                // one collapses (same gen-line) but it REPLACES newLstate, so the directive's
                // +1 bump lands on the own-line state — keeping the running linediff at the
                // oracle's value (listselector: for-super shows #29, own #30 absorbs the bump
                // → curLstate stays 37, NOT 38; so the following else-super's #33 directive is
                // not collapsed against an over-bumped `_forcemulti = false`).
                if (ruleA && nestedFirstSuperActive && line !== (s.line ?? line)) {
                    text = this.lnum(s.line, text, s.file);
                    text = this.lnum(line, text, s.file);
                }
                else if (ruleAFired && !nestedFirstSuperActive && line !== (s.line ?? line)) {
                    // A JOINDEPTH-1 Rule-A super emits THREE annotations like the oracle:
                    // OWN line (inner), the Rule-A-SHIFTED line (prevEndLine, middle), OWN line
                    // (outer) → stream `#own #shifted #own`. The linediff machinery picks which
                    // SHOWS: a simple-statement predecessor shows the SHIFTED line as a real
                    // directive (reverselayout addSubview: pred register@42, super@43 → `#42`);
                    // an if/else-block predecessor shows the OWN line as a BLANK line (lz/list
                    // set_height: if/else…243, super@244 → blank). For a MULTI-line simple-expr
                    // predecessor the trailing OWN annotation drives the blank-line COUNT
                    // (basetabs createChildren: push@397-400, super@401 → BLANK(3)).
                    //
                    // The oracle's generated super-dispatch EXPRESSION node carries its OWN
                    // source line on its first token, so the universal annotation stream is
                    // `#own #shifted #own (…` (verified across every super-dispatch in the
                    // -SS lineann dump: ALL are `#A #(A-1) #A (`). The TS-printed dispatch
                    // body is a bare `(…` with no leading annotation, so we must seed the
                    // INNER #own here (first lnum), then the #shifted (middle), then the
                    // OUTER #own (last) — three prepends, matching the oracle exactly.
                    text = this.lnum(s.line, text, s.file); // inner #own (body's own line)
                    text = this.lnum(line, text, s.file); // middle #shifted
                    text = this.lnum(s.line, text, s.file); // outer #own
                }
                else {
                    text = this.lnum(line, text, s.file);
                }
                this.dbgLineDelta = deltaNow;
                // A script-element `var`→assignment rewrite is wrapped by the oracle in an
                // `ASTStatement(0)` (JavascriptGenerator.rewriteScriptVars), whose own
                // `lnum` prepends a line-0 (generated) annotation BEFORE the inner
                // assignment's real-line annotation. In the translation-unit resolution
                // this line-0 wrapper emits a `/* -*- file: -*- */` reset when the file
                // context just changed away from generated (so the 2nd..N rewritten vars
                // reset to generated and their real #line is then suppressed as
                // line-same), while the FIRST stays at its real line (file changed ""→src).
                if (s.scriptVarRewrite)
                    text = annoFileLine(null, 0) + text;
                raw = unannotateStr(text);
            }
            out += sep + text;
            sep = raw.endsWith(";") ? NLsep : ";" + NLsep;
            const sStart = s.line;
            const sEnd = s.endLine;
            prevEndLine = sEnd ?? sStart ?? prevEndLine;
            prevWasShiftedSuper = ruleAFired;
            // The Rule-B cascade (every subsequent SAME-function-body source line shifts
            // by one) is a function-body-wide lexer effect — a JOINDEPTH-1 super-call's
            // substitute() reparse consumes a line. A NESTED-block first-super (the
            // block-open quirk, e.g. the for-body super in listselector select) does NOT
            // cascade dbgLineDelta onto its siblings: the oracle keeps the sibling
            // statements (`_forcemulti = false`) and the else-block's open line at their
            // OWN source lines; only the else-super itself shifts, and it does so via the
            // else-block block-open quirk (bodyOfAt threads the `} else {` line), not the
            // cascade. The linediff machinery then renders the else-super either as a
            // same-file `/* #N -*- */` directive (listselector select #33, gridtext applyData
            // #119 — a simple-statement then-branch) or as a BLANK line (basebutton set_frame
            // — the then-branch's own for-super left the running linediff one higher).
            const firedNestedFirstSuper = ruleAFired && nestedFirstSuperActive;
            // With the THREE-annotation super stream (`#own #shifted #own`, matching the
            // oracle's universal super-dispatch form — every super in the -SS lineann dump
            // is `#A #(A-1) #A (`), the follower's TRUE source line already lands correctly:
            // the old joinDepth-1 `dbgLineDelta -= 1` cascade was a COMPENSATION for the
            // MISSING inner #own and now double-shifts (it spuriously demoted reverselayout
            // addSubview's `this.update()` from #29 to #28). So the cascade fires ONLY for
            // NESTED supers (joinDepth > 1), where the 3-annotation form does not apply.
            if (ruleAFired && !firedNestedFirstSuper && this.joinDepth !== 1)
                this.dbgLineDelta -= 1; // cascade to all that follow
            prevTriggersQuirk = s.superQuirkPredecessor === true;
            prevSingleLineBlockIf = s.singleLineBlockIf === true;
            nestedFirstSuperActive = false; // only the FIRST statement gets the block-open quirk
            // A class declaration with a trailing source `;` carries an extra empty
            // statement (`class X{…};` → `Class.make(…);;`), printed as a separate `;`.
            if (s.s === "as3class" && s.semi) {
                out += sep + ";";
                sep = "";
            }
        }
        return out;
    }
    // visitCaseClause body: the DIRECT concatenation of statement strings (no
    // separator), each statement lnum-prefixed with its own source line. Unlike a
    // block's StatementList (joinStmts), a case clause does NOT insert a NEWLINE
    // between statements — the inter-statement layout comes purely from each stmt's
    // lnum once the translation-unit machinery runs. The super-call JJTree quirk
    // (joinStmts) never applies here (case bodies are nested, never joinDepth 1).
    joinCaseBody(body) {
        let out = "";
        for (const s of body) {
            let text = this.stmt(s);
            if (text === "")
                continue;
            if (this.dbg)
                text = this.lnum(s.line ?? this.dline, text, s.file);
            out += text;
        }
        return out;
    }
    // makeBlock: elide trailing ";" TWICE, wrap {\n…(\n)}. The oracle
    // (ParseTreePrinter.makeBlock:161-166) calls elideSemi on the body and then
    // elideSemi AGAIN inside the return — so a body ending in `;;` (e.g. a switch
    // whose last clause's SEMI-terminated `break;` is followed by the clause-level
    // OPTIONAL_SEMI in a debug build → `break;;`) loses BOTH semis → bare `break`.
    // The trailing-NEWLINE `}`-check uses the SINGLE-elided body (matching `body` at
    // line 166). For ordinary blocks (one trailing `;`) the second elide is a no-op.
    makeBlock(body) {
        const b = elideSemi(body);
        return "{" + NL + elideSemi(b) + (unannotateStr(b).endsWith("}") ? "" : NL) + "}";
    }
    // Force a block (used for an if-then that has an else, to avoid dangling-else).
    forceBlock(st) {
        return st.s === "block" ? this.makeBlock(this.joinStmts(st.body)) : this.makeBlock(this.joinStmts([st]));
    }
    // ensureBlock: print the body (a block statement-list prints empty→"" else
    // via makeBlock; any other statement prints as itself, no braces), then an
    // EMPTY result becomes `{}` — matching ParseTreePrinter.ensureBlock (an empty
    // statement-list prints as "" at ParseTreePrinter:304, so `if(c){}`→`{}`).
    bodyOf(st) {
        let printed;
        if (st.s === "block") {
            const joined = this.joinStmts(st.body);
            printed = elideSemi(joined) === "" ? "" : this.makeBlock(joined);
        }
        else {
            printed = this.stmt(st);
        }
        return printed === "" ? "{}" : printed;
    }
    // bodyOf, threading the enclosing control statement's source line so the block
    // body's FIRST super-call tracks at the block's open-`{` line (nested-first-super
    // JJTree quirk). `enclLine` is the control statement's own line.
    bodyOfAt(st, enclLine) {
        this.pendingBlockLine = enclLine ?? -1;
        const out = this.bodyOf(st);
        this.pendingBlockLine = -1;
        return out;
    }
    // A statement carries its own terminator: ";" for simple statements; control
    // statements end in "}" with no ";".
    stmt(st) {
        switch (st.s) {
            case "expr": return this.expr(st.e) + ";";
            case "empty": return "";
            case "var":
                return "var " + st.decls.map((d) => this.id(d.name) + (d.init ? this.SP + "=" + this.SP + this.expr(d.init) : "")).join(this.COMMA) + ";";
            case "return": {
                if (!st.e)
                    return "return;";
                // delimitWithParen (force=true): the separator is " " when the value does
                // NOT start with "(", else SPACE (" " in debug, "" in compress). So a
                // paren-led return value keeps a space in the debug build (`return (x)`)
                // but not in compress (`return(x)`). Also wrap a multiline value in parens.
                const child = this.expr(st.e);
                const hasParen = child.startsWith("(");
                let phrase = (hasParen ? this.SP : " ") + child;
                if (!hasParen && child.includes("\n"))
                    phrase = "(" + phrase + ")";
                return "return" + phrase + ";";
            }
            case "block": return this.makeBlock(this.joinStmts(st.body));
            case "if": {
                // OPENPAREN/CLOSEPAREN supply the readable-mode spacing: `if (cond) {…}`
                // (compress: `if(cond){…}`). CLOSEP = ")" + SP already delimits the block.
                const cond = "if" + this.OPENP + this.expr(st.c) + this.CLOSEP;
                if (!st.e)
                    return cond + this.bodyOfAt(st.t, st.line);
                // With an else, the then is forced to a block; the `else` is delimited by
                // SPACE, and a non-block else gets a one-space delimiter (`else if`,
                // `else return;`), a block else gets SP (ParseTreePrinter.visitIfStatement).
                // Evaluate the THEN block BEFORE the ELSE block so a then-block super's
                // Rule-B cascade (dbgLineDelta) reaches the else-block (listselector select:
                // the for-super@30 cascades −1, so the else-super@34 resolves at 33). JS
                // would otherwise evaluate the `elseB` initializer before the `forceBlock`
                // in the return, mutating the delta out of source order.
                // Thread the THEN-block's open-`{` source line (the `if` line) so a leading
                // super in the then-block tracks at it (block-open quirk — lz/list set_bgcolor:
                // `if(this._setbordercolor){`@298, super@299 → #298). The then is forced to a
                // block; pass the if's own line as the block-open line.
                this.pendingBlockLine = st.line ?? -1;
                const thenText = st.t.s === "block"
                    ? this.makeBlock(this.joinStmts(st.t.body))
                    : this.makeBlock(this.joinStmts([st.t]));
                this.pendingBlockLine = -1;
                // Thread the else-block's open-`{` source line (the `} else {` line) so the
                // else-block's FIRST super-call tracks at it (the JJTree block-open quirk —
                // same as bodyOfAt for if/for/while). The else-block uses bodyOfAt (not a bare
                // joinStmts) so a leading super resolves at the else line (listselector select
                // `} else {`@33, super@34 → #33; gridtext applyData `} else {`@119, super@120 →
                // #119). The directive-vs-blank render is decided downstream by the linediff
                // continuum: basebutton set_frame's else-super (`}} else {`@107, super@108) has
                // the same shape but its then-branch for-super left the running linediff one
                // higher, so its else-super renders as a BLANK line (own #108), not a directive.
                const elseB = st.e.s === "block"
                    ? this.SP + this.bodyOfAt(st.e, st.elseLine)
                    : " " + this.stmt(st.e);
                return cond + thenText + this.SP + "else" + elseB;
            }
            case "while": return "while" + this.OPENP + this.expr(st.c) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
            case "dowhile": return "do" + this.SP + this.bodyOfAt(st.body, st.line) + this.SP + "while" + this.OPENP + this.expr(st.c) + ")";
            case "with": return "with" + this.OPENP + this.expr(st.c) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
            case "funcdecl": {
                // A top-level funcdecl in PROGRAM context (an immediate `<script>` body
                // compiled via compileProgram, NOT the script-element transform) is
                // emitted VERBATIM as a function DECLARATION — `function name($0,$1){…}`
                // (the oracle's JavascriptGenerator emits the named decl with its body
                // scope renamed). Distinct from compileScriptBody (SCRIPT_ELEMENT=true),
                // which hoists funcdecls into `name = function(){}` assignments.
                if (this.dbg)
                    return renderDebugFuncDecl(st.name, st.fn, this.dfile ?? "", st.fn.line ?? this.dline ?? 0);
                const fscope = analyzeScope(st.fn.params, st.fn.body, false);
                const fsub = new Printer(fscope.map, this.c);
                const fcases = st.fn.params
                    .map((_, i) => (st.fn.defaults[i] != null ? `case ${i}:\n${fscope.newParams[i]}=${fsub.expr(st.fn.defaults[i])};` : null))
                    .filter((c) => c != null);
                const fprologue = fcases.length > 0 ? `switch(arguments.length){\n${fcases.join("\n")}\n\n};` : "";
                const ftext = fprologue + fsub.joinStmts(st.fn.body);
                const fblock = ftext === "" ? "{}" : fsub.makeBlock(ftext);
                return `function ${this.id(st.name)}(${fscope.newParams.join(",")})${fblock}`;
            }
            case "for": {
                // The for-header `;` stays tight in both modes (SEMI, no space).
                const init = st.init == null ? "" : "s" in st.init
                    ? this.forInit(st.init) : this.expr(st.init);
                return "for" + this.OPENP + init + ";" + (st.test ? this.expr(st.test) : "") + ";" +
                    (st.upd ? this.expr(st.upd) : "") + this.CLOSEP + this.bodyOfAt(st.body, st.line);
            }
            case "forin": {
                const head = st.varName ? "var " + this.id(st.varName) : this.expr(st.lhs);
                return "for" + this.OPENP + head + " in " + this.expr(st.obj) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
            }
            case "switch": {
                // ParseTreePrinter.visitSwitchStatement / visitCaseClause / visit-
                // DefaultClause: the switch body is the DIRECT concatenation of clause
                // strings (no separator), wrapped by makeBlock. Each clause is
                // `"case"+delimit(test)+":"+NEWLINE + (body + OPTIONAL_SEMI)` where the body
                // is the TIGHT concat of its statement strings (each statement carries its
                // own lnum) and OPTIONAL_SEMI = ";" in debug (compress=false → SEMI). The
                // whole clause is lnum-wrapped with the case/default token's source line,
                // so the inter-clause blank-line padding falls out of the translation unit
                // machinery. In compress mode the label gets a leading NEWLINE-equivalent
                // separator already handled by makeBlock; clauses are joined by NEWLINE only
                // because each clause string ends without a trailing newline.
                let body = "";
                for (const cl of st.cases) {
                    let label;
                    if (cl.test) {
                        // "case" + delimit(test) + ":": delimit(force=true) prefixes a space
                        // unless the (unannotated) test starts with "(" (ParseTreePrinter:143).
                        const t = this.expr(cl.test);
                        const plain = unannotateStr(t);
                        label = "case" + (plain.startsWith("(") ? "" : " ") + t + ":";
                    }
                    else
                        label = "default:";
                    const stmts = this.joinCaseBody(cl.body);
                    // OPTIONAL_SEMI (ParseTreePrinter:114) = NEWLINE in compress (config.compress
                    // && NEWLINE=="\n"), else SEMI. Here NEWLINE is always "\n" (obfuscate off).
                    const optSemi = this.c ? NL : ";";
                    let clause = label + NL + (stmts ? stmts + optSemi : "");
                    if (this.dbg)
                        clause = this.lnum(cl.line ?? null, clause, cl.file);
                    body += clause;
                }
                return "switch" + this.OPENP + this.expr(st.disc) + this.CLOSEP + this.makeBlock(body);
            }
            case "break": return "break;";
            case "continue": return "continue;";
            case "throw": {
                // throw + a space (unless the value starts with "(") — delimit(force).
                const child = this.expr(st.e);
                return "throw" + (child.startsWith("(") ? "" : " ") + child + ";";
            }
            case "try": {
                // try SPACE BLOCK \n catch (p)BLOCK \n finally SPACE BLOCK (ParseTree-
                // Printer.visitTryStatement: SPACE after `try`/`finally`, NEWLINE between
                // clauses, OPENPAREN/CLOSEPAREN around the catch param).
                let out = "try" + this.SP + this.bodyOf(st.block);
                if (st.handler) {
                    // The catch clause is a separate ASTCatchClause node, line-tracked at the
                    // `catch` keyword's own source line (ParseTreePrinter:470). (The GENERATED
                    // debug try/catch wrapper's catch is built separately with no real line.)
                    let cat = "catch" + this.OPENP + this.id(st.param) + this.CLOSEP + this.bodyOf(st.handler);
                    if (this.dbg && st.handlerLine !== undefined)
                        cat = this.lnum(st.handlerLine, cat, st.file);
                    out += NL + cat;
                }
                if (st.finalizer) {
                    // The `finally` clause is a separate ASTFinallyClause node, line-tracked
                    // at the `finally` keyword's own source line (ParseTreePrinter:473 →
                    // lnum(finallyNode, "finally "+block)). lzunit wrapper: finally @597.
                    let fin = "finally" + this.SP + this.bodyOf(st.finalizer);
                    if (this.dbg && st.finalizerLine !== undefined)
                        fin = this.lnum(st.finalizerLine, fin, st.file);
                    out += NL + fin;
                }
                return out;
            }
            case "as3class": return this.dbg ? this.printAs3ClassDebug(st) : this.printAs3Class(st);
        }
    }
    forInit(st) {
        if (st.s === "var")
            return "var " + st.decls.map((d) => this.id(d.name) + (d.init ? this.SP + "=" + this.SP + this.expr(d.init) : "")).join(this.COMMA);
        throw new ScUnsupported("for-init");
    }
}
// Strip annotation markers ( op operand ) from a string, leaving
// only the visible text — used wherever the Java printer inspects a phrase's
// first/last visible char (delimit, elideSemi, makeBlock end test).
function unannotateStr(s) {
    if (s.indexOf(ANNOTATE_MARKER) < 0)
        return s;
    let out = "";
    let i = 0;
    while (i < s.length) {
        if (s[i] === ANNOTATE_MARKER) {
            const end = s.indexOf(ANNOTATE_MARKER, i + 1);
            i = end < 0 ? s.length : end + 1;
        }
        else {
            out += s[i];
            i++;
        }
    }
    return out;
}
function elideSemi(s) {
    // Strip the last visible ";" even when annotations follow it (the annotations
    // are preserved). Matches ParseTreePrinter.elideSemi.
    if (!unannotateStr(s).endsWith(";"))
        return s;
    const semipos = s.lastIndexOf(";");
    return s.slice(0, semipos) + s.slice(semipos + 1);
}
function printNumber(raw) {
    if (/^0[xX]/.test(raw))
        return String(parseInt(raw, 16));
    const v = Number(raw);
    return String(v);
}
// Math.* methods the LFC guarantees are pure (no dependency function needed):
// ReferenceCollector.javaSucks. A call to one of these is collected but skipped
// when building the .concat(...) chain.
const PURE_FUNCTIONS = new Set([
    "Math.abs", "Math.acos", "Math.asin", "Math.atan", "Math.atan2", "Math.ceil",
    "Math.cos", "Math.exp", "Math.floor", "Math.log", "Math.max", "Math.min",
    "Math.pow", "Math.random", "Math.round", "Math.sin", "Math.sqrt", "Math.tan",
]);
/** Collect a constraint expression's dependency expression: a faithful port of
 *  sc's ReferenceCollector. Property references yield a base array
 *  [this,"width",parent,"x",...]; each non-pure function call R.m(args) yields a
 *  .concat($lzc$getFunctionDependencies("m",this,R,[args],null)). The base of a
 *  property ref is NOT recursed (only the outermost ref is collected) and the
 *  callee of a call is NOT recursed (consumed by fsubst). this.setAttribute is
 *  ignored. hasFree (=> with(this)) reflects the built expression's free idents
 *  ($lzc$getFunctionDependencies counts, forcing the wrapper). */
export function collectDependencies(expr) {
    const ast = foldNode(new Parser(lex(expr)).parseExpr());
    const printer = new Printer(new Map());
    const refSeen = new Set();
    const pairs = [];
    // The debug annotation (ReferenceCollector.computeReferencesDebugAnnoration):
    // the deduped list of base receiver EXPRESSIONS (as strings), in first-appearance
    // order, from the base-array pairs only — `$lzc$validateReferenceDependencies`'s
    // 2nd arg. e.g. `[classroot,"offset"]` → `["classroot"]`.
    const baseSeen = new Set();
    const bases = [];
    const fnSeen = new Set();
    const fnNodes = [];
    const addRef = (base, prop) => {
        const baseText = printer.expr(base);
        const text = baseText + "." + prop;
        if (!baseSeen.has(baseText)) {
            baseSeen.add(baseText);
            bases.push(jsString(baseText));
        }
        if (refSeen.has(text))
            return;
        refSeen.add(text);
        pairs.push(baseText + "," + jsString(prop));
    };
    const isSetAttributeOnThis = (c) => c.k === "member" && c.o.k === "this" && c.p === "setAttribute";
    const addFn = (n) => {
        const text = printer.expr(n);
        if (fnSeen.has(text))
            return;
        fnSeen.add(text);
        fnNodes.push(n);
    };
    const walk = (n) => {
        switch (n.k) {
            case "id":
                addRef({ k: "this" }, n.name);
                break;
            case "member":
                if (n.o.k === "call" && !isSetAttributeOnThis(n.o.c))
                    addFn(n.o);
                addRef(n.o, n.p);
                break;
            case "call":
                if (!isSetAttributeOnThis(n.c))
                    addFn(n);
                n.args.forEach(walk);
                break;
            case "this":
            case "num":
            case "str":
            case "lit":
            case "super": break;
            case "bin":
            case "logic":
            case "assign":
                walk(n.l);
                walk(n.r);
                break;
            case "unary":
                walk(n.e);
                break;
            case "cond":
                walk(n.c);
                walk(n.t);
                walk(n.f);
                break;
            case "paren":
                walk(n.e);
                break;
            case "cast":
                walk(n.e);
                walk(n.type);
                break;
            case "seq":
                n.es.forEach(walk);
                break;
            case "array":
                n.els.forEach(walk);
                break;
            case "object":
                n.props.forEach((p) => walk(p.v));
                break;
            case "index":
                walk(n.o);
                walk(n.i);
                break;
            case "new":
                n.args.forEach(walk);
                break;
        }
    };
    walk(ast);
    let exprStr = "[" + pairs.join(",") + "]";
    for (const call of fnNodes) {
        const callee = call.c;
        if (PURE_FUNCTIONS.has(printer.expr(callee)))
            continue;
        let receiver, method;
        if (callee.k === "member") {
            receiver = callee.o;
            method = callee.p;
        }
        else if (callee.k === "id") {
            receiver = { k: "this" };
            method = callee.name;
        }
        else
            throw new ScUnsupported("constraint dependency on a computed call");
        const args = "[" + call.args.map((a) => printer.expr(a)).join(",") + "]";
        // The 5th arg is `($debug ? (ctnm) : null)` (ReferenceCollector.fsubst:105),
        // where ctnm = the quoted source text of the callee/receiver. $debug folds to
        // the receiver text in a debug build, null in production.
        const ctnm = SC_DEBUG ? jsString(printer.expr(receiver)) : "null";
        exprStr += `.concat($lzc$getFunctionDependencies(${jsString(method)},this,${printer.expr(receiver)},${args},${ctnm}))`;
    }
    const free = new Set();
    freeVarsOfNode(foldNode(new Parser(lex(exprStr)).parseExpr()), new Set(), free);
    return { array: exprStr, hasFree: free.size > 0, annotation: "[" + bases.join(",") + "]" };
}
/** Compile a `<script>` element body to `function(){…}`. Script elements run in
 *  script scope (no `$0` renaming, no `with(this)`); top-level `var`s are hoisted
 *  to `name=void 0` and their declarations rewritten to plain assignments
 *  (sc's rewriteScriptVars + the scriptElement pragma). */
/** Rewrite a script-scope statement to strip `var` (JavascriptGenerator
 *  rewriteScriptVars): in script context every variable is a global, so a `var`
 *  declaration becomes a plain assignment (`var a,b=1,c` → `a,b=1,c`), and a
 *  for-loop's `var` init / for-in `var` head drops the `var`. Does NOT descend
 *  into nested function bodies (those keep their own locals). */
function stripVarToExpr(decls) {
    const es = decls.map((d) => d.init
        ? { k: "assign", op: "=", l: { k: "id", name: d.name }, r: d.init }
        : { k: "id", name: d.name });
    return es.length === 1 ? es[0] : { k: "seq", es };
}
function stripScriptVars(s) {
    const out = stripScriptVarsInner(s);
    // Preserve the debug source-line metadata across the var→expr rewrite (the
    // converted statement must keep its true .line/.endLine so the translation-unit
    // machinery tracks it at its actual source line, not the script element line).
    if (out !== s) {
        for (const k of ["line", "endLine", "file", "superQuirkPredecessor"]) {
            if (s[k] !== undefined && out[k] === undefined)
                out[k] = s[k];
        }
    }
    return out;
}
function stripScriptVarsInner(s) {
    switch (s.s) {
        case "var": return { s: "expr", e: stripVarToExpr(s.decls), scriptVarRewrite: true };
        case "for": {
            let init = s.init;
            if (init && "s" in init && init.s === "var")
                init = stripVarToExpr(init.decls);
            return { s: "for", init, test: s.test, upd: s.upd, body: stripScriptVars(s.body) };
        }
        case "forin":
            return s.varName
                ? { s: "forin", varName: null, lhs: { k: "id", name: s.varName }, obj: s.obj, body: stripScriptVars(s.body) }
                : { s: "forin", varName: null, lhs: s.lhs, obj: s.obj, body: stripScriptVars(s.body) };
        case "block": return { s: "block", body: s.body.map(stripScriptVars) };
        case "if": return { s: "if", c: s.c, t: stripScriptVars(s.t), e: s.e ? stripScriptVars(s.e) : null };
        case "while": return { s: "while", c: s.c, body: stripScriptVars(s.body) };
        case "dowhile": return { s: "dowhile", c: s.c, body: stripScriptVars(s.body) };
        case "with": return { s: "with", c: s.c, body: stripScriptVars(s.body) };
        case "switch":
            return { s: "switch", disc: s.disc, cases: s.cases.map((cl) => ({ test: cl.test, body: cl.body.map(stripScriptVars) })) };
        case "try":
            return { s: "try", param: s.param, block: stripScriptVars(s.block), handler: s.handler ? stripScriptVars(s.handler) : null, handlerLine: s.handlerLine, finalizer: s.finalizer ? stripScriptVars(s.finalizer) : null, finalizerLine: s.finalizerLine };
        default: return s;
    }
}
export function compileScriptBody(source) {
    const ast = foldStmts(new Parser(lex(source)).parseProgram());
    const printer = new Printer(new Map());
    // Script-element handling (JavascriptGenerator, SCRIPT_ELEMENT=true): all
    // script-scope variables AND function-declaration names become globals,
    // declared `name=void 0;` up front in declaration order (not renamed; this
    // includes vars nested in blocks/for-loops). Then the function declarations
    // are emitted as `name=function(){…};` assignments (hoisted), then the
    // remaining statements with their `var`s stripped and funcdecls removed.
    const hoistNames = collectVariables(ast);
    const funcAssigns = [];
    const rest = [];
    for (const s of ast) {
        if (s.s === "funcdecl")
            funcAssigns.push(`${s.name}=${printer.printFunc(s.fn)};`);
        else
            rest.push(stripScriptVars(s));
    }
    if (hasNestedFuncDecl(rest))
        throw new ScUnsupported("nested function declaration in script context");
    const hoist = hoistNames.map((n) => `${n}=void 0;`).join("");
    const text = hoist + funcAssigns.join("") + printer.joinStmts(rest);
    return `function()${text === "" ? "{}" : printer.makeBlock(text)}`;
}
/** Debug-build (compress=false) variant of compileScriptBody: the construction-time
 *  `<script>` instance's `script` function VALUE — the displayName-IIFE wrapping an
 *  ANONYMOUS `function ()` (ScriptElementCompiler's generated `function () {…}`),
 *  with the debug try/catch + `$reportException` wrapper (the body references
 *  globals, so it is always dereferenced/free). The displayName is the GENERATED
 *  anonymous-function name `<file>#<elementLine>/<col>` (JavascriptGenerator:1115 —
 *  `col` is the begin-column of `function` in the generated source: the element's
 *  `>` column + the fixed asMap prefix, computed by the caller). `elementLine` is
 *  the `<script>` element's source line (the directive + `$reportException` line);
 *  the body text's own leading newlines advance the lexer to the real code line.
 *  Run the result through assembleDebugProgram (it is one instance asMap value). */
export function compileScriptBodyDebug(source, file, elementLine, displayCol) {
    const ast = foldStmts(new Parser(lex(source, elementLine, file)).parseProgram());
    // Script-element transform (SCRIPT_ELEMENT=true): script-scope vars + funcdecl
    // names become globals (`name = void 0;` hoist, funcdecls → assignments), rest
    // statements have `var` stripped.
    const hoistNames = collectVariables(ast);
    const funcdecls = ast.filter((s) => s.s === "funcdecl");
    const rest = ast.filter((s) => s.s !== "funcdecl").map(stripScriptVars);
    if (hasNestedFuncDecl(rest))
        throw new ScUnsupported("nested function declaration in script context");
    // Script-scope vars are globals (not renamed); nested functions handle their own
    // scopes via printFunc, so the body printer uses an empty rename map.
    const printer = new Printer(new Map(), /*compress*/ false);
    printer.dbg = true;
    printer.dfile = file;
    printer.dline = elementLine;
    // The script-scope globals (var/funcdecl names) RESOLVE a nested function's free
    // reference, so a `++X`/`X++` on such a name inside a nested funcdecl is NOT
    // "checked" → stays plain (performance-tuning's `var j` → `j++` in
    // `globalReference`). They seed the outer-resolvable set; printFunc unions each
    // function's own locals before recursing into its descendants.
    for (const v of hoistNames)
        printer.dbgOuterVars.add(v);
    const A = (n) => annoFileLine(file, n);
    const Agen = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    const hoist = hoistNames.length
        ? hoistNames.map((n) => Agen + n + " = void 0;").join("\n")
        : "";
    // A script-scope funcdecl (`function f(){…}`) is rewritten to a global
    // assignment `f = (function(){…})();` whose RHS is the displayName-IIFE wrapper.
    // The wrapper's `(` is line-tracked at N−1 (funcLine − 1) by the JJTree
    // getToken(1)/EOL quirk (same as a source `(function…)()` statement), so the
    // assignment carries a leading source directive at `funcLine − 1`; the inner
    // displayName-IIFE directive (printFunc's S1 at funcLine) is then suppressed by
    // the translation-unit dedup (the consumed `(function () {` line aligns the
    // linediff). When the funcdecl carries no line, fall back to the generated reset.
    const funcAssigns = funcdecls.length
        ? funcdecls.map((d) => {
            const fl = d.fn.line;
            const lead = fl != null ? A(fl - 1) : Agen;
            return lead + printer.id(d.name) + " = " + printer.printFunc(d.fn) + ";";
        }).join("\n")
        : "";
    const bodyStmts = printer.joinStmts(rest);
    const lead = [hoist, funcAssigns].filter((s) => s !== "");
    const leadJoined = lead.join("\n");
    // A lead ending in `;` (the `name = void 0;` hoist / funcdecl assigns) needs only
    // a newline before the body; one not ending in `;` needs `;\n`.
    const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
    const bodyInner = lead.length
        ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "")
        : bodyStmts;
    const blockNL = (b) => (unannotateStr(b).endsWith("}") ? "" : NL);
    const elided = elideSemi(bodyInner);
    // The oracle runs VariableAnalyzer on the ORIGINAL body — `var` decls AND function
    // DECLARATIONS intact (JavascriptGenerator: `debugExceptions && (dereferenced ||
    // !free.isEmpty())`). VariableAnalyzer folds each nested function's free set into the
    // outer `used`→`free` (computeReferences: innerFree → used; free = used − available).
    // So a script whose funcdecls reference globals (databinding-$8's processReqChange /
    // loadXMLDoc closing over `Debug`/`lz`) is free → needs the try-wrapper, EVEN when the
    // top-level statements alone are not. `analyzeScope` ran over `rest` (funcdecls split
    // out, `var` stripped) so its `free` misses the funcdecls' captures; recompute `free`
    // over the FULL original `ast` (the script-scope locals — hoistNames — are declared by
    // collectVariables, so they are available → not free, matching calendar event.lzx's two
    // `var X = {…}` globals → NO try). `dereferenced` stays TOP-scope only (computeDeref
    // skips nested funcs), so the funcdecl bodies' property accesses do NOT count.
    const freeReal = computeFree([], ast);
    const needTry = computeDereferenced(ast) || freeReal.size > 0;
    let funcBlock;
    if (needTry) {
        const catchBody = debugCatchBody(file, elementLine);
        const tryWrap = "try {\n" + elided + blockNL(elided) + "}\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
        funcBlock = "{\n" + Agen + tryWrap + "}";
    }
    else {
        funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
    }
    const innerFn = A(elementLine) + "function ()" + " " + funcBlock + FB;
    const userName = file + "#" + elementLine + "/" + displayCol;
    const S1 = A(elementLine) + "var $lzsc$temp = " + innerFn + ";";
    const S2 = A(elementLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
    const S3 = A(elementLine) + "return $lzsc$temp;";
    const inner = S1 + NL + S2 + NL + elideSemi(S3);
    return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}
/** The 1-based source line of the position immediately AFTER lexing `src` from
 *  `baseLine`/`baseFile` — i.e. the line of the EOF token, honoring embedded
 *  `#file`/`#line` directives. Used to reproduce ScriptClass.toString's line
 *  arithmetic for the synthetic-constructor source line of a member-rich anon
 *  class (the constructor has no `#pragma`, so it inherits sc's current line). */
export function finalSourceLine(src, baseLine = 1, baseFile) {
    const toks = lex(src, baseLine, baseFile);
    return toks[toks.length - 1].line;
}
/** Compile a top-level script (`<script when="immediate">`) to inline statements
 *  (parse + print, no renaming, no `var` hoisting). */
export function compileProgram(source) {
    const ast = foldStmts(new Parser(lex(source)).parseProgram());
    return new Printer(new Map()).joinStmts(ast);
}
/** Debug-build (compress=false) variant of compileProgram: render each top-level
 *  statement of an immediate `<script>` as a SEPARATE annotated translation unit
 *  (so the caller's assembleDebugProgram `;`-joins them and each carries its own
 *  `/* -*- file: X#N -*- *​/` source directive). `baseLine` is the absolute line
 *  in the .lzx file where `source` begins; `filename` is the directive filename.
 *  Returns the list of annotated statement strings (one per top-level statement),
 *  ready to splice into the program's top-level-statement stream. */
export function compileProgramDebug(source, filename, baseLine) {
    const ast = foldStmts(new Parser(lex(source, baseLine, filename)).parseProgram());
    const printer = new Printer(new Map(), /*compress*/ false);
    printer.dbg = true;
    printer.dfile = filename;
    // Script-level declarations (top-level `var`/funcdecl) RESOLVE a reference from a
    // nested function — so a `++X`/`X++` on such a name is not "checked" and stays
    // plain (performance-tuning's `var j` → `j++` inside `globalReference`). Seed the
    // program printer's outer-resolvable set; printFunc then unions each function's
    // own locals for its descendants.
    for (const v of collectVariables(ast))
        printer.dbgOuterVars.add(v);
    const units = [];
    for (const s of ast) {
        const text = printer.stmt(s);
        if (text === "")
            continue;
        // A class declaration with a trailing source `;` (`class X{…};`) carries an
        // EXTRA empty-statement directive after the Class.make (gold `)()]);;/* file
        // */`). It is a separate translation unit emitting a bare `;` — assembleDebug
        // adds the make's terminating `;` (the make unit doesn't end in `;`), then this
        // `;` unit yields the second. Pushed AFTER the class unit below.
        const trailEmpty = s.s === "as3class" && s.semi;
        // A script-level AS3 `class` with body statements is already wrapped in its own
        // `{ … }` block (printAs3ClassDebug) with the make directive INSIDE the `{` — do
        // not prepend another leading directive (it would land before the `{`).
        if (text.startsWith("{")) {
            units.push(text);
            if (trailEmpty)
                units.push(";");
            continue;
        }
        // A script-level AS3 `class` Class.make tracks at the class node's begin line
        // MINUS ONE (CommonGenerator visitClassDefinition — same quirk as a `<class>`
        // element's classLine = endLine − 1).
        const dirLine = s.s === "as3class" && s.classLine != null
            ? s.classLine - 1
            : s.line ?? 0;
        // The statement may carry its OWN file context — a `<script src="md5.js">`
        // body opens with `#file md5.js`, so the embedded class/statements track the
        // SRC file name (`md5.js#14`), NOT the including .lzx (`classes/dataman.lzx`).
        // Pass it as the directive's fileOverride when it differs from the base file.
        const sfile = s.file;
        const fileOv = sfile !== undefined && sfile !== printer.dfile ? sfile : undefined;
        units.push(printer.lnum(dirLine, text, fileOv));
        if (trailEmpty)
            units.push(";");
    }
    return units;
}
/** Debug-build rendering of a `<stylesheet>` IIFE (StyleSheetCompiler.compile:
 *  `compileScript(sourceLocationDirective(element) + ";" + " (function(){…})();")`
 *  — ONE translation unit). The leading `;` (LPP-4083) is preserved as an empty
 *  statement (`;`). The IIFE expression statement's leading source directive is at
 *  `elementLine − 1` (the displayName-IIFE wrapper sits one line above the inner
 *  function — the same `classLine − 1` offset as a `<class>` Class.make / the
 *  `(`-token of a `(function(){…})()` expression statement); the inner generated
 *  `function ()` (its body, displayName, return) tracks at `elementLine`.
 *  Returns TWO translation units — the leading empty `;` statement and the IIFE
 *  (each its own makeTranslationUnits unit, so the IIFE's directive lands at the
 *  fresh-unit BOL, no leading newline: `};` + `;` + `/* file: #N *​/` + IIFE). */
export function compileStylesheetDebug(iifeSource, filename, elementLine, displayCol) {
    // The displayName of the inner generated `function ()` is `<file>#<line>/<col>`
    // where col is the `function` keyword's COLUMN in the oracle's source
    // (`<elementColno spaces>; (function…` → col = elementColno + 4). The IIFE
    // source begins ` (function…` (`function` at col 3), so pad with leading spaces
    // to shift the keyword to `displayCol`.
    const padded = " ".repeat(Math.max(0, displayCol - 3)) + iifeSource;
    // Parse with base = elementLine so the inner `function` keyword is at elementLine.
    const ast = foldStmts(new Parser(lex(padded, elementLine, filename)).parseProgram());
    const printer = new Printer(new Map(), /*compress*/ false);
    printer.dbg = true;
    printer.dfile = filename;
    // The IIFE expression statement (the only non-empty statement).
    const iife = ast.find((s) => s.s === "expr");
    if (!iife)
        throw new ScUnsupported("stylesheet: no IIFE expression");
    const text = printer.stmt(iife);
    return [";", printer.lnum(elementLine - 1, text)];
}
/** Compile a single expression (parse + print, no local renaming). Used for
 *  immediate `expression`/number-typed attribute values, which the oracle emits
 *  raw and then sc-compiles (normalizing whitespace, folding number literals). */
export function compileExpr(src) {
    const ast = foldNode(new Parser(lex(src)).parseExpr());
    return new Printer(new Map()).expr(ast);
}
/** Debug-build variant of compileExpr: render the expression compress=false
 *  (spaced object/array literals etc.). For an inline constant value (e.g. an
 *  `allocation="class"` object); carries no source-line annotation. */
export function compileExprDebug(src) {
    const ast = foldNode(new Parser(lex(src)).parseExpr());
    const p = new Printer(new Map(), /*compress*/ false);
    p.dbg = true;
    return p.expr(ast);
}
/** Compile a method/handler body to the full `function($0,…){…}` text the
 *  oracle emits as a class instance-property value. Generated methods are
 *  wrapped in `with(this){…}` when their body has free (instance) references. */
export function compileFunction(params, source, defaults = [], isMethod = true) {
    // A rest parameter (`args="...name"`) is removed from the formal list and
    // desugared to a body prologue `var name=Array.prototype.slice.call(arguments,
    // <argno>);` (CommonGenerator.translateFunctionInternal:588). The free `Array`
    // reference then forces with(this) via the normal analysis.
    const restIdx = params.findIndex((p) => p.startsWith("..."));
    if (restIdx >= 0) {
        const restName = params[restIdx].slice(3).trim();
        params = params.slice(0, restIdx);
        defaults = defaults.slice(0, restIdx);
        source = `var ${restName} = Array.prototype.slice.call(arguments, ${restIdx});\n${source}`;
    }
    const ast = foldStmts(new Parser(lex(source)).parseProgram());
    const scope = analyzeScope(params, ast, isMethod);
    const printer = new Printer(scope.map);
    // Function DECLARATIONS in the body are hoisted (JavascriptGenerator
    // translateFunctionInternal): a `var <name>;` for each (at the top), then
    // `<name>=function(…){…};` (in declaration order), then the rest of the body
    // (the declarations removed). The name is a renamed local. Nested function
    // declarations (inside blocks/if/etc.) are refused rather than miscompiled.
    const funcdecls = ast.filter((s) => s.s === "funcdecl");
    const rest = ast.filter((s) => s.s !== "funcdecl");
    if (funcdecls.length && hasNestedFuncDecl(rest))
        throw new ScUnsupported("nested function declaration");
    const hoist = funcdecls.length
        ? funcdecls.map((d) => `var ${printer.id(d.name)};`).join("") +
            funcdecls.map((d) => `${printer.id(d.name)}=${printer.printFunc(d.fn)};`).join("")
        : "";
    // Parameter-default prologue: `switch(arguments.length){case i:<reg>=<default>;…}`
    // for each parameter that has a default (the fall-through arg-count switch).
    const cases = params
        .map((_, i) => {
        if (defaults[i] === undefined)
            return null;
        // A closed param under with(this) is re-declared inside the with-block, so
        // the default switch assigns the original name (that local), not the register.
        const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
        return `case ${i}:\n${lhs}=${compileExpr(defaults[i])};`;
    })
        .filter((c) => c != null);
    const prologue = cases.length > 0 ? `switch(arguments.length){\n${cases.join("\n")}\n\n};` : "";
    const bodyText = hoist + printer.joinStmts(rest);
    let block;
    if (scope.withThis) {
        // Re-declare closed-over parameters to their original name inside the
        // with-block (so nested closures see them), then prologue, then body.
        const redecls = scope.closedRedecls.map(({ name, reg }) => `var ${name}=${reg};`).join("");
        block = printer.makeBlock("with(this)" + printer.makeBlock(redecls + prologue + bodyText));
    }
    else {
        const combined = prologue + bodyText;
        block = combined === "" ? "{}" : printer.makeBlock(combined);
    }
    return `function(${scope.newParams.join(",")})${block}`;
}
// ===================== DEBUG (readable / source-mapped) backend =====================
// Build the annotated debug rendering of a named method/handler: the
// `function  (params) {body}` (compress=false, name_$N idents, lnum source-line
// annotations, forceBlankLnum after the close) wrapped in the JavascriptGenerator
// displayName IIFE. The returned string is an ANNOTATION STREAM — run it through
// debug.translateAnnotatedUnit (or assembleDebugProgram) to get the final text.
//
// NOTE: this is the vertical-slice prover for the debug pipeline (single source
// line). The full debug build threads per-node source lines and the try/catch +
// $reportException body wrappers through every method in compile.ts; that
// integration + the 850KB-closure grind is the remaining work (see the session
// notes). withThis methods, multi-line bodies, and generated (bare-$N) params are
// handled in the printer but not yet exercised end-to-end here.
function emitDebugFunc(printer, params, body, line, named) {
    // function header: `function` + (named ? elided-name space) + OPENPAREN +
    // params + ")" + SPACE + block, then forceBlankLnum (ParseTreePrinter
    // doFunctionDeclaration). A named source function keeps the (now-empty) name
    // slot's leading space → `function  (`; anonymous → `function (`.
    const nameSlot = named ? " " : "";
    const blockText = body.length === 0 ? "{}" : printer.makeBlock(printer.joinStmts(body));
    const header = "function" + nameSlot + printer.OPENP + params.join(printer.COMMA) + ")" + printer.SP + blockText;
    return printer.lnum(line, header) + forceBlankLnum();
}
export function compileMethodDebug(userName, params, source, filename, line) {
    // Lex from the method's source line so the body's statements carry true file
    // lines (the body text begins inline after `<method …>`, i.e. on `line`).
    const ast = foldStmts(new Parser(lex(source, line, filename)).parseProgram());
    const scope = analyzeScope(params, ast, /*isMethod*/ true, undefined, /*debug*/ true);
    const printer = new Printer(scope.map, /*compress*/ false);
    printer.dbg = true;
    printer.dbgFree = scope.free;
    printer.dfile = filename;
    printer.dline = line;
    if (scope.withThis)
        throw new ScUnsupported("debug: withThis method (grind TODO)");
    const funcExpr = emitDebugFunc(printer, scope.newParams, ast, line, /*named*/ true);
    // displayName wrapper (JavascriptGenerator ~1640): wrap the named function in
    //   (function () { var $lzsc$temp = <func>; $lzsc$temp["displayName"]="name";
    //    return $lzsc$temp })()
    const S1 = printer.lnum(line, "var $lzsc$temp = " + funcExpr + ";");
    const S2 = printer.lnum(line, '$lzsc$temp["displayName"] = ' + jsString(userName) + ";");
    const S3 = printer.lnum(line, "return $lzsc$temp;");
    const inner = S1 + NL + S2 + NL + elideSemi(S3);
    const iifeFunc = "(function ()" + printer.SP + "{" + NL + inner + NL + "}" + forceBlankLnum();
    return iifeFunc + ")()";
}
/** The debug catch clause body (JavascriptGenerator:1290): report the exception
 *  (unless a declared/non-Error rethrow). `line` is the method's source line. */
function debugCatchBody(filename, line) {
    return ('if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error)' +
        ' && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' +
        jsString(filename) + ", " + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}");
}
/** The `throwsError=true` catch clause (JavascriptGenerator:1284): record declared
 *  Errors on `lz.$lzsc$thrownError` and ALWAYS rethrow (no `$reportException`).
 *  Used by constraint DEPENDENCY methods (which percolate reference errors up to
 *  applyConstraintExpr). `is Error` → the makeIsExpr ternary. */
function debugCatchBodyThrows() {
    return ('if (Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) {\n' +
        "lz.$lzsc$thrownError = $lzsc$e\n};\nthrow $lzsc$e");
}
/** Full debug rendering of a generated method/handler/setter/getter as a
 *  `Class.make` property VALUE — the JavascriptGenerator displayName IIFE
 *  wrapper around the inner `function  (params) {…}`, with the debug try/catch +
 *  `$reportException` structural wrapper (when the body is dereferenced or has
 *  free variables) and the `with (this)` wrapper (withThis methods), rendered
 *  compress=false as an annotation stream. `userName` is the displayName; `file`
 *  the .lzx filename; `methodLine` the source line of the defining element (the
 *  directive + `$reportException` line); `bodyBaseLine` the line where the body
 *  text begins (for the per-token lexer). `forceWithThis` is set for the
 *  canHaveMethods=false case (states/datapaths → a `Function` with a forced
 *  `#pragma 'withThis'`). Run the result through assembleDebugProgram. */
export function compileFunctionDebug(userName, params, source, defaults, file, methodLine, bodyBaseLine, forceWithThis = false, catchKind = "report", isMethod = true, propagateName) {
    // Rest parameter (`args="...name"`): desugar to a body prologue (compileFunction).
    const restIdx = params.findIndex((p) => p.startsWith("..."));
    let restPrologueSrc = "";
    if (restIdx >= 0) {
        const restName = params[restIdx].slice(3).trim();
        // The rest prologue is a SYNTHETIC statement at the method's line (the oracle
        // inserts it via substituteStmts at the formal-param-list line); it does NOT
        // consume a body source line. So terminate it with `;` only (NO newline) so
        // the body's first statement keeps the same source line as the prologue
        // (basewindow `close`: both `var ignore = …slice…;` and the body's
        // `setAttribute` track at #349 — no inter-statement blank).
        restPrologueSrc = `var ${restName} = Array.prototype.slice.call(arguments, ${restIdx}); `;
        params = params.slice(0, restIdx);
        defaults = defaults.slice(0, restIdx);
    }
    // A default-param switch (`switch (arguments.length){…}`, emitted below) plus a
    // rest prologue interact with line tracking: the oracle's substituteStmts parses
    // the combined `switch{…}\nvar args=…slice…` block at #line methodLine, so the
    // synthetic `var args` lands SEVERAL lines below the switch (after `}`), while the
    // ORIGINAL body keeps its true source line. The synthetic rest-prologue directive
    // then collapses (blank) but bumps the running line-state, so the body re-asserts
    // its own #line. We model this: lex the rest prologue at a HIGHER synthetic line
    // (above the body) so its directive collapses, and lex the body at its true line.
    // (extensions/html.lzx callJavascript: `var args_$2` no directive, body `return`
    // re-emits #429.) A rest-only method (no default switch, e.g. basewindow close)
    // keeps the simpler same-line model: prologue@methodLine emits #methodLine, body
    // flows under it.
    const hasDefaultSwitch = defaults.some((d) => d !== undefined);
    let restPrologueAst = [];
    let bodySource = restPrologueSrc + source;
    let bodyLexBase = bodyBaseLine;
    if (restIdx >= 0 && hasDefaultSwitch) {
        // Synthetic rest line = methodLine + switch lines (`switch{`, `case…`, `}`) = +3
        // (matches substituteStmts: switch@methodLine, case@+1, `}`@+2, `var args`@+3).
        restPrologueAst = foldStmts(new Parser(lex(restPrologueSrc, methodLine + 3, file)).parseProgram());
        bodySource = source;
        // The body keeps its true source line (bodyBaseLine = the element's start line;
        // the single-statement body `return …` is at methodLine+1, which the lexer
        // assigns from this base + the leading newline in `source`).
        bodyLexBase = bodyBaseLine;
    }
    const ast = restPrologueAst.concat(foldStmts(new Parser(lex(bodySource, bodyLexBase, file)).parseProgram()));
    const scope = analyzeScope(params, ast, isMethod, undefined, /*debug*/ true);
    const withThis = scope.withThis || (forceWithThis && (scope.dereferenced || scope.free.size > 0 || params.length === 0));
    const printer = new Printer(scope.map, /*compress*/ false);
    printer.dbg = true;
    printer.dbgFree = scope.free;
    printer.dfile = file;
    printer.dline = methodLine;
    // Pragma-bearing functions (handlers/setters/binders) propagate their pretty
    // userFunctionName into nested function values (see Printer.outerUserName).
    if (propagateName != null)
        printer.outerUserName = propagateName;
    const A = (n) => annoFileLine(file, n);
    const Agen = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    // funcdecl hoist (var name; then name = function…; — JavascriptGenerator).
    const funcdecls = ast.filter((s) => s.s === "funcdecl");
    const rest = ast.filter((s) => s.s !== "funcdecl");
    if (funcdecls.length && hasNestedFuncDecl(rest))
        throw new ScUnsupported("nested function declaration");
    // Default-param prologue: `switch (arguments.length) { case i: <reg> = <default>
    // …}` (CommonGenerator). Mirrors the constructor's switch (debugConstructor):
    // the switch keyword at `methodLine`; each `case i:` label on its own line; the
    // assignments joined `;;case j:` with NO trailing `;` on the last; the FIRST
    // assignment carries the default's source-line directive (`methodLine + 1`,
    // the formal-parameter-list line below the signature), later ones flow under it.
    const cases = params
        .map((_, i) => {
        if (defaults[i] === undefined)
            return null;
        const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
        return { i, assign: lhs + " = " + compileExpr(defaults[i]) };
    })
        .filter((c) => c != null);
    // Body statements (annotated, compress=false), preceded by closed-param
    // redeclarations (inside the with-block) + funcdecl hoist + default prologue.
    const redecls = withThis
        ? scope.closedRedecls.map(({ name, reg }) => Agen + "var " + name + " = " + reg + ";").join("\n")
        : "";
    const hoist = funcdecls.length
        ? funcdecls.map((d) => Agen + "var " + printer.id(d.name) + ";").join("\n") + "\n" +
            funcdecls.map((d) => A(methodLine) + printer.id(d.name) + " = " +
                renderDebugFuncNode(d.fn, d.name, /*named*/ true, file, d.line ?? methodLine) + ";").join("\n")
        : "";
    const prologue = cases.length > 0
        ? A(methodLine) + "switch (arguments.length) {\n" +
            cases.map((c, j) => "case " + c.i + ":\n" + (j === 0 ? A(methodLine + 1) : "") + c.assign).join(";;") +
            "\n}"
        : "";
    // Assemble the leading generated statements (redecls/hoist/prologue), then body.
    // A lead ending in `;` (redecls/hoist) needs only a newline before the body; one
    // ending in `}` (the switch prologue) needs `;\n` (statement terminator).
    const lead = [redecls, hoist, prologue].filter((s) => s !== "");
    // The try/catch wrapper is emitted iff the ANALYZED body is dereferenced or has
    // free references (JavascriptGenerator:1277). The default-param prologue
    // (`switch (arguments.length) {…}`) is part of that analyzed body, and
    // `arguments.length` is a property reference → dereferenced. So any method with
    // a default parameter is wrapped, even when the user body itself is not.
    const needTry = scope.dereferenced || scope.free.size > 0 || cases.length > 0;
    // Enable the first-statement super quirk only for unwrapped bodies with no lead
    // (the super must directly follow the function's source `{`).
    printer.dbgNoWrapper = !needTry && lead.length === 0;
    const bodyStmts = printer.joinStmts(rest);
    printer.dbgNoWrapper = false;
    const leadJoined = lead.join("\n");
    const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
    const bodyInner = lead.length
        ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "")
        : bodyStmts;
    // makeBlock interior: elide the body's trailing `;` and suppress the closing
    // newline when the body already ends in `}` (an if/while/block last statement).
    const blockNL = (b) => (unannotateStr(b).endsWith("}") ? "" : NL);
    const elided = elideSemi(bodyInner);
    let funcBlock;
    if (needTry) {
        const catchBody = catchKind === "throws" ? debugCatchBodyThrows() : debugCatchBody(file, methodLine);
        const tryWrap = "try {\n" + elided + blockNL(elided) + "}\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
        funcBlock = withThis ? "{\n" + Agen + "with (this) {\n" + tryWrap + "}}" : "{\n" + Agen + tryWrap + "}";
    }
    else {
        funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
    }
    const innerFn = A(methodLine) + "function  (" + scope.newParams.join(", ") + ")" + " " + funcBlock + FB;
    const S1 = A(methodLine) + "var $lzsc$temp = " + innerFn + ";";
    const S2 = A(methodLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
    const S3 = A(methodLine) + "return $lzsc$temp;";
    const inner = S1 + NL + S2 + NL + elideSemi(S3);
    return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}
/** Debug rendering of an id/name binder (NodeModel buildIdBinderBody): a
 *  `Function("$lzc$node, $lzc$bind=true", body)`. A Function (not a Method) renders
 *  as an ANONYMOUS function expression (`function (` — 1 space, never with(this)),
 *  carrying its displayName via the IIFE wrapper from the `#pragma userFunctionName`.
 *  So route it through renderDebugFuncNode (isMethod=false, named=false). `funcLine`
 *  is the binding element's source line; the body source is lexed from funcLine+2
 *  (the pragma sits on funcLine+1; the `if ($lzc$bind)` body opens at funcLine+2). */
export function compileBinderDebug(userName, bodySource, file, funcLine) {
    // Wrap as `function ($lzc$node, $lzc$bind=true) {<pragma+body>}` and parse.
    // Lexer base = funcLine: the `function` header sits on funcLine (line 1), the
    // `#pragma` on funcLine+1 (line 2, consumed), and the `if ($lzc$bind)` body on
    // funcLine+2 (line 3) — matching the oracle. The default-param prologue directive
    // (switch at funcLine, `$1=true` at funcLine+1) is fixed in renderDebugFuncNode.
    const src = "function ($lzc$node, $lzc$bind=true) {\n" + bodySource + "}";
    const ast = new Parser(lex(src, funcLine, file)).parseProgram();
    const fnStmt = ast[0];
    if (!fnStmt || fnStmt.s !== "expr" || fnStmt.e.k !== "func")
        throw new ScUnsupported("binder: expected a function expression");
    const fn = foldNode(fnStmt.e);
    return renderDebugFuncNode(fn, userName, /*named*/ false, file, funcLine);
}
/** Debug rendering of a NESTED function expression (a hoisted `function name(){}`
 *  declaration, or — `named=false` — an anonymous `function(){}` value): the same
 *  displayName-IIFE / try-catch / name_$N machinery as a method, but isMethod is
 *  false so it is NEVER `with(this)` (CommonGenerator: nested functions are not
 *  methods). `funcLine` is the function's own source line (used for the
 *  displayName/return/$reportException directives + its own funcdecl hoist). */
/** A top-level funcdecl STATEMENT in PROGRAM context (immediate `<script>` body)
 *  is emitted in debug as a real `function name (params) {…}` DECLARATION with the
 *  standard try/catch debug body — NOT the displayName-IIFE that wraps function
 *  VALUES. This is the inner-function half of renderDebugFuncNode, with the name
 *  preserved and no IIFE/displayName. */
function renderDebugFuncDecl(name, fn, file, funcLine) {
    return renderDebugFuncNode(fn, name, /*named*/ true, file, funcLine, "report", false, undefined, undefined, undefined, name);
}
function renderDebugFuncNode(fn, userName, named, file, funcLine, catchKind = "report", isMethod = false, as3, propagateName, outerVars, asDecl) {
    const params = fn.params;
    const ast = fn.body;
    const scope = analyzeScope(params, ast, isMethod, as3, /*debug*/ true);
    const printer = new Printer(scope.map, /*compress*/ false);
    printer.dbg = true;
    printer.dbgFree = scope.free;
    // A free reference that resolves to a name declared in an ENCLOSING scope is not
    // "checked" (no postfix/prefix IIFE expansion). This function's locals/params
    // join the outer set for ITS nested functions (threaded via printer.dbgOuterVars,
    // which printFunc unions with the local scope before recursing).
    if (outerVars)
        printer.dbgOuterVars = outerVars;
    printer.dfile = file;
    printer.dline = funcLine;
    // A `#pragma userFunctionName=` (handler/setter/binder) propagates its pretty
    // name into nested function VALUES (CodeGenerator's persistent options-copy).
    if (propagateName != null)
        printer.outerUserName = propagateName;
    const A = (n) => annoFileLine(file, n);
    const Agen = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    const funcdecls = ast.filter((s) => s.s === "funcdecl");
    const rest = ast.filter((s) => s.s !== "funcdecl");
    if (funcdecls.length && hasNestedFuncDecl(rest))
        throw new ScUnsupported("nested function declaration");
    const cases = params
        .map((_, i) => {
        if (fn.defaults[i] == null)
            return null;
        const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
        return { i, assign: lhs + " = " + printer.expr(fn.defaults[i]) };
    })
        .filter((c) => c != null);
    // An instance method whose body has free instance-property references is wrapped
    // in `with (this) { … }` (analyzeScope.withThis — set only for isMethod with a
    // resolvable/unknown instance-prop refinement). Closed-over parameters are then
    // re-declared to their original name inside the with-block.
    const withThis = scope.withThis;
    const redecls = withThis
        ? scope.closedRedecls.map(({ name, reg }) => Agen + "var " + name + " = " + reg + ";").join("\n")
        : "";
    // Nested funcdecl hoist: `var name;` (generated) then `name = <debug-func>;` at
    // THIS function's line (the assignment carries the enclosing line; the inner
    // displayName-IIFE then re-annotates the nested function's own line).
    const hoist = funcdecls.length
        ? funcdecls.map((d) => Agen + "var " + printer.id(d.name) + ";").join("\n") + "\n" +
            funcdecls.map((d) => A(funcLine) + printer.id(d.name) + " = " +
                renderDebugFuncNode(d.fn, d.name, /*named*/ true, file, d.line ?? funcLine) + ";").join("\n")
        : "";
    const prologue = cases.length > 0
        ? A(funcLine) + "switch (arguments.length) {\n" +
            cases.map((c, j) => "case " + c.i + ":\n" + (j === 0 ? A(funcLine + 1) : "") + c.assign).join(";;") +
            "\n}"
        : "";
    const lead = [redecls, hoist, prologue].filter((s) => s !== "");
    const needTry = scope.dereferenced || scope.free.size > 0 || cases.length > 0;
    printer.dbgNoWrapper = !needTry && lead.length === 0;
    const bodyStmts = printer.joinStmts(rest);
    printer.dbgNoWrapper = false;
    const leadJoined = lead.join("\n");
    const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
    const bodyInner = lead.length ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "") : bodyStmts;
    const blockNL = (b) => (unannotateStr(b).endsWith("}") ? "" : NL);
    const elided = elideSemi(bodyInner);
    let funcBlock;
    if (needTry) {
        const catchBody = catchKind === "throws" ? debugCatchBodyThrows() : debugCatchBody(file, funcLine);
        const tryWrap = "try {\n" + elided + blockNL(elided) + "}\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
        funcBlock = withThis ? "{\n" + Agen + "with (this) {\n" + tryWrap + "}}" : "{\n" + Agen + tryWrap + "}";
    }
    else {
        funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
    }
    // A funcdecl STATEMENT keeps its name and is emitted as a bare declaration
    // (`function name (params) {…}`), with no displayName-IIFE wrapper. The
    // declaration statement is terminated by a trailing newline (printableAnnotation),
    // so the program's `;` unit-separator lands on its own line (gold `}}}\n;`).
    if (asDecl != null) {
        return A(funcLine) + "function " + asDecl + " (" + scope.newParams.join(", ") + ")" + " " + funcBlock + NL;
    }
    // Named source function keeps a (now-empty) name slot → `function  (`; anon → `function (`.
    const innerFn = A(funcLine) + "function" + (named ? "  " : " ") + "(" + scope.newParams.join(", ") + ")" + " " + funcBlock + FB;
    const S1 = A(funcLine) + "var $lzsc$temp = " + innerFn + ";";
    const S2 = A(funcLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
    const S3 = A(funcLine) + "return $lzsc$temp;";
    const inner = S1 + NL + S2 + NL + elideSemi(S3);
    return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}
