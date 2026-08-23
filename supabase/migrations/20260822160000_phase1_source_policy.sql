-- Phase 1 source hierarchy: source kind and data-type-specific reliability
-- priors are durable so they can be audited and calibrated independently.

ALTER TABLE tenant_fantasy_ai.intelligence_sources
  DROP CONSTRAINT IF EXISTS intelligence_sources_source_kind_check;

ALTER TABLE tenant_fantasy_ai.intelligence_sources
  ADD CONSTRAINT intelligence_sources_source_kind_check
  CHECK (source_kind IN ('official', 'league', 'media', 'aggregator', 'market', 'community', 'internal', 'modeled', 'unknown'));

ALTER TABLE tenant_fantasy_ai.source_quality
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS policy_version TEXT NOT NULL DEFAULT 'source-policy-v1';

INSERT INTO tenant_fantasy_ai.source_quality (source, sport, data_class, reliability, freshness_ttl_seconds, official, source_kind, policy_version)
VALUES
  ('draftkings_salaries', '*', 'salary', 0.98, 86400, TRUE, 'official', 'source-policy-v1'),
  ('rotowire_confirmed_lineups', '*', 'availability', 0.85, 900, FALSE, 'aggregator', 'source-policy-v1'),
  ('free_odds', '*', 'market', 0.82, 900, FALSE, 'market', 'source-policy-v1'),
  ('ownership_projections', '*', 'ownership', 0.68, 14400, FALSE, 'aggregator', 'source-policy-v1'),
  ('nws_weather', '*', 'weather', 0.90, 3600, TRUE, 'official', 'source-policy-v1'),
  ('baseball_savant_statcast', 'mlb', 'historical_stats', 0.93, 172800, TRUE, 'league', 'source-policy-v1'),
  ('understand_ledger', '*', 'intelligence', 0.70, 172800, FALSE, 'internal', 'source-policy-v1'),
  ('reddit_sentiment', '*', 'community_context', 0.25, 86400, FALSE, 'community', 'source-policy-v1')
ON CONFLICT (source, sport, data_class) DO UPDATE SET
  reliability = EXCLUDED.reliability,
  freshness_ttl_seconds = EXCLUDED.freshness_ttl_seconds,
  official = EXCLUDED.official,
  source_kind = EXCLUDED.source_kind,
  policy_version = EXCLUDED.policy_version,
  updated_at = NOW();
