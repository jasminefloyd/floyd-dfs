-- P02 contract support. Every row belongs to the fixed floyd-dfs tenant.
do $$
declare target text; constraint_row record;
begin
  foreach target in array array['floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components','floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions'] loop
    if to_regclass('public.' || target) is null then continue; end if;
    for constraint_row in select c.conname, pg_get_constraintdef(c.oid) as definition from pg_constraint c where c.conrelid = to_regclass('public.' || target) and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%sport%' loop
      execute format('alter table public.%I drop constraint %I', target, constraint_row.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (sport in (''NBA'',''WNBA'',''MLB'',''GOLF'',''NFL'',''CFB''))', target, target || '_p02_sport_check');
  end loop;
end $$;

alter table public.floyd_dfs_source_observations
  add column if not exists game_id text,
  add column if not exists value_unit text,
  add column if not exists published_at timestamptz,
  add column if not exists duplicate_cluster_id text;
alter table public.floyd_dfs_resolved_facts
  add column if not exists canonical_fact_key text,
  add column if not exists supporting_observation_ids uuid[] not null default '{}',
  add column if not exists rejected_observation_ids uuid[] not null default '{}',
  add column if not exists decision_at timestamptz;
alter table public.floyd_dfs_quantitative_adjustments
  add column if not exists game_id text,
  add column if not exists operation text not null default 'ADD' check (operation in ('ADD','MULTIPLY')),
  add column if not exists amount_value numeric,
  add column if not exists final_value numeric,
  add column if not exists fact_ids text[] not null default '{}',
  add column if not exists cap_applied jsonb,
  add column if not exists outcome text not null default 'APPLIED' check (outcome in ('APPLIED','CONTEXT_ONLY','REJECTED','SUPERSEDED')),
  add column if not exists outcome_reason text;

create unique index if not exists fds_p02_generation_runs_id_tenant_id_uidx on public.generation_runs(id, tenant_id);

create table if not exists public.floyd_dfs_player_provider_mappings (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport in ('NBA','WNBA','MLB','GOLF','NFL','CFB')), canonical_player_id text not null,
  provider text not null, provider_player_id text not null, confidence text not null check (confidence in ('EXACT','HIGH','MEDIUM','LOW')),
  effective_from timestamptz, effective_to timestamptz, content_sha256 text not null, created_at timestamptz not null default now(),
  unique (tenant_id, sport, provider, provider_player_id), unique (tenant_id, sport, canonical_player_id, provider, content_sha256)
);
create index if not exists floyd_dfs_player_provider_mappings_canonical_idx on public.floyd_dfs_player_provider_mappings(tenant_id,sport,canonical_player_id,provider);

create table if not exists public.floyd_dfs_slate_games (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  slate_id text not null, canonical_game_id text not null, sport text not null check (sport in ('NBA','WNBA','MLB','GOLF','NFL','CFB')),
  provider_ids jsonb not null default '{}'::jsonb, team_ids text[] not null default '{}', scheduled_start timestamptz not null,
  lock_time timestamptz, status text not null check (status in ('SCHEDULED','LIVE','FINAL','POSTPONED','CANCELLED','UNKNOWN')),
  content_sha256 text not null, created_at timestamptz not null default now(),
  unique (tenant_id, slate_id, canonical_game_id), unique (tenant_id, slate_id, content_sha256)
);
create index if not exists floyd_dfs_slate_games_start_idx on public.floyd_dfs_slate_games(tenant_id,sport,scheduled_start);

create table if not exists public.floyd_dfs_player_photos (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  canonical_player_id text not null, provider text not null, provider_player_id text, photo_url text,
  retrieved_at timestamptz, verified_at timestamptz, expires_at timestamptz, content_sha256 text not null, created_at timestamptz not null default now(),
  check (photo_url is null or photo_url like 'https://%'), unique (tenant_id, canonical_player_id, provider, content_sha256)
);

create table if not exists public.floyd_dfs_lineup_revisions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  lineup_id text not null, revision bigint not null check (revision > 0), parent_revision bigint,
  generation_run_id uuid,
  input_sha256 text not null, model_sha256 text not null, rules_sha256 text not null, slot_assignments jsonb not null,
  generated_at timestamptz not null, state text not null check (state in ('RECOMMENDED','EXPORTED','USER_CONFIRMED_ENTERED')),
  submission_confirmed_at timestamptz, content_sha256 text not null,
  unique (tenant_id, lineup_id, revision), unique (tenant_id, lineup_id, content_sha256),
  foreign key (generation_run_id, tenant_id) references public.generation_runs(id, tenant_id) on delete restrict,
  check (jsonb_typeof(slot_assignments) = 'object'), check ((state = 'USER_CONFIRMED_ENTERED') = (submission_confirmed_at is not null))
);

