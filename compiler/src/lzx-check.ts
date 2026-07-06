// lzx-check.ts — full-surface validation for DOM-authored (and .lzx) apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md,
// "App-aware type checking", Slice 2). Dev-time CLI; never bundled.
//
//   node dist/lzx-check.js <app.html|app.lzx>   check an app document
//   node dist/lzx-check.js --write-lfc-dts      print the generated lfc.d.ts
//
// The program tsc sees: lfc.d.ts (committed, reflection-merged), __lzapp.d.ts
// (per-app declarations), __lzbodies.ts (each method/handler/setter body as a
// this-typed function), __lzconstraints.ts (each ${…} constraint with the
// ACTUAL enclosing instance types). Diagnostics are mapped back to the app
// file through the span tables.

import ts from "typescript";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseHtmlDialect, findLaszloApp } from "./htmlsource.js";
import { parseXml } from "./xml.js";
import { xmlToHtml } from "./xml-adapter.js";
import { extractApp } from "./app-model.js";
import { generateAppDts, generateBodies, generateConstraintChecks, generateServerDts, generateServerBodies, SRVNODE_DTS, BodySpan } from "./app-dts.js";
import { generateLfcDts } from "./lfc-dts.js";
import { loadLfcReflection } from "./lfc-reflect.js";

export interface Finding { line: number; col: number; code: number; message: string; element: string }
export interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number; constraintsChecked: number; serverBodiesChecked: number }

const COMPILER_OPTS: ts.CompilerOptions = {
  noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"],
  target: ts.ScriptTarget.ES2020,
};

/** The COMMITTED reflection-merged lfc.d.ts (fast, deterministic); schema-only
 *  fallback if it hasn't been generated yet. */
function readLfcDts(): string {
  try { return readFileSync(fileURLToPath(new URL("../lfc.d.ts", import.meta.url)), "utf8"); }
  catch { return generateLfcDts(); }
}

/** Component tags from the distro's autoincludes properties (legal extends
 *  targets the schema doesn't know) — best-effort; empty when absent. */
function knownComponentTags(): Set<string> {
  try {
    const txt = readFileSync(fileURLToPath(new URL("../../runtime/lzx-autoincludes.properties", import.meta.url)), "utf8");
    return new Set(txt.split("\n").filter((l) => !l.startsWith("#") && l.includes(":")).map((l) => l.split(":")[0].trim()));
  } catch { return new Set(); }
}

