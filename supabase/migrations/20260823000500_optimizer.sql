create table if not exists public.floyd_dfs_optimization_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  objective_profile jsonb not null,
  optimizer_package jsonb not null,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'BLOCKED')),
  created_at timestamptz not null default now(),
  constraint floyd_dfs_optimization_runs_version_positive check (version > 0),
  constraint floyd_dfs_optimization_runs_unique_version unique (generation_run_id, version)
);

create index if not exists floyd_dfs_optimization_runs_tenant_created_idx on public.floyd_dfs_optimization_runs(tenant_id, created_at desc);
create index if not exists floyd_dfs_optimization_runs_generation_idx on public.floyd_dfs_optimization_runs(generation_run_id, version desc);

create table if not exists public.floyd_dfs_lineup_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  optimization_run_id uuid not null references public.floyd_dfs_optimization_runs(id) on delete cascade,
  candidate_key text not null,
  salary_used integer not null,
  salary_remaining integer not null,
  floor numeric not null,
  median numeric not null,
  ceiling numeric not null,
  correlation_score numeric not null,
  optimal_lineup_frequency numeric not null,
  top_one_percent_frequency numeric not null,
  ownership_estimate numeric not null,
  leverage_score numeric not null,
  duplication_risk text not null check (duplication_risk in ('LOW', 'MEDIUM', 'HIGH')),
  estimated_duplicates numeric not null,
  median_rank integer not null,
  ceiling_rank integer not null,
  tournament_rank integer not null,
  candidate_types jsonb not null default '[]'::jsonb,
  roster_slots jsonb not null,
  game_script_cluster text not null,
  strategic_similarity numeric not null,
  risk_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists floyd_dfs_lineup_candidates_tenant_idx on public.floyd_dfs_lineup_candidates(tenant_id, median desc);
create index if not exists floyd_dfs_lineup_candidates_run_idx on public.floyd_dfs_lineup_candidates(optimization_run_id, tournament_rank);

alter table public.floyd_dfs_optimization_runs enable row level security;
alter table public.floyd_dfs_lineup_candidates enable row level security;

drop policy if exists floyd_dfs_optimization_runs_member_select on public.floyd_dfs_optimization_runs;
create policy floyd_dfs_optimization_runs_member_select on public.floyd_dfs_optimization_runs for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_optimization_runs_member_insert on public.floyd_dfs_optimization_runs;
create policy floyd_dfs_optimization_runs_member_insert on public.floyd_dfs_optimization_runs for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists floyd_dfs_lineup_candidates_member_select on public.floyd_dfs_lineup_candidates;
create policy floyd_dfs_lineup_candidates_member_select on public.floyd_dfs_lineup_candidates for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_lineup_candidates_member_insert on public.floyd_dfs_lineup_candidates;
create policy floyd_dfs_lineup_candidates_member_insert on public.floyd_dfs_lineup_candidates for insert to authenticated with check (public.is_tenant_member(tenant_id));
