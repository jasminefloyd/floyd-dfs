DROP FUNCTION IF EXISTS public.fantasy_ai_import_draftkings_slate(TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], INT, TEXT, TIMESTAMPTZ, JSONB, JSONB);

ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries
  DROP CONSTRAINT IF EXISTS draftkings_player_salaries_sport_contest_date_contest_type_player_name_position_key;

CREATE UNIQUE INDEX IF NOT EXISTS draftkings_player_salaries_contest_player_idx
  ON tenant_fantasy_ai.draftkings_player_salaries (contest_id, player_name, position)
  WHERE contest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS draftkings_contests_slate_match_idx
  ON tenant_fantasy_ai.draftkings_contests (sport, contest_type, contest_date, slate_name);

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

REVOKE ALL ON FUNCTION public.fantasy_ai_import_draftkings_slate(TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], INT, TEXT, TIMESTAMPTZ, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_import_draftkings_slate(TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], INT, TEXT, TIMESTAMPTZ, JSONB, JSONB) TO service_role;