export function checkApp(source: string, fileName: string): CheckResult {
  const isLzx = /\.lzx$/i.test(fileName);
  const root = isLzx ? xmlToHtml(parseXml(source)) : findLaszloApp(parseHtmlDialect(source));
  const model = extractApp(root, { es4Bodies: isLzx, knownTags: knownComponentTags() });
  // Server typing (realtime bus): clientDts joins the CLIENT program;
  // serverDts + Node globals live in a SEPARATE program below (ambient
  // globals are program-wide — isolation is the point).
  const { clientDts, serverDts } = generateServerDts(model);
  const appDts = generateAppDts(model) + "\n" + clientDts;
  const { source: bodiesSrc, spans } = generateBodies(model);
  const { source: constrSrc, spans: constrSpans } = generateConstraintChecks(model);
  const virtual = new Map<string, string>([
    ["lfc.d.ts", readLfcDts()],
    ["__lzapp.d.ts", appDts],
    ["__lzbodies.ts", bodiesSrc],
    ["__lzconstraints.ts", constrSrc],
  ]);

  const host = ts.createCompilerHost(COMPILER_OPTS);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVer) =>
    virtual.has(name) ? ts.createSourceFile(name, virtual.get(name)!, langVer, true) : origGet(name, langVer);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (name) => virtual.has(name) || origExists(name);
  const origRead = host.readFile.bind(host);
  host.readFile = (name) => virtual.get(name) ?? origRead(name);

  const prog = ts.createProgram([...virtual.keys()], COMPILER_OPTS, host);
  const findings: Finding[] = [];

  // Extraction-time name validation (invalid ids/class/attribute names).
  for (const ni of model.nameIssues)
    findings.push({ line: ni.line, col: 1, code: 0, message: ni.message, element: "(name validation)" });
  // Markup-literal + cross-reference validation.
  for (const si of model.staticIssues)
    findings.push({ line: si.line, col: 1, code: 0, message: si.message, element: "(markup validation)" });

  // Diagnostics in the generated APP DECLARATIONS are real findings too (an
  // invalid id/attribute name corrupts the type model): swallowing them would
  // let the checker report a false "OK" over a broken program. lfc.d.ts is
  // covered by its own compiles-clean unit test.
  const appSf = prog.getSourceFile("__lzapp.d.ts")!;
  for (const d of [...prog.getSyntacticDiagnostics(appSf), ...prog.getSemanticDiagnostics(appSf)]) {
    findings.push({
      line: 0, col: 0, code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      element: "(generated app declarations — check id/class/attribute names)",
    });
  }

  const bodiesSf = prog.getSourceFile("__lzbodies.ts")!;
  const diags = [...prog.getSyntacticDiagnostics(bodiesSf), ...prog.getSemanticDiagnostics(bodiesSf)];
  for (const d of diags) {
    if (d.file?.fileName !== "__lzbodies.ts" || d.start == null) continue;
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    const genLine = pos.line + 1;
    // find the span containing this generated line
    let span: BodySpan | undefined;
    for (const s of spans) if (s.genStartLine <= genLine) span = s; else break;
    const line = span ? span.srcLine + (genLine - span.genStartLine) : genLine;
    findings.push({
      line, col: pos.character + 1, code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      element: span?.label ?? "(unknown)",
    });
  }

  // Constraint diagnostics: precise this/parent/classroot types; the ONE
  // with(this) accommodation is suppressing TS2304 on the owner's own members.
  const constrSf = prog.getSourceFile("__lzconstraints.ts")!;
  for (const d of [...prog.getSyntacticDiagnostics(constrSf), ...prog.getSemanticDiagnostics(constrSf)]) {
    if (d.start == null) continue;
    const genLine = d.file!.getLineAndCharacterOfPosition(d.start).line + 1;
    let span: (typeof constrSpans)[number] | undefined;
    for (const s of constrSpans) if (s.genStartLine <= genLine) span = s; else break;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (d.code === 2304 && span) {
      const m = /Cannot find name '(\w+)'/.exec(msg);
      if (m && span.ownerMembers.includes(m[1])) continue; // with(this)-legal bare name
    }
    findings.push({ line: span?.attrLine ?? genLine, col: 1, code: d.code, message: msg, element: span?.label ?? "(constraint)" });
  }
  // Server bodies: the SECOND program (no lfc.d.ts — setInterval et al must
  // never leak into client bodies, and canvas/LzView must not leak here).
  let serverBodiesChecked = 0;
  if (model.serverTags.length) {
    serverBodiesChecked = model.serverTags.reduce((n, t) => n + t.methods.length + t.handlers.length, 0);
    const { source: srvSrc, spans: srvSpans } = generateServerBodies(model);
    const srvVirtual = new Map<string, string>([
      ["srvnode.d.ts", SRVNODE_DTS],
      ["__lzsrvapp.d.ts", serverDts],
      ["__lzsrvbodies.ts", srvSrc],
    ]);
    const srvHost = ts.createCompilerHost(COMPILER_OPTS);
    const sGet = srvHost.getSourceFile.bind(srvHost);
    srvHost.getSourceFile = (name, langVer) =>
      srvVirtual.has(name) ? ts.createSourceFile(name, srvVirtual.get(name)!, langVer, true) : sGet(name, langVer);
    const sExists = srvHost.fileExists.bind(srvHost);
    srvHost.fileExists = (name) => srvVirtual.has(name) || sExists(name);
    const sRead = srvHost.readFile.bind(srvHost);
    srvHost.readFile = (name) => srvVirtual.get(name) ?? sRead(name);
    const srvProg = ts.createProgram([...srvVirtual.keys()], COMPILER_OPTS, srvHost);
    const srvSf = srvProg.getSourceFile("__lzsrvbodies.ts")!;
    for (const d of [...srvProg.getSyntacticDiagnostics(srvSf), ...srvProg.getSemanticDiagnostics(srvSf)]) {
      if (d.file?.fileName !== "__lzsrvbodies.ts" || d.start == null) continue;
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      const genLine = pos.line + 1;
      let span: BodySpan | undefined;
      for (const sp of srvSpans) if (sp.genStartLine <= genLine) span = sp; else break;
      const line = span ? span.srcLine + (genLine - span.genStartLine) : genLine;
      findings.push({
        line, col: pos.character + 1, code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, " "),
        element: span?.label ?? "(server body)",
      });
    }
  }
  return { findings, skippedLzs: model.skippedLzs, bodiesChecked: model.bodies.length, constraintsChecked: model.constraints.length, serverBodiesChecked };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// realpath resolves the npm .bin symlink (whose basename has no .js extension —
// a naive endsWith() check would make the installed bin a silent no-op);
// pathToFileURL handles Windows paths.
const isMain = !!process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "--write-lfc-dts") {
    // Reflection-merged: derive class members + lz.* from the LFC source.
    const root = fileURLToPath(new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url));
    process.stdout.write(generateLfcDts(loadLfcReflection(root)));
    process.exit(0);
  }
  const file = args[0];
  if (!file) {
    console.error("usage: lzx-check <app.html|app.lzx>   |   lzx-check --write-lfc-dts");
    process.exit(2);
  }
  const html = readFileSync(file, "utf8");
  const r = checkApp(html, file);
  for (const f of r.findings)
    console.error(`${file}:${f.line}:${f.col} TS${f.code} ${f.message}   [${f.element}]`);
  const note = r.skippedLzs ? ` (${r.skippedLzs} non-TS bod${r.skippedLzs > 1 ? "ies" : "y"} skipped)` : "";
  const scope = `${r.bodiesChecked} bodies, ${r.constraintsChecked} constraints, ${r.serverBodiesChecked} server bodies`;
  if (r.findings.length) {
    console.error(`${r.findings.length} finding(s) across ${scope}${note}`);
    process.exit(1);
  }
  console.log(`OK — ${scope} checked, 0 findings${note}`);
}
