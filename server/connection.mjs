// Persistent-connection server — the Node equivalent of the Java LPS connection
// package (Application / ConnectionGroup / ConnectionAgent). The original pushed
// SWF-encoded bytes over streaming HTTP (Flash-only); we keep the SEMANTICS
// (login → connect → group presence → pub/sub message routing → getList) but speak
// WebSocket with JSON frames, so it works in DHTML. Dependency-free: the WS
// handshake + framing are implemented over the http server's `upgrade` event using
// only node:crypto.
//
// Client→server JSON ops: login{user,password}, connect, disconnect, logout,
//   sendMessage{target,operation,body}, getList{target}.
// Server→client JSON ops: login{status,user}, connect, disconnect, getList{users},
//   userdisconnect{user}, and one message per delivered sendMessage:
//   {op:<operation>, from:<sender>, body:<text>}.

import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const acceptKey = k => crypto.createHash("sha1").update(k + WS_GUID).digest("base64");

// ---- minimal WebSocket frame codec (RFC 6455, the subset we need) ----
function encodeText(str) {
  const data = Buffer.from(str, "utf8");
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, data]);
}
// Pull complete frames out of a buffer. Returns {messages, closed, rest}.
function decodeFrames(buf) {
  const messages = []; let closed = false; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.slice(p, p + 4); p += 4; }
    if (p + len > buf.length) break;                       // wait for the rest
    let payload = buf.slice(p, p + len);
    if (masked) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i & 3]; payload = u; }
    off = p + len;
    if (opcode === 0x8) { closed = true; break; }           // close
    else if (opcode === 0x9) messages.push({ ping: payload }); // ping
    else if (opcode === 0x1) messages.push({ text: payload.toString("utf8") });
    // 0x0 continuation / 0xA pong: ignored (messages are single-frame here)
  }
  return { messages, closed, rest: buf.slice(off) };
}

// ---- groups (an "application" = a named group of connected agents) ----
const groups = new Map();                                   // groupName -> Set<Agent>
const groupOf = name => { let g = groups.get(name); if (!g) groups.set(name, g = new Set()); return g; };

let agentSeq = 1;
class Agent {
  constructor(socket, group) { this.socket = socket; this.group = group; this.id = agentSeq++; this.user = null; this.joined = false; }
  send(obj) { try { this.socket.write(encodeText(JSON.stringify(obj))); } catch {} }
  peers() { return [...groupOf(this.group)]; }
  members() { return this.peers().filter(a => a.joined && a.user).map(a => a.user); }
  broadcast(obj, includeSelf = true) { for (const a of this.peers()) if (a.joined && (includeSelf || a !== this)) a.send(obj); }
}

function handleMessage(agent, msg) {
  const op = msg.op;
  if (op === "login") {
    agent.user = String(msg.user || "guest");
    agent.send({ op: "login", status: "success", user: agent.user });
  } else if (op === "connect") {
    agent.joined = true; groupOf(agent.group).add(agent);
    agent.send({ op: "connect" });
  } else if (op === "sendMessage") {
    // route to the group: target "*" = everyone, else a specific username
    const out = { op: msg.operation || "message", from: agent.user, body: msg.body != null ? msg.body : "" };
    const target = msg.target == null || msg.target === "*" ? "*" : String(msg.target);
    for (const a of agent.peers()) if (a.joined && (target === "*" || a.user === target)) a.send(out);
    agent.send({ op: "sendMessageDset", status: "ok" });    // ack to sender
  } else if (op === "getList") {
    agent.send({ op: "getList", users: agent.members() });
  } else if (op === "disconnect" || op === "logout") {
    leave(agent);
    agent.send({ op: op === "logout" ? "logout" : "disconnect" });
  }
}

function leave(agent) {
  const g = groupOf(agent.group);
  if (g.has(agent)) {
    g.delete(agent); agent.joined = false;
    if (agent.user) for (const a of g) if (a.joined) a.send({ op: "userdisconnect", user: agent.user });
  }
}

// ---- attach to the relay's http server ----
export function attachConnectionServer(httpServer, pathPrefix = "/api/connection") {
  httpServer.on("upgrade", (req, socket) => {
    if (!req.url.startsWith(pathPrefix)) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n");
    // group from query (?app=chat); default "chat"
    const u = new URL(req.url, "http://localhost");
    const agent = new Agent(socket, u.searchParams.get("app") || "chat");
    let buf = Buffer.alloc(0);
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      const { messages, closed, rest } = decodeFrames(buf); buf = rest;
      for (const m of messages) {
        if (m.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, m.ping.length]), m.ping])); continue; } // pong
        try { handleMessage(agent, JSON.parse(m.text)); } catch {}
      }
      if (closed) { leave(agent); socket.end(); }
    });
    socket.on("close", () => leave(agent));
    socket.on("error", () => leave(agent));
  });
  console.log(`  connection (WebSocket) server on ${pathPrefix}`);
}
