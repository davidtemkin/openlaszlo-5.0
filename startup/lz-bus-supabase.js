// lz-bus-supabase.js — Supabase Realtime bridge for the bus (spec:
// docs/superpowers/specs/2026-07-06-supabase-transport-design.md).
// 3b: one channel per app (`lzbus:<path>`) carrying broadcast{self:true} +
// presence; joiners adopt the OLDEST peer's non-empty presence-carried state.
// 3c: per table tag, subscribe postgres_changes FIRST, then select, dedupe
// by id. All state applies via the ORIGINAL LzEventable.prototype.setAttribute.
// Pure decision helpers exported for unit tests; window/* touched only
// inside functions (module is Node-importable for tests).

/** Oldest-joined peer's NON-EMPTY state (the room's longest-converged view), or null. */
export function pickAdoptionSource(presenceState) {
  let best = null;
  for (const metas of Object.values(presenceState || {})) {
    for (const m of metas || []) {
      if (!m || typeof m.joined_at !== "number" || !m.state || typeof m.state !== "object"
          || Object.keys(m.state).length === 0) continue; // empty-state seniors never win
      if (!best || m.joined_at < best.joined_at) best = m;
    }
  }
  return best ? best.state : null;
}

/** Immutable id-deduped append; null when the record is already present. */
export function dedupeAppend(rows, record) {
  if ((rows || []).some((r) => r.id === record.id)) return null;
  return [...rows, record];
}

const VENDOR = "vendor/supabase-js-2.110.0.js";

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

export function connectSupabase(decls, appPath) {
  const path = appPath.replace(/^\//, "");
  const waitForProxies = (fn, n = 0) => {
    if (window.__lzBusProxies) return fn();
    if (n > 200) return console.warn("lz-bus: proxies never appeared");
    setTimeout(() => waitForProxies(fn, n + 1), 50);
  };
  waitForProxies(async () => {
    try {
    if (!window.supabase) await loadScript(new URL(VENDOR, import.meta.url).href);
    const client = window.supabase.createClient(decls.url, decls.key, { auth: { persistSession: false } });
    const P = window.__lzBusProxies;
    const C = window.__lzBusCalls;
    let fresh = true; // never applied any EPHEMERAL tag state -> adoption allowed
    // apply = raw (presence count AND table rows use it — neither may block
    // adoption: table state lives in a different authority domain, and peer
    // presence state can never contain rows);
    // applyState = EPHEMERAL tag state (delta/echo/adoption; clears fresh).
    const apply = (tag, attr, value) => {
      const o = P[tag];
      if (o) LzEventable.prototype.setAttribute.call(o, attr, value);
    };
    const applyState = (tag, attr, value) => { fresh = false; apply(tag, attr, value); };
    const localState = {}; // our presence meta mirror
    const joinedAt = Date.now();

    // ── 3b: the app channel (broadcast + presence) ──
    const chan = client.channel("lzbus:" + path, { config: { broadcast: { self: true } } });
    chan.on("broadcast", { event: "lzbus" }, ({ payload: m }) => {
      if (m && m.op === "delta") applyState(m.tag, m.attr, m.value);
    });
    chan.on("presence", { event: "sync" }, () => {
      const state = chan.presenceState();
      let count = 0;
      for (const metas of Object.values(state)) count += metas.length;
      apply("presence", "count", count); // raw: never blocks adoption
      if (fresh) {
        const adopted = pickAdoptionSource(state);
        if (adopted) for (const [tag, attrs] of Object.entries(adopted))
          for (const [a, v] of Object.entries(attrs)) applyState(tag, a, v);
      }
    });

    // sender path: set -> broadcast (self-echo applies) + presence meta
    const doSet = (m) => {
      (localState[m.tag] = localState[m.tag] || {})[m.attr] = m.value;
      chan.send({ type: "broadcast", event: "lzbus", payload: { op: "delta", tag: m.tag, attr: m.attr, value: m.value } });
      chan.track({ state: localState, joined_at: joinedAt });
    };

    // ── 3c: per table tag ──
    const tableTags = decls.tags.filter((t) => t.table);
    const doInsert = async (m) => {
      const tag = decls.tags.find((t) => t.tag === m.tag);
      const settle = C[m.uid];
      try {
        const { error } = await client.from(tag.table).insert({ ...m.record, app: path });
        if (error) throw error;
        if (settle) { delete C[m.uid]; settle.res(null); } // v1: resolves null — accepted divergence
      } catch (e) {
        if (settle) { delete C[m.uid]; settle.rej(e instanceof Error ? e : new Error(String(e.message || e))); }
      }
    };
    for (const t of tableTags) {
      // SUBSCRIBE FIRST, then select, dedupe by id (spec race rule).
      client.channel("lzbus-table:" + path + ":" + t.tag)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: t.table, filter: "app=eq." + path }, (msg) => {
          const next = dedupeAppend(P[t.tag].rows, msg.new);
          if (next) apply(t.tag, "rows", next); // raw: table state never blocks adoption
        })
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            console.warn("lz-bus: table channel " + status + " for " + t.tag);
        });
      client.from(t.table).select("*").eq("app", path).order("id").then(({ data, error }) => {
        if (error) return console.warn("lz-bus: table select failed:", error.message);
        let rows = P[t.tag].rows;
        for (const r of data || []) { const next = dedupeAppend(rows, r); if (next) rows = next; }
        apply(t.tag, "rows", rows); // raw: table state never blocks adoption
      });
    }

    chan.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        const q = window.__lzBusQueue.splice(0);
        const route = (m) => m.op === "insert" ? doInsert(m)
          : m.op === "set" ? doSet(m)
          : console.warn("lz-bus: unsupported op in supabase mode:", m.op);
        window.__lzBusSend = (m) => { JSON.stringify(m); route(m); };
        q.forEach(route);
        chan.track({ state: localState, joined_at: joinedAt });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("lz-bus: supabase channel " + status + " — check the project's Realtime 'Allow public access' setting");
      }
    });
    } catch (e) {
      // Spec degradation contract: one warning, defaults hold.
      console.warn("lz-bus: supabase transport unavailable — server state stays at defaults:", e && e.message);
    }
  });
}
