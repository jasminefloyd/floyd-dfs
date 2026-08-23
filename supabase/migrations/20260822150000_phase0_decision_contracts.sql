-- Phase 0 shared decision-contract persistence. Existing snapshot and lineup
-- RPCs remain compatible; this migration adds explicit audit columns and a
-- narrow metadata update RPC for the richer dossier contract.

ALTER TABLE tenant_fantasy_ai.mios_scan_snapshots
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS dossier_version TEXT NOT NULL DEFAULT 'dossier-v1',
  ADD COLUMN IF NOT EXISTS freshness_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_gaps JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS confidence_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS observability JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS mios_scan_snapshots_request_idx
  ON tenant_fantasy_ai.mios_scan_snapshots (request_id);

ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS dossier_version TEXT,
  ADD COLUMN IF NOT EXISTS script_key TEXT,
  ADD COLUMN IF NOT EXISTS model_version TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_decision JSONB;

CREATE INDEX IF NOT EXISTS generated_lineups_dossier_idx
  ON tenant_fantasy_ai.generated_lineups (scan_snapshot_id, dossier_version);

CREATE OR REPLACE FUNCTION public.fantasy_ai_update_mios_snapshot_phase0(
  p_snapshot_id UUID,
  p_request_id UUID,
  p_dossier_version TEXT,
  p_freshness_deadline TIMESTAMPTZ,
  p_data_gaps JSONB,
  p_confidence_summary JSONB,
  p_observability JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
BEGIN
  UPDATE tenant_fantasy_ai.mios_scan_snapshots
  SET request_id = p_request_id,
      dossier_version = COALESCE(NULLIF(p_dossier_version, ''), dossier_version),
      freshness_deadline = p_freshness_deadline,
      data_gaps = COALESCE(p_data_gaps, '[]'::JSONB),
      confidence_summary = COALESCE(p_confidence_summary, '{}'::JSONB),
      observability = COALESCE(p_observability, '{}'::JSONB)
  WHERE id = p_snapshot_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_update_mios_snapshot_phase0(UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_update_mios_snapshot_phase0(UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_previous_mios_dossier(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id TEXT DEFAULT ''
)
RETURNS TABLE (dossier JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT snapshots.manifest_data->'dossier'
  FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
  WHERE snapshots.sport = LOWER(p_sport)
    AND snapshots.contest_date = p_contest_date
    AND snapshots.contest_type = LOWER(p_contest_type)
    AND COALESCE(snapshots.contest_id, '') = COALESCE(p_contest_id, '')
    AND snapshots.manifest_data ? 'dossier'
  ORDER BY snapshots.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_previous_mios_dossier(TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_previous_mios_dossier(TEXT, DATE, TEXT, TEXT) TO service_role;

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
    salary_used, optimizer_rank, scan_snapshot_id, generation_request_id,
    generated_at, dossier_version, script_key, model_version, portfolio_decision
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
    COALESCE(NULLIF(row_data->>'generated_at', '')::TIMESTAMPTZ, NOW()),
    NULLIF(row_data->>'dossier_version', ''), NULLIF(row_data->>'script_key', ''),
    NULLIF(row_data->>'model_version', ''), row_data->'portfolio_decision'
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND jsonb_typeof(COALESCE(row_data->'players', '[]'::JSONB)) = 'array';
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
