-- Preserve the exact contest rules used for a generated portfolio and expose
-- settlement progress without conflating it with generated/entered entry state.
alter table public.floyd_dfs_lineup_portfolios
  add column if not exists contest_spec jsonb not null default '{}'::jsonb;

alter table public.floyd_dfs_portfolio_members
  add column if not exists settlement_status text not null default 'NOT_ENTERED';

alter table public.floyd_dfs_portfolio_members
  drop constraint if exists floyd_dfs_portfolio_members_settlement_status_check;
alter table public.floyd_dfs_portfolio_members
  add constraint floyd_dfs_portfolio_members_settlement_status_check
  check (settlement_status in ('NOT_ENTERED','ENTERED','LOCKED','RESULTS_PENDING','PARTIAL','VERIFIED','DISPUTED'));

create index if not exists floyd_dfs_portfolio_members_settlement_idx
  on public.floyd_dfs_portfolio_members (tenant_id, portfolio_id, settlement_status);

create or replace function public.floyd_dfs_set_initial_portfolio_settlement_status()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.entry_status = 'ENTERED' then
    new.settlement_status := 'ENTERED';
  else
    new.settlement_status := 'NOT_ENTERED';
  end if;
  return new;
end;
$$;

drop trigger if exists floyd_dfs_portfolio_member_initial_settlement on public.floyd_dfs_portfolio_members;
create trigger floyd_dfs_portfolio_member_initial_settlement
before insert on public.floyd_dfs_portfolio_members
for each row execute function public.floyd_dfs_set_initial_portfolio_settlement_status();

comment on column public.floyd_dfs_lineup_portfolios.contest_spec is 'Versioned contest rules, source provenance, and exact eligible pool used to build this portfolio.';
comment on column public.floyd_dfs_portfolio_members.settlement_status is 'Lifecycle of verified entry/outcome evidence; separate from generated/entered/withdrawn entry status.';
