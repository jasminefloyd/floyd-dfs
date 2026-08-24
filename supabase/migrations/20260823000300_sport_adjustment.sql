create table if not exists public.floyd_dfs_adjustment_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  sport text not null check (sport in ('NBA', 'WNBA', 'NFL', 'MLB', 'GOLF')),
  adjustment_package jsonb not null,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'BLOCKED')),
  model_name text,
  prompt_version text,
  created_at timestamptz not null default now(),
  constraint floyd_dfs_adjustment_runs_version_positive check (version > 0),
  constraint floyd_dfs_adjustment_runs_unique_version unique (generation_run_id, version)
);

create index if not exists floyd_dfs_adjustment_runs_tenant_created_idx on public.floyd_dfs_adjustment_runs(tenant_id, created_at desc);
create index if not exists floyd_dfs_adjustment_runs_generation_idx on public.floyd_dfs_adjustment_runs(generation_run_id, version desc);

create table if not exists public.floyd_dfs_player_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  adjustment_run_id uuid not null references public.floyd_dfs_adjustment_runs(id) on delete cascade,
  player_id text not null,
  adjustment_type text not null,
  direction text not null check (direction in ('UP', 'DOWN', 'NEUTRAL')),
  magnitude text not null check (magnitude in ('NONE', 'SMALL', 'MODERATE', 'MATERIAL', 'MAJOR')),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  rationale text not null,
  evidence_finding_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists floyd_dfs_player_adjustments_tenant_player_idx on public.floyd_dfs_player_adjustments(tenant_id, player_id, created_at desc);
create index if not exists floyd_dfs_player_adjustments_run_idx on public.floyd_dfs_player_adjustments(adjustment_run_id);

alter table public.floyd_dfs_adjustment_runs enable row level security;
alter table public.floyd_dfs_player_adjustments enable row level security;

drop policy if exists floyd_dfs_adjustment_runs_member_select on public.floyd_dfs_adjustment_runs;
create policy floyd_dfs_adjustment_runs_member_select on public.floyd_dfs_adjustment_runs for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_adjustment_runs_member_insert on public.floyd_dfs_adjustment_runs;
create policy floyd_dfs_adjustment_runs_member_insert on public.floyd_dfs_adjustment_runs for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists floyd_dfs_player_adjustments_member_select on public.floyd_dfs_player_adjustments;
create policy floyd_dfs_player_adjustments_member_select on public.floyd_dfs_player_adjustments for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_player_adjustments_member_insert on public.floyd_dfs_player_adjustments;
create policy floyd_dfs_player_adjustments_member_insert on public.floyd_dfs_player_adjustments for insert to authenticated with check (public.is_tenant_member(tenant_id));
