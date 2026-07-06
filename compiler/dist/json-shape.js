// json-shape.ts — infer a TS-renderable Shape from a JSON literal, render it,
// and walk a ParsedPath over it (spec "Compile-time typing"). Array element
// shapes merge: properties absent from some elements become OPTIONAL,
// properties present with differing types UNION. `any` is the sink type
// (empty arrays, declared-shapeless datasets).
const ANY = { kind: "prim", name: "any" };
const prim = (name) => ({ kind: "prim", name });
export function inferShape(v) {
    if (v === null)
        return prim("null");
    if (typeof v === "string")
        return prim("string");
    if (typeof v === "number")
        return prim("number");
    if (typeof v === "boolean")
        return prim("boolean");
    if (Array.isArray(v)) {
        if (v.length === 0)
            return { kind: "arr", elem: null };
        return { kind: "arr", elem: v.map(inferShape).reduce(unify) };
    }
    const props = {};
    for (const [k, val] of Object.entries(v))
        props[k] = { shape: inferShape(val), optional: false };
    return { kind: "obj", props };
}
function shapeKey(s) { return JSON.stringify(s); }
/** Merge two shapes: objects merge per-property (merged-optional), same-kind
 *  prims collapse, everything else unions (deduped). */
function unify(a, b) {
    if (shapeKey(a) === shapeKey(b))
        return a;
    if (a.kind === "obj" && b.kind === "obj") {
        const props = {};
        for (const k of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
            const pa = a.props[k], pb = b.props[k];
            if (pa && pb)
                props[k] = { shape: unify(pa.shape, pb.shape), optional: pa.optional || pb.optional };
            else
                props[k] = { shape: (pa ?? pb).shape, optional: true };
        }
        return { kind: "obj", props };
    }
    if (a.kind === "arr" && b.kind === "arr") {
        if (a.elem == null)
            return b;
        if (b.elem == null)
            return a;
        return { kind: "arr", elem: unify(a.elem, b.elem) };
    }
    const members = [...(a.kind === "union" ? a.members : [a]), ...(b.kind === "union" ? b.members : [b])];
    const seen = new Map();
    for (const m of members)
        seen.set(shapeKey(m), m);
    const out = [...seen.values()];
    return out.length === 1 ? out[0] : { kind: "union", members: out };
}
export function renderShape(s) {
    switch (s.kind) {
        case "prim": return s.name;
        case "arr": {
            const e = s.elem ? renderShape(s.elem) : "any";
            return s.elem?.kind === "union" ? `(${e})[]` : `${e}[]`;
        }
        case "union": return s.members.map(renderShape).join(" | ");
        case "obj": {
            const entries = Object.entries(s.props)
                .map(([k, p]) => `${k}${p.optional ? "?" : ""}: ${renderShape(p.shape)}`);
            return entries.length ? `{ ${entries.join("; ")} }` : "{}";
        }
    }
}
/** Walk a parsed path over a shape. Property steps require obj (or any/union
 *  containing obj); selectors require arr. `any` absorbs everything. */
export function walkShapePath(root, p) {
    let cur = root;
    for (const seg of p.segments) {
        // property step
        const stepped = stepProp(cur, seg.prop);
        if ("error" in stepped)
            return stepped;
        cur = stepped.ok;
        // selectors
        for (const sel of seg.selectors) {
            if (cur.kind === "prim" && cur.name === "any")
                continue;
            if (cur.kind !== "arr")
                return { error: `"${seg.prop}" is not an array (selector [${sel.kind}] illegal)` };
            cur = cur.elem ?? ANY;
        }
    }
    return { ok: cur };
}
function stepProp(cur, prop) {
    if (cur.kind === "prim")
        return cur.name === "any" ? { ok: ANY } : { error: `cannot select "${prop}" from ${cur.name}` };
    if (cur.kind === "arr")
        return { error: `cannot select "${prop}" from an array (use a selector first)` };
    if (cur.kind === "union") {
        const hits = [];
        for (const m of cur.members) {
            const r = stepProp(m, prop);
            if ("ok" in r)
                hits.push(r.ok);
        }
        if (!hits.length)
            return { error: `unknown property "${prop}"` };
        return { ok: hits.reduce(unify) };
    }
    const p = cur.props[prop];
    if (!p)
        return { error: `unknown property "${prop}"` };
    return { ok: p.shape };
}
