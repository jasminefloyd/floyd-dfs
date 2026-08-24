-- Completes the documented persistence model. This migration is additive and safe
-- for the already-created floyd_dfs tenant schema.
alter table public.floyd_dfs_generated_lineups
  add column if not exists generation_run_id uuid references public.generation_runs(id) on delete cascade,
  add column if not exists research_version integer,
  add column if not exists adjustment_version integer,
  add column if not exists projection_version integer,
  add column if not exists optimizer_version integer,
  add column if not exists selection_version integer,
  add column if not exists projection_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists entered_by uuid references auth.users(id),
  add column if not exists entered_metadata jsonb not null default '{}'::jsonb;

update public.floyd_dfs_generated_lineups lineup
set generation_run_id = selection.generation_run_id
from public.floyd_dfs_selection_runs selection
where lineup.selection_run_id = selection.id
  and lineup.generation_run_id is null;

create index if not exists floyd_dfs_generated_lineups_run_idx
  on public.floyd_dfs_generated_lineups(tenant_id, generation_run_id, created_at desc);

create table if not exists public.lineup_candidate_players (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  optimizer_version integer not null,
  candidate_id text not null,
  player_id text not null,
  roster_slot text,
  salary numeric,
  projection_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lineup_candidate_players_run_idx
  on public.lineup_candidate_players(tenant_id, generation_run_id, candidate_id);

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  stage text not null,
  name text not null,
  version integer not null default 1,
  template text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, stage, name, version)
);

create table if not exists public.model_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  stage text not null,
  provider text not null,
  model text not null,
  version integer not null default 1,
  parameters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, stage, provider, model, version)
);

alter table public.lineup_candidate_players enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.model_configs enable row level security;

create policy lineup_candidate_players_member_select on public.lineup_candidate_players
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy lineup_candidate_players_member_insert on public.lineup_candidate_players
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy prompt_templates_member_select on public.prompt_templates
  for select to authenticated using (tenant_id is null or public.is_tenant_member(tenant_id));
create policy model_configs_member_select on public.model_configs
  for select to authenticated using (tenant_id is null or public.is_tenant_member(tenant_id));

-- Enables server-side workers to claim one available job atomically.
create or replace function public.floyd_dfs_claim_engine_job(p_tenant_id uuid)
returns public.engine_jobs
language plpgsql
security definer
set search_path = public
as $$
declare claimed public.engine_jobs;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and not public.is_tenant_member(p_tenant_id) then
    raise exception 'Tenant access denied';
  end if;
  update public.engine_jobs job
  set status = 'running', attempt = job.attempt + 1, started_at = now()
  where job.id = (
    select candidate.id from public.engine_jobs candidate
    where candidate.tenant_id = p_tenant_id
      and candidate.status = 'queued'
      and candidate.available_at <= now()
    order by candidate.created_at
    for update skip locked limit 1
  )
  returning job.* into claimed;
  return claimed;
end;
$$;
revoke all on function public.floyd_dfs_claim_engine_job(uuid) from public;
grant execute on function public.floyd_dfs_claim_engine_job(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_rel pr
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_publication p on p.oid = pr.prpubid
      where p.pubname = 'supabase_realtime' and n.nspname = 'public' and c.relname = 'generation_runs'
    ) then alter publication supabase_realtime add table public.generation_runs; end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_rel pr
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_publication p on p.oid = pr.prpubid
      where p.pubname = 'supabase_realtime' and n.nspname = 'public' and c.relname = 'engine_jobs'
    ) then alter publication supabase_realtime add table public.engine_jobs; end if;
end;
$$;
