-- Controlled historical WNBA result backfill. The function exposes only an
-- immutable snapshot; the Edge Function maps it to official ESPN box scores.
CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_backfill_snapshot(p_snapshot_id UUID)
RETURNS TABLE (id UUID, contest_date DATE, contest_type VARCHAR(20), contest_id TEXT, manifest_data JSONB)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT id, contest_date, contest_type, contest_id, manifest_data
  FROM tenant_fantasy_ai.mios_scan_snapshots
  WHERE id = p_snapshot_id AND sport = 'wnba';
$$;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_backfill_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_backfill_snapshot(UUID) TO service_role;
