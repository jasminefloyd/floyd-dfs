-- Preserve actual-source quality, quarantine unresolved lineup scores, and retain
-- official field entries as append-only evaluation evidence.
alter table public.floyd_dfs_historical_player_actuals
  add column if not exists source_validation_status text not null default 'UNVERIFIED',
  add column if not exists source_validation_reason text,
  add column if not exists contest_format text,
  add column if not exists source_retrieved_at timestamptz,
  add column if not exists finality_status text not null default 'UNVERIFIED';

alter table public.floyd_dfs_historical_player_actuals
  drop constraint if exists floyd_dfs_historical_player_actuals_source_validation_check;
alter table public.floyd_dfs_historical_player_actuals
  add constraint floyd_dfs_historical_player_actuals_source_validation_check
  check (source_validation_status in ('VERIFIED','INVALID_SOURCE','UNVERIFIED'));

alter table public.floyd_dfs_historical_player_actuals
  drop constraint if exists floyd_dfs_historical_player_actuals_finality_check;
alter table public.floyd_dfs_historical_player_actuals
  add constraint floyd_dfs_historical_player_actuals_finality_check
  check (finality_status in ('PROVISIONAL','FINAL','CORRECTED','UNVERIFIED'));

alter table public.floyd_dfs_contest_results
  add column if not exists reconciliation_status text not null default 'UNVERIFIED',
  add column if not exists model_evaluation_eligible boolean not null default false,
  add column if not exists official_outcome boolean not null default false;

alter table public.floyd_dfs_contest_results
  drop constraint if exists floyd_dfs_contest_results_reconciliation_status_check;
alter table public.floyd_dfs_contest_results
  add constraint floyd_dfs_contest_results_reconciliation_status_check
  check (reconciliation_status in ('UNVERIFIED','MATCHED','MISMATCH','SOURCE_INVALID','UNAVAILABLE','REVIEWED'));

-- Existing component-score disagreements are quarantined until a verified source or
-- documented manual review resolves them. No legacy result is silently trusted.
update public.floyd_dfs_contest_results
set reconciliation_status = case
      when result_payload->'reconciliation'->>'status' = 'SCORE_MISMATCH' then 'MISMATCH'
      when result_payload->'reconciliation'->>'status' = 'MATCHED' then 'MATCHED'
      else 'UNVERIFIED'
    end,
    model_evaluation_eligible = coalesce(result_payload->'reconciliation'->>'status' = 'MATCHED' and official_outcome, false)
where reconciliation_status = 'UNVERIFIED';

create table if not exists public.floyd_dfs_player_actual_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  projection_run_id uuid not null references public.floyd_dfs_projection_runs(id) on delete cascade,
  sport text not null check (sport in ('MLB','WNBA','NFL','CFB','GOLF')),
  event_date date not null,
  player_id text not null,
  actual_dk_points numeric not null,
  actual_components jsonb not null default '{}'::jsonb,
  source text not null,
  source_validation_status text not null check (source_validation_status in ('VERIFIED','INVALID_SOURCE','UNVERIFIED')),
  source_validation_reason text,
  finality_status text not null check (finality_status in ('PROVISIONAL','FINAL','CORRECTED','UNVERIFIED')),
  source_retrieved_at timestamptz,
  content_sha256 text not null,
  imported_at timestamptz not null default now(),
  unique (tenant_id, projection_run_id, player_id, content_sha256)
);
create index if not exists floyd_dfs_actual_revisions_lookup_idx
  on public.floyd_dfs_player_actual_revisions (tenant_id, sport, event_date, player_id, imported_at desc);
alter table public.floyd_dfs_player_actual_revisions enable row level security;
create or replace function public.floyd_dfs_reject_evidence_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Evidence revisions are append-only; insert a new revision instead.';
end;
$$;
drop trigger if exists floyd_dfs_run_data_snapshots_immutable on public.floyd_dfs_run_data_snapshots;
create trigger floyd_dfs_run_data_snapshots_immutable
before update or delete on public.floyd_dfs_run_data_snapshots
for each row execute function public.floyd_dfs_reject_evidence_mutation();
drop trigger if exists floyd_dfs_player_actual_revisions_immutable on public.floyd_dfs_player_actual_revisions;
create trigger floyd_dfs_player_actual_revisions_immutable
before update or delete on public.floyd_dfs_player_actual_revisions
for each row execute function public.floyd_dfs_reject_evidence_mutation();

create table if not exists public.floyd_dfs_contest_field_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contest_id text not null,
  external_entry_id text not null,
  sport text not null check (sport in ('MLB','WNBA','NFL','CFB','GOLF','NBA')),
  contest_format text not null check (contest_format in ('CLASSIC','SHOWDOWN')),
  field_size integer not null check (field_size > 0),
  entry_fee numeric not null check (entry_fee >= 0),
  paid_positions integer not null check (paid_positions > 0 and paid_positions <= field_size),
  finish_position integer not null check (finish_position > 0 and finish_position <= field_size),
  actual_dk_points numeric not null,
  payout numeric not null check (payout >= 0),
  player_ids text[] not null,
  outcome_source text not null default 'DRAFTKINGS_STANDINGS_CSV',
  finality_status text not null default 'FINAL' check (finality_status in ('PROVISIONAL','FINAL','CORRECTED')),
  source_sha256 text not null,
  imported_at timestamptz not null default now(),
  unique (tenant_id, contest_id, external_entry_id, source_sha256)
);
create index if not exists floyd_dfs_contest_field_entries_contest_idx
  on public.floyd_dfs_contest_field_entries (tenant_id, contest_id, finish_position);
alter table public.floyd_dfs_contest_field_entries enable row level security;
drop trigger if exists floyd_dfs_contest_field_entries_immutable on public.floyd_dfs_contest_field_entries;
create trigger floyd_dfs_contest_field_entries_immutable
before update or delete on public.floyd_dfs_contest_field_entries
for each row execute function public.floyd_dfs_reject_evidence_mutation();

create table if not exists public.floyd_dfs_lesson_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contest_key text not null,
  sport text not null,
  stage text not null,
  observation text not null,
  generated_lineup_id uuid not null references public.floyd_dfs_generated_lineups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, contest_key, sport, stage, observation)
);
alter table public.floyd_dfs_lesson_observations enable row level security;
drop trigger if exists floyd_dfs_lesson_observations_immutable on public.floyd_dfs_lesson_observations;
create trigger floyd_dfs_lesson_observations_immutable
before update or delete on public.floyd_dfs_lesson_observations
for each row execute function public.floyd_dfs_reject_evidence_mutation();

comment on table public.floyd_dfs_player_actual_revisions is 'Append-only provisional/final/corrected official player actual snapshots; the latest verified revision feeds evaluation.';
comment on table public.floyd_dfs_contest_field_entries is 'Normalized DraftKings standings rows for held-out contest-field simulation validation.';
comment on table public.floyd_dfs_lesson_observations is 'Deduplicates learning evidence by contest so multiple entries in one slate do not count as independent repetitions.';
