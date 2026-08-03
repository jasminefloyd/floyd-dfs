-- Canonical identity, game-log, environment, and source-quality contracts.
CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.player_identities (
  canonical_player_id TEXT PRIMARY KEY,
  sport VARCHAR(10) NOT NULL,
  display_name TEXT NOT NULL,
  team TEXT,
  position TEXT,
  provider_ids JSONB NOT NULL DEFAULT '{}'::JSONB,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_pitcher BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_identities_provider_ids_idx
  ON tenant_fantasy_ai.player_identities USING GIN (provider_ids);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.game_identities (
  canonical_game_id TEXT PRIMARY KEY,
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  home_team TEXT,
  away_team TEXT,
  venue TEXT,
  starts_at TIMESTAMPTZ,
  provider_ids JSONB NOT NULL DEFAULT '{}'::JSONB,
  environment JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.player_game_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_player_id TEXT NOT NULL,
  sport VARCHAR(10) NOT NULL,
  canonical_game_id TEXT,
  provider_game_id TEXT,
  game_date DATE NOT NULL,
  opponent TEXT,
  home_away TEXT CHECK (home_away IN ('home', 'away', 'unknown')),
  raw_stats JSONB NOT NULL DEFAULT '{}'::JSONB,
  fantasy_points FLOAT,
  scoring_version TEXT NOT NULL DEFAULT 'dk-scoring-v1',
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_player_id, sport, game_date, source)
);

