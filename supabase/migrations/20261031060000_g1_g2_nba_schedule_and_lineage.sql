-- G1: shared NBA schedule cache. Rows are provider-owned, not tenant-owned;
-- browser roles have no access and application access remains service-role mediated.
create table if not exists public.floyd_dfs_nba_game_schedule (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_game_id text not null,
  season text,
  home_team_id text not null,
  away_team_id text not null,
  home_team_code text not null,
  away_team_code text not null,
  scheduled_start_at timestamptz not null,
  status text not null check (status in ('SCHEDULED','IN_PROGRESS','FINAL','POSTPONED','CANCELLED','UNKNOWN')),
  source text not null,
  retrieved_at timestamptz not null,
  last_confirmed_at timestamptz not null,
  provider_raw_reference jsonb not null default '{}'::jsonb,
  last_refresh_at timestamptz not null default now(),
  last_error text,
  unique (provider, provider_game_id),
  check (home_team_id <> away_team_id),
  check (last_confirmed_at <= retrieved_at)
);

create index if not exists floyd_dfs_nba_game_schedule_upcoming_idx
  on public.floyd_dfs_nba_game_schedule (scheduled_start_at, provider, provider_game_id)
  where status in ('SCHEDULED','IN_PROGRESS');

create table if not exists public.floyd_dfs_nba_game_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_game_id text not null,
  season text,
  home_team_id text not null,
  away_team_id text not null,
  home_team_code text not null,
  away_team_code text not null,
  scheduled_start_at timestamptz not null,
  status text not null check (status in ('SCHEDULED','IN_PROGRESS','FINAL','POSTPONED','CANCELLED','UNKNOWN')),
  source text not null,
  retrieved_at timestamptz not null,
  last_confirmed_at timestamptz not null,
  provider_raw_reference jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  unique (provider, provider_game_id, observed_at),
  check (home_team_id <> away_team_id),
  check (last_confirmed_at <= retrieved_at)
);

create index if not exists floyd_dfs_nba_game_schedule_versions_lookup_idx
  on public.floyd_dfs_nba_game_schedule_versions (provider, provider_game_id, observed_at desc);

create table if not exists public.floyd_dfs_nba_schedule_sync_state (
  provider text primary key,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_due_at timestamptz,
  last_error text,
  game_count integer not null default 0 check (game_count >= 0),
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.floyd_dfs_claim_nba_schedule_sync(p_now timestamptz, p_lease_until timestamptz)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare claimed integer;
begin
  insert into public.floyd_dfs_nba_schedule_sync_state (provider)
  values ('ESPN') on conflict (provider) do nothing;
  update public.floyd_dfs_nba_schedule_sync_state
  set lease_expires_at = p_lease_until, last_attempt_at = p_now, updated_at = p_now
  where provider = 'ESPN' and (lease_expires_at is null or lease_expires_at <= p_now);
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

create or replace function public.floyd_dfs_reject_nba_schedule_version_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'NBA schedule versions are append-only; insert a new observation instead.';
end;
$$;
drop trigger if exists floyd_dfs_nba_game_schedule_versions_append_only on public.floyd_dfs_nba_game_schedule_versions;
create trigger floyd_dfs_nba_game_schedule_versions_append_only
  before update or delete on public.floyd_dfs_nba_game_schedule_versions
  for each row execute function public.floyd_dfs_reject_nba_schedule_version_mutation();

do $$
declare target text;
begin
  foreach target in array array['floyd_dfs_nba_game_schedule','floyd_dfs_nba_game_schedule_versions','floyd_dfs_nba_schedule_sync_state'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;
revoke all on function public.floyd_dfs_reject_nba_schedule_version_mutation() from public, anon, authenticated;
grant execute on function public.floyd_dfs_reject_nba_schedule_version_mutation() to service_role;
revoke all on function public.floyd_dfs_claim_nba_schedule_sync(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.floyd_dfs_claim_nba_schedule_sync(timestamptz, timestamptz) to service_role;

comment on table public.floyd_dfs_nba_game_schedule is 'Shared normalized NBA game schedule cache; DraftKings contest lock times are stored separately in run inputs.';
comment on table public.floyd_dfs_nba_game_schedule_versions is 'Append-only provider observations of schedule changes, including postponements and reschedules.';

-- G2: preserve explicit decision/source lineage fields and valid/knowledge
-- times for resolved facts. Existing columns are reused for model versions,
-- random_seed and created_at rather than duplicated.
alter table public.floyd_dfs_generation_run_lineage
  add column if not exists sport text,
  add column if not exists decision_cutoff timestamptz,
  add column if not exists snapshot_hash text,
  add column if not exists source_manifest_hash text,
  add column if not exists driver_policy_version text,
  add column if not exists contest_terms_hash text;

alter table public.floyd_dfs_resolved_facts
  add column if not exists effective_at timestamptz,
  add column if not exists ingested_at timestamptz;

drop trigger if exists floyd_dfs_resolved_facts_append_only_trg on public.floyd_dfs_resolved_facts;
update public.floyd_dfs_resolved_facts as fact
set ingested_at = coalesce(fact.ingested_at, fact.created_at),
    effective_at = coalesce(fact.effective_at, (
      select case when count(distinct observation.effective_at) = 1 then min(observation.effective_at) else null end
      from public.floyd_dfs_source_observations as observation
      where observation.tenant_id = fact.tenant_id
        and observation.id = any(fact.observation_ids)
        and observation.effective_at is not null
    ))
where fact.ingested_at is null or fact.effective_at is null;

alter table public.floyd_dfs_resolved_facts
  alter column ingested_at set default now(),
  alter column ingested_at set not null;

create index if not exists floyd_dfs_resolved_facts_effective_ingested_idx
  on public.floyd_dfs_resolved_facts (tenant_id, event_id, subject_id, fact_type, effective_at, ingested_at)
  where effective_at is not null;

drop trigger if exists floyd_dfs_resolved_facts_append_only_trg on public.floyd_dfs_resolved_facts;
create trigger floyd_dfs_resolved_facts_append_only_trg
  before update or delete on public.floyd_dfs_resolved_facts
  for each row execute function public.floyd_dfs_reject_immutable_evidence_mutation();

comment on column public.floyd_dfs_resolved_facts.effective_at is 'Valid/event time inherited from supporting source observations; null means no valid-time anchor was established.';
comment on column public.floyd_dfs_resolved_facts.ingested_at is 'Knowledge time at which this immutable resolution entered the evidence store.';
