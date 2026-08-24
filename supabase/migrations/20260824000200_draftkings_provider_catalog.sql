create table if not exists public.dk_contests (
  id uuid primary key default gen_random_uuid(),
  dk_contest_id text not null unique,
  sport text not null,
  league text not null,
  contest_name text not null,
  contest_format text not null check (contest_format in ('CLASSIC','SHOWDOWN')),
  event_name text,
  event_date timestamptz,
  lock_time timestamptz,
  contest_size integer,
  max_entries_allowed integer,
  salary_cap numeric,
  roster_rules jsonb not null default '{}'::jsonb,
  scoring_rules jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  source_type text not null default 'DRAFTKINGS_API',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dk_contest_players (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.dk_contests(id) on delete cascade,
  dk_player_id text not null,
  player_name text not null,
  team text,
  opponent text,
  position text,
  salary numeric,
  captain_salary numeric,
  utility_salary numeric,
  eligibility jsonb not null default '{}'::jsonb,
  provider_status text,
  provider_fppg numeric,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, dk_player_id)
);

create index if not exists dk_contests_sport_lock_idx on public.dk_contests(sport, lock_time);
create index if not exists dk_contest_players_contest_idx on public.dk_contest_players(contest_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.dk_contests'::regclass and tgname = 'dk_contests_set_updated_at') then
    create trigger dk_contests_set_updated_at before update on public.dk_contests for each row execute function public.floyd_dfs_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.dk_contest_players'::regclass and tgname = 'dk_contest_players_set_updated_at') then
    create trigger dk_contest_players_set_updated_at before update on public.dk_contest_players for each row execute function public.floyd_dfs_set_updated_at();
  end if;
end $$;

alter table public.dk_contests enable row level security;
alter table public.dk_contest_players enable row level security;
drop policy if exists dk_contests_authenticated_select on public.dk_contests;
create policy dk_contests_authenticated_select on public.dk_contests for select to authenticated using (true);
drop policy if exists dk_contest_players_authenticated_select on public.dk_contest_players;
create policy dk_contest_players_authenticated_select on public.dk_contest_players for select to authenticated using (true);
