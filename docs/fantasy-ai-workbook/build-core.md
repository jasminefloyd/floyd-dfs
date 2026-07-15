# YSNT Framework — Build: Core Phase

## What You're Building

Ugly but working end-to-end system. By end of this phase:
- Project scaffolded locally (`npm run dev` works)
- Supabase connected, all tables created
- MIOS collection functional (can fetch real data from ESPN, Reddit, Sleeper, Ergast)
- PIOS lineup generation working (respects salary cap, positions, stacking)
- Results display UI showing 3 lineups with projected points
- Zero console errors on happy path

No design polish. No Claude narratives yet. No error handling. Just working.

---

## Key Concept: Scaffold Then Fill

You're not building the final product yet. You're building the skeleton that actually runs. Get the data flowing end-to-end first, worry about quality later (Refinement phase).

---

## Your Build Core Phase

### Part 1 — Project Scaffold & Supabase Setup (~1.5 hrs)

Initialize the project, connect Supabase, create all tables.

**Prompt to Claude Code:**
```
You are building Fantasy AI, a DraftKings lineup generator.

TASK: Initialize React + Vite project with Supabase integration

1. Create a new Vite + React + TypeScript project in the current directory:
   npx create-vite@latest fantasy-ai --template react-ts
   cd fantasy-ai
   npm install

2. Install required dependencies:
   npm install @supabase/supabase-js react-router-dom axios dotenv shadcn-ui tailwind lucide-react

3. Initialize Tailwind CSS:
   npx tailwindcss init -p

4. Create .env.local file with required variables:
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_CLAUDE_API_KEY=your_claude_api_key
   VITE_OPENAI_API_KEY=your_openai_api_key
   VITE_REDDIT_CLIENT_ID=your_reddit_client_id
   VITE_REDDIT_CLIENT_SECRET=your_reddit_client_secret

   Create .env.example with same keys (no values) for GitHub

5. Create src/lib/supabaseClient.ts:
   Import createClient from @supabase/supabase-js
   Initialize client with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   Export client for use throughout app

6. Update src/App.jsx to use React Router:
   Setup basic routes:
   - "/" → ScanPage (main page)
   - "/design-system" → DesignSystem page (for design phase)
   Import BrowserRouter, Routes, Route
   Add Navigation component with links

7. Create folder structure:
   src/pages/
   src/components/
   src/lib/
   src/styles/
   src/agents/
   src/hooks/

8. Verify project runs:
   npm run dev
   Should start on http://localhost:5173 with no errors

9. Create Supabase schema file at supabase/schema.sql:
   
   -- Create users table
   CREATE TABLE users (
     id UUID PRIMARY KEY REFERENCES auth.users(id),
     email TEXT UNIQUE NOT NULL,
     tier VARCHAR(20) DEFAULT 'free',
     created_at TIMESTAMP DEFAULT NOW(),
     stripe_customer_id TEXT
   );
   
   -- Create player_last_5_stats table (shared cache)
   CREATE TABLE player_last_5_stats (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     player_id TEXT NOT NULL,
     sport VARCHAR(10) NOT NULL,
     last_updated_at TIMESTAMP DEFAULT NOW(),
     games_data JSONB,
     aggregated_stats JSONB,
     confidence_score FLOAT,
     expires_at TIMESTAMP,
     UNIQUE(player_id, sport),
     INDEX (player_id, sport),
     INDEX (last_updated_at)
   );
   
   -- Create mios_manifest table (per-user, per-scan)
   CREATE TABLE mios_manifest (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(id),
     sport VARCHAR(10) NOT NULL,
     contest_type VARCHAR(20) NOT NULL,
     contest_date DATE NOT NULL,
     created_at TIMESTAMP DEFAULT NOW(),
     data JSONB,
     INDEX (user_id, created_at)
   );
   
   -- Create ranked_lineups table
   CREATE TABLE ranked_lineups (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     manifest_id UUID NOT NULL REFERENCES mios_manifest(id),
     user_id UUID NOT NULL REFERENCES users(id),
     rank INT,
     lineup_data JSONB,
     projected_points FLOAT,
     salary_used INT,
     confidence_score FLOAT,
     narrative_explanation TEXT,
     created_at TIMESTAMP DEFAULT NOW(),
     INDEX (user_id, created_at)
   );
   
   -- Create saved_lineups table
   CREATE TABLE saved_lineups (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(id),
     lineup_id UUID NOT NULL REFERENCES ranked_lineups(id),
     sport VARCHAR(10),
     contest_date DATE,
     actual_points INT,
     user_feedback VARCHAR(20),
     created_at TIMESTAMP DEFAULT NOW(),
     INDEX (user_id, created_at)
   );
   
   -- Create social_sentiment table (shared cache)
   CREATE TABLE social_sentiment (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     player_id TEXT NOT NULL,
     sport VARCHAR(10) NOT NULL,
     reddit_mentions INT DEFAULT 0,
     sentiment_score FLOAT,
     key_themes TEXT[],
     last_updated_at TIMESTAMP DEFAULT NOW(),
     UNIQUE(player_id, sport),
     INDEX (player_id, sport)
   );
   
   -- Create draftkings_contests table (shared cache)
   CREATE TABLE draftkings_contests (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     sport VARCHAR(10),
     contest_date DATE,
     contest_type VARCHAR(20),
     game_ids TEXT[],
     salary_cap INT DEFAULT 50000,
     status VARCHAR(20),
     updated_at TIMESTAMP DEFAULT NOW(),
     INDEX (sport, contest_date)
   );
   
   -- Enable RLS on all tables
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   ALTER TABLE mios_manifest ENABLE ROW LEVEL SECURITY;
   ALTER TABLE ranked_lineups ENABLE ROW LEVEL SECURITY;
   ALTER TABLE saved_lineups ENABLE ROW LEVEL SECURITY;
   ALTER TABLE player_last_5_stats ENABLE ROW LEVEL SECURITY;
   ALTER TABLE social_sentiment ENABLE ROW LEVEL SECURITY;
   ALTER TABLE draftkings_contests ENABLE ROW LEVEL SECURITY;
   
   -- RLS Policies
   -- users: only user can read own row
   CREATE POLICY users_select ON users FOR SELECT USING (auth.uid() = id);
   
   -- mios_manifest: only user can read own manifests
   CREATE POLICY mios_select ON mios_manifest FOR SELECT USING (auth.uid() = user_id);
   
   -- ranked_lineups: only user can read own lineups
   CREATE POLICY lineups_select ON ranked_lineups FOR SELECT USING (auth.uid() = user_id);
   
   -- saved_lineups: only user can read own saved lineups
   CREATE POLICY saved_select ON saved_lineups FOR SELECT USING (auth.uid() = user_id);
   
   -- player_last_5_stats: public read (shared cache)
   CREATE POLICY player_stats_select ON player_last_5_stats FOR SELECT USING (true);
   
   -- social_sentiment: public read (shared cache)
   CREATE POLICY sentiment_select ON social_sentiment FOR SELECT USING (true);
   
   -- draftkings_contests: public read (shared cache)
   CREATE POLICY contests_select ON draftkings_contests FOR SELECT USING (true);

10. Paste this SQL into Supabase SQL Editor:
    - Go to your Supabase project
    - SQL Editor → New Query
    - Paste the schema.sql content
    - Run the query
    - Verify all tables created

11. Test Supabase connection from frontend:
    Create src/lib/testSupabase.ts:
    - Import supabaseClient
    - Test: supabaseClient.from('player_last_5_stats').select('*').limit(1)
    - Log results to console
    - Call this from App.jsx useEffect to verify connection works

Output: Project running locally, Supabase connected, all tables created, no errors.
```

