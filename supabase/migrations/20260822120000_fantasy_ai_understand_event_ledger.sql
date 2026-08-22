-- Phase 1: durable Understand-layer event ledger and source reliability priors.
-- Events are immutable intelligence observations in practice: repeat observations
-- update last_seen_at, while the original observed_at and source evidence remain.

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.intelligence_sources (
  source_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_kind IN ('official', 'league', 'media', 'aggregator', 'market', 'internal', 'unknown')),
  reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0.5
    CHECK (reliability_score >= 0 AND reliability_score <= 1),
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.intelligence_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL REFERENCES tenant_fantasy_ai.intelligence_sources(source_key),
  source_event_id TEXT,
  dedupe_key TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('news', 'injury', 'transaction', 'trade', 'lineup_update', 'schedule', 'weather', 'market_movement', 'other')),
  event_status TEXT NOT NULL DEFAULT 'active'
    CHECK (event_status IN ('active', 'superseded', 'verified', 'expired')), 
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  opponent_team TEXT,
  game_id TEXT,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.5
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0.5
    CHECK (source_reliability_score >= 0 AND source_reliability_score <= 1),
  materiality SMALLINT NOT NULL DEFAULT 1 CHECK (materiality BETWEEN 0 AND 5),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_key, dedupe_key)
);

CREATE INDEX IF NOT EXISTS intelligence_events_recent_idx
  ON tenant_fantasy_ai.intelligence_events (sport, observed_at DESC, materiality DESC);

CREATE INDEX IF NOT EXISTS intelligence_events_player_idx
  ON tenant_fantasy_ai.intelligence_events (sport, player_name, observed_at DESC)
  WHERE player_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS intelligence_events_team_idx
  ON tenant_fantasy_ai.intelligence_events (sport, team, observed_at DESC)
  WHERE team IS NOT NULL;

CREATE INDEX IF NOT EXISTS intelligence_events_type_idx
  ON tenant_fantasy_ai.intelligence_events (sport, event_type, observed_at DESC);

ALTER TABLE tenant_fantasy_ai.intelligence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.intelligence_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_sources_select ON tenant_fantasy_ai.intelligence_sources;
CREATE POLICY intelligence_sources_select ON tenant_fantasy_ai.intelligence_sources
  FOR SELECT USING (true);

DROP POLICY IF EXISTS intelligence_events_select ON tenant_fantasy_ai.intelligence_events;
CREATE POLICY intelligence_events_select ON tenant_fantasy_ai.intelligence_events
  FOR SELECT USING (true);

