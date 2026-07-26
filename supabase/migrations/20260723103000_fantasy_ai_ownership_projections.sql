CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.ownership_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  ownership_pct FLOAT NOT NULL CHECK (ownership_pct >= 0 AND ownership_pct <= 100),
  source TEXT NOT NULL DEFAULT 'unknown',
  scraped_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sport, contest_date, player_name)
);

CREATE INDEX IF NOT EXISTS ownership_projections_slate_idx
  ON tenant_fantasy_ai.ownership_projections (sport, contest_date);

CREATE INDEX IF NOT EXISTS ownership_projections_player_idx
  ON tenant_fantasy_ai.ownership_projections (sport, player_name);

ALTER TABLE tenant_fantasy_ai.ownership_projections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ownership_projections_select ON tenant_fantasy_ai.ownership_projections;
CREATE POLICY ownership_projections_select ON tenant_fantasy_ai.ownership_projections FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.ownership_projections TO anon, authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.ownership_projections TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_ownership_projections(
  p_sport TEXT,
  p_contest_date DATE
)
RETURNS TABLE (
  player_name TEXT,
  ownership_pct FLOAT,
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
    ownership.source,
    ownership.scraped_at
  FROM tenant_fantasy_ai.ownership_projections ownership
  WHERE ownership.sport = LOWER(p_sport)
    AND ownership.contest_date = p_contest_date
  ORDER BY ownership.scraped_at DESC, ownership.player_name;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_ownership_projections(
  p_sport TEXT,
  p_contest_date DATE,
  p_source TEXT,
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
  INSERT INTO tenant_fantasy_ai.ownership_projections (
    sport,
    contest_date,
    player_name,
    ownership_pct,
    source,
    scraped_at
  )
  SELECT
    LOWER(p_sport),
    p_contest_date,
    row_data->>'player_name',
    LEAST(GREATEST(REPLACE(row_data->>'ownership_pct', '%', '')::FLOAT, 0), 100),
    COALESCE(NULLIF(p_source, ''), 'unknown'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'ownership_pct', '') IS NOT NULL
    AND REPLACE(row_data->>'ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
  ON CONFLICT (sport, contest_date, player_name)
  DO UPDATE SET
    ownership_pct = EXCLUDED.ownership_pct,
    source = EXCLUDED.source,
    scraped_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_ownership_projections(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_ownership_projections(TEXT, DATE, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_ownership_projections(TEXT, DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_ownership_projections(TEXT, DATE, TEXT, JSONB) TO service_role;
