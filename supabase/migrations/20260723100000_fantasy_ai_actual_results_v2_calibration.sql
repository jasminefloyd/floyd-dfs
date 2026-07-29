CREATE OR REPLACE FUNCTION public.fantasy_ai_get_slate_players_for_results(
  p_sport TEXT,
  p_contest_date DATE
)
RETURNS TABLE (
  contest_id UUID,
  contest_type TEXT,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  "position" TEXT,
  salary INT,
  projected_points FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    salaries.contest_id,
    salaries.contest_type::TEXT,
    salaries.player_id,
    salaries.player_name,
    salaries.team,
    salaries.position,
    salaries.salary,
    salaries.projected_points
  FROM tenant_fantasy_ai.draftkings_player_salaries salaries
  WHERE salaries.sport = LOWER(p_sport)
    AND salaries.contest_date = p_contest_date
    AND salaries.projected_points IS NOT NULL
    AND salaries.projected_points > 0;
$$;

DROP FUNCTION IF EXISTS public.fantasy_ai_upsert_projection_results(TEXT, DATE, TEXT, UUID, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results(
  p_rows JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  WITH parsed_rows AS (
    SELECT
      LOWER(row_data->>'sport') AS sport,
      (row_data->>'contest_date')::DATE AS contest_date,
      LOWER(row_data->>'contest_type') AS contest_type,
      NULLIF(row_data->>'contest_id', '')::UUID AS contest_id,
      NULLIF(row_data->>'player_id', '') AS player_id,
      row_data->>'player_name' AS player_name,
      NULLIF(row_data->>'team', '') AS team,
      NULLIF(row_data->>'position', '') AS position,
      NULLIF(row_data->>'projected_points', '')::FLOAT AS projected_points,
      NULLIF(row_data->>'actual_points', '')::FLOAT AS actual_points,
      COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore') AS source,
      COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown') AS projection_source
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
    WHERE row_data ? 'sport'
      AND row_data ? 'contest_date'
      AND row_data ? 'contest_type'
      AND row_data ? 'player_name'
      AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
      AND NULLIF(row_data->>'sport', '') IS NOT NULL
      AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
      AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
      AND NULLIF(row_data->>'player_name', '') IS NOT NULL
  ),
  input_rows AS (
    SELECT DISTINCT ON (sport, contest_date, contest_type, contest_id, player_name)
      sport,
      contest_date,
      contest_type,
      contest_id,
      player_id,
      player_name,
      team,
      position,
      projected_points,
      actual_points,
      source,
      projection_source
    FROM parsed_rows
    ORDER BY sport, contest_date, contest_type, contest_id, player_name, source
  ),
  updated AS (
    UPDATE tenant_fantasy_ai.projection_results existing
    SET
      player_id = COALESCE(input_rows.player_id, existing.player_id),
      team = COALESCE(input_rows.team, existing.team),
      position = COALESCE(input_rows.position, existing.position),
      projected_points = COALESCE(input_rows.projected_points, existing.projected_points),
      actual_points = COALESCE(input_rows.actual_points, existing.actual_points),
      source = input_rows.source,
      projection_source = input_rows.projection_source,
      updated_at = NOW()
    FROM input_rows
    WHERE existing.sport = input_rows.sport
      AND existing.contest_date = input_rows.contest_date
      AND existing.contest_type = input_rows.contest_type
      AND existing.contest_id IS NOT DISTINCT FROM input_rows.contest_id
      AND existing.player_name = input_rows.player_name
    RETURNING 1
  ),
  inserted AS (
    INSERT INTO tenant_fantasy_ai.projection_results (
      sport,
      contest_date,
      contest_type,
      contest_id,
      player_id,
      player_name,
      team,
      position,
      projected_points,
      actual_points,
      source,
      projection_source,
      updated_at
    )
    SELECT
      input_rows.sport,
      input_rows.contest_date,
      input_rows.contest_type,
      input_rows.contest_id,
      input_rows.player_id,
      input_rows.player_name,
      input_rows.team,
      input_rows.position,
      input_rows.projected_points,
      input_rows.actual_points,
      input_rows.source,
      input_rows.projection_source,
      NOW()
    FROM input_rows
    WHERE NOT EXISTS (
      SELECT 1
      FROM tenant_fantasy_ai.projection_results existing
      WHERE existing.sport = input_rows.sport
        AND existing.contest_date = input_rows.contest_date
        AND existing.contest_type = input_rows.contest_type
        AND existing.contest_id IS NOT DISTINCT FROM input_rows.contest_id
        AND existing.player_name = input_rows.player_name
    )
    ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name)
    DO UPDATE SET
      player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
      team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
      position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
      projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
      actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
      source = EXCLUDED.source,
      projection_source = EXCLUDED.projection_source,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INT
  INTO row_count
  FROM (
    SELECT 1 FROM updated
    UNION ALL
    SELECT 1 FROM inserted
  ) changed_rows;

  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_projection_calibration_v2(
  p_sport TEXT,
  p_days INT DEFAULT 45
)
RETURNS TABLE (
  sport TEXT,
  position_group TEXT,
  salary_tier TEXT,
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
      results.player_name,
      COALESCE(results.position, salaries.position, '') AS raw_position,
      COALESCE(salaries.salary, 0) AS salary,
      results.projected_points,
      results.actual_points
    FROM tenant_fantasy_ai.projection_results results
    LEFT JOIN LATERAL (
      SELECT
        s.position,
        s.salary
      FROM tenant_fantasy_ai.draftkings_player_salaries s
      WHERE s.sport = results.sport
        AND s.contest_date = results.contest_date
        AND s.player_name = results.player_name
        AND (
          results.contest_id IS NULL
          OR s.contest_id = results.contest_id
          OR s.contest_id IS NULL
        )
      ORDER BY CASE WHEN s.contest_id = results.contest_id THEN 0 ELSE 1 END
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
      CASE
        WHEN salary <= 0 THEN 'unknown'
        WHEN salary < 5500 THEN 'value'
        WHEN salary < 8000 THEN 'mid'
        ELSE 'premium'
      END AS salary_tier,
      projected_points,
      actual_points
    FROM base
  )
  SELECT
    bucketed.sport,
    bucketed.position_group,
    bucketed.salary_tier,
    COUNT(*) AS sample_size,
    AVG(bucketed.actual_points - bucketed.projected_points)::FLOAT AS avg_error,
    AVG(ABS(bucketed.actual_points - bucketed.projected_points))::FLOAT AS avg_absolute_error,
    CASE
      WHEN AVG(bucketed.projected_points) > 0.1
      THEN (AVG(bucketed.actual_points) / AVG(bucketed.projected_points))::FLOAT
      ELSE 1::FLOAT
    END AS bias_multiplier
  FROM bucketed
  GROUP BY bucketed.sport, bucketed.position_group, bucketed.salary_tier
  ORDER BY bucketed.position_group, bucketed.salary_tier;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_slate_players_for_results(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_projection_results(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_projection_calibration_v2(TEXT, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_slate_players_for_results(TEXT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_projection_results(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_projection_calibration_v2(TEXT, INT) TO anon, authenticated, service_role;
