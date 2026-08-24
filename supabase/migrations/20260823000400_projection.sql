create table if not exists public.floyd_dfs_projection_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  sport text not null check (sport in ('NBA', 'WNBA', 'NFL', 'MLB', 'GOLF')),
  model_version text not null,
  simulation_runs integer not null,
  projection_package jsonb not null,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'BLOCKED')),
  created_at timestamptz not null default now(),
  constraint floyd_dfs_projection_runs_version_positive check (version > 0),
  constraint floyd_dfs_projection_runs_unique_version unique (generation_run_id, version)
);

create index if not exists floyd_dfs_projection_runs_tenant_created_idx on public.floyd_dfs_projection_runs(tenant_id, created_at desc);
create index if not exists floyd_dfs_projection_runs_generation_idx on public.floyd_dfs_projection_runs(generation_run_id, version desc);

create table if not exists public.floyd_dfs_player_projections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  projection_run_id uuid not null references public.floyd_dfs_projection_runs(id) on delete cascade,
  player_id text not null,
  baseline_opportunity jsonb not null,
  adjusted_opportunity jsonb not null,
  opportunity_delta jsonb not null,
  component_projection jsonb not null,
  floor_p20 numeric not null,
  median_p50 numeric not null,
  ceiling_p90 numeric not null,
  median_per_1k numeric not null,
  ceiling_per_1k numeric not null,
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  uncertainty_factors jsonb not null default '[]'::jsonb,
  watch_dependencies jsonb not null default '[]'::jsonb,
  model_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists floyd_dfs_player_projections_tenant_player_idx on public.floyd_dfs_player_projections(tenant_id, player_id, created_at desc);
create index if not exists floyd_dfs_player_projections_run_idx on public.floyd_dfs_player_projections(projection_run_id);

alter table public.floyd_dfs_projection_runs enable row level security;
alter table public.floyd_dfs_player_projections enable row level security;

drop policy if exists floyd_dfs_projection_runs_member_select on public.floyd_dfs_projection_runs;
create policy floyd_dfs_projection_runs_member_select on public.floyd_dfs_projection_runs for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_projection_runs_member_insert on public.floyd_dfs_projection_runs;
create policy floyd_dfs_projection_runs_member_insert on public.floyd_dfs_projection_runs for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists floyd_dfs_player_projections_member_select on public.floyd_dfs_player_projections;
create policy floyd_dfs_player_projections_member_select on public.floyd_dfs_player_projections for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_player_projections_member_insert on public.floyd_dfs_player_projections;
create policy floyd_dfs_player_projections_member_insert on public.floyd_dfs_player_projections for insert to authenticated with check (public.is_tenant_member(tenant_id));
