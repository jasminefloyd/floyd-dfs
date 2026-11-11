-- Store a digest for the normalized JSON payload written by the server evidence ledger.
alter table public.floyd_dfs_source_observations
  add column if not exists raw_payload_sha256 text;

update public.floyd_dfs_source_observations
set raw_payload_sha256 = encode(extensions.digest(convert_to(raw_payload::text, 'UTF8'), 'sha256'), 'hex')
where raw_payload_sha256 is null;

alter table public.floyd_dfs_source_observations
  alter column raw_payload_sha256 set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.floyd_dfs_source_observations'::regclass
      and conname = 'floyd_dfs_source_observations_raw_payload_sha256_check'
  ) then
    alter table public.floyd_dfs_source_observations
      add constraint floyd_dfs_source_observations_raw_payload_sha256_check
      check (raw_payload_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;
