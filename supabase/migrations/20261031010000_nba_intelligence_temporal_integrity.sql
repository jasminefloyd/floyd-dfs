-- G2 additive temporal evidence and immutable run-lineage contracts.
-- Existing evidence, projection, run, snapshot, and lineup tables are preserved.

alter table public.floyd_dfs_source_observations
  add column if not exists ingested_at timestamptz,
  add column if not exists raw_payload_sha256 text,
  add column if not exists schema_version smallint;

update public.floyd_dfs_source_observations
set ingested_at = coalesce(ingested_at, created_at),
    raw_payload_sha256 = coalesce(raw_payload_sha256, encode(extensions.digest(convert_to(raw_payload::text, 'UTF8'), 'sha256'), 'hex')),
    schema_version = coalesce(schema_version, 1)
where ingested_at is null or raw_payload_sha256 is null or schema_version is null;

alter table public.floyd_dfs_source_observations
  alter column ingested_at set default now(),
  alter column ingested_at set not null,
  alter column raw_payload_sha256 set not null,
  alter column schema_version set default 2,
  alter column schema_version set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.floyd_dfs_source_observations'::regclass and conname = 'floyd_dfs_source_observations_raw_payload_sha256_check') then
    alter table public.floyd_dfs_source_observations add constraint floyd_dfs_source_observations_raw_payload_sha256_check check (raw_payload_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.floyd_dfs_source_observations'::regclass and conname = 'floyd_dfs_source_observations_schema_version_check') then
    alter table public.floyd_dfs_source_observations add constraint floyd_dfs_source_observations_schema_version_check check (schema_version between 1 and 2);
  end if;
end $$;

alter table public.floyd_dfs_intel_observations
  add column if not exists ingested_at timestamptz,
  add column if not exists raw_payload_sha256 text,
  add column if not exists schema_version smallint;

-- The original observation rows are immutable. This migration only backfills
-- newly added metadata columns, so suspend that guard for this transactional
-- backfill and restore it immediately afterward.
alter table public.floyd_dfs_intel_observations
  disable trigger floyd_dfs_intel_observations_append_only_trg;

update public.floyd_dfs_intel_observations
set ingested_at = coalesce(ingested_at, created_at),
    raw_payload_sha256 = coalesce(raw_payload_sha256, encode(extensions.digest(convert_to(raw_payload::text, 'UTF8'), 'sha256'), 'hex')),
    schema_version = coalesce(schema_version, 1)
where ingested_at is null or raw_payload_sha256 is null or schema_version is null;

alter table public.floyd_dfs_intel_observations
  enable trigger floyd_dfs_intel_observations_append_only_trg;

alter table public.floyd_dfs_intel_observations
  alter column ingested_at set default now(),
  alter column ingested_at set not null,
  alter column raw_payload_sha256 set not null,
  alter column schema_version set default 2,
  alter column schema_version set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.floyd_dfs_intel_observations'::regclass and conname = 'floyd_dfs_intel_observations_raw_payload_sha256_check') then
    alter table public.floyd_dfs_intel_observations add constraint floyd_dfs_intel_observations_raw_payload_sha256_check check (raw_payload_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.floyd_dfs_intel_observations'::regclass and conname = 'floyd_dfs_intel_observations_schema_version_check') then
    alter table public.floyd_dfs_intel_observations add constraint floyd_dfs_intel_observations_schema_version_check check (schema_version between 1 and 2);
  end if;
end $$;

create index if not exists floyd_dfs_source_observations_effective_ingested_idx
  on public.floyd_dfs_source_observations (tenant_id, sport, subject_kind, subject_id, effective_at, ingested_at)
  where effective_at is not null;
create index if not exists floyd_dfs_source_observations_ingested_idx
  on public.floyd_dfs_source_observations (tenant_id, sport, ingested_at desc);
create index if not exists floyd_dfs_source_observations_source_record_idx
  on public.floyd_dfs_source_observations (tenant_id, sport, source, source_record_id, effective_at desc)
  where source_record_id is not null;

create index if not exists floyd_dfs_intel_observations_effective_ingested_idx
  on public.floyd_dfs_intel_observations (tenant_id, sport, subject_kind, subject_id, effective_at, ingested_at)
  where effective_at is not null;
create index if not exists floyd_dfs_intel_observations_ingested_idx
  on public.floyd_dfs_intel_observations (tenant_id, sport, ingested_at desc);
create index if not exists floyd_dfs_intel_observations_source_record_idx
  on public.floyd_dfs_intel_observations (tenant_id, sport, provider, source_record_id, effective_at desc)
  where source_record_id is not null;

-- The existing floyd_dfs_intel_snapshot_observations primary key already covers
-- (snapshot_id, observation_id); existing content-hash unique constraints remain
-- the idempotency boundary for the two observation ledgers.

create table if not exists public.floyd_dfs_generation_run_lineage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null,
  revision integer not null check (revision > 0),
  intel_snapshot_id uuid,
  slate_id text not null,
  contest_id text not null,
  event_cutoff timestamptz not null,
  knowledge_cutoff timestamptz not null,
  baseline_model_version text not null,
  house_model_version text,
  simulation_version text,
  optimizer_version text not null,
  field_model_version text,
  random_seed text,
  input_checksums jsonb not null check (jsonb_typeof(input_checksums) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, revision),
  unique (id, tenant_id, generation_run_id, revision),
  foreign key (generation_run_id, tenant_id) references public.generation_runs(id, tenant_id) on delete restrict,
  foreign key (intel_snapshot_id, tenant_id) references public.floyd_dfs_intel_snapshots(id, tenant_id) on delete restrict
);

create index if not exists floyd_dfs_generation_run_lineage_lookup_idx
  on public.floyd_dfs_generation_run_lineage (tenant_id, generation_run_id, revision desc);
create index if not exists floyd_dfs_generation_run_lineage_contest_idx
  on public.floyd_dfs_generation_run_lineage (tenant_id, contest_id, knowledge_cutoff desc);

create table if not exists public.floyd_dfs_run_projection_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generation_run_id uuid not null,
  lineage_revision integer not null,
  artifact_type text not null check (artifact_type in ('BASELINE','ADJUSTED')),
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  slate_id text not null,
  model_version text not null,
  projection_payload jsonb not null,
  adjustment_reason jsonb,
  evidence_ids text[] not null default '{}',
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, generation_run_id, lineage_revision, artifact_type, content_sha256),
  foreign key (tenant_id, generation_run_id, lineage_revision)
    references public.floyd_dfs_generation_run_lineage(tenant_id, generation_run_id, revision) on delete restrict
);

