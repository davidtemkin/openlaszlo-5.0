// dev-reload-client.js — injected by the dynamic server in dev mode (never by static hosts).
// Protocol: docs/superpowers/specs/2026-07-06-live-reload-design.md. One console line on
// unavailability; reconnect with capped backoff; reload on changed / on bootId change.
(function () {
  var loadedAt = Date.now();
  var bootId = null, everConnected = false, attempts = 0;
  var quieted = false;
  function quiet() { if (!quieted) { quieted = true; console.log("[dev-reload] unavailable; live reload off"); } }
  function connect() {
    var ws;
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/dev-reload"); }
    catch (e) { return quiet(); }
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.op === "hello") {
        everConnected = true; attempts = 0;
        if (bootId && m.bootId !== bootId) { location.reload(); return; }   // server restarted while we were away
        bootId = m.bootId;
        ws.send(JSON.stringify({ op: "watch", app: location.pathname, loadedAt: loadedAt }));
      } else if (m.op === "changed") location.reload();
    };
    ws.onclose = function () {
      if (!everConnected) return quiet();               // endpoint absent (static host / --no-reload): go quiet
      attempts++;
      setTimeout(connect, Math.min(8000, 250 * Math.pow(2, attempts)));
    };
  }
  connect();
})();
