-- Phase 9: replay gets settled contest metrics only when an authorized result
-- import has supplied them. Missing data deliberately remains NULL.

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_wnba_replay_contest_result(
  p_contest_date DATE, p_contest_type TEXT, p_contest_id TEXT DEFAULT NULL
)
RETURNS TABLE (top_20_cutoff FLOAT, entry_fee FLOAT, payout FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  SELECT
    MIN(lineups.actual_points) FILTER (WHERE lineups.finish_rank BETWEEN 1 AND 20)::FLOAT AS top_20_cutoff,
    AVG(lineups.entry_fee)::FLOAT AS entry_fee,
    AVG(lineups.payout)::FLOAT AS payout
  FROM tenant_fantasy_ai.generated_lineups lineups
  WHERE lineups.sport = 'wnba'
    AND lineups.contest_date = p_contest_date
    AND LOWER(lineups.contest_type) = LOWER(p_contest_type)
    AND (p_contest_id IS NULL OR lineups.contest_id IS NULL OR lineups.contest_id = p_contest_id);
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_wnba_replay_contest_result(DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_wnba_replay_contest_result(DATE, TEXT, TEXT) TO service_role;
