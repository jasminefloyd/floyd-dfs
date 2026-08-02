-- PIOS intelligence contract: durable pair history, structured evidence, and validation.
CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.pios_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  player_id TEXT NOT NULL,
  related_player_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('positive', 'negative', 'neutral')),
  correlation FLOAT NOT NULL DEFAULT 0,
  mean_lift FLOAT NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'derived_from_slate_context',
  confidence FLOAT NOT NULL DEFAULT 0,
  last_observed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport, player_id, related_player_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS pios_relationships_lookup_idx
  ON tenant_fantasy_ai.pios_relationships (sport, player_id, related_player_id);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.pios_news_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  player_id TEXT NOT NULL,
  source TEXT NOT NULL,
  headline TEXT,
  summary TEXT,
  impact_type TEXT NOT NULL DEFAULT 'unknown',
  published_at TIMESTAMPTZ,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  is_speculative BOOLEAN NOT NULL DEFAULT TRUE,
  reliability FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport, player_id, source, headline, published_at)
);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.pios_relationship_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  relationship_id UUID REFERENCES tenant_fantasy_ai.pios_relationships(id) ON DELETE CASCADE,
  evaluated_sample_size INTEGER NOT NULL DEFAULT 0,
  predicted_correlation FLOAT,
  realized_correlation FLOAT,
  absolute_error FLOAT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (relationship_id, evaluated_at)
);

