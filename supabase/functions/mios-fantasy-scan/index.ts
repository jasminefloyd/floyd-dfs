type InjuryStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';
type SourceStatus = Record<string, 'ok' | 'partial' | 'unavailable'>;

interface Last5Game {
  date: string;
  opponent: string;
  points?: number;
}

interface Player {
  id: string;
  espn_id?: string;
  name: string;
  team: string;
  position: string;
  salary: number;
  salary_source?: 'draftkings_import' | 'estimated';
  injury_status: InjuryStatus;
  injury_note?: string;
  projection_source?: 'last_5' | 'position_baseline';
  projected_points?: number;
  last_5_stats?: {
    avg_points: number;
    avg_fantasy_pts: number;
    trend: 'up' | 'down' | 'stable';
    confidence: number;
    games: Last5Game[];
  };
}

interface MiosManifest {
  manifest_id: string;
  sport: string;
  contest_type: string;
  contest_date: string;
  contest_id?: string;
  game_id?: string;
  slate?: DraftKingsSlate;
  player_roster: Player[];
  injury_updates: { player_id: string; status: string; confidence: number }[];
  vegas_context: { game_id: string; spread: number; over_under: number; implied_total: number }[];
  social_sentiment: { player_id: string; mentions: number; sentiment_score: number; themes: string[] }[];
  catalysts: { type: string; player_id?: string; description: string }[];
  narrative_seeds: string[];
  source_status: SourceStatus;
  data_warnings: string[];
  collected_at: string;
}

interface ScanRequest {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  slate?: DraftKingsSlate;
  userId?: string;
}

interface DraftKingsSlate {
  contest_id: string;
  external_contest_id?: string | null;
  sport: string;
  contest_type: string;
  contest_date: string;
  slate_name: string;
  game_ids: string[];
  salary_cap: number;
  status?: string | null;
  start_time?: string | null;
  salary_count?: number;
  data?: Record<string, unknown>;
  updated_at?: string;
}

interface SlateEventData {
  id?: string;
  odds?: {
    provider?: string | null;
    details?: string | null;
    over_under?: number | null;
    spread?: number | null;
  } | null;
}

interface AuthResult {
  userId: string | null;
  email: string | null;
  required: boolean;
}

interface DraftKingsSalaryRow {
  player_id: string | null;
  player_name: string;
  team: string | null;
  position: string;
  salary: number;
  game_id?: string | null;
  projected_points?: number;
}

interface CachedSentimentRow {
  player_id: string;
  sport: string;
  reddit_mentions: number;
  sentiment_score: number;
  key_themes: string[];
  last_updated_at: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'f1']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const manifestCache = new Map<string, { manifest: MiosManifest; cachedAt: number }>();
const lastRequestAt = new Map<string, number>();
const FRESH_CACHE_MS = 2 * 60 * 60 * 1000;
const LAST5_CACHE_HOURS = 24;

const SPORT_ROUTE: Record<string, { path: string; teamLimit: number }> = {
  nba: { path: 'basketball/nba', teamLimit: 30 },
  wnba: { path: 'basketball/wnba', teamLimit: 16 },
  nfl: { path: 'football/nfl', teamLimit: 32 },
  mlb: { path: 'baseball/mlb', teamLimit: 30 },
};

const POSITION_BASELINES: Record<string, Record<string, number>> = {
  nba: { PG: 29, SG: 27, SF: 26, PF: 27, C: 30, G: 27, F: 27 },
  wnba: { PG: 24, SG: 22, SF: 22, PF: 23, C: 25, G: 22, F: 23 },
  nfl: { QB: 18, RB: 13, WR: 12, TE: 9, DST: 7, DEF: 7 },
  mlb: { P: 15, SP: 16, RP: 7, C: 6, '1B': 8, '2B': 7, '3B': 8, SS: 8, OF: 8 },
  f1: { DRIVER: 14 },
};

