-- MIOS trust contract: immutable scan snapshots, structured provenance,
-- readiness gates, and evaluation records.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.mios_scan_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_manifest(id) ON DELETE CASCADE,
  sport VARCHAR(10) NOT NULL,
  contest_type VARCHAR(20) NOT NULL,
  contest_date DATE NOT NULL,
  contest_id TEXT,
  game_id TEXT,
  model_version TEXT NOT NULL DEFAULT 'mios-v1',
  readiness_status TEXT NOT NULL CHECK (readiness_status IN ('ready', 'caution', 'blocked')),
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  collected_at TIMESTAMPTZ NOT NULL,
  source_health JSONB NOT NULL DEFAULT '{}'::JSONB,
  projection_recipe JSONB NOT NULL DEFAULT '{}'::JSONB,
  manifest_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mios_scan_snapshots_manifest_idx
  ON tenant_fantasy_ai.mios_scan_snapshots (manifest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mios_scan_snapshots_scope_idx
  ON tenant_fantasy_ai.mios_scan_snapshots (sport, contest_date, contest_type, contest_id);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.mios_player_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value JSONB,
  source TEXT NOT NULL,
  stage TEXT NOT NULL,
  observed_at TIMESTAMPTZ,
  freshness_seconds INTEGER,
  is_modeled BOOLEAN NOT NULL DEFAULT FALSE,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  model_version TEXT NOT NULL DEFAULT 'mios-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mios_player_provenance_snapshot_idx
  ON tenant_fantasy_ai.mios_player_provenance (snapshot_id, player_id);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.mios_scan_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE CASCADE,
  scorecard JSONB NOT NULL,
  player_sample_size INTEGER NOT NULL DEFAULT 0,
  lineup_sample_size INTEGER NOT NULL DEFAULT 0,
  evaluation_source TEXT NOT NULL DEFAULT 'automatic_actuals',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, evaluation_source)
);

ALTER TABLE tenant_fantasy_ai.mios_scan_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.mios_player_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.mios_scan_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mios_scan_snapshots_select ON tenant_fantasy_ai.mios_scan_snapshots;
CREATE POLICY mios_scan_snapshots_select
  ON tenant_fantasy_ai.mios_scan_snapshots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_fantasy_ai.mios_manifest manifest
    WHERE manifest.id = mios_scan_snapshots.manifest_id
      AND auth.uid() = manifest.user_id
  ));

DROP POLICY IF EXISTS mios_player_provenance_select ON tenant_fantasy_ai.mios_player_provenance;
CREATE POLICY mios_player_provenance_select
  ON tenant_fantasy_ai.mios_player_provenance FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM tenant_fantasy_ai.mios_scan_snapshots snapshot
    JOIN tenant_fantasy_ai.mios_manifest manifest ON manifest.id = snapshot.manifest_id
    WHERE snapshot.id = mios_player_provenance.snapshot_id
      AND auth.uid() = manifest.user_id
  ));

DROP POLICY IF EXISTS mios_scan_evaluations_select ON tenant_fantasy_ai.mios_scan_evaluations;
CREATE POLICY mios_scan_evaluations_select
  ON tenant_fantasy_ai.mios_scan_evaluations FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM tenant_fantasy_ai.mios_scan_snapshots snapshot
    JOIN tenant_fantasy_ai.mios_manifest manifest ON manifest.id = snapshot.manifest_id
    WHERE snapshot.id = mios_scan_evaluations.snapshot_id
      AND auth.uid() = manifest.user_id
  ));

