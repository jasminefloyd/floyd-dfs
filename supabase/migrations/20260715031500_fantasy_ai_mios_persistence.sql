CREATE OR REPLACE FUNCTION public.fantasy_ai_insert_mios_manifest(
  p_user_id UUID,
  p_sport TEXT,
  p_contest_type TEXT,
  p_contest_date DATE,
  p_data JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  inserted_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  INSERT INTO tenant_fantasy_ai.mios_manifest (
    user_id,
    sport,
    contest_type,
    contest_date,
    data
  )
  VALUES (
    p_user_id,
    p_sport,
    p_contest_type,
    p_contest_date,
    p_data
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_ensure_user(
  p_user_id UUID,
  p_email TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  INSERT INTO tenant_fantasy_ai.users (id, email)
  VALUES (p_user_id, p_email)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, tenant_fantasy_ai.users.email);
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_cached_last5_stats(
  p_player_id TEXT,
  p_sport TEXT
)
RETURNS TABLE (
  player_id TEXT,
  sport VARCHAR(10),
  games_data JSONB,
  aggregated_stats JSONB,
  confidence_score FLOAT,
  last_updated_at TIMESTAMP,
  expires_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    stats.player_id,
    stats.sport,
    stats.games_data,
    stats.aggregated_stats,
    stats.confidence_score,
    stats.last_updated_at,
    stats.expires_at
  FROM tenant_fantasy_ai.player_last_5_stats stats
  WHERE stats.player_id = p_player_id
    AND stats.sport = p_sport
    AND (stats.expires_at IS NULL OR stats.expires_at > NOW())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_last5_stats(
  p_player_id TEXT,
  p_sport TEXT,
  p_games_data JSONB,
  p_aggregated_stats JSONB,
  p_confidence_score FLOAT,
  p_expires_at TIMESTAMP
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  INSERT INTO tenant_fantasy_ai.player_last_5_stats (
    player_id,
    sport,
    games_data,
    aggregated_stats,
    confidence_score,
    expires_at,
    last_updated_at
  )
  VALUES (
    p_player_id,
    p_sport,
    p_games_data,
    p_aggregated_stats,
    p_confidence_score,
    p_expires_at,
    NOW()
  )
  ON CONFLICT (player_id, sport)
  DO UPDATE SET
    games_data = EXCLUDED.games_data,
    aggregated_stats = EXCLUDED.aggregated_stats,
    confidence_score = EXCLUDED.confidence_score,
    expires_at = EXCLUDED.expires_at,
    last_updated_at = NOW();
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_insert_mios_manifest(UUID, TEXT, TEXT, DATE, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_ensure_user(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_get_cached_last5_stats(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_last5_stats(TEXT, TEXT, JSONB, JSONB, FLOAT, TIMESTAMP) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_insert_mios_manifest(UUID, TEXT, TEXT, DATE, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_ensure_user(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_cached_last5_stats(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_last5_stats(TEXT, TEXT, JSONB, JSONB, FLOAT, TIMESTAMP) TO service_role;