---

### Part 2 — MIOS Collection Agents (~2 hrs)

Implement ESPN RSS, Stats API, Reddit, Sleeper, Ergast collectors. Wire them together.

**Prompt to Claude Code:**
```
You are implementing the MIOS (Market Intelligence Observation System) data collection agents for Fantasy AI.

TASK: Create MIOS agents that collect real-time sports data

1. Create src/lib/miosAgents.ts with agent definitions and stubs:

   // Type definitions for MIOS pipeline
   export interface Last5Game {
     date: string;
     opponent: string;
     minutes?: number;
     points?: number;
     rebounds?: number;
     assists?: number;
     steals?: number;
     blocks?: number;
     fg_pct?: number;
     usage_rate?: number;
     // NFL specific
     passing_yards?: number;
     passing_tds?: number;
     interceptions?: number;
     rushing_yards?: number;
     rushing_tds?: number;
     receiving_yards?: number;
     receiving_tds?: number;
     receptions?: number;
     snap_count?: number;
     targets?: number;
     air_yards?: number;
     // MLB specific
     at_bats?: number;
     hits?: number;
     doubles?: number;
     triples?: number;
     home_runs?: number;
     rbis?: number;
     runs?: number;
     strikeouts?: number;
     walks?: number;
     stolen_bases?: number;
     // F1 specific
     position?: number;
     qualifying_pos?: number;
     dnf_reason?: string;
     fastest_lap?: boolean;
     points?: number;
   }

   export interface Player {
     id: string;
     name: string;
     team: string;
     position: string;
     salary: number;
     injury_status: 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';
     last_5_stats?: {
       avg_points: number;
       avg_fantasy_pts: number;
       trend: 'up' | 'down' | 'stable';
       confidence: number;
       games: Last5Game[];
     };
   }

   export interface MiosManifest {
     manifest_id: string;
     sport: string;
     contest_type: string;
     contest_date: string;
     player_roster: Player[];
     injury_updates: { player_id: string; status: string; confidence: number }[];
     vegas_context: { game_id: string; spread: number; over_under: number; implied_total: number }[];
     social_sentiment: { player_id: string; mentions: number; sentiment_score: number; themes: string[] }[];
     catalysts: { type: string; player_id?: string; description: string }[];
     narrative_seeds: string[];
     collected_at: string;
   }

   // Agent 1: ESPN RSS News & Injuries
   export async function collectNewsAndInjuries(sport: string, contestDate: string): Promise<any[]> {
     const sportMap = {
       nba: 'https://feeds.espn.com/feeds/site/espn/nba/news',
       wnba: 'https://feeds.espn.com/feeds/site/espn/wnba/news',
       nfl: 'https://feeds.espn.com/feeds/site/espn/nfl/news',
       mlb: 'https://feeds.espn.com/feeds/site/espn/mlb/news',
       f1: 'https://feeds.espn.com/feeds/site/espn/racing/f1/news'
     };
     
     try {
       const feedUrl = sportMap[sport] || '';
       const response = await fetch(feedUrl);
       const xml = await response.text();
       
       // Parse XML for injury keywords (out, doubtful, questionable, day-to-day)
       const injuries = [];
       const lines = xml.split('\n');
       
       for (const line of lines) {
         if (line.includes('out') || line.includes('injured') || line.includes('questionable')) {
           injuries.push({
             raw: line,
             timestamp: new Date().toISOString()
           });
         }
       }
       
       return injuries;
     } catch (error) {
       console.error('ESPN RSS error:', error);
       return [];
     }
   }

   // Agent 2: ESPN Stats API - Last 5 Games
   export async function collectLast5Stats(playerId: string, sport: string): Promise<any> {
     // ESPN Stats API endpoints (reverse-engineered, public)
     const apiMap = {
       nba: `https://site.api.espn.com/v2/site/api/site/v2/sports/basketball/nba/players/${playerId}/statistics`,
       wnba: `https://site.api.espn.com/v2/site/api/site/v2/sports/basketball/wnba/players/${playerId}/statistics`,
       nfl: `https://site.api.espn.com/v2/site/api/site/v2/sports/football/nfl/players/${playerId}/statistics`,
       mlb: `https://site.api.espn.com/v2/site/api/site/v2/sports/baseball/mlb/players/${playerId}/statistics`,
       f1: null // Use Ergast for F1
     };
     
     try {
       if (!apiMap[sport]) return null;
       
       const response = await fetch(apiMap[sport]);
       const data = await response.json();
       
       // Parse last 5 games from response
       const games = data.stats?.slice(0, 5) || [];
       
       // Compute aggregated stats
       let totals = {};
       games.forEach(game => {
         Object.keys(game).forEach(key => {
           totals[key] = (totals[key] || 0) + (game[key] || 0);
         });
       });
       
       const avg = {};
       Object.keys(totals).forEach(key => {
         avg[key] = totals[key] / games.length;
       });
       
       return {
         player_id: playerId,
         games_data: games,
         aggregated_stats: avg,
         confidence_score: games.length === 5 ? 0.9 : 0.7,
         last_updated_at: new Date().toISOString()
       };
     } catch (error) {
       console.error(`ESPN Stats API error for ${playerId}:`, error);
       return null;
     }
   }

   // Agent 3: Reddit Sentiment (PRAW simulation)
   export async function collectRedditSentiment(playerId: string, sport: string): Promise<any> {
     const subreddits = {
       nba: ['nba', 'basketball'],
       wnba: ['wnba', 'basketball'],
       nfl: ['nfl', 'football'],
       mlb: ['baseball', 'mlb'],
       f1: ['formula1', 'f1']
     };
     
     try {
       const subs = subreddits[sport] || [];
       let mentions = 0;
       let sentimentSum = 0;
       
       // For Build Core, we'll simulate Reddit data
       // In Refinement, integrate actual PRAW library
       const mockSentiment = Math.random(); // 0-1 scale
       
       return {
         player_id: playerId,
         reddit_mentions: Math.floor(Math.random() * 100),
         sentiment_score: mockSentiment - 0.5, // -0.5 to 0.5
         key_themes: mockSentiment > 0.6 ? ['breakout'] : mockSentiment < 0.4 ? ['injury_concern'] : ['neutral'],
         last_updated_at: new Date().toISOString()
       };
     } catch (error) {
       console.error('Reddit sentiment error:', error);
       return null;
     }
   }

   // Agent 4: Sleeper Web Scrape (NBA/WNBA only)
   export async function collectSleeperProps(sport: string, contestDate: string): Promise<any[]> {
     if (!['nba', 'wnba'].includes(sport)) return [];
     
     try {
       // Sleeper API endpoint (public, no auth required)
       const sleeperId = sport === 'nba' ? 1 : 2; // Sport IDs
       const response = await fetch(`https://api.sleeper.app/v1/sport/${sleeperId}/players`);
       const data = await response.json();
       
       // Extract player props and game info
       return data.slice(0, 100).map(player => ({
         player_id: player.player_id,
         name: player.full_name,
         position: player.position,
         nfl_team: player.team // Sleeper calls NBA teams "nfl_team"
       }));
     } catch (error) {
       console.error('Sleeper error:', error);
       return [];
     }
   }

   // Agent 5: Ergast F1 API (F1 only)
   export async function collectF1Stats(season: number, round: number): Promise<any> {
     try {
       // Ergast API (public, no auth)
       const response = await fetch(`https://ergast.com/api/f1/${season}/${round}/drivers.json`);
       const data = await response.json();
       
       const drivers = data.MRData?.DriverTable?.Drivers || [];
       return drivers.map(driver => ({
         driver_id: driver.driverId,
         name: `${driver.givenName} ${driver.familyName}`,
         team: driver.Constructors?.[0]?.name,
         nationality: driver.nationality
       }));
     } catch (error) {
       console.error('Ergast F1 error:', error);
       return [];
     }
   }

   // Confidence Scorer
   export function scorePlayerConfidence(
     stats: any,
     injuryStatus: string,
     vegasExpectation: number,
     sentiment: number
   ): number {
     let score = 0.5; // Start at 0.5
     
     // Injury weight (40%)
     const injuryWeights = {
       active: 1.0,
       'day_to_day': 0.7,
       probable: 0.6,
       questionable: 0.4,
       doubtful: 0.2,
       out: 0
     };
     score += (injuryWeights[injuryStatus] || 0.5) * 0.4;
     
     // Stats consistency (30%)
     const consistency = stats?.confidence || 0.5;
     score += consistency * 0.3;
     
     // Vegas alignment (20%)
     score += (vegasExpectation * 0.1) * 0.2; // Normalize Vegas to 0-1
     
     // Sentiment (10%)
     score += ((sentiment + 1) / 2) * 0.1; // Convert -1 to 1 scale to 0-1
     
     return Math.min(Math.max(score, 0), 1); // Clamp 0-1
   }

