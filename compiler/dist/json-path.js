// json-path.ts — dreem's JSONPath slash dialect (spec: docs/superpowers/specs/
// 2026-07-06-json-databinding-design.md, "Path dialect"). Pure functions,
// consumed by the compiler (validation/typing), the browser runtime
// (json-runtime.ts), and the server relay (pointer updates). ONE grammar,
// three consumers — they cannot disagree.
export class JsonPathError extends Error {
}
// $name, $name/..., $name[... — but NOT ${…}/$once{…} constraint syntax.
const ABS_RE = /^\$([A-Za-z_]\w*)([\/\[]|$)/;
export function isJsonAbsolutePath(s) {
    const m = ABS_RE.exec(s);
    return !!m && !/^\$\w*\{/.test(s);
}
const INT_RE = /^-?\d+$/;
export function parsePath(path) {
    let dataset = null;
    let rest = path;
    if (path.startsWith("$")) {
        const m = /^\$([A-Za-z_]\w*)/.exec(path);
        if (!m)
            throw new JsonPathError(`bad dataset reference in "${path}"`);
        dataset = m[1];
        rest = path.slice(m[0].length);
    }
    else if (!path.startsWith("/")) {
        throw new JsonPathError(`path must be $dataset-absolute or /relative: "${path}"`);
    }
    const segments = [];
    let filter = false;
    if (rest !== "") {
        if (!rest.startsWith("/"))
            throw new JsonPathError(`expected "/" after dataset in "${path}"`);
        for (const seg of rest.slice(1).split("/")) {
            if (filter)
                throw new JsonPathError(`[@] must be terminal in "${path}"`); // a previous segment set it
            const m = /^([^\[\]]+)((?:\[[^\]]*\])*)$/.exec(seg);
            if (!m || m[1] === "")
                throw new JsonPathError(`empty or malformed segment in "${path}"`);
            const selectors = [];
            for (const [, body] of m[2].matchAll(/\[([^\]]*)\]/g)) {
                if (filter)
                    throw new JsonPathError(`[@] must be terminal in "${path}"`);
                if (body === "*")
                    selectors.push({ kind: "wild" });
                else if (body === "@")
                    filter = true;
                else if (INT_RE.test(body))
                    selectors.push({ kind: "index", i: parseInt(body, 10) });
                else {
                    const parts = body.split(",").map((s) => s.trim());
                    if ((parts.length === 2 || parts.length === 3) && parts.every((p) => INT_RE.test(p)))
                        selectors.push({ kind: "range", start: +parts[0], end: +parts[1], step: parts[2] != null ? +parts[2] : 1 });
                    else
                        throw new JsonPathError(`bad selector [${body}] in "${path}"`);
                }
            }
            segments.push({ prop: m[1], selectors });
        }
    }
    // trailing [@] with no property is not addressable in this dialect
    if (filter && segments.length === 0)
        throw new JsonPathError(`[@] needs a path in "${path}"`);
    return { dataset, segments, filter };
}
export function hasFanout(p) {
    return p.segments.some((s) => s.selectors.some((x) => x.kind !== "index"));
}
export function evaluatePath(root, p, filterFn) {
    if (root == null)
        return [];
    let cur = [root];
    for (const seg of p.segments) {
        const next = [];
        for (const v of cur) {
            if (v == null || typeof v !== "object")
                continue;
            let vals = [v[seg.prop]];
            for (const sel of seg.selectors) {
                const out = [];
                for (const x of vals) {
                    if (!Array.isArray(x))
                        continue; // selectors fan arrays only
                    if (sel.kind === "wild")
                        out.push(...x);
                    else if (sel.kind === "index") {
                        if (sel.i >= 0 && sel.i < x.length)
                            out.push(x[sel.i]);
                    }
                    else if (sel.step > 0)
                        for (let i = sel.start; i < sel.end && i < x.length; i += sel.step)
                            out.push(x[i]);
                }
                vals = out;
            }
            for (const x of vals)
                if (x !== undefined)
                    next.push(x);
        }
        cur = next;
    }
    if (p.filter && filterFn) {
        let accum = [];
        for (const obj of cur)
            accum = filterFn(obj, accum) ?? accum;
        return accum;
    }
    return cur;
}
/** Pointer paths (updateData / wire "update.path"): /prop or /int steps, no
 *  selectors, cannot address the root. Integer-looking steps index arrays and
 *  are plain keys otherwise. */
const DANGEROUS_KEY = new Set(["__proto__", "constructor", "prototype"]);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export function resolvePointer(root, pointer) {
    if (!pointer.startsWith("/"))
        return null;
    const steps = pointer.slice(1).split("/");
    // Pointer updates apply UNTRUSTED wire input (server/data-relay.mjs), so reject
    // empty/bracketed steps AND prototype-chain keys, and traverse OWN properties
    // only — otherwise `/__proto__/toString` etc. would be prototype pollution.
    if (steps.some((s) => s === "" || s.includes("[") || s.includes("]") || DANGEROUS_KEY.has(s)))
        return null;
    let parent = root;
    for (let i = 0; i < steps.length - 1; i++) {
        if (parent == null || typeof parent !== "object")
            return null;
        const k = Array.isArray(parent) && INT_RE.test(steps[i]) ? +steps[i] : steps[i];
        if (!hasOwn(parent, k))
            return null;
        parent = parent[k];
    }
    if (parent == null || typeof parent !== "object")
        return null;
    const last = steps[steps.length - 1];
    const key = Array.isArray(parent) && INT_RE.test(last) ? +last : last;
    const arrayAppend = Array.isArray(parent) && typeof key === "number" && key >= 0 && key <= parent.length;
    if (!hasOwn(parent, key) && !arrayAppend)
        return null;
    return { parent, key };
}
