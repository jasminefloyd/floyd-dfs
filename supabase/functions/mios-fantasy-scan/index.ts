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
  image_url?: string;
  team_logo_url?: string;
  position: string;
  salary: number;
  salary_source?: 'draftkings_import' | 'estimated';
  injury_status: InjuryStatus;
  injury_note?: string;
  projection_source?: 'last_5' | 'position_baseline';
  projected_points?: number;
  news_score?: number;
  news_note?: string;
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

interface OddsContext {
  game_id: string;
  spread: number;
  over_under: number;
  implied_total: number;
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
  status?: string | null;
  is_disabled?: boolean;
  is_confirmed_starter?: boolean;
  image_url?: string | null;
  team_logo_url?: string | null;
}

interface CachedSentimentRow {
  player_id: string;
  sport: string;
  reddit_mentions: number;
  sentiment_score: number;
  key_themes: string[];
  last_updated_at: string;
}

interface RedditFeedItem {
  title: string;
  content: string;
  link: string;
  updated: string;
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
const LAST5_CACHE_HOURS = 24;
const SCAN_LOOKAHEAD_DAYS = 2;
const SCAN_LOOKAHEAD_HOURS = 48;
const REDDIT_RSS_CACHE_MS = 15 * 60 * 1000;
const redditRssCache = new Map<string, { items: RedditFeedItem[]; cachedAt: number }>();

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

function envOddsApiKey() {
  return Deno.env.get('THE_ODDS_API_KEY') ?? Deno.env.get('VITE_THE_ODDS_API_KEY');
}

function envOddsApiBaseUrl() {
  return Deno.env.get('THE_ODDS_API_BASE_URL') ?? Deno.env.get('VITE_ODDS_API_BASE_URL') ?? 'https://api.the-odds-api.com/v4';
}

function envBalldontlieApiKey() {
  return Deno.env.get('BALLDONTLIE_API_KEY') ?? Deno.env.get('VITE_BALLDONTLIE_API_KEY') ?? Deno.env.get('VITE_BALLDONTLIE_KEY');
}

function envSportsDataIoKey() {
  return Deno.env.get('SPORTSDATAIO_API_KEY')
    ?? Deno.env.get('SPORTS_DATA_IO_KEY')
    ?? Deno.env.get('VITE_SPORTSDATAIO_API_KEY')
    ?? Deno.env.get('VITE_SPORTS_DATA_IO_KEY');
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
  const latestAllowedDate = new Date(today);
  latestAllowedDate.setDate(today.getDate() + SCAN_LOOKAHEAD_DAYS);
  if (selected < today) throw new Error('Contest date must be today or later');
  if (selected > latestAllowedDate) throw new Error('Contest date is outside the supported slate window');
}

function validateSlateStartWindow(slate?: DraftKingsSlate) {
  if (!slate?.start_time) return;
  const startTime = new Date(slate.start_time);
  if (Number.isNaN(startTime.getTime())) throw new Error('Selected slate start time is invalid');

  const now = new Date();
  const latestAllowedTime = new Date(now.getTime() + SCAN_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  if (startTime < now || startTime > latestAllowedTime) {
    throw new Error('Selected slate must start within the next 48 hours');
  }
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
      status: row.status ? String(row.status) : null,
      is_disabled: Boolean(row.is_disabled),
      is_confirmed_starter: Boolean(row.is_confirmed_starter),
      image_url: row.image_url ? String(row.image_url) : null,
      team_logo_url: row.team_logo_url ? String(row.team_logo_url) : null,
    }))
    .filter((row) => row.player_name && row.position && Number.isFinite(row.salary) && row.salary > 0);
}

function draftKingsStatusToInjuryStatus(row: DraftKingsSalaryRow): InjuryStatus {
  const status = String(row.status ?? '').toLowerCase();
  if (row.is_disabled || status === 'il' || status.includes('out')) return 'out';
  return 'active';
}

function applyDraftKingsSalaries(players: Player[], salaries: DraftKingsSalaryRow[], sport: string): Player[] {
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
  const usedSalaryRows = new Set<DraftKingsSalaryRow>();

  const matchedPlayers = players.map((player) => {
    const salaryRow = byPlayerId.get(player.id)
      ?? byNamePosition.get(salaryKey(player.name, player.position))
      ?? byNameTeam.get(salaryNameTeamKey(player.name, player.team))
      ?? byUniqueName.get(normalizeName(player.name));
    if (!salaryRow) return player;
    usedSalaryRows.add(salaryRow);
    return {
      ...player,
      salary: salaryRow.salary,
      salary_source: 'draftkings_import' as const,
      injury_status: draftKingsStatusToInjuryStatus(salaryRow),
      injury_note: salaryRow.status && salaryRow.status !== 'None' ? `DraftKings status: ${salaryRow.status}` : player.injury_note,
      image_url: player.image_url ?? salaryRow.image_url ?? undefined,
      team_logo_url: player.team_logo_url ?? salaryRow.team_logo_url ?? teamLogoFallbackUrl(sport, salaryRow.team ?? undefined),
      projected_points: typeof salaryRow.projected_points === 'number' && salaryRow.projected_points > 0
        ? salaryRow.projected_points
        : player.projected_points,
    };
  }).filter((player) => player.salary_source === 'draftkings_import');

  const unmatchedPlayers = salaries
    .filter((salaryRow) => !usedSalaryRows.has(salaryRow))
    .map((salaryRow) => draftKingsSalaryRowToPlayer(salaryRow, sport));

  return dedupePlayers([...matchedPlayers, ...unmatchedPlayers]);
}

