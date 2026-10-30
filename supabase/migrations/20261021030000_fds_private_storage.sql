-- Screenshot uploads are server-mediated and use the service-role Storage client.
-- storage.objects already has RLS enabled and its existing policies are scoped to
-- other named buckets. The DraftKings bucket therefore has no browser-role policy;
-- avoid owner-only ALTER TABLE / CREATE POLICY statements against Supabase-managed
-- storage.objects, which are not executable by the linked postgres role.
insert into storage.buckets (id, name, public)
values ('draftkings', 'draftkings', false)
on conflict (id) do update set name = excluded.name, public = false;