create index if not exists floyd_dfs_run_projection_artifacts_lookup_idx
  on public.floyd_dfs_run_projection_artifacts (tenant_id, generation_run_id, lineage_revision, artifact_type);

create or replace function public.floyd_dfs_reject_immutable_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only; insert a new version instead.', tg_table_name;
end;
$$;

drop trigger if exists floyd_dfs_source_observations_append_only_trg on public.floyd_dfs_source_observations;
create trigger floyd_dfs_source_observations_append_only_trg
  before update or delete on public.floyd_dfs_source_observations
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();
drop trigger if exists floyd_dfs_run_data_snapshots_append_only_trg on public.floyd_dfs_run_data_snapshots;
create trigger floyd_dfs_run_data_snapshots_append_only_trg
  before update or delete on public.floyd_dfs_run_data_snapshots
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();
drop trigger if exists floyd_dfs_resolved_facts_append_only_trg on public.floyd_dfs_resolved_facts;
create trigger floyd_dfs_resolved_facts_append_only_trg
  before update or delete on public.floyd_dfs_resolved_facts
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();
drop trigger if exists floyd_dfs_generation_run_lineage_append_only_trg on public.floyd_dfs_generation_run_lineage;
create trigger floyd_dfs_generation_run_lineage_append_only_trg
  before update or delete on public.floyd_dfs_generation_run_lineage
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();
drop trigger if exists floyd_dfs_run_projection_artifacts_append_only_trg on public.floyd_dfs_run_projection_artifacts;
create trigger floyd_dfs_run_projection_artifacts_append_only_trg
  before update or delete on public.floyd_dfs_run_projection_artifacts
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();

do $$
declare target text;
begin
  foreach target in array array['floyd_dfs_generation_run_lineage','floyd_dfs_run_projection_artifacts'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target);
    execute format('create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))', target, 'floyd-dfs', 'floyd-dfs');
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;

revoke all on function public.floyd_dfs_reject_immutable_evidence_mutation() from public, anon, authenticated;
grant execute on function public.floyd_dfs_reject_immutable_evidence_mutation() to service_role;

comment on column public.floyd_dfs_source_observations.ingested_at is 'When this immutable source observation entered the system; distinct from observed_at and effective_at.';
comment on column public.floyd_dfs_source_observations.raw_payload_sha256 is 'SHA-256 of the exact stored raw_payload JSONB representation.';
comment on column public.floyd_dfs_intel_observations.ingested_at is 'When the Street Team observation entered the system; distinct from observed_at and effective_at.';
comment on table public.floyd_dfs_generation_run_lineage is 'Append-only point-in-time run manifest with exact cutoffs, model versions, seed, and input checksums.';
comment on table public.floyd_dfs_run_projection_artifacts is 'Immutable baseline and adjusted projection packages with nullable adjustment reasons and evidence references.';
