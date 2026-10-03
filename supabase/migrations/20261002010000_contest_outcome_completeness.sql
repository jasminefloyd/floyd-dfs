-- Complete contest metadata for trustworthy outcome reconciliation. Existing rows remain
-- valid but are explicitly incomplete until these fields are supplied from an export.
alter table public.floyd_dfs_contest_results
  add column if not exists contest_id text,
  add column if not exists contest_name text,
  add column if not exists sport text,
  add column if not exists contest_format text,
  add column if not exists field_size integer,
  add column if not exists entry_fee numeric,
  add column if not exists paid_positions integer,
  add column if not exists outcome_source text not null default 'MANUAL',
  add column if not exists external_entry_id text;

alter table public.floyd_dfs_contest_results
  drop constraint if exists floyd_dfs_contest_results_metadata_nonnegative;
alter table public.floyd_dfs_contest_results
  add constraint floyd_dfs_contest_results_metadata_nonnegative
  check ((field_size is null or field_size > 0)
    and (entry_fee is null or entry_fee >= 0)
    and (paid_positions is null or paid_positions > 0));

create index if not exists floyd_dfs_contest_results_contest_idx
  on public.floyd_dfs_contest_results (tenant_id, contest_id, measured_at desc)
  where contest_id is not null;

-- Player measurements are used for calibration and must not be duplicated by repeated imports.
create unique index if not exists floyd_dfs_player_measurements_run_player_idx
  on public.floyd_dfs_player_measurements (tenant_id, generated_lineup_id, player_id);

create table if not exists public.floyd_dfs_historical_player_actuals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  projection_run_id uuid not null references public.floyd_dfs_projection_runs(id) on delete cascade,
  slate_id text not null,
  sport text not null check (sport in ('MLB','WNBA','NFL','CFB','GOLF')),
  event_date date not null,
  player_id text not null,
  provider_player_id text,
  player_name text not null,
  team text,
  position text,
  model_version text not null,
  projection_generated_at timestamptz not null,
  lock_time timestamptz not null,
  projected_floor numeric,
  projected_median numeric,
  projected_ceiling numeric,
  baseline_fppg numeric,
  actual_dk_points numeric not null,
  actual_components jsonb not null default '{}'::jsonb,
  provider text not null,
  identity_match text not null check (identity_match in ('PROVIDER_ID','NAME_AND_TEAM')),
  imported_at timestamptz not null default now(),
  unique (tenant_id, projection_run_id, player_id)
);

create index if not exists floyd_dfs_historical_player_actuals_eval_idx
  on public.floyd_dfs_historical_player_actuals (tenant_id, sport, event_date, model_version);
