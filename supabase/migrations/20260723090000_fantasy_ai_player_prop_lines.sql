CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.player_prop_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  event_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  market TEXT NOT NULL,
  line FLOAT NOT NULL,
  over_price INT,
  under_price INT,
  bookmaker TEXT,
  fetched_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  UNIQUE(sport, event_id, player_name, market, bookmaker)
);

CREATE INDEX IF NOT EXISTS player_prop_lines_event_idx
  ON tenant_fantasy_ai.player_prop_lines (sport, event_id);

CREATE INDEX IF NOT EXISTS player_prop_lines_player_idx
  ON tenant_fantasy_ai.player_prop_lines (sport, player_name);

ALTER TABLE tenant_fantasy_ai.player_prop_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_prop_lines_select ON tenant_fantasy_ai.player_prop_lines;
CREATE POLICY player_prop_lines_select ON tenant_fantasy_ai.player_prop_lines FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.player_prop_lines TO anon, authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.player_prop_lines TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_cached_prop_lines(
  p_sport TEXT,
  p_event_id TEXT
)
RETURNS TABLE (
  sport VARCHAR(10),
  event_id TEXT,
  player_name TEXT,
  market TEXT,
  line FLOAT,
  over_price INT,
  under_price INT,
  bookmaker TEXT,
  fetched_at TIMESTAMP,
  expires_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    props.sport,
    props.event_id,
    props.player_name,
    props.market,
    props.line,
    props.over_price,
    props.under_price,
    props.bookmaker,
    props.fetched_at,
    props.expires_at
  FROM tenant_fantasy_ai.player_prop_lines props
  WHERE props.sport = p_sport
    AND props.event_id = p_event_id
    AND (props.expires_at IS NULL OR props.expires_at > NOW());
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_prop_lines(
  p_sport TEXT,
  p_event_id TEXT,
  p_lines JSONB,
  p_expires_at TIMESTAMP
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.player_prop_lines (
    sport,
    event_id,
    player_name,
    market,
    line,
    over_price,
    under_price,
    bookmaker,
    fetched_at,
    expires_at
  )
  SELECT
    LOWER(p_sport),
    p_event_id,
    row_data->>'player_name',
    row_data->>'market',
    (row_data->>'line')::FLOAT,
    CASE WHEN NULLIF(row_data->>'over_price', '') IS NOT NULL THEN (row_data->>'over_price')::INT ELSE NULL END,
    CASE WHEN NULLIF(row_data->>'under_price', '') IS NOT NULL THEN (row_data->>'under_price')::INT ELSE NULL END,
    COALESCE(NULLIF(row_data->>'bookmaker', ''), 'consensus'),
    NOW(),
    p_expires_at
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) row_data
  WHERE row_data ? 'player_name'
    AND row_data ? 'market'
    AND row_data ? 'line'
    AND NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'market', '') IS NOT NULL
    AND NULLIF(row_data->>'line', '') IS NOT NULL
  ON CONFLICT (sport, event_id, player_name, market, bookmaker)
  DO UPDATE SET
    line = EXCLUDED.line,
    over_price = EXCLUDED.over_price,
    under_price = EXCLUDED.under_price,
    fetched_at = NOW(),
    expires_at = EXCLUDED.expires_at;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_cached_prop_lines(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_prop_lines(TEXT, TEXT, JSONB, TIMESTAMP) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_cached_prop_lines(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_prop_lines(TEXT, TEXT, JSONB, TIMESTAMP) TO service_role;
