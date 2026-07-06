// wsclient.mjs — dep-free WebSocket TEST client (masked frames per RFC 6455).
// Moved verbatim from bus-integration.test.mjs so other suites (json-relay)
// can share it without re-registering the bus tests on import.

import crypto from "node:crypto";
import net from "node:net";
import { decodeFrames } from "../../../server/connection.mjs";

// Minimal dep-free WS TEST client. Client->server frames MUST be masked (RFC 6455).
export function encodeTextMasked(str) {
  const data = Buffer.from(str, "utf8");
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  let header;
  const len = data.length;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  return Buffer.concat([header, mask, masked]);
}

/** Open a raw WS to `path` on `port`; returns {send(obj), next():Promise<obj>, close()}. */
export function wsClient(port, path) {
  const sock = net.connect(port, "127.0.0.1");
  const queue = [];
  const waiters = [];
  let buf = Buffer.alloc(0);
  let up = false;
  const ready = new Promise((res, rej) => {
    sock.on("connect", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!up) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        if (!buf.slice(0, idx).toString().includes("101")) return rej(new Error("no 101: " + buf.slice(0, 40)));
        buf = buf.slice(idx + 4);
        up = true;
        res();
      }
      const { messages, rest } = decodeFrames(buf);
      buf = rest;
      for (const m of messages) if (m.text != null) {
        const obj = JSON.parse(m.text);
        const w = waiters.shift();
        if (w) w(obj); else queue.push(obj);
      }
    });
    sock.on("error", rej);
    // A destroyed unclaimed socket produces a clean FIN with NO 'error' event —
    // without this, an await on `ready` for a refused path hangs the suite.
    sock.on("close", () => { if (!up) rej(new Error("connection refused before 101")); });
  });
  return {
    ready,
    send: (obj) => sock.write(encodeTextMasked(JSON.stringify(obj))),
    next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)),
    close: () => sock.destroy(),
    destroyed: () => sock.destroyed,
  };
}
