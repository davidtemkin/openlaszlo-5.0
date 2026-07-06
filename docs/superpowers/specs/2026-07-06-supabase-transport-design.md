# Supabase Realtime Transport (Slice 3b) + Table-Backed Tags (3c)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** Slice 3 (the realtime bus, `docs/superpowers/specs/2026-07-06-realtime-bus-design.md`). Slice 3's spec reserved this as the "Slice 3b" roadmap item.

## Goal

Shared state on **static hosting**. The Slice-3 bus requires the Node server;
this slice adds a second transport — **Supabase Realtime** — so DOM-dialect
apps served from GitHub Pages (or any static host) get:

- **3b (ephemeral):** peer-converged shared attributes over Realtime
  *broadcast*, with *presence* (who's online, and presence-carried state for
  late joiners) — no schema, no server, state lives in the room;
- **3c (durable):** *table-backed tags* — a Postgres table bound into
  constraints as a live `rows` array via a Realtime subscription, with an
  RLS-gated `insert` — multiuser state that survives everyone leaving.

The demo: one static page, two browsers — ephemeral shared counter, live
presence count, persistent chat.

## Principles

1. **The Slice-3 client core is untouched.** Same `LzEventable` proxy
   prelude, same constraint binding, same "state changes when the delta
   arrives" discipline — only the bridge behind `__lzBusSend`/apply differs.
   Transport is a per-app choice, not a fork.
2. **No secrets in markup.** Only the publishable key ever appears
   (public by design); RLS is the authorization boundary (Supabase skill
   security checklist). `supabase-js` is vendored and version-pinned into
   the distro (static-host friendly; npm-security pinning guidance).
3. **Typed discipline carries over.** `lzx-check` knows the transport:
   `<method>`/`<handler>` in supabase mode are findings (no execution home);
   table-backed tags type `rows` and `insert`; `server.presence.count` is a
   typed built-in.
4. **Verify against current Supabase docs at implementation time** (the
   platform changes fast — skill principle 1). Facts below were verified
   2026-07-06: broadcast via client-libs/REST/database; public vs private
   topics; presence sync events; `postgres_changes` supported with
   `broadcast_changes` triggers as the newer scale path.

## Authoring

```html
<server transport="supabase"
        supabase-url="https://<ref>.supabase.co"
        supabase-key="<publishable-key>">
  <counter name="state">
    <attribute name="count" type="number" value="0"></attribute>
  </counter>
  <chat name="chat" table="bus_messages">
    <!-- table-backed: rows + insert are BUILT-IN; no attribute/method decls -->
  </chat>
</server>
```

- `transport` absent/`"node"` → Slice-3 behavior exactly (WS to `/api/bus`).
- `transport="supabase"` requires `supabase-url` + `supabase-key` (dialect
  error otherwise).
