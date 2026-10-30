-- P1 portfolio and model registry contracts. These tables are additive and
-- reference tenant-scoped run/report/lineup records through composite keys.

create unique index if not exists floyd_dfs_model_evaluations_id_tenant_uidx
  on public.floyd_dfs_model_evaluations (id, tenant_id);

create table if not exists public.floyd_dfs_lineup_portfolios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contest_id text not null,
  generation_run_id uuid,
  house_report_id uuid not null,
  model_version text not null,
  entry_count integer not null check (entry_count > 0),
  objective text not null check (objective in ('MAX_EXPECTED_NET_RETURN','MAX_EXPECTED_POINTS','RISK_ADJUSTED_RETURN')),
  payout_status text not null default 'UNAVAILABLE' check (payout_status in ('VERIFIED','INCOMPLETE','UNAVAILABLE')),
  field_model_status text not null default 'UNAVAILABLE' check (field_model_status in ('CALIBRATED','EXPERIMENTAL','UNAVAILABLE')),
  field_model_version text,
  estimated_net_payout numeric,
  expected_profit numeric,
  cash_probability numeric check (cash_probability between 0 and 1),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (generation_run_id, tenant_id)
    references public.generation_runs(id, tenant_id) on delete restrict,
  foreign key (house_report_id, tenant_id)
    references public.floyd_dfs_house_reports(id, tenant_id) on delete restrict,
  check (
    (payout_status = 'VERIFIED' and field_model_status = 'CALIBRATED' and field_model_version is not null)
    or (estimated_net_payout is null and expected_profit is null and cash_probability is null)
  ),
  check (field_model_version is null or length(trim(field_model_version)) > 0)
);

create index if not exists floyd_dfs_lineup_portfolios_contest_created_idx
  on public.floyd_dfs_lineup_portfolios (tenant_id, contest_id, created_at desc);

create table if not exists public.floyd_dfs_portfolio_members (
  tenant_id uuid not null,
  portfolio_id uuid not null,
  lineup_id text not null,
  lineup_revision bigint not null check (lineup_revision > 0),
  entry_status text not null check (entry_status in ('GENERATED','ENTERED','WITHDRAWN')),
  estimated_payout numeric,
  actual_payout numeric,
  entry_fee numeric check (entry_fee is null or entry_fee >= 0),
  created_at timestamptz not null default now(),
  primary key (portfolio_id, lineup_id, lineup_revision),
  foreign key (portfolio_id, tenant_id)
    references public.floyd_dfs_lineup_portfolios(id, tenant_id) on delete cascade,
  foreign key (tenant_id, lineup_id, lineup_revision)
    references public.floyd_dfs_lineup_revisions(tenant_id, lineup_id, revision) on delete restrict
);

create index if not exists floyd_dfs_portfolio_members_tenant_lineup_idx
  on public.floyd_dfs_portfolio_members (tenant_id, lineup_id, lineup_revision);

create table if not exists public.floyd_dfs_model_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  component text not null check (component in ('PROJECTION','SIMULATION','FIELD_MODEL','OPTIMIZER','PORTFOLIO')),
  model_version text not null,
  status text not null check (status in ('EXPERIMENTAL','SHADOW','CANARY','ACTIVE','RETIRED')),
  config jsonb not null,
  evaluation_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, sport, component, model_version),
  foreign key (evaluation_id, tenant_id)
    references public.floyd_dfs_model_evaluations(id, tenant_id) on delete restrict
);

create unique index if not exists floyd_dfs_model_registry_one_active_uidx
  on public.floyd_dfs_model_registry (tenant_id, sport, component)
  where status = 'ACTIVE';

do $$
declare target text;
begin
  foreach target in array array[
    'floyd_dfs_lineup_portfolios',
    'floyd_dfs_portfolio_members',
    'floyd_dfs_model_registry'
  ] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target);
    execute format('create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))', target, 'floyd-dfs', 'floyd-dfs');
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;

comment on table public.floyd_dfs_lineup_portfolios is 'Contest-scoped lineup portfolio; financial estimates are stored only with verified payout and calibrated field inputs.';
comment on table public.floyd_dfs_portfolio_members is 'Tenant-safe references to immutable lineup revisions and their generated/entered status.';
comment on table public.floyd_dfs_model_registry is 'Versioned model configurations; at most one active version per tenant, sport, and component.';
