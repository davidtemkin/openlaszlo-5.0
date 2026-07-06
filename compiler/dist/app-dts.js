// app-dts.ts — emit the per-app declarations, the body-check harness, and the
// constraint-check harness (spec "App-aware type checking", layers 2-3) from
// an AppModel.
export function generateAppDts(model) {
    const out = ["// AUTO-GENERATED per-app declarations (lzx-check). Do not edit.", ""];
    for (const c of model.classes) {
        out.push(`declare class ${c.tsName} extends ${c.extTsName} {`);
        for (const a of c.attrs)
            out.push(`  ${a.name}: ${a.tsType};`);
        for (const s of c.methodSigs)
            out.push(`  ${s}`);
        out.push("}", "");
    }
    for (const inst of model.instances) {
        out.push(`declare class ${inst.tsName} extends ${inst.baseTsName} {`);
        for (const a of inst.attrs)
            out.push(`  ${a.name}: ${a.tsType};`);
        for (const nc of inst.namedChildren)
            out.push(`  ${nc.name}: ${nc.tsName};`);
        out.push("}", "");
    }
    for (const inst of model.instances)
        if (inst.id)
            out.push(`declare const ${inst.id}: ${inst.tsName};`);
    out.push("");
    return out.join("\n");
}
/** One function per body, `this`-typed; spans map generated lines to source. */
export function generateBodies(model) {
    const lines = ["// AUTO-GENERATED body-check harness (lzx-check). Do not edit.", ""];
    const spans = [];
    model.bodies.forEach((b, idx) => {
        const params = ["this: " + b.ownerType, ...b.params.map((p) => `${p.name}: ${p.tsType}`)];
        lines.push(`// ${b.label}`);
        const genStartLine = lines.length + 1; // 1-based line of the function header
        lines.push(`function __lz_body_${idx + 1}(${params.join(", ")}): any {`);
        // Line-map anchor. Mapping (driver): sourceLine = spanSrcLine + (genLine - genStartLine).
        // A multi-line carrier (`<script …>\ncode`) starts code at srcLine + 1 — the
        // stripped leading newline makes generated line genStartLine+1 ↔ srcLine+1.
        // A single-line carrier (`<script …>code</script>`) starts code ON srcLine,
        // so anchor one line earlier to keep the same formula exact.
        const spanSrcLine = b.code.startsWith("\n") ? b.srcLine : b.srcLine - 1;
        spans.push({ genStartLine, srcLine: spanSrcLine, label: b.label });
        for (const l of b.code.replace(/^\n/, "").split("\n"))
            lines.push(l);
        lines.push("}", "");
    });
    return { source: lines.join("\n"), spans };
}
/** One function per ${…} constraint, with the ACTUAL enclosing instance types
 *  (spec "Beyond bodies"): this/parent/immediateparent/classroot are precise,
 *  which is what makes checking possible despite the runtime's with(this)
 *  scoping. Diagnostics all map to the attribute's line (single expressions). */
export function generateConstraintChecks(model) {
    const lines = ["// AUTO-GENERATED constraint-check harness (lzx-check). Do not edit.", ""];
    const spans = [];
    model.constraints.forEach((c, idx) => {
        lines.push(`// ${c.label}`);
        const genStartLine = lines.length + 1;
        lines.push(`function __lz_constraint_${idx + 1}(this: ${c.ownerType}, parent: ${c.parentType}, immediateparent: ${c.parentType}, classroot: ${c.classrootType}): any {`);
        spans.push({ genStartLine, attrLine: c.line, label: c.label, ownerMembers: c.ownerMembers });
        lines.push(`return (${c.expr.replace(/\n/g, " ")});`, "}", "");
    });
    return { source: lines.join("\n"), spans };
}
