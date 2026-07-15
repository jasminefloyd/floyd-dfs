ALTER TABLE tenant_fantasy_ai.draftkings_contests
  ADD COLUMN IF NOT EXISTS external_contest_id TEXT,
  ADD COLUMN IF NOT EXISTS slate_name TEXT,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::JSONB;

ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries
  ADD COLUMN IF NOT EXISTS contest_id UUID REFERENCES tenant_fantasy_ai.draftkings_contests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS game_id TEXT;

CREATE INDEX IF NOT EXISTS draftkings_contests_lookup_idx
  ON tenant_fantasy_ai.draftkings_contests (sport, contest_type, contest_date);

CREATE INDEX IF NOT EXISTS draftkings_contests_external_contest_id_idx
  ON tenant_fantasy_ai.draftkings_contests (external_contest_id);

CREATE INDEX IF NOT EXISTS draftkings_player_salaries_contest_id_idx
  ON tenant_fantasy_ai.draftkings_player_salaries (contest_id);

CREATE INDEX IF NOT EXISTS draftkings_player_salaries_game_id_idx
  ON tenant_fantasy_ai.draftkings_player_salaries (game_id);

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_draftkings_slates(
  p_sport TEXT,
  p_contest_type TEXT
)
RETURNS TABLE (
  contest_id TEXT,
  external_contest_id TEXT,
  sport TEXT,
  contest_type TEXT,
  contest_date DATE,
  slate_name TEXT,
  game_ids TEXT[],
  salary_cap INT,
  status TEXT,
  start_time TEXT,
  salary_count BIGINT,
  data JSONB,
  updated_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    contests.id::TEXT AS contest_id,
    contests.external_contest_id,
    contests.sport::TEXT,
    contests.contest_type::TEXT,
    contests.contest_date,
    COALESCE(
      NULLIF(contests.slate_name, ''),
      NULLIF(contests.data->>'slate_name', ''),
      NULLIF(contests.data->>'name', ''),
      CONCAT(UPPER(contests.sport), ' ', INITCAP(contests.contest_type), ' ', contests.contest_date::TEXT)
    ) AS slate_name,
    COALESCE(contests.game_ids, ARRAY[]::TEXT[]) AS game_ids,
    contests.salary_cap,
    contests.status::TEXT,
    COALESCE(contests.start_time::TEXT, contests.data->>'start_time', contests.data->>'startTime') AS start_time,
    (
      SELECT COUNT(*)
      FROM tenant_fantasy_ai.draftkings_player_salaries salaries
      WHERE salaries.sport = contests.sport
        AND salaries.contest_type = contests.contest_type
        AND salaries.contest_date = contests.contest_date
        AND (
          salaries.contest_id = contests.id
          OR salaries.contest_id IS NULL
        )
    ) AS salary_count,
    COALESCE(contests.data, '{}'::JSONB) AS data,
    contests.updated_at
  FROM tenant_fantasy_ai.draftkings_contests contests
  WHERE contests.sport = LOWER(p_sport)
    AND contests.contest_type = LOWER(p_contest_type)
    AND COALESCE(contests.status, 'open') <> 'archived'
  ORDER BY contests.contest_date ASC, contests.start_time ASC NULLS LAST, contests.updated_at DESC;
$$;

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
  game_id TEXT
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
    salaries.game_id
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

REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_slates(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_slates(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID) TO anon, authenticated, service_role;
