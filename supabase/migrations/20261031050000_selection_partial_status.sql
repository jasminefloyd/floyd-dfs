alter table public.floyd_dfs_selection_runs
  drop constraint if exists floyd_dfs_selection_runs_status_check;

alter table public.floyd_dfs_selection_runs
  add constraint floyd_dfs_selection_runs_status_check
  check (status in ('COMPLETE', 'PARTIAL', 'BLOCKED'));
