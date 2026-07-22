-- bus_messages: table-backed tag storage for the Supabase transport demo
-- (spec: docs/superpowers/specs/2026-07-06-supabase-transport-design.md).
-- Apply via the Supabase dashboard SQL editor (project is outside the MCP org).
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
create index bus_messages_app_id on public.bus_messages (app, id);
-- REQUIRED for postgres_changes delivery (silent non-delivery without it):
alter publication supabase_realtime add table public.bus_messages;
