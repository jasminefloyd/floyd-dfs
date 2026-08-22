-- Initial source registry entries. Reliability starts as a prior and is updated
-- only after the outcome-learning loop has enough evidence.

INSERT INTO tenant_fantasy_ai.intelligence_sources (
  source_key, display_name, source_kind, reliability_score, metadata
)
VALUES
  ('espn_news', 'ESPN Sports News', 'media', 0.5, jsonb_build_object(
    'role', 'news_feed',
    'reliability_note', 'Conservative prior; update from verified event outcomes.'
  )),
  ('draftkings_slate', 'DraftKings Slate Data', 'official', 0.9, jsonb_build_object(
    'role', 'slate_and_salary_context',
    'reliability_note', 'Official contest and salary context.'
  )),
  ('confirmed_lineups', 'Confirmed Lineup Feed', 'aggregator', 0.7, jsonb_build_object(
    'role', 'starting_lineup_context',
    'reliability_note', 'Requires timestamped verification against final status.'
  ))
ON CONFLICT (source_key) DO NOTHING;
