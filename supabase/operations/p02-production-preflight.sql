-- Read-only, FDS-only preflight. Run against the explicitly linked production project.
do $$
declare tenant_count integer;
        target text;
        sport_check_count integer;
        sport_check_includes_nba boolean;
begin
  select count(*) into tenant_count from public.tenants where slug = 'floyd-dfs';
  if tenant_count <> 1 then raise exception 'Expected exactly one floyd-dfs tenant; found %.', tenant_count; end if;
  foreach target in array array['floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components','floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions','floyd_dfs_resolved_facts'] loop
    if to_regclass('public.' || target) is null then raise exception 'Required tenant schema table public.% is missing.', target; end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = target and column_name = 'tenant_id') then
      raise exception 'Required tenant ownership column is missing on public.%.', target;
    end if;
  end loop;
  foreach target in array array['floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components','floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions'] loop
    select count(*), coalesce(bool_or(position(quote_literal('NBA') in pg_get_constraintdef(c.oid)) > 0), false)
      into sport_check_count, sport_check_includes_nba
    from pg_constraint c
    where c.conrelid = to_regclass('public.' || target) and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%sport%';
    if sport_check_count <> 1 or sport_check_includes_nba then
      raise exception 'Unexpected sport constraint state on public.% (count %, NBA already allowed %).', target, sport_check_count, sport_check_includes_nba;
    end if;
  end loop;
end $$;

select c.conrelid::regclass::text as table_name, c.conname, pg_get_constraintdef(c.oid) as prior_definition
from pg_constraint c
where c.contype = 'c'
  and c.conrelid::regclass::text in (
    'floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components',
    'floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions'
  )
  and pg_get_constraintdef(c.oid) ilike '%sport%'
order by table_name, c.conname;

select 'floyd-dfs' as configured_tenant, t.id as tenant_id,
  (select jsonb_agg(jsonb_build_object('table', c.conrelid::regclass::text, 'constraint', c.conname, 'definition', pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text)
   from pg_constraint c
   where c.contype = 'c'
     and c.conrelid::regclass::text in ('floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components','floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions')
     and pg_get_constraintdef(c.oid) ilike '%sport%') as prior_sport_constraints
from public.tenants t where t.slug = 'floyd-dfs';
