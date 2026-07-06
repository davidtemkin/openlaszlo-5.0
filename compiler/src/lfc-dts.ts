// lfc-dts.ts — generate lfc.d.ts from the compiler's oracle schema
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md,
// "App-aware type checking", layer 1) MERGED with the LFC source's reflected
// API surface (lfc-reflect.ts): derived method signatures, typed vars, the
// lz.* service namespace, LzDeclaredEvent-typed events. The hand-curated core
// (strict setAttribute, relational overrides) is VERIFIED against
// runtime/lfc-src (do not invent APIs) and wins over derived members.

import { SCHEMA, SCHEMA_EVENTS } from "./schema-types.js";
import type { LfcReflection, LfcClass, LfcMethod } from "./lfc-reflect.js";

/** Schema type string -> TS type text. */
export function tsTypeOf(t: string): string {
  switch (t) {
    case "number": case "numberExpression": return "number";
    case "size": case "sizeExpression": return "number | string";
    case "boolean": case "inheritableBoolean": return "boolean";
    case "color": return "string | number";
    case "css": case "expression": case "node": case "reference": return "any";
    default: return "string"; // string, token, text, ID, script, …
  }
}

/** ES4 annotation text → TS type text. `declared` = names this d.ts declares
 *  (class-name types survive only when they resolve). */
export function es4TsType(t: string | null, declared: (n: string) => boolean): string {
  if (!t) return "any";
  const base = t.replace(/\?$/, "").replace(/\.<.*>$/, "");
  switch (base) {
    case "Number": case "int": case "uint": return "number";
    case "String": return "string";
    case "Boolean": return "boolean";
    case "void": return "void";
    case "Array": return "any[]";
    case "Function": return "(...args: any[]) => any";
    case "*": case "Object": case "null": return "any";
    default: return declared(base) ? base : "any";
  }
}

// The emitted node/view lineage, in dependency order (base before derived).
const EMIT_ORDER = ["node", "animatorgroup", "animator", "contextmenu", "contextmenuitem",
  "datapointer", "datapath", "dataset", "state", "view", "canvas", "text", "inputtext"];
const SPECIAL_NAMES: Record<string, string> = { text: "LzText", inputtext: "LzInputText" };

/** Built-in tag -> emitted TS class name (null when not an emitted built-in). */
export function builtinTsName(tag: string): string | null {
  if (!EMIT_ORDER.includes(tag)) return null;
  return SPECIAL_NAMES[tag] ?? "Lz" + tag[0].toUpperCase() + tag.slice(1);
}

// Relational attrs the schema types as plain strings; override for real DX.
const RELATIONAL: Record<string, string> = {
  parent: "LzNode", immediateparent: "LzNode", classroot: "LzNode", subnodes: "LzNode[]",
};
const VIEW_RELATIONAL: Record<string, string> = { subviews: "LzView[]" };

// Curated methods — verified against runtime/lfc-src (LzNode.lzs:2301/:2222,
// LaszloView.lzs:2854/:2926/:2986). The strict setAttribute catches both
// misspelled attribute names and wrong-typed values; escape: (this as any).
// NOTE: `keyof this & string` also admits method/event names (harmless);
// the point is rejecting MISSPELLED names and wrong-typed values.
const NODE_METHODS = [
  "setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;",
  "destroy(): void;",
  "animate(prop: string, to: number, duration: number, isRelative?: boolean | null, moreargs?: Record<string, any> | null): any;",
];
const VIEW_METHODS = [
  "bringToFront(): void;",
  "sendToBack(): void;",
  "setSource(source: string, cache?: any, headers?: any, filetype?: any): void;",
];