2. Create src/agents/miosOrchestrator.ts:
   This ties all agents together and creates the MIOS manifest.

   export async function orchestrateMiosScan(
     sport: string,
     contestType: string,
     contestDate: string,
     userId: string
   ): Promise<MiosManifest> {
     console.log(`Starting MIOS scan: ${sport} ${contestDate}`);
     
     const startTime = Date.now();
     
     try {
       // Parallel collection (all at once, timeout 90 seconds)
       const [injuries, f1Drivers, sleeperPlayers] = await Promise.all([
         collectNewsAndInjuries(sport, contestDate),
         sport === 'f1' ? collectF1Stats(2026, 7) : Promise.resolve([]),
         collectSleeperProps(sport, contestDate)
       ]);
       
       // Build roster from collected data
       const playerRoster = [];
       
       if (sport === 'f1') {
         playerRoster.push(...f1Drivers);
       } else {
         playerRoster.push(...sleeperPlayers);
       }
       
       // For each player, collect last 5 stats and sentiment (in parallel batches)
       const statsPromises = playerRoster.slice(0, 20).map(player => 
         Promise.all([
           collectLast5Stats(player.player_id, sport),
           collectRedditSentiment(player.player_id, sport)
         ])
       );
       
       const allStats = await Promise.all(statsPromises);
       
       // Assemble MIOS manifest
       const manifest: MiosManifest = {
         manifest_id: crypto.randomUUID(),
         sport,
         contest_type: contestType,
         contest_date: contestDate,
         player_roster: playerRoster.map((player, idx) => ({
           ...player,
           last_5_stats: allStats[idx]?.[0],
           sentiment: allStats[idx]?.[1]
         })),
         injury_updates: injuries.map(inj => ({
           player_id: extractPlayerIdFromInjury(inj),
           status: extractInjuryStatus(inj),
           confidence: 0.8
         })),
         vegas_context: [],
         social_sentiment: allStats.map(stats => stats[1]).filter(Boolean),
         catalysts: [],
         narrative_seeds: [],
         collected_at: new Date().toISOString()
       };
       
       const elapsedTime = (Date.now() - startTime) / 1000;
       console.log(`MIOS scan completed in ${elapsedTime}s`);
       
       return manifest;
     } catch (error) {
       console.error('MIOS orchestration error:', error);
       throw error;
     }
   }

   // Helper functions
   function extractPlayerIdFromInjury(injuryLine: string): string {
     // Placeholder: would parse injury report to extract player ID
     return 'unknown';
   }

   function extractInjuryStatus(injuryLine: string): string {
     if (injuryLine.includes('out')) return 'out';
     if (injuryLine.includes('doubtful')) return 'doubtful';
     if (injuryLine.includes('questionable')) return 'questionable';
     return 'active';
   }

