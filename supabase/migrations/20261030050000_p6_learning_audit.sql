-- Preserve contest-result corrections as new versions and make model review
-- decisions explicit/auditable. Reconciliation metadata may be appended to a
-- result, while the imported outcome facts themselves remain immutable.
alter table public.floyd_dfs_contest_results
  add column if not exists revision integer not null default 1,
  add column if not exists supersedes_id uuid,
  add column if not exists source_sha256 text;

with ranked as (
  select id, tenant_id,
         row_number() over (partition by tenant_id, generated_lineup_id, contest_id order by measured_at, id)::integer as revision,
         lag(id) over (partition by tenant_id, generated_lineup_id, contest_id order by measured_at, id) as supersedes_id
  from public.floyd_dfs_contest_results
)
update public.floyd_dfs_contest_results r
set revision = ranked.revision, supersedes_id = ranked.supersedes_id
from ranked where ranked.id = r.id and ranked.tenant_id = r.tenant_id;

create unique index if not exists floyd_dfs_contest_results_id_tenant_uidx
  on public.floyd_dfs_contest_results (id, tenant_id);
create unique index if not exists floyd_dfs_contest_results_lineup_revision_uidx
  on public.floyd_dfs_contest_results (tenant_id, generated_lineup_id, contest_id, revision);
create unique index if not exists floyd_dfs_contest_results_source_uidx
  on public.floyd_dfs_contest_results (tenant_id, generated_lineup_id, source_sha256)
  where source_sha256 is not null;

alter table public.floyd_dfs_contest_results
  add constraint floyd_dfs_contest_results_supersedes_tenant_fk
  foreign key (supersedes_id, tenant_id)
  references public.floyd_dfs_contest_results(id, tenant_id) on delete restrict;

create or replace function public.floyd_dfs_version_contest_result()
returns trigger language plpgsql as $$
declare previous_id uuid; previous_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.generated_lineup_id::text || ':' || coalesce(new.contest_id, ''), 0));
  select id, revision into previous_id, previous_revision
  from public.floyd_dfs_contest_results
  where tenant_id = new.tenant_id and generated_lineup_id = new.generated_lineup_id
    and contest_id is not distinct from new.contest_id
  order by revision desc limit 1;
  new.revision := coalesce(previous_revision, 0) + 1;
  new.supersedes_id := previous_id;
  return new;
end $$;

drop trigger if exists floyd_dfs_contest_results_version on public.floyd_dfs_contest_results;
create trigger floyd_dfs_contest_results_version
  before insert on public.floyd_dfs_contest_results
  for each row execute function public.floyd_dfs_version_contest_result();

create or replace function public.floyd_dfs_protect_contest_result_facts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Contest result history is append-only; insert a corrected result version.';
  end if;
  if row(new.generated_lineup_id, new.actual_dk_points, new.finish_position, new.finish_percentile,
         new.payout, new.roi, new.cash_line, new.beat_cash_line, new.contest_id, new.contest_name,
         new.sport, new.contest_format, new.field_size, new.entry_fee, new.paid_positions,
         new.outcome_source, new.external_entry_id, new.official_outcome, new.source_sha256)
     is distinct from
     row(old.generated_lineup_id, old.actual_dk_points, old.finish_position, old.finish_percentile,
         old.payout, old.roi, old.cash_line, old.beat_cash_line, old.contest_id, old.contest_name,
         old.sport, old.contest_format, old.field_size, old.entry_fee, old.paid_positions,
         old.outcome_source, old.external_entry_id, old.official_outcome, old.source_sha256) then
    raise exception 'Contest outcome facts are immutable; insert a corrected result version.';
  end if;
  return new;
end $$;

drop trigger if exists floyd_dfs_contest_results_immutable on public.floyd_dfs_contest_results;
create trigger floyd_dfs_contest_results_immutable
  before update or delete on public.floyd_dfs_contest_results
  for each row execute function public.floyd_dfs_protect_contest_result_facts();

alter table public.floyd_dfs_model_evaluations
  add column if not exists component text not null default 'PROJECTION',
  add column if not exists baseline_model_version text,
  add column if not exists candidate_model_version text,
  add column if not exists gate_decision text not null default 'HOLD',
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.floyd_dfs_model_evaluations
  drop constraint if exists floyd_dfs_model_evaluations_component_check;
alter table public.floyd_dfs_model_evaluations
  add constraint floyd_dfs_model_evaluations_component_check
  check (component in ('PROJECTION','SIMULATION','FIELD_MODEL','OPTIMIZER','PORTFOLIO'));
alter table public.floyd_dfs_model_evaluations
  drop constraint if exists floyd_dfs_model_evaluations_gate_decision_check;
alter table public.floyd_dfs_model_evaluations
  add constraint floyd_dfs_model_evaluations_gate_decision_check
  check (gate_decision in ('PROMOTE','HOLD','INSUFFICIENT_DATA'));
alter table public.floyd_dfs_model_evaluations
  drop constraint if exists floyd_dfs_model_evaluations_review_complete_check;
