ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries
  ADD COLUMN IF NOT EXISTS projected_points FLOAT;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.projection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  contest_type VARCHAR(20) NOT NULL,
  contest_id UUID REFERENCES tenant_fantasy_ai.draftkings_contests(id) ON DELETE SET NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT,
  projected_points FLOAT,
  actual_points FLOAT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sport, contest_date, contest_type, contest_id, player_name)
);

CREATE INDEX IF NOT EXISTS projection_results_slate_idx
  ON tenant_fantasy_ai.projection_results (sport, contest_date, contest_type);

CREATE INDEX IF NOT EXISTS projection_results_player_id_idx
  ON tenant_fantasy_ai.projection_results (player_id);

ALTER TABLE tenant_fantasy_ai.projection_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projection_results_select ON tenant_fantasy_ai.projection_results;
CREATE POLICY projection_results_select ON tenant_fantasy_ai.projection_results FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.projection_results TO anon, authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.projection_results TO service_role;

DROP FUNCTION IF EXISTS public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_draftkings_salaries(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id UUID DEFAULT NULL
)
RETURNS TABLE (
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  "position" TEXT,
  salary INT,
  game_id TEXT,
  projected_points FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    salaries.player_id,
    salaries.player_name,
    salaries.team,
    salaries.position,
    salaries.salary,
    salaries.game_id,
    salaries.projected_points
  FROM tenant_fantasy_ai.draftkings_player_salaries salaries
  WHERE salaries.sport = p_sport
    AND salaries.contest_date = p_contest_date
    AND salaries.contest_type = p_contest_type
    AND (
      p_contest_id IS NULL
      OR salaries.contest_id = p_contest_id
      OR salaries.contest_id IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_import_draftkings_slate(
  p_sport TEXT,
  p_contest_type TEXT,
  p_contest_date DATE,
  p_slate_name TEXT,
  p_external_contest_id TEXT DEFAULT NULL,
  p_game_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_salary_cap INT DEFAULT 50000,
  p_status TEXT DEFAULT 'imported',
  p_start_time TIMESTAMPTZ DEFAULT NULL,
  p_data JSONB DEFAULT '{}'::JSONB,
  p_salaries JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  target_contest_id UUID;
  salary_count INT := 0;
BEGIN
  IF p_sport IS NULL OR p_contest_type IS NULL OR p_contest_date IS NULL OR p_slate_name IS NULL THEN
    RAISE EXCEPTION 'sport, contest_type, contest_date, and slate_name are required';
  END IF;

  SELECT contests.id
  INTO target_contest_id
  FROM tenant_fantasy_ai.draftkings_contests contests
  WHERE (
      p_external_contest_id IS NOT NULL
      AND contests.external_contest_id = p_external_contest_id
    )
    OR (
      p_external_contest_id IS NULL
      AND contests.sport = LOWER(p_sport)
      AND contests.contest_type = LOWER(p_contest_type)
      AND contests.contest_date = p_contest_date
      AND contests.slate_name = p_slate_name
    )
  ORDER BY contests.updated_at DESC
  LIMIT 1;

  IF target_contest_id IS NULL THEN
    INSERT INTO tenant_fantasy_ai.draftkings_contests (
      sport,
      contest_date,
      contest_type,
      external_contest_id,
      slate_name,
      game_ids,
      salary_cap,
      status,
      start_time,
      data,
      updated_at
    )
    VALUES (
      LOWER(p_sport),
      p_contest_date,
      LOWER(p_contest_type),
      NULLIF(p_external_contest_id, ''),
      p_slate_name,
      COALESCE(p_game_ids, ARRAY[]::TEXT[]),
      COALESCE(p_salary_cap, 50000),
      COALESCE(p_status, 'imported'),
      p_start_time,
      COALESCE(p_data, '{}'::JSONB),
      NOW()
    )
    RETURNING id INTO target_contest_id;
  ELSE
    UPDATE tenant_fantasy_ai.draftkings_contests
    SET
      sport = LOWER(p_sport),
      contest_date = p_contest_date,
      contest_type = LOWER(p_contest_type),
      external_contest_id = COALESCE(NULLIF(p_external_contest_id, ''), external_contest_id),
      slate_name = p_slate_name,
      game_ids = COALESCE(p_game_ids, ARRAY[]::TEXT[]),
      salary_cap = COALESCE(p_salary_cap, salary_cap, 50000),
      status = COALESCE(p_status, status, 'imported'),
      start_time = COALESCE(p_start_time, start_time),
      data = COALESCE(p_data, data, '{}'::JSONB),
      updated_at = NOW()
    WHERE id = target_contest_id;
  END IF;

  DELETE FROM tenant_fantasy_ai.draftkings_player_salaries
  WHERE contest_id = target_contest_id;

  INSERT INTO tenant_fantasy_ai.draftkings_player_salaries (
    sport,
    contest_date,
    contest_type,
    contest_id,
    game_id,
    player_id,
    player_name,
    team,
    position,
    salary,
    projected_points,
    imported_at
  )
  SELECT
    LOWER(p_sport),
    p_contest_date,
    LOWER(p_contest_type),
    target_contest_id,
    NULLIF(row_data->>'game_id', ''),
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    row_data->>'position',
    (row_data->>'salary')::INT,
    CASE
      WHEN row_data ? 'projected_points'
        AND NULLIF(row_data->>'projected_points', '') IS NOT NULL
      THEN (row_data->>'projected_points')::FLOAT
      ELSE NULL
    END,
    NOW()
  FROM jsonb_array_elements(COALESCE(p_salaries, '[]'::JSONB)) row_data
  WHERE row_data ? 'player_name'
    AND row_data ? 'position'
    AND row_data ? 'salary'
    AND (row_data->>'salary')::INT > 0;

  GET DIAGNOSTICS salary_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'contest_id', target_contest_id,
    'salary_count', salary_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_draftkings_salaries(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
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
  INSERT INTO tenant_fantasy_ai.draftkings_player_salaries (
    sport,
    contest_date,
    contest_type,
    player_id,
    player_name,
    team,
    position,
    salary,
    projected_points,
    imported_at
  )
  SELECT
    LOWER(p_sport),
    p_contest_date,
    LOWER(p_contest_type),
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    row_data->>'position',
    (row_data->>'salary')::INT,
    CASE
      WHEN row_data ? 'projected_points'
        AND NULLIF(row_data->>'projected_points', '') IS NOT NULL
      THEN (row_data->>'projected_points')::FLOAT
      ELSE NULL
    END,
    NOW()
  FROM jsonb_array_elements(p_rows) row_data
  WHERE row_data ? 'player_name'
    AND row_data ? 'position'
    AND row_data ? 'salary'
    AND (row_data->>'salary')::INT > 0
  ON CONFLICT (sport, contest_date, contest_type, player_name, position)
  DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.draftkings_player_salaries.player_id),
    team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.draftkings_player_salaries.team),
    salary = EXCLUDED.salary,
    projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.draftkings_player_salaries.projected_points),
    imported_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id UUID,
  p_rows JSONB,
  p_source TEXT DEFAULT 'manual'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
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
    updated_at
  )
  SELECT
    LOWER(p_sport),
    p_contest_date,
    LOWER(p_contest_type),
    p_contest_id,
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    NULLIF(row_data->>'position', ''),
    NULLIF(row_data->>'projected_points', '')::FLOAT,
    NULLIF(row_data->>'actual_points', '')::FLOAT,
    COALESCE(NULLIF(p_source, ''), 'manual'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE row_data ? 'player_name'
    AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
  ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name)
  DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
    team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
    position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
    projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
    actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
    source = EXCLUDED.source,
    updated_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_projection_calibration(
  p_sport TEXT,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  sport TEXT,
  sample_size BIGINT,
  avg_projection_error FLOAT,
  avg_absolute_error FLOAT,
  projection_bias_multiplier FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    results.sport::TEXT,
    COUNT(*) AS sample_size,
    AVG(results.actual_points - results.projected_points)::FLOAT AS avg_projection_error,
    AVG(ABS(results.actual_points - results.projected_points))::FLOAT AS avg_absolute_error,
    CASE
      WHEN AVG(results.projected_points) > 0
      THEN (AVG(results.actual_points) / AVG(results.projected_points))::FLOAT
      ELSE 1::FLOAT
    END AS projection_bias_multiplier
  FROM tenant_fantasy_ai.projection_results results
  WHERE results.sport = LOWER(p_sport)
    AND results.projected_points IS NOT NULL
    AND results.actual_points IS NOT NULL
    AND results.contest_date >= CURRENT_DATE - COALESCE(p_days, 30)
  GROUP BY results.sport;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_import_draftkings_slate(TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], INT, TEXT, TIMESTAMPTZ, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_projection_results(TEXT, DATE, TEXT, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_projection_calibration(TEXT, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_import_draftkings_slate(TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], INT, TEXT, TIMESTAMPTZ, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_projection_results(TEXT, DATE, TEXT, UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_projection_calibration(TEXT, INT) TO anon, authenticated, service_role;
