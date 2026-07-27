ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS field_size INT NULL,
  ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS max_entries_per_user INT NULL,
  ADD COLUMN IF NOT EXISTS finish_rank INT NULL,
  ADD COLUMN IF NOT EXISTS payout NUMERIC(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS entry_count INT NULL,
  ADD COLUMN IF NOT EXISTS expected_duplicates FLOAT NULL,
  ADD COLUMN IF NOT EXISTS actual_duplicates INT NULL,
  ADD COLUMN IF NOT EXISTS weights_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS payout_shape TEXT NULL,
  ADD COLUMN IF NOT EXISTS ownership_weight FLOAT NULL,
  ADD COLUMN IF NOT EXISTS config JSONB NULL;

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
    field_size,
    entry_fee,
    max_entries_per_user,
    entry_count,
    expected_duplicates,
    weights_version,
    payout_shape,
    ownership_weight,
    config,
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
    CASE WHEN NULLIF(row_data->>'field_size', '') IS NOT NULL THEN (row_data->>'field_size')::INT ELSE NULL END,
    CASE WHEN NULLIF(row_data->>'entry_fee', '') IS NOT NULL THEN (row_data->>'entry_fee')::NUMERIC ELSE NULL END,
    CASE WHEN NULLIF(row_data->>'max_entries_per_user', '') IS NOT NULL THEN (row_data->>'max_entries_per_user')::INT ELSE NULL END,
    CASE WHEN NULLIF(row_data->>'entry_count', '') IS NOT NULL THEN (row_data->>'entry_count')::INT ELSE NULL END,
    CASE WHEN NULLIF(row_data->>'expected_duplicates', '') IS NOT NULL THEN (row_data->>'expected_duplicates')::FLOAT ELSE NULL END,
    NULLIF(row_data->>'weights_version', ''),
    NULLIF(row_data->>'payout_shape', ''),
    CASE WHEN NULLIF(row_data->>'ownership_weight', '') IS NOT NULL THEN (row_data->>'ownership_weight')::FLOAT ELSE NULL END,
    row_data->'config',
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

CREATE OR REPLACE FUNCTION public.fantasy_ai_record_contest_result(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT,
  p_contest_id TEXT,
  p_optimizer_rank INT,
  p_field_size INT,
  p_entry_fee NUMERIC,
  p_finish_rank INT,
  p_payout NUMERIC,
  p_entry_count INT DEFAULT NULL,
  p_actual_duplicates INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  UPDATE tenant_fantasy_ai.generated_lineups lineups
  SET
    field_size = p_field_size,
    entry_fee = p_entry_fee,
    finish_rank = p_finish_rank,
    payout = p_payout,
    entry_count = COALESCE(p_entry_count, lineups.entry_count),
    actual_duplicates = COALESCE(p_actual_duplicates, lineups.actual_duplicates)
  WHERE lineups.sport = LOWER(p_sport)
    AND lineups.contest_date = p_contest_date
    AND lineups.contest_type = LOWER(p_contest_type)
    AND COALESCE(lineups.contest_id, '') = COALESCE(p_contest_id, '')
    AND lineups.optimizer_rank = p_optimizer_rank
    AND (lineups.user_id IS NULL OR lineups.user_id = auth.uid());

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
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
  avg_pct_of_optimal FLOAT,
  total_entry_fees FLOAT,
  total_payout FLOAT,
  roi FLOAT,
  best_finish_percentile FLOAT,
  median_finish_percentile FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  WITH recent AS (
    SELECT *
    FROM tenant_fantasy_ai.generated_lineups lineups
    WHERE (
        lineups.scored_at IS NOT NULL
        OR lineups.finish_rank IS NOT NULL
        OR lineups.payout IS NOT NULL
      )
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
    AVG(ranked.pct_of_optimal)::FLOAT AS avg_pct_of_optimal,
    SUM(COALESCE(ranked.entry_fee, 0))::FLOAT AS total_entry_fees,
    SUM(COALESCE(ranked.payout, 0))::FLOAT AS total_payout,
    CASE
      WHEN SUM(COALESCE(ranked.entry_fee, 0)) > 0
      THEN ((SUM(COALESCE(ranked.payout, 0)) - SUM(COALESCE(ranked.entry_fee, 0))) / SUM(COALESCE(ranked.entry_fee, 0)))::FLOAT
      ELSE NULL
    END AS roi,
    MIN(
      CASE
        WHEN ranked.field_size IS NOT NULL AND ranked.field_size > 1 AND ranked.finish_rank IS NOT NULL
        THEN ((ranked.finish_rank - 1)::FLOAT / (ranked.field_size - 1))
        ELSE NULL
      END
    )::FLOAT AS best_finish_percentile,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY CASE
        WHEN ranked.field_size IS NOT NULL AND ranked.field_size > 1 AND ranked.finish_rank IS NOT NULL
        THEN ((ranked.finish_rank - 1)::FLOAT / (ranked.field_size - 1))
        ELSE NULL
      END
    )::FLOAT AS median_finish_percentile
  FROM ranked
  GROUP BY ranked.sport, ranked.contest_date, ranked.contest_type, ranked.contest_id
  ORDER BY ranked.contest_date DESC, ranked.sport, ranked.contest_type
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_record_contest_result(TEXT, DATE, TEXT, TEXT, INT, INT, NUMERIC, INT, NUMERIC, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_record_contest_result(TEXT, DATE, TEXT, TEXT, INT, INT, NUMERIC, INT, NUMERIC, INT, INT) TO authenticated, service_role;
