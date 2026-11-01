create table if not exists public.floyd_dfs_model_change_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (length(trim(title)) between 4 and 180),
  hypothesis text not null check (length(trim(hypothesis)) between 12 and 4000),
  affected_driver text not null check (length(trim(affected_driver)) between 2 and 180),
  pattern_group text not null check (length(trim(pattern_group)) between 2 and 180),
  sport text not null check (sport in ('NBA','WNBA','MLB','NFL','CFB','GOLF')),
  component text not null check (component in ('PROJECTION','SIMULATION','FIELD_MODEL','OPTIMIZER','PORTFOLIO')),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) >= 3),
  training_window text not null,
  validation_window text not null,
  holdout_window text not null,
  expected_benefit text not null,
  failure_risks text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  code_version text not null,
  baseline_model_version text not null,
  candidate_model_version text not null,
  evaluation_id uuid,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','HOLD','REJECTED','APPROVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (evaluation_id, tenant_id) references public.floyd_dfs_model_evaluations(id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

create index if not exists floyd_dfs_model_change_proposals_tenant_created_idx
  on public.floyd_dfs_model_change_proposals (tenant_id, created_at desc);

create table if not exists public.floyd_dfs_model_change_proposal_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  proposal_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('CREATED','REVIEWED','EVALUATION_LINKED')),
  note text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, tenant_id) references public.floyd_dfs_model_change_proposals(id, tenant_id) on delete restrict
);

create index if not exists floyd_dfs_model_change_events_proposal_idx
  on public.floyd_dfs_model_change_proposal_events (tenant_id, proposal_id, created_at);

create or replace function public.floyd_dfs_model_change_proposal_event_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Model change proposal events are append-only; add a new review event.';
end $$;

drop trigger if exists floyd_dfs_model_change_events_immutable on public.floyd_dfs_model_change_proposal_events;
create trigger floyd_dfs_model_change_events_immutable
before update or delete on public.floyd_dfs_model_change_proposal_events
for each row execute function public.floyd_dfs_model_change_proposal_event_immutable();

do $$ declare target text; begin
  foreach target in array array['floyd_dfs_model_change_proposals','floyd_dfs_model_change_proposal_events'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target);
    execute format('create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))', target, 'floyd-dfs', 'floyd-dfs');
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end $$;

comment on table public.floyd_dfs_model_change_proposals is 'Operator-authored, evidence-linked hypotheses. Approval does not itself alter a runtime route.';
comment on table public.floyd_dfs_model_change_proposal_events is 'Append-only audit history of proposal creation and human decisions.';
