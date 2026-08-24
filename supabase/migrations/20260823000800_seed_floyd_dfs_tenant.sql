do $$
declare
  target_tenant_id uuid;
  target_user_id uuid;
begin
  insert into public.tenants (name, slug)
  values ('floyd-dfs', 'floyd-dfs')
  on conflict (slug) do update
    set name = excluded.name
  returning id into target_tenant_id;

  if target_tenant_id is null then
    select id into target_tenant_id
    from public.tenants
    where slug = 'floyd-dfs';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower('jasmine@demo.com')
  limit 1;

  if target_user_id is null then
    raise exception 'Auth user jasmine@demo.com does not exist';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (target_tenant_id, target_user_id, 'admin')
  on conflict (tenant_id, user_id) do update
    set role = excluded.role;
end;
$$;
