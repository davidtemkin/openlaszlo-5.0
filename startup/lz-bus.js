// lz-bus.js — client side of the realtime bus (spec: docs/superpowers/specs/
// 2026-07-06-realtime-bus-design.md, "Client runtime").
//
// Split: busPrelude() returns a CLASSIC-JS string prepended to the app blob
// (runs after the LFC, before app code) that creates the proxies; connectBus()
// runs as a module on the page and bridges them to the WebSocket. Proxies are
// permanent singletons mutated in place — constraints captured them by
// reference at bind time.

/** Read declarations from the LIVE <server> element (before cleanup removes it). */
export function extractServerDecls(serverEl) {
  const decls = [];
  for (const tagEl of [...serverEl.children]) {
    const tag = tagEl.getAttribute("name");
    if (!tag) continue;
    const attrs = [], methods = [];
    for (const c of [...tagEl.children]) {
      const t = c.tagName.toLowerCase();
      if (t === "attribute") attrs.push({ name: c.getAttribute("name"), value: c.getAttribute("value"), type: c.getAttribute("type") || "" });
      else if (t === "method") methods.push({ name: c.getAttribute("name") });
    }
    decls.push({ tag, attrs, methods });
  }
  return decls;
}

const coerceJs = `function __lzCoerce(t, v) {
  if (v == null) return v;
  if (t === "number" || t === "size") return Number(v);
  if (t === "boolean") return v === "true" || v === true;
  return v;
}`;

/** The proxy prelude. MUST create instanceof-LzEventable objects — the LFC
 *  SILENTLY NULLS constraint dependencies that fail `dp instanceof LzEventable`
 *  (applyConstraintExpr, release build: empty catch). */
export function busPrelude(decls) {
  return `// lz-bus proxy prelude (generated)
(function () {
  var DECLS = ${JSON.stringify(decls)};
  var P = window.__lzBusProxies = {};
  var Q = window.__lzBusQueue = [];
  var C = window.__lzBusCalls = {};
  var uid = 0;
  ${coerceJs}
  window.__lzBusSend = function (m) { JSON.stringify(m); Q.push(m); }; // JSON guard at the call site
  window.server = {};
  DECLS.forEach(function (d) {
    var o = new LzEventable();
    d.attrs.forEach(function (a) { o[a.name] = __lzCoerce(a.type, a.value); });
    // Server-authoritative: SEND, never apply locally (deltas apply via the
    // ORIGINAL LzEventable.prototype.setAttribute in connectBus).
    o.setAttribute = function (n, v) { window.__lzBusSend({ op: "set", tag: d.tag, attr: n, value: v }); };
    d.methods.forEach(function (m) {
      o[m.name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var id = ++uid;
        var settle = {};
        var prom = new Promise(function (res, rej) { settle.res = res; settle.rej = rej; });
        C[id] = settle;
        window.__lzBusSend({ op: "call", tag: d.tag, method: m.name, args: args, uid: id });
        return prom;
      };
    });
    P[d.tag] = o;
    window.server[d.tag] = o;
  });
})();
`;
}

/** Bridge the proxies to the WebSocket. Reconnects with capped backoff; every
 *  (re)connect applies a fresh snapshot through the ORIGINAL setter so
 *  constraints converge. */
export function connectBus(appPath) {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/bus?app=" + encodeURIComponent(appPath.replace(/^\//, ""));
  let tries = 0;
  const waitForProxies = (fn, n = 0) => {
    if (window.__lzBusProxies) return fn();
    if (n > 200) return console.warn("lz-bus: proxies never appeared");
    setTimeout(() => waitForProxies(fn, n + 1), 50);
  };
  const apply = (tag, attr, value) => {
    const o = window.__lzBusProxies[tag];
    if (o) LzEventable.prototype.setAttribute.call(o, attr, value); // fires on<attr> -> constraints
  };
  const open = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      const q = window.__lzBusQueue.splice(0);
      window.__lzBusSend = (m) => { JSON.stringify(m); ws.send(JSON.stringify(m)); };
      q.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.op === "snapshot") for (const [tag, attrs] of Object.entries(m.tags)) for (const [a, v] of Object.entries(attrs)) apply(tag, a, v);
      else if (m.op === "delta") apply(m.tag, m.attr, m.value);
      else if (m.op === "result") { const c = window.__lzBusCalls[m.uid]; if (c) { delete window.__lzBusCalls[m.uid]; c.res(m.value); } }
      else if (m.op === "error") {
        if (m.uid != null) { const c = window.__lzBusCalls[m.uid]; if (c) { delete window.__lzBusCalls[m.uid]; c.rej(new Error(m.message)); } }
        else console.warn("lz-bus:", m.message);
      }
    };
    ws.onclose = () => {
      window.__lzBusSend = (m) => { JSON.stringify(m); window.__lzBusQueue.push(m); };
      const delay = Math.min(15000, 1000 * Math.pow(2, tries++));
      setTimeout(open, delay);
    };
    ws.onerror = () => { if (tries === 0) console.warn("lz-bus: WebSocket unavailable (static host?) — server state stays at defaults"); };
  };
  waitForProxies(open);
}
