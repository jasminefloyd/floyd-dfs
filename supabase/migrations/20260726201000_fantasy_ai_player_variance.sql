ALTER TABLE IF EXISTS tenant_fantasy_ai.player_last_5_stats
  ADD COLUMN IF NOT EXISTS stdev_fantasy_pts FLOAT NULL,
  ADD COLUMN IF NOT EXISTS games_sample_size INT NULL,
  ADD COLUMN IF NOT EXISTS minutes_stdev FLOAT NULL;
