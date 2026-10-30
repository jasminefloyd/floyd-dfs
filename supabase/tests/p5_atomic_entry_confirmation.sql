-- Structural/security checks for the atomic P5 entry-confirmation migration.
do $$
declare
  target regprocedure := to_regprocedure('public.floyd_dfs_confirm_lineup_entry(uuid,uuid,uuid,text,text,text,text,text,numeric,jsonb,integer,integer,integer,integer,integer)');
begin
  if target is null then
    raise exception 'Atomic lineup-entry confirmation function is missing.';
  end if;
  if not has_function_privilege('service_role', target, 'EXECUTE') then
    raise exception 'service_role must be allowed to execute atomic lineup-entry confirmation.';
  end if;
  if has_function_privilege('anon', target, 'EXECUTE') or has_function_privilege('authenticated', target, 'EXECUTE') then
    raise exception 'Browser roles must not execute the privileged lineup-entry transaction directly.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'floyd_dfs_lock_snapshots' and column_name = 'lineup_revision'
  ) then
    raise exception 'Lock snapshots must identify the immutable lineup revision they capture.';
  end if;
end $$;
