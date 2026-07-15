-- Register the fantasy-ai tenant with the platform
INSERT INTO public.tenants (id, slug, name)
VALUES (gen_random_uuid(), 'fantasy-ai', 'Fantasy AI')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.platform_apps (id, name, description, tenant_slug, is_active, schema_name)
VALUES ('fantasy-ai', 'Fantasy AI', 'DraftKings lineup generator', 'fantasy-ai', true, 'tenant_fantasy_ai')
ON CONFLICT (id) DO NOTHING;

-- Create the tenant schema
-- Fantasy AI owns tenant_fantasy_ai. Do not point this app at another tenant schema.
-- Expose tenant_fantasy_ai in Supabase API settings and set
-- VITE_SUPABASE_SCHEMA=tenant_fantasy_ai for frontend reads.
CREATE SCHEMA IF NOT EXISTS tenant_fantasy_ai;

GRANT USAGE ON SCHEMA tenant_fantasy_ai TO anon, authenticated;

-- Create users table
CREATE TABLE tenant_fantasy_ai.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  tier VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMP DEFAULT NOW(),
  stripe_customer_id TEXT,
  scan_count_today INT DEFAULT 0,
  last_scan_date DATE,
  is_admin BOOLEAN DEFAULT false
);

-- Create player_last_5_stats table (shared cache)
CREATE TABLE tenant_fantasy_ai.player_last_5_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  sport VARCHAR(10) NOT NULL,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  games_data JSONB,
  aggregated_stats JSONB,
  confidence_score FLOAT,
  expires_at TIMESTAMP,
  UNIQUE(player_id, sport)
);
CREATE INDEX ON tenant_fantasy_ai.player_last_5_stats (player_id, sport);
CREATE INDEX ON tenant_fantasy_ai.player_last_5_stats (last_updated_at);

-- Create mios_manifest table (per-user, per-scan)
CREATE TABLE tenant_fantasy_ai.mios_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tenant_fantasy_ai.users(id),
  sport VARCHAR(10) NOT NULL,
  contest_type VARCHAR(20) NOT NULL,
  contest_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  data JSONB
);
CREATE INDEX ON tenant_fantasy_ai.mios_manifest (user_id, created_at);

-- Create ranked_lineups table
CREATE TABLE tenant_fantasy_ai.ranked_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES tenant_fantasy_ai.mios_manifest(id),
  user_id UUID NOT NULL REFERENCES tenant_fantasy_ai.users(id),
  rank INT,
  lineup_data JSONB,
  projected_points FLOAT,
  salary_used INT,
  confidence_score FLOAT,
  narrative_explanation TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON tenant_fantasy_ai.ranked_lineups (user_id, created_at);

-- Create saved_lineups table
CREATE TABLE tenant_fantasy_ai.saved_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tenant_fantasy_ai.users(id),
  lineup_id UUID NOT NULL REFERENCES tenant_fantasy_ai.ranked_lineups(id),
  sport VARCHAR(10),
  contest_date DATE,
  actual_points INT,
  user_feedback VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON tenant_fantasy_ai.saved_lineups (user_id, created_at);

-- Create social_sentiment table (shared cache)
CREATE TABLE tenant_fantasy_ai.social_sentiment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  sport VARCHAR(10) NOT NULL,
  reddit_mentions INT DEFAULT 0,
  sentiment_score FLOAT,
  key_themes TEXT[],
  last_updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_id, sport)
);
CREATE INDEX ON tenant_fantasy_ai.social_sentiment (player_id, sport);

-- Create draftkings_contests table (shared cache)
CREATE TABLE tenant_fantasy_ai.draftkings_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10),
  contest_date DATE,
  contest_type VARCHAR(20),
  external_contest_id TEXT,
  slate_name TEXT,
  game_ids TEXT[],
  salary_cap INT DEFAULT 50000,
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  data JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON tenant_fantasy_ai.draftkings_contests (sport, contest_date);
CREATE INDEX ON tenant_fantasy_ai.draftkings_contests (sport, contest_type, contest_date);
CREATE INDEX ON tenant_fantasy_ai.draftkings_contests (external_contest_id);

-- Create draftkings_player_salaries table (imported salary slate)
CREATE TABLE tenant_fantasy_ai.draftkings_player_salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(10) NOT NULL,
  contest_date DATE NOT NULL,
  contest_type VARCHAR(20) NOT NULL,
  contest_id UUID REFERENCES tenant_fantasy_ai.draftkings_contests(id) ON DELETE SET NULL,
  game_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT NOT NULL,
  salary INT NOT NULL CHECK (salary > 0),
  imported_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sport, contest_date, contest_type, player_name, position)
);
CREATE INDEX ON tenant_fantasy_ai.draftkings_player_salaries (sport, contest_date, contest_type);
CREATE INDEX ON tenant_fantasy_ai.draftkings_player_salaries (contest_id);
CREATE INDEX ON tenant_fantasy_ai.draftkings_player_salaries (game_id);
CREATE INDEX ON tenant_fantasy_ai.draftkings_player_salaries (player_id);

GRANT SELECT ON ALL TABLES IN SCHEMA tenant_fantasy_ai TO anon, authenticated;
GRANT INSERT ON tenant_fantasy_ai.mios_manifest TO authenticated;
GRANT INSERT ON tenant_fantasy_ai.ranked_lineups TO authenticated;
GRANT INSERT, UPDATE ON tenant_fantasy_ai.saved_lineups TO authenticated;

-- Enable RLS on all tables
ALTER TABLE tenant_fantasy_ai.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.mios_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.ranked_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.saved_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.player_last_5_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.social_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.draftkings_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fantasy_ai.draftkings_player_salaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- users: only user can read own row
CREATE POLICY users_select ON tenant_fantasy_ai.users FOR SELECT USING (auth.uid() = id);

-- mios_manifest: only user can read own manifests
CREATE POLICY mios_select ON tenant_fantasy_ai.mios_manifest FOR SELECT USING (auth.uid() = user_id);

-- ranked_lineups: only user can read own lineups
CREATE POLICY lineups_select ON tenant_fantasy_ai.ranked_lineups FOR SELECT USING (auth.uid() = user_id);

-- saved_lineups: only user can read own saved lineups
CREATE POLICY saved_select ON tenant_fantasy_ai.saved_lineups FOR SELECT USING (auth.uid() = user_id);

-- player_last_5_stats: public read (shared cache)
CREATE POLICY player_stats_select ON tenant_fantasy_ai.player_last_5_stats FOR SELECT USING (true);

-- social_sentiment: public read (shared cache)
CREATE POLICY sentiment_select ON tenant_fantasy_ai.social_sentiment FOR SELECT USING (true);

-- draftkings_contests: public read (shared cache)
CREATE POLICY contests_select ON tenant_fantasy_ai.draftkings_contests FOR SELECT USING (true);

-- draftkings_player_salaries: public read (shared imported slate)
CREATE POLICY salaries_select ON tenant_fantasy_ai.draftkings_player_salaries FOR SELECT USING (true);

-- Users can create and update their own scan artifacts.
CREATE POLICY mios_insert ON tenant_fantasy_ai.mios_manifest FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY lineups_insert ON tenant_fantasy_ai.ranked_lineups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_insert ON tenant_fantasy_ai.saved_lineups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_update ON tenant_fantasy_ai.saved_lineups
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