3. Test MIOS collection:
   - Create a test file: src/lib/__tests__/mios.test.ts
   - Test each agent with mock data
   - Verify MiosManifest structure
   - Run: npm test (if configured)

Output: MIOS agents collecting real data from ESPN, Reddit, Sleeper, Ergast. MiosManifest assembles all data.
```

---

### Part 3 — Scan UI & Results Display (~2 hrs)

Build ScanPage.jsx with controls and LineupDisplay.jsx to show results.

**Prompt to Claude Code:**
```
You are building the UI for Fantasy AI's scan interface and results display.

TASK: Create Scan page and Lineup display components

1. Create src/pages/ScanPage.jsx:

   import React, { useState, useEffect } from 'react';
   import { MiosScanner } from '../components/MiosScanner';
   import { LineupDisplay } from '../components/LineupDisplay';
   import { orchestrateMiosScan } from '../agents/miosOrchestrator';

   export function ScanPage() {
     const [loading, setLoading] = useState(false);
     const [miosManifest, setMiosManifest] = useState(null);
     const [lineups, setLineups] = useState([]);
     const [error, setError] = useState(null);

     const handleScan = async (params) => {
       setLoading(true);
       setError(null);
       
       try {
         // Call MIOS orchestrator
         const manifest = await orchestrateMiosScan(
           params.sport,
           params.contestType,
           params.contestDate,
           'temp-user-id' // TODO: Replace with actual user ID from auth
         );
         
         setMiosManifest(manifest);
         
         // TODO: Call Edge Function to generate PIOS lineups
         // For now, generate mock lineups from manifest data
         const mockLineups = generateMockLineups(manifest);
         setLineups(mockLineups);
         
       } catch (err) {
         setError(err.message);
         console.error('Scan error:', err);
       } finally {
         setLoading(false);
       }
     };

     return (
       <div className="flex min-h-screen bg-gray-50">
         {/* Left sidebar: Scan settings */}
         <div className="w-1/3 bg-white border-r border-gray-200 p-6 overflow-y-auto">
           <MiosScanner onScan={handleScan} loading={loading} />
         </div>

         {/* Right: Results display */}
         <div className="w-2/3 p-6 overflow-y-auto">
           {error && (
             <div className="bg-red-50 border border-red-200 p-4 rounded mb-4">
               <p className="text-red-700">{error}</p>
             </div>
           )}
           
           {loading ? (
             <div className="flex items-center justify-center h-96">
               <div className="text-center">
                 <div className="animate-spin rounded-full h-12 w-12 border border-blue-300 border-t-blue-600 mx-auto mb-4"></div>
                 <p className="text-gray-600">Scanning for opportunities...</p>
               </div>
             </div>
           ) : lineups.length > 0 ? (
             <div>
               <h2 className="text-2xl font-bold mb-6">Recommended Lineups</h2>
               <LineupDisplay lineups={lineups} manifest={miosManifest} />
             </div>
           ) : (
             <div className="text-center text-gray-500 py-12">
               <p>Select sport, contest type, and date, then click Scan to get started.</p>
             </div>
           )}
         </div>
       </div>
     );
   }

   function generateMockLineups(manifest) {
     // Temporary: Generate mock lineups from roster for testing
     const players = manifest.player_roster.slice(0, 6);
     
     return [
       {
         rank: 1,
         players: players,
         projected_points: Math.floor(Math.random() * 50) + 150,
         salary_used: 48500,
         confidence_score: 0.92,
         narrative: 'Strong core with upside plays in bench spots.'
       },
       {
         rank: 2,
         players: players.sort(() => 0.5 - Math.random()).slice(0, 6),
         projected_points: Math.floor(Math.random() * 50) + 140,
         salary_used: 49200,
         confidence_score: 0.87,
         narrative: 'Contrarian stack focusing on Vegas underdog.'
       },
       {
         rank: 3,
         players: players.sort(() => 0.5 - Math.random()).slice(0, 6),
         projected_points: Math.floor(Math.random() * 50) + 135,
         salary_used: 49800,
         confidence_score: 0.82,
         narrative: 'Safe lineup maximizing consistent producers.'
       }
     ];
   }

