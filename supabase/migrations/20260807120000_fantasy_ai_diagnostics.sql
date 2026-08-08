-- Read-only diagnostics for scan replay and projection-result ingestion quality.

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_latest_mios_scan_artifact(
  p_sport TEXT DEFAULT NULL,
  p_contest_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH candidate AS (
    SELECT snapshots.*
    FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
    JOIN tenant_fantasy_ai.mios_manifest manifests
      ON manifests.id = snapshots.manifest_id
    WHERE manifests.user_id = auth.uid()
      AND (NULLIF(p_sport, '') IS NULL OR snapshots.sport = LOWER(p_sport))
      AND (p_contest_date IS NULL OR snapshots.contest_date = p_contest_date)
    ORDER BY snapshots.created_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'snapshot', to_jsonb(candidate),
    'evaluation', (
      SELECT to_jsonb(evaluations)
      FROM tenant_fantasy_ai.mios_scan_evaluations evaluations
      WHERE evaluations.snapshot_id = candidate.id
      ORDER BY evaluations.evaluated_at DESC
      LIMIT 1
    ),
    'provenance', COALESCE((
      SELECT jsonb_agg(to_jsonb(provenance) ORDER BY provenance.created_at)
      FROM tenant_fantasy_ai.mios_player_provenance provenance
      WHERE provenance.snapshot_id = candidate.id
    ), '[]'::JSONB)
  )
  FROM candidate;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_latest_mios_scan_artifact(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_latest_mios_scan_artifact(TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_latest_mios_scan_artifact(TEXT, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_projection_ingestion_audit(
  p_sport TEXT DEFAULT 'wnba',
  p_days INT DEFAULT 45
)
RETURNS TABLE (
  sport TEXT,
  row_count BIGINT,
  projected_actual_row_count BIGINT,
  known_position_count BIGINT,
  unknown_position_count BIGINT,
  known_salary_count BIGINT,
  unknown_salary_count BIGINT,
  known_projection_source_count BIGINT,
  unknown_projection_source_count BIGINT,
  fully_typed_row_count BIGINT,
  first_contest_date DATE,
  last_contest_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH rows AS (
    SELECT
      results.sport::TEXT AS sport,
      results.contest_date,
      NULLIF(BTRIM(COALESCE(results.position, salaries.position, '')), '') AS effective_position,
      CASE WHEN COALESCE(salaries.salary, 0) > 0 THEN salaries.salary ELSE NULL END AS effective_salary,
      NULLIF(BTRIM(COALESCE(results.projection_source, '')), '') AS effective_projection_source,
      results.projected_points,
      results.actual_points
    FROM tenant_fantasy_ai.projection_results results
    LEFT JOIN LATERAL (
      SELECT salary_row.position, salary_row.salary
      FROM tenant_fantasy_ai.draftkings_player_salaries salary_row
      WHERE salary_row.sport = results.sport
        AND salary_row.contest_date = results.contest_date
        AND salary_row.player_name = results.player_name
        AND (
          results.contest_id IS NULL
          OR salary_row.contest_id::TEXT = results.contest_id::TEXT
          OR salary_row.contest_id IS NULL
        )
      ORDER BY CASE WHEN salary_row.contest_id::TEXT = results.contest_id::TEXT THEN 0 ELSE 1 END
      LIMIT 1
    ) salaries ON TRUE
    WHERE results.sport = LOWER(COALESCE(NULLIF(p_sport, ''), 'wnba'))
      AND results.contest_date >= CURRENT_DATE - COALESCE(p_days, 45)
  )
  SELECT
    rows.sport,
    COUNT(*) AS row_count,
    COUNT(*) FILTER (WHERE rows.projected_points IS NOT NULL AND rows.actual_points IS NOT NULL) AS projected_actual_row_count,
    COUNT(*) FILTER (WHERE rows.effective_position IS NOT NULL) AS known_position_count,
    COUNT(*) FILTER (WHERE rows.effective_position IS NULL) AS unknown_position_count,
    COUNT(*) FILTER (WHERE rows.effective_salary IS NOT NULL) AS known_salary_count,
    COUNT(*) FILTER (WHERE rows.effective_salary IS NULL) AS unknown_salary_count,
    COUNT(*) FILTER (WHERE rows.effective_projection_source IS NOT NULL AND rows.effective_projection_source <> 'unknown') AS known_projection_source_count,
    COUNT(*) FILTER (WHERE rows.effective_projection_source IS NULL OR rows.effective_projection_source = 'unknown') AS unknown_projection_source_count,
    COUNT(*) FILTER (
      WHERE rows.effective_position IS NOT NULL
        AND rows.effective_salary IS NOT NULL
        AND rows.effective_projection_source IS NOT NULL
        AND rows.effective_projection_source <> 'unknown'
    ) AS fully_typed_row_count,
    MIN(rows.contest_date) AS first_contest_date,
    MAX(rows.contest_date) AS last_contest_date
  FROM rows
  GROUP BY rows.sport;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_projection_ingestion_audit(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_projection_ingestion_audit(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_projection_ingestion_audit(TEXT, INT) TO service_role;
