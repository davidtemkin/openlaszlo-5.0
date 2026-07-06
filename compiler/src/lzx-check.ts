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
import { generateAppDts, generateBodies, generateConstraintChecks, BodySpan } from "./app-dts.js";
import { generateLfcDts } from "./lfc-dts.js";
import { loadLfcReflection } from "./lfc-reflect.js";

export interface Finding { line: number; col: number; code: number; message: string; element: string }
export interface CheckResult { findings: Finding[]; skippedLzs: number; bodiesChecked: number; constraintsChecked: number }

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

export function checkApp(source: string, fileName: string): CheckResult {
  const isLzx = /\.lzx$/i.test(fileName);
  const root = isLzx ? xmlToHtml(parseXml(source)) : findLaszloApp(parseHtmlDialect(source));
  const model = extractApp(root, { es4Bodies: isLzx });
  const appDts = generateAppDts(model);
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
  return { findings, skippedLzs: model.skippedLzs, bodiesChecked: model.bodies.length, constraintsChecked: model.constraints.length };
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
  const scope = `${r.bodiesChecked} bodies, ${r.constraintsChecked} constraints`;
  if (r.findings.length) {
    console.error(`${r.findings.length} finding(s) across ${scope}${note}`);
    process.exit(1);
  }
  console.log(`OK — ${scope} checked, 0 findings${note}`);
}