2. Create src/components/MiosScanner.jsx:

   import React, { useState } from 'react';
   import { SPORTS, CONTEST_TYPES } from '../lib/productConstants';

   export function MiosScanner({ onScan, loading }) {
     const [sport, setSport] = useState('nba');
     const [contestType, setContestType] = useState('showdown');
     const [contestDate, setContestDate] = useState(new Date().toISOString().split('T')[0]);
     const [excludedPlayers, setExcludedPlayers] = useState('');
     const [riskTolerance, setRiskTolerance] = useState('balanced');

     const handleScan = () => {
       onScan({
         sport,
         contestType,
         contestDate,
         excludedPlayers: excludedPlayers.split(',').map(p => p.trim()),
         riskTolerance
       });
     };

     return (
       <div className="space-y-6">
         <h2 className="text-2xl font-bold">Scan Settings</h2>

         {/* Sport Selection */}
         <div>
           <label className="block text-sm font-medium text-gray-700 mb-3">Sport</label>
           <div className="space-y-2">
             {SPORTS.map(s => (
               <label key={s} className="flex items-center">
                 <input
                   type="radio"
                   name="sport"
                   value={s}
                   checked={sport === s}
                   onChange={(e) => setSport(e.target.value)}
                   disabled={loading}
                   className="h-4 w-4"
                 />
                 <span className="ml-2 text-gray-700 uppercase">{s}</span>
               </label>
             ))}
           </div>
         </div>

         {/* Contest Type Selection */}
         <div>
           <label className="block text-sm font-medium text-gray-700 mb-3">Contest Type</label>
           <div className="space-y-2">
             {CONTEST_TYPES.map(ct => (
               <label key={ct} className="flex items-center">
                 <input
                   type="radio"
                   name="contestType"
                   value={ct}
                   checked={contestType === ct}
                   onChange={(e) => setContestType(e.target.value)}
                   disabled={loading}
                   className="h-4 w-4"
                 />
                 <span className="ml-2 text-gray-700 capitalize">{ct}</span>
               </label>
             ))}
           </div>
         </div>

         {/* Date Picker */}
         <div>
           <label className="block text-sm font-medium text-gray-700 mb-2">Contest Date</label>
           <input
             type="date"
             value={contestDate}
             onChange={(e) => setContestDate(e.target.value)}
             disabled={loading}
             className="w-full px-3 py-2 border border-gray-300 rounded-md"
           />
         </div>

         {/* Excluded Players */}
         <div>
           <label className="block text-sm font-medium text-gray-700 mb-2">Exclude Players</label>
           <textarea
             placeholder="LeBron, Luka, Giannis (comma-separated)"
             value={excludedPlayers}
             onChange={(e) => setExcludedPlayers(e.target.value)}
             disabled={loading}
             className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
             rows="3"
           />
         </div>

         {/* Risk Tolerance */}
         <div>
           <label className="block text-sm font-medium text-gray-700 mb-3">Risk Tolerance</label>
           <input
             type="range"
             min="0"
             max="2"
             step="1"
             value={riskTolerance === 'conservative' ? 0 : riskTolerance === 'balanced' ? 1 : 2}
             onChange={(e) => {
               const mapping = ['conservative', 'balanced', 'aggressive'];
               setRiskTolerance(mapping[parseInt(e.target.value)]);
             }}
             disabled={loading}
             className="w-full"
           />
           <div className="flex justify-between text-xs text-gray-500 mt-2">
             <span>Conservative</span>
             <span>Balanced</span>
             <span>Aggressive</span>
           </div>
         </div>

         {/* Scan Button */}
         <button
           onClick={handleScan}
           disabled={loading}
           className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-md transition"
         >
           {loading ? 'Scanning...' : 'SCAN NOW'}
         </button>
       </div>
     );
   }