function draftKingsSalaryRowToPlayer(row: DraftKingsSalaryRow, sport: string): Player {
  const position = normalizePosition(row.position, sport);
  const projected = typeof row.projected_points === 'number' && row.projected_points > 0
    ? row.projected_points
    : baselineProjection(position, sport);

  return {
    id: row.player_id ? `dk:${row.player_id}` : `dk:${normalizeName(row.player_name)}:${position}`,
    name: row.player_name,
    team: row.team ?? '',
    image_url: row.image_url ?? undefined,
    team_logo_url: row.team_logo_url ?? teamLogoFallbackUrl(sport, row.team ?? undefined),
    position,
    salary: row.salary,
    salary_source: 'draftkings_import',
    injury_status: draftKingsStatusToInjuryStatus(row),
    injury_note: row.status && row.status !== 'None' ? `DraftKings status: ${row.status}` : undefined,
    projection_source: 'position_baseline',
    projected_points: projected,
    last_5_stats: {
      avg_points: projected,
      avg_fantasy_pts: projected,
      trend: 'stable',
      confidence: row.projected_points ? 0.62 : 0.45,
      games: buildBaselineGames(projected),
    },
  };
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

function buildVegasContext(slate?: DraftKingsSlate, fallbackOdds: OddsContext[] = []): MiosManifest['vegas_context'] {
  const slateOdds = slateEvents(slate)
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
  return slateOdds.some((context) => context.over_under || context.spread) ? slateOdds : fallbackOdds;
}

function hasFreeOddsContext(slate?: DraftKingsSlate, fallbackOdds: OddsContext[] = []): boolean {
  return buildVegasContext(slate, fallbackOdds).some((context) => context.over_under || context.spread);
}

function oddsApiSportKey(sport: string): string | null {
  const keys: Record<string, string> = {
    nba: 'basketball_nba',
    wnba: 'basketball_wnba',
    nfl: 'americanfootball_nfl',
    mlb: 'baseball_mlb',
  };
  return keys[sport] ?? null;
}

const ODDS_TEAM_NAMES: Record<string, Record<string, string[]>> = {
  nba: {
    ATL: ['atlanta hawks'],
    BOS: ['boston celtics'],
    BKN: ['brooklyn nets'],
    CHA: ['charlotte hornets'],
    CHI: ['chicago bulls'],
    CLE: ['cleveland cavaliers'],
    DAL: ['dallas mavericks'],
    DEN: ['denver nuggets'],
    DET: ['detroit pistons'],
    GSW: ['golden state warriors'],
    HOU: ['houston rockets'],
    IND: ['indiana pacers'],
    LAC: ['los angeles clippers', 'la clippers'],
    LAL: ['los angeles lakers', 'la lakers'],
    MEM: ['memphis grizzlies'],
    MIA: ['miami heat'],
    MIL: ['milwaukee bucks'],
    MIN: ['minnesota timberwolves'],
    NOP: ['new orleans pelicans'],
    NYK: ['new york knicks'],
    OKC: ['oklahoma city thunder'],
    ORL: ['orlando magic'],
    PHI: ['philadelphia 76ers', 'philadelphia sixers'],
    PHX: ['phoenix suns'],
    POR: ['portland trail blazers'],
    SAC: ['sacramento kings'],
    SAS: ['san antonio spurs'],
    TOR: ['toronto raptors'],
    UTA: ['utah jazz'],
    WAS: ['washington wizards'],
  },
  wnba: {
    ATL: ['atlanta dream'],
    CHI: ['chicago sky'],
    CON: ['connecticut sun'],
    DAL: ['dallas wings'],
    GSV: ['golden state valkyries'],
    IND: ['indiana fever'],
    LVA: ['las vegas aces'],
    LAS: ['los angeles sparks'],
    MIN: ['minnesota lynx'],
    NYL: ['new york liberty'],
    PHO: ['phoenix mercury'],
    SEA: ['seattle storm'],
    WAS: ['washington mystics'],
  },
  mlb: {
    ARI: ['arizona diamondbacks'],
    ATL: ['atlanta braves'],
    BAL: ['baltimore orioles'],
    BOS: ['boston red sox'],
    CHC: ['chicago cubs'],
    CWS: ['chicago white sox'],
    CIN: ['cincinnati reds'],
    CLE: ['cleveland guardians'],
    COL: ['colorado rockies'],
    DET: ['detroit tigers'],
    HOU: ['houston astros'],
    KC: ['kansas city royals'],
    LAA: ['los angeles angels'],
    LAD: ['los angeles dodgers'],
    MIA: ['miami marlins'],
    MIL: ['milwaukee brewers'],
    MIN: ['minnesota twins'],
    NYM: ['new york mets'],
    NYY: ['new york yankees'],
    OAK: ['oakland athletics', 'athletics'],
    ATH: ['athletics'],
    PHI: ['philadelphia phillies'],
    PIT: ['pittsburgh pirates'],
    SD: ['san diego padres'],
    SEA: ['seattle mariners'],
    SF: ['san francisco giants'],
    STL: ['st. louis cardinals', 'saint louis cardinals'],
    TB: ['tampa bay rays'],
    TEX: ['texas rangers'],
    TOR: ['toronto blue jays'],
    WSH: ['washington nationals'],
  },
};

function oddsTeamMatches(sport: string, teamAbbr: string, teamName: string): boolean {
  const normalized = teamName.toLowerCase();
  return (ODDS_TEAM_NAMES[sport]?.[teamAbbr] ?? [teamAbbr.toLowerCase()])
    .some((name) => normalized.includes(name));
}

function oddsEventMatchesSlate(sport: string, event: any, slate?: DraftKingsSlate): boolean {
  const teams = slateTeamAbbreviations(slate);
  if (teams.length < 2) return false;
  const home = String(event?.home_team ?? '');
  const away = String(event?.away_team ?? '');
  return teams.every((team) => oddsTeamMatches(sport, team, home) || oddsTeamMatches(sport, team, away));
}

function marketPoint(bookmakers: any[], marketKey: string, outcomeName?: string): number | null {
  for (const bookmaker of bookmakers) {
    const market = (bookmaker?.markets ?? []).find((item: any) => item?.key === marketKey);
    const outcomes = market?.outcomes ?? [];
    const outcome = outcomeName
      ? outcomes.find((item: any) => String(item?.name ?? '').toLowerCase() === outcomeName.toLowerCase())
      : outcomes[0];
    const point = Number(outcome?.point);
    if (Number.isFinite(point)) return point;
  }
  return null;
}

async function collectOddsApiContext(sport: string, slate?: DraftKingsSlate): Promise<OddsContext[]> {
  const apiKey = envOddsApiKey();
  const sportKey = oddsApiSportKey(sport);
  if (!apiKey || !sportKey || !slateTeamAbbreviations(slate).length) return [];

  try {
    const url = `${envOddsApiBaseUrl().replace(/\/$/, '')}/sports/${sportKey}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=spreads,totals&oddsFormat=american`;
    const response = await limitedFetch(url, 'the-odds-api', {
      headers: { Accept: 'application/json' },
      timeoutMs: 12_000,
      retries: 1,
      dedupeMs: 1_000,
    });
    if (!response.ok) throw new Error(`The Odds API ${response.status}`);
    const events = await response.json() as any[];
    const matched = events.find((event) => oddsEventMatchesSlate(sport, event, slate));
    if (!matched) return [];

    const overUnder = marketPoint(matched.bookmakers ?? [], 'totals', 'Over') ?? 0;
    const spread = marketPoint(matched.bookmakers ?? [], 'spreads', matched.home_team) ?? 0;
    return [{
      game_id: String(slate?.game_ids?.[0] ?? matched.id ?? slate?.contest_id ?? ''),
      spread,
      over_under: overUnder,
      implied_total: overUnder ? Number((overUnder / 2).toFixed(2)) : 0,
    }];
  } catch (error) {
    console.error('The Odds API fallback error:', error);
    return [];
  }
}

function buildBaselineGames(projectedPoints: number): Last5Game[] {
  return Array.from({ length: 5 }, (_, idx) => ({
    date: `baseline-${idx + 1}`,
    opponent: 'N/A',
    points: Math.max(0, Math.round(projectedPoints * (0.72 + idx * 0.06))),
  }));
}

function preferredLogoUrl(logos: unknown): string | undefined {
  if (!Array.isArray(logos)) return undefined;
  const defaultLogo = logos.find((logo) => Array.isArray(logo?.rel) && logo.rel.includes('default'));
  return defaultLogo?.href ?? logos.find((logo) => typeof logo?.href === 'string')?.href;
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
    image_url: raw.image_url ?? raw.headshot_url ?? raw.headshot?.href,
    team_logo_url: raw.team_logo_url ?? teamLogoFallbackUrl(sport, team),
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
    const espnItems = xml
      .split('\n')
      .filter((line) => line.includes('out') || line.includes('injured') || line.includes('questionable'))
      .map((raw) => ({ raw, timestamp: new Date().toISOString() }));
    return [
      ...espnItems,
      ...await collectBalldontlieInjuries(sport),
      ...await collectSportsDataIoNewsAndInjuries(sport),
    ];
  } catch (error) {
    console.error('ESPN RSS error:', error);
    return [
      ...await collectBalldontlieInjuries(sport),
      ...await collectSportsDataIoNewsAndInjuries(sport),
    ];
  }
}

