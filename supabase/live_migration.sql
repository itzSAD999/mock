-- Live Showdown rooms (additive — safe to run on existing projects)
-- Paste into Supabase SQL Editor after schema.sql

-- Allow live sessions on the leaderboard / history
alter table public.sessions drop constraint if exists sessions_kind_check;
alter table public.sessions
  add constraint sessions_kind_check
  check (kind in ('practice', 'selection', 'official_mock', 'live'));

create table if not exists public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'lobby'
    check (status in ('lobby', 'live', 'finished')),
  pack text not null default 'riddles',
  seconds_per_q int not null default 20,
  question_ids text[] not null default '{}',
  label text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_rooms_code_idx on public.live_rooms (code);
create index if not exists live_rooms_status_idx on public.live_rooms (status);

create table if not exists public.live_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.live_rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  participant_id uuid references public.participants (id) on delete set null,
  display_name text not null,
  department text not null default '',
  score int not null default 0,
  answered int not null default 0,
  finished boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists live_players_room_idx on public.live_players (room_id);

alter table public.live_rooms enable row level security;
alter table public.live_players enable row level security;

drop policy if exists "live_rooms_select_anon" on public.live_rooms;
drop policy if exists "live_rooms_insert_anon" on public.live_rooms;
drop policy if exists "live_rooms_update_anon" on public.live_rooms;
drop policy if exists "live_rooms_select_auth" on public.live_rooms;
drop policy if exists "live_rooms_insert_auth" on public.live_rooms;
drop policy if exists "live_rooms_update_auth" on public.live_rooms;

create policy "live_rooms_select_anon" on public.live_rooms for select to anon using (true);
create policy "live_rooms_insert_anon" on public.live_rooms for insert to anon with check (true);
create policy "live_rooms_update_anon" on public.live_rooms for update to anon using (true) with check (true);

create policy "live_rooms_select_auth" on public.live_rooms for select to authenticated using (true);
create policy "live_rooms_insert_auth" on public.live_rooms for insert to authenticated with check (true);
create policy "live_rooms_update_auth" on public.live_rooms for update to authenticated using (true) with check (true);

drop policy if exists "live_players_select_anon" on public.live_players;
drop policy if exists "live_players_insert_anon" on public.live_players;
drop policy if exists "live_players_update_anon" on public.live_players;
drop policy if exists "live_players_select_auth" on public.live_players;
drop policy if exists "live_players_insert_auth" on public.live_players;
drop policy if exists "live_players_update_auth" on public.live_players;

create policy "live_players_select_anon" on public.live_players for select to anon using (true);
create policy "live_players_insert_anon" on public.live_players for insert to anon with check (true);
create policy "live_players_update_anon" on public.live_players for update to anon using (true) with check (true);

create policy "live_players_select_auth" on public.live_players for select to authenticated using (true);
create policy "live_players_insert_auth" on public.live_players for insert to authenticated with check (true);
create policy "live_players_update_auth" on public.live_players for update to authenticated using (true) with check (true);

-- Optional: enable realtime for lobby / start sync
-- In Dashboard → Database → Replication, add live_rooms + live_players if not auto-included.
