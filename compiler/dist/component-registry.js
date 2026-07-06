// component-registry.ts — curated attribute typing for component-library tags.
// Today lzx-check validates only LFC-schema attrs; component tags (simplelayout,
// flexlayout, …) type as LzView and their own attributes pass silently. This registry
// adds literal validation for curated tags plus view-level layout HINTS (the
// `ignorelayout` precedent: plain attributes any view may carry, read by layouts).
// Slice 6 covers flexlayout only; generalizing is follow-up work.
// Spec: docs/superpowers/specs/2026-07-06-flexlayout-design.md ("Registration & checker").
const FLEX_ENUMS = {
    flexdirection: ["row", "column", "row-reverse", "column-reverse"],
    justifycontent: ["flex-start", "center", "flex-end", "space-between", "space-around"],
    alignitems: ["stretch", "flex-start", "center", "flex-end"],
    flexwrap: ["nowrap", "wrap"],
};
export const COMPONENT_ATTRS = {
    flexlayout: {
        flexdirection: { kind: "enum", values: FLEX_ENUMS.flexdirection },
        justifycontent: { kind: "enum", values: FLEX_ENUMS.justifycontent },
        alignitems: { kind: "enum", values: FLEX_ENUMS.alignitems },
        flexwrap: { kind: "enum", values: FLEX_ENUMS.flexwrap },
        padding: { kind: "number" },
    },
};
export const VIEW_HINTS = {
    flex: { kind: "number" },
    alignself: { kind: "enum", values: FLEX_ENUMS.alignitems },
    margin: { kind: "number" },
};
const NUM_RE = /^-?\d+(\.\d+)?$/;
function ruleIssue(tag, name, value, rule) {
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
export function registryFindings(tag, isViewDerived, attrs) {
    const out = [];
    const own = COMPONENT_ATTRS[tag];
    for (const a of attrs) {
        const rule = (own && own[a.name]) || (isViewDerived ? VIEW_HINTS[a.name] : undefined);
        if (!rule)
            continue;
        const issue = ruleIssue(tag, a.name, a.value, rule);
        if (issue)
            out.push({ message: issue, line: a.line });
    }
    return out;
}
