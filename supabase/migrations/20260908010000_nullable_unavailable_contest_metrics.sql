-- Contest simulation metrics are legitimately unavailable when no verified ownership
-- model is present. They must not be represented as fabricated zeros or required values.
alter table public.floyd_dfs_lineup_candidates
  alter column win_frequency drop not null,
  alter column top_one_percent_frequency drop not null,
  alter column cash_frequency drop not null,
  alter column expected_duplicates drop not null,
  alter column expected_payout drop not null,
  alter column roi drop not null,
  alter column contest_metric_provenance drop not null;
