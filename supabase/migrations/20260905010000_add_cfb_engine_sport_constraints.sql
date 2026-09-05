-- College Football is now a supported engine sport. Extend the two persisted
-- artifact constraints that predate CFB without changing historical rows.
alter table public.floyd_dfs_adjustment_runs
  drop constraint if exists floyd_dfs_adjustment_runs_sport_check;
alter table public.floyd_dfs_adjustment_runs
  add constraint floyd_dfs_adjustment_runs_sport_check
  check (sport = any (array['NBA', 'WNBA', 'NFL', 'MLB', 'GOLF', 'CFB']::text[]));

alter table public.floyd_dfs_projection_runs
  drop constraint if exists floyd_dfs_projection_runs_sport_check;
alter table public.floyd_dfs_projection_runs
  add constraint floyd_dfs_projection_runs_sport_check
  check (sport = any (array['NBA', 'WNBA', 'NFL', 'MLB', 'GOLF', 'CFB']::text[]));
