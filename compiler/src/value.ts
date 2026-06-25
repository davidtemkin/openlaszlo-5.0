// JS literal emission matching the Java oracle's output conventions.

const HEX = "0123456789ABCDEF";
function hexchar(c: number): string {
  return HEX[c & 0x0f];
}

/** Port of ScriptCompiler.quote: pick the escape-minimizing quote char, then
 *  escape per ECMAScript rules (uppercase hex for \xXX / \uXXXX). */
export function jsString(s: string): string {
  let quote = '"';
  if (s.indexOf("'") >= 0 || s.indexOf('"') >= 0) {
    let n = 0;
    for (const ch of s) {
      if (ch === "'") n--;
      else if (ch === '"') n++;
    }
    quote = n > 0 ? "'" : '"';
  }
  let out = quote;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    const i = s.charCodeAt(k);
    switch (c) {
      case "\n": out += "\\n"; break;
      case "\r": out += "\\r"; break;
      case "\b": out += "\\b"; break;
      case "\t": out += "\\t"; break;
      case "\v": out += "\\v"; break;
      case "\f": out += "\\f"; break;
      case "\\": out += "\\\\"; break;
      case "'":
      case '"':
        if (c === quote) out += "\\";
        out += c;
        break;
      default:
        if (i === 0) out += "\\0";
        else if (i < 32 || (i >= 128 && i <= 0xff))
          out += "\\x" + hexchar(i >> 4) + hexchar(i);
        else if (i > 0xff)
          out += "\\u" + hexchar(i >> 12) + hexchar(i >> 8) + hexchar(i >> 4) + hexchar(i);
        else out += c;
    }
  }
  return out + quote;
}

/** Format a number the way Java emits it for view attributes:
 *  integral values as bare integers (50), non-integral via shortest round-trip. */
export function jsNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(v);
}

/** Format a number the way Java's Double.toString emits it (always keeps a
 *  decimal point for integral doubles, e.g. 30.0). Used for measured resource
 *  dimensions which are stored as doubles. */
export function javaDouble(v: number): string {
  if (Number.isInteger(v)) return v.toFixed(1);
  return String(v);
}

export type Typed =
  | { kind: "number"; v: number }
  | { kind: "double"; v: number }
  | { kind: "string"; v: string }
  | { kind: "boolean"; v: boolean }
  | { kind: "raw"; v: string }; // already-formatted JS expression

export function emitTyped(t: Typed): string {
  switch (t.kind) {
    case "number":
      return jsNumber(t.v);
    case "double":
      return javaDouble(t.v);
    case "string":
      return jsString(t.v);
    case "boolean":
      return t.v ? "true" : "false";
    case "raw":
      return t.v;
  }
}

const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function", "if",
  "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw",
  "try", "typeof", "var", "void", "while", "with", "null", "true", "false",
]);

/** A JS object key is emitted bare when it's a valid identifier and not reserved; else quoted. */
export function emitKey(k: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED.has(k)) return k;
  return jsString(k);
}

/** Emit a sorted object literal {k:v,...} with keys in Java String (UTF-16) order. */
export function emitObject(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort();
  return "{" + keys.map((k) => `${emitKey(k)}:${entries[k]}`).join(",") + "}";
}

/** Debug-build (compress=false) variant: spaced `{k: v, k: v}` exactly as the
 *  oracle's ParseTreePrinter prints an object literal when not compressing. The
 *  values are already-rendered JS expressions (the caller is responsible for
 *  rendering nested objects/arrays spaced too when those occur). */
export function emitObjectSpaced(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort();
  if (keys.length === 0) return "{}";
  return "{" + keys.map((k) => `${emitKey(k)}: ${entries[k]}`).join(", ") + "}";
}