CREATE INDEX IF NOT EXISTS player_game_logs_lookup_idx
  ON tenant_fantasy_ai.player_game_logs (sport, canonical_player_id, game_date DESC);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.source_quality (
  source TEXT NOT NULL,
  sport VARCHAR(10) NOT NULL DEFAULT '*',
  data_class TEXT NOT NULL,
  reliability FLOAT NOT NULL DEFAULT 0.5 CHECK (reliability >= 0 AND reliability <= 1),
  freshness_ttl_seconds INTEGER,
  official BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, sport, data_class)
);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.game_environments (
  canonical_game_id TEXT PRIMARY KEY,
  sport VARCHAR(10) NOT NULL,
  venue TEXT,
  timezone TEXT,
  rest_days_home FLOAT,
  rest_days_away FLOAT,
  travel_miles_home FLOAT,
  travel_miles_away FLOAT,
  weather JSONB NOT NULL DEFAULT '{}'::JSONB,
  market_snapshots JSONB NOT NULL DEFAULT '[]'::JSONB,
  sport_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenant_fantasy_ai.source_quality (source, sport, data_class, reliability, freshness_ttl_seconds, official)
VALUES
  ('draftkings_salaries', '*', 'salary', 0.95, 86400, TRUE),
  ('draftkings_confirmed_lineups', '*', 'availability', 0.95, 900, TRUE),
  ('espn_last5', '*', 'historical_stats', 0.85, 172800, FALSE),
  ('mlb_stats_api', 'mlb', 'historical_stats', 0.95, 172800, TRUE),
  ('sportsdataio_news', '*', 'news', 0.75, 172800, FALSE),
  ('espn_news', '*', 'news', 0.65, 172800, FALSE),
  ('reddit_sentiment', '*', 'sentiment', 0.25, 86400, FALSE)
ON CONFLICT (source, sport, data_class) DO UPDATE SET
  reliability = EXCLUDED.reliability, freshness_ttl_seconds = EXCLUDED.freshness_ttl_seconds,
  official = EXCLUDED.official, updated_at = NOW();

ALTER TABLE tenant_fantasy_ai.player_last_5_stats
  ADD COLUMN IF NOT EXISTS scoring_version TEXT DEFAULT 'dk-scoring-v1',
  ADD COLUMN IF NOT EXISTS source_provenance JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_player_game_logs(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.player_game_logs (
    canonical_player_id, sport, canonical_game_id, provider_game_id, game_date, opponent,
    home_away, raw_stats, fantasy_points, scoring_version, source, observed_at
  )
  SELECT row_data->>'player_id', LOWER(row_data->>'sport'), NULLIF(row_data->>'game_id', ''),
    NULLIF(row_data->>'provider_game_id', ''), (row_data->>'game_date')::DATE, NULLIF(row_data->>'opponent', ''),
    CASE WHEN row_data->>'home_away' IN ('home', 'away', 'unknown') THEN row_data->>'home_away' ELSE 'unknown' END,
    COALESCE(row_data->'raw_stats', '{}'::JSONB), NULLIF(row_data->>'fantasy_points', '')::FLOAT,
    COALESCE(NULLIF(row_data->>'scoring_version', ''), 'dk-scoring-v1'), COALESCE(NULLIF(row_data->>'source', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'observed_at', '')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_id', '') IS NOT NULL AND NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'game_date', '') IS NOT NULL
  ON CONFLICT (canonical_player_id, sport, game_date, source) DO UPDATE SET
    canonical_game_id = EXCLUDED.canonical_game_id, provider_game_id = EXCLUDED.provider_game_id,
    opponent = EXCLUDED.opponent, home_away = EXCLUDED.home_away, raw_stats = EXCLUDED.raw_stats,
    fantasy_points = EXCLUDED.fantasy_points, scoring_version = EXCLUDED.scoring_version,
    observed_at = EXCLUDED.observed_at;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_player_game_logs(p_player_id TEXT, p_sport TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (player_id TEXT, sport VARCHAR(10), game_id TEXT, provider_game_id TEXT, game_date DATE, opponent TEXT, home_away TEXT, raw_stats JSONB, fantasy_points FLOAT, scoring_version TEXT, source TEXT, observed_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  SELECT canonical_player_id, sport, canonical_game_id, provider_game_id, game_date, opponent, home_away, raw_stats, fantasy_points, scoring_version, source, observed_at
  FROM tenant_fantasy_ai.player_game_logs
  WHERE canonical_player_id = p_player_id AND sport = LOWER(p_sport)
  ORDER BY game_date DESC, observed_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_player_game_logs(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_player_game_logs(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_player_game_logs(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_player_game_logs(TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.pios_lineup_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_lineup_id UUID NOT NULL REFERENCES tenant_fantasy_ai.generated_lineups(id) ON DELETE CASCADE,
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  scenario_key TEXT,
  scenario_confidence FLOAT,
  relationship_score FLOAT,
  projection_reliability FLOAT,
  projected_points FLOAT NOT NULL,
  actual_points FLOAT NOT NULL,
  point_error FLOAT NOT NULL,
  outperformed_projection BOOLEAN NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generated_lineup_id)
);

CREATE INDEX IF NOT EXISTS pios_lineup_evaluations_scope_idx
  ON tenant_fantasy_ai.pios_lineup_evaluations (sport, contest_date, scenario_key);

ALTER TABLE tenant_fantasy_ai.pios_lineup_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pios_lineup_evaluations_select ON tenant_fantasy_ai.pios_lineup_evaluations;
CREATE POLICY pios_lineup_evaluations_select ON tenant_fantasy_ai.pios_lineup_evaluations FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.pios_lineup_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.pios_lineup_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_pios_lineup_evaluations(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.pios_lineup_evaluations (
    generated_lineup_id, sport, contest_date, scenario_key, scenario_confidence, relationship_score,
    projection_reliability, projected_points, actual_points, point_error, outperformed_projection
  )
  SELECT NULLIF(row_data->>'generated_lineup_id', '')::UUID, LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE,
    NULLIF(row_data->>'scenario_key', ''), NULLIF(row_data->>'scenario_confidence', '')::FLOAT,
    NULLIF(row_data->>'relationship_score', '')::FLOAT, NULLIF(row_data->>'projection_reliability', '')::FLOAT,
    (row_data->>'projected_points')::FLOAT, (row_data->>'actual_points')::FLOAT,
    (row_data->>'point_error')::FLOAT, COALESCE((row_data->>'outperformed_projection')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'generated_lineup_id', '') IS NOT NULL;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_pios_lineup_evaluations(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_pios_lineup_evaluations(JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.fantasy_ai_get_unscored_lineups(TEXT, DATE);
CREATE FUNCTION public.fantasy_ai_get_unscored_lineups(p_sport TEXT, p_before_date DATE)
RETURNS TABLE (
  id UUID, user_id UUID, sport VARCHAR(10), contest_date DATE, contest_type TEXT, contest_id TEXT,
  lineup_mode TEXT, contest_strategy TEXT, players JSONB, config JSONB, projected_points FLOAT,
  salary_used INT, optimizer_rank INT
)
LANGUAGE sql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  SELECT lineups.id, lineups.user_id, lineups.sport, lineups.contest_date, lineups.contest_type,
    lineups.contest_id, lineups.lineup_mode, lineups.contest_strategy, lineups.players, lineups.config,
    lineups.projected_points, lineups.salary_used, lineups.optimizer_rank
  FROM tenant_fantasy_ai.generated_lineups lineups
  WHERE lineups.sport = LOWER(p_sport)
    AND lineups.contest_date <= p_before_date
    AND lineups.scored_at IS NULL
  ORDER BY lineups.contest_date, lineups.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_unscored_lineups(TEXT, DATE) TO service_role;
