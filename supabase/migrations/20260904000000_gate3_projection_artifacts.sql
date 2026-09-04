alter table if exists public.floyd_dfs_player_projections
  add column if not exists simulated_fantasy_point_samples jsonb not null default '[]'::jsonb,
  add column if not exists distribution jsonb not null default '{}'::jsonb,
  add column if not exists model_path text;

alter table if exists public.floyd_dfs_lineup_candidates
  add column if not exists variance numeric,
  add column if not exists win_frequency numeric,
  add column if not exists top_one_percent_frequency numeric,
  add column if not exists cash_frequency numeric,
  add column if not exists expected_duplicates numeric,
  add column if not exists expected_payout numeric,
  add column if not exists roi numeric,
  add column if not exists contest_metric_provenance text;
