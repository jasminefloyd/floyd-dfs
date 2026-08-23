-- Phase 8: keep learned rules as candidates until a shadow comparison clears
-- the sample and improvement gates. Promotion remains an explicit approval.
ALTER TABLE tenant_fantasy_ai.learning_rules
  ADD COLUMN IF NOT EXISTS minimum_sample_size INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS promotion_status TEXT NOT NULL DEFAULT 'shadow_only'
    CHECK (promotion_status IN ('shadow_only', 'eligible', 'approved', 'blocked')),
  ADD COLUMN IF NOT EXISTS baseline_comparison JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.learning_shadow_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL,
  sport TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  baseline_version TEXT NOT NULL,
  candidate_samples INTEGER NOT NULL DEFAULT 0,
  baseline_samples INTEGER NOT NULL DEFAULT 0,
  candidate_score DOUBLE PRECISION,
  baseline_score DOUBLE PRECISION,
  improvement DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'shadow_only' CHECK (status IN ('shadow_only', 'eligible', 'approved', 'blocked')),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_shadow_evaluations_rule_idx
  ON tenant_fantasy_ai.learning_shadow_evaluations (sport, rule_key, created_at DESC);

ALTER TABLE tenant_fantasy_ai.learning_shadow_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_shadow_evaluations_select ON tenant_fantasy_ai.learning_shadow_evaluations;
CREATE POLICY learning_shadow_evaluations_select ON tenant_fantasy_ai.learning_shadow_evaluations FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.learning_shadow_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.learning_shadow_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_record_learning_shadow_evaluation(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE evaluation_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.learning_shadow_evaluations (
    rule_key, sport, candidate_version, baseline_version, candidate_samples,
    baseline_samples, candidate_score, baseline_score, improvement, status, evidence
  ) VALUES (
    p_row->>'rule_key', LOWER(p_row->>'sport'), COALESCE(NULLIF(p_row->>'candidate_version', ''), 'candidate'),
    COALESCE(NULLIF(p_row->>'baseline_version', ''), 'baseline'),
    COALESCE(NULLIF(p_row->>'candidate_samples', '')::INTEGER, 0), COALESCE(NULLIF(p_row->>'baseline_samples', '')::INTEGER, 0),
    NULLIF(p_row->>'candidate_score', '')::DOUBLE PRECISION, NULLIF(p_row->>'baseline_score', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'improvement', '')::DOUBLE PRECISION, COALESCE(NULLIF(p_row->>'status', ''), 'shadow_only'), COALESCE(p_row->'evidence', '{}'::JSONB)
  ) RETURNING evaluation_id INTO evaluation_id;
  RETURN evaluation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_record_learning_shadow_evaluation(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_record_learning_shadow_evaluation(JSONB) TO service_role;
