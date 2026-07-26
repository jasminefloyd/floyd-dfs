CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.confirmed_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  game_date DATE NOT NULL,
  team TEXT NOT NULL,
  player_name TEXT NOT NULL,
  batting_order INT,
  lineup_status TEXT NOT NULL,
  injury_tag TEXT,
  is_starting_pitcher BOOL DEFAULT FALSE,
  scraped_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sport, game_date, team, player_name)
);

CREATE INDEX IF NOT EXISTS confirmed_lineups_slate_idx
  ON tenant_fantasy_ai.confirmed_lineups (sport, game_date);

CREATE INDEX IF NOT EXISTS confirmed_lineups_team_idx
  ON tenant_fantasy_ai.confirmed_lineups (sport, game_date, team);

ALTER TABLE tenant_fantasy_ai.confirmed_lineups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS confirmed_lineups_select ON tenant_fantasy_ai.confirmed_lineups;
CREATE POLICY confirmed_lineups_select ON tenant_fantasy_ai.confirmed_lineups FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.confirmed_lineups TO anon, authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.confirmed_lineups TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_confirmed_lineups(
  p_sport TEXT,
  p_game_date DATE
)
RETURNS TABLE (
  sport VARCHAR(10),
  game_date DATE,
  team TEXT,
  player_name TEXT,
  batting_order INT,
  lineup_status TEXT,
  injury_tag TEXT,
  is_starting_pitcher BOOL,
  scraped_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    lineups.sport,
    lineups.game_date,
    lineups.team,
    lineups.player_name,
    lineups.batting_order,
    lineups.lineup_status,
    lineups.injury_tag,
    lineups.is_starting_pitcher,
    lineups.scraped_at
  FROM tenant_fantasy_ai.confirmed_lineups lineups
  WHERE lineups.sport = p_sport
    AND lineups.game_date = p_game_date;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_confirmed_lineups(
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
  INSERT INTO tenant_fantasy_ai.confirmed_lineups (
    sport,
    game_date,
    team,
    player_name,
    batting_order,
    lineup_status,
    injury_tag,
    is_starting_pitcher,
    scraped_at
  )
  SELECT
    LOWER(row_data->>'sport'),
    (row_data->>'game_date')::DATE,
    row_data->>'team',
    row_data->>'player_name',
    CASE WHEN NULLIF(row_data->>'batting_order', '') IS NOT NULL THEN (row_data->>'batting_order')::INT ELSE NULL END,
    COALESCE(NULLIF(row_data->>'lineup_status', ''), 'expected'),
    NULLIF(row_data->>'injury_tag', ''),
    COALESCE((row_data->>'is_starting_pitcher')::BOOL, FALSE),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE row_data ? 'sport'
    AND row_data ? 'game_date'
    AND row_data ? 'team'
    AND row_data ? 'player_name'
    AND NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'game_date', '') IS NOT NULL
    AND NULLIF(row_data->>'team', '') IS NOT NULL
    AND NULLIF(row_data->>'player_name', '') IS NOT NULL
  ON CONFLICT (sport, game_date, team, player_name)
  DO UPDATE SET
    batting_order = EXCLUDED.batting_order,
    lineup_status = EXCLUDED.lineup_status,
    injury_tag = EXCLUDED.injury_tag,
    is_starting_pitcher = EXCLUDED.is_starting_pitcher,
    scraped_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_confirmed_lineups(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_confirmed_lineups(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_confirmed_lineups(TEXT, DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_confirmed_lineups(JSONB) TO service_role;
