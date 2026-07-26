CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.generated_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT NULL,
  lineup_mode TEXT NOT NULL,
  contest_strategy TEXT NOT NULL,
  players JSONB NOT NULL,
  projected_points FLOAT NOT NULL DEFAULT 0,
  salary_used INT NOT NULL DEFAULT 0,
  optimizer_rank INT NOT NULL DEFAULT 0,
  actual_points FLOAT NULL,
  optimal_points FLOAT NULL,
  pct_of_optimal FLOAT NULL,
  scored_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generated_lineups_slate_idx
  ON tenant_fantasy_ai.generated_lineups (sport, contest_date, contest_type);

CREATE INDEX IF NOT EXISTS generated_lineups_unscored_idx
  ON tenant_fantasy_ai.generated_lineups (sport, contest_date)
  WHERE scored_at IS NULL;

CREATE INDEX IF NOT EXISTS generated_lineups_user_idx
  ON tenant_fantasy_ai.generated_lineups (user_id, created_at DESC);

ALTER TABLE tenant_fantasy_ai.generated_lineups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_lineups_select_own ON tenant_fantasy_ai.generated_lineups;
CREATE POLICY generated_lineups_select_own ON tenant_fantasy_ai.generated_lineups
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

GRANT SELECT ON tenant_fantasy_ai.generated_lineups TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.generated_lineups TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_generated_lineups(
  p_rows JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.generated_lineups (
    user_id,
    sport,
    contest_date,
    contest_type,
    contest_id,
    lineup_mode,
    contest_strategy,
    players,
    projected_points,
    salary_used,
    optimizer_rank
  )
  SELECT
    CASE WHEN NULLIF(row_data->>'user_id', '') IS NOT NULL THEN (row_data->>'user_id')::UUID ELSE NULL END,
    LOWER(row_data->>'sport'),
    (row_data->>'contest_date')::DATE,
    LOWER(row_data->>'contest_type'),
    NULLIF(row_data->>'contest_id', ''),
    COALESCE(NULLIF(row_data->>'lineup_mode', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'contest_strategy', ''), 'unknown'),
    COALESCE(row_data->'players', '[]'::JSONB),
    CASE WHEN NULLIF(row_data->>'projected_points', '') IS NOT NULL THEN (row_data->>'projected_points')::FLOAT ELSE 0 END,
    CASE WHEN NULLIF(row_data->>'salary_used', '') IS NOT NULL THEN (row_data->>'salary_used')::INT ELSE 0 END,
    CASE WHEN NULLIF(row_data->>'optimizer_rank', '') IS NOT NULL THEN (row_data->>'optimizer_rank')::INT ELSE 0 END
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND jsonb_typeof(COALESCE(row_data->'players', '[]'::JSONB)) = 'array';

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_unscored_lineups(
  p_sport TEXT,
  p_before_date DATE
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  sport VARCHAR(10),
  contest_date DATE,
  contest_type TEXT,
  contest_id TEXT,
  lineup_mode TEXT,
  contest_strategy TEXT,
  players JSONB,
  projected_points FLOAT,
  salary_used INT,
  optimizer_rank INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    lineups.id,
    lineups.user_id,
    lineups.sport,
    lineups.contest_date,
    lineups.contest_type,
    lineups.contest_id,
    lineups.lineup_mode,
    lineups.contest_strategy,
    lineups.players,
    lineups.projected_points,
    lineups.salary_used,
    lineups.optimizer_rank
  FROM tenant_fantasy_ai.generated_lineups lineups
  WHERE lineups.sport = LOWER(p_sport)
    AND lineups.contest_date <= p_before_date
    AND lineups.scored_at IS NULL
  ORDER BY lineups.contest_date, lineups.created_at;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_score_generated_lineup(
  p_id UUID,
  p_actual FLOAT,
  p_optimal FLOAT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  UPDATE tenant_fantasy_ai.generated_lineups
  SET
    actual_points = p_actual,
    optimal_points = p_optimal,
    pct_of_optimal = CASE WHEN p_optimal > 0 THEN p_actual / p_optimal ELSE NULL END,
    scored_at = NOW()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_lineup_scoreboard(
  p_sport TEXT,
  p_days INT
)
RETURNS TABLE (
  sport VARCHAR(10),
  contest_date DATE,
  contest_type TEXT,
  contest_id TEXT,
  lineup_count BIGINT,
  best_actual FLOAT,
  best_projected FLOAT,
  optimal_points FLOAT,
  best_pct_of_optimal FLOAT,
  avg_pct_of_optimal FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH recent AS (
    SELECT *
    FROM tenant_fantasy_ai.generated_lineups lineups
    WHERE lineups.scored_at IS NOT NULL
      AND (p_sport IS NULL OR p_sport = '' OR lineups.sport = LOWER(p_sport))
      AND lineups.contest_date >= CURRENT_DATE - GREATEST(COALESCE(p_days, 30), 1)
  ),
  ranked AS (
    SELECT
      recent.*,
      ROW_NUMBER() OVER (
        PARTITION BY recent.sport, recent.contest_date, recent.contest_type, COALESCE(recent.contest_id, '')
        ORDER BY recent.actual_points DESC NULLS LAST
      ) AS actual_rank
    FROM recent
  )
  SELECT
    ranked.sport,
    ranked.contest_date,
    ranked.contest_type,
    ranked.contest_id,
    COUNT(*)::BIGINT AS lineup_count,
    MAX(ranked.actual_points)::FLOAT AS best_actual,
    MAX(ranked.projected_points) FILTER (WHERE ranked.actual_rank = 1)::FLOAT AS best_projected,
    MAX(ranked.optimal_points)::FLOAT AS optimal_points,
    MAX(ranked.pct_of_optimal) FILTER (WHERE ranked.actual_rank = 1)::FLOAT AS best_pct_of_optimal,
    AVG(ranked.pct_of_optimal)::FLOAT AS avg_pct_of_optimal
  FROM ranked
  GROUP BY ranked.sport, ranked.contest_date, ranked.contest_type, ranked.contest_id
  ORDER BY ranked.contest_date DESC, ranked.sport, ranked.contest_type
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_insert_generated_lineups(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_unscored_lineups(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_score_generated_lineup(UUID, FLOAT, FLOAT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_lineup_scoreboard(TEXT, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_generated_lineups(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_unscored_lineups(TEXT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_score_generated_lineup(UUID, FLOAT, FLOAT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_lineup_scoreboard(TEXT, INT) TO authenticated, service_role;