const CLASSIC_TARGETS: Record<string, Record<string, number>> = {
  nba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  wnba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  nfl: { QB: 8, RB: 12, WR: 16, TE: 8, DST: 4 },
  mlb: { P: 14, C: 4, '1B': 4, '2B': 4, '3B': 4, SS: 4, OF: 12 },
  f1: { DRIVER: 20 },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envSupabaseAnonKey() {
  return Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY');
}

function envSupabaseServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

function envRedditClientId() {
  return Deno.env.get('REDDIT_CLIENT_ID') ?? Deno.env.get('VITE_REDDIT_CLIENT_ID');
}

function envRedditClientSecret() {
  return Deno.env.get('REDDIT_CLIENT_SECRET') ?? Deno.env.get('VITE_REDDIT_CLIENT_SECRET');
}

async function callSupabaseRpc<T>(
  functionName: string,
  body: Record<string, unknown>,
  options: { serviceRole?: boolean; allowMissingServiceRole?: boolean } = {},
): Promise<T | null> {
  const supabaseUrl = envSupabaseUrl();
  const anonKey = envSupabaseAnonKey();
  const serviceRoleKey = envSupabaseServiceRoleKey();
  const apiKey = options.serviceRole ? serviceRoleKey : anonKey;

  if (!supabaseUrl || !apiKey) {
    if (options.allowMissingServiceRole) return null;
    throw new Error(`Supabase RPC environment is not configured for ${functionName}`);
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${functionName} failed: ${response.status} ${message}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

async function limitedFetch(url: string, service: string, options: RequestInit & {
  timeoutMs?: number;
  retries?: number;
  dedupeMs?: number;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  const dedupeMs = options.dedupeMs ?? 500;

  const now = Date.now();
  const last = lastRequestAt.get(service) ?? 0;
  const waitMs = Math.max(0, dedupeMs - (now - last));
  if (waitMs > 0) await delay(waitMs);
  lastRequestAt.set(service, Date.now());

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (response.status === 429 && attempt < retries) {
        await delay(Math.min(1000 * 2 ** attempt, 16_000));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) await delay(Math.min(1000 * 2 ** attempt, 16_000));
    }
  }

  throw lastError;
}

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

async function validateFunctionAuth(req: Request, requestedUserId: string): Promise<AuthResult> {
  const required = Deno.env.get('REQUIRE_API_AUTH') === 'true';
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!required && !requestedUserId) {
    return { userId: null, email: null, required };
  }

  if (!token) {
    if (required) throw new Error('Missing Authorization bearer token');
    return { userId: null, email: null, required };
  }

  const supabaseUrl = envSupabaseUrl();
  const supabaseAnonKey = envSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase auth environment is not configured');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) throw new Error('Invalid Authorization bearer token');
  const data = await response.json() as { id?: string; email?: string };
  if (!data.id) throw new Error('Invalid Authorization bearer token');
  if (requestedUserId && requestedUserId !== data.id) throw new Error('Request user does not match token user');

  return { userId: data.id, email: data.email ?? null, required };
}

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function salaryKey(name: string, position: string) {
  return `${normalizeName(name)}:${String(position ?? '').toUpperCase()}`;
}

function salaryNameTeamKey(name: string, team: string | null | undefined) {
  return `${normalizeName(name)}:${String(team ?? '').toUpperCase()}`;
}

function normalizeInjuryStatus(raw: unknown): InjuryStatus {
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
  if ((sport === 'nba' || sport === 'wnba') && position.includes('/')) return position;
  if (sport === 'mlb' && ['LF', 'CF', 'RF'].includes(position)) return 'OF';
  if (sport === 'nfl' && position === 'D/ST') return 'DST';
  if ((sport === 'nba' || sport === 'wnba') && position === 'G-F') return 'SG';
  if ((sport === 'nba' || sport === 'wnba') && position === 'F-C') return 'PF';
  return position || (sport === 'f1' ? 'DRIVER' : 'UTIL');
}

function rawPositionValue(raw: Record<string, any>): unknown {
  const position = raw.position;
  if (position && typeof position === 'object') {
    return position.abbreviation ?? position.name ?? position.displayName;
  }
  return position ?? raw.fantasy_positions?.[0];
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

async function collectDraftKingsSalaries(sport: string, contestDate: string, contestType: string, contestId?: string): Promise<DraftKingsSalaryRow[]> {
  const rows = await callSupabaseRpc<DraftKingsSalaryRow[]>('fantasy_ai_get_draftkings_salaries', {
    p_sport: sport,
    p_contest_date: contestDate,
    p_contest_type: contestType,
    p_contest_id: contestId || null,
  }, { allowMissingServiceRole: true }).catch((error) => {
    console.error('DraftKings salary lookup failed:', error);
    return null;
  });
  return rows ?? [];
}

function slateSalaryRows(slate?: DraftKingsSlate): DraftKingsSalaryRow[] {
  const salaries = slate?.data?.salaries;
  if (!Array.isArray(salaries)) return [];

  return salaries
    .map((row: any) => ({
      player_id: row.player_id ? String(row.player_id) : null,
      player_name: String(row.player_name ?? ''),
      team: row.team ? String(row.team) : null,
      position: String(row.position ?? ''),
      salary: Number(row.salary),
      game_id: row.game_id ? String(row.game_id) : null,
      projected_points: Number.isFinite(Number(row.projected_points)) ? Number(row.projected_points) : undefined,
    }))
    .filter((row) => row.player_name && row.position && Number.isFinite(row.salary) && row.salary > 0);
}

function applyDraftKingsSalaries(players: Player[], salaries: DraftKingsSalaryRow[]) {
  if (!salaries.length) return players;

  const byPlayerId = new Map(salaries.filter((row) => row.player_id).map((row) => [String(row.player_id), row]));
  const byNamePosition = new Map(salaries.map((row) => [salaryKey(row.player_name, row.position), row]));
  const byNameTeam = new Map(
    salaries
      .filter((row) => row.team)
      .map((row) => [salaryNameTeamKey(row.player_name, row.team), row]),
  );
  const rowsByName = new Map<string, DraftKingsSalaryRow[]>();
  for (const row of salaries) {
    const key = normalizeName(row.player_name);
    rowsByName.set(key, [...(rowsByName.get(key) ?? []), row]);
  }
  const byUniqueName = new Map(
    [...rowsByName.entries()]
      .filter(([, rows]) => rows.length === 1)
      .map(([name, rows]) => [name, rows[0]]),
  );

  return players.map((player) => {
    const salaryRow = byPlayerId.get(player.id)
      ?? byNamePosition.get(salaryKey(player.name, player.position))
      ?? byNameTeam.get(salaryNameTeamKey(player.name, player.team))
      ?? byUniqueName.get(normalizeName(player.name));
    if (!salaryRow) return player;
    return {
      ...player,
      salary: salaryRow.salary,
      salary_source: 'draftkings_import' as const,
      projected_points: typeof salaryRow.projected_points === 'number' && salaryRow.projected_points > 0
        ? salaryRow.projected_points
        : player.projected_points,
    };
  });
}

function slateTeamAbbreviations(slate?: DraftKingsSlate): string[] {
  const rawTeams = slate?.data?.team_abbreviations;
  if (!Array.isArray(rawTeams)) return [];
  return rawTeams
    .map((team) => String(team).toUpperCase())
    .filter(Boolean);
}

function filterRosterBySlateTeams(players: Player[], slate?: DraftKingsSlate): Player[] {
  const teams = new Set(slateTeamAbbreviations(slate));
  if (!teams.size) return players;

  const filtered = players.filter((player) => teams.has(String(player.team).toUpperCase()));
  return filtered.length ? filtered : players;
}

function slateEvents(slate?: DraftKingsSlate): SlateEventData[] {
  const event = slate?.data?.event;
  const events = slate?.data?.events;

  if (Array.isArray(events)) return events as SlateEventData[];
  if (event && typeof event === 'object') return [event as SlateEventData];
  return [];
}

function buildVegasContext(slate?: DraftKingsSlate): MiosManifest['vegas_context'] {
  return slateEvents(slate)
    .map((event) => {
      const overUnder = Number(event.odds?.over_under);
      const spread = Number(event.odds?.spread);
      return {
        game_id: String(event.id ?? slate?.game_ids?.[0] ?? slate?.contest_id ?? ''),
        spread: Number.isFinite(spread) ? spread : 0,
        over_under: Number.isFinite(overUnder) ? overUnder : 0,
        implied_total: Number.isFinite(overUnder) ? Number((overUnder / 2).toFixed(2)) : 0,
      };
    })
    .filter((context) => context.game_id);
}

function hasFreeOddsContext(slate?: DraftKingsSlate): boolean {
  return buildVegasContext(slate).some((context) => context.over_under || context.spread);
}

function buildBaselineGames(projectedPoints: number): Last5Game[] {
  return Array.from({ length: 5 }, (_, idx) => ({
    date: `baseline-${idx + 1}`,
    opponent: 'N/A',
    points: Math.max(0, Math.round(projectedPoints * (0.72 + idx * 0.06))),
  }));
}

function toPlayer(raw: Record<string, any>, sport: string): Player | null {
  const id = String(raw.player_id ?? raw.driver_id ?? raw.id ?? raw.driver_number ?? '');
  const name = String(raw.name ?? raw.full_name ?? raw.displayName ?? raw.display_name ?? '');
  const position = normalizePosition(rawPositionValue(raw), sport);
  const team = String(raw.team ?? raw.team_name ?? raw.team_abbr ?? '');
  if (!id || !name || !position) return null;

  const injuryStatus = normalizeInjuryStatus(raw.injury_status ?? raw.status ?? raw.injuries?.[0]?.status);
  const projected = baselineProjection(position, sport);

  return {
    id,
    espn_id: raw.espn_id ? String(raw.espn_id) : undefined,
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
      games: buildBaselineGames(projected),
    },
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

async function collectNewsAndInjuries(sport: string): Promise<any[]> {
  const sportMap: Record<string, string> = {
    nba: 'https://feeds.espn.com/feeds/site/espn/nba/news',
    wnba: 'https://feeds.espn.com/feeds/site/espn/wnba/news',
    nfl: 'https://feeds.espn.com/feeds/site/espn/nfl/news',
    mlb: 'https://feeds.espn.com/feeds/site/espn/mlb/news',
    f1: 'https://feeds.espn.com/feeds/site/espn/racing/f1/news',
  };

  try {
    const response = await limitedFetch(sportMap[sport], 'espn-news', { timeoutMs: 5000, retries: 1 });
    const xml = await response.text();
    return xml
      .split('\n')
      .filter((line) => line.includes('out') || line.includes('injured') || line.includes('questionable'))
      .map((raw) => ({ raw, timestamp: new Date().toISOString() }));
  } catch (error) {
    console.error('ESPN RSS error:', error);
    return [];
  }
}

async function collectSleeperProps(sport: string): Promise<any[]> {
  if (!['nba', 'wnba', 'nfl'].includes(sport)) return [];

  try {
    const response = await limitedFetch(`https://api.sleeper.app/v1/players/${sport}`, 'sleeper', {
      timeoutMs: 10_000,
      retries: 1,
    });
    const data = await response.json() as Record<string, any>;
    return Object.values(data)
      .filter((player) => player.active !== false && player.status !== 'RET')
      .map((player) => ({
        player_id: player.player_id,
        name: player.full_name,
        position: player.position ?? player.fantasy_positions?.[0],
        team: player.team,
        injury_status: player.injury_status,
        injury_notes: player.injury_notes,
        injury_body_part: player.injury_body_part,
        status: player.status,
        fantasy_positions: player.fantasy_positions,
      }));
  } catch (error) {
    console.error('Sleeper error:', error);
    return [];
  }
}

async function collectF1Stats(): Promise<any[]> {
  try {
    const response = await limitedFetch('https://api.openf1.org/v1/drivers?session_key=latest', 'openf1', {
      timeoutMs: 10_000,
      retries: 1,
    });
    if (!response.ok) throw new Error(`OpenF1 ${response.status}`);
    const data = await response.json() as any[];
    return data.map((driver) => ({
      driver_id: String(driver.driver_number),
      name: driver.full_name,
      team: driver.team_name,
      position: 'DRIVER',
      nationality: driver.country_code,
      headshot_url: driver.headshot_url,
    }));
  } catch (error) {
    console.error('OpenF1 error:', error);
    return [];
  }
}

async function collectEspnRosters(sport: string): Promise<Player[]> {
  const route = SPORT_ROUTE[sport];
  if (!route) return [];

  const teamsResponse = await limitedFetch(`https://site.api.espn.com/apis/site/v2/sports/${route.path}/teams`, 'espn-teams', {
    timeoutMs: 5000,
    retries: 1,
  });
  if (!teamsResponse.ok) throw new Error(`ESPN teams ${teamsResponse.status}`);
  const teamsData = await teamsResponse.json() as any;
  const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? [];

  const rosters = await Promise.all(
    teams.slice(0, route.teamLimit).map(async (entry: any) => {
      const teamId = entry?.team?.id;
      if (!teamId) return [];
      const response = await limitedFetch(`https://site.api.espn.com/apis/site/v2/sports/${route.path}/teams/${teamId}/roster`, 'espn-rosters', {
        timeoutMs: 8000,
        retries: 1,
      });
      if (!response.ok) return [];
      const data = await response.json() as any;
      const groups = Array.isArray(data.athletes) ? data.athletes : [];
      const athletes = groups.flatMap((group: any) => group.items ?? group);
      return athletes
        .map((athlete: any) => toPlayer({
          ...athlete,
          player_id: athlete.id,
          espn_id: athlete.id,
          team: data?.team?.abbreviation,
        }, sport))
        .filter(Boolean) as Player[];
    }),
  );

  return rosters.flat();
}

async function collectEspnRosterIndex(sport: string): Promise<Map<string, string>> {
  const players = await collectEspnRosters(sport);
  return new Map(players.map((player) => [normalizeName(player.name), player.espn_id ?? player.id]));
}

async function collectRoster(sport: string, warnings: string[], sourceStatus: SourceStatus): Promise<Player[]> {
  if (sport === 'f1') {
    const drivers = await collectF1Stats();
    sourceStatus.openf1 = drivers.length ? 'ok' : 'unavailable';
    return drivers.map((driver) => toPlayer(driver, sport)).filter(Boolean) as Player[];
  }

  if (['nba', 'wnba', 'nfl'].includes(sport)) {
    const [sleeperPlayers, espnIndex] = await Promise.all([
      collectSleeperProps(sport),
      collectEspnRosterIndex(sport).catch((error) => {
        warnings.push(`ESPN roster ID index unavailable: ${String(error)}`);
        return new Map<string, string>();
      }),
    ]);
    const filtered = sleeperPlayers.map((player) => toPlayer(player, sport)).filter(Boolean) as Player[];
    const fantasyRelevant = filtered.map((player) => ({
      ...player,
      espn_id: player.espn_id ?? espnIndex.get(normalizeName(player.name)),
    })).filter((player) => {
      if (!player.team) return false;
      if (sport === 'nfl') return ['QB', 'RB', 'WR', 'TE', 'DST', 'DEF'].includes(player.position);
      if (player.position.includes('/')) return player.position.split('/').some((position) => ['PG', 'SG', 'SF', 'PF', 'C'].includes(position));
      return ['PG', 'SG', 'SF', 'PF', 'C'].includes(player.position);
    });

    if (fantasyRelevant.length) {
      sourceStatus.sleeper_roster = 'ok';
      return fantasyRelevant;
    }
    sourceStatus.sleeper_roster = 'unavailable';
    warnings.push('Sleeper roster source returned no usable fantasy players.');
  }

  try {
    const espnPlayers = await collectEspnRosters(sport);
    sourceStatus.espn_roster = espnPlayers.length ? 'ok' : 'unavailable';
    if (!espnPlayers.length) warnings.push('ESPN roster source returned no players.');
    return espnPlayers;
  } catch (error) {
    sourceStatus.espn_roster = 'unavailable';
    warnings.push(`ESPN roster source failed: ${String(error)}`);
    return [];
  }
}

interface CachedLast5Row {
  player_id: string;
  sport: string;
  games_data: any[];
  aggregated_stats: Record<string, number>;
  confidence_score: number;
  last_updated_at: string;
  expires_at: string;
}

function parseNumber(value: unknown): number {
  const parsed = Number(String(value ?? '').split('-')[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fantasyPointsForGame(game: Record<string, number>, sport: string) {
  if (sport === 'nba' || sport === 'wnba') {
    return (
      game.points +
      game.totalRebounds * 1.25 +
      game.assists * 1.5 +
      game.steals * 2 +
      game.blocks * 2 -
      game.turnovers * 0.5
    );
  }
  return game.points;
}

function aggregateGames(games: Record<string, any>[], sport: string) {
  const totals: Record<string, number> = {};
  for (const game of games) {
    for (const [key, value] of Object.entries(game)) {
      if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value;
    }
  }

  const averages: Record<string, number> = {};
  for (const [key, value] of Object.entries(totals)) {
    averages[key] = Number((value / games.length).toFixed(2));
  }
  averages.avg_fantasy_pts = Number((games.reduce((sum, game) => sum + fantasyPointsForGame(game, sport), 0) / games.length).toFixed(2));
  averages.fantasy_points = averages.avg_fantasy_pts;
  return averages;
}

function parseEspnGamelog(data: any, sport: string) {
  const names: string[] = data?.names ?? [];
  const regularSeason = data?.seasonTypes?.find((season: any) => /regular/i.test(season?.displayName ?? '')) ?? data?.seasonTypes?.[0];
  const rawEvents = regularSeason?.categories?.flatMap((category: any) => category.events ?? []) ?? [];
  const games = rawEvents.slice(0, 5).map((event: any) => {
    const stats = event?.stats ?? [];
    const game: Record<string, any> = {
      date: data?.events?.[event.eventId]?.gameDate ?? String(event.eventId ?? ''),
      opponent: data?.events?.[event.eventId]?.opponent?.abbreviation ?? 'N/A',
    };
    names.forEach((name, index) => {
      game[name] = parseNumber(stats[index]);
    });
    game.fantasy_points = Number(fantasyPointsForGame(game as Record<string, number>, sport).toFixed(2));
    return game;
  });

  if (games.length === 0) return null;
  return {
    games_data: games,
    aggregated_stats: aggregateGames(games, sport),
    confidence_score: games.length === 5 ? 0.9 : 0.7,
    last_updated_at: new Date().toISOString(),
  };
}

async function getCachedLast5Stats(playerId: string, sport: string): Promise<any | null> {
  const rows = await callSupabaseRpc<CachedLast5Row[]>('fantasy_ai_get_cached_last5_stats', {
    p_player_id: playerId,
    p_sport: sport,
  }, { allowMissingServiceRole: true }).catch(() => null);
  return rows?.[0] ?? null;
}

async function cacheLast5Stats(playerId: string, sport: string, stats: any) {
  const expiresAt = new Date(Date.now() + LAST5_CACHE_HOURS * 60 * 60 * 1000).toISOString();
  await callSupabaseRpc('fantasy_ai_upsert_last5_stats', {
    p_player_id: playerId,
    p_sport: sport,
    p_games_data: stats.games_data,
    p_aggregated_stats: stats.aggregated_stats,
    p_confidence_score: stats.confidence_score,
    p_expires_at: expiresAt,
  }, { serviceRole: true, allowMissingServiceRole: true }).catch((error) => {
    console.error('Last-5 cache write failed:', error);
  });
}

async function collectLast5Stats(player: Player, sport: string): Promise<any> {
  const cached = await getCachedLast5Stats(player.id, sport);
  if (cached?.games_data?.length) return cached;
  if (!player.espn_id || sport === 'f1') return null;

  const sportPath: Record<string, string> = {
    nba: 'basketball/nba',
    wnba: 'basketball/wnba',
    nfl: 'football/nfl',
    mlb: 'baseball/mlb',
  };
  const path = sportPath[sport];
  if (!path) return null;

  try {
    const response = await limitedFetch(
      `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${player.espn_id}/gamelog`,
      'espn-last5',
      { timeoutMs: 12_000, retries: 1, dedupeMs: 250 },
    );
    if (!response.ok) throw new Error(`ESPN gamelog ${response.status}`);
    const data = await response.json();
    const stats = parseEspnGamelog(data, sport);
    if (stats?.games_data?.length) await cacheLast5Stats(player.id, sport, stats);
    return stats;
  } catch (error) {
    console.error(`ESPN gamelog error for ${player.name}:`, error);
    return null;
  }
}

async function getCachedSocialSentiment(playerId: string, sport: string): Promise<any | null> {
  const rows = await callSupabaseRpc<CachedSentimentRow[]>('fantasy_ai_get_cached_social_sentiment', {
    p_player_id: playerId,
    p_sport: sport,
  }, { allowMissingServiceRole: true }).catch(() => null);
  const row = rows?.[0];
  if (!row) return null;
  return {
    player_id: row.player_id,
    reddit_mentions: row.reddit_mentions,
    sentiment_score: row.sentiment_score,
    key_themes: row.key_themes ?? ['cached'],
    source_status: 'ok',
    last_updated_at: row.last_updated_at,
  };
}

async function cacheSocialSentiment(sentiment: any, sport: string) {
  await callSupabaseRpc('fantasy_ai_upsert_social_sentiment', {
    p_player_id: sentiment.player_id,
    p_sport: sport,
    p_reddit_mentions: sentiment.reddit_mentions,
    p_sentiment_score: sentiment.sentiment_score,
    p_key_themes: sentiment.key_themes,
  }, { serviceRole: true, allowMissingServiceRole: true }).catch((error) => {
    console.error('Social sentiment cache write failed:', error);
  });
}

async function getRedditAccessToken(): Promise<string | null> {
  const clientId = envRedditClientId();
  const clientSecret = envRedditClientSecret();
  if (!clientId || !clientSecret) return null;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await limitedFetch('https://www.reddit.com/api/v1/access_token', 'reddit-auth', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'fantasy-ai-core/1.0',
    },
    body: 'grant_type=client_credentials',
    timeoutMs: 10_000,
    retries: 1,
  });

  if (!response.ok) return null;
  const data = await response.json() as { access_token?: string };
  return data.access_token ?? null;
}

async function collectRedditSentiment(playerId: string, sport: string): Promise<any> {
  const cached = await getCachedSocialSentiment(playerId, sport);
  if (cached) return cached;

  try {
    const token = await getRedditAccessToken();
    if (!token) {
      return {
        player_id: playerId,
        reddit_mentions: 0,
        sentiment_score: 0,
        key_themes: ['reddit_credentials_missing'],
        source_status: 'unavailable',
        last_updated_at: new Date().toISOString(),
      };
    }

    const subreddit = sport === 'f1' ? 'formula1' : sport;
    const response = await limitedFetch(
      `https://oauth.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(playerId)}&restrict_sr=1&limit=10&sort=new`,
      'reddit',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'fantasy-ai-core/1.0',
        },
        timeoutMs: 30_000,
        retries: 1,
      },
    );

    if (!response.ok) {
      return {
        player_id: playerId,
        reddit_mentions: 0,
        sentiment_score: 0,
        key_themes: ['reddit_unavailable'],
        source_status: 'unavailable',
        last_updated_at: new Date().toISOString(),
      };
    }

    const data = await response.json() as any;
    const posts = data?.data?.children ?? [];
    const text = posts.map((post: any) => `${post?.data?.title ?? ''} ${post?.data?.selftext ?? ''}`).join(' ').toLowerCase();
    const positive = ['breakout', 'hot', 'healthy', 'starting', 'upgrade', 'smash'];
    const negative = ['injury', 'out', 'questionable', 'limited', 'slump', 'bench'];
    const posHits = positive.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    const negHits = negative.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    const sentiment = Math.max(-1, Math.min(1, (posHits - negHits) / 5));

    const sentimentResult = {
      player_id: playerId,
      reddit_mentions: posts.length,
      sentiment_score: sentiment,
      key_themes: posts.length === 0 ? ['no_mentions'] : ['neutral'],
      source_status: 'ok',
      last_updated_at: new Date().toISOString(),
    };
    await cacheSocialSentiment(sentimentResult, sport);
    return sentimentResult;
  } catch (error) {
    console.error('Reddit sentiment error:', error);
    return {
      player_id: playerId,
      reddit_mentions: 0,
      sentiment_score: 0,
      key_themes: ['reddit_unavailable'],
      source_status: 'unavailable',
      last_updated_at: new Date().toISOString(),
    };
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
      games,
    },
  };
}

async function orchestrateMiosFantasyScan(
  sport: string,
  contestType: string,
  contestDate: string,
  userId: string,
  contestId?: string,
  gameId?: string,
  slate?: DraftKingsSlate,
): Promise<MiosManifest> {
  void userId;
  if (!VALID_SPORTS.has(sport)) throw new Error(`Unsupported sport: ${sport}`);
  if (!VALID_CONTEST_TYPES.has(contestType)) throw new Error(`Unsupported contest type: ${contestType}`);
  validateContestDate(contestDate);

  const sourceStatus: SourceStatus = {};
  const warnings: string[] = [];

  const [injuries, roster, salaryRows] = await Promise.all([
    collectNewsAndInjuries(sport),
    collectRoster(sport, warnings, sourceStatus),
    collectDraftKingsSalaries(sport, contestDate, contestType, contestId),
  ]);
  const liveSlateSalaryRows = slateSalaryRows(slate);
  const effectiveSalaryRows = salaryRows.length ? salaryRows : liveSlateSalaryRows;
  sourceStatus.espn_news = injuries.length ? 'partial' : 'partial';
  sourceStatus.draftkings_salaries = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.draftkings_salary_source = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.free_game_schedule = slate?.status === 'schedule_derived' || slate?.data?.source === 'espn_scoreboard' ? 'ok' : 'unavailable';
  sourceStatus.free_odds = hasFreeOddsContext(slate) ? 'ok' : 'unavailable';

  let playerRoster = filterRosterBySlateTeams(applyDraftKingsSalaries(dedupePlayers(roster), effectiveSalaryRows), slate);
  if (slateTeamAbbreviations(slate).length && playerRoster.length === roster.length) {
    warnings.push('Selected slate included team metadata, but roster filtering did not reduce the player pool.');
  }
  if (!playerRoster.length) warnings.push('No roster players were collected; lineups cannot be generated.');
  if (playerRoster.some((player) => player.salary_source === 'estimated')) {
    warnings.push(
      salaryRows.length
        ? 'Persisted DraftKings salary slate was partially matched; unmatched players use deterministic estimated salaries.'
        : liveSlateSalaryRows.length
          ? 'Live DraftKings salary slate was partially matched; unmatched players use deterministic estimated salaries.'
        : 'No DraftKings salary slate rows found for this sport/date/contest type; using deterministic estimated salaries.',
    );
  }
  if (sourceStatus.free_odds === 'unavailable') {
    warnings.push('Verified free odds context is unavailable for the selected game; lineup confidence excludes odds signals.');
  }
  if (!enoughForClassic(playerRoster, sport) && contestType === 'classic') {
    warnings.push('Roster may not contain enough position depth for a complete classic lineup.');
  }

  const statAndSentiment = await Promise.all(
    playerRoster.slice(0, 30).map(async (player) => {
      const [stats, sentiment] = await Promise.all([
        collectLast5Stats(player, sport),
        collectRedditSentiment(player.name, sport),
      ]);
      return { playerId: player.id, stats, sentiment };
    }),
  );

  const statsByPlayer = new Map(statAndSentiment.map((item) => [item.playerId, item.stats]));
  playerRoster = playerRoster.map((player) => applyLast5Stats(player, statsByPlayer.get(player.id), sport));
  sourceStatus.espn_last5 = statAndSentiment.some((item) => item.stats?.games_data?.length) ? 'partial' : 'unavailable';
  sourceStatus.projections = sourceStatus.espn_last5 === 'unavailable' ? 'partial' : 'ok';
  sourceStatus.reddit_sentiment = statAndSentiment.some((item) => item.sentiment?.source_status === 'ok') ? 'partial' : 'unavailable';

  if (sourceStatus.espn_last5 === 'unavailable') {
    warnings.push('Verified last-5 game stats are unavailable; using position baseline projections.');
  }
  if (sourceStatus.reddit_sentiment === 'unavailable') {
    warnings.push(
      envRedditClientId() && envRedditClientSecret()
        ? 'Reddit sentiment unavailable or blocked; sentiment score is neutral.'
        : 'Reddit API credentials are not configured and no cached sentiment was found; sentiment score is neutral.',
    );
  }

  const socialSentiment = statAndSentiment.map((item) => item.sentiment).filter(Boolean).map((item) => ({
    player_id: item.player_id,
    mentions: item.reddit_mentions,
    sentiment_score: item.sentiment_score,
    themes: item.key_themes,
  }));

  return {
    manifest_id: crypto.randomUUID(),
    sport,
    contest_type: contestType,
    contest_date: contestDate,
    contest_id: contestId,
    game_id: gameId,
    slate,
    player_roster: playerRoster,
    injury_updates: playerRoster
      .filter((player) => player.injury_status !== 'active')
      .map((player) => ({ player_id: player.id, status: player.injury_status, confidence: 0.8 })),
    vegas_context: buildVegasContext(slate),
    social_sentiment: socialSentiment,
    catalysts: warnings.map((description) => ({ type: 'data_warning', description })),
    narrative_seeds: warnings,
    source_status: sourceStatus,
    data_warnings: warnings,
    collected_at: new Date().toISOString(),
  };
}

async function persistMiosManifest(manifest: MiosManifest, auth: AuthResult): Promise<MiosManifest> {
  if (!auth.userId) {
    return {
      ...manifest,
      data_warnings: [...manifest.data_warnings, 'Manifest persistence skipped because no authenticated user was provided.'],
      source_status: { ...manifest.source_status, manifest_persistence: 'unavailable' },
    };
  }

  if (!auth.email) {
    return {
      ...manifest,
      data_warnings: [...manifest.data_warnings, 'Manifest persistence skipped because the authenticated user email was unavailable.'],
      source_status: { ...manifest.source_status, manifest_persistence: 'unavailable' },
    };
  }

  try {
    await callSupabaseRpc('fantasy_ai_ensure_user', {
      p_user_id: auth.userId,
      p_email: auth.email,
    }, { serviceRole: true });

    const persistedId = await callSupabaseRpc<string>('fantasy_ai_insert_mios_manifest', {
      p_user_id: auth.userId,
      p_sport: manifest.sport,
      p_contest_type: manifest.contest_type,
      p_contest_date: manifest.contest_date,
      p_data: manifest,
    }, { serviceRole: true });

    if (!persistedId) throw new Error('Manifest insert did not return an id');

    return {
      ...manifest,
      manifest_id: persistedId,
      source_status: { ...manifest.source_status, manifest_persistence: 'ok' },
    };
  } catch (error) {
    return {
      ...manifest,
      data_warnings: [
        ...manifest.data_warnings,
        `Manifest persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      source_status: { ...manifest.source_status, manifest_persistence: 'unavailable' },
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: ScanRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const sport = String(payload.sport ?? '').toLowerCase();
  const contestType = String(payload.contestType ?? '').toLowerCase();
  const contestDate = String(payload.contestDate ?? '');
  const contestId = payload.contestId ? String(payload.contestId) : undefined;
  const gameId = payload.gameId ? String(payload.gameId) : undefined;
  const slate = payload.slate;
  const userId = String(payload.userId ?? '');
  const cacheKey = `${sport}:${contestType}:${contestDate}:${contestId ?? 'no-contest'}:${gameId ?? 'all-games'}`;

  try {
    if (slate) {
      if (String(slate.sport).toLowerCase() !== sport) throw new Error('Selected slate sport does not match request sport');
      if (String(slate.contest_type).toLowerCase() !== contestType) throw new Error('Selected slate contest type does not match request contest type');
      if (String(slate.contest_date) !== contestDate) throw new Error('Selected slate date does not match request contest date');
      if (contestId && String(slate.contest_id) !== contestId) throw new Error('Selected slate contest_id does not match request contestId');
    }

    const auth = await validateFunctionAuth(req, userId);
    const effectiveUserId = auth.userId ?? userId;
    const cached = manifestCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < FRESH_CACHE_MS) {
      return jsonResponse({
        ...cached.manifest,
        data_warnings: [...cached.manifest.data_warnings, 'Using cached scan data from the last two hours.'],
        source_status: { ...cached.manifest.source_status, scan_cache: 'ok' },
      });
    }

    const manifest = await withTimeout(
      orchestrateMiosFantasyScan(sport, contestType, contestDate, effectiveUserId ?? '', contestId, gameId, slate),
      90_000,
      'MIOS scan timed out after 90 seconds',
    );
    const persistedManifest = await persistMiosManifest(manifest, auth);
    manifestCache.set(cacheKey, { manifest: persistedManifest, cachedAt: Date.now() });
    return jsonResponse(persistedManifest);
  } catch (error) {
    const cached = manifestCache.get(cacheKey);
    if (cached) {
      return jsonResponse({
        ...cached.manifest,
        data_warnings: [
          ...cached.manifest.data_warnings,
          `Live scan failed; using cached data. Reason: ${error instanceof Error ? error.message : String(error)}`,
        ],
        source_status: { ...cached.manifest.source_status, scan_cache: 'partial' },
      });
    }

    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
