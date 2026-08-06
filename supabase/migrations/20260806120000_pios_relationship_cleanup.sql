-- Derived (source = 'derived_from_slate_context') relationships are cheap to lose --
-- they regenerate automatically the next time the same two players share a slate.
-- historical_pair_data rows represent real, earned history (20+ paired real results)
-- and must never be pruned by age, so this only ever targets the derived rows.

CREATE OR REPLACE FUNCTION public.fantasy_ai_cleanup_stale_pios_relationships(
  p_days INT DEFAULT 10
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  DELETE FROM tenant_fantasy_ai.pios_relationships
  WHERE source = 'derived_from_slate_context'
    AND updated_at < NOW() - (GREATEST(COALESCE(p_days, 10), 1) || ' days')::INTERVAL;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_cleanup_stale_pios_relationships(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_cleanup_stale_pios_relationships(INT) TO service_role;