async function balldontlieFetch(path: string, params: Record<string, string | number | Array<string | number>> = {}) {
  const apiKey = envBalldontlieApiKey();
  if (!apiKey) return null;

  const url = new URL(`https://api.balldontlie.io${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(`${key}[]`, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await limitedFetch(url.toString(), 'balldontlie', {
    headers: {
      Accept: 'application/json',
      Authorization: apiKey,
    },
    timeoutMs: 12_000,
    retries: 1,
    dedupeMs: 700,
  });
  if (!response.ok) throw new Error(`Balldontlie ${response.status}`);
  return await response.json() as any;
}

async function collectBalldontlieInjuries(sport: string): Promise<any[]> {
  if (sport !== 'nba' || !envBalldontlieApiKey()) return [];

  try {
    const data = await balldontlieFetch('/v1/player_injuries', { per_page: 100 });
    const injuries = data?.data ?? [];
    return injuries.map((item: any) => {
      const playerName = `${item?.player?.first_name ?? ''} ${item?.player?.last_name ?? ''}`.trim();
      return {
        raw: `${playerName} ${item?.status ?? ''}: ${item?.description ?? ''}`,
        timestamp: new Date().toISOString(),
        source: 'balldontlie_injuries',
      };
    }).filter((item: any) => item.raw.trim());
  } catch (error) {
    console.error('Balldontlie injuries error:', error);
    return [];
  }
}

async function sportsDataIoFetch(path: string) {
  const apiKey = envSportsDataIoKey();
  if (!apiKey) return null;
  const url = new URL(`https://api.sportsdata.io${path}`);
  url.searchParams.set('key', apiKey);
  const response = await limitedFetch(url.toString(), 'sportsdataio', {
    headers: {
      Accept: 'application/json',
      'Ocp-Apim-Subscription-Key': apiKey,
    },
    timeoutMs: 12_000,
    retries: 1,
    dedupeMs: 700,
  });
  if (!response.ok) throw new Error(`SportsDataIO ${response.status}`);
  return await response.json() as any;
}

function sportsDataIoDateKey(date = new Date()) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${date.getUTCFullYear()}-${months[date.getUTCMonth()]}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

async function collectSportsDataIoNewsAndInjuries(sport: string): Promise<any[]> {
  if (sport !== 'nba' || !envSportsDataIoKey()) return [];

  try {
    const [players, latestNews, datedNews] = await Promise.all([
      sportsDataIoFetch('/v3/nba/scores/json/Players').catch(() => []),
      sportsDataIoFetch('/v3/nba/scores/json/News').catch(() => []),
      sportsDataIoFetch(`/v3/nba/scores/json/NewsByDate/${sportsDataIoDateKey()}`).catch(() => []),
    ]);

    const playerItems = (Array.isArray(players) ? players : [])
      .filter((player: any) => player?.InjuryStatus || player?.InjuryNotes)
      .map((player: any) => ({
        raw: `${player?.FirstName ?? ''} ${player?.LastName ?? ''} ${player?.InjuryStatus ?? ''}: ${player?.InjuryNotes ?? ''}`,
        timestamp: new Date().toISOString(),
        source: 'sportsdataio_players',
      }))
      .filter((item: any) => item.raw.trim());

    const seenNews = new Set<number | string>();
    const newsItems = [...(Array.isArray(latestNews) ? latestNews : []), ...(Array.isArray(datedNews) ? datedNews : [])]
      .filter((item: any) => {
        const key = item?.NewsID ?? `${item?.Title ?? ''}:${item?.Updated ?? ''}`;
        if (seenNews.has(key)) return false;
        seenNews.add(key);
        return true;
      })
      .map((item: any) => ({
        raw: `${item?.Title ?? ''} ${item?.Content ?? ''}`,
        timestamp: String(item?.Updated ?? new Date().toISOString()),
        source: 'sportsdataio_news',
      }))
      .filter((item: any) => item.raw.trim());

    return [...playerItems, ...newsItems];
  } catch (error) {
    console.error('SportsDataIO news/injuries error:', error);
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
          image_url: athlete.headshot?.href,
          team_logo_url: preferredLogoUrl(data?.team?.logos) ?? teamLogoFallbackUrl(sport, data?.team?.abbreviation),
        }, sport))
        .filter(Boolean) as Player[];
    }),
  );

  return rosters.flat();
}

