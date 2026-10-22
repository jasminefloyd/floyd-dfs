-- P06/P07 additive diagnostics. Runtime stores full versioned optimizer/simulation artifacts
-- in their existing JSON packages; these nullable columns make key candidate diagnostics queryable.
alter table if exists public.floyd_dfs_lineup_candidates
  add column if not exists expected_points numeric,
  add column if not exists fractional_win_credit numeric,
  add column if not exists win_frequency_standard_error numeric,
  add column if not exists cash_frequency_standard_error numeric,
  add column if not exists positive_payout_frequency numeric,
  add column if not exists expected_payout_standard_error numeric,
  add column if not exists expected_profit numeric;

do $$
begin
  if to_regclass('public.floyd_dfs_lineup_candidates') is not null then
    alter table public.floyd_dfs_lineup_candidates
      drop constraint if exists floyd_dfs_lineup_candidates_fractional_win_credit_range,
      add constraint floyd_dfs_lineup_candidates_fractional_win_credit_range
        check (fractional_win_credit is null or (fractional_win_credit >= 0 and fractional_win_credit <= 1)),
      drop constraint if exists floyd_dfs_lineup_candidates_positive_payout_frequency_range,
      add constraint floyd_dfs_lineup_candidates_positive_payout_frequency_range
        check (positive_payout_frequency is null or (positive_payout_frequency >= 0 and positive_payout_frequency <= 1)),
      drop constraint if exists floyd_dfs_lineup_candidates_win_frequency_standard_error_nonnegative,
      add constraint floyd_dfs_lineup_candidates_win_frequency_standard_error_nonnegative
        check (win_frequency_standard_error is null or win_frequency_standard_error >= 0),
      drop constraint if exists floyd_dfs_lineup_candidates_cash_frequency_standard_error_nonnegative,
      add constraint floyd_dfs_lineup_candidates_cash_frequency_standard_error_nonnegative
        check (cash_frequency_standard_error is null or cash_frequency_standard_error >= 0),
      drop constraint if exists floyd_dfs_lineup_candidates_expected_payout_standard_error_nonnegative,
      add constraint floyd_dfs_lineup_candidates_expected_payout_standard_error_nonnegative
        check (expected_payout_standard_error is null or expected_payout_standard_error >= 0);
  end if;
end $$;
