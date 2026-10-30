-- Read-only catalog assertions. Run after applying the P1 migrations to a Supabase
-- test database; no tenant rows are selected or changed by this test.
do $$
declare
  target text;
  rel oid;
  rls_enabled boolean;
  policy_permissive boolean;
  policy_command "char";
  policy_using text;
  policy_check text;
  authenticated_role oid;
  role_name text;
  expected_tables text[] := array[
    'floyd_dfs_intel_collection_runs',
    'floyd_dfs_intel_observations',
    'floyd_dfs_intel_snapshots',
    'floyd_dfs_intel_snapshot_observations',
    'floyd_dfs_behavior_signals',
    'floyd_dfs_house_reports',
    'floyd_dfs_lineup_portfolios',
    'floyd_dfs_portfolio_members',
    'floyd_dfs_model_registry'
  ];
begin
  select oid into authenticated_role from pg_roles where rolname = 'authenticated';
  if authenticated_role is null then raise exception 'Supabase authenticated role is missing.'; end if;

  foreach target in array expected_tables loop
    rel := to_regclass(format('public.%I', target));
    if rel is null then raise exception 'P1 table public.% is missing.', target; end if;
    select relrowsecurity into rls_enabled from pg_class where oid = rel;
    if not rls_enabled then raise exception 'RLS is disabled on public.%.', target; end if;

    select p.polpermissive, p.polcmd, coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      into policy_permissive, policy_command, policy_using, policy_check
      from pg_policy p where p.polrelid = rel and p.polname = 'fds_project_tenant_isolation';
    if not found then raise exception 'Tenant isolation policy is missing on public.%.', target; end if;
    if policy_permissive or policy_command <> '*' or policy_using not like '%floyd-dfs%' or policy_check not like '%floyd-dfs%' then
      raise exception 'Tenant policy on public.% is not restrictive and fixed-tenant scoped.', target;
    end if;
    if not (select authenticated_role = any(p.polroles) from pg_policy p where p.polrelid = rel and p.polname = 'fds_project_tenant_isolation') then
      raise exception 'Tenant policy on public.% does not cover authenticated.', target;
    end if;

    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name, rel, 'SELECT')
        or has_table_privilege(role_name, rel, 'INSERT')
        or has_table_privilege(role_name, rel, 'UPDATE')
        or has_table_privilege(role_name, rel, 'DELETE') then
        raise exception 'Browser role % has direct table access to public.%.', role_name, target;
      end if;
    end loop;
    if not (has_table_privilege('service_role', rel, 'SELECT')
      and has_table_privilege('service_role', rel, 'INSERT')
      and has_table_privilege('service_role', rel, 'UPDATE')
      and has_table_privilege('service_role', rel, 'DELETE')) then
      raise exception 'service_role is missing required access to public.%.', target;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.floyd_dfs_intel_observations'::regclass
      and t.tgname = 'floyd_dfs_intel_observations_append_only_trg'
      and not t.tgisinternal
  ) then
    raise exception 'Append-only observation trigger is missing.';
  end if;
end $$;
