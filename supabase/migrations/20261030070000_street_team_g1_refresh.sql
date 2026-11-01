-- G1 collection run telemetry. Existing P2 rows remain valid with nullable metadata.
alter table public.floyd_dfs_intel_collection_runs
  add column if not exists source_count integer,
  add column if not exists changed_count integer,
  add column if not exists error_code text,
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists provider_request_id text;

alter table public.floyd_dfs_intel_observations
  add column if not exists source_tier text,
  add column if not exists normalized_claim text,
  add column if not exists quantifiable boolean not null default false;

comment on column public.floyd_dfs_intel_collection_runs.source_count is 'Number of provider feeds reported by the refresh invocation.';
comment on column public.floyd_dfs_intel_collection_runs.changed_count is 'Number of observations in a meaningful state change; zero means no canonical snapshot was added.';
comment on column public.floyd_dfs_intel_collection_runs.provider_request_id is 'Provider request correlation ID when exposed by the provider response.';
comment on column public.floyd_dfs_intel_observations.source_tier is 'Provider/publisher class recorded by Street Team; does not imply league-official status.';
comment on column public.floyd_dfs_intel_observations.normalized_claim is 'Normalized evidence wording alongside the preserved raw claim and payload.';
