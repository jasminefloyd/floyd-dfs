-- Append-only evidence and model decision artifacts for replaying five-sport runs.
-- API access is service-role mediated and tenant-filtered; RLS prevents browser roles
-- from reading/writing these tables directly until a tenant-membership policy is defined.

create table if not exists public.floyd_dfs_source_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  sport text not null check (sport in ('MLB','NFL','WNBA','CFB','GOLF')),
  event_id text not null,
  source text not null,
  source_record_id text,
  source_url text,
  subject_kind text not null check (subject_kind in ('PLAYER','TEAM','EVENT','VENUE')),
  subject_id text not null,
  fact_type text not null,
  fact_value jsonb not null,
  effective_at timestamptz,
  observed_at timestamptz not null,
  retrieved_at timestamptz not null,
  expires_at timestamptz,
  observation_status text not null check (observation_status in ('CONFIRMED','PROJECTED','REPORTED','UNVERIFIED')),
  identity_confidence text not null check (identity_confidence in ('EXACT','HIGH','LOW','CONFLICT')),
  raw_payload_ref text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, content_sha256)
);

create index if not exists floyd_dfs_source_observations_event_time_idx
  on public.floyd_dfs_source_observations (tenant_id, sport, event_id, observed_at desc);
create index if not exists floyd_dfs_source_observations_subject_time_idx
  on public.floyd_dfs_source_observations (tenant_id, sport, subject_kind, subject_id, observed_at desc);

create table if not exists public.floyd_dfs_resolved_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  event_id text not null,
  subject_id text not null,
  fact_type text not null,
  fact_value jsonb,
  resolution_state text not null check (resolution_state in ('ACCEPTED','CONFLICT','UNKNOWN','EXPIRED')),
  observation_ids uuid[] not null default '{}',
  resolved_at timestamptz not null,
  rule_version text not null,
  rationale text not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, event_id, subject_id, fact_type, content_sha256)
);

create table if not exists public.floyd_dfs_run_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  snapshot_type text not null,
  source text not null,
  source_retrieved_at timestamptz,
  captured_at timestamptz not null default now(),
  content_sha256 text not null,
  payload jsonb not null,
  unique (tenant_id, generation_run_id, snapshot_type, source, content_sha256)
);

create table if not exists public.floyd_dfs_quantitative_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  sport text not null check (sport in ('MLB','NFL','WNBA','CFB','GOLF')),
  player_id text not null,
  dimension text not null,
  before_value numeric not null,
  delta_value numeric not null,
  after_value numeric not null,
  unit text not null,
  evidence_ids text[] not null default '{}',
  scenario_id text,
  model_version text not null,
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, player_id, dimension, content_sha256)
);

create table if not exists public.floyd_dfs_run_trust (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  revision integer not null default 1,
  trust_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, revision)
);

create table if not exists public.floyd_dfs_run_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  scenario_key text not null,
  scenario_type text not null,
  probability numeric check (probability between 0 and 1),
  probability_source text,
  conditions jsonb not null default '{}'::jsonb,
  outcomes jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ACTIVE','CONDITIONAL','UNKNOWN','EXCLUDED')),
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, scenario_key)
);

create table if not exists public.floyd_dfs_player_projection_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  sport text not null check (sport in ('MLB','NFL','WNBA','CFB','GOLF')),
  player_id text not null,
  component text not null,
  baseline_value numeric,
  adjusted_value numeric,
  unit text,
  scenario_id uuid references public.floyd_dfs_run_scenarios(id) on delete set null,
  evidence_ids text[] not null default '{}',
  model_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.floyd_dfs_lineup_decision_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  slate_id text not null,
  lineup_candidate_key text not null,
  trace_payload jsonb not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, lineup_candidate_key, content_sha256)
);

create table if not exists public.floyd_dfs_model_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sport text not null check (sport in ('MLB','NFL','WNBA','CFB','GOLF')),
  contest_format text not null check (contest_format in ('CLASSIC','SHOWDOWN')),
  model_version text not null,
  evaluation_window tstzrange,
  sample_count integer not null check (sample_count >= 0),
  holdout_name text not null,
  metrics jsonb not null,
  data_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.floyd_dfs_sport_release_gates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sport text not null check (sport in ('MLB','NFL','WNBA','CFB','GOLF')),
  contest_format text not null check (contest_format in ('CLASSIC','SHOWDOWN')),
  state text not null check (state in ('RED','YELLOW','GREEN')) default 'RED',
  gate_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, sport, contest_format)
);

create index if not exists floyd_dfs_resolved_facts_event_idx
  on public.floyd_dfs_resolved_facts (tenant_id, event_id, resolved_at desc);
create index if not exists floyd_dfs_adjustments_player_idx
  on public.floyd_dfs_quantitative_adjustments (tenant_id, sport, player_id, created_at desc);
create index if not exists floyd_dfs_projection_components_player_idx
  on public.floyd_dfs_player_projection_components (tenant_id, sport, player_id, created_at desc);

alter table public.floyd_dfs_source_observations enable row level security;
alter table public.floyd_dfs_resolved_facts enable row level security;
alter table public.floyd_dfs_run_data_snapshots enable row level security;
alter table public.floyd_dfs_quantitative_adjustments enable row level security;
alter table public.floyd_dfs_run_trust enable row level security;
alter table public.floyd_dfs_run_scenarios enable row level security;
alter table public.floyd_dfs_player_projection_components enable row level security;
alter table public.floyd_dfs_lineup_decision_traces enable row level security;
alter table public.floyd_dfs_model_evaluations enable row level security;
alter table public.floyd_dfs_sport_release_gates enable row level security;

comment on table public.floyd_dfs_source_observations is 'Append-only, tenant-scoped source assertions; raw payloads must be redacted of secrets.';
comment on table public.floyd_dfs_resolved_facts is 'Versioned fact resolutions derived from immutable source observations.';
comment on table public.floyd_dfs_run_data_snapshots is 'Immutable input snapshots used to reproduce generation-run artifacts.';
