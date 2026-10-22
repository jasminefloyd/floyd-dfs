-- P09: keep each recommendation bound to the tenant-owned fresh generation
-- that produced its candidate roster. No cross-tenant run reference is allowed.
alter table public.floyd_dfs_swap_plans
  add column if not exists generation_run_id uuid;

alter table public.floyd_dfs_swap_plans
  add column if not exists salary_remaining numeric not null default 0,
  add column if not exists mean_delta numeric,
  add column if not exists median_delta numeric,
  add column if not exists risk_flags text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'floyd_dfs_swap_plans_generation_run_tenant_fk'
      and conrelid = 'public.floyd_dfs_swap_plans'::regclass
  ) then
    alter table public.floyd_dfs_swap_plans
      add constraint floyd_dfs_swap_plans_generation_run_tenant_fk
      foreign key (generation_run_id, tenant_id)
      references public.generation_runs(id, tenant_id)
      on delete restrict;
  end if;
end $$;

create index if not exists floyd_dfs_swap_plans_run_idx
  on public.floyd_dfs_swap_plans(tenant_id, generation_run_id)
  where generation_run_id is not null;

comment on column public.floyd_dfs_swap_plans.generation_run_id is
  'Tenant-composite reference to the fresh modeling run that produced this swap recommendation.';

alter table public.floyd_dfs_swap_plans
  drop constraint if exists floyd_dfs_swap_plans_outcome_check;
alter table public.floyd_dfs_swap_plans
  add constraint floyd_dfs_swap_plans_outcome_check
  check (outcome in ('PENDING','READY','NO_SOLUTION','STALE','LOCKED','UNKNOWN_LOCK_STATE'));
