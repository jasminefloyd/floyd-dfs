-- WNBA Phases 8-9: live late-swap evidence, shadow comparisons, promotion controls,
-- and operational monitoring. Promotion is intentionally evidence-gated.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_live_slate_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE SET NULL,
  contest_date DATE NOT NULL, contest_type TEXT NOT NULL, contest_id TEXT,
  player_id TEXT, player_name TEXT NOT NULL, team TEXT, game_id TEXT,
  game_state TEXT NOT NULL CHECK (game_state IN ('unlocked', 'locked', 'started', 'final', 'postponed')),
  player_state TEXT NOT NULL CHECK (player_state IN ('active', 'inactive', 'out', 'doubtful', 'questionable', 'started', 'final', 'postponed')),
  accrued_points FLOAT, source TEXT NOT NULL, source_reliability FLOAT NOT NULL CHECK (source_reliability >= 0 AND source_reliability <= 1),
  observed_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (contest_date, contest_type, contest_id, player_name, game_state, player_state, observed_at, source)
);
CREATE INDEX IF NOT EXISTS wnba_live_slate_states_scope_idx ON tenant_fantasy_ai.wnba_live_slate_states (contest_date DESC, contest_type, contest_id, observed_at DESC);
ALTER TABLE tenant_fantasy_ai.wnba_live_slate_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_live_slate_states_select ON tenant_fantasy_ai.wnba_live_slate_states;
CREATE POLICY wnba_live_slate_states_select ON tenant_fantasy_ai.wnba_live_slate_states FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_live_slate_states TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_live_slate_states TO service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_late_swap_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NULL REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  snapshot_id UUID NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE SET NULL,
  contest_date DATE NOT NULL, contest_type TEXT NOT NULL, contest_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL, decision_time TIMESTAMPTZ NOT NULL, status TEXT NOT NULL CHECK (status IN ('recommended', 'no_action', 'blocked')),
  original_lineups JSONB NOT NULL, recommended_lineups JSONB NOT NULL DEFAULT '[]'::JSONB,
  live_state JSONB NOT NULL DEFAULT '[]'::JSONB, reasons JSONB NOT NULL DEFAULT '[]'::JSONB,
  expected_effect JSONB NOT NULL DEFAULT '{}'::JSONB, config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wnba_late_swap_decisions_scope_idx ON tenant_fantasy_ai.wnba_late_swap_decisions (contest_date DESC, contest_type, contest_id, created_at DESC);
ALTER TABLE tenant_fantasy_ai.wnba_late_swap_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_late_swap_decisions_select ON tenant_fantasy_ai.wnba_late_swap_decisions;
CREATE POLICY wnba_late_swap_decisions_select ON tenant_fantasy_ai.wnba_late_swap_decisions FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());
GRANT SELECT ON tenant_fantasy_ai.wnba_late_swap_decisions TO authenticated;
GRANT INSERT ON tenant_fantasy_ai.wnba_late_swap_decisions TO service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  baseline_model_version TEXT NOT NULL, candidate_model_version TEXT NOT NULL, lock_state TEXT NOT NULL,
  baseline_config JSONB NOT NULL DEFAULT '{}'::JSONB, candidate_config JSONB NOT NULL DEFAULT '{}'::JSONB,
  baseline_result JSONB NOT NULL DEFAULT '{}'::JSONB, candidate_result JSONB NOT NULL DEFAULT '{}'::JSONB,
  comparison JSONB NOT NULL DEFAULT '{}'::JSONB, status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'blocked', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, baseline_model_version, candidate_model_version, lock_state, baseline_config, candidate_config)
);
CREATE INDEX IF NOT EXISTS wnba_shadow_runs_models_idx ON tenant_fantasy_ai.wnba_shadow_runs (candidate_model_version, created_at DESC);
ALTER TABLE tenant_fantasy_ai.wnba_shadow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_shadow_runs_select ON tenant_fantasy_ai.wnba_shadow_runs;
CREATE POLICY wnba_shadow_runs_select ON tenant_fantasy_ai.wnba_shadow_runs FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_shadow_runs TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_shadow_runs TO service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_model_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), candidate_model_version TEXT NOT NULL, baseline_model_version TEXT NOT NULL,
  training_range TEXT, evaluation_range TEXT, rollback_version TEXT NOT NULL, approval_status TEXT NOT NULL CHECK (approval_status IN ('pending_evidence', 'approved', 'rejected', 'rolled_back')),
  approval_note TEXT, evidence JSONB NOT NULL DEFAULT '{}'::JSONB, approved_by UUID NULL REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), approved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wnba_model_promotions_candidate_idx ON tenant_fantasy_ai.wnba_model_promotions (candidate_model_version, created_at DESC);
