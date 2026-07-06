import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApp } from "../dist/lzx-check.js";

const wrap = (body) => `<!doctype html><html><body><laszlo-app>${body}</laszlo-app></body></html>`;
const DS = `<dataset name="bikeshop" type="json"><script type="application/json">
  { "bicycle": [ { "color": "red", "price": 19.95 } ] }
</script></dataset>`;

test("typed data: valid member checks clean; typo is TS2339 on the constraint line", () => {
  const ok = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[*]">
      <lz-text text="\${parent.data.color}"></lz-text></lz-view>`), "app.html");
  assert.deepEqual(ok.findings, []);

  const bad = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[*]">
      <lz-text text="\${parent.data.colour}"></lz-text></lz-view>`), "app.html");
  assert.equal(bad.findings.length, 1);
  // 2339 = does not exist; 2551 = does not exist + did-you-mean suggestion
  assert.ok([2339, 2551].includes(bad.findings[0].code), String(bad.findings[0].code));
  assert.match(bad.findings[0].message, /colour/);
});

test("path validation: unknown dataset, unknown property, selector on non-array", () => {
  const r1 = checkApp(wrap(`${DS}<lz-view datapath="$nope/x[*]"></lz-view>`), "app.html");
  assert.match(r1.findings[0].message, /unknown dataset "\$nope"/);
  const r2 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bike[*]"></lz-view>`), "app.html");
  assert.match(r2.findings[0].message, /unknown property "bike"/);
  const r3 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop/bicycle[0]/color[*]"></lz-view>`), "app.html");
  assert.match(r3.findings[0].message, /not an array/);
});

test("malformed inline JSON and bad path syntax are findings with lines", () => {
  const r = checkApp(wrap(`<dataset name="bad" type="json"><script type="application/json">{oops}</script></dataset>`), "app.html");
  assert.match(r.findings[0].message, /invalid JSON/);
  assert.ok(r.findings[0].line > 0);
  const r2 = checkApp(wrap(`${DS}<lz-view datapath="$bikeshop//x"></lz-view>`), "app.html");
  assert.match(r2.findings[0].message, /segment/);
});

test("relative datapath types against the ancestor datum; classic XPath untouched", () => {
  const nested = checkApp(wrap(`<dataset name="g" type="json"><script type="application/json">
      {"genres":[{"name":"jazz","sub":[{"label":"cool"}]}]}
    </script></dataset>
    <lz-view datapath="$g/genres[*]">
      <lz-view datapath="/sub[*]"><lz-text text="\${parent.data.label}"></lz-text></lz-view>
    </lz-view>`), "app.html");
  assert.deepEqual(nested.findings, []);
  const classic = checkApp(wrap(`<lz-view datapath="dset:/employee"></lz-view>`), "app.html");
  assert.deepEqual(classic.findings, []);
});

test("lz-shape dataset: declared TS literal types data via __LzShape alias", () => {
  const app = wrap(`<dataset name="sensors" type="json" src="ws://h/api/data">
      <script type="application/lz-shape">{ temp: number, readings: number[] }</script>
    </dataset>
    <lz-view datapath="$sensors"><lz-text text="\${parent.data.temp.toFixed(1)}"></lz-text></lz-view>`);
  assert.deepEqual(checkApp(app, "app.html").findings, []);
  const bad = wrap(`<dataset name="sensors" type="json" src="ws://h/api/data">
      <script type="application/lz-shape">{ temp: number }</script>
    </dataset>
    <lz-view datapath="$sensors"><lz-text text="\${parent.data.temperature}"></lz-text></lz-view>`);
  assert.ok([2339, 2551].includes(checkApp(bad, "app.html").findings[0].code));
});

test("shapeless src dataset types data as any (no findings either way)", () => {
  const app = wrap(`<dataset name="x" type="json" src="./x.json"></dataset>
    <lz-view datapath="$x/whatever[*]"><lz-text text="\${parent.data.anything}"></lz-text></lz-view>`);
  assert.deepEqual(checkApp(app, "app.html").findings, []);
});