function teamLogoFallbackUrl(sport: string, abbreviation?: string): string | undefined {
  if (!abbreviation || sport === 'f1') return undefined;
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${String(abbreviation).toLowerCase()}.png`;
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
  const stat = (key: string) => Number.isFinite(Number(game[key])) ? Number(game[key]) : 0;
  if (sport === 'nba' || sport === 'wnba') {
    return (
      stat('points') +
      stat('totalRebounds') * 1.25 +
      stat('assists') * 1.5 +
      stat('steals') * 2 +
      stat('blocks') * 2 -
      stat('turnovers') * 0.5
    );
  }
  if (sport === 'mlb') {
    if (stat('inningsPitched') || stat('strikeOuts') || stat('earnedRuns')) {
      return (
        stat('inningsPitched') * 2.25 +
        stat('strikeOuts') * 2 +
        stat('wins') * 4 -
        stat('earnedRuns') * 2 -
        (stat('hits') + stat('baseOnBalls') + stat('hitBatsmen')) * 0.6 +
        stat('completeGames') * 2.5 +
        stat('shutouts') * 2.5 +
        stat('noHitters') * 5
      );
    }
    const singles = Math.max(0, stat('hits') - stat('doubles') - stat('triples') - stat('homeRuns'));
    return (
      singles * 3 +
      stat('doubles') * 5 +
      stat('triples') * 8 +
      stat('homeRuns') * 10 +
      stat('rbi') * 2 +
      stat('runs') * 2 +
      (stat('baseOnBalls') + stat('hitByPitch')) * 2 +
      stat('stolenBases') * 5
    );
  }
  return stat('points');
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

function nbaSeasonCandidates() {
  const now = new Date();
  const year = now.getUTCFullYear();
  return [year, year - 1];
}

async function findBalldontliePlayerId(player: Player): Promise<number | null> {
  if (!envBalldontlieApiKey()) return null;
  const data = await balldontlieFetch('/v1/players', { search: player.name, per_page: 10 });
  const players = data?.data ?? [];
  const playerKey = normalizeName(player.name);
  const matched = players.find((candidate: any) => {
    const name = normalizeName(`${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`);
    const team = String(candidate?.team?.abbreviation ?? '').toUpperCase();
    return name === playerKey && (!player.team || team === String(player.team).toUpperCase());
  }) ?? players.find((candidate: any) => normalizeName(`${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`) === playerKey);
  const id = Number(matched?.id);
  return Number.isFinite(id) ? id : null;
}

function parseBalldontlieStats(data: any, sport: string) {
  const rows = [...(data?.data ?? [])]
    .filter((row: any) => row?.game)
    .sort((a: any, b: any) => String(b?.game?.date ?? '').localeCompare(String(a?.game?.date ?? '')))
    .slice(0, 5);
  const games = rows.map((row: any) => {
    const game = {
      date: String(row?.game?.date ?? ''),
      opponent: String(row?.game?.home_team_id === row?.team?.id ? row?.game?.visitor_team_id : row?.game?.home_team_id ?? 'N/A'),
      points: Number(row?.pts ?? 0),
      totalRebounds: Number(row?.reb ?? 0),
      assists: Number(row?.ast ?? 0),
      steals: Number(row?.stl ?? 0),
      blocks: Number(row?.blk ?? 0),
      turnovers: Number(row?.turnover ?? 0),
    };
    return {
      ...game,
      fantasy_points: Number(fantasyPointsForGame(game, sport).toFixed(2)),
    };
  });
  if (!games.length) return null;
  return {
    games_data: games,
    aggregated_stats: aggregateGames(games, sport),
    confidence_score: games.length === 5 ? 0.82 : 0.64,
    last_updated_at: new Date().toISOString(),
  };
}

async function collectBalldontlieLast5Stats(player: Player, sport: string): Promise<any | null> {
  if (sport !== 'nba' || !envBalldontlieApiKey()) return null;

  try {
    const playerId = await findBalldontliePlayerId(player);
    if (!playerId) return null;
    const data = await balldontlieFetch('/v1/stats', {
      player_ids: [playerId],
      seasons: nbaSeasonCandidates(),
      per_page: 100,
    });
    return parseBalldontlieStats(data, sport);
  } catch (error) {
    console.error(`Balldontlie last-5 error for ${player.name}:`, error);
    return null;
  }
}

function parseMlbInnings(value: unknown): number {
  const raw = String(value ?? '0');
  const [whole, outs] = raw.split('.');
  return Number(whole || 0) + Number(outs || 0) / 3;
}

async function findMlbPersonId(player: Player): Promise<number | null> {
  const response = await limitedFetch(
    `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(player.name)}`,
    'mlb-people-search',
    { headers: { Accept: 'application/json' }, timeoutMs: 10_000, retries: 1, dedupeMs: 400 },
  );
  if (!response.ok) return null;
  const data = await response.json() as any;
  const playerKey = normalizeName(player.name);
  const matched = (data?.people ?? []).find((person: any) => normalizeName(person?.fullName ?? '') === playerKey);
  const id = Number(matched?.id);
  return Number.isFinite(id) ? id : null;
}

function parseMlbGameLog(data: any) {
  const splits = data?.stats?.[0]?.splits ?? [];
  const games = splits.slice(0, 5).map((split: any) => {
    const stat = split?.stat ?? {};
    const game = {
      date: String(split?.date ?? ''),
      opponent: String(split?.opponent?.abbreviation ?? split?.opponent?.name ?? 'N/A'),
      points: 0,
      hits: Number(stat.hits ?? 0),
      doubles: Number(stat.doubles ?? 0),
      triples: Number(stat.triples ?? 0),
      homeRuns: Number(stat.homeRuns ?? 0),
      rbi: Number(stat.rbi ?? 0),
      runs: Number(stat.runs ?? 0),
      baseOnBalls: Number(stat.baseOnBalls ?? 0),
      hitByPitch: Number(stat.hitByPitch ?? stat.hitBatsmen ?? 0),
      hitBatsmen: Number(stat.hitBatsmen ?? 0),
      stolenBases: Number(stat.stolenBases ?? 0),
      inningsPitched: parseMlbInnings(stat.inningsPitched),
      strikeOuts: Number(stat.strikeOuts ?? 0),
      wins: Number(stat.wins ?? 0),
      earnedRuns: Number(stat.earnedRuns ?? 0),
      completeGames: Number(stat.completeGames ?? 0),
      shutouts: Number(stat.shutouts ?? 0),
      noHitters: Number(stat.noHitters ?? 0),
    };
    return {
      ...game,
      fantasy_points: Number(fantasyPointsForGame(game, 'mlb').toFixed(2)),
    };
  });
  if (!games.length) return null;
  return {
    games_data: games,
    aggregated_stats: aggregateGames(games, 'mlb'),
    confidence_score: games.length === 5 ? 0.82 : 0.64,
    last_updated_at: new Date().toISOString(),
    source: 'mlb_stats_api',
  };
}

async function collectMlbStatsApiLast5Stats(player: Player): Promise<any | null> {
  if (player.position === 'DST') return null;
  try {
    const personId = await findMlbPersonId(player);
    if (!personId) return null;
    const group = /P|SP|RP/i.test(player.position) ? 'pitching' : 'hitting';
    const season = new Date().getUTCFullYear();
    const response = await limitedFetch(
      `https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=gameLog&group=${group}&season=${season}`,
      'mlb-game-log',
      { headers: { Accept: 'application/json' }, timeoutMs: 10_000, retries: 1, dedupeMs: 400 },
    );
    if (!response.ok) return null;
    return parseMlbGameLog(await response.json());
  } catch (error) {
    console.error(`MLB Stats API last-5 error for ${player.name}:`, error);
    return null;
  }
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
  if (!player.espn_id || sport === 'f1') {
    if (sport === 'mlb') return await collectMlbStatsApiLast5Stats(player);
    return await collectBalldontlieLast5Stats(player, sport);
  }

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
    if (sport === 'mlb') return await collectMlbStatsApiLast5Stats(player);
    return await collectBalldontlieLast5Stats(player, sport);
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

function redditSubredditsForSport(sport: string): string[] {
  const map: Record<string, string[]> = {
    nba: ['nba', 'fantasybball', 'dfsports'],
    wnba: ['wnba', 'fantasybball', 'dfsports'],
    nfl: ['nfl', 'fantasyfootball', 'dfsports'],
    mlb: ['mlb', 'fantasybaseball', 'dfsports'],
    f1: ['formula1'],
  };
  return map[sport] ?? ['dfsports'];
}

function redditRssUserAgent() {
  return 'fantasy-ai/1.0 public-rss monitor; contact: https://floyd-dfs.vercel.app';
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textFromXmlBlock(block: string, tagName: string): string {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return decodeXmlEntities(match?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function linkFromXmlBlock(block: string): string {
  const alternate = block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  const anyLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return decodeXmlEntities(alternate?.[1] ?? anyLink?.[1] ?? '').trim();
}

function parseRedditAtom(xml: string): RedditFeedItem[] {
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1] ?? '');
  return entries.map((entry) => {
    return {
      title: textFromXmlBlock(entry, 'title'),
      content: textFromXmlBlock(entry, 'content'),
      link: linkFromXmlBlock(entry),
      updated: textFromXmlBlock(entry, 'updated'),
    };
  }).filter((item) => item.title || item.content);
}

async function fetchRedditRss(url: string, cacheKey: string): Promise<RedditFeedItem[]> {
  const cached = redditRssCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REDDIT_RSS_CACHE_MS) return cached.items;

  const headers = {
    Accept: 'application/atom+xml, application/rss+xml, text/xml',
    'User-Agent': redditRssUserAgent(),
  };
  const response = await limitedFetch(url, `reddit-rss:${cacheKey}`, {
    headers,
    timeoutMs: 12_000,
    retries: 1,
    dedupeMs: 1_000,
  }).catch(() => null);
  const retryUrl = url.replace('https://www.reddit.com/', 'https://old.reddit.com/');
  const finalResponse = response?.ok ? response : await limitedFetch(retryUrl, `reddit-rss-old:${cacheKey}`, {
    headers,
    timeoutMs: 12_000,
    retries: 1,
    dedupeMs: 1_000,
  });
  if (!finalResponse.ok) throw new Error(`Reddit RSS ${finalResponse.status}`);

  const items = parseRedditAtom(await finalResponse.text()).slice(0, 40);
  redditRssCache.set(cacheKey, { items, cachedAt: Date.now() });
  return items;
}

async function collectSportRedditItems(sport: string): Promise<RedditFeedItem[]> {
  const subreddits = redditSubredditsForSport(sport).join('+');
  return await fetchRedditRss(
    `https://www.reddit.com/r/${subreddits}/new.rss?limit=40`,
    `${sport}:subreddits:${subreddits}`,
  );
}

