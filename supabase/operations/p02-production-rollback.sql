-- Use only for a failed P02 rollout, before downstream writers depend on the new schema.
-- Export/retain FDS-only post-migration rows before rollback if P02 tables have received data.
drop table if exists public.floyd_dfs_runtime_health_incidents;
drop table if exists public.floyd_dfs_provider_health_checks;
drop table if exists public.floyd_dfs_swap_plans;
drop table if exists public.floyd_dfs_lineup_revisions;
drop table if exists public.floyd_dfs_player_photos;
drop table if exists public.floyd_dfs_slate_games;
drop table if exists public.floyd_dfs_player_provider_mappings;
drop function if exists public.floyd_dfs_validate_lineup_revision();
drop index if exists public.fds_p02_generation_runs_id_tenant_id_uidx;

alter table public.floyd_dfs_source_observations
  drop column if exists game_id, drop column if exists value_unit,
  drop column if exists published_at, drop column if exists duplicate_cluster_id;
alter table public.floyd_dfs_resolved_facts
  drop column if exists canonical_fact_key, drop column if exists supporting_observation_ids,
  drop column if exists rejected_observation_ids, drop column if exists decision_at;
alter table public.floyd_dfs_quantitative_adjustments
  drop column if exists game_id, drop column if exists operation, drop column if exists amount_value,
  drop column if exists final_value, drop column if exists fact_ids, drop column if exists cap_applied,
  drop column if exists outcome, drop column if exists outcome_reason;

alter table public.floyd_dfs_source_observations drop constraint if exists floyd_dfs_source_observations_p02_sport_check;
alter table public.floyd_dfs_source_observations add constraint floyd_dfs_source_observations_sport_check check (sport in ('MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_quantitative_adjustments drop constraint if exists floyd_dfs_quantitative_adjustments_p02_sport_check;
alter table public.floyd_dfs_quantitative_adjustments add constraint floyd_dfs_quantitative_adjustments_sport_check check (sport in ('MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_player_projection_components drop constraint if exists floyd_dfs_player_projection_components_p02_sport_check;
alter table public.floyd_dfs_player_projection_components add constraint floyd_dfs_player_projection_components_sport_check check (sport in ('MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_model_evaluations drop constraint if exists floyd_dfs_model_evaluations_p02_sport_check;
alter table public.floyd_dfs_model_evaluations add constraint floyd_dfs_model_evaluations_sport_check check (sport in ('MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_sport_release_gates drop constraint if exists floyd_dfs_sport_release_gates_p02_sport_check;
alter table public.floyd_dfs_sport_release_gates add constraint floyd_dfs_sport_release_gates_sport_check check (sport in ('MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_historical_player_actuals drop constraint if exists floyd_dfs_historical_player_actuals_p02_sport_check;
alter table public.floyd_dfs_historical_player_actuals add constraint floyd_dfs_historical_player_actuals_sport_check check (sport in ('MLB','WNBA','NFL','CFB','GOLF'));
alter table public.floyd_dfs_player_actual_revisions drop constraint if exists floyd_dfs_player_actual_revisions_p02_sport_check;
alter table public.floyd_dfs_player_actual_revisions add constraint floyd_dfs_player_actual_revisions_sport_check check (sport in ('MLB','WNBA','NFL','CFB','GOLF'));
