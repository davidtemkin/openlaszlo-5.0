// ts-carrier.ts — TypeScript carrier transpile for the DOM-authored dialect
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md).
//
// Carrier bodies are FUNCTION BODIES (method/handler/setter code), so they are
// wrapped in a function for transpileModule (top-level `return` is legal, arrow
// `this`-capture lands inside the body) and unwrapped after. Output targets ES5
// so it stays within the ES3-era grammar sc.ts parses. Type-STRIP only — no
// checking (that is Slice 2's lzx-check).
//
// This module is the ONLY compiler source that imports `typescript`; it is
// excluded from the core (injected as opts.transpileTs) and bundled separately
// to startup/lz-ts.js (npm run bundle:lzts).

import ts from "typescript";

const WRAP_HEAD = "function __lzTsBody__(){\n";

export function transpileTsBody(code: string): string {
  const out = ts.transpileModule(WRAP_HEAD + code + "\n}", {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      // ModuleKind.None + ES5 trips transpileModule's implicit-isolatedModules
      // config error (TS 5.9). CommonJS is artifact-free here: carrier bodies
      // have no imports/exports, and the file-level "use strict" prologue lands
      // OUTSIDE the wrapper function, which the unwrap slice excludes.
      module: ts.ModuleKind.CommonJS,
      removeComments: false,
    },
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) {
    throw new Error(
      "TypeScript syntax error: " + ts.flattenDiagnosticMessageText(errs[0].messageText, " "));
  }
  const js = out.outputText;
  const open = js.indexOf("{");
  const close = js.lastIndexOf("}");
  return js.slice(open + 1, close).trim();
}