3. Create src/components/LineupDisplay.jsx:

   import React from 'react';

   export function LineupDisplay({ lineups, manifest }) {
     return (
       <div className="space-y-6">
         {lineups.map((lineup) => (
           <div key={lineup.rank} className="bg-white rounded-lg border border-gray-200 p-6">
             {/* Header */}
             <div className="flex justify-between items-center mb-4">
               <div>
                 <h3 className="text-lg font-bold">Lineup #{lineup.rank}</h3>
                 <p className="text-sm text-gray-600">
                   Confidence: {(lineup.confidence_score * 100).toFixed(0)}%
                 </p>
               </div>
               <div className="text-right">
                 <div className="text-2xl font-bold text-blue-600">
                   {lineup.projected_points.toFixed(1)} pts
                 </div>
                 <div className="text-sm text-gray-600">
                   ${(lineup.salary_used / 1000).toFixed(1)}k / $50k
                 </div>
               </div>
             </div>

             {/* Narrative */}
             <p className="text-sm text-gray-700 mb-4 italic">{lineup.narrative}</p>

             {/* Player List */}
             <div className="space-y-2">
               {lineup.players.map((player, idx) => (
                 <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                   <div>
                     <p className="font-medium">{player.name || player.full_name}</p>
                     <p className="text-xs text-gray-600">
                       {player.position} • {player.team || player.nfl_team}
                     </p>
                   </div>
                   <div className="text-right">
                     <p className="font-bold">${player.salary}</p>
                     <p className="text-xs text-gray-600">
                       {player.last_5_stats?.avg_fantasy_pts?.toFixed(1) || '—'} avg
                     </p>
                   </div>
                 </div>
               ))}
             </div>

             {/* Action Buttons */}
             <div className="mt-4 flex gap-2">
               <button className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded font-semibold">
                 Save Lineup
               </button>
               <button className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 py-2 rounded font-semibold">
                 Copy to Clipboard
               </button>
             </div>
           </div>
         ))}
       </div>
     );
   }

4. Create src/components/Navigation.jsx:

   import React from 'react';
   import { Link } from 'react-router-dom';

   export function Navigation() {
     return (
       <nav className="bg-white border-b border-gray-200 px-6 py-4">
         <div className="flex items-center justify-between max-w-7xl mx-auto">
           <div className="flex items-center space-x-8">
             <Link to="/" className="font-bold text-lg text-blue-600">
               Fantasy AI
             </Link>
             <Link to="/" className="text-gray-700 hover:text-gray-900">
               Scan
             </Link>
             <Link to="/design-system" className="text-gray-700 hover:text-gray-900 text-sm">
               Design System
             </Link>
           </div>
           <div>
             {/* TODO: Add auth UI here */}
             <span className="text-gray-600">Not logged in</span>
           </div>
         </div>
       </nav>
     );
   }

5. Create src/lib/productConstants.ts:

   export const SPORTS = ['nba', 'wnba', 'nfl', 'mlb', 'f1'];
   export const CONTEST_TYPES = ['showdown', 'classic'];

   export const DK_SCORING = {
     nba: {
       points: 1,
       rebounds: 1.25,
       assists: 1.5,
       steals: 2,
       blocks: 2,
       turnovers: -0.5,
       three_pointers: 0.5
     },
     wnba: {
       points: 1,
       rebounds: 1.25,
       assists: 1.5,
       steals: 2,
       blocks: 2,
       turnovers: -0.5,
       three_pointers: 0.5
     },
     nfl: {
       passing_yards: 0.04,
       passing_td: 6,
       interception: -2,
       rushing_yards: 0.1,
       rushing_td: 6,
       receiving_yards: 0.1,
       receiving_td: 6,
       reception: 0.5
     },
     mlb: {
       single: 3,
       double: 6,
       triple: 9,
       home_run: 12,
       rbi: 1.5,
       run: 1.2,
       stolen_base: 3,
       strikeout: -0.5,
       walk: 1
     },
     f1: {
       position_finish: 1,
       pole_position: 1.5,
       fastest_lap: 1.5
     }
   };

Output: ScanPage works, can initiate scan, display mock lineups with player data.
```

---

### Part 4 — PIOS Lineup Generation (~1.5 hrs)

Implement lineup generator respecting DraftKings rules (salary cap, positions, stacking).

**Prompt to Claude Code:**
```
You are implementing the PIOS (Play Identification Opportunity System) lineup generation algorithm.

TASK: Generate ranked lineups respecting DraftKings rules

