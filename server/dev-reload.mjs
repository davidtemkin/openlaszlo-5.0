// server/dev-reload.mjs — dev live reload (spec: docs/superpowers/specs/2026-07-06-live-reload-design.md).
// Pure core (filters, injection, sweep coalescing) + the hub/WS shell. Dev-only; --no-reload disables.
import path from "node:path";

const SRC_EXT = /\.(lzx|html|ts|js)$/i;
const DENY_PREFIX = ["/runtime/", "/compiler/", "/startup/", "/lps/"];
export const WATCH_CAP = 100;

export const isSourceTypeUrl = (p) => SRC_EXT.test(p);
export const isDenylistedUrl = (p) =>
  DENY_PREFIX.some((pre) => p.startsWith(pre)) || p.includes("/lps/resources/");

export function filterClosureEntries(entries, { distro, runtime }) {
  const under = (base, id) => id.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  const files = [];
  for (const e of entries || []) {
    if (e.kind !== "file") continue;
    if (!under(distro, e.id)) continue;
    if (under(runtime, e.id) || under(path.join(distro, "compiler"), e.id) || under(path.join(distro, "startup"), e.id)) continue;
    files.push(e.id);
  }
  const dropped = Math.max(0, files.length - WATCH_CAP);
  return { files: files.slice(0, WATCH_CAP), dropped };
}

export function injectHtml(html, tag) {
  if (!tag) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tag + "</head>");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, tag + "</body>");
  return html + tag;
}

export function nextSweep(state, changed, maxBusy = 6) {
  const pending = new Set(state.pending);
  for (const c of changed) pending.add(c);
  if (changed.length === 0) {
    if (pending.size > 0) return { broadcast: [...pending], state: { pending: new Set(), busy: 0 } };
    return { broadcast: null, state: { pending, busy: 0 } };
  }
  const busy = state.busy + 1;
  if (busy >= maxBusy) return { broadcast: [...pending], state: { pending: new Set(), busy: 0 } };
  return { broadcast: null, state: { pending, busy } };
}
