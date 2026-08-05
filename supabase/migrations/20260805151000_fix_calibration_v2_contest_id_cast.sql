-- fantasy_ai_projection_calibration_v2 joined draftkings_player_salaries.contest_id (UUID)
-- directly against projection_results.contest_id, which the prior migration changed to TEXT.
-- Cast the UUID side so the join keeps working.

CREATE OR REPLACE FUNCTION public.fantasy_ai_projection_calibration_v2(
  p_sport TEXT,
  p_days INT DEFAULT 45
)
RETURNS TABLE (
  sport TEXT,
  position_group TEXT,
  salary_tier TEXT,
  projection_source TEXT,
  sample_size BIGINT,
  avg_error FLOAT,
  avg_absolute_error FLOAT,
  bias_multiplier FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH base AS (
    SELECT
      results.sport::TEXT AS sport,
      COALESCE(results.projection_source, 'unknown') AS projection_source,
      COALESCE(results.position, salaries.position, '') AS raw_position,
      COALESCE(salaries.salary, 0) AS salary,
      results.projected_points,
      results.actual_points
    FROM tenant_fantasy_ai.projection_results results
    LEFT JOIN LATERAL (
      SELECT s.position, s.salary
      FROM tenant_fantasy_ai.draftkings_player_salaries s
      WHERE s.sport = results.sport
        AND s.contest_date = results.contest_date
        AND s.player_name = results.player_name
        AND (results.contest_id IS NULL OR s.contest_id::TEXT = results.contest_id OR s.contest_id IS NULL)
      ORDER BY CASE WHEN s.contest_id::TEXT = results.contest_id THEN 0 ELSE 1 END
      LIMIT 1
    ) salaries ON true
    WHERE results.sport = LOWER(p_sport)
      AND results.projected_points IS NOT NULL
      AND results.actual_points IS NOT NULL
      AND results.projected_points > 0.1
      AND results.contest_date >= CURRENT_DATE - COALESCE(p_days, 45)
  ),
  bucketed AS (
    SELECT
      sport,
      projection_source,
      CASE
        WHEN sport IN ('nba', 'wnba') AND raw_position ILIKE '%C%' THEN 'C'
        WHEN sport IN ('nba', 'wnba') AND (raw_position ILIKE '%PG%' OR raw_position ILIKE '%SG%' OR raw_position = 'G') THEN 'G'
        WHEN sport IN ('nba', 'wnba') THEN 'F'
        WHEN sport = 'nfl' AND raw_position IN ('QB', 'RB', 'WR', 'TE', 'DST', 'DEF') THEN CASE WHEN raw_position = 'DEF' THEN 'DST' ELSE raw_position END
        WHEN sport = 'mlb' AND raw_position IN ('P', 'SP', 'RP') THEN 'P'
        WHEN sport = 'mlb' AND raw_position = 'OF' THEN 'OF'
        WHEN sport = 'mlb' AND raw_position = 'C' THEN 'C'
        WHEN sport = 'mlb' THEN 'IF'
        ELSE COALESCE(NULLIF(raw_position, ''), 'UNK')
      END AS position_group,
      CASE WHEN salary <= 0 THEN 'unknown' WHEN salary < 5500 THEN 'value' WHEN salary < 8000 THEN 'mid' ELSE 'premium' END AS salary_tier,
      projected_points,
      actual_points
    FROM base
  )
  SELECT
    bucketed.sport,
    bucketed.position_group,
    bucketed.salary_tier,
    bucketed.projection_source,
    COUNT(*) AS sample_size,
    AVG(bucketed.actual_points - bucketed.projected_points)::FLOAT,
    AVG(ABS(bucketed.actual_points - bucketed.projected_points))::FLOAT,
    CASE WHEN AVG(bucketed.projected_points) > 0.1 THEN (AVG(bucketed.actual_points) / AVG(bucketed.projected_points))::FLOAT ELSE 1::FLOAT END
  FROM bucketed
  GROUP BY bucketed.sport, bucketed.position_group, bucketed.salary_tier, bucketed.projection_source
  ORDER BY bucketed.position_group, bucketed.salary_tier, bucketed.projection_source;
$$;