ALTER TABLE tenant_fantasy_ai.pios_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.pios_news_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.pios_relationship_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pios_relationships_select ON tenant_fantasy_ai.pios_relationships;
CREATE POLICY pios_relationships_select ON tenant_fantasy_ai.pios_relationships FOR SELECT USING (true);
DROP POLICY IF EXISTS pios_news_evidence_select ON tenant_fantasy_ai.pios_news_evidence;
CREATE POLICY pios_news_evidence_select ON tenant_fantasy_ai.pios_news_evidence FOR SELECT USING (true);
DROP POLICY IF EXISTS pios_relationship_evaluations_select ON tenant_fantasy_ai.pios_relationship_evaluations;
CREATE POLICY pios_relationship_evaluations_select ON tenant_fantasy_ai.pios_relationship_evaluations FOR SELECT USING (true);
GRANT SELECT ON tenant_fantasy_ai.pios_relationships TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.pios_news_evidence TO authenticated;
GRANT SELECT ON tenant_fantasy_ai.pios_relationship_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.pios_relationships TO service_role;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.pios_news_evidence TO service_role;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.pios_relationship_evaluations TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_pios_relationships(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.pios_relationships (
    sport, player_id, related_player_id, relationship_type, direction, correlation,
    mean_lift, sample_size, source, confidence, last_observed_at
  )
  SELECT LOWER(row_data->>'sport'), row_data->>'player_id', row_data->>'related_player_id',
    COALESCE(NULLIF(row_data->>'relationship_type', ''), 'same_game'),
    CASE WHEN row_data->>'direction' IN ('positive', 'negative', 'neutral') THEN row_data->>'direction' ELSE 'neutral' END,
    COALESCE(NULLIF(row_data->>'correlation', '')::FLOAT, 0), COALESCE(NULLIF(row_data->>'mean_lift', '')::FLOAT, 0),
    GREATEST(COALESCE(NULLIF(row_data->>'sample_size', '')::INTEGER, 0), 0),
    COALESCE(NULLIF(row_data->>'source', ''), 'derived_from_slate_context'),
    GREATEST(LEAST(COALESCE(NULLIF(row_data->>'confidence', '')::FLOAT, 0), 1), 0),
    NULLIF(row_data->>'last_observed_at', '')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'player_id', '') IS NOT NULL
    AND NULLIF(row_data->>'related_player_id', '') IS NOT NULL
  ON CONFLICT (sport, player_id, related_player_id, relationship_type) DO UPDATE SET
    direction = EXCLUDED.direction, correlation = EXCLUDED.correlation, mean_lift = EXCLUDED.mean_lift,
    sample_size = EXCLUDED.sample_size, source = EXCLUDED.source, confidence = EXCLUDED.confidence,
    last_observed_at = EXCLUDED.last_observed_at, updated_at = NOW();
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_pios_relationships(p_sport TEXT, p_player_ids TEXT[])
RETURNS TABLE (player_id TEXT, related_player_id TEXT, relationship_type TEXT, direction TEXT, correlation FLOAT, mean_lift FLOAT, sample_size INTEGER, source TEXT, confidence FLOAT)
LANGUAGE sql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
  SELECT player_id, related_player_id, relationship_type, direction, correlation, mean_lift, sample_size, source, confidence
  FROM tenant_fantasy_ai.pios_relationships
  WHERE sport = LOWER(p_sport) AND player_id = ANY(p_player_ids) AND related_player_id = ANY(p_player_ids);
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_pios_news_evidence(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.pios_news_evidence (sport, player_id, source, headline, summary, impact_type, published_at, confirmed, is_speculative, reliability)
  SELECT LOWER(row_data->>'sport'), row_data->>'player_id', COALESCE(NULLIF(row_data->>'source', ''), 'unknown'),
    NULLIF(row_data->>'headline', ''), NULLIF(row_data->>'summary', ''), COALESCE(NULLIF(row_data->>'impact_type', ''), 'unknown'),
    NULLIF(row_data->>'published_at', '')::TIMESTAMPTZ, COALESCE((row_data->>'confirmed')::BOOLEAN, FALSE),
    COALESCE((row_data->>'is_speculative')::BOOLEAN, TRUE), GREATEST(LEAST(COALESCE(NULLIF(row_data->>'reliability', '')::FLOAT, 0), 1), 0)
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL AND NULLIF(row_data->>'player_id', '') IS NOT NULL
  ON CONFLICT (sport, player_id, source, headline, published_at) DO UPDATE SET
    summary = EXCLUDED.summary, impact_type = EXCLUDED.impact_type, confirmed = EXCLUDED.confirmed,
    is_speculative = EXCLUDED.is_speculative, reliability = EXCLUDED.reliability;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_evaluate_pios_relationships(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.pios_relationship_evaluations (
    sport, relationship_id, evaluated_sample_size, predicted_correlation, realized_correlation, absolute_error
  )
  SELECT LOWER(row_data->>'sport'), NULLIF(row_data->>'relationship_id', '')::UUID,
    GREATEST(COALESCE(NULLIF(row_data->>'evaluated_sample_size', '')::INTEGER, 0), 0),
    NULLIF(row_data->>'predicted_correlation', '')::FLOAT, NULLIF(row_data->>'realized_correlation', '')::FLOAT,
    NULLIF(row_data->>'absolute_error', '')::FLOAT
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'relationship_id', '') IS NOT NULL;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_evaluate_pios_relationships_for_date(p_sport TEXT, p_contest_date DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_fantasy_ai, public AS $$
DECLARE row_count INTEGER;
BEGIN
  WITH paired AS (
    SELECT rel.id AS relationship_id, rel.sport, rel.correlation AS predicted_correlation,
      COUNT(*)::INTEGER AS sample_size, CORR(first_result.actual_points, second_result.actual_points)::FLOAT AS realized_correlation
    FROM tenant_fantasy_ai.pios_relationships rel
    JOIN tenant_fantasy_ai.projection_results first_result
      ON first_result.sport = rel.sport AND first_result.player_id = rel.player_id
    JOIN tenant_fantasy_ai.projection_results second_result
      ON second_result.sport = rel.sport AND second_result.player_id = rel.related_player_id
      AND second_result.contest_date = first_result.contest_date
      AND second_result.contest_type = first_result.contest_type
      AND second_result.contest_id IS NOT DISTINCT FROM first_result.contest_id
    WHERE rel.sport = LOWER(p_sport)
      AND first_result.contest_date <= p_contest_date
      AND first_result.actual_points IS NOT NULL
      AND second_result.actual_points IS NOT NULL
    GROUP BY rel.id, rel.sport, rel.correlation
    HAVING COUNT(*) >= 20
  ), updated AS (
    UPDATE tenant_fantasy_ai.pios_relationships rel
    SET sample_size = paired.sample_size,
      confidence = LEAST(0.95, GREATEST(0.2, paired.sample_size::FLOAT / 100.0)),
      source = 'historical_pair_data', updated_at = NOW(), last_observed_at = NOW()
    FROM paired
    WHERE rel.id = paired.relationship_id
    RETURNING rel.id
  )
  INSERT INTO tenant_fantasy_ai.pios_relationship_evaluations (
    sport, relationship_id, evaluated_sample_size, predicted_correlation, realized_correlation, absolute_error
  )
  SELECT paired.sport, paired.relationship_id, paired.sample_size, paired.predicted_correlation,
    paired.realized_correlation, ABS(paired.realized_correlation - paired.predicted_correlation)
  FROM paired
  WHERE paired.realized_correlation IS NOT NULL;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_pios_relationships(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_pios_relationships(TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_insert_pios_news_evidence(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_evaluate_pios_relationships(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_evaluate_pios_relationships_for_date(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_pios_relationships(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_pios_relationships(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_pios_news_evidence(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_evaluate_pios_relationships(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_evaluate_pios_relationships_for_date(TEXT, DATE) TO service_role;
