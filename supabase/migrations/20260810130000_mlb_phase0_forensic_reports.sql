-- Phase 0: retain a complete, queryable MLB forensic artifact after scoring.
-- Values are populated only when they already exist in generated_lineups or the
-- actual-results import; unavailable contest or ownership data remains NULL.

ALTER TABLE tenant_fantasy_ai.generated_lineups
  ADD COLUMN IF NOT EXISTS cash_line INT NULL;

DROP FUNCTION IF EXISTS public.fantasy_ai_record_contest_result(TEXT, DATE, TEXT, TEXT, INT, INT, NUMERIC, INT, NUMERIC, INT, INT);

CREATE FUNCTION public.fantasy_ai_record_contest_result(
  p_sport TEXT, p_contest_date DATE, p_contest_type TEXT, p_contest_id TEXT,
  p_optimizer_rank INT, p_field_size INT, p_entry_fee NUMERIC, p_finish_rank INT,
  p_payout NUMERIC, p_entry_count INT DEFAULT NULL,
  p_actual_duplicates INT DEFAULT NULL, p_cash_line INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INT;
BEGIN
  UPDATE tenant_fantasy_ai.generated_lineups lineups
  SET field_size = p_field_size, entry_fee = p_entry_fee, finish_rank = p_finish_rank,
    payout = p_payout, entry_count = COALESCE(p_entry_count, lineups.entry_count),
    actual_duplicates = COALESCE(p_actual_duplicates, lineups.actual_duplicates),
    cash_line = COALESCE(p_cash_line, lineups.cash_line)
  WHERE lineups.sport = LOWER(p_sport) AND lineups.contest_date = p_contest_date
    AND lineups.contest_type = LOWER(p_contest_type)
    AND COALESCE(lineups.contest_id, '') = COALESCE(p_contest_id, '')
    AND lineups.optimizer_rank = p_optimizer_rank
    AND (lineups.user_id IS NULL OR lineups.user_id = auth.uid());
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_record_contest_result(TEXT, DATE, TEXT, TEXT, INT, INT, NUMERIC, INT, NUMERIC, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_record_contest_result(TEXT, DATE, TEXT, TEXT, INT, INT, NUMERIC, INT, NUMERIC, INT, INT, INT) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.mlb_forensic_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES tenant_fantasy_ai.users(id) ON DELETE SET NULL,
  contest_date DATE NOT NULL,
  contest_type TEXT NOT NULL,
  contest_id TEXT NULL,
  scorecard JSONB NOT NULL DEFAULT '{}'::JSONB,
  lineups JSONB NOT NULL DEFAULT '[]'::JSONB,
  coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mlb_forensic_reports_lookup_idx
  ON tenant_fantasy_ai.mlb_forensic_reports (contest_date, contest_type, contest_id);

ALTER TABLE tenant_fantasy_ai.mlb_forensic_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mlb_forensic_reports_select ON tenant_fantasy_ai.mlb_forensic_reports;
CREATE POLICY mlb_forensic_reports_select ON tenant_fantasy_ai.mlb_forensic_reports
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

GRANT SELECT ON tenant_fantasy_ai.mlb_forensic_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.mlb_forensic_reports TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_mlb_forensic_report(p_report JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  report_id UUID;
BEGIN
  UPDATE tenant_fantasy_ai.mlb_forensic_reports
  SET scorecard = COALESCE(p_report->'scorecard', '{}'::JSONB),
    lineups = COALESCE(p_report->'lineups', '[]'::JSONB),
    coverage = COALESCE(p_report->'coverage', '{}'::JSONB),
    updated_at = NOW()
  WHERE contest_date = (p_report->>'contest_date')::DATE
    AND contest_type = LOWER(p_report->>'contest_type')
    AND COALESCE(contest_id, '') = COALESCE(NULLIF(p_report->>'contest_id', ''), '');

  IF FOUND THEN
    SELECT reports.id INTO report_id
    FROM tenant_fantasy_ai.mlb_forensic_reports reports
    WHERE reports.contest_date = (p_report->>'contest_date')::DATE
      AND reports.contest_type = LOWER(p_report->>'contest_type')
      AND COALESCE(reports.contest_id, '') = COALESCE(NULLIF(p_report->>'contest_id', ''), '')
    ORDER BY reports.updated_at DESC
    LIMIT 1;
    RETURN report_id;
  END IF;

  INSERT INTO tenant_fantasy_ai.mlb_forensic_reports (
    user_id, contest_date, contest_type, contest_id, scorecard, lineups, coverage, updated_at
  ) VALUES (
    NULLIF(p_report->>'user_id', '')::UUID,
    (p_report->>'contest_date')::DATE,
    LOWER(p_report->>'contest_type'),
    NULLIF(p_report->>'contest_id', ''),
    COALESCE(p_report->'scorecard', '{}'::JSONB),
    COALESCE(p_report->'lineups', '[]'::JSONB),
    COALESCE(p_report->'coverage', '{}'::JSONB),
    NOW()
  )
  RETURNING id INTO report_id;

  RETURN report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_mlb_forensic_report(
  p_contest_date DATE DEFAULT NULL,
  p_contest_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  contest_date DATE,
  contest_type TEXT,
  contest_id TEXT,
  scorecard JSONB,
  lineups JSONB,
  coverage JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT reports.id, reports.contest_date, reports.contest_type, reports.contest_id,
    reports.scorecard, reports.lineups, reports.coverage, reports.created_at, reports.updated_at
  FROM tenant_fantasy_ai.mlb_forensic_reports reports
  WHERE (reports.user_id IS NULL OR reports.user_id = auth.uid())
    AND (p_contest_date IS NULL OR reports.contest_date = p_contest_date)
    AND (p_contest_id IS NULL OR reports.contest_id = p_contest_id)
  ORDER BY reports.contest_date DESC, reports.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_mlb_forensic_report(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_mlb_forensic_report(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_mlb_forensic_report(DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_mlb_forensic_report(DATE, TEXT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fantasy_ai_get_unscored_lineups(TEXT, DATE);

CREATE FUNCTION public.fantasy_ai_get_unscored_lineups(
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
  field_size INT,
  entry_fee NUMERIC,
  finish_rank INT,
  payout NUMERIC,
  cash_line INT,
  actual_duplicates INT,
  expected_duplicates FLOAT,
  entry_count INT,
  config JSONB,
  players JSONB,
  projected_points FLOAT,
  salary_used INT,
  optimizer_rank INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT lineups.id, lineups.user_id, lineups.sport, lineups.contest_date,
    lineups.contest_type, lineups.contest_id, lineups.lineup_mode,
    lineups.contest_strategy, lineups.field_size, lineups.entry_fee,
    lineups.finish_rank, lineups.payout, lineups.cash_line, lineups.actual_duplicates,
    lineups.expected_duplicates, lineups.entry_count, lineups.config,
    lineups.players, lineups.projected_points, lineups.salary_used,
    lineups.optimizer_rank
  FROM tenant_fantasy_ai.generated_lineups lineups
  WHERE lineups.sport = LOWER(p_sport)
    AND lineups.contest_date <= p_before_date
    AND lineups.scored_at IS NULL
  ORDER BY lineups.contest_date, lineups.created_at;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_unscored_lineups(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_unscored_lineups(TEXT, DATE) TO service_role;
