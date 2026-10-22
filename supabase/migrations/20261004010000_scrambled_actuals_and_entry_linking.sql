-- SportsDataIO trial feeds use realistic but intentionally altered values.
-- Keep the original rows for audit while withdrawing them from evaluation.
alter table public.floyd_dfs_historical_player_actuals
  add column if not exists source_data_tier text not null default 'UNKNOWN',
  add column if not exists source_provenance jsonb not null default '{}'::jsonb;

alter table public.floyd_dfs_player_actual_revisions
  add column if not exists source_data_tier text not null default 'UNKNOWN',
  add column if not exists source_provenance jsonb not null default '{}'::jsonb;

update public.floyd_dfs_historical_player_actuals
set source_validation_status = 'INVALID_SOURCE',
    source_validation_reason = 'SportsDataIO response came from a scrambled trial entitlement; stats and fantasy points are intentionally altered and cannot be used as actuals.',
    source_data_tier = 'FREE_TRIAL_SCRAMBLED',
    source_provenance = coalesce(source_provenance, '{}'::jsonb) || jsonb_build_object(
      'provider', 'SportsDataIO',
      'dataTier', 'FREE_TRIAL_SCRAMBLED',
      'quarantinedAt', now(),
      'reason', 'Provider documentation states free trial stats are randomly adjusted 5–20%.'
    )
where provider like 'SPORTSDATAIO%';

-- Preserve the quality-status correction as a distinct immutable revision.
-- md5 is used only as a deterministic revision identity, not as a security digest.
insert into public.floyd_dfs_player_actual_revisions (
  tenant_id, generation_run_id, projection_run_id, sport, event_date, player_id,
  actual_dk_points, actual_components, source, source_validation_status,
  source_validation_reason, finality_status, source_retrieved_at,
  content_sha256, source_data_tier, source_provenance
)
select a.tenant_id, a.generation_run_id, a.projection_run_id, a.sport, a.event_date,
       a.player_id, a.actual_dk_points, a.actual_components,
       'SPORTSDATAIO_TRIAL_SCRAMBLED', 'INVALID_SOURCE',
       a.source_validation_reason, 'UNVERIFIED', a.source_retrieved_at,
       md5(concat_ws('|', a.projection_run_id, a.player_id, a.actual_dk_points,
                     a.actual_components::text, 'FREE_TRIAL_SCRAMBLED')),
       'FREE_TRIAL_SCRAMBLED', a.source_provenance
from public.floyd_dfs_historical_player_actuals a
where a.provider like 'SPORTSDATAIO%'
on conflict (tenant_id, projection_run_id, player_id, content_sha256) do nothing;

update public.floyd_dfs_contest_results r
set reconciliation_status = 'SOURCE_INVALID',
    model_evaluation_eligible = false,
    result_payload = coalesce(r.result_payload, '{}'::jsonb) || jsonb_build_object(
      'actualSourceAudit', 'SportsDataIO trial stats are scrambled; prior player-score reconciliation is withdrawn.'
    )
where r.reconciliation_status = 'MATCHED'
  and exists (
    select 1
    from public.floyd_dfs_generated_lineups l
    join public.floyd_dfs_selection_runs s on s.id = l.selection_run_id
    join public.floyd_dfs_historical_player_actuals a on a.generation_run_id = s.generation_run_id
    where l.id = r.generated_lineup_id
      and a.provider like 'SPORTSDATAIO%'
      and a.player_id in (select jsonb_array_elements_text(coalesce(l.lineup_payload->'playerIds', '[]'::jsonb)))
  );

-- A DraftKings entry ID is the stable bridge between a user's saved lineup and
-- a native/normalized standings export. Store that link before contest lock.
create table if not exists public.floyd_dfs_entry_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  generated_lineup_id uuid not null references public.floyd_dfs_generated_lineups(id) on delete cascade,
  contest_id text not null,
  contest_name text,
  external_entry_id text not null,
  sport text not null check (sport in ('MLB','WNBA','NFL','CFB','GOLF','NBA')),
  contest_format text not null check (contest_format in ('CLASSIC','SHOWDOWN')),
  linked_at timestamptz not null default now(),
  unique (tenant_id, contest_id, external_entry_id),
  unique (tenant_id, generated_lineup_id, contest_id)
);
create index if not exists floyd_dfs_entry_links_lineup_idx
  on public.floyd_dfs_entry_links (tenant_id, generated_lineup_id, linked_at desc);
alter table public.floyd_dfs_entry_links enable row level security;
