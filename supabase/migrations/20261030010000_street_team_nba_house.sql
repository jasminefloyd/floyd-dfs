-- P1 additive intelligence and NBA House contracts. Existing tables and applied
-- migrations remain untouched. Browser roles receive no direct table access.

-- generation_runs.id is globally unique, but the tenant-safe foreign keys below
-- require a matching composite key for Postgres to enforce tenant ownership.
create unique index if not exists generation_runs_id_tenant_id_uidx
  on public.generation_runs (id, tenant_id);

create table if not exists public.floyd_dfs_intel_collection_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  provider text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null check (status in ('PENDING','RUNNING','COMPLETE','PARTIAL','FAILED')),
  idempotency_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, tenant_id),
  unique (tenant_id, sport, provider, idempotency_key),
  check (window_end >= window_start),
  check ((status = 'RUNNING' and finished_at is null) or (status <> 'RUNNING'))
);

create table if not exists public.floyd_dfs_intel_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  collection_run_id uuid not null,
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  provider text not null,
  source_record_id text,
  source_url text,
  subject_kind text not null check (subject_kind in ('PLAYER','TEAM','EVENT','LEAGUE')),
  subject_id text not null,
  claim text not null,
  classification text not null check (classification in ('OFFICIAL_CONFIRMED','CORROBORATED_REPORT','SINGLE_SOURCE_REPORT','HYPOTHESIS','STALE','SUPERSEDED')),
  confidence numeric not null check (confidence between 0 and 1),
  published_at timestamptz,
  effective_at timestamptz,
  observed_at timestamptz not null,
  retrieved_at timestamptz not null,
  expires_at timestamptz,
  supersedes_observation_id uuid,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, sport, provider, content_sha256),
  foreign key (collection_run_id, tenant_id)
    references public.floyd_dfs_intel_collection_runs(id, tenant_id) on delete restrict,
  foreign key (supersedes_observation_id, tenant_id)
    references public.floyd_dfs_intel_observations(id, tenant_id) on delete restrict,
  check (source_url is null or source_url like 'https://%'),
  check (retrieved_at >= observed_at),
  check (published_at is null or published_at <= retrieved_at)
);

create index if not exists floyd_dfs_intel_observations_subject_time_idx
  on public.floyd_dfs_intel_observations (tenant_id, sport, subject_kind, subject_id, observed_at desc);
create index if not exists floyd_dfs_intel_observations_time_idx
  on public.floyd_dfs_intel_observations (tenant_id, sport, retrieved_at desc);

create or replace function public.floyd_dfs_intel_observations_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Street Team observations are append-only; insert a superseding observation.';
end;
$$;

drop trigger if exists floyd_dfs_intel_observations_append_only_trg on public.floyd_dfs_intel_observations;
create trigger floyd_dfs_intel_observations_append_only_trg
  before update or delete on public.floyd_dfs_intel_observations
  for each row execute function public.floyd_dfs_intel_observations_append_only();

create table if not exists public.floyd_dfs_intel_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  as_of timestamptz not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  freshness_state text not null check (freshness_state in ('FRESH','STALE','PARTIAL','UNKNOWN')),
  resolved_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(resolved_facts) = 'array'),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, sport, as_of, evidence_hash),
  check (created_at >= as_of)
);

create index if not exists floyd_dfs_intel_snapshots_asof_idx
  on public.floyd_dfs_intel_snapshots (tenant_id, sport, as_of desc);

create table if not exists public.floyd_dfs_intel_snapshot_observations (
  tenant_id uuid not null,
  snapshot_id uuid not null,
  observation_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  primary key (snapshot_id, observation_id),
  unique (snapshot_id, ordinal),
  foreign key (snapshot_id, tenant_id)
    references public.floyd_dfs_intel_snapshots(id, tenant_id) on delete cascade,
  foreign key (observation_id, tenant_id)
    references public.floyd_dfs_intel_observations(id, tenant_id) on delete restrict
);

create table if not exists public.floyd_dfs_behavior_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  player_id text,
  team_id text,
  source_observation_id uuid not null,
  signal_type text not null,
  claim text not null,
  evidence_class text not null check (evidence_class in ('OFFICIAL_CONFIRMED','CORROBORATED_REPORT','SINGLE_SOURCE_REPORT','HYPOTHESIS')),
  confidence numeric check (confidence between 0 and 1),
  model_effect numeric,
  effect_status text not null default 'REPORT_ONLY' check (effect_status in ('REPORT_ONLY','VALIDATION_REQUIRED','APPROVED')),
  model_version text,
  effective_at timestamptz,
  observed_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (source_observation_id, tenant_id)
    references public.floyd_dfs_intel_observations(id, tenant_id) on delete restrict,
  check (player_id is not null or team_id is not null),
  check (effect_status = 'APPROVED' or model_effect is null or model_effect = 0),
  check (effect_status <> 'APPROVED' or (model_effect is not null and model_version is not null))
);

create index if not exists floyd_dfs_behavior_signals_subject_time_idx
  on public.floyd_dfs_behavior_signals (tenant_id, sport, observed_at desc);

create table if not exists public.floyd_dfs_house_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport = 'NBA'),
  generation_run_id uuid,
  intel_snapshot_id uuid not null,
  model_version text not null,
  baseline_model_version text not null,
  forecast_cutoff timestamptz not null,
  baseline jsonb not null,
  adjustments jsonb not null,
  scenario_metadata jsonb not null default '{}'::jsonb,
  trust_status text not null check (trust_status in ('VALIDATED','UNVALIDATED','PARTIAL','BLOCKED')),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (generation_run_id, tenant_id)
    references public.generation_runs(id, tenant_id) on delete restrict,
  foreign key (intel_snapshot_id, tenant_id)
    references public.floyd_dfs_intel_snapshots(id, tenant_id) on delete restrict,
  check (created_at >= forecast_cutoff)
);

create index if not exists floyd_dfs_house_reports_tenant_created_idx
  on public.floyd_dfs_house_reports (tenant_id, sport, created_at desc);

do $$
declare target text;
begin
  foreach target in array array[
    'floyd_dfs_intel_collection_runs',
    'floyd_dfs_intel_observations',
    'floyd_dfs_intel_snapshots',
    'floyd_dfs_intel_snapshot_observations',
    'floyd_dfs_behavior_signals',
    'floyd_dfs_house_reports'
  ] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target);
    execute format('create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))', target, 'floyd-dfs', 'floyd-dfs');
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;

revoke all on function public.floyd_dfs_intel_observations_append_only() from public, anon, authenticated;
grant execute on function public.floyd_dfs_intel_observations_append_only() to service_role;

comment on table public.floyd_dfs_intel_observations is 'Append-only, sport-scoped Street Team observations independent of a slate or generation run.';
comment on table public.floyd_dfs_intel_snapshots is 'Immutable point-in-time intelligence view; snapshot observations are linked by tenant-safe foreign keys.';
comment on table public.floyd_dfs_behavior_signals is 'Behavioral context defaults to report-only; numerical effects require an approved model version.';
comment on table public.floyd_dfs_house_reports is 'Versioned NBA House report tied to a tenant-safe intelligence snapshot and forecast cutoff.';
