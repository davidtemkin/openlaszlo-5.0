import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createReloadHub } from "../../server/dev-reload.mjs";
import { decodeFrames } from "../../server/connection.mjs";

const DISTRO = path.resolve("/D");
const mkHub = (stats) => createReloadHub({
  distro: DISTRO, runtime: path.join(DISTRO, "runtime"),
  statFn: (p) => { const s = stats.get(p); if (!s) throw new Error("ENOENT"); return s; },
  log: () => {},
});
const fakeSock = () => ({ written: [], write(b) { this.written.push(b); }, destroyed: false, destroy() { this.destroyed = true; }, end() {} });
const frames = (sock) => {
  const { messages } = decodeFrames(Buffer.concat(sock.written.map(b => Buffer.isBuffer(b) ? b : Buffer.from(b))));
  return messages.filter(m => m.text).map(m => JSON.parse(m.text));
};

test("watch seeds from the app file + stored closure; sweep detects change and broadcasts", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx"), incAbs = path.join(DISTRO, "examples/t/inc.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 10 }], [incAbs, { mtimeMs: 1, size: 5 }]]);
  const hub = mkHub(stats);
  hub.noteClosure(app, { entries: [{ id: appAbs, kind: "file" }, { id: incAbs, kind: "file" }] }); // BEFORE watch
  const sock = fakeSock();
  hub.attach(sock);                                    // hello
  const r = hub.watch(app, 5_000, sock);
  assert.equal(r.ok, true); assert.equal(r.stale, false);
  hub.sweepOnce();                                     // baseline established at watch; nothing changed
  stats.set(incAbs, { mtimeMs: 2, size: 5 });          // edit the include
  hub.sweepOnce();                                     // busy sweep — accumulate
  hub.sweepOnce();                                     // quiet sweep — broadcast
  const msgs = frames(sock);
  assert.equal(msgs[0].op, "hello");
  const changed = msgs.find(m => m.op === "changed");
  assert.ok(changed && changed.paths.some(p => p.endsWith("inc.lzx")));
});

test("loadedAt staleness answers changed immediately", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 9_999, size: 10 }]]);
  const hub = mkHub(stats);
  const sock = fakeSock(); hub.attach(sock);
  const r = hub.watch(app, 5_000, sock);               // page loaded before the file's mtime
  assert.equal(r.stale, true);
  assert.ok(frames(sock).some(m => m.op === "changed"));
});

test("watch outside the served root is refused; second watch on a socket is refused", () => {
  const stats = new Map([[path.join(DISTRO, "examples/a.lzx"), { mtimeMs: 1, size: 1 }]]);
  const hub = mkHub(stats);
  const sock = fakeSock(); hub.attach(sock);
  const r = hub.watch("/../etc/passwd", 0, sock);
  assert.ok(r.error);
  const ok = hub.watch("/examples/a.lzx", 0, sock);
  assert.equal(ok.ok, true);
  const again = hub.watch("/examples/a.lzx", 0, sock);
  assert.ok(again.error, "one watch per socket");
});

test("noteRequest joins live sets via referer; denylisted and non-source never join; ring replays", () => {
  const app = "/examples/t/page.html";
  const appAbs = path.join(DISTRO, "examples/t/page.html"), tsAbs = path.join(DISTRO, "examples/t/code.ts");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 1 }], [tsAbs, { mtimeMs: 1, size: 1 }]]);
  const hub = mkHub(stats);
  hub.noteRequest("/examples/t/code.ts", app);          // BEFORE watch → ring
  hub.noteRequest("/runtime/lfc/lfc.js", app);          // denylisted
  hub.noteRequest("/examples/t/pic.png", app);          // not source-typed
  const sock = fakeSock(); hub.attach(sock);
  hub.watch(app, 5_000, sock);
  assert.equal(hub.watchedFiles(app).length, 2);        // page + code.ts (replayed)
  assert.ok(hub.watchedFiles(app).includes(tsAbs));
});

test("poller against a real temp distro: change, delete, reappear, same-second size-change", async () => {
  const os = await import("node:os");
  const fsr = await import("node:fs");
  const tmp = fsr.mkdtempSync(path.join(os.tmpdir(), "olreload-"));
  fsr.mkdirSync(path.join(tmp, "examples"), { recursive: true });
  const appAbs = path.join(tmp, "examples/app.html");
  fsr.writeFileSync(appAbs, "<html>1</html>");
  const hub = createReloadHub({ distro: tmp, runtime: path.join(tmp, "runtime"), log: () => {} }); // REAL statFn
  const sock = fakeSock(); hub.attach(sock);
  hub.watch("/examples/app.html", Date.now() + 1000, sock);
  const changedCount = () => frames(sock).filter(m => m.op === "changed").length;
  const until = async (n) => { for (let i = 0; i < 40 && changedCount() < n; i++) { hub.sweepOnce(); await new Promise(r => setTimeout(r, 5)); } };
  fsr.writeFileSync(appAbs, "<html>2!</html>");            // same-second rewrite, different SIZE
  await until(1); assert.ok(changedCount() >= 1, "size change detected");
  fsr.unlinkSync(appAbs);                                   // delete
  await until(2); assert.ok(changedCount() >= 2, "deletion detected");
  fsr.writeFileSync(appAbs, "<html>3</html>");              // reappear
  await until(3); assert.ok(changedCount() >= 3, "reappearance detected");
  fsr.rmSync(tmp, { recursive: true, force: true });
});

test("grace teardown: last socket close keeps the set for graceMs, then drops it", () => {
  const app = "/examples/t/app.lzx";
  const appAbs = path.join(DISTRO, "examples/t/app.lzx");
  const stats = new Map([[appAbs, { mtimeMs: 1, size: 1 }]]);
  let now = 0;
  const hub = createReloadHub({
    distro: DISTRO, runtime: path.join(DISTRO, "runtime"),
    statFn: (p) => { const s = stats.get(p); if (!s) throw new Error("ENOENT"); return s; },
    graceMs: 10_000, nowFn: () => now, log: () => {},
  });
  const sock = fakeSock(); hub.attach(sock);
  hub.watch(app, 5_000, sock);
  hub.detach(sock);
  assert.equal(hub.appCount(), 1);                      // grace holds it
  now = 11_000; hub.sweepOnce();
  assert.equal(hub.appCount(), 0);
});
