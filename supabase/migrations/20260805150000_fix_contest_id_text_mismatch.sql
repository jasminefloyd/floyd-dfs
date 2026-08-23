-- Fix contest_id type mismatch.
--
-- fantasy-pios-lineups, ingest-actual-results, and scrape-ownership all pass the app's
-- slate identifier (e.g. "dk-mlb-showdown-151666", built in
-- supabase/functions/draftkings-slates/index.ts) as contest_id. projection_results and
-- ownership_projections declared contest_id as UUID (a leftover FK to
-- draftkings_contests.id, a different, unrelated identifier), so every write that included
-- a contest_id threw "invalid input syntax for type uuid" and aborted. Both tables are
-- currently empty, so no data conversion is needed.

ALTER TABLE tenant_fantasy_ai.projection_results
  DROP CONSTRAINT IF EXISTS projection_results_contest_id_fkey;

ALTER TABLE tenant_fantasy_ai.projection_results
  ALTER COLUMN contest_id TYPE TEXT USING contest_id::TEXT;

ALTER TABLE tenant_fantasy_ai.ownership_projections
  ALTER COLUMN contest_id TYPE TEXT USING contest_id::TEXT;

-- Same-signature functions: CREATE OR REPLACE is sufficient.

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results(
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
  WITH parsed_rows AS (
    SELECT
      LOWER(row_data->>'sport') AS sport,
      (row_data->>'contest_date')::DATE AS contest_date,
      LOWER(row_data->>'contest_type') AS contest_type,
      NULLIF(row_data->>'contest_id', '') AS contest_id,
      NULLIF(row_data->>'player_id', '') AS player_id,
      row_data->>'player_name' AS player_name,
      NULLIF(row_data->>'team', '') AS team,
      NULLIF(row_data->>'position', '') AS position,
      NULLIF(row_data->>'projected_points', '')::FLOAT AS projected_points,
      NULLIF(row_data->>'actual_points', '')::FLOAT AS actual_points,
      COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore') AS source,
      COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown') AS projection_source
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
    WHERE row_data ? 'sport'
      AND row_data ? 'contest_date'
      AND row_data ? 'contest_type'
      AND row_data ? 'player_name'
      AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
      AND NULLIF(row_data->>'sport', '') IS NOT NULL
      AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
      AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
      AND NULLIF(row_data->>'player_name', '') IS NOT NULL
  ),
  input_rows AS (
    SELECT DISTINCT ON (sport, contest_date, contest_type, contest_id, player_name)
      sport,
      contest_date,
      contest_type,
      contest_id,
      player_id,
      player_name,
      team,
      position,
      projected_points,
      actual_points,
      source,
      projection_source
    FROM parsed_rows
    ORDER BY sport, contest_date, contest_type, contest_id, player_name, source
  ),
  updated AS (
    UPDATE tenant_fantasy_ai.projection_results existing
    SET
      player_id = COALESCE(input_rows.player_id, existing.player_id),
      team = COALESCE(input_rows.team, existing.team),
      position = COALESCE(input_rows.position, existing.position),
      projected_points = COALESCE(input_rows.projected_points, existing.projected_points),
      actual_points = COALESCE(input_rows.actual_points, existing.actual_points),
      source = input_rows.source,
      projection_source = input_rows.projection_source,
      updated_at = NOW()
    FROM input_rows
    WHERE existing.sport = input_rows.sport
      AND existing.contest_date = input_rows.contest_date
      AND existing.contest_type = input_rows.contest_type
      AND existing.contest_id IS NOT DISTINCT FROM input_rows.contest_id
      AND existing.player_name = input_rows.player_name
    RETURNING 1
  ),
  inserted AS (
    INSERT INTO tenant_fantasy_ai.projection_results (
      sport,
      contest_date,
      contest_type,
      contest_id,
      player_id,
      player_name,
      team,
      position,
      projected_points,
      actual_points,
      source,
      projection_source,
      updated_at
    )
    SELECT
      input_rows.sport,
      input_rows.contest_date,
      input_rows.contest_type,
      input_rows.contest_id,
      input_rows.player_id,
      input_rows.player_name,
      input_rows.team,
      input_rows.position,
      input_rows.projected_points,
      input_rows.actual_points,
      input_rows.source,
      input_rows.projection_source,
      NOW()
    FROM input_rows
    WHERE NOT EXISTS (
      SELECT 1
      FROM tenant_fantasy_ai.projection_results existing
      WHERE existing.sport = input_rows.sport
        AND existing.contest_date = input_rows.contest_date
        AND existing.contest_type = input_rows.contest_type
        AND existing.contest_id IS NOT DISTINCT FROM input_rows.contest_id
        AND existing.player_name = input_rows.player_name
    )
    ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name)
    DO UPDATE SET
      player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
      team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
      position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
      projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
      actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
      source = EXCLUDED.source,
      projection_source = EXCLUDED.projection_source,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INT
  INTO row_count
  FROM (
    SELECT 1 FROM updated
    UNION ALL
    SELECT 1 FROM inserted
  ) changed_rows;

  RETURN row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_projection_results_v2(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  INSERT INTO tenant_fantasy_ai.projection_results (
    sport, contest_date, contest_type, contest_id, player_id, player_name, team, position,
    projected_points, actual_points, source, projection_source, updated_at
  )
  SELECT
    LOWER(row_data->>'sport'),
    (row_data->>'contest_date')::DATE,
    LOWER(row_data->>'contest_type'),
    NULLIF(row_data->>'contest_id', ''),
    NULLIF(row_data->>'player_id', ''),
    row_data->>'player_name',
    NULLIF(row_data->>'team', ''),
    NULLIF(row_data->>'position', ''),
    NULLIF(row_data->>'projected_points', '')::FLOAT,
    NULLIF(row_data->>'actual_points', '')::FLOAT,
    COALESCE(NULLIF(row_data->>'source', ''), 'auto_boxscore'),
    COALESCE(NULLIF(row_data->>'projection_source', ''), 'unknown'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'sport', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_date', '') IS NOT NULL
    AND NULLIF(row_data->>'contest_type', '') IS NOT NULL
    AND NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND (row_data ? 'projected_points' OR row_data ? 'actual_points')
  ON CONFLICT (sport, contest_date, contest_type, contest_id, player_name)
  DO UPDATE SET
    player_id = COALESCE(EXCLUDED.player_id, tenant_fantasy_ai.projection_results.player_id),
    team = COALESCE(EXCLUDED.team, tenant_fantasy_ai.projection_results.team),
    position = COALESCE(EXCLUDED.position, tenant_fantasy_ai.projection_results.position),
    projected_points = COALESCE(EXCLUDED.projected_points, tenant_fantasy_ai.projection_results.projected_points),
    actual_points = COALESCE(EXCLUDED.actual_points, tenant_fantasy_ai.projection_results.actual_points),
    source = EXCLUDED.source,
    projection_source = EXCLUDED.projection_source,
    updated_at = NOW();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

-- Different-signature functions (UUID param -> TEXT) require DROP + CREATE.

DROP FUNCTION IF EXISTS public.fantasy_ai_get_ownership_projections_v2(TEXT, DATE, TEXT, UUID, TEXT, TEXT);

CREATE FUNCTION public.fantasy_ai_get_ownership_projections_v2(
  p_sport TEXT,
  p_contest_date DATE,
  p_contest_type TEXT DEFAULT NULL,
  p_contest_id TEXT DEFAULT NULL,
  p_draft_group_id TEXT DEFAULT NULL,
  p_game_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  player_name TEXT,
  ownership_pct FLOAT,
  cpt_ownership_pct FLOAT,
  flex_ownership_pct FLOAT,
  source TEXT,
  scraped_at TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    ownership.player_name,
    ownership.ownership_pct,
    ownership.cpt_ownership_pct,
    ownership.flex_ownership_pct,
    ownership.source,
    ownership.scraped_at
  FROM tenant_fantasy_ai.ownership_projections ownership
  WHERE ownership.sport = LOWER(p_sport)
    AND ownership.contest_date = p_contest_date
    AND (p_contest_type IS NULL OR ownership.contest_type = LOWER(p_contest_type))
    AND (p_contest_id IS NULL OR ownership.contest_id = p_contest_id)
    AND (p_draft_group_id IS NULL OR ownership.draft_group_id = p_draft_group_id)
    AND (p_game_id IS NULL OR ownership.game_id = p_game_id)
  ORDER BY ownership.scraped_at DESC, ownership.player_name;
$$;

DROP FUNCTION IF EXISTS public.fantasy_ai_upsert_ownership_projections_v2(TEXT, DATE, TEXT, TEXT, UUID, TEXT, TEXT, JSONB);

CREATE FUNCTION public.fantasy_ai_upsert_ownership_projections_v2(
  p_sport TEXT,
  p_contest_date DATE,
  p_source TEXT,
  p_contest_type TEXT DEFAULT NULL,
  p_contest_id TEXT DEFAULT NULL,
  p_draft_group_id TEXT DEFAULT NULL,
  p_game_id TEXT DEFAULT NULL,
  p_rows JSONB DEFAULT '[]'::JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE
  row_count INT;
BEGIN
  DELETE FROM tenant_fantasy_ai.ownership_projections existing
  WHERE existing.sport = LOWER(p_sport)
    AND existing.contest_date = p_contest_date
    AND existing.player_name IN (
      SELECT row_data->>'player_name'
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
    )
    AND existing.contest_type IS NOT DISTINCT FROM LOWER(p_contest_type)
    AND existing.contest_id IS NOT DISTINCT FROM p_contest_id
    AND existing.draft_group_id IS NOT DISTINCT FROM p_draft_group_id
    AND existing.game_id IS NOT DISTINCT FROM p_game_id;

  INSERT INTO tenant_fantasy_ai.ownership_projections (
    sport, contest_date, player_name, ownership_pct, cpt_ownership_pct, flex_ownership_pct,
    source, scraped_at, contest_type, contest_id, draft_group_id, game_id
  )
  SELECT
    LOWER(p_sport), p_contest_date, row_data->>'player_name',
    LEAST(GREATEST(REPLACE(row_data->>'ownership_pct', '%', '')::FLOAT, 0), 100),
    CASE WHEN NULLIF(REPLACE(row_data->>'cpt_ownership_pct', '%', ''), '') IS NOT NULL
      AND REPLACE(row_data->>'cpt_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'cpt_ownership_pct', '%', '')::FLOAT, 0), 100) ELSE NULL END,
    CASE WHEN NULLIF(REPLACE(row_data->>'flex_ownership_pct', '%', ''), '') IS NOT NULL
      AND REPLACE(row_data->>'flex_ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN LEAST(GREATEST(REPLACE(row_data->>'flex_ownership_pct', '%', '')::FLOAT, 0), 100) ELSE NULL END,
    COALESCE(NULLIF(p_source, ''), 'unknown'), NOW(), LOWER(p_contest_type), p_contest_id,
    p_draft_group_id, p_game_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) row_data
  WHERE NULLIF(row_data->>'player_name', '') IS NOT NULL
    AND NULLIF(row_data->>'ownership_pct', '') IS NOT NULL
    AND REPLACE(row_data->>'ownership_pct', '%', '') ~ '^[0-9]+([.][0-9]+)?$';

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_ownership_projections_v2(TEXT, DATE, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_ownership_projections_v2(TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;