async function collectPlayerRedditSearchItems(playerName: string, sport: string): Promise<RedditFeedItem[]> {
  const query = `"${playerName}" (${sport} OR DFS OR fantasy OR injury OR starting OR out OR questionable)`;
  return await fetchRedditRss(
    `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&limit=25`,
    `${sport}:search:${normalizeName(playerName)}`,
  );
}

function redditItemsMatchingPlayer(items: RedditFeedItem[], playerName: string): RedditFeedItem[] {
  const playerKey = normalizeName(playerName);
  if (!playerKey) return [];
  return items.filter((item) => normalizeName(`${item.title} ${item.content}`).includes(playerKey));
}

function scoreRedditItems(items: RedditFeedItem[]) {
  const text = items.map((item) => `${item.title} ${item.content}`).join(' ').toLowerCase();
  const positive = ['breakout', 'hot', 'healthy', 'starting', 'upgrade', 'smash', 'available', 'confirmed'];
  const negative = ['injury', 'injured', 'out', 'questionable', 'limited', 'slump', 'bench', 'inactive', 'doubtful'];
  const posHits = positive.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const negHits = negative.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  return Math.max(-1, Math.min(1, (posHits - negHits) / 5));
}

async function collectRedditSentiment(playerId: string, sport: string): Promise<any> {
  const cached = await getCachedSocialSentiment(playerId, sport);
  if (cached) return cached;

  try {
    const sportMatches = redditItemsMatchingPlayer(await collectSportRedditItems(sport), playerId);
    const searchMatches = sportMatches.length ? [] : await collectPlayerRedditSearchItems(playerId, sport);
    const posts = sportMatches.length ? sportMatches : redditItemsMatchingPlayer(searchMatches, playerId);
    const sentiment = scoreRedditItems(posts);

    const sentimentResult = {
      player_id: playerId,
      reddit_mentions: posts.length,
      sentiment_score: sentiment,
      key_themes: posts.length === 0
        ? ['rss_no_mentions']
        : [sportMatches.length ? 'subreddit_rss_match' : 'search_rss_match'],
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

function matchingNewsItems(player: Player, newsItems: any[]): string[] {
  const playerKey = normalizeName(player.name);
  if (!playerKey) return [];
  return newsItems
    .map((item) => String(item?.raw ?? ''))
    .filter((raw) => normalizeName(raw).includes(playerKey));
}

function newsInjuryStatus(rawNews: string[]): InjuryStatus | null {
  const text = rawNews.join(' ').toLowerCase();
  if (!text) return null;
  if (/(ruled out|will not play|inactive|out indefinitely|injured reserve|placed on)/.test(text)) return 'out';
  if (/(doubtful|unlikely to play)/.test(text)) return 'doubtful';
  if (/(questionable|game-time decision|uncertain)/.test(text)) return 'questionable';
  if (/(probable|expected to play|available)/.test(text)) return 'probable';
  if (/(day-to-day|day to day|limited)/.test(text)) return 'day_to_day';
  return null;
}

function applyPlayerNewsSignals(player: Player, newsItems: any[], sentiment: any): Player {
  const matchedNews = matchingNewsItems(player, newsItems);
  const injuryFromNews = newsInjuryStatus(matchedNews);
  const sentimentScore = typeof sentiment?.sentiment_score === 'number' ? sentiment.sentiment_score : 0;
  const hasNews = matchedNews.length > 0 || sentiment?.source_status === 'ok';
  if (!hasNews && !injuryFromNews) return player;

  const negativeNews = matchedNews.some((raw) => /(bench|limited|slump|injur|questionable|doubtful|out)/i.test(raw));
  const positiveNews = matchedNews.some((raw) => /(starting|available|healthy|upgrade|breakout|hot)/i.test(raw));
  const projectionMultiplier = Math.min(
    Math.max(1 + sentimentScore * 0.04 + (positiveNews ? 0.03 : 0) - (negativeNews ? 0.08 : 0), 0.75),
    1.08,
  );
  const confidenceDelta = sentimentScore * 0.08 + (positiveNews ? 0.04 : 0) - (negativeNews ? 0.12 : 0);
  const confidence = Math.min(Math.max((player.last_5_stats?.confidence ?? 0.5) + confidenceDelta, 0.2), 0.95);
  const projectedPoints = player.projected_points ? Number((player.projected_points * projectionMultiplier).toFixed(2)) : player.projected_points;
  const noteParts = [
    matchedNews.length ? `${matchedNews.length} matched news item${matchedNews.length === 1 ? '' : 's'}` : '',
    sentiment?.source_status === 'ok' ? `Reddit sentiment ${sentimentScore.toFixed(2)}` : '',
  ].filter(Boolean);

  return {
    ...player,
    injury_status: injuryFromNews ?? player.injury_status,
    injury_note: injuryFromNews ? `News signal: ${injuryFromNews}` : player.injury_note,
    projected_points: projectedPoints,
    news_score: Number((sentimentScore + (positiveNews ? 0.5 : 0) - (negativeNews ? 0.75 : 0)).toFixed(2)),
    news_note: noteParts.join('; ') || undefined,
    last_5_stats: player.last_5_stats ? {
      ...player.last_5_stats,
      avg_fantasy_pts: projectedPoints ?? player.last_5_stats.avg_fantasy_pts,
      confidence,
    } : player.last_5_stats,
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
  if (!effectiveSalaryRows.length) {
    throw new Error('DraftKings salary rows are required before generating lineups. No estimated salary scan was run.');
  }
  const fallbackOddsContext = hasFreeOddsContext(slate) ? [] : await collectOddsApiContext(sport, slate);
  sourceStatus.espn_news = injuries.length ? 'partial' : 'partial';
  sourceStatus.draftkings_salaries = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.draftkings_salary_source = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.free_game_schedule = slate?.status === 'schedule_derived' || slate?.data?.source === 'espn_scoreboard' ? 'ok' : 'unavailable';
  sourceStatus.free_odds = hasFreeOddsContext(slate, fallbackOddsContext) ? 'ok' : 'unavailable';

  let playerRoster = filterRosterBySlateTeams(applyDraftKingsSalaries(dedupePlayers(roster), effectiveSalaryRows, sport), slate);
  if (slateTeamAbbreviations(slate).length && playerRoster.length === roster.length) {
    warnings.push('Selected slate included team metadata, but roster filtering did not reduce the player pool.');
  }
  if (!playerRoster.length) warnings.push('No roster players were collected; lineups cannot be generated.');
  if (playerRoster.length < effectiveSalaryRows.length) {
    warnings.push('Some DraftKings salary rows could not be matched to roster metadata and were omitted.');
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
  const sentimentByPlayer = new Map(statAndSentiment.map((item) => [item.playerId, item.sentiment]));
  playerRoster = playerRoster.map((player) => applyLast5Stats(player, statsByPlayer.get(player.id), sport));
  playerRoster = playerRoster.map((player) => applyPlayerNewsSignals(player, injuries, sentimentByPlayer.get(player.id)));
  sourceStatus.espn_last5 = statAndSentiment.some((item) => item.stats?.games_data?.length) ? 'partial' : 'unavailable';
  sourceStatus.projections = sourceStatus.espn_last5 === 'unavailable' ? 'partial' : 'ok';
  sourceStatus.reddit_sentiment = statAndSentiment.some((item) => item.sentiment?.source_status === 'ok') ? 'partial' : 'unavailable';
  sourceStatus.player_news = playerRoster.some((player) => player.news_note) ? 'partial' : 'unavailable';

  if (sourceStatus.espn_last5 === 'unavailable') {
    warnings.push('Verified last-5 game stats are unavailable; using position baseline projections.');
  }
  if (sourceStatus.reddit_sentiment === 'unavailable') {
    warnings.push('Reddit public RSS signals were unavailable and no cached sentiment was found; sentiment score is neutral.');
  }
  if (sourceStatus.player_news === 'unavailable') {
    warnings.push('Player-specific news signals were unavailable or did not match players in this slate.');
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
    vegas_context: buildVegasContext(slate, fallbackOddsContext),
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
      validateSlateStartWindow(slate);
    }

    const auth = await validateFunctionAuth(req, userId);
    const effectiveUserId = auth.userId ?? userId;
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
