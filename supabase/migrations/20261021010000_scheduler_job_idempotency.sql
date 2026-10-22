create table if not exists public.floyd_dfs_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_key text not null,
  job_type text not null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error jsonb,
  result jsonb,
  unique (tenant_id, job_key)
);

alter table public.floyd_dfs_scheduler_runs enable row level security;
revoke all on public.floyd_dfs_scheduler_runs from anon, authenticated;
grant all on public.floyd_dfs_scheduler_runs to service_role;
