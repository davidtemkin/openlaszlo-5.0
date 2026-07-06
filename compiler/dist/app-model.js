// app-model.ts — extract the checkable model of a DOM-authored app
// (spec "App-aware type checking", layer 2): user classes, per-instance
// synthesized types (named children, ids, instance attributes), every
// TypeScript code body with a typed owner and typed params, markup-literal
// and cross-reference validation, and ${…} constraint collection with the
// ACTUAL enclosing instance types.
import { builtinTsName, tsTypeOf } from "./lfc-dts.js";
import { SCHEMA, schemaAttrType } from "./schema-types.js";
const ELEMENT = 1, TEXT = 3;
const NON_INSTANCE = new Set(["attribute", "method", "handler", "setter", "script",
    "class", "interface", "mixin", "dataset", "include", "font", "resource",
    "event", "splash", "stylesheet", "import"]);
// Names emitted into the generated .d.ts must be TS identifiers; `constructor`
// is a class-member keyword. Invalid names become NameIssue findings and are
// excluded from emission (a corrupted declaration file would poison the whole
// check — the driver also surfaces any residual app-d.ts diagnostics).
const TS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const validName = (n) => TS_IDENT.test(n) && n !== "constructor";
const CONSTRAINT_RE = /^\s*\$\w*\{([\s\S]*)\}\s*$/;
const SKIP_LITERAL = new Set(["name", "id", "data-lz-adopt", "lzdomadopt", "with", "placement", "options", "styleclass", "datapath"]);
// LZX <attribute type=…> vocabulary → TS (shares tsTypeOf keys; default any —
// LZX's default attribute type is `expression`). Size PROPERTIES read as
// resolved numbers (see lfc-dts.ts) — percent flexibility lives in the
// literal validator (via declKind), not the property type.
function attrDeclTsType(t) {
    if (!t)
        return "any";
    if (t === "expression" || t === "html")
        return "any";
    if (t === "size" || t === "sizeExpression")
        return "number";
    return tsTypeOf(t);
}
/** Build an AppAttr from a declaration, keeping the LZX type for literal validation. */
function declAttr(name, t) {
    return { name, tsType: attrDeclTsType(t), ...(t ? { declKind: t } : {}) };
}
/** All schema attr names up the extends chain (with(this)-legal bare names). */
function schemaAttrNames(tag) {
    const out = [];
    let c = tag;
    while (c && SCHEMA[c]) {
        out.push(...Object.keys(SCHEMA[c].attrs).filter((n) => !n.startsWith("$")));
        c = SCHEMA[c].ext;
    }
    return out;
}
/** Literal validation by SCHEMA kind (declared <attribute type> checked via its TS type). */
function literalIssue(name, value, kind) {
    const num = /^-?(\d+(\.\d+)?|\.\d+)$/.test(value); // .3 is legal LZX
    switch (kind) {
        case "number":
        case "numberExpression":
            return num ? null : `attribute ${name}="${value}" is not a number`;
        case "size":
        case "sizeExpression":
            return num || /^\d+(\.\d+)?%$/.test(value) ? null : `attribute ${name}="${value}" is not a number or percent`;
        case "boolean":
        case "inheritableBoolean":
            return value === "true" || value === "false" ? null : `attribute ${name}="${value}" is not true/false`;
        case "color":
            return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) || /^0x[0-9a-fA-F]{6}$/.test(value) || /^[a-zA-Z]+$/.test(value)
                ? null : `attribute ${name}="${value}" is not a color`;
        default: return null;
    }
}
const tagOf = (el) => {
    const t = el.tagName.toLowerCase();
    return t === "laszlo-app" ? "canvas" : t.startsWith("lz-") ? t.slice(3) : t;
};
const elemChildren = (el) => [...el.childNodes].filter((c) => c.nodeType === ELEMENT);
const textOf = (el) => {
    const t = [...el.childNodes].find((c) => c.nodeType === TEXT);
    return { code: t?.nodeValue ?? "", line: t?.line ?? el.line };
};
export function extractApp(root, opts = {}) {
    const model = { classes: [], instances: [], bodies: [], constraints: [],
        skippedLzs: 0, nameIssues: [], staticIssues: [] };
    const seenIds = new Set();
    const userClasses = new Map();
    let instSeq = 0;
    /** Validate a to-be-emitted name; record + reject invalid ones. */
    function checkName(kind, n, line) {
        if (validName(n))
            return true;
        model.nameIssues.push({ message: `${kind} "${n}" is not a valid identifier (or is "constructor") — excluded from checking`, line });
        return false;
    }
    // Resolve an attribute's TS type on an owner: declared attrs (walking the
    // user-extends chain), then the built-in schema, else any. `resolved: true`
    // is the EVENT-PAYLOAD flavor: the LFC fires attribute events with the
    // resolved value (e.g. onwidth sends the computed pixel number, never a
    // percent string — LaszloView.lzs $lzc$set_width/updateWidth), so size
    // maps to plain number there; property declarations keep number | string.
    function resolveAttrType(name, declared, baseTag, extChain, resolved) {
        const d = declared.find((a) => a.name === name);
        if (d)
            return d.tsType;
        for (const cn of extChain) {
            const c = userClasses.get(cn);
            const ca = c?.attrs.find((a) => a.name === name);
            if (ca)
                return ca.tsType;
        }
        const s = schemaAttrType(baseTag, name);
        if (!s)
            return "any";
        if (resolved && (s === "size" || s === "sizeExpression"))
            return "number";
        return tsTypeOf(s);
    }
    // Collect a code body from <method>/<handler>/<setter>. lzs carriers and
    // .lzx (ES4) bodies are skipped and counted.
    function collectBody(el, ownerType, ownerDesc, params) {
        const carrier = elemChildren(el).find((c) => c.tagName === "SCRIPT");
        let code, line;
        if (carrier) {
            const type = (carrier.getAttribute("type") ?? "").trim().toLowerCase();
            if (type === "text/lzs") {
                model.skippedLzs++;
                return;
            }
            ({ code, line } = textOf(carrier));
        }
        else {
            ({ code, line } = textOf(el));
        }
        if (code.trim() === "")
            return;
        if (opts.es4Bodies) {
            model.skippedLzs++;
            return;
        } // .lzx bodies are ES4, not TS
        const nameAttr = el.getAttribute("name") ?? "";
        model.bodies.push({
            label: `<${el.tagName.toLowerCase()} name="${nameAttr}"> in ${ownerDesc}`,
            ownerType, params, code, srcLine: line,
        });
    }
    function bodyParams(el, kind, declared, baseTag, extChain) {
        const args = (el.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
        if (args.length === 0)
            return [];
        if (kind === "handler") {
            const ev = el.getAttribute("name") ?? "";
            const attr = ev.startsWith("on") ? ev.slice(2) : "";
            const t = attr ? resolveAttrType(attr, declared, baseTag, extChain, true) : "any";
            return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
        }
        if (kind === "setter") {
            const t = resolveAttrType(el.getAttribute("name") ?? "", declared, baseTag, extChain, false);
            return args.map((a, i) => ({ name: a, tsType: i === 0 ? t : "any" }));
        }
        return args.map((a) => ({ name: a, tsType: "any" }));
    }
    function walkClass(el) {
        const name = el.getAttribute("name") ?? "anonymous";
        if (!checkName("class", name, el.line))
            return; // issue recorded; class skipped
        const ext = el.getAttribute("extends") ?? "view";
        if (!userClasses.has(ext) && !(ext in SCHEMA) && !opts.knownTags?.has(ext))
            model.staticIssues.push({ message: `<class name="${name}"> extends unknown "${ext}"`, line: el.line });
        const extUser = userClasses.get(ext);
        const cls = {
            tsName: "LzUser_" + name,
            extTsName: extUser ? extUser.tsName : (builtinTsName(ext) ?? "LzView"),
            attrs: [], methodSigs: [],
        };
        userClasses.set(name, cls);
        model.classes.push(cls);
        const baseTag = builtinTsName(ext) ? ext : "view";
        const extChain = extUser ? [ext] : [];
        const desc = `<class name="${name}">`;
        for (const c of elemChildren(el)) {
            const t = c.tagName.toLowerCase();
            if (t === "attribute") {
                const an = c.getAttribute("name") ?? "";
                if (checkName("attribute", an, c.line))
                    cls.attrs.push(declAttr(an, c.getAttribute("type")));
            }
            else if (t === "method") {
                const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
                cls.methodSigs.push(`${c.getAttribute("name")}(${args.map((a) => a + ": any").join(", ")}): any;`);
                collectBody(c, cls.tsName, desc, bodyParams(c, "method", cls.attrs, baseTag, extChain));
            }
            else if (t === "handler" || t === "setter") {
                collectBody(c, cls.tsName, desc, bodyParams(c, t, cls.attrs, baseTag, extChain));
            }
            // template children (views etc.) are NOT instances; nested template
            // bodies/constraints are a documented follow-up (out of Slice-2 scope).
        }
    }
    function walkInstance(el, parent, siblingNames) {
        const tag = tagOf(el);
        const user = userClasses.get(tag);
        const inst = {
            tsName: "LzInst_" + ++instSeq,
            baseTsName: user ? user.tsName : (builtinTsName(tag) ?? "LzView"),
            attrs: [], namedChildren: [],
        };
        model.instances.push(inst);
        const id = el.getAttribute("id");
        if (id && seenIds.has(id)) {
            model.staticIssues.push({ message: `duplicate id "${id}"`, line: el.line });
            // do NOT set inst.id — a second `declare const` would add TS2451 noise
        }
        else if (id) {
            seenIds.add(id);
            if (checkName("id", id, el.line))
                inst.id = id;
        }
        const nm = el.getAttribute("name");
        if (nm && parent) {
            if (siblingNames.has(nm))
                model.staticIssues.push({ message: `duplicate sibling name "${nm}"`, line: el.line });
            siblingNames.add(nm);
            if (checkName("name", nm, el.line))
                parent.namedChildren.push({ name: nm, tsName: inst.tsName });
        }
        const baseTag = builtinTsName(tag) ? tag : "view";
        const extChain = user ? [tag] : [];
        const desc = `<${el.tagName.toLowerCase()}${nm ? ` name="${nm}"` : ""}>`;
        // First pass: attribute declarations (so handler payloads can see them).
        for (const c of elemChildren(el))
            if (c.tagName.toLowerCase() === "attribute") {
                const an = c.getAttribute("name") ?? "";
                if (checkName("attribute", an, c.line))
                    inst.attrs.push(declAttr(an, c.getAttribute("type")));
            }
        // Markup literals + constraint collection (spec "Beyond bodies").
        // Declared attrs validate by their ORIGINAL LZX type (declKind).
        const declKindOf = (n) => {
            const d = inst.attrs.find((a) => a.name === n);
            if (d)
                return d.declKind ?? null; // the ORIGINAL LZX type string, no reverse-mapping
            return schemaAttrType(baseTag, n);
        };
        for (const a of el.attributes) {
            if (SKIP_LITERAL.has(a.name) || a.name.startsWith("on"))
                continue;
            const cm = CONSTRAINT_RE.exec(a.value);
            if (cm) {
                model.constraints.push({
                    expr: cm[1], line: a.line,
                    label: `${a.name} constraint on ${desc}`,
                    ownerType: inst.tsName,
                    parentType: parent ? parent.tsName : "LzNode",
                    classrootType: model.instances[0].tsName,
                    ownerMembers: [
                        ...inst.attrs.map((x) => x.name),
                        // user-class chain attrs are with(this)-legal too (the locked rule)
                        ...extChain.flatMap((cn) => userClasses.get(cn)?.attrs.map((x) => x.name) ?? []),
                        ...schemaAttrNames(baseTag),
                    ],
                });
                continue;
            }
            const issue = literalIssue(a.name, a.value, declKindOf(a.name));
            if (issue)
                model.staticIssues.push({ message: issue, line: a.line });
        }
        const childSiblings = new Set();
        for (const c of elemChildren(el)) {
            const t = c.tagName.toLowerCase();
            if (t === "attribute")
                continue;
            if (t === "class" || t === "interface" || t === "mixin") {
                walkClass(c);
                continue;
            }
            if (t === "dataset")
                continue; // data, not code
            if (t === "method") {
                const args = (c.getAttribute("args") ?? "").split(/[\s,]+/).filter(Boolean);
                // instance methods surface on the instance type via methodSigs-like attr
                const mn = c.getAttribute("name") ?? "";
                if (checkName("method", mn, c.line))
                    inst.attrs.push({ name: mn, tsType: `(${args.map((a) => a + ": any").join(", ")}) => any` });
                collectBody(c, inst.tsName, desc, bodyParams(c, "method", inst.attrs, baseTag, extChain));
                continue;
            }
            if (t === "handler" || t === "setter") {
                collectBody(c, inst.tsName, desc, bodyParams(c, t, inst.attrs, baseTag, extChain));
                continue;
            }
            if (t === "script")
                continue; // top-level scripts: canvas-owned checking is a follow-up
            if (!NON_INSTANCE.has(t))
                walkInstance(c, inst, childSiblings);
        }
    }
    walkInstance(root, null, new Set());
    // Named children become with(this)-legal after the walk.
    for (const c of model.constraints) {
        const inst = model.instances.find((i) => i.tsName === c.ownerType);
        if (inst)
            c.ownerMembers.push(...inst.namedChildren.map((n) => n.name));
    }
    return model;
}
