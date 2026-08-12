-- WNBA Phases 6-7: observed ownership, calibrated-field telemetry, and objective evidence.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_observed_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contest_date DATE NOT NULL, contest_type TEXT NOT NULL, contest_id TEXT,
  player_id TEXT, player_name TEXT NOT NULL, roster_slot TEXT NOT NULL DEFAULT 'FLEX', ownership_pct FLOAT NOT NULL CHECK (ownership_pct >= 0 AND ownership_pct <= 100),
  field_size INT, entry_limit INT, payout_shape TEXT, lock_time TIMESTAMPTZ, source TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (contest_date, contest_type, contest_id, player_name, roster_slot, source)
);
CREATE INDEX IF NOT EXISTS wnba_observed_ownership_scope_idx ON tenant_fantasy_ai.wnba_observed_ownership (contest_date DESC, contest_type, contest_id);
ALTER TABLE tenant_fantasy_ai.wnba_observed_ownership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_observed_ownership_select ON tenant_fantasy_ai.wnba_observed_ownership;
CREATE POLICY wnba_observed_ownership_select ON tenant_fantasy_ai.wnba_observed_ownership FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_observed_ownership TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_observed_ownership TO service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_field_model_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  model_version TEXT NOT NULL, field_size INT NOT NULL, simulation_seed BIGINT NOT NULL, telemetry JSONB NOT NULL DEFAULT '{}'::JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, model_version, simulation_seed)
);
ALTER TABLE tenant_fantasy_ai.wnba_field_model_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_field_model_evaluations_select ON tenant_fantasy_ai.wnba_field_model_evaluations;
CREATE POLICY wnba_field_model_evaluations_select ON tenant_fantasy_ai.wnba_field_model_evaluations FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_field_model_evaluations TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_field_model_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_wnba_ownership_scorecard(p_min_sample INT DEFAULT 30)
RETURNS TABLE (bucket TEXT, sample_size BIGINT, mae FLOAT, rank_correlation FLOAT, high_owned_mae FLOAT, eligible_for_promotion BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH matched AS (
    SELECT observed.*, projections.ownership_pct AS predicted
    FROM tenant_fantasy_ai.wnba_observed_ownership observed
    JOIN tenant_fantasy_ai.ownership_projections projections ON projections.sport = 'wnba' AND projections.contest_date = observed.contest_date
      AND regexp_replace(lower(projections.player_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(observed.player_name), '[^a-z0-9]', '', 'g')
    WHERE projections.ownership_pct IS NOT NULL
  ), bucketed AS (SELECT 'overall'::TEXT AS bucket, * FROM matched UNION ALL SELECT 'contest_type:' || contest_type, * FROM matched)
  SELECT bucket, COUNT(*), AVG(ABS(predicted - ownership_pct))::FLOAT,
    CORR(predicted, ownership_pct)::FLOAT, AVG(ABS(predicted - ownership_pct)) FILTER (WHERE ownership_pct >= 20)::FLOAT,
    COUNT(*) >= GREATEST(30, COALESCE(p_min_sample, 30))
  FROM bucketed GROUP BY bucket;
$$;
REVOKE ALL ON FUNCTION public.fantasy_ai_wnba_ownership_scorecard(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_wnba_ownership_scorecard(INT) TO authenticated, service_role;