1. Create src/lib/piosGenerator.ts:

   import { DK_SCORING, SPORTS } from './productConstants';

   export interface LineupPlayerDraft {
     name: string;
     team: string;
     position: string;
     salary: number;
     player_id: string;
     confidence_score: number;
     last_5_avg_pts: number;
     injury_status: string;
   }

   export interface DraftLineup {
     players: LineupPlayerDraft[];
     projected_points: number;
     salary_used: number;
     confidence_score: number;
     constraint_violations: string[];
   }

   // DraftKings constraints per sport
   const POSITION_CONSTRAINTS = {
     nba: {
       PG: { min: 1, max: 1 },
       SG: { min: 1, max: 1 },
       SF: { min: 1, max: 1 },
       PF: { min: 1, max: 1 },
       C: { min: 1, max: 1 },
       UTIL: { min: 1, max: 1 }
     },
     wnba: {
       PG: { min: 1, max: 1 },
       SG: { min: 1, max: 1 },
       SF: { min: 1, max: 1 },
       PF: { min: 1, max: 1 },
       C: { min: 1, max: 1 },
       UTIL: { min: 1, max: 1 }
     },
     nfl: {
       QB: { min: 1, max: 2 },
       RB: { min: 2, max: 3 },
       WR: { min: 3, max: 4 },
       TE: { min: 1, max: 2 },
       K: { min: 1, max: 1 },
       DEF: { min: 1, max: 1 }
     },
     mlb: {
       C: { min: 1, max: 1 },
       '1B': { min: 1, max: 1 },
       '2B': { min: 1, max: 1 },
       '3B': { min: 1, max: 1 },
       SS: { min: 1, max: 1 },
       OF: { min: 3, max: 3 },
       UTIL: { min: 1, max: 1 },
       P: { min: 1, max: 1 }
     },
     f1: {
       // No position constraints, just driver
       DRIVER: { min: 0, max: 6 }
     }
   };

   export function generateLineups(
     roster: any[],
     sport: string,
     contestType: string,
     excludedPlayers: string[],
     riskTolerance: string
   ): DraftLineup[] {
     // Filter roster: remove injured, remove excluded
     const eligiblePlayers = roster.filter(p =>
       p.injury_status !== 'out' &&
       !excludedPlayers.includes(p.name?.toLowerCase())
     );

     // Sort by confidence score (high to low)
     const sortedByConfidence = eligiblePlayers.sort(
       (a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0)
     );

     // Generate candidate lineups
     const candidates: DraftLineup[] = [];

     if (contestType === 'showdown') {
       // Showdown: Captain (1.5x) + 5 field players
       candidates.push(...generateShowdownLineups(sortedByConfidence, sport));
     } else {
       // Classic: position constraints, multiple games
       candidates.push(...generateClassicLineups(sortedByConfidence, sport));
     }

     // Score and rank by confidence
     const rankedLineups = candidates
       .map(lineup => ({
         ...lineup,
         confidence_score: calculateLineupConfidence(lineup)
       }))
       .sort((a, b) => b.confidence_score - a.confidence_score)
       .slice(0, 5); // Top 5

     // Apply risk tolerance filter
     if (riskTolerance === 'conservative') {
       return rankedLineups.filter(lu => lu.confidence_score > 0.75);
     } else if (riskTolerance === 'aggressive') {
       return rankedLineups; // Keep all
     } else {
       return rankedLineups.slice(0, 3); // Balanced: top 3
     }
   }

   function generateShowdownLineups(players: any[], sport: string): DraftLineup[] {
     const lineups: DraftLineup[] = [];
     const salaryCapShowdown = 50000;

     // Try different captain selections
     const topCaptains = players.slice(0, 5);

     for (const captain of topCaptains) {
       const captainWithMultiplier = {
         ...captain,
         salary: Math.floor(captain.salary * 1.5),
         projected_points: (captain.last_5_avg_pts || 0) * 1.5
       };

       const remainingSalary = salaryCapShowdown - captainWithMultiplier.salary;
       const fieldPlayers = players
         .filter(p => p.player_id !== captain.player_id)
         .filter(p => p.salary <= remainingSalary)
         .sort((a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0))
         .slice(0, 5);

       if (fieldPlayers.length === 5) {
         const lineup: DraftLineup = {
           players: [captainWithMultiplier, ...fieldPlayers],
           projected_points: calculateProjectedPoints(
             [captainWithMultiplier, ...fieldPlayers],
             sport
           ),
           salary_used:
             captainWithMultiplier.salary + fieldPlayers.reduce((sum, p) => sum + p.salary, 0),
           confidence_score: 0 // Will be calculated later
         };

         if (lineup.salary_used <= salaryCapShowdown) {
           lineups.push(lineup);
         }
       }
     }

     return lineups;
   }

   function generateClassicLineups(players: any[], sport: string): DraftLineup[] {
     const lineups: DraftLineup[] = [];
     const salaryCap = 50000;
     const constraints = POSITION_CONSTRAINTS[sport];

     // Greedy algorithm: pick best players respecting constraints
     const positionFilledCount = {};
     const selectedPlayers: any[] = [];
     let totalSalary = 0;

     const sortedBySalary = players.sort((a, b) => b.last_5_avg_pts - a.last_5_avg_pts);

     for (const player of sortedBySalary) {
       if (totalSalary + player.salary > salaryCap) continue;

       const pos = player.position;
       const canAdd =
         !positionFilledCount[pos] ||
         (constraints[pos] && positionFilledCount[pos] < constraints[pos].max);

       if (canAdd) {
         selectedPlayers.push(player);
         positionFilledCount[pos] = (positionFilledCount[pos] || 0) + 1;
         totalSalary += player.salary;

         // Check if we have minimum required positions
         let isComplete = true;
         for (const [position, constraint] of Object.entries(constraints)) {
           if ((positionFilledCount[position] || 0) < constraint.min) {
             isComplete = false;
             break;
           }
         }

         if (isComplete && selectedPlayers.length >= 6) {
           lineups.push({
             players: selectedPlayers,
             projected_points: calculateProjectedPoints(selectedPlayers, sport),
             salary_used: totalSalary,
             confidence_score: 0 // Calculated later
           });

           // Reset for next lineup variant
           if (lineups.length >= 3) break;
         }
       }
     }

     return lineups;
   }

   function calculateProjectedPoints(players: any[], sport: string): number {
     // Sum of player average fantasy points
     return players.reduce((sum, p) => sum + (p.last_5_avg_pts || p.projected_points || 0), 0);
   }

   function calculateLineupConfidence(lineup: DraftLineup): number {
     // Average of player confidence scores
     const avgConfidence =
       lineup.players.reduce((sum, p) => sum + (p.confidence_score || 0.5), 0) /
       lineup.players.length;

     // Boost if salary near cap (efficient use)
     const salaryEfficiency = lineup.salary_used / 50000;
     const efficiencyBoost = Math.min(salaryEfficiency * 0.1, 0.1);

     // Penalize if injury concerns
     const injuryCount = lineup.players.filter(p => p.injury_status !== 'active').length;
     const injuryPenalty = injuryCount * 0.05;

     return Math.min(Math.max(avgConfidence + efficiencyBoost - injuryPenalty, 0), 1);
   }

