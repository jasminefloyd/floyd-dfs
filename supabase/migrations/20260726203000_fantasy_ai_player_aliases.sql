CREATE TABLE IF NOT EXISTS tenant_fantasy_ai.player_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  canonical_player_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  alias_name TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (sport, alias_key, source)
);

CREATE INDEX IF NOT EXISTS player_aliases_canonical_idx
  ON tenant_fantasy_ai.player_aliases (sport, canonical_player_id);

CREATE INDEX IF NOT EXISTS player_aliases_alias_key_idx
  ON tenant_fantasy_ai.player_aliases (sport, alias_key);

ALTER TABLE tenant_fantasy_ai.player_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_aliases_select ON tenant_fantasy_ai.player_aliases;
CREATE POLICY player_aliases_select ON tenant_fantasy_ai.player_aliases
  FOR SELECT
  USING (true);

GRANT SELECT ON tenant_fantasy_ai.player_aliases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON tenant_fantasy_ai.player_aliases TO service_role;

CREATE OR REPLACE FUNCTION public.fantasy_ai_get_player_aliases(
  p_sport TEXT
)
RETURNS TABLE (
  canonical_player_id TEXT,
  canonical_name TEXT,
  alias_name TEXT,
  alias_key TEXT,
  source TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT
    aliases.canonical_player_id,
    aliases.canonical_name,
    aliases.alias_name,
    aliases.alias_key,
    aliases.source
  FROM tenant_fantasy_ai.player_aliases aliases
  WHERE aliases.sport = LOWER(p_sport);
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_player_aliases(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_player_aliases(TEXT) TO anon, authenticated, service_role;
