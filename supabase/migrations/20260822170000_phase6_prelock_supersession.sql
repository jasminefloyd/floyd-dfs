-- Phase 6: final pre-lock pass metadata and safe lineup supersession.
ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_request_id UUID;

CREATE INDEX IF NOT EXISTS generated_lineups_active_slate_idx
  ON tenant_fantasy_ai.generated_lineups (sport, contest_date, contest_type)
  WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION public.fantasy_ai_mark_pios_lineups_superseded(
  p_lineup_ids UUID[],
  p_reason TEXT,
  p_replaced_by_request_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE updated_count INT;
BEGIN
  UPDATE tenant_fantasy_ai.generated_lineups
  SET superseded_at = COALESCE(superseded_at, NOW()),
      superseded_reason = COALESCE(NULLIF(p_reason, ''), superseded_reason),
      superseded_by_request_id = COALESCE(p_replaced_by_request_id, superseded_by_request_id)
  WHERE id = ANY(COALESCE(p_lineup_ids, ARRAY[]::UUID[]))
    AND superseded_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_mark_pios_lineups_superseded(UUID[], TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_mark_pios_lineups_superseded(UUID[], TEXT, UUID) TO service_role;
