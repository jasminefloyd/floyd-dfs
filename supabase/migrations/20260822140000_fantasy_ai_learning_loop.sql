-- Full learning loop: durable diagnostics, validated rules, and report artifacts.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.lineup_learning_diagnostics (
  diagnostic_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_lineup_id UUID NOT NULL REFERENCES tenant_fantasy_ai.generated_lineups(id) ON DELETE CASCADE,
  snapshot_id UUID NULL REFERENCES tenant_fantasy_ai.mios_scan_snapshots(id) ON DELETE SET NULL,
  sport TEXT NOT NULL,
  contest_date DATE NOT NULL,
  lineup_mode TEXT,
  contest_strategy TEXT,
  projected_points DOUBLE PRECISION,
  actual_points DOUBLE PRECISION,
  optimal_points DOUBLE PRECISION,
  projection_error DOUBLE PRECISION,
  absolute_error DOUBLE PRECISION,
  pct_of_optimal DOUBLE PRECISION,
  finish_rank INTEGER,
  field_size INTEGER,
  payout NUMERIC(10, 2),
  cash_result TEXT NOT NULL DEFAULT 'unknown'
    CHECK (cash_result IN ('cashed', 'missed', 'unknown')),
  outcome_class TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (outcome_class IN ('strong', 'acceptable', 'miss', 'variance', 'unresolved')),
  failure_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  diagnosed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generated_lineup_id)
);

CREATE INDEX IF NOT EXISTS lineup_learning_diagnostics_scope_idx
  ON tenant_fantasy_ai.lineup_learning_diagnostics (sport, contest_date DESC, outcome_class);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.learning_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL,
  sport TEXT,
  rule_type TEXT NOT NULL
    CHECK (rule_type IN ('projection', 'strategy', 'context', 'source', 'data_quality', 'risk')),
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'retired')),
  rule_statement TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  support_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (support_score >= -1 AND support_score <= 1),
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_key, sport)
);

