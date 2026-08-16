-- Batch contest-result capture for every sport. The generated lineup UUID is
-- the only safe join key; optimizer rank alone is not stable across requests.
CREATE OR REPLACE FUNCTION public.fantasy_ai_import_contest_results(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INT;
BEGIN
  UPDATE tenant_fantasy_ai.generated_lineups lineups
  SET field_size = NULLIF(row_data->>'field_size', '')::INT,
      entry_fee = NULLIF(row_data->>'entry_fee', '')::NUMERIC,
      finish_rank = NULLIF(row_data->>'finish_rank', '')::INT,
      payout = NULLIF(row_data->>'payout', '')::NUMERIC,
      entry_count = COALESCE(NULLIF(row_data->>'entry_count', '')::INT, lineups.entry_count),
      actual_duplicates = COALESCE(NULLIF(row_data->>'actual_duplicates', '')::INT, lineups.actual_duplicates),
      cash_line = COALESCE(NULLIF(row_data->>'cash_line', '')::INT, lineups.cash_line)
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE lineups.id = NULLIF(row_data->>'generated_lineup_id', '')::UUID
    AND lineups.sport = LOWER(NULLIF(row_data->>'sport', ''))
    AND lineups.contest_type = LOWER(NULLIF(row_data->>'contest_type', ''))
    AND lineups.contest_date = NULLIF(row_data->>'contest_date', '')::DATE;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_import_contest_results(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_import_contest_results(JSONB) TO service_role;