alter table public.floyd_dfs_model_evaluations
  add constraint floyd_dfs_model_evaluations_review_complete_check
  check ((reviewed_by is null and reviewed_at is null and review_note is null)
      or (reviewed_by is not null and reviewed_at is not null and length(trim(review_note)) > 0));

comment on column public.floyd_dfs_contest_results.revision is 'Append-only revision number for imported/manual contest outcomes per lineup.';
comment on column public.floyd_dfs_model_evaluations.gate_decision is 'Offline recommendation only; ACTIVE model status still requires an explicit reviewed registry transition.';

-- Full-field imports are also revisioned. A corrected entry supersedes its
-- previous source row without deleting the original standings evidence.
alter table public.floyd_dfs_contest_field_entries
  add column if not exists revision integer not null default 1,
  add column if not exists supersedes_id uuid;

with ranked as (
  select id, tenant_id,
         row_number() over (partition by tenant_id, contest_id, external_entry_id order by imported_at, id)::integer as revision,
         lag(id) over (partition by tenant_id, contest_id, external_entry_id order by imported_at, id) as supersedes_id
  from public.floyd_dfs_contest_field_entries
)
update public.floyd_dfs_contest_field_entries e
set revision = ranked.revision, supersedes_id = ranked.supersedes_id
from ranked where ranked.id = e.id and ranked.tenant_id = e.tenant_id;

create unique index if not exists floyd_dfs_contest_field_entries_id_tenant_uidx
  on public.floyd_dfs_contest_field_entries (id, tenant_id);
create unique index if not exists floyd_dfs_contest_field_entries_revision_uidx
  on public.floyd_dfs_contest_field_entries (tenant_id, contest_id, external_entry_id, revision);
create unique index if not exists floyd_dfs_contest_field_entries_source_uidx
  on public.floyd_dfs_contest_field_entries (tenant_id, contest_id, external_entry_id, source_sha256);
alter table public.floyd_dfs_contest_field_entries
  add constraint floyd_dfs_contest_field_entries_supersedes_tenant_fk
  foreign key (supersedes_id, tenant_id)
  references public.floyd_dfs_contest_field_entries(id, tenant_id) on delete restrict;

alter table public.floyd_dfs_contest_field_entries
  drop constraint if exists floyd_dfs_contest_field_entries_finality_status_check;
alter table public.floyd_dfs_contest_field_entries
  add constraint floyd_dfs_contest_field_entries_finality_status_check
  check (finality_status in ('PROVISIONAL','FINAL','CORRECTED','SUPERSEDED'));

create or replace function public.floyd_dfs_version_contest_field_entry()
returns trigger language plpgsql as $$
declare previous_id uuid; previous_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.contest_id || ':' || new.external_entry_id, 0));
  select id, revision into previous_id, previous_revision
  from public.floyd_dfs_contest_field_entries
  where tenant_id = new.tenant_id and contest_id = new.contest_id and external_entry_id = new.external_entry_id
  order by revision desc limit 1;
  new.revision := coalesce(previous_revision, 0) + 1;
  new.supersedes_id := previous_id;
  return new;
end $$;

drop trigger if exists floyd_dfs_contest_field_entries_version on public.floyd_dfs_contest_field_entries;
create trigger floyd_dfs_contest_field_entries_version
  before insert on public.floyd_dfs_contest_field_entries
  for each row execute function public.floyd_dfs_version_contest_field_entry();

create or replace function public.floyd_dfs_protect_contest_field_entry_facts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Contest field history is append-only; insert a corrected source row.';
  end if;
  if new.finality_status = 'SUPERSEDED'
     and row(new.tenant_id,new.contest_id,new.external_entry_id,new.sport,new.contest_format,new.field_size,new.entry_fee,new.paid_positions,new.finish_position,new.actual_dk_points,new.payout,new.player_ids,new.outcome_source,new.source_sha256)
         is not distinct from
         row(old.tenant_id,old.contest_id,old.external_entry_id,old.sport,old.contest_format,old.field_size,old.entry_fee,old.paid_positions,old.finish_position,old.actual_dk_points,old.payout,old.player_ids,old.outcome_source,old.source_sha256) then
    return new;
  end if;
  if row(new.tenant_id,new.contest_id,new.external_entry_id,new.sport,new.contest_format,new.field_size,new.entry_fee,new.paid_positions,new.finish_position,new.actual_dk_points,new.payout,new.player_ids,new.outcome_source,new.source_sha256,new.finality_status)
     is distinct from
     row(old.tenant_id,old.contest_id,old.external_entry_id,old.sport,old.contest_format,old.field_size,old.entry_fee,old.paid_positions,old.finish_position,old.actual_dk_points,old.payout,old.player_ids,old.outcome_source,old.source_sha256,old.finality_status) then
    raise exception 'Contest field outcome facts are immutable; insert a corrected source row.';
  end if;
  return new;
end $$;

drop trigger if exists floyd_dfs_contest_field_entries_immutable on public.floyd_dfs_contest_field_entries;
create trigger floyd_dfs_contest_field_entries_immutable
  before update or delete on public.floyd_dfs_contest_field_entries
  for each row execute function public.floyd_dfs_protect_contest_field_entry_facts();
