-- Outcome-driven PIOS ranking profile. This is intentionally separate from
-- projection calibration: projection bias correction cannot tell us whether
-- ceiling, leverage, stacks, or floor are producing better tournament results.
CREATE OR REPLACE FUNCTION public.fantasy_ai_get_pios_adaptive_profile(
  p_sport TEXT,
  p_contest_type TEXT DEFAULT NULL,
  p_days INT DEFAULT 45
)
RETURNS TABLE (
  sport TEXT,
  contest_type TEXT,
  sample_size BIGINT,
  projected_correlation FLOAT,
  simulation_ev_correlation FLOAT,
  ceiling_correlation FLOAT,
  floor_correlation FLOAT,
  win_rate_correlation FLOAT,
  leverage_correlation FLOAT,
  stack_quality_correlation FLOAT,
  context_edge_correlation FLOAT,
  confidence_correlation FLOAT,
  rank_score_correlation FLOAT,
  ready BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH scored AS (
    SELECT
      lineups.sport::TEXT,
      lineups.contest_type::TEXT,
      COALESCE(
        CASE
          WHEN lineups.finish_rank IS NOT NULL AND lineups.field_size IS NOT NULL AND lineups.field_size > 1
            THEN 1 - ((lineups.finish_rank - 1)::FLOAT / (lineups.field_size - 1))
          ELSE NULL
        END,
        CASE WHEN lineups.optimal_points > 0 THEN lineups.actual_points / lineups.optimal_points ELSE NULL END,
        lineups.actual_points
      )::FLOAT AS outcome,
      NULLIF(lineups.config->'rankFeatures'->>'projected', '')::FLOAT AS projected,
      NULLIF(lineups.config->'rankFeatures'->>'simulationEv', '')::FLOAT AS simulation_ev,
      NULLIF(lineups.config->'rankFeatures'->>'ceiling', '')::FLOAT AS ceiling,
      NULLIF(lineups.config->'rankFeatures'->>'floor', '')::FLOAT AS floor,
      NULLIF(lineups.config->'rankFeatures'->>'winRate', '')::FLOAT AS win_rate,
      NULLIF(lineups.config->'rankFeatures'->>'leverage', '')::FLOAT AS leverage,
      NULLIF(lineups.config->'rankFeatures'->>'stackQuality', '')::FLOAT AS stack_quality,
      NULLIF(lineups.config->'rankFeatures'->>'contextEdge', '')::FLOAT AS context_edge,
      NULLIF(lineups.config->'rankFeatures'->>'confidence', '')::FLOAT AS confidence,
      NULLIF(lineups.config->'rankFeatures'->>'rankScore', '')::FLOAT AS rank_score
    FROM tenant_fantasy_ai.generated_lineups lineups
    WHERE lineups.sport = LOWER(p_sport)
      AND (p_contest_type IS NULL OR p_contest_type = '' OR lineups.contest_type = LOWER(p_contest_type))
      AND lineups.actual_points IS NOT NULL
      AND lineups.scored_at IS NOT NULL
      AND lineups.created_at >= NOW() - (GREATEST(COALESCE(p_days, 45), 1) || ' days')::INTERVAL
  ), usable AS (
    SELECT * FROM scored WHERE outcome IS NOT NULL AND projected IS NOT NULL
  )
  SELECT
    LOWER(p_sport), COALESCE(NULLIF(LOWER(p_contest_type), ''), 'all'), COUNT(*)::BIGINT,
    CORR(outcome, projected)::FLOAT, CORR(outcome, simulation_ev)::FLOAT,
    CORR(outcome, ceiling)::FLOAT, CORR(outcome, floor)::FLOAT,
    CORR(outcome, win_rate)::FLOAT, CORR(outcome, leverage)::FLOAT,
    CORR(outcome, stack_quality)::FLOAT, CORR(outcome, context_edge)::FLOAT,
    CORR(outcome, confidence)::FLOAT, CORR(outcome, rank_score)::FLOAT,
    COUNT(*) >= 30
  FROM usable;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_pios_adaptive_profile(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_pios_adaptive_profile(TEXT, TEXT, INT) TO service_role, authenticated;
