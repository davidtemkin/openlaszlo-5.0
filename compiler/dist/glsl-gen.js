// glsl-gen.ts — TS-AST → GLSL ES 1.00 fragment-shader generator for <shader> tags.
// PARSER ONLY: ts.createSourceFile — never ts.createProgram; the type lattice below plus
// the signature table (shader-table.ts) fully type the dialect, so emission works in the
// browser (injected via lz-ts) without shipping the checker. dreemgl's glslgen.js is the
// reference for operator/precedence/casting corner cases.
// Spec: docs/superpowers/specs/2026-07-06-shader-view-design.md (dialect + lattice).
import ts from "typescript";
import { INTRINSICS, OPERATORS, BUILTINS, constructorType, swizzleType, isRepeatedSwizzle, componentCount, } from "./shader-table.js";
const GLSL_UNIFORM = { number: "float", color: "vec3" };
const OP_NAME = {
    [ts.SyntaxKind.PlusToken]: "__add",
    [ts.SyntaxKind.MinusToken]: "__sub",
    [ts.SyntaxKind.AsteriskToken]: "__mul",
    [ts.SyntaxKind.SlashToken]: "__div",
    [ts.SyntaxKind.PercentToken]: "__mod",
};
const OP_GLSL = { __add: "+", __sub: "-", __mul: "*", __div: "/", __mod: "%" };
const CMP = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken]);
const EQ = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const LOGIC = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
const COMPOUND = {
    [ts.SyntaxKind.PlusEqualsToken]: "+=", [ts.SyntaxKind.MinusEqualsToken]: "-=",
    [ts.SyntaxKind.AsteriskEqualsToken]: "*=", [ts.SyntaxKind.SlashEqualsToken]: "/=",
};
const VEC_CTORS = new Set(["vec2", "vec3", "vec4"]);
const DIALECT_TYPES = new Set(["float", "vec2", "vec3", "vec4", "bool", "bvec2", "bvec3", "bvec4", "int", "number", "boolean"]);
const normType = (t) => (t === "number" ? "float" : t === "boolean" ? "bool" : t);
function pickOverload(ols, args) {
    return ols.find((o) => o.params.length === args.length && o.params.every((p, i) => p === args[i])) ?? null;
}
function createCore(input) {
    const findings = [];
    const usedUniforms = new Map();
    const usedBuiltins = new Set();
    const usedLib = new Set();
    const usedHelpers = new Set();
    const declaredUniforms = new Map(input.uniforms.map((u) => [u.name, GLSL_UNIFORM[u.lzType] ?? "float"]));
    const helperSigs = new Map(input.helpers.map((h) => [h.name, {
            params: h.params.map((p) => normType(p.type)), ret: normType(h.ret),
        }]));
    const lineOf = (ctx, node) => ctx.srcLine + ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line;
    const bad = (ctx, node, message) => {
        findings.push({ message, line: lineOf(ctx, node) });
        return "float"; // poison-resistant: keep going to collect more findings
    };
    const lookup = (ctx, name) => {
        for (let i = ctx.env.length - 1; i >= 0; i--) {
            const t = ctx.env[i].get(name);
            if (t)
                return t;
        }
        return null;
    };
    // ── typing + emission (one pass; emit returns GLSL text, typing accumulates) ──
    function expr(ctx, e) {
        if (ts.isParenthesizedExpression(e)) {
            const r = expr(ctx, e.expression);
            return { t: r.t, s: `(${r.s})` };
        }
        if (ts.isNumericLiteral(e)) {
            const txt = e.text;
            return { t: "float", s: /[.eE]/.test(txt) ? txt : txt + ".0" };
        }
        if (e.kind === ts.SyntaxKind.TrueKeyword)
            return { t: "bool", s: "true" };
        if (e.kind === ts.SyntaxKind.FalseKeyword)
            return { t: "bool", s: "false" };
        if (ts.isStringLiteralLike(e) || ts.isTemplateExpression(e))
            return { t: bad(ctx, e, "strings are not expressible in GLSL"), s: "0.0" };
        if (ts.isArrayLiteralExpression(e))
            return { t: bad(ctx, e, "arrays are not expressible in GLSL"), s: "0.0" };
        if (ts.isObjectLiteralExpression(e))
            return { t: bad(ctx, e, "objects are not expressible in GLSL"), s: "0.0" };
        if (ts.isIdentifier(e)) {
            const name = e.text;
            const local = lookup(ctx, name);
            if (local)
                return { t: local, s: name };
            if (name in BUILTINS) {
                usedBuiltins.add(name);
                return { t: BUILTINS[name], s: name };
            }
            return { t: bad(ctx, e, `unresolved identifier '${name}'`), s: name };
        }
        if (ts.isPropertyAccessExpression(e)) {
            const prop = e.name.text;
            // this.<uniform>
            if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
                const g = declaredUniforms.get(prop);
                if (!g)
                    return { t: bad(ctx, e, `undeclared uniform 'this.${prop}' — declare <attribute name="${prop}">`), s: prop };
                usedUniforms.set(prop, g);
                return { t: g === "float" ? "float" : "vec3", s: prop };
            }
            // namespace call receiver (ns.fn handled in CallExpression); here: swizzle or lib constant
            if (ts.isIdentifier(e.expression) && input.shaderlib && !lookup(ctx, e.expression.text)
                && !(e.expression.text in BUILTINS)) {
                const key = `${e.expression.text}.${prop}`;
                const sig = input.shaderlib.signatures[key];
                if (sig && sig.params.length === 0) { // constant-style — not used today, but harmless
                    usedLib.add(key);
                    return { t: normType(sig.ret), s: `${e.expression.text}_${prop}` };
                }
            }
            const recv = expr(ctx, e.expression);
            const st = swizzleType(recv.t, prop);
            if (!st)
                return { t: bad(ctx, e, `'.${prop}' is not a component of ${recv.t}`), s: `${recv.s}.${prop}` };
            return { t: st, s: `${recv.s}.${prop}` };
        }
        if (ts.isCallExpression(e))
            return call(ctx, e);
        if (ts.isPrefixUnaryExpression(e)) {
            const r = expr(ctx, e.operand);
            if (e.operator === ts.SyntaxKind.MinusToken) {
                const ol = pickOverload(OPERATORS.__neg, [r.t]);
                if (!ol)
                    return { t: bad(ctx, e, `unary '-' not defined on ${r.t}`), s: `-${r.s}` };
                return { t: ol.ret, s: `-${r.s}` };
            }
            if (e.operator === ts.SyntaxKind.ExclamationToken) {
                if (r.t !== "bool")
                    return { t: bad(ctx, e, `'!' requires bool, got ${r.t}`), s: `!${r.s}` };
                return { t: "bool", s: `!${r.s}` };
            }
            if (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)
                return { t: r.t, s: `${e.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"}${r.s}` };
            return { t: bad(ctx, e, "unsupported unary operator"), s: r.s };
        }
        if (ts.isPostfixUnaryExpression(e)) {
            const r = expr(ctx, e.operand);
            return { t: r.t, s: `${r.s}${e.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"}` };
        }
        if (ts.isConditionalExpression(e)) {
            const c = expr(ctx, e.condition), a = expr(ctx, e.whenTrue), b = expr(ctx, e.whenFalse);
            if (c.t !== "bool")
                bad(ctx, e.condition, `ternary condition must be bool, got ${c.t}`);
            if (a.t !== b.t)
                bad(ctx, e, `ternary arms differ: ${a.t} vs ${b.t}`);
            return { t: a.t, s: `${c.s} ? ${a.s} : ${b.s}` };
        }
        if (ts.isBinaryExpression(e))
            return binary(ctx, e);
        if (e.kind === ts.SyntaxKind.NewExpression)
            return { t: bad(ctx, e, "'new' is not expressible in GLSL"), s: "0.0" };
        return { t: bad(ctx, e, `unsupported expression (${ts.SyntaxKind[e.kind]})`), s: "0.0" };
    }
    function binary(ctx, e) {
        const k = e.operatorToken.kind;
        // assignment (incl. chained) and compound assignment as expressions
        if (k === ts.SyntaxKind.EqualsToken) {
            const target = assignTarget(ctx, e.left);
            const rhs = expr(ctx, e.right);
            if (target.t !== rhs.t && target.ok)
                bad(ctx, e, `cannot assign ${rhs.t} to ${target.t}`);
            return { t: rhs.t, s: `${target.s} = ${rhs.s}` };
        }
        const comp = COMPOUND[k];
        if (comp) {
            const target = assignTarget(ctx, e.left);
            const rhs = expr(ctx, e.right);
            const opName = { "+=": "__add", "-=": "__sub", "*=": "__mul", "/=": "__div" }[comp];
            if (target.ok && !pickOverload(OPERATORS[opName], [target.t, rhs.t]))
                bad(ctx, e, `'${comp}' operand mismatch: ${target.t} ${comp} ${rhs.t}`);
            return { t: target.t, s: `${target.s} ${comp} ${rhs.s}` };
        }
        const a = expr(ctx, e.left), b = expr(ctx, e.right);
        const op = OP_NAME[k];
        if (op) {
            if (op === "__mod" && (a.t === "float" || b.t === "float"))
                return { t: bad(ctx, e, "'%' has no float form in GLSL ES — use math.mod()"), s: `${a.s} % ${b.s}` };
            // int-meets-float: auto-insert float() around the int side (spec: casts inserted)
            let at = a.t, bt = b.t, as_ = a.s, bs = b.s;
            if (at === "int" && (bt === "float" || componentCount(bt) > 1)) {
                as_ = `float(${as_})`;
                at = "float";
            }
            if (bt === "int" && (at === "float" || componentCount(at) > 1)) {
                bs = `float(${bs})`;
                bt = "float";
            }
            const ol = pickOverload(OPERATORS[op], [at, bt]);
            if (!ol)
                return { t: bad(ctx, e, `operand mismatch: ${a.t} ${OP_GLSL[op]} ${b.t}`), s: `${as_} ${OP_GLSL[op]} ${bs}` };
            return { t: ol.ret, s: `${as_} ${OP_GLSL[op]} ${bs}` };
        }
        if (CMP.has(k)) {
            if (!["float", "int"].includes(a.t) || !["float", "int"].includes(b.t))
                bad(ctx, e, `comparison needs scalars (use lessThan() family for vectors), got ${a.t}/${b.t}`);
            return { t: "bool", s: `${a.s} ${e.operatorToken.getText(ctx.sf).replace("===", "==").replace("!==", "!=")} ${b.s}` };
        }
        if (EQ.has(k)) {
            if (componentCount(a.t) > 1)
                bad(ctx, e, `'=='/'!=' on vectors is not portable — use equal()/notEqual()`);
            const opTxt = (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken) ? "==" : "!=";
            return { t: "bool", s: `${a.s} ${opTxt} ${b.s}` };
        }
        if (LOGIC.has(k)) {
            if (a.t !== "bool" || b.t !== "bool")
                bad(ctx, e, `logical operator needs bools, got ${a.t}/${b.t}`);
            return { t: "bool", s: `${a.s} ${k === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||"} ${b.s}` };
        }
        return { t: bad(ctx, e, `unsupported operator '${e.operatorToken.getText(ctx.sf)}'`), s: `${a.s} ? ${b.s}` };
    }
    function assignTarget(ctx, e) {
        if (ts.isIdentifier(e)) {
            const t = lookup(ctx, e.text);
            if (!t)
                return { t: bad(ctx, e, `assignment to unresolved '${e.text}'`), s: e.text, ok: false };
            return { t, s: e.text, ok: true };
        }
        if (ts.isPropertyAccessExpression(e)) {
            const prop = e.name.text;
            const recv = expr(ctx, e.expression);
            if (isRepeatedSwizzle(prop) && swizzleType(recv.t, prop))
                return { t: bad(ctx, e, `swizzle write with repeated components '.${prop}' is illegal GLSL`), s: `${recv.s}.${prop}`, ok: false };
            const st = swizzleType(recv.t, prop);
            if (!st)
                return { t: bad(ctx, e, `'.${prop}' is not a component of ${recv.t}`), s: `${recv.s}.${prop}`, ok: false };
            return { t: st, s: `${recv.s}.${prop}`, ok: true };
        }
        return { t: bad(ctx, e, "unsupported assignment target"), s: "0.0", ok: false };
    }
    function call(ctx, e) {
        // namespace lib call: ns.fn(args)
        if (ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)) {
            const ns = e.expression.expression.text, fn = e.expression.name.text;
            if (input.shaderlib && !lookup(ctx, ns) && !(ns in BUILTINS)) {
                const key = `${ns}.${fn}`;
                const sig = input.shaderlib.signatures[key];
                if (!sig)
                    return { t: bad(ctx, e, `unknown shaderlib function '${key}'`), s: "0.0" };
                const args = e.arguments.map((a) => expr(ctx, a));
                if (args.length !== sig.params.length)
                    bad(ctx, e, `'${key}' expects ${sig.params.length} args, got ${args.length}`);
                else
                    args.forEach((a, i) => { if (a.t !== normType(sig.params[i]))
                        bad(ctx, e.arguments[i], `'${key}' arg ${i + 1}: expected ${sig.params[i]}, got ${a.t}`); });
                usedLib.add(key);
                return { t: normType(sig.ret), s: `${ns}_${fn}(${args.map((a) => a.s).join(", ")})` };
            }
        }
        if (!ts.isIdentifier(e.expression))
            return { t: bad(ctx, e, "unsupported call form"), s: "0.0" };
        const name = e.expression.text;
        const args = e.arguments.map((a) => expr(ctx, a));
        if (VEC_CTORS.has(name)) {
            const r = constructorType(name, args.map((a) => a.t));
            if (typeof r !== "string")
                return { t: bad(ctx, e, `${name}(): ${r.error}`), s: `${name}(${args.map((a) => a.s).join(", ")})` };
            return { t: r, s: `${name}(${args.map((a) => a.s).join(", ")})` };
        }
        const intr = INTRINSICS[name];
        if (intr) {
            const ol = pickOverload(intr, args.map((a) => a.t));
            if (!ol)
                return { t: bad(ctx, e, `no overload of ${name}(${args.map((a) => a.t).join(", ")})`), s: `${name}(${args.map((a) => a.s).join(", ")})` };
            return { t: ol.ret, s: `${name}(${args.map((a) => a.s).join(", ")})` };
        }
        const helper = helperSigs.get(name);
        if (helper) {
            if (name === ctx.fnName)
                bad(ctx, e, `recursion ('${name}' calls itself) is illegal GLSL`);
            if (args.length !== helper.params.length)
                bad(ctx, e, `'${name}' expects ${helper.params.length} args, got ${args.length}`);
            else
                args.forEach((a, i) => { if (a.t !== helper.params[i])
                    bad(ctx, e.arguments[i], `'${name}' arg ${i + 1}: expected ${helper.params[i]}, got ${a.t}`); });
            usedHelpers.add(name);
            return { t: helper.ret, s: `${name}(${args.map((a) => a.s).join(", ")})` };
        }
        return { t: bad(ctx, e, `unknown function '${name}'`), s: `${name}(${args.map((a) => a.s).join(", ")})` };
    }
    function stmt(ctx, s, out, indent) {
        if (ts.isVariableStatement(s)) {
            for (const d of s.declarationList.declarations) {
                if (!ts.isIdentifier(d.name)) {
                    bad(ctx, d, "destructuring is not expressible in GLSL");
                    continue;
                }
                const declared = d.type ? d.type.getText(ctx.sf) : null;
                if (declared && !DIALECT_TYPES.has(declared)) {
                    bad(ctx, d, `type '${declared}' is outside the shader dialect`);
                    continue;
                }
                if (!d.initializer) {
                    bad(ctx, d, "declarations need initializers");
                    continue;
                }
                const r = expr(ctx, d.initializer);
                const t = declared ? normType(declared) : r.t;
                if (declared && normType(declared) !== r.t)
                    bad(ctx, d, `cannot initialize ${declared} with ${r.t}`);
                ctx.env[ctx.env.length - 1].set(d.name.text, t);
                out.push(`${indent}${t} ${d.name.text} = ${r.s};`);
            }
            return;
        }
        if (ts.isExpressionStatement(s)) {
            const r = expr(ctx, s.expression);
            // chained assignment needs parens in strict GLSL? assignment is right-assoc expression; emit as-is
            out.push(`${indent}${r.s};`);
            return;
        }
        if (ts.isReturnStatement(s)) {
            if (!s.expression) {
                bad(ctx, s, "return needs a value");
                return;
            }
            const r = expr(ctx, s.expression);
            if (r.t !== ctx.ret)
                bad(ctx, s, `${ctx.fnName}() must return ${ctx.ret}, got ${r.t}`);
            out.push(`${indent}return ${r.s};`);
            return;
        }
        if (ts.isIfStatement(s)) {
            const c = expr(ctx, s.expression);
            if (c.t !== "bool")
                bad(ctx, s.expression, `if condition must be bool, got ${c.t}`);
            out.push(`${indent}if (${c.s}) {`);
            block(ctx, s.thenStatement, out, indent + "  ");
            if (s.elseStatement) {
                out.push(`${indent}} else {`);
                block(ctx, s.elseStatement, out, indent + "  ");
            }
            out.push(`${indent}}`);
            return;
        }
        if (ts.isForStatement(s)) {
            // canonical: for (let i = 0; i < LITERAL; i++)
            let header = null;
            const init = s.initializer;
            if (init && ts.isVariableDeclarationList(init) && init.declarations.length === 1) {
                const d = init.declarations[0];
                if (ts.isIdentifier(d.name) && d.initializer && ts.isNumericLiteral(d.initializer)) {
                    const iv = d.name.text;
                    const cond = s.condition;
                    if (cond && ts.isBinaryExpression(cond) && ts.isIdentifier(cond.left) && cond.left.text === iv) {
                        if (!ts.isNumericLiteral(cond.right)) {
                            bad(ctx, cond.right, "loop bound must be a literal constant (GLSL ES 1.00 Appendix A)");
                        }
                        const boundTxt = ts.isNumericLiteral(cond.right) ? cond.right.text : "0";
                        const opTxt = cond.operatorToken.getText(ctx.sf);
                        const inc = s.incrementor;
                        const incTxt = inc && (ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc))
                            ? `${iv}++` : inc ? inc.getText(ctx.sf) : `${iv}++`;
                        ctx.env.push(new Map([[iv, "int"]]));
                        header = `for (int ${iv} = ${d.initializer.text}; ${iv} ${opTxt} ${boundTxt}; ${incTxt})`;
                    }
                }
            }
            if (!header) {
                bad(ctx, s, "only canonical int-counter for loops are expressible (for (let i = 0; i < N; i++))");
                return;
            }
            out.push(`${indent}${header} {`);
            block(ctx, s.statement, out, indent + "  ");
            ctx.env.pop();
            out.push(`${indent}}`);
            return;
        }
        if (ts.isWhileStatement(s) || ts.isDoStatement(s)) {
            bad(ctx, s, "'while' loops are not expressible (GLSL ES 1.00)");
            return;
        }
        if (ts.isBlock(s)) {
            block(ctx, s, out, indent);
            return;
        }
        if (ts.isTryStatement(s)) {
            bad(ctx, s, "'try' is not expressible in GLSL");
            return;
        }
        bad(ctx, s, `unsupported statement (${ts.SyntaxKind[s.kind]})`);
    }
    function block(ctx, s, out, indent) {
        ctx.env.push(new Map());
        if (ts.isBlock(s))
            for (const st of s.statements)
                stmt(ctx, st, out, indent);
        else
            stmt(ctx, s, out, indent);
        ctx.env.pop();
    }
    function genFunction(name, params, ret, code, srcLine) {
        const sf = ts.createSourceFile("b.ts", code, ts.ScriptTarget.ES2020, true);
        const ctx = { sf, srcLine, env: [new Map(params.map((p) => [p.name, p.type]))], fnName: name, ret };
        const out = [];
        for (const s of sf.statements)
            stmt(ctx, s, out, "  ");
        const glslRet = ret === "float" ? "float" : ret;
        return `${glslRet} ${name}(${params.map((p) => `${p.type} ${p.name}`).join(", ")}) {\n${out.join("\n")}\n}`;
    }
    return { findings, usedUniforms, usedBuiltins, usedLib, usedHelpers, genFunction };
}
/** Transpile ONE shaderlib function (ns-qualified calls resolved via `signatures`).
 *  Used by shaderlib-port; emits the mangled `ns_name` GLSL function + its lib deps. */
