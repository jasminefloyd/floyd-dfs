CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.draftkings_player_salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  contest_type VARCHAR(20) NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT NOT NULL,
  salary INT NOT NULL CHECK (salary > 0),
  imported_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sport, contest_date, contest_type, player_name, position)
);

CREATE INDEX IF NOT EXISTS draftkings_player_salaries_slate_idx
  ON tenant_fantasy_ai.draftkings_player_salaries (sport, contest_date, contest_type);

CREATE INDEX IF NOT EXISTS draftkings_player_salaries_player_id_idx
  ON tenant_fantasy_ai.draftkings_player_salaries (player_id);

ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salaries_select ON tenant_fantasy_ai.draftkings_player_salaries;
CREATE POLICY salaries_select ON tenant_fantasy_ai.draftkings_player_salaries FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.draftkings_player_salaries TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_draftkings_salaries(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT
)
RETURNS TABLE (
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  "position" TEXT,
  salary INT
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
    salaries.salary
  FROM tenant_fantasy_ai.draftkings_player_salaries salaries
  WHERE salaries.sport = p_sport
    AND salaries.contest_date = p_contest_date
    AND salaries.contest_type = p_contest_type;
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
    imported_at
  )
  SELECT
    p_sport,
    p_contest_date,
    p_contest_type,
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    row_data->>'position',
    (row_data->>'salary')::INT,
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
    imported_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_cached_social_sentiment(
  p_player_id TEXT,
  p_sport TEXT
)
RETURNS TABLE (
  player_id TEXT,
  sport VARCHAR(10),
  reddit_mentions INT,
  sentiment_score FLOAT,
  key_themes TEXT[],
  last_updated_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    sentiment.player_id,
    sentiment.sport,
    sentiment.reddit_mentions,
    sentiment.sentiment_score,
    sentiment.key_themes,
    sentiment.last_updated_at
  FROM tenant_fantasy_ai.social_sentiment sentiment
  WHERE sentiment.player_id = p_player_id
    AND sentiment.sport = p_sport
    AND sentiment.last_updated_at > NOW() - INTERVAL '24 hours'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_social_sentiment(
  p_player_id TEXT,
  p_sport TEXT,
  p_reddit_mentions INT,
  p_sentiment_score FLOAT,
  p_key_themes TEXT[]
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  INSERT INTO tenant_fantasy_ai.social_sentiment (
    player_id,
    sport,
    reddit_mentions,
    sentiment_score,
    key_themes,
    last_updated_at
  )
  VALUES (
    p_player_id,
    p_sport,
    p_reddit_mentions,
    p_sentiment_score,
    p_key_themes,
    NOW()
  )
  ON CONFLICT (player_id, sport)
  DO UPDATE SET
    reddit_mentions = EXCLUDED.reddit_mentions,
    sentiment_score = EXCLUDED.sentiment_score,
    key_themes = EXCLUDED.key_themes,
    last_updated_at = NOW();
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_cached_social_sentiment(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_social_sentiment(TEXT, TEXT, INT, FLOAT, TEXT[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_draftkings_salaries(TEXT, DATE, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_draftkings_salaries(TEXT, DATE, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_cached_social_sentiment(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_social_sentiment(TEXT, TEXT, INT, FLOAT, TEXT[]) TO service_role;
