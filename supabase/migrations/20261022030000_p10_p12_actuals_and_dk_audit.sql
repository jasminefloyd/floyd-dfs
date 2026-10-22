-- P11: NBA official actuals and audit lineage; P12: durable leased monthly audit jobs.
alter table public.floyd_dfs_historical_player_actuals drop constraint if exists floyd_dfs_historical_player_actuals_sport_check;
alter table public.floyd_dfs_historical_player_actuals add constraint floyd_dfs_historical_player_actuals_sport_check check (sport in ('NBA','MLB','WNBA','NFL','CFB','GOLF'));
alter table public.floyd_dfs_player_actual_revisions drop constraint if exists floyd_dfs_player_actual_revisions_sport_check;
alter table public.floyd_dfs_player_actual_revisions add constraint floyd_dfs_player_actual_revisions_sport_check check (sport in ('NBA','MLB','WNBA','NFL','CFB','GOLF'));
alter table public.floyd_dfs_historical_player_actuals add column if not exists provider_game_id text;
alter table public.floyd_dfs_historical_player_actuals add column if not exists source_record_id text;
alter table public.floyd_dfs_historical_player_actuals add column if not exists season_id text;
alter table public.floyd_dfs_player_actual_revisions add column if not exists provider_game_id text;
alter table public.floyd_dfs_player_actual_revisions add column if not exists source_record_id text;
alter table public.floyd_dfs_player_actual_revisions add column if not exists season_id text;
create index if not exists floyd_dfs_actuals_provider_game_idx on public.floyd_dfs_historical_player_actuals (tenant_id,sport,event_date,provider_game_id,provider_player_id);
alter table public.floyd_dfs_model_evaluations drop constraint if exists floyd_dfs_model_evaluations_sport_check;
alter table public.floyd_dfs_model_evaluations add constraint floyd_dfs_model_evaluations_sport_check check (sport in ('NBA','MLB','NFL','WNBA','CFB','GOLF'));
alter table public.floyd_dfs_sport_release_gates drop constraint if exists floyd_dfs_sport_release_gates_sport_check;
alter table public.floyd_dfs_sport_release_gates add constraint floyd_dfs_sport_release_gates_sport_check check (sport in ('NBA','MLB','NFL','WNBA','CFB','GOLF'));

alter table public.floyd_dfs_scheduler_runs add column if not exists lease_expires_at timestamptz;
alter table public.floyd_dfs_scheduler_runs add column if not exists attempt_count integer not null default 1 check (attempt_count > 0);
create index if not exists floyd_dfs_scheduler_runs_due_idx on public.floyd_dfs_scheduler_runs (tenant_id,job_type,started_at desc);
alter table public.floyd_dfs_provider_health_checks add column if not exists schema_sha256 text;

comment on column public.floyd_dfs_scheduler_runs.lease_expires_at is 'Tenant-scoped scheduler lease expiry; expired RUNNING audit claims may be recovered.';
