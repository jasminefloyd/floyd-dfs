-- WNBA Phase 1: bind generated lineups to immutable MIOS evidence and retain
-- a settled-contest forensic record. Existing historical rows remain valid;
-- new rows receive the additional identifiers when the caller supplies them.

ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS scan_snapshot_id UUID NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS generation_request_id UUID NULL,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS result_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (result_status IN ('pending', 'partial', 'complete', 'unresolved')),
  ADD COLUMN IF NOT EXISTS result_recorded_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS generated_lineups_snapshot_idx
  ON tenant_fantasy_ai.generated_lineups (scan_snapshot_id);
CREATE INDEX IF NOT EXISTS generated_lineups_result_status_idx
  ON tenant_fantasy_ai.generated_lineups (sport, contest_date, result_status);

-- Snapshots and their field-level provenance are evidence, not mutable cache
-- records. Evaluation rows remain mutable because final results arrive later.
CREATE OR REPLACE FUNCTION tenant_fantasy_ai.prevent_mios_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MIOS snapshots and provenance are immutable; create a new snapshot version instead';
END;
$$;

DROP TRIGGER IF EXISTS mios_scan_snapshots_immutable ON tenant_fantasy_ai.mios_scan_snapshots;
CREATE TRIGGER mios_scan_snapshots_immutable
  BEFORE UPDATE OR DELETE ON tenant_fantasy_ai.mios_scan_snapshots
  FOR EACH ROW EXECUTE FUNCTION tenant_fantasy_ai.prevent_mios_snapshot_mutation();

DROP TRIGGER IF EXISTS mios_player_provenance_immutable ON tenant_fantasy_ai.mios_player_provenance;
CREATE TRIGGER mios_player_provenance_immutable
  BEFORE UPDATE OR DELETE ON tenant_fantasy_ai.mios_player_provenance
  FOR EACH ROW EXECUTE FUNCTION tenant_fantasy_ai.prevent_mios_snapshot_mutation();

