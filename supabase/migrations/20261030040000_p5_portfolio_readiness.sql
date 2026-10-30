-- P5 may produce a portfolio without an NBA House report when the House feature
-- is disabled or when the contest is outside NBA V1. Keep that relationship
-- nullable while preserving tenant-scoped FK validation when a report exists.
alter table public.floyd_dfs_lineup_portfolios
  alter column house_report_id drop not null;

alter table public.floyd_dfs_lineup_portfolios
  drop constraint if exists floyd_dfs_lineup_portfolios_objective_check;

alter table public.floyd_dfs_lineup_portfolios
  add constraint floyd_dfs_lineup_portfolios_objective_check
  check (objective in ('MAX_EXPECTED_NET_RETURN','MAX_EXPECTED_POINTS','RISK_ADJUSTED_RETURN','HEURISTIC_TOURNAMENT'));

comment on column public.floyd_dfs_lineup_portfolios.house_report_id is
  'Optional for non-NBA or House-disabled runs; populated when an NBA House report exists.';
