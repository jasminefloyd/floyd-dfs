import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Last5Game, MIOS_FantasyManifest, Player } from '../../src/lib/MIOS_FantasyAgents';
import { collectNewsAndInjuries } from './news-injuries';
import { collectLast5Stats } from './last5-stats';
import { collectRedditSentiment } from './reddit-sentiment';
import { collectSleeperProps } from './sleeper-props';
import { collectF1Stats } from './f1-stats';
import { limitedFetch } from './rate-limiter';
import { validateApiAuth } from './auth';

type SourceStatus = MIOS_FantasyManifest['source_status'];
type CachedManifest = { manifest: MIOS_FantasyManifest; cachedAt: number };

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'f1']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const manifestCache = new Map<string, CachedManifest>();
const FRESH_CACHE_MS = 2 * 60 * 60 * 1000;

const SPORT_ROUTE: Record<string, { path: string; league: string; teamLimit: number }> = {
  nba: { path: 'basketball/nba', league: 'nba', teamLimit: 8 },
  wnba: { path: 'basketball/wnba', league: 'wnba', teamLimit: 8 },
  nfl: { path: 'football/nfl', league: 'nfl', teamLimit: 8 },
  mlb: { path: 'baseball/mlb', league: 'mlb', teamLimit: 8 }
};

const POSITION_BASELINES: Record<string, Record<string, number>> = {
  nba: { PG: 29, SG: 27, SF: 26, PF: 27, C: 30, G: 27, F: 27 },
  wnba: { PG: 24, SG: 22, SF: 22, PF: 23, C: 25, G: 22, F: 23 },
  nfl: { QB: 18, RB: 13, WR: 12, TE: 9, DST: 7, DEF: 7 },
  mlb: { P: 15, SP: 16, RP: 7, C: 6, '1B': 8, '2B': 7, '3B': 8, SS: 8, OF: 8 },
  f1: { DRIVER: 14 }
};

const CLASSIC_TARGETS: Record<string, Record<string, number>> = {
  nba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  wnba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  nfl: { QB: 8, RB: 12, WR: 16, TE: 8, DST: 4 },
  mlb: { P: 14, C: 4, '1B': 4, '2B': 4, '3B': 4, SS: 4, OF: 12 },
  f1: { DRIVER: 20 }
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function validateContestDate(contestDate: string) {
  const selected = new Date(`${contestDate}T00:00:00`);
  if (!contestDate || Number.isNaN(selected.getTime())) throw new Error('Invalid contest date');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selected < today) throw new Error('Contest date must be today or later');
}

function normalizeInjuryStatus(raw: unknown): Player['injury_status'] {
  const text = String(raw ?? '').toLowerCase();
  if (text.includes('out') || text.includes('injured reserve') || text === 'ir') return 'out';
  if (text.includes('doubt')) return 'doubtful';
  if (text.includes('question')) return 'questionable';
  if (text.includes('prob')) return 'probable';
  if (text.includes('day') || text === 'dtd') return 'day_to_day';
  return 'active';
}

function normalizePosition(raw: unknown, sport: string): string {
  const position = String(raw ?? '').toUpperCase();
  if (sport === 'mlb' && ['LF', 'CF', 'RF'].includes(position)) return 'OF';
  if (sport === 'nfl' && position === 'D/ST') return 'DST';
  if ((sport === 'nba' || sport === 'wnba') && position === 'G-F') return 'SG';
  if ((sport === 'nba' || sport === 'wnba') && position === 'F-C') return 'PF';
  return position || (sport === 'f1' ? 'DRIVER' : 'UTIL');
}

function baselineProjection(position: string, sport: string): number {
  return POSITION_BASELINES[sport]?.[position] ?? 8;
}

function estimatedSalary(projectedPoints: number, position: string, sport: string): number {
  const positionPremium = ['QB', 'P', 'SP', 'C', 'DRIVER'].includes(position) ? 800 : 0;
  const sportPremium = sport === 'f1' ? 3500 : sport === 'nfl' ? 2500 : 3000;
  const salary = sportPremium + positionPremium + Math.round(projectedPoints * 145);
  return Math.max(3000, Math.min(12000, Math.round(salary / 100) * 100));
}

function buildBaselineGames(projectedPoints: number): Last5Game[] {
  return Array.from({ length: 5 }, (_, idx) => ({
    date: `baseline-${idx + 1}`,
    opponent: 'N/A',
    points: Math.max(0, Math.round(projectedPoints * (0.72 + idx * 0.06))),
  }));
}