REVOKE UPDATE, DELETE ON tenant_fantasy_ai.mios_scan_snapshots FROM service_role;
REVOKE UPDATE, DELETE ON tenant_fantasy_ai.mios_player_provenance FROM service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_generated_lineups(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.generated_lineups (
    user_id, sport, contest_date, contest_type, contest_id, lineup_mode,
    contest_strategy, field_size, entry_fee, max_entries_per_user, entry_count,
    expected_duplicates, weights_version, payout_shape, ownership_weight, config,
    players, projected_points, salary_used, optimizer_rank, scan_snapshot_id,
    generation_request_id, generated_at
  )
  SELECT
    CASE WHEN NULLIF(row_data->>'user_id', '') IS NOT NULL THEN (row_data->>'user_id')::UUID ELSE NULL END,
    LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE,
    LOWER(row_data->>'contest_type'), NULLIF(row_data->>'contest_id', ''),
    COALESCE(NULLIF(row_data->>'lineup_mode', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'contest_strategy', ''), 'unknown'),
    NULLIF(row_data->>'field_size', '')::INT, NULLIF(row_data->>'entry_fee', '')::NUMERIC,
    NULLIF(row_data->>'max_entries_per_user', '')::INT, NULLIF(row_data->>'entry_count', '')::INT,
    NULLIF(row_data->>'expected_duplicates', '')::FLOAT, NULLIF(row_data->>'weights_version', ''),
    NULLIF(row_data->>'payout_shape', ''), NULLIF(row_data->>'ownership_weight', '')::FLOAT,
    row_data->'config', COALESCE(row_data->'players', '[]'::JSONB),
    COALESCE(NULLIF(row_data->>'projected_points', '')::FLOAT, 0),
    COALESCE(NULLIF(row_data->>'salary_used', '')::INT, 0),
    COALESCE(NULLIF(row_data->>'optimizer_rank', '')::INT, 0),
    NULLIF(row_data->>'scan_snapshot_id', '')::UUID,
    NULLIF(row_data->>'generation_request_id', '')::UUID,
    COALESCE(NULLIF(row_data->>'generated_at', '')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND jsonb_typeof(COALESCE(row_data->'players', '[]'::JSONB)) = 'array';
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_score_generated_lineup(
  p_id UUID, p_actual FLOAT, p_optimal FLOAT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  UPDATE tenant_fantasy_ai.generated_lineups
  SET actual_points = p_actual,
      optimal_points = p_optimal,
      pct_of_optimal = CASE WHEN p_optimal > 0 THEN p_actual / p_optimal ELSE NULL END,
      result_status = CASE WHEN p_actual IS NULL THEN 'partial' ELSE 'complete' END,
      result_recorded_at = NOW(),
      scored_at = NOW()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_mark_generated_lineup_result_partial(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  UPDATE tenant_fantasy_ai.generated_lineups
  SET result_status = 'partial', result_recorded_at = NOW()
  WHERE id = p_id AND scored_at IS NULL;
$$;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_forensic_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT NULL,
  scorecard JSONB NOT NULL DEFAULT '{}'::JSONB,
  lineups JSONB NOT NULL DEFAULT '[]'::JSONB,
  coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (contest_date, contest_type, contest_id)
);

ALTER TABLE tenant_fantasy_ai.wnba_forensic_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_forensic_reports_select ON tenant_fantasy_ai.wnba_forensic_reports;
CREATE POLICY wnba_forensic_reports_select ON tenant_fantasy_ai.wnba_forensic_reports
  FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());
GRANT SELECT ON tenant_fantasy_ai.wnba_forensic_reports TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_forensic_reports TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_wnba_forensic_report(p_report JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE report_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.wnba_forensic_reports (
    user_id, contest_date, contest_type, contest_id, scorecard, lineups, coverage, updated_at
  ) VALUES (
    NULLIF(p_report->>'user_id', '')::UUID, (p_report->>'contest_date')::DATE,
    LOWER(p_report->>'contest_type'), NULLIF(p_report->>'contest_id', ''),
    COALESCE(p_report->'scorecard', '{}'::JSONB), COALESCE(p_report->'lineups', '[]'::JSONB),
    COALESCE(p_report->'coverage', '{}'::JSONB), NOW()
  ) ON CONFLICT (contest_date, contest_type, contest_id) DO UPDATE SET
    scorecard = EXCLUDED.scorecard, lineups = EXCLUDED.lineups,
    coverage = EXCLUDED.coverage, updated_at = NOW()
  RETURNING id INTO report_id;
  RETURN report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_forensic_report(
  p_contest_date DATE DEFAULT NULL, p_contest_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, contest_date DATE, contest_type TEXT, contest_id TEXT,
  scorecard JSONB, lineups JSONB, coverage JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT reports.id, reports.contest_date, reports.contest_type, reports.contest_id,
    reports.scorecard, reports.lineups, reports.coverage, reports.created_at, reports.updated_at
  FROM tenant_fantasy_ai.wnba_forensic_reports reports
  WHERE (reports.user_id IS NULL OR reports.user_id = auth.uid())
    AND (p_contest_date IS NULL OR reports.contest_date = p_contest_date)
    AND (p_contest_id IS NULL OR reports.contest_id = p_contest_id)
  ORDER BY reports.contest_date DESC, reports.updated_at DESC;
$$;

-- Snapshots are keyed by their immutable snapshot ID. The manifest fallback
-- preserves evaluation of historical lineups written before this migration.
CREATE OR REPLACE FUNCTION public.fantasy_ai_evaluate_mios_snapshots(p_sport TEXT, p_contest_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE evaluated_count INTEGER;
BEGIN
  WITH player_rows AS (
    SELECT snapshots.id AS snapshot_id, snapshots.manifest_id, snapshots.contest_id,
      snapshots.contest_type, player_row->>'player_name' AS player_name,
      NULLIF(player_row->>'projected_points', '')::FLOAT AS projected_points
    FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshots.manifest_data->'player_roster', '[]'::JSONB)) player_row
    WHERE snapshots.sport = LOWER(p_sport) AND snapshots.contest_date = p_contest_date
  ), matched AS (
    SELECT rows.snapshot_id, rows.manifest_id, rows.projected_points, results.actual_points
    FROM player_rows rows JOIN tenant_fantasy_ai.projection_results results
      ON results.sport = LOWER(p_sport) AND results.contest_date = p_contest_date
      AND LOWER(results.contest_type) = LOWER(rows.contest_type)
      AND regexp_replace(LOWER(results.player_name), '[^a-z0-9]', '', 'g') = regexp_replace(LOWER(rows.player_name), '[^a-z0-9]', '', 'g')
      AND (rows.contest_id IS NULL OR results.contest_id IS NULL OR results.contest_id::TEXT = rows.contest_id)
    WHERE rows.projected_points IS NOT NULL AND results.actual_points IS NOT NULL
  ), ranked AS (
    SELECT matched.*, RANK() OVER (PARTITION BY snapshot_id ORDER BY actual_points) AS actual_rank,
      RANK() OVER (PARTITION BY snapshot_id ORDER BY projected_points) AS projected_rank FROM matched
  ), scorecards AS (
    SELECT snapshot_id, COUNT(*)::INTEGER AS player_sample_size,
      jsonb_build_object('player_sample_size', COUNT(*),
        'mean_absolute_error', AVG(ABS(actual_points - projected_points)),
        'mean_error', AVG(actual_points - projected_points),
        'spearman_rank_correlation', corr(actual_rank, projected_rank),
        'lineup_sample_size', (SELECT COUNT(*) FROM tenant_fantasy_ai.generated_lineups lineups
          WHERE lineups.scan_snapshot_id = ranked.snapshot_id AND lineups.actual_points IS NOT NULL)) AS scorecard
    FROM ranked GROUP BY snapshot_id
  ), written AS (
    INSERT INTO tenant_fantasy_ai.mios_scan_evaluations (snapshot_id, scorecard, player_sample_size, lineup_sample_size, evaluation_source)
    SELECT snapshot_id, scorecard, player_sample_size,
      COALESCE((scorecard->>'lineup_sample_size')::INTEGER, 0), 'automatic_actuals'
    FROM scorecards
    ON CONFLICT (snapshot_id, evaluation_source) DO UPDATE SET scorecard = EXCLUDED.scorecard,
      player_sample_size = EXCLUDED.player_sample_size, lineup_sample_size = EXCLUDED.lineup_sample_size,
      evaluated_at = NOW()
    RETURNING 1
  ) SELECT COUNT(*) INTO evaluated_count FROM written;
  RETURN COALESCE(evaluated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_insert_generated_lineups(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_score_generated_lineup(UUID, FLOAT, FLOAT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_mark_generated_lineup_result_partial(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_wnba_forensic_report(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_forensic_report(DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_evaluate_mios_snapshots(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_generated_lineups(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_score_generated_lineup(UUID, FLOAT, FLOAT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_mark_generated_lineup_result_partial(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_wnba_forensic_report(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_forensic_report(DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_evaluate_mios_snapshots(TEXT, DATE) TO service_role;