GRANT SELECT ON tenant_fantasy_ai.intelligence_sources TO anon, authenticated;
GRANT SELECT ON tenant_fantasy_ai.intelligence_events TO anon, authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.intelligence_sources TO service_role;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.intelligence_events TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_intelligence_sources(p_sources JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.intelligence_sources (
    source_key, display_name, source_kind, reliability_score, sample_size,
    active, metadata, last_evaluated_at, updated_at
  )
  SELECT
    NULLIF(row_data->>'source_key', ''),
    COALESCE(NULLIF(row_data->>'display_name', ''), row_data->>'source_key'),
    COALESCE(NULLIF(row_data->>'source_kind', ''), 'unknown'),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'reliability_score', '')::DOUBLE PRECISION, 0.5), 0), 1),
    GREATEST(COALESCE(NULLIF(row_data->>'sample_size', '')::INTEGER, 0), 0),
    COALESCE((row_data->>'active')::BOOLEAN, TRUE),
    COALESCE(row_data->'metadata', '{}'::JSONB),
    NULLIF(row_data->>'last_evaluated_at', '')::TIMESTAMPTZ,
    NOW()
  FROM jsonb_array_elements(COALESCE(p_sources, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'source_key', '') IS NOT NULL
  ON CONFLICT (source_key) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, tenant_fantasy_ai.intelligence_sources.display_name),
    source_kind = EXCLUDED.source_kind,
    reliability_score = EXCLUDED.reliability_score,
    sample_size = EXCLUDED.sample_size,
    active = EXCLUDED.active,
    metadata = EXCLUDED.metadata,
    last_evaluated_at = EXCLUDED.last_evaluated_at,
    updated_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_intelligence_events(p_events JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INTEGER;
BEGIN
  INSERT INTO tenant_fantasy_ai.intelligence_events (
    source_key, source_event_id, dedupe_key, sport, league, event_type, event_status,
    title, summary, source_url, published_at, observed_at, last_seen_at, expires_at,
    player_id, player_name, team, opponent_team, game_id, confidence_score,
    source_reliability_score, materiality, tags, raw_payload, updated_at
  )
  SELECT
    row_data->>'source_key',
    NULLIF(row_data->>'source_event_id', ''),
    COALESCE(NULLIF(row_data->>'dedupe_key', ''), NULLIF(row_data->>'source_event_id', '')),
    LOWER(row_data->>'sport'),
    NULLIF(LOWER(row_data->>'league'), ''),
    COALESCE(NULLIF(row_data->>'event_type', ''), 'news'),
    COALESCE(NULLIF(row_data->>'event_status', ''), 'active'),
    row_data->>'title',
    NULLIF(row_data->>'summary', ''),
    NULLIF(row_data->>'source_url', ''),
    NULLIF(row_data->>'published_at', '')::TIMESTAMPTZ,
    COALESCE(NULLIF(row_data->>'observed_at', '')::TIMESTAMPTZ, NOW()),
    NOW(),
    NULLIF(row_data->>'expires_at', '')::TIMESTAMPTZ,
    NULLIF(row_data->>'player_id', ''),
    NULLIF(row_data->>'player_name', ''),
    NULLIF(row_data->>'team', ''),
    NULLIF(row_data->>'opponent_team', ''),
    NULLIF(row_data->>'game_id', ''),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'confidence_score', '')::DOUBLE PRECISION, 0.5), 0), 1),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'source_reliability_score', '')::DOUBLE PRECISION, sources.reliability_score, 0.5), 0), 1),
    LEAST(GREATEST(COALESCE(NULLIF(row_data->>'materiality', '')::SMALLINT, 1), 0), 5),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(row_data->'tags')), ARRAY[]::TEXT[]),
    COALESCE(row_data->'raw_payload', '{}'::JSONB),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_events, '[]'::JSONB)) row_data
  JOIN tenant_fantasy_ai.intelligence_sources sources
    ON sources.source_key = row_data->>'source_key'
  WHERE NULLIF(row_data->>'source_key', '') IS NOT NULL
    AND NULLIF(row_data->>'dedupe_key', '') IS NOT NULL
    AND NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'title', '') IS NOT NULL
  ON CONFLICT (source_key, dedupe_key) DO UPDATE SET
    source_event_id = COALESCE(EXCLUDED.source_event_id, tenant_fantasy_ai.intelligence_events.source_event_id),
    summary = COALESCE(EXCLUDED.summary, tenant_fantasy_ai.intelligence_events.summary),
    source_url = COALESCE(EXCLUDED.source_url, tenant_fantasy_ai.intelligence_events.source_url),
    published_at = COALESCE(EXCLUDED.published_at, tenant_fantasy_ai.intelligence_events.published_at),
    last_seen_at = NOW(),
    expires_at = COALESCE(EXCLUDED.expires_at, tenant_fantasy_ai.intelligence_events.expires_at),
    confidence_score = EXCLUDED.confidence_score,
    source_reliability_score = EXCLUDED.source_reliability_score,
    materiality = EXCLUDED.materiality,
    tags = EXCLUDED.tags,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_recent_intelligence_events(
  p_sport TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '48 hours',
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  event_id UUID,
  source_key TEXT,
  sport TEXT,
  league TEXT,
  event_type TEXT,
  event_status TEXT,
  title TEXT,
  summary TEXT,
  source_url TEXT,
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  opponent_team TEXT,
  game_id TEXT,
  confidence_score DOUBLE PRECISION,
  source_reliability_score DOUBLE PRECISION,
  materiality SMALLINT,
  tags TEXT[],
  raw_payload JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    events.event_id, events.source_key, events.sport, events.league, events.event_type,
    events.event_status, events.title, events.summary, events.source_url,
    events.published_at, events.observed_at, events.player_id, events.player_name,
    events.team, events.opponent_team, events.game_id, events.confidence_score,
    events.source_reliability_score, events.materiality, events.tags, events.raw_payload
  FROM tenant_fantasy_ai.intelligence_events events
  WHERE (p_sport IS NULL OR p_sport = '' OR events.sport = LOWER(p_sport))
    AND events.observed_at >= COALESCE(p_since, NOW() - INTERVAL '48 hours')
    AND events.event_status IN ('active', 'verified')
  ORDER BY events.materiality DESC, COALESCE(events.published_at, events.observed_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_intelligence_sources(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_intelligence_events(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_recent_intelligence_events(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_intelligence_sources(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_intelligence_events(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_recent_intelligence_events(TEXT, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;