function toPlayer(raw: any, sport: string): Player | null {
  const id = String(raw.player_id ?? raw.driver_id ?? raw.id ?? raw.driver_number ?? '');
  const name = String(raw.name ?? raw.full_name ?? raw.displayName ?? raw.display_name ?? '');
  const position = normalizePosition(raw.position ?? raw.fantasy_positions?.[0], sport);
  const team = String(raw.team ?? raw.team_name ?? raw.team_abbr ?? '');
  if (!id || !name || !position) return null;

  const injuryStatus = normalizeInjuryStatus(raw.injury_status ?? raw.status ?? raw.injuries?.[0]?.status);
  const projected = baselineProjection(position, sport);

  return {
    id,
    name,
    team,
    position,
    salary: estimatedSalary(projected, position, sport),
    salary_source: 'estimated',
    injury_status: injuryStatus,
    injury_note: raw.injury_notes ?? raw.injury_body_part ?? raw.injuries?.[0]?.status,
    projection_source: 'position_baseline',
    projected_points: projected,
    last_5_stats: {
      avg_points: projected,
      avg_fantasy_pts: projected,
      trend: 'stable',
      confidence: 0.45,
      games: buildBaselineGames(projected)
    }
  };
}

function dedupePlayers(players: Player[]): Player[] {
  const seen = new Set<string>();
  const deduped: Player[] = [];
  for (const player of players) {
    const key = player.id || `${player.name}-${player.team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(player);
  }
  return deduped;
}

function enoughForClassic(players: Player[], sport: string): boolean {
  const targets = CLASSIC_TARGETS[sport];
  if (!targets) return players.length >= 6;
  const counts = players.reduce<Record<string, number>>((acc, player) => {
    acc[player.position] = (acc[player.position] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(targets).every(([position, needed]) => (counts[position] ?? 0) >= needed);
}

async function collectEspnRosters(sport: string): Promise<Player[]> {
  const route = SPORT_ROUTE[sport];
  if (!route) return [];

  const teamsResponse = await limitedFetch(`https://site.api.espn.com/apis/site/v2/sports/${route.path}/teams`, 'espn-teams', {
    timeoutMs: 5000,
    retries: 1
  });
  if (!teamsResponse.ok) throw new Error(`ESPN teams ${teamsResponse.status}`);
  const teamsData: any = await teamsResponse.json();
  const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? [];

  const rosters = await Promise.all(
    teams.slice(0, route.teamLimit).map(async (entry: any) => {
      const teamId = entry?.team?.id;
      if (!teamId) return [];
      const response = await limitedFetch(`https://site.api.espn.com/apis/site/v2/sports/${route.path}/teams/${teamId}/roster`, 'espn-rosters', {
        timeoutMs: 8000,
        retries: 1
      });
      if (!response.ok) return [];
      const data: any = await response.json();
      const groups = Array.isArray(data.athletes) ? data.athletes : [];
      const athletes = groups.flatMap((group: any) => group.items ?? group);
      return athletes
        .map((athlete: any) => toPlayer({ ...athlete, team: data?.team?.abbreviation }, sport))
        .filter(Boolean) as Player[];
    })
  );

  return rosters.flat();
}

async function collectRoster(sport: string, warnings: string[], sourceStatus: SourceStatus): Promise<Player[]> {
  if (sport === 'f1') {
    const drivers = await collectF1Stats(new Date().getFullYear(), 1);
    sourceStatus.openf1 = drivers.length ? 'ok' : 'unavailable';
    return drivers.map((driver) => toPlayer(driver, sport)).filter(Boolean) as Player[];
  }

  if (['nba', 'wnba', 'nfl'].includes(sport)) {
    const sleeperPlayers = await collectSleeperProps(sport, new Date().toISOString().slice(0, 10));
    const filtered = sleeperPlayers
      .map((player) => toPlayer(player, sport))
      .filter(Boolean) as Player[];
    const fantasyRelevant = filtered.filter((player) => {
      if (!player.team) return false;
      if (sport === 'nfl') return ['QB', 'RB', 'WR', 'TE', 'DST', 'DEF'].includes(player.position);
      return ['PG', 'SG', 'SF', 'PF', 'C'].includes(player.position);
    });

    if (fantasyRelevant.length) {
      sourceStatus.sleeper_roster = 'ok';
      return fantasyRelevant.slice(0, 180);
    }
    sourceStatus.sleeper_roster = 'unavailable';
    warnings.push('Sleeper roster source returned no usable fantasy players.');
  }

  try {
    const espnPlayers = await collectEspnRosters(sport);
    sourceStatus.espn_roster = espnPlayers.length ? 'ok' : 'unavailable';
    if (!espnPlayers.length) warnings.push('ESPN roster source returned no players.');
    return espnPlayers.slice(0, 180);
  } catch (error) {
    sourceStatus.espn_roster = 'unavailable';
    warnings.push(`ESPN roster source failed: ${String(error)}`);
    return [];
  }
}

function applyLast5Stats(player: Player, stats: any, sport: string): Player {
  const games = stats?.games_data;
  const avg = stats?.aggregated_stats?.avg_fantasy_pts ?? stats?.aggregated_stats?.fantasy_points;
  if (!Array.isArray(games) || games.length === 0 || typeof avg !== 'number') return player;

  return {
    ...player,
    projection_source: 'last_5',
    projected_points: avg,
    salary: player.salary_source === 'estimated' ? estimatedSalary(avg, player.position, sport) : player.salary,
    last_5_stats: {
      avg_points: avg,
      avg_fantasy_pts: avg,
      trend: 'stable',
      confidence: stats.confidence_score ?? 0.7,
      games
    }
  };
}