create or replace function public.floyd_dfs_validate_lineup_revision()
returns trigger language plpgsql as $$
declare current_revision bigint;
begin
  if tg_op <> 'INSERT' then raise exception 'Lineup revisions are append-only; create a new revision.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.lineup_id, 0));
  select coalesce(max(revision), 0) into current_revision from public.floyd_dfs_lineup_revisions where tenant_id = new.tenant_id and lineup_id = new.lineup_id;
  if new.revision <> current_revision + 1 or new.parent_revision is distinct from nullif(current_revision, 0) then
    raise exception 'Stale lineup revision: expected revision %, parent %.', current_revision + 1, nullif(current_revision, 0) using errcode = '40001';
  end if;
  return new;
end;
$$;
drop trigger if exists floyd_dfs_lineup_revisions_ordered on public.floyd_dfs_lineup_revisions;
create trigger floyd_dfs_lineup_revisions_ordered before insert or update or delete on public.floyd_dfs_lineup_revisions
for each row execute function public.floyd_dfs_validate_lineup_revision();

create table if not exists public.floyd_dfs_swap_plans (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_key text not null, lineup_id text not null, source_revision bigint not null, entry_id text not null, trigger text not null,
  constraint_sha256 text not null, snapshot_sha256 text not null, affected_slots text[] not null, replacement_roster jsonb not null,
  salary_delta numeric not null, point_delta numeric not null, reason text not null, expires_at timestamptz, next_lock_at timestamptz,
  evidence_ids text[] not null default '{}', outcome text not null check (outcome in ('READY','NO_SOLUTION','STALE','LOCKED','UNKNOWN_LOCK_STATE')),
  created_at timestamptz not null default now(), unique (tenant_id, plan_key)
);
create index if not exists floyd_dfs_swap_plans_lineup_idx on public.floyd_dfs_swap_plans(tenant_id,lineup_id,created_at desc);

create table if not exists public.floyd_dfs_provider_health_checks (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  endpoint_key text not null, endpoint_version text not null, environment text not null, sport text, contest_format text,
  resolved_route text not null, started_at timestamptz not null, finished_at timestamptz not null,
  status text not null check (status in ('HEALTHY','EMPTY','UNAVAILABLE','INVALID_SCHEMA','IDENTITY_MISMATCH','STALE','RATE_LIMITED','AUTH_BLOCKED')),
  schema_version text, freshness_check text not null check (freshness_check in ('PASS','FAIL','UNKNOWN')),
  identity_check text not null check (identity_check in ('PASS','FAIL','UNKNOWN')), failure_detail text,
  retry_count integer not null default 0 check (retry_count >= 0), last_successful_compatible_check timestamptz,
  idempotency_key text not null, created_at timestamptz not null default now(), unique (tenant_id, idempotency_key)
);
create index if not exists floyd_dfs_provider_health_endpoint_idx on public.floyd_dfs_provider_health_checks(tenant_id,endpoint_key,finished_at desc);

create table if not exists public.floyd_dfs_runtime_health_incidents (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  incident_key text not null, severity text not null check (severity in ('INFO','WARNING','ERROR','CRITICAL')),
  component text not null, safe_summary text not null, details_redacted jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  occurrence_count integer not null default 1 check (occurrence_count > 0), resolved_at timestamptz, unique (tenant_id, incident_key)
);

do $$
declare target text;
begin
  foreach target in array array['floyd_dfs_player_provider_mappings','floyd_dfs_slate_games','floyd_dfs_player_photos','floyd_dfs_lineup_revisions','floyd_dfs_swap_plans','floyd_dfs_provider_health_checks','floyd_dfs_runtime_health_incidents'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target);
    execute format('create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))', target, 'floyd-dfs', 'floyd-dfs');
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;

comment on table public.floyd_dfs_player_provider_mappings is 'Tenant-owned canonical player to provider ID mappings; preserve provider IDs as strings.';
comment on table public.floyd_dfs_slate_games is 'Tenant-owned explicit game association for multi-game slates.';
comment on table public.floyd_dfs_player_photos is 'Tenant-owned verified photo cache metadata. Null means no known photo URL.';
comment on table public.floyd_dfs_lineup_revisions is 'Append-only lineup revisions; export is distinct from confirmed DraftKings submission.';
comment on table public.floyd_dfs_swap_plans is 'Tenant-owned idempotent swap plans protected by source revision and hashes.';
comment on table public.floyd_dfs_provider_health_checks is 'Tenant-owned provider checks. Never store auth headers or secrets.';
comment on table public.floyd_dfs_runtime_health_incidents is 'Tenant-owned redacted runtime incidents; never store credentials or raw provider payloads.';
