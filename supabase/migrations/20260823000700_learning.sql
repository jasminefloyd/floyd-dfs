create table if not exists public.floyd_dfs_watch_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  subject text not null, importance text not null, current_state jsonb, trigger_condition jsonb, affected_player_ids jsonb not null default '[]'::jsonb, affected_lineup_ids jsonb not null default '[]'::jsonb, expected_update_at timestamptz, status text not null default 'active' check (status in ('active','resolved','expired')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.floyd_dfs_change_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generation_run_id uuid not null references public.generation_runs(id) on delete cascade, event_type text not null, subject text not null, previous_state jsonb, new_state jsonb, materiality text not null check (materiality in ('LOW','MEDIUM','HIGH','CRITICAL')), source jsonb not null default '{}'::jsonb, affected_lineup_ids jsonb not null default '[]'::jsonb, detected_at timestamptz not null default now()
);
create table if not exists public.floyd_dfs_lock_snapshots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generated_lineup_id uuid not null references public.floyd_dfs_generated_lineups(id) on delete cascade, locked_at timestamptz not null, lineup_payload jsonb not null, projection_snapshot jsonb not null, game_script text, risk_flags jsonb not null default '[]'::jsonb, research_version integer not null, adjustment_version integer not null, projection_version integer not null, optimization_version integer not null, selection_version integer not null
);
create table if not exists public.floyd_dfs_contest_results (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generated_lineup_id uuid not null references public.floyd_dfs_generated_lineups(id) on delete cascade, actual_dk_points numeric, finish_position integer, finish_percentile numeric, payout numeric, roi numeric, result_payload jsonb, measured_at timestamptz not null default now()
);
create table if not exists public.floyd_dfs_player_measurements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generated_lineup_id uuid not null references public.floyd_dfs_generated_lineups(id) on delete cascade, player_id text not null, projected_opportunity jsonb, actual_opportunity jsonb, projected_floor numeric, projected_median numeric, projected_ceiling numeric, actual_dk numeric, projection_error numeric, within_expected_range boolean, created_at timestamptz not null default now()
);
create table if not exists public.floyd_dfs_learning_diagnostics (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, generation_run_id uuid not null references public.generation_runs(id) on delete cascade, subject_type text not null, subject_id text not null, error_stage text not null, severity text, confidence text not null, assumption text, actual_outcome text, evidence jsonb, diagnosis text not null, created_at timestamptz not null default now()
);
create table if not exists public.floyd_dfs_lesson_candidates (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, sport text not null, stage text not null, observation text not null, proposed_change text, status text not null check (status in ('OBSERVED','ACCUMULATING','VALIDATED','REJECTED')), sample_count integer not null default 1, confidence text, evidence jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists floyd_dfs_learning_change_events_idx on public.floyd_dfs_change_events(tenant_id, generation_run_id, detected_at desc);
create index if not exists floyd_dfs_learning_results_idx on public.floyd_dfs_contest_results(tenant_id, measured_at desc);
create index if not exists floyd_dfs_learning_diagnostics_idx on public.floyd_dfs_learning_diagnostics(tenant_id, generation_run_id, created_at desc);
create index if not exists floyd_dfs_lesson_candidates_idx on public.floyd_dfs_lesson_candidates(tenant_id, status, updated_at desc);

alter table public.floyd_dfs_watch_items enable row level security;
alter table public.floyd_dfs_change_events enable row level security;
alter table public.floyd_dfs_lock_snapshots enable row level security;
alter table public.floyd_dfs_contest_results enable row level security;
alter table public.floyd_dfs_player_measurements enable row level security;
alter table public.floyd_dfs_learning_diagnostics enable row level security;
alter table public.floyd_dfs_lesson_candidates enable row level security;

do $$ declare table_name text; begin foreach table_name in array array['floyd_dfs_watch_items','floyd_dfs_change_events','floyd_dfs_lock_snapshots','floyd_dfs_contest_results','floyd_dfs_player_measurements','floyd_dfs_learning_diagnostics','floyd_dfs_lesson_candidates'] loop execute format('drop policy if exists %I on public.%I', table_name || '_member_select', table_name); execute format('create policy %I on public.%I for select to authenticated using (public.is_tenant_member(tenant_id))', table_name || '_member_select', table_name); execute format('drop policy if exists %I on public.%I', table_name || '_member_insert', table_name); execute format('create policy %I on public.%I for insert to authenticated with check (public.is_tenant_member(tenant_id))', table_name || '_member_insert', table_name); end loop; end $$;

drop policy if exists floyd_dfs_generated_lineups_member_update on public.floyd_dfs_generated_lineups;
drop policy if exists floyd_dfs_generated_lineups_entered_update on public.floyd_dfs_generated_lineups;
create policy floyd_dfs_generated_lineups_entered_update on public.floyd_dfs_generated_lineups for update to authenticated using (public.is_tenant_member(tenant_id) and status = 'GENERATED') with check (public.is_tenant_member(tenant_id));
