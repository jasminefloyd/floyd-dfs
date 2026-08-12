-- Phase 6: retain the payout used by the contest objective alongside the gross value.

ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS duplicate_adjusted_expected_payout FLOAT NULL;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_generated_lineups(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.generated_lineups (
    user_id, sport, contest_date, contest_type, contest_id, lineup_mode,
    contest_strategy, field_size, entry_fee, max_entries_per_user, entry_count,
    expected_duplicates, duplicate_adjusted_expected_payout, weights_version,
    payout_shape, ownership_weight, config, players, projected_points,
    salary_used, optimizer_rank, scan_snapshot_id, generation_request_id, generated_at
  )
  SELECT
    CASE WHEN NULLIF(row_data->>'user_id', '') IS NOT NULL THEN (row_data->>'user_id')::UUID ELSE NULL END,
    LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE,
    LOWER(row_data->>'contest_type'), NULLIF(row_data->>'contest_id', ''),
    COALESCE(NULLIF(row_data->>'lineup_mode', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'contest_strategy', ''), 'unknown'),
    NULLIF(row_data->>'field_size', '')::INT, NULLIF(row_data->>'entry_fee', '')::NUMERIC,
    NULLIF(row_data->>'max_entries_per_user', '')::INT, NULLIF(row_data->>'entry_count', '')::INT,
    NULLIF(row_data->>'expected_duplicates', '')::FLOAT,
    NULLIF(row_data->>'duplicate_adjusted_expected_payout', '')::FLOAT,
    NULLIF(row_data->>'weights_version', ''), NULLIF(row_data->>'payout_shape', ''),
    NULLIF(row_data->>'ownership_weight', '')::FLOAT, row_data->'config',
    COALESCE(row_data->'players', '[]'::JSONB),
    COALESCE(NULLIF(row_data->>'projected_points', '')::FLOAT, 0),
    COALESCE(NULLIF(row_data->>'salary_used', '')::INT, 0),
    COALESCE(NULLIF(row_data->>'optimizer_rank', '')::INT, 0),
    NULLIF(row_data->>'scan_snapshot_id', '')::UUID,
    NULLIF(row_data->>'generation_request_id', '')::UUID,
    COALESCE(NULLIF(row_data->>'generated_at', '')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND jsonb_typeof(COALESCE(row_data->'players', '[]'::JSONB)) = 'array';
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