- A tag WITH `table=` is **table-backed (3c)**; without it, **ephemeral (3b)**.
- In supabase mode, authored `<method>`/`<handler>` on any server tag are
  **checker findings** ("no execution home in supabase mode — use the Node
  bus, or a table-backed tag"); at runtime they are ignored with one console
  warning. (The Edge-Function execution home that would restore them is the
  recorded follow-up, 3b.2.)
- `server.presence` is a **reserved built-in tag name** in supabase mode
  (declaring it is a checker finding): an `LzEventable` proxy with
  `count: number`, live via presence join/leave. **The prelude creates it**
  (alongside the declared-tag proxies, when transport=supabase) — constraints
  referencing `server.presence.count` bind at app start, before the bridge
  connects, so bridge-time creation would be too late.

## Architecture

```
 static host ── app.html ──► laszlo-dom.js bootstrap (unchanged prelude:
                              LzEventable proxies for every declared tag)
                                   │ transport="supabase"?
                                   ▼
                    startup/lz-bus-supabase.js  (lazy module)
                    │ vendored supabase-js (pinned, startup/vendor/)
                    ├─ 3b: channel `lzbus:<app>` broadcast{self:true} + presence
                    └─ 3c: SELECT + postgres_changes INSERT sub + RLS insert
                                   ▼
                         Supabase project (user-provisioned demo;
                         migrations applied via MCP at execution time)
```

### Components

| Unit | Location | Purpose |
| --- | --- | --- |
| transport parsing | `compiler/src/app-model.ts` | `<server transport= supabase-url= supabase-key=>` into the model; supabase-mode findings (methods/handlers, reserved `presence`, missing url/key); `table=` marks table-backed tags |
| checker typing | `compiler/src/app-dts.ts` + `lzx-check.ts` | supabase mode: ephemeral tags = attrs only; table-backed tags get `rows: any[]` + `insert(record: any): Promise<any>`; `presence` built-in typed `{ count: number }`; server-body SECOND program only runs for node transport |
| `lz-bus-supabase.js` | `startup/` (new) | the bridge: channel join, broadcast/presence (3b), table select/subscribe/insert (3c), joiner state adoption — pure decision helpers exported for unit tests |
| vendored client | `startup/vendor/supabase-js-<ver>.js` | pinned ESM build, committed (static hosting; no CDN dependency) |
| bootstrap hook | `startup/laszlo-dom.js` | route to `connectSupabase(cfg)` instead of `connectBus` when the transport says so |
| demo | `examples/dom-authoring/bus-supabase-demo.html` | counter (3b) + presence count + persistent chat (3c), static-hostable |
| migration | `docs/superpowers/assets/2026-07-06-bus-messages.sql` + applied via MCP | `bus_messages` schema + RLS |

## 3b — ephemeral mode semantics

- Channel `lzbus:<app-path>` (public topic), `broadcast: { self: true }`:
  the sender applies its OWN echo — Slice 3's discipline preserved,
  peer-converged (last-write-wins) instead of server-authoritative.
- Every local `set` → (1) broadcast `{op:"delta", tag, attr, value}`,
  (2) `track()` updated presence meta `{ state: {tag:{attr:value,…}},
  joined_at }`.
- **Joiner state adoption:** on the first presence `sync`, adopt the full
  `state` of the peer with the OLDEST `joined_at` (the room's senior holds
  the longest-converged state); no peers → declared defaults. Adoption goes
  through the ORIGINAL setter, so constraints converge exactly like a
  Slice-3 snapshot. Exported as a pure helper
  (`pickAdoptionSource(presences)`) for unit tests.
- `server.presence.count` updates on every presence sync/join/leave.
- Reconnect: supabase-js handles channel rejoin; our `sync` handler re-runs
  adoption only when the local client has never applied any state (a fresh
  boolean, not a heuristic) — an established client keeps its state and
  re-tracks it.

## 3c — table-backed tags

- On join: `select * from <table> where app = <app-path> order by id` fills
  `rows` (applied via the original setter → constraints fire once).
- Live: a `postgres_changes` INSERT subscription (filtered `app=eq.<app>`)
  appends to `rows` and re-fires the setter. (Updates/deletes are out of
  scope v1 — append-only semantics, documented.)
- `insert(record)` — the tag's built-in method: supabase-js insert of
  `{ ...record, app: <app-path> }`; RLS decides. Returns the client
  library's promise (errors reject).
- `rows` is read-only from app code: the proxy's `setAttribute("rows", …)`
  is a console warning + no-op (state authority is the table).

**Schema + RLS (the migration, per the security checklist):**

```sql
create table public.bus_messages (
  id bigint generated always as identity primary key,
  app text not null,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);
alter table public.bus_messages enable row level security;
create policy "bus demo read" on public.bus_messages
  for select to anon, authenticated using (true);
create policy "bus demo write" on public.bus_messages
  for insert to anon, authenticated
  with check (char_length(body) <= 500 and char_length(app) <= 200);
-- realtime: table added to the supabase_realtime publication for
-- postgres_changes (demo scale; broadcast_changes triggers are the
-- documented scale-up path)
```

Data-API exposure + advisors are checked at apply time (MCP `get_advisors`).

## Provisioning workflow (agreed)

The user creates the demo project (free tier) in the dashboard; when it
appears in MCP `list_projects`, execution applies the migration
(`apply_migration`), verifies with `get_advisors` + a test insert/select,
and reads the URL + publishable key (`get_project_url`,
`get_publishable_keys`) into the demo page. The demo page's committed copy
carries the real demo-project values (public by design).

## Error handling & degradation

- Missing/invalid supabase config → dialect/checker error (build-time),
  console error + defaults at runtime.
- Supabase unreachable → one console warning; proxies hold defaults
  (same degradation contract as Slice 3's static-host case); supabase-js
  reconnects when it can.
- RLS-rejected insert → the `insert()` promise rejects (surfaced to the
  caller; the demo shows a console error).
- Presence adoption never overwrites locally-applied state (the fresh flag).

## Testing

1. **Unit (Node, no network):** transport parsing + supabase-mode findings
   (methods/handlers flagged, reserved `presence`, url/key required,
   `table=` detection); `pickAdoptionSource` (empty / single / multi-peer,
   oldest-wins, malformed meta ignored); table-backed typing (`rows`,
   `insert`, read-only rows).
2. **Live E2E (two Playwright tabs on the STATIC server + the demo
   project):** counter crosses tabs via broadcast (constraint-refire canary
   rides again, now serverless); presence count reads 2, drops to 1 on tab
   close; chat insert appears in both tabs AND survives a reload of both
   (durability); joiner-adoption: bump the counter, open a third tab,
   assert it adopts the bumped value.
3. **Advisors clean** after the migration (MCP `get_advisors`, security +
   performance).

## Non-goals (v1)

Edge-Function execution home (3b.2 — restores methods/handlers serverless);
private channels / authenticated users; `broadcast_changes` triggers;
UPDATE/DELETE sync on table-backed tags; conflict resolution beyond
last-write-wins; offline queueing; Slice-4 replicator integration (3c's
`rows` array is its precursor — a `<replicator>` bound to `rows` is the
natural join point once Slice 4 lands).
