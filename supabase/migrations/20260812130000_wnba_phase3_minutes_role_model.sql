-- WNBA Phase 3: immutable, settled role observations and safe role priors.

ALTER TABLE tenant_fantasy_ai.projection_results
  ADD COLUMN IF NOT EXISTS actual_minutes FLOAT;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_player_game_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT,
  actual_minutes FLOAT NOT NULL CHECK (actual_minutes >= 0 AND actual_minutes <= 50),
  projected_minutes FLOAT,
  confirmed_starter BOOLEAN,
  injury_status TEXT,
  depth_chart_order INTEGER,
  rest_days INTEGER,
  spread FLOAT,
  active_teammates JSONB NOT NULL DEFAULT '[]'::JSONB,
  inactive_teammates JSONB NOT NULL DEFAULT '[]'::JSONB,
  role_counterfactual JSONB NOT NULL DEFAULT '[]'::JSONB,
  source TEXT NOT NULL DEFAULT 'immutable_mios_snapshot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, player_name)
);

CREATE INDEX IF NOT EXISTS wnba_player_game_features_player_idx
  ON tenant_fantasy_ai.wnba_player_game_features (player_id, contest_date DESC);
CREATE INDEX IF NOT EXISTS wnba_player_game_features_team_idx
  ON tenant_fantasy_ai.wnba_player_game_features (team, contest_date DESC);

ALTER TABLE tenant_fantasy_ai.wnba_player_game_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_player_game_features_select ON tenant_fantasy_ai.wnba_player_game_features;
CREATE POLICY wnba_player_game_features_select ON tenant_fantasy_ai.wnba_player_game_features FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_player_game_features TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_player_game_features TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results_v2(p_rows JSONB)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.projection_results (
    sport, contest_date, contest_type, contest_id, player_id, player_name, team, position,
    projected_points, actual_points, actual_minutes, source, projection_source, updated_at
  )
  SELECT LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE, LOWER(row_data->>'contest_type'),
    NULLIF(row_data->>'contest_id', ''), NULLIF(row_data->>'player_id', ''), row_data->>'player_name',
    NULLIF(row_data->>'team', ''), NULLIF(row_data->>'position', ''),
    NULLIF(row_data->>'projected_points', '')::FLOAT, NULLIF(row_data->>'actual_points', '')::FLOAT,
    NULLIF(row_data->>'actual_minutes', '')::FLOAT, COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore'),
    COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown'), NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL AND NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
  ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name) DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
    team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
    position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
    projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
    actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
    actual_minutes = COALESCE(EXCLUDED.actual_minutes, tenant_fantasy_ai.projection_results.actual_minutes),
    source = EXCLUDED.source, projection_source = EXCLUDED.projection_source, updated_at = NOW();
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_materialize_wnba_features(p_contest_date DATE)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE written INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.wnba_player_game_features (
    snapshot_id, contest_date, contest_type, contest_id, player_id, player_name, team, position,
    actual_minutes, projected_minutes, confirmed_starter, injury_status, depth_chart_order, rest_days, spread,
    active_teammates, inactive_teammates, role_counterfactual
  )
  SELECT snapshots.id, snapshots.contest_date, snapshots.contest_type, snapshots.contest_id,
    player->>'id', player->>'name', player->>'team', player->>'position', results.actual_minutes,
    NULLIF(player->>'minutes_projection', '')::FLOAT, NULLIF(player->>'confirmed_starter', '')::BOOLEAN,
    player->>'injury_status', NULLIF(player->>'depth_chart_order', '')::INTEGER,
    NULLIF(player->>'rest_days', '')::INTEGER, NULLIF(player->>'spread', '')::FLOAT,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', mate->>'name', 'status', mate->>'injury_status'))
      FROM jsonb_array_elements(snapshots.manifest_data->'player_roster') mate
      WHERE mate->>'team' = player->>'team' AND COALESCE(mate->>'injury_status', 'active') NOT IN ('out', 'doubtful')), '[]'::JSONB),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', mate->>'name', 'status', mate->>'injury_status'))
      FROM jsonb_array_elements(snapshots.manifest_data->'player_roster') mate
      WHERE mate->>'team' = player->>'team' AND COALESCE(mate->>'injury_status', 'active') IN ('out', 'doubtful')), '[]'::JSONB),
    COALESCE(player->'role_counterfactual', '[]'::JSONB)
  FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshots.manifest_data->'player_roster', '[]'::JSONB)) player
  JOIN tenant_fantasy_ai.projection_results results ON results.sport = 'wnba'
    AND results.contest_date = snapshots.contest_date AND LOWER(results.contest_type) = LOWER(snapshots.contest_type)
    AND regexp_replace(LOWER(results.player_name), '[^a-z0-9]', '', 'g') = regexp_replace(LOWER(player->>'name'), '[^a-z0-9]', '', 'g')
    AND results.actual_minutes IS NOT NULL
  WHERE snapshots.sport = 'wnba' AND snapshots.contest_date = p_contest_date
  ON CONFLICT (snapshot_id, player_name) DO UPDATE SET actual_minutes = EXCLUDED.actual_minutes;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_role_priors(p_player_ids JSONB)
