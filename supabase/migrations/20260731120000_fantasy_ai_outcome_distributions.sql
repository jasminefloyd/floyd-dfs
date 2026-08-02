CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.player_outcome_distributions (
  record_key TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT,
  game_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  projection_source TEXT,
  sample_size INT NOT NULL DEFAULT 0,
  p10 FLOAT,
  p25 FLOAT,
  p50 FLOAT,
  p75 FLOAT,
  p90 FLOAT,
  p95 FLOAT,
  stdev_fantasy_pts FLOAT,
  boom_probability FLOAT,
  bust_probability FLOAT,
  source TEXT NOT NULL,
  source_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_outcome_distributions_scope_idx
  ON tenant_fantasy_ai.player_outcome_distributions (sport, contest_date, contest_type, player_name);

ALTER TABLE tenant_fantasy_ai.player_outcome_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_outcome_distributions_select ON tenant_fantasy_ai.player_outcome_distributions;
CREATE POLICY player_outcome_distributions_select
  ON tenant_fantasy_ai.player_outcome_distributions FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.player_outcome_distributions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON tenant_fantasy_ai.player_outcome_distributions TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_player_outcome_distributions(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  inserted_count INTEGER := 0;
  row_data JSONB;
  key TEXT;
BEGIN
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    key := md5(concat_ws('|',
      lower(COALESCE(row_data->>'sport', '')),
      COALESCE(row_data->>'contest_date', ''),
      lower(COALESCE(row_data->>'contest_type', '')),
      COALESCE(row_data->>'contest_id', ''),
      COALESCE(row_data->>'game_id', ''),
      COALESCE(row_data->>'player_id', row_data->>'player_name', '')
    ));

    INSERT INTO tenant_fantasy_ai.player_outcome_distributions (
      record_key, sport, contest_date, contest_type, contest_id, game_id,
      player_id, player_name, projection_source, sample_size,
      p10, p25, p50, p75, p90, p95, stdev_fantasy_pts,
      boom_probability, bust_probability, source, source_updated_at, updated_at
    ) VALUES (
      key,
      lower(row_data->>'sport'),
      (row_data->>'contest_date')::date,
      lower(row_data->>'contest_type'),
      NULLIF(row_data->>'contest_id', ''),
      NULLIF(row_data->>'game_id', ''),
      NULLIF(row_data->>'player_id', ''),
      row_data->>'player_name',
      NULLIF(row_data->>'projection_source', ''),
      COALESCE((row_data->>'sample_size')::int, 0),
      (row_data->>'p10')::float, (row_data->>'p25')::float, (row_data->>'p50')::float,
      (row_data->>'p75')::float, (row_data->>'p90')::float, (row_data->>'p95')::float,
      (row_data->>'stdev_fantasy_pts')::float,
      (row_data->>'boom_probability')::float, (row_data->>'bust_probability')::float,
      COALESCE(NULLIF(row_data->>'source', ''), 'derived'),
      COALESCE((row_data->>'source_updated_at')::timestamp, NOW()), NOW()
    )
    ON CONFLICT (record_key) DO UPDATE SET
      projection_source = EXCLUDED.projection_source,
      sample_size = EXCLUDED.sample_size,
      p10 = EXCLUDED.p10, p25 = EXCLUDED.p25, p50 = EXCLUDED.p50,
      p75 = EXCLUDED.p75, p90 = EXCLUDED.p90, p95 = EXCLUDED.p95,
      stdev_fantasy_pts = EXCLUDED.stdev_fantasy_pts,
      boom_probability = EXCLUDED.boom_probability,
      bust_probability = EXCLUDED.bust_probability,
      source = EXCLUDED.source,
      source_updated_at = EXCLUDED.source_updated_at,
      updated_at = NOW();
    inserted_count := inserted_count + 1;
  END LOOP;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_player_outcome_distributions(
  p_sport TEXT, p_contest_date DATE, p_contest_type TEXT,
  p_contest_id TEXT DEFAULT NULL, p_game_id TEXT DEFAULT NULL
)
RETURNS SETOF tenant_fantasy_ai.player_outcome_distributions
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT * FROM tenant_fantasy_ai.player_outcome_distributions
  WHERE sport = lower(p_sport)
    AND contest_date = p_contest_date
    AND contest_type = lower(p_contest_type)
    AND (p_contest_id IS NULL OR contest_id = p_contest_id OR contest_id IS NULL)
    AND (p_game_id IS NULL OR game_id = p_game_id OR game_id IS NULL)
  ORDER BY player_name;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_player_outcome_distributions(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_player_outcome_distributions(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_player_outcome_distributions(TEXT, DATE, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
