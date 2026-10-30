-- Run after the P1 and P2 Street Team migrations in a Supabase test database.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'floyd_dfs_intel_snapshots' and column_name = 'snapshot_payload') then
    raise exception 'P2 normalized snapshot payload column is missing.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'floyd_dfs_intel_collection_runs' and column_name = 'lease_expires_at') then
    raise exception 'P2 collection lease column is missing.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.floyd_dfs_intel_snapshots'::regclass and tgname = 'floyd_dfs_intel_snapshots_append_only_trg' and not tgisinternal) then
    raise exception 'Append-only snapshot trigger is missing.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.floyd_dfs_intel_snapshot_observations'::regclass and tgname = 'floyd_dfs_intel_snapshot_observations_append_only_trg' and not tgisinternal) then
    raise exception 'Append-only snapshot evidence trigger is missing.';
  end if;
  if to_regprocedure('public.floyd_dfs_create_intel_snapshot_with_evidence(jsonb,jsonb)') is null then
    raise exception 'Atomic snapshot and evidence-link function is missing.';
  end if;
end $$;
