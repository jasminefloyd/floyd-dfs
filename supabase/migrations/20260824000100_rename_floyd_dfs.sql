-- Rename the already-applied A New Fantasy database objects in place.
-- This preserves tenant data, RLS, foreign keys, and existing generated lineups.
do $$
declare
  item record;
  renamed text;
begin
  for item in
    select n.nspname as schema_name, c.relname as object_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'a_new_fantasy%'
  loop
    renamed := replace(item.object_name, 'a_new_fantasy', 'floyd_dfs');
    if not exists (
      select 1
      from pg_class c2
      join pg_namespace n2 on n2.oid = c2.relnamespace
      where n2.nspname = item.schema_name and c2.relname = renamed
    ) then
      execute format(
        'alter %s %I.%I rename to %I',
        case item.relkind
          when 'r' then 'table'
          when 'p' then 'table'
          when 'v' then 'view'
          when 'm' then 'materialized view'
          when 'f' then 'foreign table'
          when 'S' then 'sequence'
          when 'i' then 'index'
        end,
        item.schema_name,
        item.object_name,
        renamed
      );
    end if;
  end loop;

  for item in
    select n.nspname as schema_name, p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'a_new_fantasy%'
  loop
    renamed := replace(item.function_name, 'a_new_fantasy', 'floyd_dfs');
    execute format(
      'alter function %I.%I(%s) rename to %I',
      item.schema_name,
      item.function_name,
      item.arguments,
      renamed
    );
  end loop;

  for item in
    select n.nspname as schema_name, c.relname as table_name,
           p.polname as policy_name
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and p.polname like 'a_new_fantasy%'
  loop
    renamed := replace(item.policy_name, 'a_new_fantasy', 'floyd_dfs');
    execute format(
      'alter policy %I on %I.%I rename to %I',
      item.policy_name,
      item.schema_name,
      item.table_name,
      renamed
    );
  end loop;

  for item in
    select n.nspname as schema_name, c.relname as table_name,
           con.conname as constraint_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and con.conname like 'a_new_fantasy%'
  loop
    renamed := replace(item.constraint_name, 'a_new_fantasy', 'floyd_dfs');
    execute format(
      'alter table %I.%I rename constraint %I to %I',
      item.schema_name,
      item.table_name,
      item.constraint_name,
      renamed
    );
  end loop;

  update public.tenants
  set name = 'floyd-dfs', slug = 'floyd-dfs', updated_at = now()
  where slug = 'a-new-fantasy' or name = 'a_new_fantasy';
end
$$;
