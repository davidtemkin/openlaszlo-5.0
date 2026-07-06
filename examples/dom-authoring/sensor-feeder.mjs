// sensor-feeder.mjs — a minimal conforming publisher peer for /api/data
// (spec "Wire protocol"): what a micropython device would send. Publishes a
// snapshot, then pointer updates once a second.
//   node examples/dom-authoring/sensor-feeder.mjs [port=8090]
import net from "node:net";
import crypto from "node:crypto";

const port = Number(process.argv[2] || 8090);
const sock = net.connect(port, "127.0.0.1", () => {
  sock.write(`GET /api/data HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
function send(obj) { // masked client frame (RFC 6455)
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  const header = data.length < 126
    ? Buffer.from([0x81, 0x80 | data.length])
    : (() => { const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); return h; })();
  sock.write(Buffer.concat([header, mask, masked]));
}
let up = false;
sock.on("data", () => {
  if (up) return;
  up = true;
  send({ dataset: "sensors", data: { temp: 20, readings: [20] } });
  let t = 20;
  setInterval(() => {
    t = Math.round((t + (Math.random() - 0.5)) * 10) / 10;
    send({ dataset: "sensors", update: { path: "/temp", value: t } });
    send({ dataset: "sensors", data: { temp: t, readings: [t, t - 1, t + 1] } });
  }, 1000);
});
sock.on("error", (e) => { console.error("feeder:", e.message); process.exit(1); });
console.log(`feeding "sensors" via ws://127.0.0.1:${port}/api/data — Ctrl-C to stop`);
