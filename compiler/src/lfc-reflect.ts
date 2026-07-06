// lfc-reflect.ts — derive the LFC's typed API surface from its SOURCE via the
// compiler's own ES4 parser (spec "App-aware type checking" layer 1b). The
// schema gives attribute types; THIS gives method signatures, typed vars, and
// the lz.* service namespace. Dev-tool-only (lzx-check); never bundled.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLibraryAst, type Stmt } from "./sc.js";

export interface LfcMethod { name: string; params: { name: string; type: string | null }[]; returnType: string | null; isStatic: boolean }
export interface LfcVar { name: string; type: string | null; isStatic: boolean }
export interface LfcClass { name: string; sup: string | null; methods: LfcMethod[]; vars: LfcVar[] }
export interface LfcReflection { classes: Map<string, LfcClass>; lzAssignments: { prop: string; className: string }[] }

const isPrivate = (n: string) => n.startsWith("__") || n.startsWith("$");

/** Render a member/identifier chain (`a.b.c`) or null if not one. */
function dottedName(n: any): string | null {
  if (n.k === "id") return n.name;
  if (n.k === "member") { const o = dottedName(n.o); return o ? o + "." + n.p : null; }
  return null;
}

export function reflectLibrary(stmts: Stmt[]): LfcReflection {
  const classes = new Map<string, LfcClass>();
  const lzAssignments: { prop: string; className: string }[] = [];

  const visit = (s: any): void => {
    if (s.s === "block") { s.body.forEach(visit); return; }
    if (s.s === "if") { if (s.t) visit(s.t); if (s.e) visit(s.e); return; }
    if (s.s === "as3class") {
      const cls: LfcClass = { name: s.name, sup: s.sup, methods: [], vars: [] };
      for (const m of s.members as any[]) {
        if (m.kind === "var" && !isPrivate(m.name))
          cls.vars.push({ name: m.name, type: m.varType ?? null, isStatic: m.static });
        else if (m.kind === "method" && !isPrivate(m.name) && m.name !== s.name) {
          const fn = m.fn;
          cls.methods.push({
            name: m.name, isStatic: m.static, returnType: fn.returnType ?? null,
            params: (fn.params as string[]).map((p: string, i: number) => ({
              name: p, type: fn.paramTypes?.[i] ?? null,
            })),
          });
        }
      }
      classes.set(s.name, cls);
      return;
    }
    if (s.s === "expr" && s.e?.k === "assign" && s.e.op === "=") {
      const l = s.e.l;
      if (l?.k === "member" && l.o?.k === "id" && l.o.name === "lz") {
        const right = dottedName(s.e.r);
        if (right) lzAssignments.push({ prop: l.p, className: right });
      }
    }
  };
  stmts.forEach(visit);
  return { classes, lzAssignments };
}

/** Load + reflect the real LFC from its library root (.lzs with #includes). */
export function loadLfcReflection(rootLzsPath: string): LfcReflection {
  const rootSource = readFileSync(rootLzsPath, "utf8");
  const base = dirname(rootLzsPath);
  const resolveInclude = (p: string): string | null => {
    try { return readFileSync(join(base, p), "utf8"); } catch { return null; }
  };
  return reflectLibrary(parseLibraryAst(rootSource, rootLzsPath.split("/").pop()!, resolveInclude));
}
