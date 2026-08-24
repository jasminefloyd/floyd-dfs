create extension if not exists pgcrypto;

create or replace function public.floyd_dfs_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'standard',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_name_not_blank check (length(btrim(name)) > 0),
  constraint tenants_slug_normalized check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

alter table public.tenants
  add column if not exists plan text not null default 'standard',
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_name_not_blank'
  ) then
    alter table public.tenants
      add constraint tenants_name_not_blank check (length(btrim(name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_slug_normalized'
  ) then
    alter table public.tenants
      add constraint tenants_slug_normalized
      check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tenants'::regclass
      and tgname = 'tenants_set_updated_at'
      and not tgisinternal
  ) then
    create trigger tenants_set_updated_at
    before update on public.tenants
    for each row execute function public.floyd_dfs_set_updated_at();
  end if;
end;
$$;

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  constraint tenant_memberships_role_check check (role in ('owner', 'admin', 'member')),
  constraint tenant_memberships_tenant_user_unique unique (tenant_id, user_id)
);

create index tenant_memberships_user_id_idx on public.tenant_memberships(user_id);
create index tenant_memberships_tenant_id_idx on public.tenant_memberships(tenant_id);

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = auth.uid()
  );
$$;

revoke all on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;

create or replace function public.tenant_has_role(target_tenant uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant
      and membership.user_id = auth.uid()
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function public.tenant_has_role(uuid, text[]) from public;
grant execute on function public.tenant_has_role(uuid, text[]) to authenticated;

create or replace function public.floyd_dfs_create_tenant(tenant_name text, tenant_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_tenant_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to create a tenant';
  end if;

  insert into public.tenants (name, slug)
  values (tenant_name, lower(tenant_slug))
  returning id into created_tenant_id;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (created_tenant_id, current_user_id, 'owner');

  return created_tenant_id;
end;
$$;

revoke all on function public.floyd_dfs_create_tenant(text, text) from public;
grant execute on function public.floyd_dfs_create_tenant(text, text) to authenticated;

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  request_id text not null,
  requested_entry_count integer not null,
  request_payload jsonb not null default '{}'::jsonb,
  state text not null default 'created',
  current_stage text,
  error jsonb,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_runs_request_id_unique unique (tenant_id, request_id),
  constraint generation_runs_requested_entry_count_check check (requested_entry_count > 0),
  constraint generation_runs_state_check check (state in (
    'created', 'slate_validated', 'researching', 'adjusting', 'projecting',
    'optimizing', 'selecting', 'ready', 'blocked', 'failed', 'complete'
  ))
);

create index generation_runs_tenant_created_idx on public.generation_runs(tenant_id, created_at desc);

create trigger generation_runs_set_updated_at
before update on public.generation_runs
for each row execute function public.floyd_dfs_set_updated_at();

create table public.engine_stage_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  stage text not null,
  version integer not null,
  status text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  parent_stage_versions jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint engine_stage_runs_version_positive check (version > 0),
  constraint engine_stage_runs_unique_version unique (generation_run_id, stage, version)
);

create index engine_stage_runs_run_stage_idx on public.engine_stage_runs(generation_run_id, stage, version desc);

create table public.engine_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  stage text not null,
  status text not null default 'queued',
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  input_payload jsonb,
  output_ref jsonb,
  error jsonb,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint engine_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint engine_jobs_attempt_check check (attempt >= 0 and max_attempts > 0)
);

create index engine_jobs_claim_idx on public.engine_jobs(status, available_at);
create index engine_jobs_run_idx on public.engine_jobs(generation_run_id, created_at);

create table public.engine_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete cascade,
  event_type text not null,
  stage text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index engine_events_run_created_idx on public.engine_events(generation_run_id, created_at);

create table public.slate_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  version integer not null,
  payload jsonb not null,
  validation_status text not null,
  created_at timestamptz not null default now(),
  constraint slate_versions_version_positive check (version > 0),
  constraint slate_versions_unique_version unique (generation_run_id, version)
);

create index slate_versions_run_idx on public.slate_versions(generation_run_id, version desc);

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.generation_runs enable row level security;
alter table public.engine_stage_runs enable row level security;
alter table public.engine_jobs enable row level security;
alter table public.engine_events enable row level security;
alter table public.slate_versions enable row level security;

create policy tenants_member_select
on public.tenants
for select to authenticated
using (public.is_tenant_member(id));

create policy tenant_memberships_self_select
on public.tenant_memberships
for select to authenticated
using (user_id = auth.uid() or public.is_tenant_member(tenant_id));

create policy generation_runs_member_select
on public.generation_runs
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy generation_runs_member_insert
on public.generation_runs
for insert to authenticated
with check (public.is_tenant_member(tenant_id) and user_id = auth.uid());

create policy generation_runs_member_update
on public.generation_runs
for update to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

create policy engine_stage_runs_member_select
on public.engine_stage_runs
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy engine_stage_runs_member_insert
on public.engine_stage_runs
for insert to authenticated
with check (public.is_tenant_member(tenant_id));

create policy engine_jobs_member_select
on public.engine_jobs
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy engine_jobs_member_insert
on public.engine_jobs
for insert to authenticated
with check (public.is_tenant_member(tenant_id));

create policy engine_jobs_member_update
on public.engine_jobs
for update to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

create policy engine_events_member_select
on public.engine_events
for select to authenticated
using (tenant_id is null or public.is_tenant_member(tenant_id));

create policy engine_events_member_insert
on public.engine_events
for insert to authenticated
with check (tenant_id is null or public.is_tenant_member(tenant_id));

create policy slate_versions_member_select
on public.slate_versions
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy slate_versions_member_insert
on public.slate_versions
for insert to authenticated
with check (public.is_tenant_member(tenant_id));
