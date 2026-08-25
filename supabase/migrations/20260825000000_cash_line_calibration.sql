alter table if exists public.floyd_dfs_generated_lineups
  add column if not exists cash_line numeric,
  add column if not exists raw_cash_line_probability numeric,
  add column if not exists cash_line_probability numeric,
  add column if not exists cash_line_calibration_status text not null default 'UNCALIBRATED',
  add column if not exists cash_line_calibration_version text;

alter table if exists public.floyd_dfs_contest_results
  add column if not exists cash_line numeric,
  add column if not exists beat_cash_line boolean;

create index if not exists floyd_dfs_contest_results_cash_line_idx
  on public.floyd_dfs_contest_results (tenant_id, measured_at)
  where cash_line is not null and beat_cash_line is not null;