2. Integrate PIOS into ScanPage.jsx:
   Replace generateMockLineups() with actual PIOS generation:

   import { generateLineups } from '../lib/piosGenerator';

   async function handleScan(params) {
     const manifest = await orchestrateMiosScan(...);
     
     // Generate real PIOS lineups
     const generatedLineups = generateLineups(
       manifest.player_roster,
       params.sport,
       params.contestType,
       params.excludedPlayers,
       params.riskTolerance
     );
     
     setLineups(generatedLineups);
   }

Output: PIOS generates valid lineups respecting salary cap, position constraints. Results display shows ranked lineups.
```

---

### Part 5 — Polish & End-to-End Testing (~30 min)

Walk through happy path, fix errors, commit.

**Prompt to Claude Code:**
```
Final testing and polish for Build Core phase.

TASK: Test end-to-end flow and fix any errors

1. Test the complete user flow:
   - Start app: npm run dev
   - Navigate to http://localhost:5173
   - Select sport: NBA
   - Select contest type: Showdown
   - Select date: Today or tomorrow
   - Click Scan
   - Observe: Loading spinner appears → MIOS collection runs → Lineups display

2. Check browser console for errors:
   - Open DevTools (F12)
   - Console tab should have NO red errors
   - Only warnings are acceptable (e.g., unused variables)
   - If errors appear, log them and fix

3. Fix common issues:
   - "Cannot read property of undefined" → Check data structure in agents
   - CORS errors → Check Supabase credentials in .env.local
   - Missing components → Verify imports match file paths exactly
   - Styling issues → Verify Tailwind CSS configured correctly

4. Test data flow:
   - MIOS agents collect real data from ESPN/Reddit/Sleeper
   - Manifest assembles correctly
   - PIOS generates valid lineups (salary cap ≤ $50K, positions filled)
   - LineupDisplay renders without errors

5. Commit to GitHub:
   git add -A
   git commit -m "Build Core: MIOS + PIOS + UI working end-to-end"
   git push origin main

Output: App runs locally, happy path works, no unhandled console errors, code committed.
```

---

## Build Core Deliverables Checklist

- [ ] Project running locally with `npm run dev`
- [ ] Supabase connected, all 7 tables created, RLS enabled
- [ ] MIOS agents collecting data (ESPN RSS, Stats API, Reddit, Sleeper, Ergast)
- [ ] MiosManifest assembles player roster + last-5-stats + injuries + sentiment
- [ ] PIOS lineup generation respects salary cap, positions, stacking
- [ ] ScanPage shows controls (sport, contest type, date, risk tolerance)
- [ ] LineupDisplay shows top 3-5 lineups with:
  - Players, positions, salaries
  - Projected points
  - Salary cap usage ($X/$50K)
  - Confidence scores
- [ ] No console errors on happy path (scan → results)
- [ ] Code committed to GitHub with clear commit message
- [ ] README.md updated with setup instructions

---

## Key Skills This Phase

- **API integration** — Calling real external APIs (ESPN, Reddit, Sleeper, Ergast)
- **Data aggregation** — Assembling data from multiple sources into one manifest
- **React component composition** — Building ScanPage, MiosScanner, LineupDisplay
- **Algorithm design** — PIOS lineup generator respecting constraints
- **Error handling basics** — Catching errors, logging, graceful fallbacks

---

## Tips

- **Don't over-engineer.** MIOS and PIOS are simple in Build Core. Add sophistication in Refinement.
- **Test with real data.** ESPN RSS, Stats API, and Sleeper are real. Use them. Don't mock everything.
- **Salary cap is load-bearing.** If PIOS is generating $51K+ lineups, fix immediately. This is non-negotiable.
- **Commit per-part, not per-phase.** You'll be glad you have checkpoints.
- **Design can wait.** Ugly works. Polish comes in Phase 5.

---

*Next up → Build Refinement: error handling, prompt tuning, data validation, rate limiting.*
