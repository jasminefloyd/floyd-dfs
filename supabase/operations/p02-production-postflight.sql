-- Read-only postflight. It verifies schema/security state without reading tenant data.
do $$
declare target text;
        sport text;
        expected_sports text[] := array['NBA','WNBA','MLB','GOLF','NFL','CFB'];
        definition text;
        rel oid;
begin
  foreach target in array array['floyd_dfs_source_observations','floyd_dfs_quantitative_adjustments','floyd_dfs_player_projection_components','floyd_dfs_model_evaluations','floyd_dfs_sport_release_gates','floyd_dfs_historical_player_actuals','floyd_dfs_player_actual_revisions'] loop
    select pg_get_constraintdef(c.oid) into definition from pg_constraint c
    where c.conrelid = to_regclass('public.' || target) and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%sport%'
      and c.conname = target || '_p02_sport_check';
    if definition is null then raise exception 'Missing P02 sport check on public.%.', target; end if;
    foreach sport in array expected_sports loop
      if position(quote_literal(sport) in definition) = 0 then raise exception 'Sport % is absent from a P02 sport constraint.', sport; end if;
    end loop;
  end loop;
  foreach target in array array['floyd_dfs_player_provider_mappings','floyd_dfs_slate_games','floyd_dfs_player_photos','floyd_dfs_lineup_revisions','floyd_dfs_swap_plans','floyd_dfs_provider_health_checks','floyd_dfs_runtime_health_incidents'] loop
    rel := to_regclass('public.' || target);
    if rel is null then raise exception 'P02 table public.% is missing.', target; end if;
    if not (select relrowsecurity from pg_class where oid = rel) then raise exception 'RLS is disabled on public.%.', target; end if;
    if not exists (select 1 from pg_policy where polrelid = rel and polname = 'fds_project_tenant_isolation' and polpermissive = false and coalesce(pg_get_expr(polqual, polrelid), '') like '%floyd-dfs%') then
      raise exception 'Fixed floyd-dfs restrictive policy is missing on public.%.', target;
    end if;
    if has_table_privilege('anon', rel, 'select') or has_table_privilege('authenticated', rel, 'select') then
      raise exception 'Browser read access remains on public.%.', target;
    end if;
  end loop;
end $$;

select table_name, column_name
from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'floyd_dfs_source_observations' and column_name in ('game_id','value_unit','published_at','duplicate_cluster_id')) or
  (table_name = 'floyd_dfs_resolved_facts' and column_name in ('canonical_fact_key','supporting_observation_ids','rejected_observation_ids','decision_at')) or
  (table_name = 'floyd_dfs_quantitative_adjustments' and column_name in ('game_id','operation','amount_value','final_value','fact_ids','cap_applied','outcome','outcome_reason'))
)
order by table_name, column_name;
