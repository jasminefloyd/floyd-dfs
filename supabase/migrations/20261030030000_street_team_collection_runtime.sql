-- P2 collection execution metadata and immutable point-in-time snapshots.
alter table public.floyd_dfs_intel_collection_runs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 1 check (attempt_count > 0),
  add column if not exists result jsonb,
  add column if not exists error jsonb;

alter table public.floyd_dfs_intel_snapshots
  add column if not exists snapshot_payload jsonb;

create or replace function public.floyd_dfs_create_intel_snapshot_with_evidence(p_snapshot jsonb, p_evidence_links jsonb)
returns uuid
language plpgsql
set search_path = pg_catalog
as $$
declare
  snapshot_uuid uuid;
  snapshot_tenant uuid;
begin
  snapshot_uuid := (p_snapshot->>'id')::uuid;
  snapshot_tenant := (p_snapshot->>'tenant_id')::uuid;
  if p_snapshot->>'sport' <> 'NBA' then raise exception 'P2 Street Team snapshots are NBA-only.'; end if;
  if jsonb_typeof(p_evidence_links) <> 'array' then raise exception 'P2 snapshot evidence links must be an array.'; end if;

  insert into public.floyd_dfs_intel_snapshots (id, tenant_id, sport, as_of, evidence_hash, freshness_state, resolved_facts, snapshot_payload)
  values (snapshot_uuid, snapshot_tenant, 'NBA', (p_snapshot->>'as_of')::timestamptz, p_snapshot->>'evidence_hash', p_snapshot->>'freshness_state', p_snapshot->'resolved_facts', p_snapshot->'snapshot_payload');

  insert into public.floyd_dfs_intel_snapshot_observations (tenant_id, snapshot_id, observation_id, ordinal)
  select snapshot_tenant, snapshot_uuid, links.observation_id::uuid, links.ordinal
  from jsonb_to_recordset(p_evidence_links) as links(observation_id text, ordinal integer);

  return snapshot_uuid;
end;
$$;

revoke all on function public.floyd_dfs_create_intel_snapshot_with_evidence(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.floyd_dfs_create_intel_snapshot_with_evidence(jsonb, jsonb) to service_role;

create index if not exists floyd_dfs_intel_collection_runs_recent_idx
  on public.floyd_dfs_intel_collection_runs (tenant_id, sport, started_at desc);

create or replace function public.floyd_dfs_intel_snapshots_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Street Team snapshots are immutable; create a new as-of snapshot.';
end;
$$;

drop trigger if exists floyd_dfs_intel_snapshots_append_only_trg on public.floyd_dfs_intel_snapshots;
create trigger floyd_dfs_intel_snapshots_append_only_trg
  before update or delete on public.floyd_dfs_intel_snapshots
  for each row execute function public.floyd_dfs_intel_snapshots_append_only();

create or replace function public.floyd_dfs_intel_snapshot_observations_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Street Team snapshot evidence links are immutable.';
end;
$$;

drop trigger if exists floyd_dfs_intel_snapshot_observations_append_only_trg on public.floyd_dfs_intel_snapshot_observations;
create trigger floyd_dfs_intel_snapshot_observations_append_only_trg
  before update or delete on public.floyd_dfs_intel_snapshot_observations
  for each row execute function public.floyd_dfs_intel_snapshot_observations_append_only();

revoke all on function public.floyd_dfs_intel_snapshots_append_only() from public, anon, authenticated;
revoke all on function public.floyd_dfs_intel_snapshot_observations_append_only() from public, anon, authenticated;
grant execute on function public.floyd_dfs_intel_snapshots_append_only() to service_role;
grant execute on function public.floyd_dfs_intel_snapshot_observations_append_only() to service_role;

comment on column public.floyd_dfs_intel_collection_runs.lease_expires_at is 'P2 worker lease; expired leases may be reclaimed after an interrupted invocation.';
comment on column public.floyd_dfs_intel_collection_runs.result is 'Persisted provider diagnostics and snapshot reference for idempotent retry responses.';
