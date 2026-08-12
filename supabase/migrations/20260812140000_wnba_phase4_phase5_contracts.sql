-- WNBA Phases 4-5: component-distribution and joint-simulation evaluation contracts.

ALTER TABLE tenant_fantasy_ai.player_outcome_distributions
  ADD COLUMN IF NOT EXISTS component_projection JSONB,
  ADD COLUMN IF NOT EXISTS blend_version TEXT,
  ADD COLUMN IF NOT EXISTS candidate_projection FLOAT;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_simulation_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  model_version TEXT NOT NULL,
  simulation_seed BIGINT NOT NULL,
  iterations INT NOT NULL CHECK (iterations > 0),
  evaluation JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, model_version, simulation_seed)
);
CREATE INDEX IF NOT EXISTS wnba_simulation_evaluations_model_idx ON tenant_fantasy_ai.wnba_simulation_evaluations (model_version, created_at DESC);
ALTER TABLE tenant_fantasy_ai.wnba_simulation_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_simulation_evaluations_select ON tenant_fantasy_ai.wnba_simulation_evaluations;
CREATE POLICY wnba_simulation_evaluations_select ON tenant_fantasy_ai.wnba_simulation_evaluations FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_simulation_evaluations TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_simulation_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_player_outcome_distributions(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE inserted_count INTEGER := 0; row_data JSONB; key TEXT;
BEGIN
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    key := md5(concat_ws('|', lower(COALESCE(row_data->>'sport', '')), COALESCE(row_data->>'contest_date', ''), lower(COALESCE(row_data->>'contest_type', '')), COALESCE(row_data->>'contest_id', ''), COALESCE(row_data->>'game_id', ''), COALESCE(row_data->>'player_id', row_data->>'player_name', '')));
    INSERT INTO tenant_fantasy_ai.player_outcome_distributions (
      record_key, sport, contest_date, contest_type, contest_id, game_id, player_id, player_name, projection_source, sample_size,
      p10, p25, p50, p75, p90, p95, stdev_fantasy_pts, boom_probability, bust_probability, source, component_projection, blend_version, candidate_projection, source_updated_at, updated_at
    ) VALUES (
      key, lower(row_data->>'sport'), (row_data->>'contest_date')::date, lower(row_data->>'contest_type'), NULLIF(row_data->>'contest_id', ''), NULLIF(row_data->>'game_id', ''), NULLIF(row_data->>'player_id', ''), row_data->>'player_name', NULLIF(row_data->>'projection_source', ''), COALESCE((row_data->>'sample_size')::int, 0),
      (row_data->>'p10')::float, (row_data->>'p25')::float, (row_data->>'p50')::float, (row_data->>'p75')::float, (row_data->>'p90')::float, (row_data->>'p95')::float, (row_data->>'stdev_fantasy_pts')::float, (row_data->>'boom_probability')::float, (row_data->>'bust_probability')::float, COALESCE(NULLIF(row_data->>'source', ''), 'derived'), row_data->'component_projection', NULLIF(row_data->>'blend_version', ''), NULLIF(row_data->>'candidate_fantasy_projection', '')::float, COALESCE((row_data->>'source_updated_at')::timestamp, NOW()), NOW()
    ) ON CONFLICT (record_key) DO UPDATE SET
      projection_source = EXCLUDED.projection_source, sample_size = EXCLUDED.sample_size, p10 = EXCLUDED.p10, p25 = EXCLUDED.p25, p50 = EXCLUDED.p50, p75 = EXCLUDED.p75, p90 = EXCLUDED.p90, p95 = EXCLUDED.p95, stdev_fantasy_pts = EXCLUDED.stdev_fantasy_pts, boom_probability = EXCLUDED.boom_probability, bust_probability = EXCLUDED.bust_probability, source = EXCLUDED.source, component_projection = EXCLUDED.component_projection, blend_version = EXCLUDED.blend_version, candidate_projection = EXCLUDED.candidate_projection, source_updated_at = EXCLUDED.source_updated_at, updated_at = NOW();
    inserted_count := inserted_count + 1;
  END LOOP;
  RETURN inserted_count;
END; $$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_wnba_component_calibration_report(p_min_sample INT DEFAULT 30)
RETURNS TABLE (bucket TEXT, sample_size BIGINT, baseline_mae FLOAT, candidate_mae FLOAT, baseline_bias FLOAT, candidate_bias FLOAT, candidate_improves BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH rows AS (
    SELECT distributions.*, results.actual_points, snapshots.manifest_data
    FROM tenant_fantasy_ai.player_outcome_distributions distributions
    JOIN tenant_fantasy_ai.projection_results results ON results.sport = 'wnba' AND results.contest_date = distributions.contest_date
      AND regexp_replace(lower(results.player_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(distributions.player_name), '[^a-z0-9]', '', 'g')
    LEFT JOIN tenant_fantasy_ai.mios_scan_snapshots snapshots ON snapshots.sport = 'wnba' AND snapshots.contest_date = distributions.contest_date
    WHERE distributions.sport = 'wnba' AND distributions.candidate_projection IS NOT NULL AND results.actual_points IS NOT NULL
  ), bucketed AS (
    SELECT 'overall'::TEXT AS bucket, * FROM rows
    UNION ALL SELECT 'distribution_source:' || source, * FROM rows
  )
  SELECT bucket, COUNT(*), AVG(ABS(actual_points - p50))::FLOAT, AVG(ABS(actual_points - candidate_projection))::FLOAT,
    AVG(actual_points - p50)::FLOAT, AVG(actual_points - candidate_projection)::FLOAT,
    COUNT(*) >= GREATEST(30, COALESCE(p_min_sample, 30)) AND AVG(ABS(actual_points - candidate_projection)) < AVG(ABS(actual_points - p50))
  FROM bucketed GROUP BY bucket;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_wnba_component_calibration_report(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_wnba_component_calibration_report(INT) TO authenticated, service_role;