export function generateLfcDts(reflection?: LfcReflection): string {
  // Reconcile reflected real spellings (LzAnimatorGroup) with schema emission
  // names (LzAnimatorgroup): case-insensitive match on "lz"+tag.
  const schemaNameFor = new Map<string, string>();  // lowercased reflected name -> emitted name
  for (const tag of EMIT_ORDER) schemaNameFor.set(("lz" + tag).toLowerCase(), builtinTsName(tag)!);
  const reflected = reflection ? [...reflection.classes.values()] : [];
  const mergedInto = new Map<string, LfcClass>();   // emitted schema name -> reflected class
  const standalone: LfcClass[] = [];
  const aliases: [string, string][] = [];           // [realName, emittedName] when spellings differ
  for (const rc of reflected) {
    const emitted = schemaNameFor.get(rc.name.toLowerCase());
    if (emitted) {
      mergedInto.set(emitted, rc);
      if (emitted !== rc.name) aliases.push([rc.name, emitted]);
    } else if (rc.name !== "LzEventable" && rc.name !== "LzDeclaredEvent") standalone.push(rc);
    // (LzEventable merges into the base declaration below, not standalone)
  }
  const declaredNames = new Set<string>([
    "LzEventable", "LzDeclaredEvent",
    ...EMIT_ORDER.map((t) => builtinTsName(t)!),
    ...standalone.map((c) => c.name),
    ...aliases.map(([real]) => real),
  ]);
  const T = (t: string | null) => es4TsType(t, (n) => declaredNames.has(n));

  const methodSig = (m: LfcMethod): string => {
    const ps = m.params.map((p) => `${p.name}?: ${T(p.type)}`); // LFC params are widely defaulted; all optional
    return `  ${m.isStatic ? "static " : ""}${m.name}(${ps.join(", ")}): ${m.returnType ? T(m.returnType) : "any"};`;
  };

  // LzEventable IS a real LFC class (core/LzEventable.lzs) — merge its
  // reflected members into the base declaration instead of emitting a
  // duplicate standalone class (TS2300). LzDeclaredEvent stays curated.
  const eventable = reflection?.classes.get("LzEventable");
  const out: string[] = [
    "// AUTO-GENERATED by `node dist/lzx-check.js --write-lfc-dts` from the",
    "// compiler's oracle schema (schema-types.ts) and the LFC source AST",
    "// (lfc-reflect.ts). Do not edit by hand.",
    "",
    "declare class LzEventable {",
    ...(eventable ? [
      ...eventable.vars.map((v) => `  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`),
      ...eventable.methods.filter((m) => m.name !== "setAttribute").map(methodSig), // LzNode's strict generic wins
    ] : []),
    "}",
    "declare class LzDeclaredEvent { ready: boolean; sendEvent(value?: any): void; }",
    "",
  ];
  for (const tag of EMIT_ORDER) {
    const cls = SCHEMA[tag];
    const name = builtinTsName(tag)!;
    const extTag = cls.ext && EMIT_ORDER.includes(cls.ext) ? builtinTsName(cls.ext)! : "LzEventable";
    const emitted = new Set<string>();
    out.push(`declare class ${name} extends ${extTag} {`);
    if (tag === "node") out.push(`  constructor(parent?: LzNode, attrs?: Record<string, any>);`);
    for (const [attr, sType] of Object.entries(cls.attrs)) {
      if (attr.startsWith("$") || attr === "with") continue;
      const override = tag === "node" ? RELATIONAL[attr] : tag === "view" ? VIEW_RELATIONAL[attr] : undefined;
      out.push(`  ${attr}: ${override ?? tsTypeOf(sType)};`);
      emitted.add(attr);
    }
    for (const ev of SCHEMA_EVENTS[tag] ?? []) if (!emitted.has(ev)) { out.push(`  ${ev}: LzDeclaredEvent;`); emitted.add(ev); }
    if (tag === "node") for (const m of NODE_METHODS) { out.push("  " + m); emitted.add(m.split(/[<(]/)[0]); }
    if (tag === "view") for (const m of VIEW_METHODS) { out.push("  " + m); emitted.add(m.split(/[<(]/)[0]); }
    // Derived members (reflection) — schema/curated win on collision.
    const rc = mergedInto.get(name);
    if (rc) {
      for (const v of rc.vars) if (!emitted.has(v.name)) { out.push(`  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`); emitted.add(v.name); }
      for (const m of rc.methods) if (!emitted.has(m.name)) { out.push(methodSig(m)); emitted.add(m.name); }
    }
    out.push("}", "");
  }
  for (const [real, emitted] of aliases) out.push(`type ${real} = ${emitted};`);
  if (aliases.length) out.push("");
  // Non-schema reflected classes (services, kernel, …). Superclass kept when declared.
  for (const rc of standalone) {
    const sup = rc.sup && declaredNames.has(rc.sup) ? ` extends ${rc.sup}` : "";
    const emitted = new Set<string>();
    out.push(`declare class ${rc.name}${sup} {`);
    for (const v of rc.vars) if (!emitted.has(v.name)) { out.push(`  ${v.isStatic ? "static " : ""}${v.name}: ${T(v.type)};`); emitted.add(v.name); }
    for (const m of rc.methods) if (!emitted.has(m.name)) { out.push(methodSig(m)); emitted.add(m.name); }
    out.push("}", "");
  }
  // The lz service namespace: `lz.X = A.B` → X typed as class A (the LFC's
  // service-singleton pattern); bare `lz.X = SomeClass` publishes → typeof.
  // Index signature keeps unreflected entries (the tag map etc.) usable —
  // the one loose edge.
  if (reflection) {
    out.push("declare const lz: {");
    const seen = new Set<string>();
    for (const a of reflection.lzAssignments) {
      if (seen.has(a.prop) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(a.prop)) continue;
      seen.add(a.prop);
      if (a.className.includes(".")) {
        const cls = a.className.split(".")[0];
        out.push(`  ${a.prop}: ${declaredNames.has(cls) ? cls : "any"};`);
      } else {
        out.push(`  ${a.prop}: ${declaredNames.has(a.className) ? "typeof " + a.className : "any"};`);
      }
    }
    out.push("  [k: string]: any;", "};");
  } else {
    out.push("declare const lz: any;");
  }
  out.push(
    "declare const canvas: LzCanvas;",
    "declare const Debug: any;",
    "declare var $debug: boolean;",
    "");
  return out.join("\n");
}
