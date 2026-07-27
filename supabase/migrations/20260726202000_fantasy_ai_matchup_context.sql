CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.matchup_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  season TEXT NULL,
  contest_date DATE NULL,
  team TEXT NOT NULL,
  opponent_team TEXT NULL,
  position TEXT NULL,
  dvp_rank INT NULL,
  dvp_fantasy_points_allowed FLOAT NULL,
  dvp_multiplier FLOAT NULL CHECK (dvp_multiplier IS NULL OR (dvp_multiplier >= 0.75 AND dvp_multiplier <= 1.25)),
  pace_metric FLOAT NULL,
  possessions_per_48 FLOAT NULL,
  days_rest INT NULL,
  is_back_to_back BOOLEAN NULL,
  is_home BOOLEAN NULL,
  sample_size INT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  source_updated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS matchup_context_slate_idx
  ON tenant_fantasy_ai.matchup_context (sport, contest_date, team);

CREATE INDEX IF NOT EXISTS matchup_context_position_idx
  ON tenant_fantasy_ai.matchup_context (sport, position, contest_date);

CREATE UNIQUE INDEX IF NOT EXISTS matchup_context_unique_idx
  ON tenant_fantasy_ai.matchup_context (sport, contest_date, team, COALESCE(opponent_team, ''), COALESCE(position, ''), source);

ALTER TABLE tenant_fantasy_ai.matchup_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matchup_context_select ON tenant_fantasy_ai.matchup_context;
CREATE POLICY matchup_context_select ON tenant_fantasy_ai.matchup_context
  FOR SELECT
  USING (true);

GRANT SELECT ON tenant_fantasy_ai.matchup_context TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.matchup_context TO service_role;
