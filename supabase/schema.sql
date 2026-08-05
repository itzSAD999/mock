-- COS Quiz Drill — Supabase schema
-- Run this in the Supabase SQL Editor (Project → SQL → New query).

create extension if not exists "pgcrypto";

-- Participants (name + department, no auth accounts)
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  department text not null default '',
  name_key text not null,
  created_at timestamptz not null default now(),
  unique (name_key, department)
);

create index if not exists participants_name_key_idx
  on public.participants (name_key);

-- Quiz / trial / mock sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  kind text not null check (kind in ('practice', 'selection', 'official_mock')),
  mode text not null default 'contest',
  round_id text,
  label text,
  score int not null default 0,
  total int not null default 0,
  elapsed_sec int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index if not exists sessions_participant_idx
  on public.sessions (participant_id);

create index if not exists sessions_kind_idx
  on public.sessions (kind);

create index if not exists sessions_finished_idx
  on public.sessions (finished_at desc);

-- Per-answer analytics
create table if not exists public.answers (
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

create index if not exists answers_session_idx
  on public.answers (session_id);

create index if not exists answers_question_idx
  on public.answers (question_id);

create index if not exists answers_topic_idx
  on public.answers (topic);

-- RLS: anon insert/select for this internal team tool
alter table public.participants enable row level security;
alter table public.sessions enable row level security;
alter table public.answers enable row level security;

drop policy if exists "participants_select_anon" on public.participants;
drop policy if exists "participants_insert_anon" on public.participants;
drop policy if exists "participants_update_anon" on public.participants;
drop policy if exists "sessions_select_anon" on public.sessions;
drop policy if exists "sessions_insert_anon" on public.sessions;
drop policy if exists "answers_select_anon" on public.answers;
drop policy if exists "answers_insert_anon" on public.answers;

create policy "participants_select_anon"
  on public.participants for select to anon using (true);

create policy "participants_insert_anon"
  on public.participants for insert to anon with check (true);

create policy "participants_update_anon"
  on public.participants for update to anon using (true) with check (true);

create policy "sessions_select_anon"
  on public.sessions for select to anon using (true);

create policy "sessions_insert_anon"
  on public.sessions for insert to anon with check (true);

create policy "answers_select_anon"
  on public.answers for select to anon using (true);

create policy "answers_insert_anon"
  on public.answers for insert to anon with check (true);

-- Helpful view for leaderboard joins
create or replace view public.session_leaderboard as
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
  p.department
from public.sessions s
join public.participants p on p.id = s.participant_id
order by pct desc, s.elapsed_sec asc, s.finished_at desc;

grant select on public.session_leaderboard to anon;
