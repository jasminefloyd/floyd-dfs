ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries
  ADD COLUMN IF NOT EXISTS game_id TEXT,
  ADD COLUMN IF NOT EXISTS projected_points FLOAT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_confirmed_starter BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS team_logo_url TEXT;

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
  projected_points FLOAT,
  status TEXT,
  is_disabled BOOLEAN,
  is_confirmed_starter BOOLEAN,
  image_url TEXT,
  team_logo_url TEXT
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
    salaries.projected_points,
    salaries.status,
    COALESCE(salaries.is_disabled, FALSE) AS is_disabled,
    COALESCE(salaries.is_confirmed_starter, FALSE) AS is_confirmed_starter,
    salaries.image_url,
    salaries.team_logo_url
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
    status,
    is_disabled,
    is_confirmed_starter,
    image_url,
    team_logo_url,
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
    NULLIF(row_data->>'status', ''),
    COALESCE(NULLIF(row_data->>'is_disabled', '')::BOOLEAN, FALSE),
    COALESCE(NULLIF(row_data->>'is_confirmed_starter', '')::BOOLEAN, FALSE),
    NULLIF(row_data->>'image_url', ''),
    NULLIF(row_data->>'team_logo_url', ''),
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
    status,
    is_disabled,
    is_confirmed_starter,
    image_url,
    team_logo_url,
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
    NULLIF(row_data->>'status', ''),
    COALESCE(NULLIF(row_data->>'is_disabled', '')::BOOLEAN, FALSE),
    COALESCE(NULLIF(row_data->>'is_confirmed_starter', '')::BOOLEAN, FALSE),
    NULLIF(row_data->>'image_url', ''),
    NULLIF(row_data->>'team_logo_url', ''),
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
    status = COALESCE(EXCLUDED.status, tenant_fantasy_ai.draftkings_player_salaries.status),
    is_disabled = COALESCE(EXCLUDED.is_disabled, tenant_fantasy_ai.draftkings_player_salaries.is_disabled, FALSE),
    is_confirmed_starter = COALESCE(EXCLUDED.is_confirmed_starter, tenant_fantasy_ai.draftkings_player_salaries.is_confirmed_starter, FALSE),
    image_url = COALESCE(EXCLUDED.image_url, tenant_fantasy_ai.draftkings_player_salaries.image_url),
    team_logo_url = COALESCE(EXCLUDED.team_logo_url, tenant_fantasy_ai.draftkings_player_salaries.team_logo_url),
    imported_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) TO service_role;
