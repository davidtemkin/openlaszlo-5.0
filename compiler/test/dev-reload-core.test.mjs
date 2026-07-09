import { test } from "node:test";
import assert from "node:assert/strict";
import { isSourceTypeUrl, isDenylistedUrl, filterClosureEntries, injectHtml, nextSweep }
  from "../../server/dev-reload.mjs";

test("isSourceTypeUrl", () => {
  for (const p of ["/a/b.lzx", "/a/b.html", "/a/b.ts", "/a/b.js", "/a/B.LZX"]) assert.ok(isSourceTypeUrl(p), p);
  for (const p of ["/a/b.png", "/a/b.css", "/a/b.json", "/a/b"]) assert.ok(!isSourceTypeUrl(p), p);
});

test("isDenylistedUrl", () => {
  for (const p of ["/runtime/lfc/lfc.js", "/compiler/lzc-browser.js", "/startup/laszlo-dom.js",
                   "/lps/includes/explore.css", "/examples/x/lps/resources/lps/components/y.gif"])
    assert.ok(isDenylistedUrl(p), p);
  for (const p of ["/examples/calendar/calendar.lzx", "/coverpages/welcome.lzx"]) assert.ok(!isDenylistedUrl(p), p);
});

test("filterClosureEntries: files under distro only, no runtime/compiler/startup, capped", () => {
  const distro = "/D", runtime = "/D/runtime";
  const mk = (id, kind = "file") => ({ id, kind });
  const r = filterClosureEntries([
    mk("/D/examples/app.lzx"), mk("/D/examples/inc.lzx"),
    mk("/D/runtime/components/lz/button.lzx"), mk("/D/compiler/dist/node.js"),
    mk("/D/startup/urlmap.mjs"), mk("/D/examples", "dir"), mk("/elsewhere/x.lzx"),
  ], { distro, runtime });
  assert.deepEqual(r.files, ["/D/examples/app.lzx", "/D/examples/inc.lzx"]);
  assert.equal(r.dropped, 0);
  const many = Array.from({ length: 150 }, (_, i) => mk(`/D/e/f${i}.lzx`));
  const capped = filterClosureEntries(many, { distro, runtime });
  assert.equal(capped.files.length, 100);
  assert.equal(capped.dropped, 50);
});

test("injectHtml placement", () => {
  const T = "<script>x</script>";
  assert.equal(injectHtml("<html><head></head><body></body></html>", T),
               `<html><head>${T}</head><body></body></html>`);
  assert.equal(injectHtml("<html><body></body></html>", T), `<html><body>${T}</body></html>`);
  assert.equal(injectHtml("<p>bare", T), `<p>bare${T}`);
  assert.equal(injectHtml("<html><head></head></html>", ""), "<html><head></head></html>");   // empty tag = no-op
});

test("nextSweep: quiet-sweep broadcast + liveness bound", () => {
  let s = { pending: new Set(), busy: 0 };
  let r = nextSweep(s, ["/a.lzx"]);                 // busy sweep 1
  assert.equal(r.broadcast, null); s = r.state;
  r = nextSweep(s, []);                             // quiet → flush
  assert.deepEqual(r.broadcast, ["/a.lzx"]); s = r.state;
  assert.equal(s.pending.size, 0); assert.equal(s.busy, 0);
  r = nextSweep(s, []);                             // idle → nothing
  assert.equal(r.broadcast, null); s = r.state;
  for (let i = 0; i < 5; i++) { r = nextSweep(s, [`/f${i}`]); assert.equal(r.broadcast, null, `sweep ${i}`); s = r.state; }
  r = nextSweep(s, ["/f5"]);                        // 6th busy sweep → forced flush
  assert.equal(r.broadcast.length, 6);
});
