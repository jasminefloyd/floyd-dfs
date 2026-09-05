-- Gate 0/3 replaced the deprecated heuristic candidate fields with explicit
-- contest-simulation metrics. Keep the old columns for historical compatibility,
-- but do not require new optimizer rows to populate fields the engine no longer emits.
alter table public.floyd_dfs_lineup_candidates
  alter column optimal_lineup_frequency drop not null,
  alter column ownership_estimate drop not null,
  alter column leverage_score drop not null,
  alter column duplication_risk drop not null,
  alter column estimated_duplicates drop not null,
  alter column tournament_rank drop not null;
