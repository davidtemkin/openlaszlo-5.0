// component-registry.ts — curated attribute typing for component-library tags.
// Today lzx-check validates only LFC-schema attrs; component tags (simplelayout,
// flexlayout, …) type as LzView and their own attributes pass silently. This registry
// adds literal validation for curated tags plus view-level layout HINTS (the
// `ignorelayout` precedent: plain attributes any view may carry, read by layouts).
// Slice 6 covers flexlayout only; generalizing is follow-up work.
// Spec: docs/superpowers/specs/2026-07-06-flexlayout-design.md ("Registration & checker").

export interface RegistryFinding { message: string; line: number }

type AttrRule = { kind: "enum"; values: string[] } | { kind: "number" };

const FLEX_ENUMS: Record<string, string[]> = {
  flexdirection: ["row", "column", "row-reverse", "column-reverse"],
  justifycontent: ["flex-start", "center", "flex-end", "space-between", "space-around"],
  alignitems: ["stretch", "flex-start", "center", "flex-end"],
  flexwrap: ["nowrap", "wrap"],
};

export const COMPONENT_ATTRS: Record<string, Record<string, AttrRule>> = {
  flexlayout: {
    flexdirection: { kind: "enum", values: FLEX_ENUMS.flexdirection },
    justifycontent: { kind: "enum", values: FLEX_ENUMS.justifycontent },
    alignitems: { kind: "enum", values: FLEX_ENUMS.alignitems },
    flexwrap: { kind: "enum", values: FLEX_ENUMS.flexwrap },
    padding: { kind: "number" },
  },
};

export const VIEW_HINTS: Record<string, AttrRule> = {
  flex: { kind: "number" },
  alignself: { kind: "enum", values: FLEX_ENUMS.alignitems },
  margin: { kind: "number" },
};

const NUM_RE = /^-?\d+(\.\d+)?$/;

function ruleIssue(tag: string, name: string, value: string, rule: AttrRule): string | null {
  if (rule.kind === "enum") {
    return rule.values.includes(value)
      ? null
      : `<${tag}> ${name}="${value}" is not one of ${rule.values.join(" | ")}`;
  }
  return NUM_RE.test(value.trim())
    ? null
    : `<${tag}> ${name}="${value}" is not a number`;
}

/** Literal validation for a tag's attributes. `${…}` constraint values must be
 *  filtered by the CALLER (constraints are typed by the constraint program). */
export function registryFindings(
  tag: string,
  isViewDerived: boolean,
  attrs: Array<{ name: string; value: string; line: number }>,
): RegistryFinding[] {
  const out: RegistryFinding[] = [];
  const own = COMPONENT_ATTRS[tag];
  for (const a of attrs) {
    const rule = (own && own[a.name]) || (isViewDerived ? VIEW_HINTS[a.name] : undefined);
    if (!rule) continue;
    const issue = ruleIssue(tag, a.name, a.value, rule);
    if (issue) out.push({ message: issue, line: a.line });
  }
  return out;
}
