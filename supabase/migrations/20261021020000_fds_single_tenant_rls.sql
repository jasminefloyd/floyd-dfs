-- This Supabase project hosts multiple application tenants. Floyd DFS data is pinned to
-- the `floyd-dfs` tenant, including direct authenticated REST access. Service-role API
-- handlers continue to work and must still include explicit tenant predicates.
do $$
declare
  target record;
  table_list text[] := array[
    'generation_runs',
    'engine_jobs',
    'engine_events',
    'engine_stage_runs'
  ];
begin
  for target in
    select c.relname, bool_or(a.attname = 'tenant_id') as has_tenant_id
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (c.relname like 'floyd_dfs_%' or c.relname = any(table_list))
    group by c.relname
  loop
    execute format('alter table public.%I enable row level security', target.relname);
    if target.has_tenant_id then
      execute format('drop policy if exists fds_project_tenant_isolation on public.%I', target.relname);
      execute format(
        'create policy fds_project_tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = (select id from public.tenants where slug = %L)) with check (tenant_id = (select id from public.tenants where slug = %L))',
        target.relname,
        'floyd-dfs',
        'floyd-dfs'
      );
    end if;
  end loop;
end $$;

-- Historical actuals had browser grants but RLS disabled. The restrictive single-tenant
-- policy above now applies; no browser policy is added, so only the server service role can
-- access it directly.
