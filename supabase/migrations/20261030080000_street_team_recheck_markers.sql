alter table public.floyd_dfs_generated_lineups
  add column if not exists recheck_required boolean not null default false,
  add column if not exists recheck_required_at timestamptz,
  add column if not exists recheck_reason jsonb not null default '{}'::jsonb;

create index if not exists floyd_dfs_generated_lineups_recheck_idx
  on public.floyd_dfs_generated_lineups (tenant_id, recheck_required, created_at desc)
  where recheck_required = true;

comment on column public.floyd_dfs_generated_lineups.recheck_required is 'True when new pre-lock Street Team evidence affects this unentered lineup; the saved lineup itself remains immutable.';
comment on column public.floyd_dfs_generated_lineups.recheck_reason is 'Redacted snapshot/evidence references requiring a pre-lock review.';
