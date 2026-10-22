-- Screenshot uploads are server-mediated and stored under the configured tenant/user path.
insert into storage.buckets (id, name, public)
values ('draftkings', 'draftkings', false)
on conflict (id) do update set public = false;

alter table storage.objects enable row level security;
drop policy if exists fds_draftkings_server_only on storage.objects;
create policy fds_draftkings_server_only
  on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'draftkings')
  with check (bucket_id <> 'draftkings');
