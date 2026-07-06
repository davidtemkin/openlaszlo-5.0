// srvnode.mjs — the server-tag runtime (spec: docs/superpowers/specs/
// 2026-07-06-realtime-bus-design.md, "Server runtime"). PURE: no fs/net;
// bodies arrive ALREADY-TRANSPILED (the bus runs transpileTsBody).
// setAttribute: JSON-guard -> apply -> on<attr> handler -> onDelta hook.

const coerce = (kind, v) => {
  if (v == null) return v;
  if (kind === "number" || kind === "numberExpression" || kind === "size" || kind === "sizeExpression") return Number(v);
  if (kind === "boolean" || kind === "inheritableBoolean") return v === true || v === "true";
  return v;
};

// TRUST BOUNDARY: SrvNode executes <server> bodies from the app document on
// the server's OWN DISK — first-party server code the developer authored,
// exactly like require()ing app code. Remote clients can never inject code:
// the bus only lets them pick which traversal-refused on-disk file to load,
// and set/call are gated to the declared surface. Arg names are still
// identifier-validated (defense in depth against a malformed args= attr
// widening the Function parameter list).
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const checkArgs = (args, where) => {
  for (const a of args) if (!IDENT.test(a)) throw new Error(`invalid arg name ${JSON.stringify(a)} in ${where}`);
  return args;
};

export class SrvNode {
  constructor(tagModel, { defaults = {}, onDelta = () => {} } = {}) {
    this.name = tagModel.name;
    this.__attrs = new Set(tagModel.attrs.map((a) => a.name));
    this.__methods = new Map();
    this.__handlers = new Map();
    this.__onDelta = onDelta;
    for (const a of tagModel.attrs) this[a.name] = coerce(a.declKind, defaults[a.name]);
    for (const m of tagModel.methods) this.__methods.set(m.name, new Function(...checkArgs(m.args, m.name), m.code));
    for (const h of tagModel.handlers) this.__handlers.set(h.name, new Function(...checkArgs(h.args, h.name), h.code));
  }
  hasAttr(a) { return this.__attrs.has(a); }
  hasMethod(m) { return this.__methods.has(m); }
  init() { const h = this.__handlers.get("oninit"); if (h) h.call(this); }
  setAttribute(attr, value) {
    JSON.stringify(value); // throws on cycles/BigInt — a server-code bug, surfaced at the call site
    this[attr] = value;
    const h = this.__handlers.get("on" + attr);
    if (h) h.call(this, value);
    this.__onDelta(this.name, attr, value);
  }
  callMethod(method, args) {
    return this.__methods.get(method).apply(this, args);
  }
  snapshot() {
    const out = {};
    for (const a of this.__attrs) out[a] = this[a];
    return out;
  }
}
