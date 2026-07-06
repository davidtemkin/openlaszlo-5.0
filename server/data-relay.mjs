// data-relay.mjs — the JSON-dataset relay (spec: docs/superpowers/specs/
// 2026-07-06-json-databinding-design.md, "Wire protocol"). A route on the
// shared upgrade dispatcher (/api/data). Dataset-keyed pub/sub with retained
// snapshots: any conforming peer (browser, node, micropython) may subscribe
// and/or publish on one socket. The protocol itself is transport-independent;
// this relay is just the reference server.

import { wsAccept, encodeText, decodeFrames } from "./connection.mjs";
import { resolvePointer } from "../compiler/dist/json-path.js";

const datasets = new Map(); // name -> { data: any|null, subs: Set<socket> }
const entry = (name) => {
  let e = datasets.get(name);
  if (!e) datasets.set(name, e = { data: null, subs: new Set() });
  return e;
};
export function _resetForTests() { datasets.clear(); }

function handle(msg, socket) {
  const send = (m) => { try { socket.write(encodeText(JSON.stringify(m))); } catch {} };
  if (msg.subscribe != null) {
    if (msg.lz !== 1) return send({ dataset: String(msg.subscribe), error: "unsupported protocol version" });
    const e = entry(String(msg.subscribe));
    e.subs.add(socket);
    return send({ dataset: String(msg.subscribe), data: e.data }); // snapshot MUST precede any update
  }
  if (typeof msg.dataset !== "string") return; // malformed: skip
  const e = entry(msg.dataset);
  if ("data" in msg) {
    e.data = msg.data;
    const frame = encodeText(JSON.stringify({ dataset: msg.dataset, data: msg.data }));
    for (const s of e.subs) { try { s.write(frame); } catch {} }
    return;
  }
  if (msg.update && typeof msg.update.path === "string") {
    const r = resolvePointer(e.data, msg.update.path);
    if (!r) return send({ dataset: msg.dataset, error: `update "${msg.update.path}" resolves nothing` });
    r.parent[r.key] = msg.update.value;
    const frame = encodeText(JSON.stringify({ dataset: msg.dataset, update: msg.update }));
    for (const s of e.subs) { try { s.write(frame); } catch {} }
    return;
  }
  // unknown op: skip (a misbehaving peer cannot wedge the relay)
}

export function dataUpgradeHandler(req, socket) {
  if (!wsAccept(req, socket)) return;
  let buf = Buffer.alloc(0);
  const drop = () => { for (const e of datasets.values()) e.subs.delete(socket); };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, closed, rest } = decodeFrames(buf); buf = rest;
    for (const m of messages) {
      if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; }
      if (m.text == null) continue;
      try { handle(JSON.parse(m.text), socket); }
      catch (e) { console.warn("data-relay: malformed frame skipped:", String(e && e.message || e)); }
    }
    if (closed) { drop(); socket.end(); }
  });
  socket.on("close", drop);
  socket.on("error", drop);
}
