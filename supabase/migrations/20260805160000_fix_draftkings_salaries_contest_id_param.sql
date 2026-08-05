-- fantasy_ai_get_draftkings_salaries took p_contest_id as UUID, but its only caller
-- (supabase/functions/mios-fantasy-scan/index.ts collectDraftKingsSalaries) passes the
-- app's slate identifier string (e.g. "dk-mlb-showdown-151666"), not a UUID. Every call
-- with a contestId threw "invalid input syntax for type uuid" -- silently, since the
-- caller wraps it in a .catch() that returns an empty list. Change the param to TEXT and
-- cast the salaries.contest_id side (still a real UUID column, populated by
-- fantasy_ai_import_draftkings_slate) so the comparison type-checks.

DROP FUNCTION IF EXISTS public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, UUID);

CREATE FUNCTION public.fantasy_ai_get_draftkings_salaries(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id TEXT DEFAULT NULL
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
      OR salaries.contest_id::TEXT = p_contest_id
      OR salaries.contest_id IS NULL
    )
  ORDER BY salaries.imported_at DESC, salaries.player_name;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT, TEXT) TO anon, authenticated, service_role;
