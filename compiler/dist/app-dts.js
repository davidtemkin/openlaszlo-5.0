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
// ── Realtime bus (spec 2026-07-06-realtime-bus-design.md): server typing ────
/** The server-body program's ambient base. Kept SEPARATE from lfc.d.ts —
 *  ambient globals are program-wide, so Node globals must never share a
 *  program with client bodies (and canvas/LzView must not leak here). */
export const SRVNODE_DTS = `declare class SrvNode {
  setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;
}
declare function setInterval(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearInterval(t: any): void;
declare function setTimeout(cb: (...a: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearTimeout(t: any): void;
declare const console: any;
declare function fetch(input: any, init?: any): Promise<any>;
`;
/** Client-side proxy types + server-side class types from the <server> model. */
export function generateServerDts(model) {
    const supa = model.serverTransport?.mode === "supabase";
    const client = [];
    const server = [];
    for (const t of model.serverTags) {
        client.push(`declare class ${t.tsName}_client extends LzEventable {`);
        if (!supa)
            server.push(`declare class ${t.tsName} extends SrvNode {`);
        for (const a of t.attrs) {
            client.push(`  ${a.name}: ${a.tsType};`);
            if (!supa)
                server.push(`  ${a.name}: ${a.tsType};`);
        }
        if (supa && t.table) {
            client.push(`  rows: any[];`);
            // rowsText: bridge-maintained escaped newline-joined text — constraints
            // can't run computed calls (the LZX dependency analyzer refuses IIFEs),
            // so array->text derivation lives in the bridge, not in constraints.
            client.push(`  rowsText: string;`);
            client.push(`  insert(record: any): Promise<any>;`);
            // rows/rowsText are read-only: Exclude removes them from the setter
            // union while the property declarations keep constraint typing alive.
            client.push(`  setAttribute<K extends Exclude<keyof this & string, "rows" | "rowsText">>(name: K, value: this[K]): void;`);
        }
        else {
            for (const m of t.methods)
                client.push(`  ${m.name}(...args: any[]): Promise<any>;`);
            client.push(`  setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;`);
        }
        client.push("}", "");
        if (!supa)
            server.push("}", "");
    }
    if (model.serverTags.length) {
        if (supa)
            client.push(`declare class LzSrvPresence_client extends LzEventable { count: number; }`, "");
        client.push("declare const server: {");
        for (const t of model.serverTags)
            client.push(`  ${t.name}: ${t.tsName}_client;`);
        if (supa)
            client.push(`  presence: LzSrvPresence_client;`);
        client.push("};", "");
    }
    return { clientDts: client.join("\n"), serverDts: server.join("\n") };
}
/** One function per server method/handler, this-typed; same span anchoring
 *  as generateBodies. Payloads for on<attr> handlers use the declared attr. */
export function generateServerBodies(model) {
    const lines = ["// AUTO-GENERATED server-body harness (lzx-check). Do not edit.", ""];
    const spans = [];
    let idx = 0;
    for (const t of model.serverTags) {
        for (const b of [...t.methods, ...t.handlers]) {
            const attr = b.name.startsWith("on") ? b.name.slice(2) : "";
            const payload = t.attrs.find((a) => a.name === attr)?.tsType ?? "any";
            const params = ["this: " + t.tsName,
                ...b.args.map((a, i) => `${a}: ${b.name.startsWith("on") && i === 0 ? payload : "any"}`)];
            lines.push(`// <${b.name}> on server tag <${t.name}>`);
            const genStartLine = lines.length + 1;
            lines.push(`function __lz_srv_${++idx}(${params.join(", ")}): any {`);
            const spanSrcLine = b.code.startsWith("\n") ? b.srcLine : b.srcLine - 1;
            spans.push({ genStartLine, srcLine: spanSrcLine, label: `<${b.name}> on server tag <${t.name}>` });
            for (const l of b.code.replace(/^\n/, "").split("\n"))
                lines.push(l);
            lines.push("}", "");
        }
    }
    return { source: lines.join("\n"), spans };
}