GRANT SELECT ON tenant_fantasy_ai.mios_scan_snapshots TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.mios_player_provenance TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.mios_scan_evaluations TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.mios_scan_snapshots TO service_role;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.mios_player_provenance TO service_role;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.mios_scan_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_mios_scan_snapshot(
  p_manifest_id UUID,
  p_sport TEXT,
  p_contest_type TEXT,
  p_contest_date DATE,
  p_contest_id TEXT,
  p_game_id TEXT,
  p_model_version TEXT,
  p_readiness_status TEXT,
  p_is_fallback BOOLEAN,
  p_fallback_reason TEXT,
  p_collected_at TIMESTAMPTZ,
  p_source_health JSONB,
  p_projection_recipe JSONB,
  p_manifest_data JSONB,
  p_provenance JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  snapshot_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.mios_scan_snapshots (
    manifest_id, sport, contest_type, contest_date, contest_id, game_id,
    model_version, readiness_status, is_fallback, fallback_reason,
    collected_at, source_health, projection_recipe, manifest_data
  ) VALUES (
    p_manifest_id, LOWER(p_sport), LOWER(p_contest_type), p_contest_date,
    NULLIF(p_contest_id, ''), NULLIF(p_game_id, ''),
    COALESCE(NULLIF(p_model_version, ''), 'mios-v1'),
    CASE WHEN p_readiness_status IN ('ready', 'caution', 'blocked') THEN p_readiness_status ELSE 'caution' END,
    COALESCE(p_is_fallback, FALSE), p_fallback_reason, COALESCE(p_collected_at, NOW()),
    COALESCE(p_source_health, '{}'::JSONB), COALESCE(p_projection_recipe, '{}'::JSONB),
    COALESCE(p_manifest_data, '{}'::JSONB)
  ) RETURNING id INTO snapshot_id;

  INSERT INTO tenant_fantasy_ai.mios_player_provenance (
    snapshot_id, player_id, player_name, field_name, field_value, source, stage,
    observed_at, freshness_seconds, is_modeled, is_fallback, model_version
  )
  SELECT
    snapshot_id,
    COALESCE(row_data->>'player_id', ''),
    COALESCE(row_data->>'player_name', ''),
    COALESCE(row_data->>'field_name', ''),
    row_data->'field_value',
    COALESCE(NULLIF(row_data->>'source', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'stage', ''), 'scan'),
    NULLIF(row_data->>'observed_at', '')::TIMESTAMPTZ,
    NULLIF(row_data->>'freshness_seconds', '')::INTEGER,
    COALESCE((row_data->>'is_modeled')::BOOLEAN, FALSE),
    COALESCE((row_data->>'is_fallback')::BOOLEAN, FALSE),
    COALESCE(NULLIF(row_data->>'model_version', ''), 'mios-v1')
  FROM jsonb_array_elements(COALESCE(p_provenance, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_id', '') IS NOT NULL
    AND NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'field_name', '') IS NOT NULL;

  RETURN snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_mios_scan_evaluation(
  p_snapshot_id UUID,
  p_scorecard JSONB,
  p_player_sample_size INTEGER,
  p_lineup_sample_size INTEGER,
  p_evaluation_source TEXT DEFAULT 'automatic_actuals'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  evaluation_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.mios_scan_evaluations (
    snapshot_id, scorecard, player_sample_size, lineup_sample_size, evaluation_source
  ) VALUES (
    p_snapshot_id, COALESCE(p_scorecard, '{}'::JSONB), COALESCE(p_player_sample_size, 0),
    COALESCE(p_lineup_sample_size, 0), COALESCE(NULLIF(p_evaluation_source, ''), 'automatic_actuals')
  )
  ON CONFLICT (snapshot_id, evaluation_source) DO UPDATE SET
    scorecard = EXCLUDED.scorecard,
    player_sample_size = EXCLUDED.player_sample_size,
    lineup_sample_size = EXCLUDED.lineup_sample_size,
    evaluated_at = NOW()
  RETURNING id INTO evaluation_id;
  RETURN evaluation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_insert_mios_scan_snapshot(UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_mios_scan_evaluation(UUID, JSONB, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_mios_scan_snapshot(UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_mios_scan_evaluation(UUID, JSONB, INTEGER, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_evaluate_mios_snapshots(
  p_sport TEXT,
  p_contest_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  evaluated_count INTEGER;
BEGIN
  WITH player_rows AS (
    SELECT
      snapshots.id AS snapshot_id,
      snapshots.contest_id,
      snapshots.contest_type,
      player_row->>'player_name' AS player_name,
      NULLIF(player_row->>'projected_points', '')::FLOAT AS projected_points
    FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshots.manifest_data->'player_roster', '[]'::JSONB)) player_row
    WHERE snapshots.sport = LOWER(p_sport)
      AND snapshots.contest_date = p_contest_date
  ), matched AS (
    SELECT
      rows.snapshot_id,
      rows.projected_points,
      results.actual_points
    FROM player_rows rows
    JOIN tenant_fantasy_ai.projection_results results
      ON results.sport = LOWER(p_sport)
      AND results.contest_date = p_contest_date
      AND LOWER(results.contest_type) = LOWER(rows.contest_type)
      AND regexp_replace(LOWER(results.player_name), '[^a-z0-9]', '', 'g') = regexp_replace(LOWER(rows.player_name), '[^a-z0-9]', '', 'g')
      AND (rows.contest_id IS NULL OR results.contest_id IS NULL OR results.contest_id::TEXT = rows.contest_id)
    WHERE rows.projected_points IS NOT NULL
      AND results.actual_points IS NOT NULL
  ), ranked AS (
    SELECT
      matched.*,
      RANK() OVER (PARTITION BY matched.snapshot_id ORDER BY matched.actual_points) AS actual_rank,
      RANK() OVER (PARTITION BY matched.snapshot_id ORDER BY matched.projected_points) AS projected_rank
    FROM matched
  ), scorecards AS (
    SELECT
      snapshot_id,
      COUNT(*)::INTEGER AS player_sample_size,
      jsonb_build_object(
        'player_sample_size', COUNT(*),
        'mean_absolute_error', AVG(ABS(actual_points - projected_points)),
        'mean_error', AVG(actual_points - projected_points),
        'spearman_rank_correlation', corr(actual_rank, projected_rank),
        'lineup_sample_size', (
          SELECT COUNT(*)
          FROM tenant_fantasy_ai.generated_lineups lineups
          WHERE COALESCE(lineups.config->>'manifestId', '') = ranked.snapshot_id::TEXT
            AND lineups.actual_points IS NOT NULL
        ),
        'lineup_mean_absolute_error', (
          SELECT AVG(ABS(lineups.actual_points - lineups.projected_points))
          FROM tenant_fantasy_ai.generated_lineups lineups
          WHERE COALESCE(lineups.config->>'manifestId', '') = ranked.snapshot_id::TEXT
            AND lineups.actual_points IS NOT NULL
        ),
        'lineup_roi', (
          SELECT CASE WHEN SUM(COALESCE(lineups.entry_fee, 0)) > 0
            THEN (SUM(COALESCE(lineups.payout, 0)) - SUM(COALESCE(lineups.entry_fee, 0))) / SUM(COALESCE(lineups.entry_fee, 0))
            ELSE NULL END
          FROM tenant_fantasy_ai.generated_lineups lineups
          WHERE COALESCE(lineups.config->>'manifestId', '') = ranked.snapshot_id::TEXT
            AND lineups.actual_points IS NOT NULL
        ),
        'lineup_hit_rate', (
          SELECT AVG(CASE WHEN COALESCE(lineups.payout, 0) > 0 THEN 1.0 ELSE 0.0 END)
          FROM tenant_fantasy_ai.generated_lineups lineups
          WHERE COALESCE(lineups.config->>'manifestId', '') = ranked.snapshot_id::TEXT
            AND lineups.actual_points IS NOT NULL
        ),
        'evaluated_at', NOW()
      ) AS scorecard
    FROM ranked
    GROUP BY snapshot_id
  )
  INSERT INTO tenant_fantasy_ai.mios_scan_evaluations (
    snapshot_id, scorecard, player_sample_size, lineup_sample_size, evaluation_source
  )
  SELECT snapshot_id, scorecard, player_sample_size, COALESCE((scorecard->>'lineup_sample_size')::INTEGER, 0), 'automatic_actuals'
  FROM scorecards
  ON CONFLICT (snapshot_id, evaluation_source) DO UPDATE SET
    scorecard = EXCLUDED.scorecard,
    player_sample_size = EXCLUDED.player_sample_size,
    evaluated_at = NOW();

  GET DIAGNOSTICS evaluated_count = ROW_COUNT;
  RETURN evaluated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_evaluate_mios_snapshots(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_evaluate_mios_snapshots(TEXT, DATE) TO service_role;
