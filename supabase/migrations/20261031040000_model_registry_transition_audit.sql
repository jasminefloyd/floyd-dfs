create unique index if not exists floyd_dfs_model_registry_id_tenant_uidx
  on public.floyd_dfs_model_registry (id, tenant_id);

create table if not exists public.floyd_dfs_model_registry_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  registry_id uuid not null,
  evaluation_id uuid,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('REGISTERED','STATUS_TRANSITIONED')),
  prior_status text,
  next_status text not null,
  note text not null,
  created_at timestamptz not null default now(),
  foreign key (registry_id, tenant_id)
    references public.floyd_dfs_model_registry(id, tenant_id) on delete restrict,
  foreign key (evaluation_id, tenant_id)
    references public.floyd_dfs_model_evaluations(id, tenant_id) on delete restrict
);

create index if not exists floyd_dfs_model_registry_events_lookup_idx
  on public.floyd_dfs_model_registry_events (tenant_id, registry_id, created_at);

alter table public.floyd_dfs_model_registry_events enable row level security;
drop policy if exists fds_project_tenant_isolation on public.floyd_dfs_model_registry_events;
create policy fds_project_tenant_isolation on public.floyd_dfs_model_registry_events
  as restrictive for all to authenticated
  using (tenant_id = (select id from public.tenants where slug = 'floyd-dfs'))
  with check (tenant_id = (select id from public.tenants where slug = 'floyd-dfs'));
revoke all on public.floyd_dfs_model_registry_events from public, anon, authenticated;
grant all on public.floyd_dfs_model_registry_events to service_role;

create or replace function public.floyd_dfs_model_registry_event_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Model registry events are append-only.';
end $$;

drop trigger if exists floyd_dfs_model_registry_events_immutable on public.floyd_dfs_model_registry_events;
create trigger floyd_dfs_model_registry_events_immutable
before update or delete on public.floyd_dfs_model_registry_events
for each row execute function public.floyd_dfs_model_registry_event_immutable();

create or replace function public.floyd_dfs_transition_model_registry(
  p_tenant_id uuid,
  p_registry_id uuid,
  p_actor_id uuid,
  p_expected_status text,
  p_next_status text,
  p_evaluation_id uuid,
  p_note text
)
returns setof public.floyd_dfs_model_registry
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior public.floyd_dfs_model_registry%rowtype;
  chosen_evaluation_id uuid;
begin
  if p_next_status not in ('SHADOW','CANARY','RETIRED') then
    raise exception 'Unsupported model registry transition.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_note, ''))) < 8 then
    raise exception 'A review note of at least 8 characters is required.' using errcode = '22023';
  end if;

  select * into prior
    from public.floyd_dfs_model_registry
    where id = p_registry_id and tenant_id = p_tenant_id
    for update;
  if not found then
    raise exception 'Model registry record not found.' using errcode = 'P0002';
  end if;
  if prior.status <> p_expected_status then
    raise exception 'Model registry status changed; reload before reviewing.' using errcode = '40001';
  end if;
  if prior.status = 'RETIRED' and p_next_status <> 'RETIRED' then
    raise exception 'Retired model versions cannot be reactivated.' using errcode = '55000';
  end if;
  if prior.status = 'ACTIVE' then
    raise exception 'Active models must be changed through the separately reviewed rollout control.' using errcode = '55000';
  end if;

  chosen_evaluation_id := coalesce(p_evaluation_id, prior.evaluation_id);
  if p_next_status in ('SHADOW','CANARY') and chosen_evaluation_id is null then
    raise exception 'A persisted evaluation is required before shadow or canary.' using errcode = '23502';
  end if;

  return query
  update public.floyd_dfs_model_registry
    set status = p_next_status,
        evaluation_id = chosen_evaluation_id,
        config = config || jsonb_build_object('lastReview', jsonb_build_object(
          'evaluationId', chosen_evaluation_id,
          'reviewedBy', p_actor_id,
          'reviewedAt', now(),
          'note', trim(p_note)
        ))
    where id = p_registry_id and tenant_id = p_tenant_id
    returning *;

  insert into public.floyd_dfs_model_registry_events (
    tenant_id, registry_id, evaluation_id, actor_id, action,
    prior_status, next_status, note
  ) values (
    p_tenant_id, p_registry_id, chosen_evaluation_id, p_actor_id,
    'STATUS_TRANSITIONED', prior.status, p_next_status, trim(p_note)
  );
end;
$$;

revoke all on function public.floyd_dfs_transition_model_registry(uuid, uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.floyd_dfs_transition_model_registry(uuid, uuid, uuid, text, text, uuid, text) to service_role;

create or replace function public.floyd_dfs_register_model_registry(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_sport text,
  p_component text,
  p_model_version text,
  p_config jsonb,
  p_evaluation_id uuid
)
returns setof public.floyd_dfs_model_registry
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created public.floyd_dfs_model_registry%rowtype;
begin
  insert into public.floyd_dfs_model_registry (
    tenant_id, sport, component, model_version, status, config, evaluation_id
  ) values (
    p_tenant_id, p_sport, p_component, p_model_version, 'EXPERIMENTAL', coalesce(p_config, '{}'::jsonb), p_evaluation_id
  ) returning * into created;

  insert into public.floyd_dfs_model_registry_events (
    tenant_id, registry_id, evaluation_id, actor_id, action,
    prior_status, next_status, note
  ) values (
    p_tenant_id, created.id, p_evaluation_id, p_actor_id, 'REGISTERED', null, created.status,
    'Registered as EXPERIMENTAL; runtime routing is unchanged.'
  );

  return next created;
end;
$$;

revoke all on function public.floyd_dfs_register_model_registry(uuid, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.floyd_dfs_register_model_registry(uuid, uuid, text, text, text, jsonb, uuid) to service_role;

comment on table public.floyd_dfs_model_registry_events is 'Append-only audit history for reviewed model registry status changes.';