ALTER TABLE tenant_fantasy_ai.wnba_model_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_model_promotions_select ON tenant_fantasy_ai.wnba_model_promotions;
CREATE POLICY wnba_model_promotions_select ON tenant_fantasy_ai.wnba_model_promotions FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_model_promotions TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_model_promotions TO service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_key TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  contest_date DATE, contest_type TEXT, contest_id TEXT, details JSONB NOT NULL DEFAULT '{}'::JSONB,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (event_key, contest_date, contest_type, contest_id, resolved_at)
);
CREATE INDEX IF NOT EXISTS wnba_operational_events_open_idx ON tenant_fantasy_ai.wnba_operational_events (observed_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE tenant_fantasy_ai.wnba_operational_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_operational_events_select ON tenant_fantasy_ai.wnba_operational_events;
CREATE POLICY wnba_operational_events_select ON tenant_fantasy_ai.wnba_operational_events FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_operational_events TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_operational_events TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_wnba_promotion_scorecard(
  p_candidate_model_version TEXT, p_baseline_model_version TEXT, p_min_slates INT DEFAULT 20
)
RETURNS TABLE (settled_slates BIGINT, candidate_top20 FLOAT, baseline_top20 FLOAT, candidate_roi FLOAT, baseline_roi FLOAT, candidate_rank_corr FLOAT, baseline_rank_corr FLOAT, eligible_for_promotion BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH paired AS (
    SELECT candidate.snapshot_id,
      (candidate.candidate_result->'scorecard'->>'top_20_rate')::FLOAT AS candidate_top20,
      (candidate.baseline_result->'scorecard'->>'top_20_rate')::FLOAT AS baseline_top20,
      (candidate.candidate_result->'scorecard'->>'lineup_roi')::FLOAT AS candidate_roi,
      (candidate.baseline_result->'scorecard'->>'lineup_roi')::FLOAT AS baseline_roi,
      (candidate.candidate_result->'scorecard'->>'spearman_rank_correlation')::FLOAT AS candidate_rank_corr,
      (candidate.baseline_result->'scorecard'->>'spearman_rank_correlation')::FLOAT AS baseline_rank_corr
    FROM tenant_fantasy_ai.wnba_shadow_runs candidate
    WHERE candidate.candidate_model_version = p_candidate_model_version
      AND candidate.baseline_model_version = p_baseline_model_version AND candidate.status = 'completed'
  ), aggregate AS (
    SELECT COUNT(DISTINCT snapshot_id) AS settled_slates, AVG(candidate_top20) AS candidate_top20, AVG(baseline_top20) AS baseline_top20,
      AVG(candidate_roi) AS candidate_roi, AVG(baseline_roi) AS baseline_roi, AVG(candidate_rank_corr) AS candidate_rank_corr, AVG(baseline_rank_corr) AS baseline_rank_corr
    FROM paired
  ) SELECT settled_slates, candidate_top20, baseline_top20, candidate_roi, baseline_roi, candidate_rank_corr, baseline_rank_corr,
    settled_slates >= GREATEST(20, COALESCE(p_min_slates, 20))
      AND candidate_rank_corr >= baseline_rank_corr
      AND (candidate_top20 > baseline_top20 OR candidate_roi > baseline_roi)
  FROM aggregate;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_wnba_operational_status(p_max_snapshot_age_minutes INT DEFAULT 45)
RETURNS TABLE (signal TEXT, severity TEXT, details JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (contest_date, contest_type, COALESCE(contest_id, '')) contest_date, contest_type, contest_id, collected_at, manifest_data
    FROM tenant_fantasy_ai.mios_scan_snapshots WHERE sport = 'wnba'
    ORDER BY contest_date, contest_type, COALESCE(contest_id, ''), collected_at DESC
  )
  SELECT 'stale_snapshot', 'warning', jsonb_build_object('contest_date', contest_date, 'contest_type', contest_type, 'contest_id', contest_id, 'collected_at', collected_at)
  FROM latest WHERE collected_at < NOW() - make_interval(mins => GREATEST(5, COALESCE(p_max_snapshot_age_minutes, 45)))
  UNION ALL
  SELECT 'missing_ownership', 'critical', jsonb_build_object('contest_date', contest_date, 'contest_type', contest_type, 'contest_id', contest_id)
  FROM latest WHERE COALESCE(jsonb_array_length(manifest_data->'player_roster'), 0) > 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(manifest_data->'player_roster') player WHERE player ? 'ownership_projection')
  UNION ALL
  SELECT 'unsettled_generated_lineups', 'warning', jsonb_build_object('count', COUNT(*))
  FROM tenant_fantasy_ai.generated_lineups WHERE sport = 'wnba' AND contest_date < CURRENT_DATE AND result_status IN ('pending', 'partial')
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_wnba_promotion_scorecard(TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_wnba_operational_status(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_wnba_promotion_scorecard(TEXT, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_wnba_operational_status(INT) TO authenticated, service_role;
