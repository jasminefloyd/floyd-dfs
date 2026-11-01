-- G5/G6: retain verified contest decision terms and model contest refunds explicitly.
alter table public.floyd_dfs_portfolio_members
  add column if not exists refund_amount numeric check (refund_amount is null or refund_amount >= 0);

alter table public.floyd_dfs_contest_results
  add column if not exists refund_amount numeric check (refund_amount is null or refund_amount >= 0);

alter table public.floyd_dfs_contest_field_entries
  add column if not exists refund_amount numeric check (refund_amount is null or refund_amount >= 0);

alter table public.floyd_dfs_portfolio_members
  drop constraint if exists floyd_dfs_portfolio_members_settlement_status_check;
alter table public.floyd_dfs_portfolio_members
  add constraint floyd_dfs_portfolio_members_settlement_status_check
  check (settlement_status in ('NOT_ENTERED','ENTERED','LOCKED','RESULTS_PENDING','PARTIAL','VERIFIED','DISPUTED','CANCELLED'));

comment on column public.floyd_dfs_portfolio_members.refund_amount is 'Verified contest refund, tracked separately from payout and fee.';
comment on column public.floyd_dfs_contest_results.refund_amount is 'Contest refund from imported official results; null means refund evidence was not supplied.';
comment on column public.floyd_dfs_contest_field_entries.refund_amount is 'Contest refund from versioned official full-field import.';
