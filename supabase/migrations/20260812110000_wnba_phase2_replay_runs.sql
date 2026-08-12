-- WNBA Phase 2: immutable-snapshot replay runs and baseline scorecards.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.wnba_replay_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE RESTRICT,
  model_version TEXT NOT NULL,
  lock_state TEXT NOT NULL CHECK (lock_state IN ('pre_lock', 'post_confirmed_lineup', 'late_swap')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  simulation_seed BIGINT NOT NULL,
  scorecard JSONB NOT NULL DEFAULT '{}'::JSONB,
  lineups JSONB NOT NULL DEFAULT '[]'::JSONB,
  player_sample_size INT NOT NULL DEFAULT 0,
  lineup_sample_size INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_id, model_version, lock_state, simulation_seed, config)
);

CREATE INDEX IF NOT EXISTS wnba_replay_runs_snapshot_idx
  ON tenant_fantasy_ai.wnba_replay_runs (snapshot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wnba_replay_runs_model_idx
  ON tenant_fantasy_ai.wnba_replay_runs (model_version, created_at DESC);

ALTER TABLE tenant_fantasy_ai.wnba_replay_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wnba_replay_runs_select ON tenant_fantasy_ai.wnba_replay_runs;
CREATE POLICY wnba_replay_runs_select ON tenant_fantasy_ai.wnba_replay_runs
  FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.wnba_replay_runs TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.wnba_replay_runs TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_replay_snapshot(p_snapshot_id UUID)
RETURNS TABLE (
  id UUID, manifest_id UUID, sport VARCHAR(10), contest_type VARCHAR(20),
  contest_date DATE, contest_id TEXT, game_id TEXT, model_version TEXT,
  collected_at TIMESTAMPTZ, manifest_data JSONB, provenance JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT snapshots.id, snapshots.manifest_id, snapshots.sport, snapshots.contest_type,
    snapshots.contest_date, snapshots.contest_id, snapshots.game_id, snapshots.model_version,
    snapshots.collected_at, snapshots.manifest_data,
    COALESCE(jsonb_agg(jsonb_build_object('observed_at', provenance.observed_at))
      FILTER (WHERE provenance.id IS NOT NULL), '[]'::JSONB) AS provenance
  FROM tenant_fantasy_ai.mios_scan_snapshots snapshots
  LEFT JOIN tenant_fantasy_ai.mios_player_provenance provenance ON provenance.snapshot_id = snapshots.id
  WHERE snapshots.id = p_snapshot_id AND snapshots.sport = 'wnba'
  GROUP BY snapshots.id;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_replay_actuals(
  p_contest_date DATE, p_contest_type TEXT, p_contest_id TEXT DEFAULT NULL
)
RETURNS TABLE (player_name TEXT, team TEXT, actual_points FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT results.player_name, results.team, results.actual_points
  FROM tenant_fantasy_ai.projection_results results
  WHERE results.sport = 'wnba'
    AND results.contest_date = p_contest_date
    AND LOWER(results.contest_type) = LOWER(p_contest_type)
    AND results.actual_points IS NOT NULL
    AND (p_contest_id IS NULL OR results.contest_id IS NULL OR results.contest_id::TEXT = p_contest_id);
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_wnba_replay_run(
  p_snapshot_id UUID, p_model_version TEXT, p_lock_state TEXT, p_config JSONB,
  p_seed BIGINT, p_scorecard JSONB, p_lineups JSONB,
  p_player_sample_size INT, p_lineup_sample_size INT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE run_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_fantasy_ai.mios_scan_snapshots
    WHERE id = p_snapshot_id AND sport = 'wnba'
  ) THEN RAISE EXCEPTION 'WNBA snapshot % does not exist', p_snapshot_id; END IF;
  INSERT INTO tenant_fantasy_ai.wnba_replay_runs (
    snapshot_id, model_version, lock_state, config, simulation_seed, scorecard,
    lineups, player_sample_size, lineup_sample_size
  ) VALUES (
    p_snapshot_id, COALESCE(NULLIF(p_model_version, ''), 'unknown'),
    CASE WHEN p_lock_state IN ('pre_lock', 'post_confirmed_lineup', 'late_swap') THEN p_lock_state ELSE 'pre_lock' END,
    COALESCE(p_config, '{}'::JSONB), p_seed, COALESCE(p_scorecard, '{}'::JSONB),
    COALESCE(p_lineups, '[]'::JSONB), COALESCE(p_player_sample_size, 0), COALESCE(p_lineup_sample_size, 0)
  ) ON CONFLICT (snapshot_id, model_version, lock_state, simulation_seed, config) DO UPDATE SET
    scorecard = EXCLUDED.scorecard, lineups = EXCLUDED.lineups,
    player_sample_size = EXCLUDED.player_sample_size, lineup_sample_size = EXCLUDED.lineup_sample_size
  RETURNING id INTO run_id;
  RETURN run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_replay_baseline(
  p_model_version TEXT DEFAULT NULL
)
RETURNS TABLE (
  model_version TEXT, lock_state TEXT, replay_count BIGINT, player_sample_size BIGINT,
  lineup_sample_size BIGINT, player_mae FLOAT, player_mean_error FLOAT,
  player_rank_correlation FLOAT, lineup_mae FLOAT, lineup_roi FLOAT, lineup_hit_rate FLOAT,
  duplication_rate FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT runs.model_version, runs.lock_state, COUNT(*) AS replay_count,
    SUM(runs.player_sample_size)::BIGINT, SUM(runs.lineup_sample_size)::BIGINT,
    AVG((runs.scorecard->>'mean_absolute_error')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'mean_error')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'spearman_rank_correlation')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'lineup_mean_absolute_error')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'lineup_roi')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'lineup_hit_rate')::FLOAT)::FLOAT,
    AVG((runs.scorecard->>'duplication_rate')::FLOAT)::FLOAT
  FROM tenant_fantasy_ai.wnba_replay_runs runs
  WHERE p_model_version IS NULL OR runs.model_version = p_model_version
  GROUP BY runs.model_version, runs.lock_state
  ORDER BY runs.model_version, runs.lock_state;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_replay_snapshot(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_replay_actuals(DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_insert_wnba_replay_run(UUID, TEXT, TEXT, JSONB, BIGINT, JSONB, JSONB, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_replay_baseline(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_replay_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_replay_actuals(DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_wnba_replay_run(UUID, TEXT, TEXT, JSONB, BIGINT, JSONB, JSONB, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_replay_baseline(TEXT) TO authenticated, service_role;
