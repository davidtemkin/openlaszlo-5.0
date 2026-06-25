// Attribute value-type resolution for literal compilation. Derived from the
// extracted LFC schema (`schema-types.ts`) by attribute name, with a small
// curated fallback for names the schema doesn't carry.

import { SCHEMA } from "./schema-types.js";

export type AttrType = "number" | "string" | "boolean" | "color" | "expression" | "css";

/** Map a schema type string to the literal-compilation kind. */
export function mapType(t: string): AttrType {
  switch (t) {
    case "number": case "size": case "numberExpression": case "sizeExpression":
      return "number";
    case "boolean": case "inheritableBoolean":
      return "boolean";
    case "color":
      return "color";
    case "css":
      return "css"; // parsed into an object literal {prop:value,…}
    case "expression": case "node": case "reference":
      return "expression"; // emitted as a raw JS expression
    default: // string, token, text, ID, script, …
      return "string";
  }
}

// Attribute-name → schema type, gathered across all built-in classes (types are
// consistent per name in practice; first-seen wins).
const NAME_TYPE: Record<string, string> = {};
for (const cls of Object.values(SCHEMA))
  for (const [n, t] of Object.entries(cls.attrs))
    if (!(n in NAME_TYPE)) NAME_TYPE[n] = t;

// Curated fallback for attribute names not present in the schema.
const COLOR = new Set(["color", "bordercolor"]);
const NUMBER = new Set(["spacing", "inset", "leftinset", "rightinset", "topinset",
  "bottominset", "xinset", "yinset", "offset", "duration", "from", "to"]);
const BOOLEAN = new Set(["resizable", "wrap", "passevents", "canceldefault",
  "selected", "autoscroll", "loop", "play"]);

/** Returns the value-compilation type for an attribute, defaulting to string. */
export function attrType(_tag: string, name: string): AttrType {
  if (name in NAME_TYPE) return mapType(NAME_TYPE[name]);
  if (COLOR.has(name)) return "color";
  if (NUMBER.has(name)) return "number";
  if (BOOLEAN.has(name)) return "boolean";
  return "string";
}
