CREATE OR REPLACE FUNCTION public.fantasy_ai_projection_calibration(
  p_sport TEXT,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  sport TEXT,
  sample_size BIGINT,
  avg_projection_error FLOAT,
  avg_absolute_error FLOAT,
  projection_bias_multiplier FLOAT,
  avg_ratio_multiplier FLOAT,
  median_ratio_multiplier FLOAT,
  spearman_rank_correlation FLOAT,
  variance_calibration_ratio FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH filtered AS (
    SELECT *
    FROM tenant_fantasy_ai.projection_results results
    WHERE results.sport = LOWER(p_sport)
      AND results.projected_points IS NOT NULL
      AND results.projected_points > 0
      AND results.actual_points IS NOT NULL
      AND results.contest_date >= CURRENT_DATE - COALESCE(p_days, 30)
  ),
  ranked AS (
    SELECT
      filtered.*,
      RANK() OVER (PARTITION BY filtered.sport, filtered.contest_date, filtered.contest_type, COALESCE(filtered.contest_id::TEXT, '') ORDER BY filtered.projected_points) AS projected_rank,
      RANK() OVER (PARTITION BY filtered.sport, filtered.contest_date, filtered.contest_type, COALESCE(filtered.contest_id::TEXT, '') ORDER BY filtered.actual_points) AS actual_rank
    FROM filtered
  )
  SELECT
    ranked.sport::TEXT,
    COUNT(*) AS sample_size,
    AVG(ranked.actual_points - ranked.projected_points)::FLOAT AS avg_projection_error,
    AVG(ABS(ranked.actual_points - ranked.projected_points))::FLOAT AS avg_absolute_error,
    CASE
      WHEN COUNT(*) >= 30
      THEN AVG(ranked.actual_points / NULLIF(ranked.projected_points, 0))::FLOAT
      ELSE 1::FLOAT
    END AS projection_bias_multiplier,
    AVG(ranked.actual_points / NULLIF(ranked.projected_points, 0))::FLOAT AS avg_ratio_multiplier,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ranked.actual_points / NULLIF(ranked.projected_points, 0))::FLOAT AS median_ratio_multiplier,
    CORR(ranked.projected_rank::FLOAT, ranked.actual_rank::FLOAT)::FLOAT AS spearman_rank_correlation,
    CASE
      WHEN STDDEV_POP(ranked.projected_points) > 0
      THEN (STDDEV_POP(ranked.actual_points) / STDDEV_POP(ranked.projected_points))::FLOAT
      ELSE NULL
    END AS variance_calibration_ratio
  FROM ranked
  GROUP BY ranked.sport;
$$;
