alter table public.floyd_dfs_historical_player_actuals
  add column if not exists scoring_rules_sha256 text;
alter table public.floyd_dfs_player_actual_revisions
  add column if not exists scoring_rules_sha256 text;

comment on column public.floyd_dfs_historical_player_actuals.scoring_rules_sha256 is 'SHA-256 fingerprint of the exact saved DraftKings scoring-rules input used to score this official actual.';
comment on column public.floyd_dfs_player_actual_revisions.scoring_rules_sha256 is 'Scoring-rules fingerprint retained with immutable correction history.';