export async function orchestrateMIOS_FantasyScan(
  sport: string,
  contestType: string,
  contestDate: string,
  userId: string
): Promise<MIOS_FantasyManifest> {
  void userId;
  if (!VALID_SPORTS.has(sport)) throw new Error(`Unsupported sport: ${sport}`);
  if (!VALID_CONTEST_TYPES.has(contestType)) throw new Error(`Unsupported contest type: ${contestType}`);
  validateContestDate(contestDate);

  const sourceStatus: SourceStatus = {};
  const warnings: string[] = [];

  const [injuries, roster] = await Promise.all([
    collectNewsAndInjuries(sport, contestDate),
    collectRoster(sport, warnings, sourceStatus)
  ]);
  sourceStatus.espn_news = injuries.length ? 'partial' : 'partial';

  let playerRoster = dedupePlayers(roster);
  if (!playerRoster.length) warnings.push('No roster players were collected; lineups cannot be generated.');

  if (playerRoster.some((player) => player.salary_source === 'estimated')) {
    warnings.push('DraftKings salary import not found; using deterministic estimated salaries.');
  }
  if (!enoughForClassic(playerRoster, sport) && contestType === 'classic') {
    warnings.push('Roster may not contain enough position depth for a complete classic lineup.');
  }

  const statAndSentiment = await Promise.all(
    playerRoster.slice(0, 30).map(async (player) => {
      const [stats, sentiment] = await Promise.all([
        collectLast5Stats(player.id, sport),
        collectRedditSentiment(player.name, sport)
      ]);
      return { playerId: player.id, stats, sentiment };
    })
  );

  const statsByPlayer = new Map(statAndSentiment.map((item) => [item.playerId, item.stats]));
  playerRoster = playerRoster.map((player) => applyLast5Stats(player, statsByPlayer.get(player.id), sport));
  sourceStatus.espn_last5 = statAndSentiment.some((item) => item.stats?.games_data?.length) ? 'partial' : 'unavailable';
  sourceStatus.reddit_sentiment = statAndSentiment.some((item) => item.sentiment?.source_status === 'ok') ? 'partial' : 'unavailable';

  if (sourceStatus.espn_last5 === 'unavailable') {
    warnings.push('Verified last-5 game stats are unavailable; using position baseline projections.');
  }
  if (sourceStatus.reddit_sentiment === 'unavailable') {
    warnings.push('Reddit sentiment unavailable or blocked; sentiment score is neutral.');
  }

  const socialSentiment = statAndSentiment.map((item) => item.sentiment).filter(Boolean).map((item) => ({
    player_id: item.player_id,
    mentions: item.reddit_mentions,
    sentiment_score: item.sentiment_score,
    themes: item.key_themes
  }));

  return {
    manifest_id: crypto.randomUUID(),
    sport,
    contest_type: contestType,
    contest_date: contestDate,
    player_roster: playerRoster,
    injury_updates: playerRoster
      .filter((player) => player.injury_status !== 'active')
      .map((player) => ({
        player_id: player.id,
        status: player.injury_status,
        confidence: 0.8
      })),
    vegas_context: [],
    social_sentiment: socialSentiment,
    catalysts: warnings.map((description) => ({ type: 'data_warning', description })),
    narrative_seeds: warnings,
    source_status: sourceStatus,
    data_warnings: warnings,
    collected_at: new Date().toISOString()
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sport = String(req.query.sport ?? '').toLowerCase();
  const contestType = String(req.query.contestType ?? '').toLowerCase();
  const contestDate = String(req.query.contestDate ?? '');
  const userId = String(req.query.userId ?? '');
  const cacheKey = `${sport}:${contestType}:${contestDate}`;

  try {
    const auth = await validateApiAuth(req, userId);
    const effectiveUserId = auth.userId ?? userId;
    const cached = manifestCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < FRESH_CACHE_MS) {
      res.status(200).json({
        ...cached.manifest,
        data_warnings: [
          ...cached.manifest.data_warnings,
          'Using cached scan data from the last two hours.'
        ],
        source_status: {
          ...cached.manifest.source_status,
          scan_cache: 'ok'
        }
      });
      return;
    }

    const manifest = await withTimeout(
      orchestrateMIOS_FantasyScan(sport, contestType, contestDate, effectiveUserId ?? ''),
      90_000,
      'MIOS scan timed out after 90 seconds'
    );
    manifestCache.set(cacheKey, { manifest, cachedAt: Date.now() });
    res.status(200).json(manifest);
  } catch (error) {
    const cached = manifestCache.get(cacheKey);
    if (cached) {
      res.status(200).json({
        ...cached.manifest,
        data_warnings: [
          ...cached.manifest.data_warnings,
          `Live scan failed; using cached data. Reason: ${error instanceof Error ? error.message : String(error)}`
        ],
        source_status: {
          ...cached.manifest.source_status,
          scan_cache: 'partial'
        }
      });
      return;
    }

    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
