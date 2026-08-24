create table if not exists public.floyd_dfs_selection_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  selection_package jsonb not null,
  status text not null check (status in ('COMPLETE', 'BLOCKED')),
  created_at timestamptz not null default now(),
  constraint floyd_dfs_selection_runs_version_positive check (version > 0),
  constraint floyd_dfs_selection_runs_unique_version unique (generation_run_id, version)
);

create table if not exists public.floyd_dfs_generated_lineups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  selection_run_id uuid not null references public.floyd_dfs_selection_runs(id) on delete cascade,
  candidate_key text not null,
  bullet_number integer not null,
  selection_type text not null,
  lineup_payload jsonb not null,
  status text not null default 'GENERATED' check (status in ('GENERATED', 'ENTERED')),
  entered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint floyd_dfs_generated_lineups_bullet_positive check (bullet_number > 0)
);

create index if not exists floyd_dfs_selection_runs_tenant_created_idx on public.floyd_dfs_selection_runs(tenant_id, created_at desc);
create index if not exists floyd_dfs_generated_lineups_tenant_status_idx on public.floyd_dfs_generated_lineups(tenant_id, status, created_at desc);

alter table public.floyd_dfs_selection_runs enable row level security;
alter table public.floyd_dfs_generated_lineups enable row level security;

drop policy if exists floyd_dfs_selection_runs_member_select on public.floyd_dfs_selection_runs;
create policy floyd_dfs_selection_runs_member_select on public.floyd_dfs_selection_runs for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_selection_runs_member_insert on public.floyd_dfs_selection_runs;
create policy floyd_dfs_selection_runs_member_insert on public.floyd_dfs_selection_runs for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists floyd_dfs_generated_lineups_member_select on public.floyd_dfs_generated_lineups;
create policy floyd_dfs_generated_lineups_member_select on public.floyd_dfs_generated_lineups for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_generated_lineups_member_insert on public.floyd_dfs_generated_lineups;
create policy floyd_dfs_generated_lineups_member_insert on public.floyd_dfs_generated_lineups for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_generated_lineups_member_update on public.floyd_dfs_generated_lineups;
create policy floyd_dfs_generated_lineups_member_update on public.floyd_dfs_generated_lineups for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
