create table if not exists public.floyd_dfs_research_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  research_plan jsonb not null,
  research_package jsonb not null,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'BLOCKED')),
  model_name text,
  prompt_version text,
  created_at timestamptz not null default now(),
  constraint research_runs_version_positive check (version > 0),
  constraint research_runs_unique_version unique (generation_run_id, version)
);

create index if not exists floyd_dfs_research_runs_tenant_created_idx on public.floyd_dfs_research_runs(tenant_id, created_at desc);
create index if not exists floyd_dfs_research_runs_generation_idx on public.floyd_dfs_research_runs(generation_run_id, version desc);

create table if not exists public.floyd_dfs_research_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  research_run_id uuid not null references public.floyd_dfs_research_runs(id) on delete cascade,
  bucket text not null,
  subject_type text not null check (subject_type in ('PLAYER', 'TEAM', 'EVENT', 'LEAGUE')),
  subject_id text not null,
  finding text not null,
  source_name text not null,
  source_url text,
  source_tier integer not null check (source_tier between 1 and 4),
  source_purpose text,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists floyd_dfs_research_findings_tenant_subject_idx on public.floyd_dfs_research_findings(tenant_id, subject_id, retrieved_at desc);
create index if not exists floyd_dfs_research_findings_run_idx on public.floyd_dfs_research_findings(research_run_id);

alter table public.floyd_dfs_research_runs enable row level security;
alter table public.floyd_dfs_research_findings enable row level security;

drop policy if exists floyd_dfs_research_runs_member_select on public.floyd_dfs_research_runs;
create policy floyd_dfs_research_runs_member_select on public.floyd_dfs_research_runs for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_research_runs_member_insert on public.floyd_dfs_research_runs;
create policy floyd_dfs_research_runs_member_insert on public.floyd_dfs_research_runs for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists floyd_dfs_research_findings_member_select on public.floyd_dfs_research_findings;
create policy floyd_dfs_research_findings_member_select on public.floyd_dfs_research_findings for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists floyd_dfs_research_findings_member_insert on public.floyd_dfs_research_findings;
create policy floyd_dfs_research_findings_member_insert on public.floyd_dfs_research_findings for insert to authenticated with check (public.is_tenant_member(tenant_id));