CREATE INDEX IF NOT EXISTS learning_rules_active_idx
  ON tenant_fantasy_ai.learning_rules (sport, status, confidence_score DESC);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.intelligence_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_kind TEXT NOT NULL CHECK (report_kind IN ('daily', 'weekly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  report_title TEXT NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  report_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emailed_at TIMESTAMPTZ,
  UNIQUE (report_kind, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS intelligence_reports_recent_idx
  ON tenant_fantasy_ai.intelligence_reports (report_kind, period_end DESC);

ALTER TABLE tenant_fantasy_ai.lineup_learning_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.learning_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.intelligence_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineup_learning_diagnostics_select ON tenant_fantasy_ai.lineup_learning_diagnostics;
CREATE POLICY lineup_learning_diagnostics_select ON tenant_fantasy_ai.lineup_learning_diagnostics FOR SELECT USING (true);
DROP POLICY IF EXISTS learning_rules_select ON tenant_fantasy_ai.learning_rules;
CREATE POLICY learning_rules_select ON tenant_fantasy_ai.learning_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS intelligence_reports_select ON tenant_fantasy_ai.intelligence_reports;
CREATE POLICY intelligence_reports_select ON tenant_fantasy_ai.intelligence_reports FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.lineup_learning_diagnostics TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.learning_rules TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.intelligence_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.lineup_learning_diagnostics TO service_role;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.learning_rules TO service_role;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.intelligence_reports TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_learning_lineups(
  p_from_date DATE,
  p_to_date DATE,
  p_sport TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  snapshot_id UUID,
  sport TEXT,
  contest_date DATE,
  contest_type TEXT,
  lineup_mode TEXT,
  contest_strategy TEXT,
  players JSONB,
  projected_points DOUBLE PRECISION,
  actual_points DOUBLE PRECISION,
  optimal_points DOUBLE PRECISION,
  pct_of_optimal DOUBLE PRECISION,
  finish_rank INTEGER,
  field_size INTEGER,
  payout NUMERIC,
  config JSONB,
  snapshot_manifest JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    lineups.id,
    lineups.scan_snapshot_id,
    lineups.sport::TEXT,
    lineups.contest_date,
    lineups.contest_type,
    lineups.lineup_mode,
    lineups.contest_strategy,
    lineups.players,
    lineups.projected_points::DOUBLE PRECISION,
    lineups.actual_points::DOUBLE PRECISION,
    lineups.optimal_points::DOUBLE PRECISION,
    lineups.pct_of_optimal::DOUBLE PRECISION,
    lineups.finish_rank,
    lineups.field_size,
    lineups.payout,
    COALESCE(lineups.config, '{}'::JSONB),
    COALESCE(snapshots.manifest_data, '{}'::JSONB)
  FROM tenant_fantasy_ai.generated_lineups lineups
  LEFT JOIN tenant_fantasy_ai.mios_scan_snapshots snapshots ON snapshots.id = lineups.scan_snapshot_id
  WHERE lineups.contest_date BETWEEN p_from_date AND p_to_date
    AND (p_sport IS NULL OR p_sport = '' OR lineups.sport = LOWER(p_sport))
    AND lineups.actual_points IS NOT NULL
  ORDER BY lineups.contest_date, lineups.created_at;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_learning_diagnostics(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.lineup_learning_diagnostics (
    generated_lineup_id, snapshot_id, sport, contest_date, lineup_mode, contest_strategy,
    projected_points, actual_points, optimal_points, projection_error, absolute_error,
    pct_of_optimal, finish_rank, field_size, payout, cash_result, outcome_class,
    failure_reasons, evidence, diagnosed_at, updated_at
  )
  SELECT
    (row_data->>'generated_lineup_id')::UUID,
    NULLIF(row_data->>'snapshot_id', '')::UUID,
    LOWER(row_data->>'sport'), (row_data->>'contest_date')::DATE,
    NULLIF(row_data->>'lineup_mode', ''), NULLIF(row_data->>'contest_strategy', ''),
    NULLIF(row_data->>'projected_points', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'actual_points', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'optimal_points', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'projection_error', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'absolute_error', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'pct_of_optimal', '')::DOUBLE PRECISION,
    NULLIF(row_data->>'finish_rank', '')::INTEGER,
    NULLIF(row_data->>'field_size', '')::INTEGER,
    NULLIF(row_data->>'payout', '')::NUMERIC,
    COALESCE(NULLIF(row_data->>'cash_result', ''), 'unknown'),
    COALESCE(NULLIF(row_data->>'outcome_class', ''), 'unresolved'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(row_data->'failure_reasons')), ARRAY[]::TEXT[]),
    COALESCE(row_data->'evidence', '{}'::JSONB), NOW(), NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'generated_lineup_id', '') IS NOT NULL
    AND NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
  ON CONFLICT (generated_lineup_id) DO UPDATE SET
    snapshot_id = EXCLUDED.snapshot_id, projected_points = EXCLUDED.projected_points,
    actual_points = EXCLUDED.actual_points, optimal_points = EXCLUDED.optimal_points,
    projection_error = EXCLUDED.projection_error, absolute_error = EXCLUDED.absolute_error,
    pct_of_optimal = EXCLUDED.pct_of_optimal, finish_rank = EXCLUDED.finish_rank,
    field_size = EXCLUDED.field_size, payout = EXCLUDED.payout,
    cash_result = EXCLUDED.cash_result, outcome_class = EXCLUDED.outcome_class,
    failure_reasons = EXCLUDED.failure_reasons, evidence = EXCLUDED.evidence,
    updated_at = NOW();
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_learning_rules(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.learning_rules (
    rule_key, sport, rule_type, status, rule_statement, recommended_action,
    evidence_count, support_score, confidence_score, first_observed_at,
    last_observed_at, evidence, updated_at
  )
  SELECT
    row_data->>'rule_key', NULLIF(row_data->>'sport', ''),
    COALESCE(NULLIF(row_data->>'rule_type', ''), 'strategy'),
    COALESCE(NULLIF(row_data->>'status', ''), 'candidate'),
    row_data->>'rule_statement', row_data->>'recommended_action',
    GREATEST(COALESCE(NULLIF(row_data->>'evidence_count', '')::INTEGER, 0), 0),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'support_score', '')::DOUBLE PRECISION, 0), -1), 1),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'confidence_score', '')::DOUBLE PRECISION, 0), 0), 1),
    NULLIF(row_data->>'first_observed_at', '')::TIMESTAMPTZ,
    NULLIF(row_data->>'last_observed_at', '')::TIMESTAMPTZ,
    COALESCE(row_data->'evidence', '{}'::JSONB), NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'rule_key', '') IS NOT NULL
    AND NULLIF(row_data->>'rule_statement', '') IS NOT NULL
    AND NULLIF(row_data->>'recommended_action', '') IS NOT NULL
  ON CONFLICT (rule_key, sport) DO UPDATE SET
    rule_type = EXCLUDED.rule_type, status = EXCLUDED.status,
    rule_statement = EXCLUDED.rule_statement, recommended_action = EXCLUDED.recommended_action,
    evidence_count = EXCLUDED.evidence_count, support_score = EXCLUDED.support_score,
    confidence_score = EXCLUDED.confidence_score, first_observed_at = EXCLUDED.first_observed_at,
    last_observed_at = EXCLUDED.last_observed_at, evidence = EXCLUDED.evidence, updated_at = NOW();
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_intelligence_report(
  p_report_kind TEXT, p_period_start DATE, p_period_end DATE, p_report_title TEXT,
  p_source_snapshot JSONB, p_report_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE report_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.intelligence_reports (
    report_kind, period_start, period_end, report_title, source_snapshot, report_payload
  ) VALUES (
    p_report_kind, p_period_start, p_period_end, p_report_title,
    COALESCE(p_source_snapshot, '{}'::JSONB), COALESCE(p_report_payload, '{}'::JSONB)
  )
  ON CONFLICT (report_kind, period_start, period_end) DO UPDATE SET
    report_title = EXCLUDED.report_title, source_snapshot = EXCLUDED.source_snapshot,
    report_payload = EXCLUDED.report_payload, generated_at = NOW();
  SELECT id INTO report_id FROM tenant_fantasy_ai.intelligence_reports
  WHERE report_kind = p_report_kind AND period_start = p_period_start AND period_end = p_period_end;
  RETURN report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_learning_lineups(DATE, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_learning_diagnostics(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_learning_rules(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_intelligence_report(TEXT, DATE, DATE, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_learning_lineups(DATE, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_learning_diagnostics(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_learning_rules(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_intelligence_report(TEXT, DATE, DATE, TEXT, JSONB, JSONB) TO service_role;
