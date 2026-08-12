-- Phase 1 completion: exact generation evidence and authorized settlement imports.

ALTER TABLE tenant_fantasy_ai.projection_results
  ADD COLUMN IF NOT EXISTS actual_starter BOOLEAN;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_contest_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT,
  source TEXT NOT NULL,
  imported_by UUID REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  row_count INT NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contest_date, contest_type, contest_id, source, payload_hash)
);
ALTER TABLE tenant_fantasy_ai.wnba_contest_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_contest_imports_select ON tenant_fantasy_ai.wnba_contest_imports;
CREATE POLICY wnba_contest_imports_select ON tenant_fantasy_ai.wnba_contest_imports FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_contest_imports TO authenticated;
GRANT INSERT ON tenant_fantasy_ai.wnba_contest_imports TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_import_wnba_contest_results(
  p_contest_date DATE, p_contest_type TEXT, p_contest_id TEXT, p_source TEXT, p_imported_by UUID, p_payload_hash TEXT, p_rows JSONB
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE affected INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.wnba_contest_imports (contest_date, contest_type, contest_id, source, imported_by, row_count, payload_hash)
  VALUES (p_contest_date, lower(p_contest_type), NULLIF(p_contest_id, ''), p_source, p_imported_by, jsonb_array_length(COALESCE(p_rows, '[]'::JSONB)), p_payload_hash)
  ON CONFLICT (contest_date, contest_type, contest_id, source, payload_hash) DO NOTHING;
  UPDATE tenant_fantasy_ai.generated_lineups lineups SET
    finish_rank = COALESCE(NULLIF(row->>'finish_rank', '')::INT, lineups.finish_rank),
    field_size = COALESCE(NULLIF(row->>'field_size', '')::INT, lineups.field_size),
    cash_line = COALESCE(NULLIF(row->>'cash_line', '')::FLOAT, lineups.cash_line),
    entry_fee = COALESCE(NULLIF(row->>'entry_fee', '')::NUMERIC, lineups.entry_fee),
    payout = COALESCE(NULLIF(row->>'payout', '')::NUMERIC, lineups.payout),
    actual_duplicates = COALESCE(NULLIF(row->>'actual_duplicates', '')::FLOAT, lineups.actual_duplicates),
    result_recorded_at = NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row
  WHERE lineups.sport = 'wnba' AND lineups.contest_date = p_contest_date
    AND lower(lineups.contest_type) = lower(p_contest_type)
    AND (NULLIF(p_contest_id, '') IS NULL OR lineups.contest_id = p_contest_id)
    AND ((row->>'generated_lineup_id')::UUID = lineups.id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END; $$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results_v2(p_rows JSONB)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.projection_results (sport, contest_date, contest_type, contest_id, player_id, player_name, team, position, projected_points, actual_points, actual_minutes, actual_starter, source, projection_source, updated_at)
  SELECT LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE, LOWER(row_data->>'contest_type'), NULLIF(row_data->>'contest_id', ''), NULLIF(row_data->>'player_id', ''), row_data->>'player_name', NULLIF(row_data->>'team', ''), NULLIF(row_data->>'position', ''), NULLIF(row_data->>'projected_points', '')::FLOAT, NULLIF(row_data->>'actual_points', '')::FLOAT, NULLIF(row_data->>'actual_minutes', '')::FLOAT, NULLIF(row_data->>'actual_starter', '')::BOOLEAN, COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore'), COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown'), NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL AND NULLIF(row_data->>'contest_date', '') IS NOT NULL AND NULLIF(row_data->>'contest_type', '') IS NOT NULL AND NULLIF(row_data->>'player_name', '') IS NOT NULL AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
  ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name) DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id), team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team), position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position), projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points), actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points), actual_minutes = COALESCE(EXCLUDED.actual_minutes, tenant_fantasy_ai.projection_results.actual_minutes), actual_starter = COALESCE(EXCLUDED.actual_starter, tenant_fantasy_ai.projection_results.actual_starter), source = EXCLUDED.source, projection_source = EXCLUDED.projection_source, updated_at = NOW();
  GET DIAGNOSTICS row_count = ROW_COUNT; RETURN row_count;
END; $$;

REVOKE ALL ON FUNCTION public.fantasy_ai_import_wnba_contest_results(DATE, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_import_wnba_contest_results(DATE, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
