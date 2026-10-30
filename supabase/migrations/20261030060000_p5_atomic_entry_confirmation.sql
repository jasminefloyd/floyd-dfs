-- Atomically reconcile the generated/entered state, immutable revision,
-- DraftKings entry link, portfolio member, and frozen lock snapshot.
alter table public.floyd_dfs_lock_snapshots
  add column if not exists lineup_revision bigint not null default 1;

create or replace function public.floyd_dfs_confirm_lineup_entry(
  p_tenant_id uuid,
  p_lineup_id uuid,
  p_actor_id uuid,
  p_contest_id text,
  p_contest_name text,
  p_external_entry_id text,
  p_sport text,
  p_contest_format text,
  p_entry_fee numeric,
  p_projection_snapshot jsonb,
  p_research_version integer,
  p_adjustment_version integer,
  p_projection_version integer,
  p_optimization_version integer,
  p_selection_version integer
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_lineup public.floyd_dfs_generated_lineups%rowtype;
  generation_id uuid;
  latest_revision bigint;
  latest_state text;
  latest_input_sha256 text;
  latest_model_sha256 text;
  latest_rules_sha256 text;
  entered_revision bigint;
  v_confirmed_at timestamptz := now();
  snapshot_created boolean := false;
  entry_linked boolean := false;
  prior_lineup_id uuid;
  linked_lineup_id uuid;
begin
  select * into selected_lineup
  from public.floyd_dfs_generated_lineups
  where id = p_lineup_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Lineup was not found for this tenant.' using errcode = 'P0002';
  end if;
  if selected_lineup.status not in ('GENERATED', 'ENTERED') then
    raise exception 'Only generated or already-entered lineups can be confirmed.' using errcode = '22023';
  end if;
  if p_external_entry_id is not null and (p_contest_id is null or p_sport is null or p_sport not in ('NBA','WNBA','MLB','NFL','CFB','GOLF') or p_contest_format is null or p_contest_format not in ('CLASSIC','SHOWDOWN')) then
    raise exception 'A DraftKings entry link requires a supported contest, sport, and format.' using errcode = '22023';
  end if;

  select generation_run_id into generation_id
  from public.floyd_dfs_selection_runs
  where id = selected_lineup.selection_run_id and tenant_id = p_tenant_id;
  if generation_id is null then
    raise exception 'The lineup generation run could not be recovered.' using errcode = '23503';
  end if;

  if p_external_entry_id is not null then
    select generated_lineup_id into prior_lineup_id
    from public.floyd_dfs_entry_links
    where tenant_id = p_tenant_id and contest_id = p_contest_id and external_entry_id = p_external_entry_id;
    if prior_lineup_id is not null and prior_lineup_id <> p_lineup_id then
      raise exception 'That DraftKings entry ID is already linked to a different saved lineup.' using errcode = '23505';
    end if;

    select generated_lineup_id into linked_lineup_id
    from public.floyd_dfs_entry_links
    where tenant_id = p_tenant_id and contest_id = p_contest_id and generated_lineup_id = p_lineup_id;
    if linked_lineup_id is not null then
      if not exists (
        select 1 from public.floyd_dfs_entry_links
        where tenant_id = p_tenant_id and contest_id = p_contest_id
          and generated_lineup_id = p_lineup_id and external_entry_id = p_external_entry_id
      ) then
        raise exception 'A different DraftKings entry ID is already linked to this lineup and contest.' using errcode = '23505';
      end if;
    else
      insert into public.floyd_dfs_entry_links
        (tenant_id, generated_lineup_id, contest_id, contest_name, external_entry_id, sport, contest_format)
      values
        (p_tenant_id, p_lineup_id, p_contest_id, nullif(p_contest_name, ''), p_external_entry_id, p_sport, p_contest_format);
    end if;
    entry_linked := true;
  end if;

  if selected_lineup.status = 'GENERATED' then
    update public.floyd_dfs_generated_lineups
    set status = 'ENTERED', entered_at = v_confirmed_at, entered_by = p_actor_id,
        entered_metadata = jsonb_build_object('contestId', p_contest_id, 'externalEntryId', p_external_entry_id, 'entryFee', p_entry_fee, 'confirmedAt', v_confirmed_at)
    where id = p_lineup_id and tenant_id = p_tenant_id;
  end if;

  select revision, state, input_sha256, model_sha256, rules_sha256
    into latest_revision, latest_state, latest_input_sha256, latest_model_sha256, latest_rules_sha256
  from public.floyd_dfs_lineup_revisions
  where tenant_id = p_tenant_id and lineup_id = p_lineup_id::text
  order by revision desc limit 1;

  if latest_state is distinct from 'USER_CONFIRMED_ENTERED' then
    entered_revision := coalesce(latest_revision, 0) + 1;
    insert into public.floyd_dfs_lineup_revisions (
      tenant_id, lineup_id, revision, parent_revision, generation_run_id,
      input_sha256, model_sha256, rules_sha256, slot_assignments,
      generated_at, state, submission_confirmed_at, content_sha256
    )
    values (
      p_tenant_id, p_lineup_id::text, entered_revision, nullif(latest_revision, 0), generation_id,
      coalesce(latest_input_sha256, encode(sha256(convert_to(jsonb_build_object('lineupId', p_lineup_id, 'generationRunId', generation_id)::text, 'UTF8')), 'hex')),
      coalesce(latest_model_sha256, encode(sha256(convert_to(coalesce(selected_lineup.lineup_payload, '{}'::jsonb)::text, 'UTF8')), 'hex')),
      coalesce(latest_rules_sha256, encode(sha256(convert_to(jsonb_build_object('contestId', p_contest_id, 'sport', p_sport, 'format', p_contest_format)::text, 'UTF8')), 'hex')),
      coalesce(selected_lineup.lineup_payload -> 'rosterSlots', '{}'::jsonb),
      v_confirmed_at, 'USER_CONFIRMED_ENTERED', v_confirmed_at,
      encode(sha256(convert_to(jsonb_build_object('lineupId', p_lineup_id, 'revision', entered_revision, 'payload', selected_lineup.lineup_payload, 'confirmedAt', v_confirmed_at)::text, 'UTF8')), 'hex')
    );

    insert into public.floyd_dfs_portfolio_members
      (tenant_id, portfolio_id, lineup_id, lineup_revision, entry_status, estimated_payout, actual_payout, entry_fee)
    select p_tenant_id, portfolio.id, p_lineup_id::text, entered_revision, 'ENTERED', null, null, p_entry_fee
    from public.floyd_dfs_lineup_portfolios as portfolio
    where portfolio.tenant_id = p_tenant_id and portfolio.generation_run_id = generation_id
    on conflict (portfolio_id, lineup_id, lineup_revision) do nothing;
  else
    entered_revision := latest_revision;
  end if;

  if not exists (
    select 1 from public.floyd_dfs_lock_snapshots
    where tenant_id = p_tenant_id and generated_lineup_id = p_lineup_id and lineup_revision = entered_revision
  ) then
    insert into public.floyd_dfs_lock_snapshots (
      tenant_id, generated_lineup_id, lineup_revision, locked_at, lineup_payload,
      projection_snapshot, game_script, risk_flags, research_version,
      adjustment_version, projection_version, optimization_version, selection_version
    ) values (
      p_tenant_id, p_lineup_id, entered_revision, v_confirmed_at, selected_lineup.lineup_payload,
      coalesce(p_projection_snapshot, '{}'::jsonb), null, '[]'::jsonb,
      greatest(coalesce(p_research_version, 1), 1), greatest(coalesce(p_adjustment_version, 1), 1),
      greatest(coalesce(p_projection_version, 1), 1), greatest(coalesce(p_optimization_version, 1), 1),
      greatest(coalesce(p_selection_version, 1), 1)
    );
    snapshot_created := true;
  end if;

  return jsonb_build_object(
    'lineupId', p_lineup_id,
    'status', 'ENTERED',
    'contestId', p_contest_id,
    'entryLinked', entry_linked,
    'lockSnapshotCreated', snapshot_created,
    'lineupRevision', entered_revision,
    'generationRunId', generation_id
  );
end;
$$;

revoke all on function public.floyd_dfs_confirm_lineup_entry(uuid,uuid,uuid,text,text,text,text,text,numeric,jsonb,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.floyd_dfs_confirm_lineup_entry(uuid,uuid,uuid,text,text,text,text,text,numeric,jsonb,integer,integer,integer,integer,integer) to service_role;

comment on column public.floyd_dfs_lock_snapshots.lineup_revision is 'Exact immutable lineup revision confirmed as submitted when this as-of lock snapshot was recorded.';
