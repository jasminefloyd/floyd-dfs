-- Phase B source provenance and scoped retrieval.

ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP DEFAULT NOW();

DROP FUNCTION IF EXISTS public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID);

CREATE FUNCTION public.fantasy_ai_get_draftkings_salaries(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id UUID DEFAULT NULL
)
RETURNS TABLE (
  contest_id UUID,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  "position" TEXT,
  salary INT,
  game_id TEXT,
  dk_fppg FLOAT,
  status TEXT,
  is_disabled BOOLEAN,
  is_confirmed_starter BOOLEAN,
  image_url TEXT,
  team_logo_url TEXT,
  updated_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    salaries.contest_id,
    salaries.player_id,
    salaries.player_name,
    salaries.team,
    salaries.position,
    salaries.salary,
    salaries.game_id,
    salaries.projected_points AS dk_fppg,
    salaries.status,
    COALESCE(salaries.is_disabled, FALSE),
    COALESCE(salaries.is_confirmed_starter, FALSE),
    salaries.image_url,
    salaries.team_logo_url,
    salaries.imported_at
  FROM tenant_fantasy_ai.draftkings_player_salaries salaries
  WHERE salaries.sport = LOWER(p_sport)
    AND salaries.contest_date = p_contest_date
    AND salaries.contest_type = LOWER(p_contest_type)
    AND (
      p_contest_id IS NULL
      OR salaries.contest_id = p_contest_id
      OR salaries.contest_id IS NULL
    )
  ORDER BY salaries.imported_at DESC, salaries.player_name;
$$;

ALTER TABLE tenant_fantasy_ai.ownership_projections
  ADD COLUMN IF NOT EXISTS contest_id UUID,
  ADD COLUMN IF NOT EXISTS draft_group_id TEXT,
  ADD COLUMN IF NOT EXISTS game_id TEXT,
  ADD COLUMN IF NOT EXISTS contest_type VARCHAR(20);

ALTER TABLE tenant_fantasy_ai.ownership_projections
  DROP CONSTRAINT IF EXISTS ownership_projections_sport_contest_date_player_name_key;

CREATE INDEX IF NOT EXISTS ownership_projections_scope_idx
  ON tenant_fantasy_ai.ownership_projections (sport, contest_date, contest_type, draft_group_id, contest_id, game_id);

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_ownership_projections_v2(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT DEFAULT NULL,
  p_contest_id UUID DEFAULT NULL,
  p_draft_group_id TEXT DEFAULT NULL,
  p_game_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  player_name TEXT,
  ownership_pct FLOAT,
  cpt_ownership_pct FLOAT,
  flex_ownership_pct FLOAT,
  source TEXT,
  scraped_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    ownership.player_name,
    ownership.ownership_pct,
    ownership.cpt_ownership_pct,
    ownership.flex_ownership_pct,
    ownership.source,
    ownership.scraped_at
  FROM tenant_fantasy_ai.ownership_projections ownership
  WHERE ownership.sport = LOWER(p_sport)
    AND ownership.contest_date = p_contest_date
    AND (p_contest_type IS NULL OR ownership.contest_type = LOWER(p_contest_type))
    AND (p_contest_id IS NULL OR ownership.contest_id = p_contest_id)
    AND (p_draft_group_id IS NULL OR ownership.draft_group_id = p_draft_group_id)
    AND (p_game_id IS NULL OR ownership.game_id = p_game_id)
  ORDER BY ownership.scraped_at DESC, ownership.player_name;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_ownership_projections_v2(
  p_sport TEXT,
  p_contest_date DATE,
  p_source TEXT,
  p_contest_type TEXT DEFAULT NULL,
  p_contest_id UUID DEFAULT NULL,
  p_draft_group_id TEXT DEFAULT NULL,
  p_game_id TEXT DEFAULT NULL,
  p_rows JSONB DEFAULT '[]'::JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  DELETE FROM tenant_fantasy_ai.ownership_projections existing
  WHERE existing.sport = LOWER(p_sport)
    AND existing.contest_date = p_contest_date
    AND existing.player_name IN (
      SELECT row_data->>'player_name'
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
    )
    AND existing.contest_type IS NOT DISTINCT FROM LOWER(p_contest_type)
    AND existing.contest_id IS NOT DISTINCT FROM p_contest_id
    AND existing.draft_group_id IS NOT DISTINCT FROM p_draft_group_id
    AND existing.game_id IS NOT DISTINCT FROM p_game_id;

  INSERT INTO tenant_fantasy_ai.ownership_projections (
    sport, contest_date, player_name, ownership_pct, cpt_ownership_pct, flex_ownership_pct,
    source, scraped_at, contest_type, contest_id, draft_group_id, game_id
  )
  SELECT
    LOWER(p_sport), p_contest_date, row_data->>'player_name',
    LEAST(GREATEST(REPLACE(row_data->>'ownership_pct', '%', '')::FLOAT, 0), 100),
    CASE WHEN NULLIF(REPLACE(row_data->>'cpt_ownership_pct', '%', ''), '') IS NOT NULL
      AND REPLACE(row_data->>'cpt_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'cpt_ownership_pct', '%', '')::FLOAT, 0), 100) ELSE NULL END,
    CASE WHEN NULLIF(REPLACE(row_data->>'flex_ownership_pct', '%', ''), '') IS NOT NULL
      AND REPLACE(row_data->>'flex_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'flex_ownership_pct', '%', '')::FLOAT, 0), 100) ELSE NULL END,
    COALESCE(NULLIF(p_source, ''), 'unknown'), NOW(), LOWER(p_contest_type), p_contest_id,
    p_draft_group_id, p_game_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'ownership_pct', '') IS NOT NULL
    AND REPLACE(row_data->>'ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$';

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_ownership_projections_v2(TEXT, DATE, TEXT, UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_ownership_projections_v2(TEXT, DATE, TEXT, TEXT, UUID, TEXT, TEXT, JSONB)
  TO service_role;

ALTER TABLE tenant_fantasy_ai.projection_results
  ADD COLUMN IF NOT EXISTS projection_source TEXT DEFAULT 'unknown';

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results_v2(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.projection_results (
    sport, contest_date, contest_type, contest_id, player_id, player_name, team, position,
    projected_points, actual_points, source, projection_source, updated_at
  )
  SELECT
    LOWER(row_data->>'sport'),
    (row_data->>'contest_date')::DATE,
    LOWER(row_data->>'contest_type'),
    NULLIF(row_data->>'contest_id', '')::UUID,
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    NULLIF(row_data->>'position', ''),
    NULLIF(row_data->>'projected_points', '')::FLOAT,
    NULLIF(row_data->>'actual_points', '')::FLOAT,
    COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore'),
    COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
  ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name)
  DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
    team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
    position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
    projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
    actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
    source = EXCLUDED.source,
    projection_source = EXCLUDED.projection_source,
    updated_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_projection_results_v2(JSONB)
  TO service_role;

DROP FUNCTION IF EXISTS public.fantasy_ai_projection_calibration_v2(TEXT, INT);

CREATE FUNCTION public.fantasy_ai_projection_calibration_v2(
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
        AND (results.contest_id IS NULL OR s.contest_id = results.contest_id OR s.contest_id IS NULL)
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

GRANT EXECUTE ON FUNCTION public.fantasy_ai_projection_calibration_v2(TEXT, INT)
  TO anon, authenticated, service_role;