export function generateLibFunction(ns, name, params, ret, code, srcLine, signatures) {
    const core = createCore({
        color: { code: "", srcLine: 1 }, helpers: [], uniforms: [],
        shaderlib: { signatures, glslFor: () => "" },
    });
    const glsl = core.genFunction(`${ns}_${name}`, params.map((p) => ({ name: p.name, type: (p.type === "number" ? "float" : p.type === "boolean" ? "bool" : p.type) })), (ret === "number" ? "float" : ret === "boolean" ? "bool" : ret), code, srcLine);
    return { glsl, deps: [...core.usedLib], findings: core.findings };
}
export function generateShader(input) {
    const { findings, usedUniforms, usedBuiltins, usedLib, usedHelpers, genFunction } = createCore(input);
    // color() first (drives usage collection), then reachable helpers.
    const colorFn = genFunction("color", [], "vec4", input.color.code, input.color.srcLine);
    const helperFns = [];
    // helpers may call helpers: iterate to fixpoint
    let prev = -1;
    const emitted = new Map();
    while (usedHelpers.size !== prev) {
        prev = usedHelpers.size;
        for (const h of input.helpers) {
            if (!usedHelpers.has(h.name) || emitted.has(h.name))
                continue;
            const badParam = h.params.find((p) => !DIALECT_TYPES.has(p.type));
            if (badParam) {
                findings.push({ message: `helper '${h.name}' param '${badParam.name}': type '${badParam.type}' outside the dialect`, line: h.srcLine });
                continue;
            }
            emitted.set(h.name, genFunction(h.name, h.params.map((p) => ({ name: p.name, type: normType(p.type) })), normType(h.ret), h.code, h.srcLine));
        }
    }
    // topological-ish: emit in input order (helpers may only call previously-defined in GLSL;
    // emit all reachable, order by dependency via simple repetition — GLSL needs declaration
    // before use, so emit in input order which the author controls; forward calls are findings
    // via the recursion/unknown checks at parse time only if truly undefined).
    for (const h of input.helpers)
        if (emitted.has(h.name))
            helperFns.push(emitted.get(h.name));
    if (findings.length)
        return { ok: false, findings };
    const parts = ["precision mediump float;"];
    if (usedBuiltins.has("uv"))
        parts.push("varying vec2 uv;");
    if (usedBuiltins.has("time"))
        parts.push("uniform float time;");
    if (usedBuiltins.has("mouse"))
        parts.push("uniform vec2 mouse;");
    if (usedBuiltins.has("size"))
        parts.push("uniform vec2 size;");
    for (const [name, g] of usedUniforms)
        parts.push(`uniform ${g} ${name};`);
    if (usedLib.size && input.shaderlib)
        parts.push(input.shaderlib.glslFor([...usedLib]));
    parts.push(...helperFns);
    parts.push(colorFn);
    parts.push("void main() {\n  gl_FragColor = color();\n}");
    return {
        ok: true,
        program: {
            glsl: parts.join("\n"),
            uniforms: [...usedUniforms].map(([name, glslType]) => ({ name, glslType })),
            usesTime: usedBuiltins.has("time"),
            usesMouse: usedBuiltins.has("mouse"),
        },
    };
}
// ── operator-rewrite pre-pass (lzx-check side) ────────────────────────────────
// Arithmetic + unary minus → __op(...) calls so the TS checker infers REAL vec types
// (suppressing operator diagnostics would leave inferred `number` poisoning everything
// downstream — the round-2 spec finding). Line-preserving by construction: pure intra-
// line span splices. Comparisons/logical/assignments are left alone (they type fine).
export function rewriteOperators(code) {
    const sf = ts.createSourceFile("r.ts", code, ts.ScriptTarget.ES2020, true);
    const splices = [];
    function textOf(n) {
        // Apply nested splices within n's range — OUTERMOST only: a contained splice's
        // text is already folded into its container's text, and applying both
        // double-splices (depth-3+ operator chains corrupted before this filter —
        // see the "fold once" regression test).
        let s = code.slice(n.getStart(sf), n.end);
        const base = n.getStart(sf);
        const within = splices.filter((sp) => sp.start >= base && sp.end <= n.end);
        const outer = within
            .filter((sp) => !within.some((o) => o !== sp && o.start <= sp.start && o.end >= sp.end))
            .sort((a, b) => b.start - a.start);
        for (const sp of outer)
            s = s.slice(0, sp.start - base) + sp.text + s.slice(sp.end - base);
        return s;
    }
    function visit(n) {
        ts.forEachChild(n, visit); // children first (bottom-up splices)
        if (ts.isBinaryExpression(n)) {
            const op = OP_NAME[n.operatorToken.kind];
            if (op) {
                const left = textOf(n.left), right = textOf(n.right);
                splices.push({ start: n.getStart(sf), end: n.end, text: `${op}(${left}, ${right})` });
            }
        }
        else if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken
            && !ts.isNumericLiteral(n.operand)) {
            splices.push({ start: n.getStart(sf), end: n.end, text: `__neg(${textOf(n.operand)})` });
        }
    }
    visit(sf);
    // keep only OUTERMOST splices (inner ones are already folded into outer text)
    const outer = splices.filter((sp) => !splices.some((o) => o !== sp && o.start <= sp.start && o.end >= sp.end));
    outer.sort((a, b) => b.start - a.start);
    let out = code;
    for (const sp of outer)
        out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
    if (out.split("\n").length !== code.split("\n").length)
        throw new Error("rewriteOperators: line count changed (bug)");
    return { code: out };
}
