// shaderlib-port.ts — loads the curated shaderlib port (compiler/shaderlib/*.ts, embedded
// as string constants by gen:shaderlib) and exposes typed signatures + reachable-GLSL
// emission for glsl-gen. Two-phase: signatures from declarations first, then every body
// transpiles against the full map (intra- and cross-namespace calls are ns-qualified).
// v1 deferral (documented): noiselib's cell3w (mechanical 9-point variant, no consumer)
// and mathlib's macro-constants (their one consumer, drawField, is excluded).
import ts from "typescript";
import { generateLibFunction } from "./glsl-gen.js";
import { SHADERLIB_SOURCES } from "./shaderlib-sources.js";
function parseLib(ns, src) {
    const sf = ts.createSourceFile(ns + ".ts", src, ts.ScriptTarget.ES2020, true);
    const fns = [];
    for (const st of sf.statements) {
        if (!ts.isFunctionDeclaration(st) || !st.name || !st.body)
            continue;
        const params = st.parameters.map((p) => ({
            name: p.name.text,
            type: p.type ? p.type.getText(sf) : "float",
        }));
        const ret = st.type ? st.type.getText(sf) : "float";
        // body statements text (inside the braces), line-anchored
        const open = st.body.getStart(sf) + 1;
        const code = src.slice(open, st.body.end - 1);
        const srcLine = sf.getLineAndCharacterOfPosition(st.body.getStart(sf)).line + 1;
        fns.push({ ns, name: st.name.text, params, ret, code, srcLine });
    }
    return fns;
}
let cached = null;
export function loadShaderlib(sources = SHADERLIB_SOURCES) {
    if (cached && sources === SHADERLIB_SOURCES)
        return cached;
    const namespaces = Object.keys(sources);
    const all = [];
    for (const ns of namespaces)
        all.push(...parseLib(ns, sources[ns]));
    const signatures = {};
    for (const f of all)
        signatures[`${f.ns}.${f.name}`] = { params: f.params.map((p) => p.type), ret: f.ret };
    const findings = [];
    const glsl = new Map();
    for (const f of all) {
        const r = generateLibFunction(f.ns, f.name, f.params, f.ret, f.code, f.srcLine, signatures);
        findings.push(...r.findings.map((x) => ({ ...x, message: `[${f.ns}.${f.name}] ${x.message}` })));
        glsl.set(`${f.ns}.${f.name}`, { text: r.glsl, deps: r.deps });
    }
    const lib = {
        namespaces, signatures, findings,
        glslFor(reachable) {
            // transitive closure, deps-first (DFS postorder)
            const out = [];
            const seen = new Set();
            const visit = (key) => {
                if (seen.has(key))
                    return;
                seen.add(key);
                const e = glsl.get(key);
                if (!e)
                    return;
                for (const d of e.deps)
                    visit(d);
                out.push(e.text);
            };
            for (const k of reachable)
                visit(k);
            return out.join("\n");
        },
    };
    if (sources === SHADERLIB_SOURCES)
        cached = lib;
    return lib;
}
