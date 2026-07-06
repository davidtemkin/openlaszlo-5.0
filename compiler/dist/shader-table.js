// shader-table.ts — the shader signature table: THE single source of truth for the
// <shader> dialect's types, GLSL ES 1.00 intrinsics, constructor rules and operator
// overloads. Four consumers: the generated shader.d.ts + operator intrinsics (lzx-check),
// glsl-gen's type lattice, the shaderlib port signatures, and (deferred) the docs.
// Spec: docs/superpowers/specs/2026-07-06-shader-view-design.md ("The signature table").
export const TYPES = ["float", "vec2", "vec3", "vec4", "bool", "bvec2", "bvec3", "bvec4", "int"];
const VEC_SIZE = { float: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1, bvec2: 2, bvec3: 3, bvec4: 4, int: 1 };
const VEC_OF = { 1: "float", 2: "vec2", 3: "vec3", 4: "vec4" };
const BVEC_OF = { 1: "bool", 2: "bvec2", 3: "bvec3", 4: "bvec4" };
export const componentCount = (t) => VEC_SIZE[t] ?? 0;
export const isVec = (t) => t === "vec2" || t === "vec3" || t === "vec4";
export const isBvec = (t) => t === "bvec2" || t === "bvec3" || t === "bvec4";
// ── swizzles ──────────────────────────────────────────────────────────────────
const ALPHABETS = ["xyzw", "rgba", "stpq"];
/** Type of `recv.prop` for a swizzle property, or null when not a legal swizzle. */
export function swizzleType(recv, prop) {
    const n = componentCount(recv);
    if (n < 2 || prop.length < 1 || prop.length > 4)
        return null;
    const alpha = ALPHABETS.find((a) => a.includes(prop[0]));
    if (!alpha)
        return null;
    for (const ch of prop) {
        const i = alpha.indexOf(ch);
        if (i < 0 || i >= n)
            return null; // mixed alphabets or out of range
    }
    const table = isBvec(recv) ? BVEC_OF : VEC_OF;
    return table[prop.length] ?? null;
}
export const isRepeatedSwizzle = (prop) => new Set(prop).size !== prop.length;
// ── constructors ──────────────────────────────────────────────────────────────
/** vecN(...) typing: strict component summation, scalar broadcast, bvec→float. */
export function constructorType(name, argTypes) {
    const want = componentCount(name);
    if (argTypes.length === 0)
        return { error: "constructor requires arguments" };
    if (argTypes.length === 1 && componentCount(argTypes[0]) === 1)
        return name; // scalar broadcast
    let got = 0;
    for (const a of argTypes) {
        const c = componentCount(a);
        if (c === 0)
            return { error: `bad constructor argument type ${a}` };
        got += c;
    }
    if (got > want)
        return { error: `too many components (${got} for ${name})` };
    if (got < want)
        return { error: `too few components (${got} for ${name})` };
    return name;
}
// ── intrinsics ────────────────────────────────────────────────────────────────
const F = "float";
const genOL = (mk) => ["float", "vec2", "vec3", "vec4"].map(mk);
const vecOL = (mk) => ["vec2", "vec3", "vec4"].map(mk);
export const INTRINSICS = {
    // genType unary
    ...Object.fromEntries(["floor", "fract", "abs", "sign", "normalize", "sqrt", "exp", "log", "sin", "cos", "tan"]
        .map((n) => [n, genOL((t) => ({ params: [t], ret: t }))])),
    // genType binary + scalar-second
    ...Object.fromEntries(["mod", "min", "max", "pow", "step"].map((n) => [n, [
            ...genOL((t) => ({ params: [t, t], ret: t })),
            ...vecOL((t) => ({ params: [t, F], ret: t })),
        ]])),
    // step's scalar-FIRST form: step(edge: float, x: vec)
    step2: [], // placeholder removed below
    clamp: [
        ...genOL((t) => ({ params: [t, t, t], ret: t })),
        ...vecOL((t) => ({ params: [t, F, F], ret: t })),
    ],
    mix: [
        ...genOL((t) => ({ params: [t, t, t], ret: t })),
        ...vecOL((t) => ({ params: [t, t, F], ret: t })),
    ],
    smoothstep: [
        ...genOL((t) => ({ params: [t, t, t], ret: t })),
        ...vecOL((t) => ({ params: [F, F, t], ret: t })),
    ],
    dot: vecOL((t) => ({ params: [t, t], ret: F })).concat([{ params: [F, F], ret: F }]),
    cross: [{ params: ["vec3", "vec3"], ret: "vec3" }],
    length: genOL((t) => ({ params: [t], ret: F })),
    distance: genOL((t) => ({ params: [t, t], ret: F })),
    // comparisons → bvec
    ...Object.fromEntries(["lessThan", "lessThanEqual", "greaterThan", "greaterThanEqual", "equal", "notEqual"]
        .map((n) => [n, vecOL((t) => ({ params: [t, t], ret: BVEC_OF[componentCount(t)] }))])),
    any: ["bvec2", "bvec3", "bvec4"].map((t) => ({ params: [t], ret: "bool" })),
    all: ["bvec2", "bvec3", "bvec4"].map((t) => ({ params: [t], ret: "bool" })),
    // casts
    float: [{ params: ["int"], ret: F }, { params: ["bool"], ret: F }, { params: [F], ret: F }],
    int: [{ params: [F], ret: "int" }, { params: ["int"], ret: "int" }],
};
delete INTRINSICS.step2;
// step's scalar-first form
INTRINSICS.step.push(...vecOL((t) => ({ params: [F, t], ret: t })));
// ── operators ────────────────────────────────────────────────────────────────
const arith = () => [
    ...genOL((t) => ({ params: [t, t], ret: t })),
    ...vecOL((t) => ({ params: [t, F], ret: t })),
    ...vecOL((t) => ({ params: [F, t], ret: t })),
    { params: ["int", "int"], ret: "int" },
];
export const OPERATORS = {
    __add: arith(), __sub: arith(), __mul: arith(), __div: arith(),
    __neg: [...genOL((t) => ({ params: [t], ret: t })), { params: ["int"], ret: "int" }],
    __mod: [{ params: ["int", "int"], ret: "int" }], // float % is a dialect finding; math.mod exists
};
// ── built-ins ────────────────────────────────────────────────────────────────
export const BUILTINS = { uv: "vec2", time: "float", mouse: "vec2", size: "vec2" };
// ── shader.d.ts generation ───────────────────────────────────────────────────
const TS_OF = {
    float: "number", int: "number", bool: "boolean",
    vec2: "vec2", vec3: "vec3", vec4: "vec4", bvec2: "bvec2", bvec3: "bvec3", bvec4: "bvec4", void: "void",
};
export const tsNameOf = (t) => TS_OF[t] ?? t;
const tsOf = (t) => TS_OF[t];
function* swizzleCombos(n) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (const alpha of ALPHABETS) {
        const chars = idx.map((i) => alpha[i]);
        // lengths 1..4, all orderings incl. repeats
        let combos = [""];
        for (let len = 1; len <= 4; len++) {
            const next = [];
            for (const c of combos)
                for (const ch of chars)
                    next.push(c + ch);
            combos = next;
            yield* next;
        }
    }
}
function vecInterface(name) {
    const n = componentCount(name);
    const lines = [`interface ${name} {`];
    const seen = new Set();
    for (const prop of swizzleCombos(n)) {
        if (seen.has(prop))
            continue;
        seen.add(prop);
        const t = swizzleType(name, prop);
        if (!t)
            continue;
        const ro = isRepeatedSwizzle(prop) ? "readonly " : "";
        lines.push(`  ${ro}${prop}: ${tsOf(t)};`);
    }
    lines.push("}");
    return lines.join("\n");
}
/** The full ambient d.ts for the shader checker program. */
export function genShaderDts(uniformDecls, shaderlibDts) {
    const out = [];
    for (const v of ["vec2", "vec3", "vec4", "bvec2", "bvec3", "bvec4"])
        out.push(vecInterface(v));
    // constructors
    for (const v of ["vec2", "vec3", "vec4"]) {
        out.push(`declare function ${v}(...parts: Array<number | vec2 | vec3 | vec4 | boolean | bvec2 | bvec3 | bvec4>): ${v};`);
    }
    // intrinsics
    for (const [name, ols] of Object.entries(INTRINSICS))
        for (const o of ols)
            out.push(`declare function ${name}(${o.params.map((p, i) => `a${i}: ${tsOf(p)}`).join(", ")}): ${tsOf(o.ret)};`);
    // operator intrinsics (the rewrite pre-pass targets)
    for (const [name, ols] of Object.entries(OPERATORS))
        for (const o of ols)
            out.push(`declare function ${name}(${o.params.map((p, i) => `a${i}: ${tsOf(p)}`).join(", ")}): ${tsOf(o.ret)};`);
    // built-ins
    for (const [name, t] of Object.entries(BUILTINS))
        out.push(`declare const ${name}: ${tsOf(t)};`);
    out.push("declare var gl_FragColor: vec4;");
    if (shaderlibDts)
        out.push(shaderlibDts);
    if (uniformDecls)
        out.push(uniformDecls);
    return out.join("\n") + "\n";
}
