import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { generateLfcDts, tsTypeOf, builtinTsName } from "../dist/lfc-dts.js";
import { loadLfcReflection } from "../dist/lfc-reflect.js";

test("tsTypeOf mapping", () => {
  assert.equal(tsTypeOf("number"), "number");
  assert.equal(tsTypeOf("numberExpression"), "number");
  assert.equal(tsTypeOf("size"), "number | string");
  assert.equal(tsTypeOf("inheritableBoolean"), "boolean");
  assert.equal(tsTypeOf("color"), "string | number");
  assert.equal(tsTypeOf("expression"), "any");
  assert.equal(tsTypeOf("token"), "string");
});

test("builtinTsName", () => {
  assert.equal(builtinTsName("view"), "LzView");
  assert.equal(builtinTsName("text"), "LzText");
  assert.equal(builtinTsName("inputtext"), "LzInputText");
  assert.equal(builtinTsName("canvas"), "LzCanvas");
  assert.equal(builtinTsName("simplelayout"), null); // components are not in the emitted set
});

test("schema-only d.ts (fallback, no reflection) has the expected shape", () => {
  const dts = generateLfcDts();
  assert.ok(dts.includes("declare class LzView extends LzNode"));
  assert.ok(dts.includes("width: number | string;"));            // size
  assert.ok(dts.includes("bgcolor: string | number;"));          // color
  assert.ok(dts.includes("x: number;"));                         // numberExpression
  assert.ok(dts.includes("setAttribute<K extends keyof this & string>(name: K, value: this[K]): void;"));
  assert.ok(dts.includes("onclick: LzDeclaredEvent;"));          // SCHEMA_EVENTS, typed
  assert.ok(dts.includes("parent: LzNode;"));                    // relational override
  assert.ok(dts.includes("declare const canvas: LzCanvas;"));
  assert.ok(!dts.includes("$lzc$"));                             // $-attrs skipped
});

test("reflection-merged d.ts: derived methods, services, typed lz namespace", () => {
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  const dts = generateLfcDts(loadLfcReflection(root));
  assert.ok(dts.includes("declare class LzDeclaredEvent {"));
  assert.ok(/bringToFront\(\): (void|any);/.test(dts));          // derived onto LzView
  assert.ok(dts.includes("declare const lz: {"));
  assert.ok(/Timer: \w+;/.test(dts));                            // typed service singleton
  assert.ok(/Focus: \w+;/.test(dts));
  assert.ok(!/\b(__|\$)\w+\s*\(/.test(dts), "private members leaked");
});

test("generated d.ts compiles clean under tsc (BOTH modes)", () => {
  const root = new URL("../../runtime/lfc-src/LaszloLibrary.lzs", import.meta.url).pathname;
  for (const dts of [generateLfcDts(), generateLfcDts(loadLfcReflection(root))]) {
    const host = ts.createCompilerHost({});
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (name, langVer) =>
      name === "lfc.d.ts" ? ts.createSourceFile(name, dts, langVer, true) : orig(name, langVer);
    host.fileExists = ((oe) => (n) => n === "lfc.d.ts" || oe(n))(host.fileExists.bind(host));
    const prog = ts.createProgram(["lfc.d.ts"], { noEmit: true, strict: false, types: [], lib: ["lib.es2020.d.ts"] }, host);
    const diags = [...prog.getSyntacticDiagnostics(), ...prog.getSemanticDiagnostics()];
    assert.deepEqual(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).slice(0, 10), []);
  }
});
