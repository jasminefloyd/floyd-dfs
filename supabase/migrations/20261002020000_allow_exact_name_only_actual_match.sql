-- Golf actual feeds expose golfer DraftKings IDs in the catalog rather than always on
-- tournament score rows. Preserve an explicit unique-name match as a separate audit class.
alter table public.floyd_dfs_historical_player_actuals
  drop constraint if exists floyd_dfs_historical_player_actuals_identity_match_check;
alter table public.floyd_dfs_historical_player_actuals
  add constraint floyd_dfs_historical_player_actuals_identity_match_check
  check (identity_match in ('PROVIDER_ID','NAME_AND_TEAM','NAME_ONLY'));
