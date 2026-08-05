-- COS Quiz Drill — FULL RESET
-- Paste into Supabase SQL Editor and run once.
-- WARNING: deletes all quiz data (participants, sessions, answers).

create extension if not exists "pgcrypto";

-- ========== DROP OLD OBJECTS ==========
drop view if exists public.session_leaderboard cascade;

drop table if exists public.answers cascade;
drop table if exists public.sessions cascade;
drop table if exists public.participants cascade;

-- ========== PARTICIPANTS (accounts + guests) ==========
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  department text not null default '',
  name_key text not null,
  email text,
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (name_key, department)
);

create index participants_name_key_idx on public.participants (name_key);
create index participants_email_idx on public.participants (email);
create index participants_user_id_idx on public.participants (user_id);

-- ========== SESSIONS ==========
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  kind text not null check (kind in ('practice', 'selection', 'official_mock', 'live')),
  mode text not null default 'contest',
  round_id text,
  label text,
  score int not null default 0,
  total int not null default 0,
  elapsed_sec int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index sessions_participant_idx on public.sessions (participant_id);
create index sessions_kind_idx on public.sessions (kind);
create index sessions_finished_idx on public.sessions (finished_at desc);

-- ========== ANSWERS ==========
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  question_id text not null,
  topic text,
  round_id text,
  user_answer text,
  is_correct boolean not null default false,
  marked_override boolean not null default false,
  time_ms int,
  order_index int not null default 0
);

create index answers_session_idx on public.answers (session_id);
create index answers_question_idx on public.answers (question_id);
create index answers_topic_idx on public.answers (topic);

-- ========== RLS ==========
alter table public.participants enable row level security;
alter table public.sessions enable row level security;
alter table public.answers enable row level security;

-- Anon (guest trials + coach reads with anon key)
create policy "participants_select_anon"
  on public.participants for select to anon using (true);
create policy "participants_insert_anon"
  on public.participants for insert to anon with check (true);
create policy "participants_update_anon"
  on public.participants for update to anon using (true) with check (true);
create policy "participants_delete_anon"
  on public.participants for delete to anon using (true);

create policy "sessions_select_anon"
  on public.sessions for select to anon using (true);
create policy "sessions_insert_anon"
  on public.sessions for insert to anon with check (true);
create policy "sessions_delete_anon"
  on public.sessions for delete to anon using (true);

create policy "answers_select_anon"
  on public.answers for select to anon using (true);
create policy "answers_insert_anon"
  on public.answers for insert to anon with check (true);
create policy "answers_delete_anon"
  on public.answers for delete to anon using (true);

-- Authenticated (email/password accounts — no email confirmation required in Auth settings)
create policy "participants_select_auth"
  on public.participants for select to authenticated using (true);
create policy "participants_insert_auth"
  on public.participants for insert to authenticated with check (
    user_id is null or user_id = auth.uid()
  );
create policy "participants_update_auth"
  on public.participants for update to authenticated
  using (user_id = auth.uid() or user_id is null)
  with check (user_id = auth.uid() or user_id is null);

create policy "sessions_select_auth"
  on public.sessions for select to authenticated using (true);
create policy "sessions_insert_auth"
  on public.sessions for insert to authenticated with check (true);

create policy "answers_select_auth"
  on public.answers for select to authenticated using (true);
create policy "answers_insert_auth"
  on public.answers for insert to authenticated with check (true);

-- ========== LEADERBOARD VIEW ==========
create view public.session_leaderboard as
select
  s.id as session_id,
  s.kind,
  s.mode,
  s.round_id,
  s.label,
  s.score,
  s.total,
  case when s.total > 0 then round((s.score::numeric / s.total) * 100) else 0 end as pct,
  s.elapsed_sec,
  s.finished_at,
  p.id as participant_id,
  p.display_name,
  p.department,
  p.email,
  p.user_id
from public.sessions s
join public.participants p on p.id = s.participant_id
order by pct desc, s.elapsed_sec asc, s.finished_at desc;

grant select on public.session_leaderboard to anon;
grant select on public.session_leaderboard to authenticated;

-- ========== LIVE SHOWDOWN (shareable timed rooms) ==========
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

create policy "live_rooms_select_anon" on public.live_rooms for select to anon using (true);
create policy "live_rooms_insert_anon" on public.live_rooms for insert to anon with check (true);
create policy "live_rooms_update_anon" on public.live_rooms for update to anon using (true) with check (true);
create policy "live_rooms_select_auth" on public.live_rooms for select to authenticated using (true);
create policy "live_rooms_insert_auth" on public.live_rooms for insert to authenticated with check (true);
create policy "live_rooms_update_auth" on public.live_rooms for update to authenticated using (true) with check (true);

create policy "live_players_select_anon" on public.live_players for select to anon using (true);
create policy "live_players_insert_anon" on public.live_players for insert to anon with check (true);
create policy "live_players_update_anon" on public.live_players for update to anon using (true) with check (true);
create policy "live_players_select_auth" on public.live_players for select to authenticated using (true);
create policy "live_players_insert_auth" on public.live_players for insert to authenticated with check (true);
create policy "live_players_update_auth" on public.live_players for update to authenticated using (true) with check (true);
