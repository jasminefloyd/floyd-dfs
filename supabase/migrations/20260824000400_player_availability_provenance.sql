-- Provider reconciliation metadata. DraftKings remains authoritative for
-- contest membership, player IDs, and salary; SportsDataIO contributes only
-- time-stamped availability/lineup state.
alter table if exists public.dk_contest_players
  add column if not exists availability_status text,
  add column if not exists availability_confirmed boolean not null default false,
  add column if not exists availability_source text,
  add column if not exists availability_retrieved_at timestamptz,
  add column if not exists availability_provider_player_id text,
  add column if not exists availability_payload jsonb not null default '{}'::jsonb,
  add column if not exists salary_source text not null default 'DRAFTKINGS_API',
  add column if not exists salary_retrieved_at timestamptz,
  add column if not exists salary_payload jsonb not null default '{}'::jsonb;

create index if not exists dk_contest_players_availability_idx
  on public.dk_contest_players(contest_id, availability_status, availability_confirmed);