RETURNS TABLE (player_id TEXT, sample_size INT, historical_minutes FLOAT, historical_minutes_stddev FLOAT, replacement_minutes_gain FLOAT, did_not_play_probability FLOAT, cohort TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH requested AS (SELECT DISTINCT jsonb_array_elements_text(COALESCE(p_player_ids, '[]'::JSONB)) AS player_id),
  base AS (
    SELECT features.* FROM tenant_fantasy_ai.wnba_player_game_features features
    JOIN requested ON requested.player_id = features.player_id
    WHERE features.contest_date >= CURRENT_DATE - 730
  )
  SELECT player_id, COUNT(*)::INT, AVG(actual_minutes)::FLOAT,
    STDDEV_POP(actual_minutes)::FLOAT,
    AVG(actual_minutes - projected_minutes) FILTER (WHERE jsonb_array_length(inactive_teammates) > 0 AND projected_minutes IS NOT NULL)::FLOAT,
    AVG((actual_minutes = 0)::INT)::FLOAT,
    CASE WHEN BOOL_OR(injury_status IN ('questionable', 'day_to_day')) THEN 'returning'
      WHEN BOOL_OR(confirmed_starter) AND AVG(actual_minutes) >= 24 THEN 'starter'
      WHEN AVG(actual_minutes) >= 18 AND COALESCE(STDDEV_POP(actual_minutes), 0) < 5 THEN 'stable_bench'
      WHEN AVG(actual_minutes) >= 16 THEN 'volatile_bench' ELSE 'elevated' END
  FROM base GROUP BY player_id;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_wnba_minutes_calibration_report(p_min_sample INT DEFAULT 30)
RETURNS TABLE (
  cohort TEXT,
  sample_size BIGINT,
  minutes_mae FLOAT,
  signed_bias FLOAT,
  p10_coverage FLOAT,
  p90_coverage FLOAT,
  dnp_actual_rate FLOAT,
  dnp_predicted_rate FLOAT,
  eligible_for_promotion BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH rows AS (
    SELECT features.*, snapshot_player->'minutes_distribution' AS distribution
    FROM tenant_fantasy_ai.wnba_player_game_features features
    JOIN tenant_fantasy_ai.mios_scan_snapshots snapshots ON snapshots.id = features.snapshot_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshots.manifest_data->'player_roster', '[]'::JSONB)) snapshot_player
    WHERE regexp_replace(LOWER(snapshot_player->>'name'), '[^a-z0-9]', '', 'g') = regexp_replace(LOWER(features.player_name), '[^a-z0-9]', '', 'g')
      AND features.projected_minutes IS NOT NULL
  ), bucketed AS (
    SELECT *, CASE WHEN confirmed_starter THEN 'starter'
      WHEN injury_status IN ('questionable', 'day_to_day') THEN 'returning'
      WHEN depth_chart_order >= 4 THEN 'volatile_bench' ELSE 'stable_bench' END AS cohort
    FROM rows
  )
  SELECT cohort, COUNT(*), AVG(ABS(actual_minutes - projected_minutes))::FLOAT,
    AVG(actual_minutes - projected_minutes)::FLOAT,
    AVG((actual_minutes >= NULLIF(distribution->>'p10', '')::FLOAT)::INT)::FLOAT,
    AVG((actual_minutes <= NULLIF(distribution->>'p90', '')::FLOAT)::INT)::FLOAT,
    AVG((actual_minutes = 0)::INT)::FLOAT,
    AVG(NULLIF(distribution->>'didNotPlayProbability', '')::FLOAT)::FLOAT,
    COUNT(*) >= GREATEST(COALESCE(p_min_sample, 30), 30)
  FROM bucketed GROUP BY cohort;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_materialize_wnba_features(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_role_priors(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_wnba_minutes_calibration_report(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_materialize_wnba_features(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_role_priors(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_wnba_minutes_calibration_report(INT) TO authenticated, service_role;
