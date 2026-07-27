ALTER TABLE tenant_fantasy_ai.ownership_projections
  ADD COLUMN IF NOT EXISTS cpt_ownership_pct FLOAT NULL CHECK (cpt_ownership_pct >= 0 AND cpt_ownership_pct <= 100),
  ADD COLUMN IF NOT EXISTS flex_ownership_pct FLOAT NULL CHECK (flex_ownership_pct >= 0 AND flex_ownership_pct <= 100);

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_ownership_projections(
  p_sport TEXT,
  p_contest_date DATE
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
    cpt_ownership_pct,
    flex_ownership_pct,
    source,
    scraped_at
  )
  SELECT
    LOWER(p_sport),
    p_contest_date,
    row_data->>'player_name',
    LEAST(GREATEST(REPLACE(row_data->>'ownership_pct', '%', '')::FLOAT, 0), 100),
    CASE WHEN NULLIF(row_data->>'cpt_ownership_pct', '') IS NOT NULL AND REPLACE(row_data->>'cpt_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'cpt_ownership_pct', '%', '')::FLOAT, 0), 100)
      ELSE NULL
    END,
    CASE WHEN NULLIF(row_data->>'flex_ownership_pct', '') IS NOT NULL AND REPLACE(row_data->>'flex_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'flex_ownership_pct', '%', '')::FLOAT, 0), 100)
      ELSE NULL
    END,
    COALESCE(NULLIF(p_source, ''), 'unknown'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'ownership_pct', '') IS NOT NULL
    AND REPLACE(row_data->>'ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
  ON CONFLICT (sport, contest_date, player_name)
  DO UPDATE SET
    ownership_pct = EXCLUDED.ownership_pct,
    cpt_ownership_pct = EXCLUDED.cpt_ownership_pct,
    flex_ownership_pct = EXCLUDED.flex_ownership_pct,
    source = EXCLUDED.source,
    scraped_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
