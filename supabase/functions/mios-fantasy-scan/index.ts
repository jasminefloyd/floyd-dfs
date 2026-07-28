import { NEWS_INJURY_PREFILTER_PATTERN, injuryContextNear, normalizeInjuryStatus, type InjuryStatus } from './injuryStatus.ts';
import { dkFantasyPoints, type DkSport } from '../_shared/dkScoring.ts';
import { mapWithConcurrency } from './enrichment.ts';
import { computeOpportunityProjection } from './opportunity.ts';

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
  projection_source?: 'draftkings' | 'draftkings_last5_blend' | 'last_5' | 'position_baseline' | 'calibrated' | 'props_blend' | 'opportunity_blend';
  projected_points?: number;
  ownership_projection?: number;
  prop_projection?: number;
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
  batting_order?: number;
  run_factor?: number;
  opponent_team?: string;
  opposing_probable_pitcher_id?: string;
  opposing_probable_pitcher_name?: string;
  own_probable_starter?: boolean;
  game_id?: string;
  minutes_projection?: number;
  depth_chart_order?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  last_5_stats?: {
    avg_points: number;
    avg_fantasy_pts: number;
    trend: 'up' | 'down' | 'stable';
    confidence: number;
    minutes_avg?: number;
    is_synthetic?: boolean;
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
  vegas_context: VegasContext[];
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
  competitionId?: string | number;
  competitionIdString?: string;
  home_team?: string;
  away_team?: string;
  homeTeam?: { abbreviation?: string | null; teamName?: string | null; city?: string | null } | null;
  awayTeam?: { abbreviation?: string | null; teamName?: string | null; city?: string | null } | null;
  teams?: Array<{ abbreviation?: string | null; display_name?: string | null }>;
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
  home_team?: string;
  away_team?: string;
  home_implied?: number;
  away_implied?: number;
}

type VegasContext = OddsContext;
type EnrichmentBucket = 'stud' | 'value' | 'mid' | 'other';

interface EnrichmentPlan {
  players: Player[];
  bucketByPlayerId: Map<string, EnrichmentBucket>;
  counts: Record<EnrichmentBucket, number>;
  cap: number;
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

interface ProjectionCalibrationRow {
  sport: string;
  sample_size: number;
  avg_projection_error: number | null;
  avg_absolute_error: number | null;
  projection_bias_multiplier: number | null;
}

interface ProjectionCalibrationV2Row {
  sport: string;
  position_group: string;
  salary_tier: string;
  sample_size: number;
  avg_error: number | null;
  avg_absolute_error: number | null;
  bias_multiplier: number | null;
}

interface ProjectionCalibrationBundle {
  sportWide: ProjectionCalibrationRow | null;
  cells: ProjectionCalibrationV2Row[];
}

interface CachedPropLineRow {
  sport: string;
  event_id: string;
  player_name: string;
  market: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
  bookmaker: string | null;
  fetched_at: string;
  expires_at: string | null;
}

interface PropLine {
  event_id: string;
  player_name: string;
  market: string;
  line: number;
  over_price?: number | null;
  under_price?: number | null;
  bookmaker?: string | null;
}

interface PlayerPropCollection {
  propsByPlayer: Map<string, Record<string, number>>;
  matchedEvents: number;
  fetchedEvents: number;
  cachedEvents: number;
  propPlayers: number;
  unmatchedPropPlayers: number;
  requestsRemaining?: string;
  cacheOnly: boolean;
}

interface OwnershipProjectionRow {
  player_name: string;
  ownership_pct: number;
  cpt_ownership_pct?: number | null;
  flex_ownership_pct?: number | null;
  source?: string | null;
  scraped_at?: string | null;
}

interface ConfirmedLineupRow {
  sport: string;
  game_date: string;
  team: string;
  player_name: string;
  batting_order: number | null;
  lineup_status: 'confirmed' | 'expected';
  injury_tag: 'OUT' | 'GTD' | 'QUES' | null;
  is_starting_pitcher: boolean;
  scraped_at: string;
}

interface MlbGameContext {
  game_id: string;
  home_team: string;
  away_team: string;
  venue_name?: string;
  start_time?: string;
  probable_pitchers: Record<string, { id?: string; name: string }>;
  batting_orders?: Record<string, Record<string, number>>;
  confirmed_starters?: Record<string, Set<string>>;
  park_factor: number;
  weather_factor: number;
  run_factor: number;
  weather_note?: string;
  lineup_note?: string;
}

interface StatcastQuality {
  player_key: string;
  name_key: string;
  sample_size: number;
  quality_score: number;
  note: string;
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

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
// Supabase edge instances are ephemeral; these module-level caches are best-effort
// per-instance only and are not a durable cross-request store.
const manifestCache = new Map<string, { manifest: MiosManifest; cachedAt: number }>();
const lastRequestAt = new Map<string, number>();
const LAST5_CACHE_HOURS = 24;
const SCAN_LOOKAHEAD_DAYS = 2;
const SCAN_LOOKAHEAD_HOURS = 48;
const REDDIT_RSS_CACHE_MS = 15 * 60 * 1000;
const redditRssCache = new Map<string, { items: RedditFeedItem[]; cachedAt: number }>();
const redditRssInFlight = new Map<string, Promise<RedditFeedItem[]>>();

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
};

const CLASSIC_TARGETS: Record<string, Record<string, number>> = {
  nba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  wnba: { PG: 6, SG: 6, SF: 6, PF: 6, C: 4 },
  nfl: { QB: 8, RB: 12, WR: 16, TE: 8, DST: 4 },
  mlb: { P: 14, C: 4, '1B': 4, '2B': 4, '3B': 4, SS: 4, OF: 12 },
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

function envOddsApiMonthlyBudget() {
  const value = Number(Deno.env.get('ODDS_API_MONTHLY_BUDGET') ?? 500);
  return Number.isFinite(value) && value > 0 ? value : 500;
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

const PLAYER_SUFFIX_PATTERN = /\b(jr|sr|ii|iii|iv|v)\b/gi;
const PLAYER_NAME_ALIASES: Record<string, string> = {
  nicclaxton: 'nicolasclaxton',
  nickclaxton: 'nicolasclaxton',
  lebronjames: 'lebronjames',
  sga: 'shaigilgeousalexander',
  shai: 'shaigilgeousalexander',
  joker: 'nikolajokic',
};

function normalizeNameRaw(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(PLAYER_SUFFIX_PATTERN, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeName(value: string) {
  const key = normalizeNameRaw(value);
  return PLAYER_NAME_ALIASES[key] ?? key;
}

function normalizeOwnershipProjection(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed > 1 ? Math.min(parsed / 100, 1) : Math.min(parsed, 1);
}

async function collectOwnershipProjections(sport: string, contestDate: string): Promise<OwnershipProjectionRow[]> {
  const rows = await callSupabaseRpc<OwnershipProjectionRow[]>('fantasy_ai_get_ownership_projections', {
    p_sport: sport,
    p_contest_date: contestDate,
  }, { allowMissingServiceRole: true }).catch(() => null);

  return Array.isArray(rows) ? rows : [];
}

function applyOwnershipProjections(players: Player[], rows: OwnershipProjectionRow[]) {
  const ownershipByName = new Map<string, number>();
  const cptOwnershipByName = new Map<string, number>();
  const flexOwnershipByName = new Map<string, number>();
  let latestScrapedAt = 0;
  for (const row of rows) {
    const key = normalizeName(row.player_name);
    const ownership = normalizeOwnershipProjection(row.ownership_pct);
    if (!key || ownership === undefined || ownershipByName.has(key)) continue;
    ownershipByName.set(key, ownership);
    const cptOwnership = normalizeOwnershipProjection(row.cpt_ownership_pct);
    const flexOwnership = normalizeOwnershipProjection(row.flex_ownership_pct);
    if (cptOwnership !== undefined) cptOwnershipByName.set(key, cptOwnership);
    if (flexOwnership !== undefined) flexOwnershipByName.set(key, flexOwnership);
    const scrapedAt = Date.parse(String(row.scraped_at ?? ''));
    if (Number.isFinite(scrapedAt)) latestScrapedAt = Math.max(latestScrapedAt, scrapedAt);
  }

  const matchedSourceKeys = new Set<string>();
  let matchedPlayers = 0;
  const updatedPlayers = players.map((player) => {
    const key = normalizeName(player.name);
    const ownership = ownershipByName.get(key);
    if (ownership === undefined) return player;
    matchedPlayers += 1;
    matchedSourceKeys.add(key);
    return {
      ...player,
      ownership_projection: ownership,
      cpt_ownership_projection: cptOwnershipByName.get(key),
      flex_ownership_projection: flexOwnershipByName.get(key),
    };
  });

  return {
    players: updatedPlayers,
    matchedPlayers,
    matchedSourceRows: matchedSourceKeys.size,
    unmatchedSourceRows: Math.max(ownershipByName.size - matchedSourceKeys.size, 0),
    unmatchedSourceNames: [...ownershipByName.keys()].filter((key) => !matchedSourceKeys.has(key)).slice(0, 20),
    sourceRows: ownershipByName.size,
    latestScrapedAt: latestScrapedAt ? new Date(latestScrapedAt).toISOString() : null,
  };
}

function salaryKey(name: string, position: string) {
  return `${normalizeName(name)}:${String(position ?? '').toUpperCase()}`;
}

function salaryNameTeamKey(name: string, team: string | null | undefined) {
  return `${normalizeName(name)}:${String(team ?? '').toUpperCase()}`;
}

function normalizePositionPart(raw: unknown, sport: string): string {
  const position = String(raw ?? '').toUpperCase().trim();
  if (sport === 'mlb') {
    if (['LF', 'CF', 'RF', 'LEFT FIELDER', 'CENTER FIELDER', 'RIGHT FIELDER'].includes(position)) return 'OF';
    if (['SP', 'RP', 'STARTING PITCHER', 'RELIEF PITCHER', 'PITCHER'].includes(position)) return 'P';
    if (position === 'CATCHER') return 'C';
    if (position === 'FIRST BASE') return '1B';
    if (position === 'SECOND BASE') return '2B';
    if (position === 'THIRD BASE') return '3B';
    if (position === 'SHORTSTOP') return 'SS';
    if (position === 'DESIGNATED HITTER') return 'UTIL';
  }
  if (sport === 'nfl' && position === 'D/ST') return 'DST';
  if ((sport === 'nba' || sport === 'wnba') && position === 'G-F') return 'SG';
  if ((sport === 'nba' || sport === 'wnba') && position === 'F-C') return 'PF';
  return position;
}

function normalizePosition(raw: unknown, sport: string): string {
  const parts = String(raw ?? '')
    .toUpperCase()
    .split('/')
    .map((part) => normalizePositionPart(part, sport))
    .filter(Boolean);
  return [...new Set(parts)].join('/') || 'UTIL';
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
  const positionPremium = ['QB', 'P', 'SP', 'C'].includes(position) ? 800 : 0;
  const sportPremium = sport === 'nfl' ? 2500 : 3000;
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
  const status = normalizeInjuryStatus(row.status);
  if (row.is_disabled || status === 'out') return 'out';
  return status;
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
  const dkConfirmedNote = (player: Player, row: DraftKingsSalaryRow): string | undefined => {
    if (sport !== 'mlb' || !row.is_confirmed_starter) return player.news_note;
    return [player.news_note, 'DraftKings confirmed starter'].filter(Boolean).join(' | ');
  };

  const matchedPlayers = players.map((player) => {
    const salaryRow = byPlayerId.get(player.id)
      ?? byNamePosition.get(salaryKey(player.name, player.position))
      ?? byNameTeam.get(salaryNameTeamKey(player.name, player.team))
      ?? byUniqueName.get(normalizeName(player.name));
    if (!salaryRow) return player;
    usedSalaryRows.add(salaryRow);
    return {
      ...player,
      team: salaryRow.team ?? player.team,
      position: normalizePosition(salaryRow.position, sport),
      salary: salaryRow.salary,
      salary_source: 'draftkings_import' as const,
      injury_status: draftKingsStatusToInjuryStatus(salaryRow),
      injury_note: salaryRow.status && salaryRow.status !== 'None' ? `DraftKings status: ${salaryRow.status}` : player.injury_note,
      image_url: player.image_url ?? salaryRow.image_url ?? undefined,
      team_logo_url: player.team_logo_url ?? salaryRow.team_logo_url ?? teamLogoFallbackUrl(sport, salaryRow.team ?? undefined),
      game_id: player.game_id ?? salaryRow.game_id ?? undefined,
      projection_source: typeof salaryRow.projected_points === 'number' && salaryRow.projected_points > 0
        ? 'draftkings'
        : player.projection_source,
      projected_points: typeof salaryRow.projected_points === 'number' && salaryRow.projected_points > 0
        ? salaryRow.projected_points
        : player.projected_points,
      confirmed_starter: sport === 'mlb' && salaryRow.is_confirmed_starter ? true : player.confirmed_starter,
      own_probable_starter: sport === 'mlb' && /^(P|SP|RP)$/.test(normalizePosition(salaryRow.position, sport))
        ? (salaryRow.is_confirmed_starter ? true : player.own_probable_starter)
        : player.own_probable_starter,
      news_note: dkConfirmedNote(player, salaryRow),
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
    projection_source: row.projected_points ? 'draftkings' : 'position_baseline',
    projected_points: projected,
    confirmed_starter: sport === 'mlb' && row.is_confirmed_starter ? true : undefined,
    own_probable_starter: sport === 'mlb' && /^(P|SP|RP)$/.test(position) && row.is_confirmed_starter ? true : undefined,
    news_note: sport === 'mlb' && row.is_confirmed_starter ? 'DraftKings confirmed starter' : undefined,
    last_5_stats: {
      avg_points: projected,
      avg_fantasy_pts: projected,
      trend: 'stable',
      confidence: row.projected_points ? 0.62 : 0.45,
      is_synthetic: true,
      games: [],
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
  const competitions = slate?.data?.competitions;

  if (Array.isArray(events)) return events as SlateEventData[];
  if (event && typeof event === 'object') return [event as SlateEventData];
  if (Array.isArray(competitions)) return competitions as SlateEventData[];
  return [];
}

function slateEventTeamAbbr(team: unknown): string | undefined {
  if (!team || typeof team !== 'object') return undefined;
  const raw = String((team as { abbreviation?: unknown }).abbreviation ?? '').toUpperCase();
  return raw || undefined;
}

function slateEventTeamDisplayName(team: unknown): string {
  if (!team || typeof team !== 'object') return '';
  const value = team as { display_name?: unknown; teamName?: unknown; city?: unknown; abbreviation?: unknown };
  const city = String(value.city ?? '').trim();
  const teamName = String(value.teamName ?? '').trim();
  return String(value.display_name ?? (city && teamName ? `${city} ${teamName}` : teamName || value.abbreviation || '')).trim();
}

function normalizeTeamAbbr(value: unknown, sport: string): string {
  const raw = String(value ?? '').toUpperCase();
  if (sport === 'mlb') return normalizeMlbTeam(raw);
  return TEAM_ABBR_ALIASES[sport]?.[raw] ?? raw;
}

function teamAbbrFromOddsName(sport: string, teamName: string, slateTeams: string[]): string | undefined {
  const normalizedName = String(teamName ?? '').toLowerCase();
  if (!normalizedName) return undefined;
  return slateTeams.find((team) => oddsTeamMatches(sport, team, normalizedName) || normalizedName === team.toLowerCase());
}

function eventHomeAwayTeams(event: SlateEventData, slate: DraftKingsSlate | undefined, sport: string): { homeTeam?: string; awayTeam?: string } {
  const slateTeams = slateTeamAbbreviations(slate).map((team) => normalizeTeamAbbr(team, sport));
  const homeName = String(event.home_team ?? slateEventTeamDisplayName(event.homeTeam)).trim();
  const awayName = String(event.away_team ?? slateEventTeamDisplayName(event.awayTeam)).trim();
  const homeFromName = teamAbbrFromOddsName(sport, homeName, slateTeams);
  const awayFromName = teamAbbrFromOddsName(sport, awayName, slateTeams);
  const homeFromAbbr = normalizeTeamAbbr(slateEventTeamAbbr(event.homeTeam), sport);
  const awayFromAbbr = normalizeTeamAbbr(slateEventTeamAbbr(event.awayTeam), sport);
  const homeTeam = homeFromName ?? (slateTeams.includes(homeFromAbbr) ? homeFromAbbr : undefined);
  const awayTeam = awayFromName ?? (slateTeams.includes(awayFromAbbr) ? awayFromAbbr : undefined);

  if (homeTeam && awayTeam) return { homeTeam, awayTeam };
  if (slateTeams.length === 2 && slateEvents(slate).length === 1) {
    return { awayTeam: slateTeams[0], homeTeam: slateTeams[1] };
  }
  return {};
}

function buildTeamImpliedTotals(overUnder: number, spread: number): { homeImplied: number; awayImplied: number } {
  return {
    homeImplied: Number((overUnder / 2 - spread / 2).toFixed(2)),
    awayImplied: Number((overUnder / 2 + spread / 2).toFixed(2)),
  };
}

function vegasContextEntry(
  gameId: string,
  spread: number,
  overUnder: number,
  homeTeam?: string,
  awayTeam?: string,
): VegasContext {
  const hasTeamTotals = overUnder > 0 && Boolean(homeTeam && awayTeam);
  const implied = hasTeamTotals ? buildTeamImpliedTotals(overUnder, spread) : null;
  return {
    game_id: gameId,
    spread,
    over_under: overUnder,
    implied_total: overUnder ? Number((overUnder / 2).toFixed(2)) : 0,
    ...(homeTeam ? { home_team: homeTeam } : {}),
    ...(awayTeam ? { away_team: awayTeam } : {}),
    ...(implied ? { home_implied: implied.homeImplied, away_implied: implied.awayImplied } : {}),
  };
}

function buildVegasContext(slate?: DraftKingsSlate, fallbackOdds: OddsContext[] = []): MiosManifest['vegas_context'] {
  const slateOdds = slateEvents(slate)
    .map((event) => {
      const overUnder = Number(event.odds?.over_under);
      const spread = Number(event.odds?.spread);
      const { homeTeam, awayTeam } = eventHomeAwayTeams(event, slate, String(slate?.sport ?? '').toLowerCase());
      return vegasContextEntry(
        String(event.id ?? event.competitionId ?? event.competitionIdString ?? slate?.game_ids?.[0] ?? slate?.contest_id ?? ''),
        Number.isFinite(spread) ? spread : 0,
        Number.isFinite(overUnder) ? overUnder : 0,
        homeTeam,
        awayTeam,
      );
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
  nfl: {
    ARI: ['arizona cardinals'],
    ATL: ['atlanta falcons'],
    BAL: ['baltimore ravens'],
    BUF: ['buffalo bills'],
    CAR: ['carolina panthers'],
    CHI: ['chicago bears'],
    CIN: ['cincinnati bengals'],
    CLE: ['cleveland browns'],
    DAL: ['dallas cowboys'],
    DEN: ['denver broncos'],
    DET: ['detroit lions'],
    GB: ['green bay packers'],
    HOU: ['houston texans'],
    IND: ['indianapolis colts'],
    JAX: ['jacksonville jaguars'],
    KC: ['kansas city chiefs'],
    LAC: ['los angeles chargers', 'la chargers'],
    LAR: ['los angeles rams', 'la rams'],
    LV: ['las vegas raiders'],
    MIA: ['miami dolphins'],
    MIN: ['minnesota vikings'],
    NE: ['new england patriots'],
    NO: ['new orleans saints'],
    NYG: ['new york giants'],
    NYJ: ['new york jets'],
    PHI: ['philadelphia eagles'],
    PIT: ['pittsburgh steelers'],
    SEA: ['seattle seahawks'],
    SF: ['san francisco 49ers', 'san francisco forty niners'],
    TB: ['tampa bay buccaneers', 'tampa bay bucs'],
    TEN: ['tennessee titans'],
    WAS: ['washington commanders'],
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

const MLB_TEAM_ABBR_ALIASES: Record<string, string> = {
  ARI: 'ARI',
  ATL: 'ATL',
  BAL: 'BAL',
  BOS: 'BOS',
  CHC: 'CHC',
  CHW: 'CWS',
  CWS: 'CWS',
  CIN: 'CIN',
  CLE: 'CLE',
  COL: 'COL',
  DET: 'DET',
  HOU: 'HOU',
  KC: 'KC',
  KCR: 'KC',
  LAA: 'LAA',
  LAD: 'LAD',
  MIA: 'MIA',
  MIL: 'MIL',
  MIN: 'MIN',
  NYM: 'NYM',
  NYY: 'NYY',
  OAK: 'OAK',
  ATH: 'OAK',
  PHI: 'PHI',
  PIT: 'PIT',
  SD: 'SD',
  SDP: 'SD',
  SEA: 'SEA',
  SF: 'SF',
  SFG: 'SF',
  STL: 'STL',
  TB: 'TB',
  TBR: 'TB',
  TEX: 'TEX',
  TOR: 'TOR',
  WSH: 'WSH',
  WSN: 'WSH',
};

const TEAM_ABBR_ALIASES: Record<string, Record<string, string>> = {
  nba: {
    PHO: 'PHX',
    GS: 'GSW',
    SA: 'SAS',
    NO: 'NOP',
    NY: 'NYK',
  },
  wnba: {
    PHX: 'PHO',
    LV: 'LVA',
    LA: 'LAS',
    NY: 'NYL',
    WSH: 'WAS',
  },
  nfl: {
    ARZ: 'ARI',
    JAC: 'JAX',
    LA: 'LAR',
    WSH: 'WAS',
  },
};

const MLB_PARK_CONTEXT: Record<string, {
  venue: string;
  lat: number;
  lon: number;
  park_factor: number;
  roof?: boolean;
}> = {
  ARI: { venue: 'Chase Field', lat: 33.4455, lon: -112.0667, park_factor: 1.02, roof: true },
  ATL: { venue: 'Truist Park', lat: 33.8908, lon: -84.4678, park_factor: 1.01 },
  BAL: { venue: 'Oriole Park at Camden Yards', lat: 39.2839, lon: -76.6217, park_factor: 0.98 },
  BOS: { venue: 'Fenway Park', lat: 42.3467, lon: -71.0972, park_factor: 1.04 },
  CHC: { venue: 'Wrigley Field', lat: 41.9484, lon: -87.6553, park_factor: 1.06 },
  CWS: { venue: 'Rate Field', lat: 41.8300, lon: -87.6339, park_factor: 1.01 },
  CIN: { venue: 'Great American Ball Park', lat: 39.0979, lon: -84.5082, park_factor: 1.07 },
  CLE: { venue: 'Progressive Field', lat: 41.4962, lon: -81.6852, park_factor: 0.99 },
  COL: { venue: 'Coors Field', lat: 39.7561, lon: -104.9942, park_factor: 1.18 },
  DET: { venue: 'Comerica Park', lat: 42.3390, lon: -83.0485, park_factor: 0.99 },
  HOU: { venue: 'Daikin Park', lat: 29.7573, lon: -95.3555, park_factor: 1.00, roof: true },
  KC: { venue: 'Kauffman Stadium', lat: 39.0517, lon: -94.4803, park_factor: 1.00 },
  LAA: { venue: 'Angel Stadium', lat: 33.8003, lon: -117.8827, park_factor: 0.99 },
  LAD: { venue: 'Dodger Stadium', lat: 34.0739, lon: -118.2400, park_factor: 0.97 },
  MIA: { venue: 'loanDepot park', lat: 25.7781, lon: -80.2197, park_factor: 0.96, roof: true },
  MIL: { venue: 'American Family Field', lat: 43.0280, lon: -87.9712, park_factor: 1.01, roof: true },
  MIN: { venue: 'Target Field', lat: 44.9817, lon: -93.2776, park_factor: 0.99 },
  NYM: { venue: 'Citi Field', lat: 40.7571, lon: -73.8458, park_factor: 0.98 },
  NYY: { venue: 'Yankee Stadium', lat: 40.8296, lon: -73.9262, park_factor: 1.03 },
  OAK: { venue: 'Sutter Health Park', lat: 38.5804, lon: -121.5139, park_factor: 1.00 },
  PHI: { venue: 'Citizens Bank Park', lat: 39.9061, lon: -75.1665, park_factor: 1.04 },
  PIT: { venue: 'PNC Park', lat: 40.4469, lon: -80.0057, park_factor: 0.98 },
  SD: { venue: 'Petco Park', lat: 32.7073, lon: -117.1566, park_factor: 0.96 },
  SEA: { venue: 'T-Mobile Park', lat: 47.5914, lon: -122.3325, park_factor: 0.97, roof: true },
  SF: { venue: 'Oracle Park', lat: 37.7786, lon: -122.3893, park_factor: 0.95 },
  STL: { venue: 'Busch Stadium', lat: 38.6226, lon: -90.1928, park_factor: 0.99 },
  TB: { venue: 'George M. Steinbrenner Field', lat: 27.9803, lon: -82.5067, park_factor: 1.00 },
  TEX: { venue: 'Globe Life Field', lat: 32.7473, lon: -97.0842, park_factor: 1.02, roof: true },
  TOR: { venue: 'Rogers Centre', lat: 43.6414, lon: -79.3894, park_factor: 1.01, roof: true },
  WSH: { venue: 'Nationals Park', lat: 38.8730, lon: -77.0074, park_factor: 1.00 },
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
  const resolvedHome = teamAbbrFromOddsName(sport, home, teams);
  const resolvedAway = teamAbbrFromOddsName(sport, away, teams);
  return Boolean(resolvedHome && resolvedAway);
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
  const slateTeams = slateTeamAbbreviations(slate).map((team) => normalizeTeamAbbr(team, sport));
  if (!apiKey || !sportKey || !slateTeams.length) return [];

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
    return events
      .filter((event) => oddsEventMatchesSlate(sport, event, slate))
      .map((event) => {
        const homeTeam = teamAbbrFromOddsName(sport, String(event?.home_team ?? ''), slateTeams);
        const awayTeam = teamAbbrFromOddsName(sport, String(event?.away_team ?? ''), slateTeams);
        const overUnder = marketPoint(event.bookmakers ?? [], 'totals', 'Over') ?? 0;
        const spread = marketPoint(event.bookmakers ?? [], 'spreads', event.home_team) ?? 0;
        return vegasContextEntry(
          String(event.id ?? slate?.contest_id ?? ''),
          spread,
          overUnder,
          homeTeam,
          awayTeam,
        );
      });
  } catch (error) {
    console.error('The Odds API fallback error:', error);
    return [];
  }
}

const PLAYER_PROP_MARKETS: Record<string, string[]> = {
  nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_steals', 'player_blocks', 'player_turnovers'],
  wnba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_steals', 'player_blocks', 'player_turnovers'],
  nfl: ['player_pass_yds', 'player_pass_tds', 'player_pass_interceptions', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_anytime_td'],
  mlb: ['pitcher_strikeouts', 'batter_total_bases', 'batter_hits', 'batter_runs', 'batter_rbis', 'batter_stolen_bases', 'batter_walks'],
};

const NBA_PRA_FALLBACK_MARKET = 'player_points_rebounds_assists';

function slatePropEventIds(slate?: DraftKingsSlate): string[] {
  return Array.from(new Set([
    ...(slate?.game_ids ?? []),
    ...slateEvents(slate).map((event) => String(event.id ?? event.competitionId ?? event.competitionIdString ?? '')),
  ].filter(Boolean)));
}

async function getCachedPropLines(sport: string, eventId: string): Promise<PropLine[]> {
  const rows = await callSupabaseRpc<CachedPropLineRow[]>('fantasy_ai_get_cached_prop_lines', {
    p_sport: sport,
    p_event_id: eventId,
  }, { allowMissingServiceRole: true }).catch((error) => {
    console.error('Player prop cache lookup failed:', error);
    return null;
  });

  return (rows ?? []).map((row) => ({
    event_id: row.event_id,
    player_name: row.player_name,
    market: row.market,
    line: Number(row.line),
    over_price: row.over_price,
    under_price: row.under_price,
    bookmaker: row.bookmaker,
  })).filter((row) => row.player_name && row.market && Number.isFinite(row.line));
}

async function cachePropLines(sport: string, eventId: string, lines: PropLine[]) {
  if (!lines.length) return;
  await callSupabaseRpc('fantasy_ai_upsert_prop_lines', {
    p_sport: sport,
    p_event_id: eventId,
    p_lines: lines.map((line) => ({
      player_name: line.player_name,
      market: line.market,
      line: line.line,
      over_price: line.over_price ?? null,
      under_price: line.under_price ?? null,
      bookmaker: line.bookmaker ?? 'consensus',
    })),
    p_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  }, { serviceRole: true, allowMissingServiceRole: true }).catch((error) => {
    console.error('Player prop cache write failed:', error);
  });
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOptional(values: Array<number | null | undefined>): number | null {
  return median(values.flatMap((value) => typeof value === 'number' && Number.isFinite(value) ? [value] : []));
}

function americanOddsToProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function propOutcomePlayerName(outcome: any): string {
  const name = String(outcome?.name ?? '').trim();
  const description = String(outcome?.description ?? '').trim();
  if (/^(over|under|yes|no)$/i.test(name) && description) return description;
  return description || name;
}

function parsePropLines(eventId: string, payload: any): PropLine[] {
  const lines: PropLine[] = [];
  for (const bookmaker of payload?.bookmakers ?? []) {
    const bookmakerKey = String(bookmaker?.key ?? bookmaker?.title ?? 'bookmaker');
    for (const market of bookmaker?.markets ?? []) {
      const marketKey = String(market?.key ?? '');
      const grouped = new Map<string, { line?: number; over_price?: number | null; under_price?: number | null }>();
      for (const outcome of market?.outcomes ?? []) {
        const playerName = propOutcomePlayerName(outcome);
        const price = Number(outcome?.price);
        const point = marketKey === 'player_anytime_td' ? price : Number(outcome?.point);
        if (!playerName || !Number.isFinite(point)) continue;
        const side = String(outcome?.name ?? '').toLowerCase();
        const row = grouped.get(playerName) ?? {};
        row.line = point;
        if (Number.isFinite(price)) {
          if (side === 'under' || side === 'no') row.under_price = price;
          else row.over_price = price;
        }
        grouped.set(playerName, row);
      }
      for (const [playerName, row] of grouped) {
        if (typeof row.line !== 'number') continue;
        lines.push({
          event_id: eventId,
          player_name: playerName,
          market: marketKey,
          line: row.line,
          over_price: row.over_price,
          under_price: row.under_price,
          bookmaker: bookmakerKey,
        });
      }
    }
  }
  return lines;
}

function consensusPropLines(lines: PropLine[]): PropLine[] {
  const byPlayerMarket = new Map<string, PropLine[]>();
  for (const line of lines) {
    const key = `${normalizeName(line.player_name)}:${line.market}`;
    byPlayerMarket.set(key, [...(byPlayerMarket.get(key) ?? []), line]);
  }

  return [...byPlayerMarket.values()].flatMap((group) => {
    const line = median(group.map((item) => item.line));
    if (line === null) return [];
    const first = group[0];
    return [{
      event_id: first.event_id,
      player_name: first.player_name,
      market: first.market,
      line: Number(line.toFixed(3)),
      over_price: medianOptional(group.map((item) => item.over_price)) ?? null,
      under_price: medianOptional(group.map((item) => item.under_price)) ?? null,
      bookmaker: 'consensus',
    }];
  });
}

function propsByPlayer(lines: PropLine[]): Map<string, Record<string, number>> {
  const byPlayer = new Map<string, Record<string, number>>();
  for (const line of lines) {
    const key = normalizeName(line.player_name);
    if (!key) continue;
    byPlayer.set(key, {
      ...(byPlayer.get(key) ?? {}),
      [line.market]: line.line,
    });
  }
  return byPlayer;
}

async function fetchEventPropLines(
  sport: string,
  sportKey: string,
  eventId: string,
  markets: string[],
): Promise<{ lines: PropLine[]; requestsRemaining?: string }> {
  const apiKey = envOddsApiKey();
  if (!apiKey) return { lines: [] };
  const baseUrl = envOddsApiBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/sports/${sportKey}/events/${encodeURIComponent(eventId)}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=${encodeURIComponent(markets.join(','))}&oddsFormat=american`;
  const response = await limitedFetch(url, 'the-odds-api-props', {
    headers: { Accept: 'application/json' },
    timeoutMs: 12_000,
    retries: 0,
    dedupeMs: 1_200,
  });
  const requestsRemaining = response.headers.get('x-requests-remaining') ?? undefined;
  if (requestsRemaining) console.log(`The Odds API requests remaining after props call: ${requestsRemaining}`);
  if (!response.ok) {
    if ((response.status === 404 || response.status === 422) && markets.length > 1) {
      const fallbackLines: PropLine[] = [];
      let latestRequestsRemaining = requestsRemaining;
      for (const market of markets) {
        const singleMarket = await fetchEventPropLines(sport, sportKey, eventId, [market]);
        fallbackLines.push(...singleMarket.lines);
        if (singleMarket.requestsRemaining) latestRequestsRemaining = singleMarket.requestsRemaining;
      }
      return { lines: fallbackLines, requestsRemaining: latestRequestsRemaining };
    }
    console.error(`The Odds API props ${response.status} for ${sport} event ${eventId}: ${markets.join(',')}`);
    return { lines: [], requestsRemaining };
  }
  const payload = await response.json();
  return { lines: parsePropLines(eventId, payload), requestsRemaining };
}

async function collectPlayerProps(sport: string, slate?: DraftKingsSlate): Promise<PlayerPropCollection> {
  const empty: PlayerPropCollection = {
    propsByPlayer: new Map(),
    matchedEvents: 0,
    fetchedEvents: 0,
    cachedEvents: 0,
    propPlayers: 0,
    unmatchedPropPlayers: 0,
    cacheOnly: false,
  };
  const apiKey = envOddsApiKey();
  const sportKey = oddsApiSportKey(sport);
  const markets = PLAYER_PROP_MARKETS[sport];
  const slateTeams = slateTeamAbbreviations(slate).map((team) => normalizeTeamAbbr(team, sport));
  if (!apiKey || !sportKey || !markets?.length || slateTeams.length < 2) return empty;

  const knownEventIds = slatePropEventIds(slate);
  if (knownEventIds.length) {
    const cachedByKnownEvent = await Promise.all(knownEventIds.map((eventId) => getCachedPropLines(sport, eventId)));
    if (cachedByKnownEvent.every((lines) => lines.length > 0)) {
      const byPlayer = propsByPlayer(cachedByKnownEvent.flat());
      return {
        ...empty,
        propsByPlayer: byPlayer,
        matchedEvents: knownEventIds.length,
        cachedEvents: knownEventIds.length,
        propPlayers: byPlayer.size,
        cacheOnly: true,
      };
    }
  }

  try {
    const eventsUrl = `${envOddsApiBaseUrl().replace(/\/$/, '')}/sports/${sportKey}/events?apiKey=${encodeURIComponent(apiKey)}`;
    const eventsResponse = await limitedFetch(eventsUrl, 'the-odds-api-props', {
      headers: { Accept: 'application/json' },
      timeoutMs: 10_000,
      retries: 1,
      dedupeMs: 1_200,
    });
    const requestsRemaining = eventsResponse.headers.get('x-requests-remaining') ?? undefined;
    if (requestsRemaining) console.log(`The Odds API requests remaining after events call: ${requestsRemaining}`);
    if (!eventsResponse.ok) throw new Error(`The Odds API events ${eventsResponse.status}`);
    const events = await eventsResponse.json() as any[];
    const matchedEvents = events.filter((event) => oddsEventMatchesSlate(sport, event, slate));
    const allLines: PropLine[] = [];
    let cachedEvents = 0;
    let fetchedEvents = 0;
    let latestRequestsRemaining = requestsRemaining;

    for (const event of matchedEvents) {
      const eventId = String(event?.id ?? '');
      if (!eventId) continue;
      const cached = await getCachedPropLines(sport, eventId);
      if (cached.length) {
        cachedEvents += 1;
        allLines.push(...cached);
        continue;
      }

      const fetched = await fetchEventPropLines(sport, sportKey, eventId, markets);
      fetchedEvents += 1;
      if (fetched.requestsRemaining) latestRequestsRemaining = fetched.requestsRemaining;
      let eventLines = fetched.lines;
      const hasBasketballIndividual = eventLines.some((line) => (
        line.market === 'player_points'
        || line.market === 'player_rebounds'
        || line.market === 'player_assists'
      ));
      if ((sport === 'nba' || sport === 'wnba') && !hasBasketballIndividual) {
        const fallback = await fetchEventPropLines(sport, sportKey, eventId, [NBA_PRA_FALLBACK_MARKET]);
        if (fallback.requestsRemaining) latestRequestsRemaining = fallback.requestsRemaining;
        eventLines = [...eventLines, ...fallback.lines];
      }
      const consensus = consensusPropLines(eventLines);
      await cachePropLines(sport, eventId, consensus);
      allLines.push(...consensus);
    }

    const byPlayer = propsByPlayer(allLines);
    return {
      propsByPlayer: byPlayer,
      matchedEvents: matchedEvents.length,
      fetchedEvents,
      cachedEvents,
      propPlayers: byPlayer.size,
      unmatchedPropPlayers: 0,
      requestsRemaining: latestRequestsRemaining,
      cacheOnly: false,
    };
  } catch (error) {
    console.error('The Odds API player props error:', error);
    return empty;
  }
}

function propLine(props: Record<string, number>, market: string): number {
  const value = Number(props[market]);
  return Number.isFinite(value) ? value : 0;
}

function hasAnyProp(props: Record<string, number>, markets: string[]): boolean {
  return markets.some((market) => Number.isFinite(Number(props[market])));
}

function propDerivedProjection(props: Record<string, number>, sport: string, position: string): number | null {
  if (sport === 'nba' || sport === 'wnba') {
    if (hasAnyProp(props, ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_steals', 'player_blocks', 'player_turnovers'])) {
      const points = propLine(props, 'player_points');
      const rebounds = propLine(props, 'player_rebounds');
      const assists = propLine(props, 'player_assists');
      // Props do not expose joint category distributions here; +0.4 is a cheap
      // double-double probability proxy when a second counting-stat line is high.
      const doubleDoubleProxy = points >= 9.5 && (rebounds >= 9.5 || assists >= 9.5) ? 0.4 : 0;
      return Number((dkFantasyPoints({
        points,
        threePointFieldGoalsMade: propLine(props, 'player_threes'),
        totalRebounds: rebounds,
        assists,
        steals: propLine(props, 'player_steals'),
        blocks: propLine(props, 'player_blocks'),
        turnovers: propLine(props, 'player_turnovers'),
      }, sport as DkSport) + doubleDoubleProxy).toFixed(2));
    }
    if (Number.isFinite(Number(props[NBA_PRA_FALLBACK_MARKET]))) {
      // PRA mixes DK weights for points/rebounds/assists; 1.18 approximates that blend.
      return Number((propLine(props, NBA_PRA_FALLBACK_MARKET) * 1.18).toFixed(2));
    }
    return null;
  }

  if (sport === 'mlb') {
    const isPitcher = ['P', 'SP', 'RP'].includes(String(position).toUpperCase());
    if (isPitcher && Number.isFinite(Number(props.pitcher_strikeouts))) {
      // Adds a median-start baseline for expected IP, win equity, and run prevention.
      return Number(Math.min(Math.max(propLine(props, 'pitcher_strikeouts') * 2 + 12.5, 8), 30).toFixed(2));
    }
    if (hasAnyProp(props, ['batter_total_bases', 'batter_runs', 'batter_rbis', 'batter_stolen_bases', 'batter_walks'])) {
      // TB * 3 approximates the weighted DK mix of singles, doubles, triples, and HRs.
      return Number((
        propLine(props, 'batter_total_bases') * 3
        + propLine(props, 'batter_runs') * 2
        + propLine(props, 'batter_rbis') * 2
        + propLine(props, 'batter_walks') * 2
        + propLine(props, 'batter_stolen_bases') * 5
      ).toFixed(2));
    }
    return null;
  }

  if (sport === 'nfl') {
    if (!hasAnyProp(props, ['player_pass_yds', 'player_pass_tds', 'player_pass_interceptions', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_anytime_td'])) {
      return null;
    }
    const tdPrice = Number(props.player_anytime_td);
    const tdProbability = Number.isFinite(tdPrice) ? americanOddsToProbability(tdPrice) / 1.06 : 0;
    return Number((
      propLine(props, 'player_pass_yds') * 0.04
      + propLine(props, 'player_pass_tds') * 4
      - propLine(props, 'player_pass_interceptions')
      + propLine(props, 'player_rush_yds') * 0.1
      + propLine(props, 'player_reception_yds') * 0.1
      + propLine(props, 'player_receptions')
      + tdProbability * 6
    ).toFixed(2));
  }

  return null;
}

function applyPropProjections(players: Player[], propCollection: PlayerPropCollection, sport: string): {
  players: Player[];
  appliedCount: number;
  unmatchedPropPlayers: number;
} {
  const rosterKeys = new Set(players.map((player) => normalizeName(player.name)));
  const unmatchedPropPlayers = [...propCollection.propsByPlayer.keys()].filter((key) => !rosterKeys.has(key)).length;
  let appliedCount = 0;
  const updatedPlayers = players.map((player) => {
    const props = propCollection.propsByPlayer.get(normalizeName(player.name));
    if (!props) return player;
    const propProjection = propDerivedProjection(props, sport, player.position);
    if (typeof propProjection !== 'number' || !Number.isFinite(propProjection) || propProjection <= 0) return player;
    const existingProjection = player.projected_points ?? player.last_5_stats?.avg_fantasy_pts ?? baselineProjection(player.position, sport);
    const position = String(player.position ?? '').toUpperCase();
    const propWeight = (sport === 'mlb' && ['P', 'SP', 'RP'].includes(position)) || (sport === 'nfl' && position === 'QB') ? 0.7 : 0.6;
    const blendedProjection = Number((propProjection * propWeight + existingProjection * (1 - propWeight)).toFixed(2));
    appliedCount += 1;
    return {
      ...player,
      projection_source: 'props_blend',
      prop_projection: propProjection,
      projected_points: blendedProjection,
      last_5_stats: player.last_5_stats ? {
        ...player.last_5_stats,
        avg_fantasy_pts: blendedProjection,
      } : player.last_5_stats,
    };
  });

  return {
    players: updatedPlayers,
    appliedCount,
    unmatchedPropPlayers,
  };
}

async function collectConfirmedLineups(sport: string, contestDate: string): Promise<ConfirmedLineupRow[]> {
  const rows = await callSupabaseRpc<ConfirmedLineupRow[]>('fantasy_ai_get_confirmed_lineups', {
    p_sport: sport,
    p_game_date: contestDate,
  }, { allowMissingServiceRole: true }).catch((error) => {
    console.error('Confirmed lineup lookup failed:', error);
    return null;
  });

  return (rows ?? []).filter((row) => row.team && row.player_name);
}

function newestTimestamp(rows: Array<{ scraped_at?: string | null }>): number {
  return rows.reduce((latest, row) => {
    const parsed = Date.parse(String(row.scraped_at ?? ''));
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
}

function hoursSince(timestamp: number): number | null {
  if (!timestamp) return null;
  return Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
}

function lineupRowsByTeam(lineups: ConfirmedLineupRow[], sport: string): Map<string, ConfirmedLineupRow[]> {
  const byTeam = new Map<string, ConfirmedLineupRow[]>();
  for (const row of lineups) {
    const team = normalizeTeamAbbr(row.team, sport);
    byTeam.set(team, [...(byTeam.get(team) ?? []), row]);
  }
  return byTeam;
}

function lineupInjuryStatus(current: InjuryStatus, tag: ConfirmedLineupRow['injury_tag']): InjuryStatus {
  if (tag === 'OUT') return 'out';
  if ((tag === 'GTD' || tag === 'QUES') && !['out', 'doubtful'].includes(current)) return 'questionable';
  return current;
}

function applyConfirmedLineupContext(players: Player[], lineups: ConfirmedLineupRow[], sport: string): {
  players: Player[];
  appliedCount: number;
  benchCount: number;
  injuryCount: number;
} {
  if (!['nba', 'wnba', 'nfl'].includes(sport) || !lineups.length) {
    return { players, appliedCount: 0, benchCount: 0, injuryCount: 0 };
  }

  const byTeam = lineupRowsByTeam(lineups, sport);
  let appliedCount = 0;
  let benchCount = 0;
  let injuryCount = 0;

  const updatedPlayers = players.map((player) => {
    const team = normalizeTeamAbbr(player.team, sport);
    const teamRows = byTeam.get(team) ?? [];
    if (!teamRows.length) return player;

    const playerKey = normalizeName(player.name);
    const row = teamRows.find((item) => normalizeName(item.player_name) === playerKey);
    const listedStarters = new Set(teamRows.map((item) => normalizeName(item.player_name)));
    const hasTeamStarters = listedStarters.size >= 5;
    const injuryStatus = lineupInjuryStatus(player.injury_status, row?.injury_tag ?? null);
    const injuryChanged = injuryStatus !== player.injury_status;

    let multiplier = 1;
    let confirmedStarter = player.confirmed_starter;
    const noteParts: string[] = [];

    if ((sport === 'nba' || sport === 'wnba') && row) {
      if (row.lineup_status === 'confirmed') {
        multiplier *= 1.06;
        confirmedStarter = true;
        noteParts.push('confirmed starter (Rotowire)');
      } else {
        multiplier *= 1.02;
        confirmedStarter = true;
        noteParts.push('expected starter (Rotowire)');
      }
    } else if ((sport === 'nba' || sport === 'wnba') && hasTeamStarters && !row) {
      multiplier *= 0.85;
      confirmedStarter = false;
      benchCount += 1;
      noteParts.push('not in projected starting lineup');
    }

    if (injuryChanged) {
      injuryCount += 1;
      noteParts.push(row?.injury_tag === 'OUT' ? 'Rotowire OUT' : 'Rotowire game-time decision');
    }

    if (multiplier === 1 && !injuryChanged && confirmedStarter === player.confirmed_starter) return player;

    const projectedPoints = typeof player.projected_points === 'number'
      ? Number((player.projected_points * multiplier).toFixed(2))
      : player.projected_points;
    appliedCount += multiplier !== 1 ? 1 : 0;

    return {
      ...player,
      confirmed_starter: confirmedStarter,
      injury_status: injuryStatus,
      injury_note: injuryChanged ? `Rotowire injury tag: ${row?.injury_tag}` : player.injury_note,
      projected_points: projectedPoints,
      news_note: noteParts.length ? appendNewsNote(player.news_note, noteParts.join('; ')) : player.news_note,
      context_score: Number(((player.context_score ?? 0) + (multiplier - 1)).toFixed(3)),
      last_5_stats: player.last_5_stats && typeof projectedPoints === 'number' ? {
        ...player.last_5_stats,
        avg_fantasy_pts: projectedPoints,
      } : player.last_5_stats,
    };
  });

  return { players: updatedPlayers, appliedCount, benchCount, injuryCount };
}

function normalizeMlbTeam(value: unknown): string {
  const raw = String(value ?? '').toUpperCase();
  return MLB_TEAM_ABBR_ALIASES[raw] ?? raw;
}

function weatherFactorFromForecast(period: any): { factor: number; note?: string } {
  if (!period) return { factor: 1 };
  const temp = Number(period.temperature);
  const windText = String(period.windSpeed ?? '');
  const windMatch = windText.match(/(\d+)/);
  const windMph = windMatch ? Number(windMatch[1]) : 0;
  const shortForecast = String(period.shortForecast ?? '').toLowerCase();

  let factor = 1;
  if (Number.isFinite(temp)) {
    if (temp >= 88) factor += 0.035;
    else if (temp >= 78) factor += 0.02;
    else if (temp <= 50) factor -= 0.025;
    else if (temp <= 60) factor -= 0.012;
  }
  if (windMph >= 15) factor += 0.018;
  else if (windMph >= 10) factor += 0.01;
  if (/rain|thunder|shower|storm/.test(shortForecast)) factor -= 0.03;

  const parts = [
    Number.isFinite(temp) ? `${temp}F` : '',
    windText ? `wind ${windText}` : '',
    period.shortForecast ? String(period.shortForecast) : '',
  ].filter(Boolean);
  return {
    factor: Number(Math.min(Math.max(factor, 0.93), 1.08).toFixed(3)),
    note: parts.join(', ') || undefined,
  };
}

async function collectNwsWeatherFactor(team: string, startTime?: string): Promise<{ factor: number; note?: string }> {
  const park = MLB_PARK_CONTEXT[team];
  if (!park || park.roof) return { factor: 1, note: park?.roof ? 'roof/indoor park' : undefined };

  try {
    const pointsResponse = await limitedFetch(
      `https://api.weather.gov/points/${park.lat},${park.lon}`,
      'nws-points',
      {
        headers: {
          Accept: 'application/geo+json, application/json',
          'User-Agent': 'fantasy-ai/1.0 free-weather-context',
        },
        timeoutMs: 8_000,
        retries: 1,
        dedupeMs: 600,
      },
    );
    if (!pointsResponse.ok) return { factor: 1 };
    const pointData = await pointsResponse.json() as any;
    const hourlyUrl = pointData?.properties?.forecastHourly;
    if (!hourlyUrl) return { factor: 1 };

    const forecastResponse = await limitedFetch(hourlyUrl, 'nws-hourly', {
      headers: {
        Accept: 'application/geo+json, application/json',
        'User-Agent': 'fantasy-ai/1.0 free-weather-context',
      },
      timeoutMs: 8_000,
      retries: 1,
      dedupeMs: 600,
    });
    if (!forecastResponse.ok) return { factor: 1 };
    const forecastData = await forecastResponse.json() as any;
    const periods = forecastData?.properties?.periods ?? [];
    const targetTime = startTime ? new Date(startTime).getTime() : Date.now();
    const matched = periods.find((period: any) => {
      const periodStart = new Date(period?.startTime ?? '').getTime();
      const periodEnd = new Date(period?.endTime ?? '').getTime();
      return Number.isFinite(periodStart) && Number.isFinite(periodEnd) && targetTime >= periodStart && targetTime <= periodEnd;
    }) ?? periods[0];
    return weatherFactorFromForecast(matched);
  } catch (error) {
    console.error(`NWS weather error for ${team}:`, error);
    return { factor: 1 };
  }
}

function parseMlbLiveLineupTeam(teamBox: any): { battingOrder: Record<string, number>; starters: Set<string> } {
  const players = teamBox?.players ?? {};
  const battingOrder: Record<string, number> = {};
  const starters = new Set<string>();

  for (const player of Object.values(players) as any[]) {
    const personId = player?.person?.id ? String(player.person.id) : '';
    const fullName = String(player?.person?.fullName ?? '');
    const order = Number(player?.battingOrder);
    const isStarter = Boolean(player?.gameStatus?.isCurrentBatter)
      || Boolean(player?.gameStatus?.isOnBench === false)
      || Boolean(player?.allPositions?.length)
      || Number.isFinite(order);
    if (fullName && isStarter) starters.add(normalizeName(fullName));
    if (personId && isStarter) starters.add(personId);
    if (fullName && Number.isFinite(order) && order > 0) {
      battingOrder[normalizeName(fullName)] = Math.floor(order / 100);
    }
    if (personId && Number.isFinite(order) && order > 0) {
      battingOrder[personId] = Math.floor(order / 100);
    }
  }

  return { battingOrder, starters };
}

async function collectMlbLiveLineupContext(gameId: string, homeTeam: string, awayTeam: string): Promise<{
  batting_orders: Record<string, Record<string, number>>;
  confirmed_starters: Record<string, Set<string>>;
  lineup_note?: string;
} | null> {
  if (!gameId) return null;

  try {
    const response = await limitedFetch(
      `https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(gameId)}/feed/live`,
      'mlb-live-feed',
      { headers: { Accept: 'application/json' }, timeoutMs: 10_000, retries: 1, dedupeMs: 500 },
    );
    if (!response.ok) return null;
    const data = await response.json() as any;
    const home = parseMlbLiveLineupTeam(data?.liveData?.boxscore?.teams?.home);
    const away = parseMlbLiveLineupTeam(data?.liveData?.boxscore?.teams?.away);
    const battingOrderCount = Object.keys(home.battingOrder).length + Object.keys(away.battingOrder).length;
    const starterCount = home.starters.size + away.starters.size;
    if (!battingOrderCount && !starterCount) return null;

    return {
      batting_orders: {
        [homeTeam]: home.battingOrder,
        [awayTeam]: away.battingOrder,
      },
      confirmed_starters: {
        [homeTeam]: home.starters,
        [awayTeam]: away.starters,
      },
      lineup_note: battingOrderCount
        ? `MLB live feed batting order detected for ${battingOrderCount} player keys`
        : `MLB live feed starter context detected for ${starterCount} player keys`,
    };
  } catch (error) {
    console.error(`MLB live lineup error for ${gameId}:`, error);
    return null;
  }
}

async function collectMlbFreeGameContext(contestDate: string, slate?: DraftKingsSlate): Promise<MlbGameContext[]> {
  const slateTeams = new Set(slateTeamAbbreviations(slate).map(normalizeMlbTeam));
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(contestDate)}&hydrate=probablePitcher,venue`;
    const response = await limitedFetch(url, 'mlb-schedule-context', {
      headers: { Accept: 'application/json' },
      timeoutMs: 10_000,
      retries: 1,
      dedupeMs: 500,
    });
    if (!response.ok) throw new Error(`MLB schedule ${response.status}`);
    const data = await response.json() as any;
    const games = (data?.dates ?? []).flatMap((date: any) => date?.games ?? []);
    const filtered = games.filter((game: any) => {
      if (!slateTeams.size) return true;
      const home = normalizeMlbTeam(game?.teams?.home?.team?.abbreviation);
      const away = normalizeMlbTeam(game?.teams?.away?.team?.abbreviation);
      return slateTeams.has(home) || slateTeams.has(away);
    });

    return await Promise.all(filtered.map(async (game: any) => {
      const home = normalizeMlbTeam(game?.teams?.home?.team?.abbreviation);
      const away = normalizeMlbTeam(game?.teams?.away?.team?.abbreviation);
      const park = MLB_PARK_CONTEXT[home];
      const gameId = String(game?.gamePk ?? '');
      const [weather, lineupContext] = await Promise.all([
        collectNwsWeatherFactor(home, game?.gameDate),
        collectMlbLiveLineupContext(gameId, home, away),
      ]);
      const parkFactor = park?.park_factor ?? 1;
      const runFactor = Number(Math.min(Math.max(parkFactor * weather.factor, 0.88), 1.22).toFixed(3));
      return {
        game_id: gameId,
        home_team: home,
        away_team: away,
        venue_name: game?.venue?.name ?? park?.venue,
        start_time: game?.gameDate,
        probable_pitchers: {
          [home]: {
            id: game?.teams?.home?.probablePitcher?.id ? String(game.teams.home.probablePitcher.id) : undefined,
            name: String(game?.teams?.home?.probablePitcher?.fullName ?? ''),
          },
          [away]: {
            id: game?.teams?.away?.probablePitcher?.id ? String(game.teams.away.probablePitcher.id) : undefined,
            name: String(game?.teams?.away?.probablePitcher?.fullName ?? ''),
          },
        },
        batting_orders: lineupContext?.batting_orders,
        confirmed_starters: lineupContext?.confirmed_starters,
        park_factor: parkFactor,
        weather_factor: weather.factor,
        run_factor: runFactor,
        weather_note: weather.note,
        lineup_note: lineupContext?.lineup_note,
      };
    }));
  } catch (error) {
    console.error('MLB free game context error:', error);
    return [];
  }
}

function mlbContextByTeam(contexts: MlbGameContext[]): Map<string, MlbGameContext> {
  const byTeam = new Map<string, MlbGameContext>();
  for (const context of contexts) {
    byTeam.set(context.home_team, context);
    byTeam.set(context.away_team, context);
  }
  return byTeam;
}

function mergeRotowireMlbLineups(contexts: MlbGameContext[], lineups: ConfirmedLineupRow[]): MlbGameContext[] {
  if (!contexts.length || !lineups.length) return contexts;
  return contexts;
}

function applyMlbFreeContext(players: Player[], contexts: MlbGameContext[]): Player[] {
  if (!contexts.length) return players;
  const byTeam = mlbContextByTeam(contexts);
  return players.map((player) => {
    const team = normalizeMlbTeam(player.team);
    const context = byTeam.get(team);
    if (!context || !player.projected_points) return player;

    const isPitcher = /^(P|SP|RP)$/.test(player.position);
    const opponent = team === context.home_team ? context.away_team : context.home_team;
    const opponentProbable = context.probable_pitchers[opponent];
    const ownProbable = context.probable_pitchers[team];
    const opponentProbablePitcher = opponentProbable?.name;
    const ownProbablePitcher = ownProbable?.name;
    const playerKeys = [player.id, normalizeName(player.name)].filter(Boolean);
    const battingOrder = playerKeys
      .map((key) => context.batting_orders?.[team]?.[key])
      .find((order) => Number.isFinite(order) && order > 0);
    const isConfirmedStarter = playerKeys.some((key) => context.confirmed_starters?.[team]?.has(key));
    const isDraftKingsConfirmedStarter = /\bDraftKings confirmed starter\b/i.test(player.news_note ?? '');
    const hasConfirmedTeamLineup = (context.confirmed_starters?.[team]?.size ?? 0) >= 8;
    let multiplier = isPitcher ? 2 - context.run_factor : context.run_factor;
    if (isPitcher && ownProbablePitcher && normalizeName(ownProbablePitcher) === normalizeName(player.name)) {
      multiplier += 0.03;
    }
    if (!isPitcher && battingOrder) {
      if (battingOrder <= 2) multiplier += 0.045;
      else if (battingOrder <= 5) multiplier += 0.028;
      else if (battingOrder >= 8) multiplier -= 0.018;
    } else if (!isPitcher && hasConfirmedTeamLineup && !isConfirmedStarter) {
      multiplier -= 0.18;
    }
    multiplier = Math.min(Math.max(multiplier, isPitcher ? 0.9 : 0.88), isPitcher ? 1.12 : 1.18);

    const projectedPoints = Number((player.projected_points * multiplier).toFixed(2));
    const noteParts = [
      `${context.venue_name ?? 'MLB park'} run factor ${context.run_factor.toFixed(2)}`,
      context.weather_note,
      opponentProbablePitcher && !isPitcher ? `vs probable ${opponentProbablePitcher}` : '',
      !isPitcher && battingOrder ? `batting ${battingOrder}` : '',
      !isPitcher && hasConfirmedTeamLineup && !isConfirmedStarter ? 'not in confirmed lineup' : '',
      isPitcher && ownProbablePitcher ? `probable starter: ${ownProbablePitcher}` : '',
    ].filter(Boolean);

    return {
      ...player,
      confirmed_starter: isPitcher
        ? (ownProbablePitcher && normalizeName(ownProbablePitcher) === normalizeName(player.name) ? true : isDraftKingsConfirmedStarter || isConfirmedStarter)
        : hasConfirmedTeamLineup ? isConfirmedStarter : (isConfirmedStarter || isDraftKingsConfirmedStarter),
      batting_order: !isPitcher && battingOrder ? battingOrder : undefined,
      run_factor: context.run_factor,
      opponent_team: opponent,
      opposing_probable_pitcher_id: opponentProbable?.id ?? player.opposing_probable_pitcher_id,
      opposing_probable_pitcher_name: opponentProbablePitcher ?? player.opposing_probable_pitcher_name,
      own_probable_starter: isPitcher
        ? (ownProbablePitcher ? normalizeName(ownProbablePitcher) === normalizeName(player.name) : isDraftKingsConfirmedStarter)
        : player.own_probable_starter,
      game_id: context.game_id || player.game_id,
      context_score: Number((multiplier - 1).toFixed(3)),
      projected_points: projectedPoints,
      news_score: Number(((player.news_score ?? 0) + (multiplier - 1) * 3).toFixed(2)),
      news_note: [player.news_note, noteParts.join('; ')].filter(Boolean).join(' | '),
      last_5_stats: player.last_5_stats ? {
        ...player.last_5_stats,
        avg_fantasy_pts: projectedPoints,
      } : player.last_5_stats,
    };
  });
}

const VEGAS_LEAGUE_AVERAGES: Record<string, { impliedTotal: number; sensitivity: number; min: number; max: number }> = {
  // Approximate team implied-total baselines for free Vegas projection context.
  nba: { impliedTotal: 114, sensitivity: 0.5, min: 0.9, max: 1.12 },
  wnba: { impliedTotal: 81, sensitivity: 0.5, min: 0.9, max: 1.12 },
  nfl: { impliedTotal: 21.5, sensitivity: 0.75, min: 0.85, max: 1.18 },
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function appendNewsNote(existing: string | undefined, note: string): string {
  return [existing, note].filter(Boolean).join(' | ');
}

function teamSpread(context: VegasContext, team: string): number {
  if (team === context.home_team) return context.spread;
  if (team === context.away_team) return -context.spread;
  return 0;
}

function teamImpliedTotal(context: VegasContext, team: string): number | undefined {
  if (team === context.home_team && typeof context.home_implied === 'number') return context.home_implied;
  if (team === context.away_team && typeof context.away_implied === 'number') return context.away_implied;
  return undefined;
}

function opponentImpliedTotal(context: VegasContext, team: string): number | undefined {
  if (team === context.home_team && typeof context.away_implied === 'number') return context.away_implied;
  if (team === context.away_team && typeof context.home_implied === 'number') return context.home_implied;
  return undefined;
}

function vegasContextByTeam(vegasContext: MiosManifest['vegas_context'], sport: string): Map<string, VegasContext> {
  const byTeam = new Map<string, VegasContext>();
  for (const context of vegasContext) {
    if (!context.over_under || context.over_under <= 0 || !context.home_team || !context.away_team) continue;
    if (typeof context.home_implied !== 'number' || typeof context.away_implied !== 'number') continue;
    byTeam.set(normalizeTeamAbbr(context.home_team, sport), context);
    byTeam.set(normalizeTeamAbbr(context.away_team, sport), context);
  }
  return byTeam;
}

function slateImpliedTotalBaseline(vegasContext: MiosManifest['vegas_context'], sport: string): number | null {
  const impliedTotals = vegasContext.flatMap((context) => [context.home_implied, context.away_implied])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (impliedTotals.length < (sport === 'nfl' ? 2 : 4)) return null;
  return impliedTotals.reduce((sum, value) => sum + value, 0) / impliedTotals.length;
}

function vegasMultiplier(player: Player, context: VegasContext, sport: string, team: string, baselineImpliedTotal?: number): { multiplier: number; implied: number; notePrefix: string } | null {
  const config = VEGAS_LEAGUE_AVERAGES[sport];
  if (!config) return null;
  const baseline = baselineImpliedTotal && Number.isFinite(baselineImpliedTotal) ? baselineImpliedTotal : config.impliedTotal;

  if (sport === 'nfl' && String(player.position ?? '').toUpperCase() === 'DST') {
    const opponentImplied = opponentImpliedTotal(context, team);
    if (typeof opponentImplied !== 'number') return null;
    const dstMultiplier = clampNumber(
      1 + ((baseline - opponentImplied) / baseline) * 0.6,
      0.85,
      1.15,
    );
    return { multiplier: dstMultiplier, implied: opponentImplied, notePrefix: 'DST opponent implied' };
  }

  const implied = teamImpliedTotal(context, team);
  if (typeof implied !== 'number') return null;
  const rawDelta = ((implied - baseline) / baseline) * config.sensitivity;
  const isUnderdogRb = sport === 'nfl' && String(player.position ?? '').toUpperCase() === 'RB' && teamSpread(context, team) > 0;
  const multiplier = clampNumber(1 + (isUnderdogRb ? rawDelta * 0.5 : rawDelta), config.min, config.max);
  return { multiplier, implied, notePrefix: 'Team implied' };
}

function applyVegasContext(
  players: Player[],
  vegasContext: MiosManifest['vegas_context'],
  _slate: DraftKingsSlate | undefined,
  sport: string,
): Player[] {
  if (!['nba', 'wnba', 'nfl'].includes(sport)) return players;
  if (!vegasContext.some((context) => context.over_under > 0)) return players;

  const byTeam = vegasContextByTeam(vegasContext, sport);
  if (!byTeam.size) return players;
  const baseline = slateImpliedTotalBaseline(vegasContext, sport);

  return players.map((player) => {
    const team = normalizeTeamAbbr(player.team, sport);
    const context = byTeam.get(team);
    if (!context) return player;
    const adjustment = vegasMultiplier(player, context, sport, team, baseline ?? undefined);
    if (!adjustment) return player;

    const blowoutMultiplier = (sport === 'nba' || sport === 'wnba') && Math.abs(context.spread) >= 11 ? 0.97 : 1;
    const multiplier = adjustment.multiplier * blowoutMultiplier;
    const projectedPoints = player.projected_points
      ? Number((player.projected_points * multiplier).toFixed(2))
      : player.projected_points;
    const deltaPercent = (adjustment.multiplier - 1) * 100;
    const spreadText = context.spread > 0 ? `+${context.spread}` : String(context.spread);
    const baselineText = (baseline ?? VEGAS_LEAGUE_AVERAGES[sport]?.impliedTotal ?? adjustment.implied).toFixed(1);
    const vegasNote = `${adjustment.notePrefix} ${adjustment.implied.toFixed(1)} (${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}% vs slate avg ${baselineText})`;
    const blowoutNote = blowoutMultiplier < 1 ? `blowout risk (spread ${spreadText})` : '';

    return {
      ...player,
      implied_total: adjustment.implied,
      spread: teamSpread(context, team),
      opponent_team: team === context.home_team ? context.away_team : team === context.away_team ? context.home_team : player.opponent_team,
      game_id: context.game_id || player.game_id,
      projected_points: projectedPoints,
      context_score: Number(((player.context_score ?? 0) + (multiplier - 1)).toFixed(3)),
      news_note: appendNewsNote(player.news_note, [vegasNote, blowoutNote].filter(Boolean).join('; ')),
      last_5_stats: player.last_5_stats && typeof projectedPoints === 'number' ? {
        ...player.last_5_stats,
        avg_fantasy_pts: projectedPoints,
      } : player.last_5_stats,
    };
  });
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });
}

function statcastUrl(playerType: 'batter' | 'pitcher', startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    all: 'true',
    hfPT: '',
    hfAB: '',
    hfBBT: '',
    hfPR: '',
    hfZ: '',
    stadium: '',
    hfBBL: '',
    hfNewZones: '',
    hfGT: 'R|PO|S|',
    hfC: '',
    hfSea: `${new Date(startDate).getUTCFullYear()}|`,
    hfSit: '',
    hfOuts: '',
    opponent: '',
    pitcher_throws: '',
    batter_stands: '',
    hfSA: '',
    player_type: playerType,
    hfInfield: '',
    team: '',
    position: '',
    hfOutfield: '',
    hfRO: '',
    home_road: '',
    game_date_gt: startDate,
    game_date_lt: endDate,
    hfFlag: '',
    hfPull: '',
    metric_1: '',
    hfInn: '',
    min_pitches: '0',
    min_results: '0',
    group_by: 'name',
    sort_col: 'pitches',
    player_event_sort: 'h_launch_speed',
    sort_order: 'desc',
    min_abs: '0',
    type: 'details',
  });
  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

function statcastNumber(row: Record<string, string>, key: string): number {
  const parsed = Number(row[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateBatterStatcast(rows: Record<string, string>[]): StatcastQuality[] {
  const grouped = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const playerId = row.batter;
    const name = row.player_name;
    const key = playerId || normalizeName(name);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()].map(([key, playerRows]) => {
    const battedBalls = playerRows.filter((row) => statcastNumber(row, 'launch_speed') > 0);
    const hardHits = battedBalls.filter((row) => statcastNumber(row, 'launch_speed') >= 95).length;
    const barrels = battedBalls.filter((row) => {
      const speed = statcastNumber(row, 'launch_speed');
      const angle = statcastNumber(row, 'launch_angle');
      return speed >= 98 && angle >= 8 && angle <= 32;
    }).length;
    const avgXwoba = battedBalls.reduce((sum, row) => sum + statcastNumber(row, 'estimated_woba_using_speedangle'), 0) / Math.max(battedBalls.length, 1);
    const hardHitRate = hardHits / Math.max(battedBalls.length, 1);
    const barrelRate = barrels / Math.max(battedBalls.length, 1);
    const qualityScore = Math.min(Math.max((hardHitRate - 0.38) * 0.9 + (barrelRate - 0.08) * 1.4 + (avgXwoba - 0.32) * 0.7, -0.12), 0.14);
    const name = playerRows[0]?.player_name ?? key;
    return {
      player_key: key,
      name_key: normalizeName(name),
      sample_size: battedBalls.length,
      quality_score: Number(qualityScore.toFixed(3)),
      note: `Statcast ${battedBalls.length} BBE: ${(hardHitRate * 100).toFixed(0)}% hard hit, ${(barrelRate * 100).toFixed(0)}% barrel-ish, ${avgXwoba.toFixed(3)} xwOBA (${name})`,
    };
  }).filter((quality) => quality.sample_size >= 5);
}

function aggregatePitcherStatcast(rows: Record<string, string>[]): StatcastQuality[] {
  const grouped = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const playerId = row.pitcher;
    const name = row.player_name;
    const key = playerId || normalizeName(name);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()].map(([key, playerRows]) => {
    const pitches = playerRows.length;
    const battedBalls = playerRows.filter((row) => statcastNumber(row, 'launch_speed') > 0);
    const hardAllowed = battedBalls.filter((row) => statcastNumber(row, 'launch_speed') >= 95).length;
    const avgXwobaAllowed = battedBalls.reduce((sum, row) => sum + statcastNumber(row, 'estimated_woba_using_speedangle'), 0) / Math.max(battedBalls.length, 1);
    const strikeouts = playerRows.filter((row) => /strikeout/i.test(row.events ?? '')).length;
    const walks = playerRows.filter((row) => /walk/i.test(row.events ?? '')).length;
    const hardAllowedRate = hardAllowed / Math.max(battedBalls.length, 1);
    const strikeoutRate = strikeouts / Math.max(playerRows.filter((row) => row.events).length, 1);
    const walkRate = walks / Math.max(playerRows.filter((row) => row.events).length, 1);
    const qualityScore = Math.min(Math.max((0.4 - hardAllowedRate) * 0.7 + (0.31 - avgXwobaAllowed) * 0.65 + (strikeoutRate - 0.22) * 0.45 - Math.max(walkRate - 0.09, 0) * 0.35, -0.1), 0.12);
    const name = playerRows[0]?.player_name ?? key;
    return {
      player_key: key,
      name_key: normalizeName(name),
      sample_size: pitches,
      quality_score: Number(qualityScore.toFixed(3)),
      note: `Statcast ${pitches} pitches: ${(hardAllowedRate * 100).toFixed(0)}% hard allowed, ${avgXwobaAllowed.toFixed(3)} xwOBA allowed (${name})`,
    };
  }).filter((quality) => quality.sample_size >= 30);
}

async function collectStatcastQuality(): Promise<Map<string, StatcastQuality>> {
  const endDate = dateDaysAgo(1);
  const startDate = dateDaysAgo(21);
  try {
    const [batterResponse, pitcherResponse] = await Promise.all([
      limitedFetch(statcastUrl('batter', startDate, endDate), 'savant-batters', {
        headers: { Accept: 'text/csv' },
        timeoutMs: 16_000,
        retries: 1,
        dedupeMs: 1_000,
      }),
      limitedFetch(statcastUrl('pitcher', startDate, endDate), 'savant-pitchers', {
        headers: { Accept: 'text/csv' },
        timeoutMs: 16_000,
        retries: 1,
        dedupeMs: 1_000,
      }),
    ]);
    const qualityRows = [
      ...(batterResponse.ok ? aggregateBatterStatcast(parseCsv(await batterResponse.text())) : []),
      ...(pitcherResponse.ok ? aggregatePitcherStatcast(parseCsv(await pitcherResponse.text())) : []),
    ];
    const qualityByKey = new Map<string, StatcastQuality>();
    for (const quality of qualityRows) {
      qualityByKey.set(quality.player_key, quality);
      qualityByKey.set(quality.name_key, quality);
    }
    return qualityByKey;
  } catch (error) {
    console.error('Baseball Savant Statcast quality error:', error);
    return new Map();
  }
}

function applyStatcastQuality(players: Player[], qualityByKey: Map<string, StatcastQuality>): Player[] {
  if (!qualityByKey.size) return players;
  return players.map((player) => {
    const quality = qualityByKey.get(String(player.id).replace(/^dk:/, '')) ?? qualityByKey.get(normalizeName(player.name));
    if (!quality || !player.projected_points) return player;
    const multiplier = Math.min(Math.max(1 + quality.quality_score, 0.88), 1.14);
    const projectedPoints = Number((player.projected_points * multiplier).toFixed(2));
    return {
      ...player,
      context_score: Number(((player.context_score ?? 0) + quality.quality_score).toFixed(3)),
      projected_points: projectedPoints,
      news_score: Number(((player.news_score ?? 0) + quality.quality_score * 4).toFixed(2)),
      news_note: [player.news_note, quality.note].filter(Boolean).join(' | '),
      last_5_stats: player.last_5_stats ? {
        ...player.last_5_stats,
        avg_fantasy_pts: projectedPoints,
        confidence: Math.min(Math.max((player.last_5_stats.confidence ?? 0.6) + Math.min(Math.abs(quality.quality_score), 0.04), 0.2), 0.95),
      } : player.last_5_stats,
    };
  });
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
    depth_chart_order: Number.isFinite(Number(raw.depth_chart_order)) ? Number(raw.depth_chart_order) : undefined,
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
      is_synthetic: true,
      games: [],
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
  };

  try {
    const response = await limitedFetch(sportMap[sport], 'espn-news', { timeoutMs: 5000, retries: 1 });
    const xml = await response.text();
    const espnItems = xml
      .split('\n')
      .filter((line) => NEWS_INJURY_PREFILTER_PATTERN.test(line))
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
        depth_chart_order: player.depth_chart_order,
        depth_chart_position: player.depth_chart_position,
      }));
  } catch (error) {
    console.error('Sleeper error:', error);
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
  if (!abbreviation) return undefined;
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${String(abbreviation).toLowerCase()}.png`;
}

async function collectEspnRosterIndex(sport: string): Promise<Map<string, string>> {
  const players = await collectEspnRosters(sport);
  return new Map(players.map((player) => [normalizeName(player.name), player.espn_id ?? player.id]));
}

async function collectRoster(sport: string, warnings: string[], sourceStatus: SourceStatus): Promise<Player[]> {
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
  const fantasyScores = games.map((game) => {
    if (sport === 'nba' || sport === 'wnba' || sport === 'nfl' || sport === 'mlb') {
      return dkFantasyPoints(game, sport as DkSport);
    }
    return Number(game.points ?? 0);
  });
  averages.avg_fantasy_pts = Number((fantasyScores.reduce((sum, value) => sum + value, 0) / games.length).toFixed(2));
  averages.fantasy_points = averages.avg_fantasy_pts;
  const sampleVariance = fantasyScores.reduce((sum, value) => sum + (value - averages.avg_fantasy_pts) ** 2, 0) / Math.max(fantasyScores.length - 1, 1);
  averages.stdev_fantasy_pts = Number(Math.sqrt(sampleVariance).toFixed(2));
  averages.games_sample_size = fantasyScores.length;
  const minutes = games
    .map((game) => Number(game.minutes ?? game.avgMinutes))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (minutes.length) {
    const minutesAvg = minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
    const minutesVariance = minutes.reduce((sum, value) => sum + (value - minutesAvg) ** 2, 0) / Math.max(minutes.length - 1, 1);
    averages.minutes_stdev = Number(Math.sqrt(minutesVariance).toFixed(2));
  }
  return averages;
}

function minutesAverageFromAggregates(stats: any): number | undefined {
  const value = Number(stats?.aggregated_stats?.minutes ?? stats?.aggregated_stats?.avgMinutes);
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
    game.fantasy_points = Number(
      (sport === 'nba' || sport === 'wnba' || sport === 'nfl' || sport === 'mlb'
        ? dkFantasyPoints(game as Record<string, number>, sport as DkSport)
        : Number(game.points ?? 0)
      ).toFixed(2),
    );
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
      threePointFieldGoalsMade: Number(row?.fg3m ?? 0),
    };
    return {
      ...game,
      fantasy_points: Number(dkFantasyPoints(game, sport as DkSport).toFixed(2)),
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
      fantasy_points: Number(dkFantasyPoints(game, 'mlb').toFixed(2)),
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
  if (sport === 'mlb') return null;
  if (!player.espn_id) {
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
  const inFlight = redditRssInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const headers = {
      Accept: 'application/atom+xml, application/rss+xml, text/xml',
      'User-Agent': redditRssUserAgent(),
    };
    const response = await limitedFetch(url, `reddit-rss:${cacheKey}`, {
      headers,
      timeoutMs: 12_000,
      retries: 0,
      dedupeMs: 2_000,
    }).catch(() => null);
    const retryUrl = url.replace('https://www.reddit.com/', 'https://old.reddit.com/');
    const finalResponse = response?.ok ? response : await limitedFetch(retryUrl, `reddit-rss-old:${cacheKey}`, {
      headers,
      timeoutMs: 12_000,
      retries: 0,
      dedupeMs: 2_000,
    });
    if (!finalResponse.ok) throw new Error(`Reddit RSS ${finalResponse.status}`);

    const items = parseRedditAtom(await finalResponse.text()).slice(0, 40);
    redditRssCache.set(cacheKey, { items, cachedAt: Date.now() });
    return items;
  })().finally(() => {
    redditRssInFlight.delete(cacheKey);
  });
  redditRssInFlight.set(cacheKey, request);
  return request;
}

async function collectSportRedditItems(sport: string): Promise<RedditFeedItem[]> {
  const subreddits = redditSubredditsForSport(sport).join('+');
  return await fetchRedditRss(
    `https://www.reddit.com/r/${subreddits}/new.rss?limit=40`,
    `${sport}:subreddits:${subreddits}`,
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

async function collectRedditSentiment(playerId: string, playerName: string, sport: string): Promise<any> {
  const cached = await getCachedSocialSentiment(playerId, sport);
  if (cached) return cached;

  try {
    const sportMatches = redditItemsMatchingPlayer(await collectSportRedditItems(sport), playerName);
    const posts = sportMatches;
    const sentiment = scoreRedditItems(posts);

    const sentimentResult = {
      player_id: playerId,
      reddit_mentions: posts.length,
      sentiment_score: sentiment,
      key_themes: posts.length === 0
        ? ['rss_no_mentions']
        : ['subreddit_rss_match'],
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
  const minutesAvg = minutesAverageFromAggregates(stats);

  if (sport === 'mlb' && player.projection_source === 'draftkings' && typeof player.projected_points === 'number' && player.projected_points > 0) {
    const blendedProjection = Number((player.projected_points * 0.72 + avg * 0.28).toFixed(2));
    const boundedProjection = Math.min(
      Math.max(blendedProjection, player.projected_points * 0.82),
      player.projected_points * 1.18,
    );
    return {
      ...player,
      projection_source: 'draftkings_last5_blend',
      projected_points: Number(boundedProjection.toFixed(2)),
      last_5_stats: {
        avg_points: avg,
        avg_fantasy_pts: avg,
        trend: 'stable',
        confidence: Math.max(stats.confidence_score ?? 0.7, player.last_5_stats?.confidence ?? 0.62),
        minutes_avg: minutesAvg,
        games,
      },
    };
  }

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
      minutes_avg: minutesAvg,
      games,
    },
  };
}

function projectedPointsForPriority(player: Player): number {
  return player.projected_points ?? player.last_5_stats?.avg_fantasy_pts ?? 0;
}

function prioritizedEnrichmentRoster(players: Player[], sport: string): EnrichmentPlan {
  // Bounded enrichment request budget: duration ~= request count / concurrency *
  // provider latency. MLB last-5 enrichment can require both a player search and
  // a game-log fetch, so keep its live budget deliberately smaller.
  const cap = sport === 'mlb' ? 0 : 80;
  const studCap = sport === 'mlb' ? 0 : 30;
  const bucketByPlayerId = new Map<string, EnrichmentBucket>();
  const selected: Player[] = [];
  const counts: Record<EnrichmentBucket, number> = { stud: 0, value: 0, mid: 0, other: 0 };

  const addPlayer = (player: Player, bucket: EnrichmentBucket): boolean => {
    if (selected.length >= cap || bucketByPlayerId.has(player.id)) return false;
    bucketByPlayerId.set(player.id, bucket);
    counts[bucket] += 1;
    selected.push(player);
    return true;
  };

  const studs = [...players]
    .sort((a, b) => projectedPointsForPriority(b) - projectedPointsForPriority(a))
    .slice(0, studCap);
  for (const player of studs) addPlayer(player, 'stud');

  const valueSalaryMax = sport === 'nfl' ? 6000 : 5500;
  const values = [...players]
    .filter((player) => {
      const position = String(player.position ?? '').toUpperCase();
      return !bucketByPlayerId.has(player.id)
        && player.salary <= valueSalaryMax
        && !(sport === 'nfl' && position === 'QB')
        && player.injury_status === 'active'
        && (player.projection_source === 'position_baseline' || player.salary_source === 'draftkings_import');
    })
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 40);
  for (const player of values) addPlayer(player, 'value');

  const mids = [...players]
    .filter((player) => !bucketByPlayerId.has(player.id) && player.salary >= 5600 && player.salary <= 7200)
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 20);

  for (const player of mids) addPlayer(player, 'mid');

  if (players.length <= cap) {
    for (const player of players) addPlayer(player, 'other');
  }

  return {
    players: selected.slice(0, cap),
    bucketByPlayerId,
    counts,
    cap,
  };
}

async function getProjectionCalibration(sport: string): Promise<ProjectionCalibrationBundle> {
  const [sportWideRows, cellRows] = await Promise.all([
    callSupabaseRpc<ProjectionCalibrationRow[]>('fantasy_ai_projection_calibration', {
      p_sport: sport,
      p_days: 45,
    }, { allowMissingServiceRole: true }).catch(() => null),
    callSupabaseRpc<ProjectionCalibrationV2Row[]>('fantasy_ai_projection_calibration_v2', {
      p_sport: sport,
      p_days: 45,
    }, { allowMissingServiceRole: true }).catch(() => null),
  ]);
  return {
    sportWide: sportWideRows?.[0] ?? null,
    cells: cellRows ?? [],
  };
}

function calibrationPositionGroup(player: Player, sport: string): string {
  const rawPosition = String(player.position ?? '').toUpperCase();
  const parts = rawPosition.split('/').map((part) => part.trim()).filter(Boolean);
  if (sport === 'nba' || sport === 'wnba') {
    if (parts.includes('C')) return 'C';
    if (parts.some((part) => part === 'PG' || part === 'SG' || part === 'G')) return 'G';
    return 'F';
  }
  if (sport === 'nfl') {
    const position = parts[0] === 'DEF' ? 'DST' : parts[0];
    return ['QB', 'RB', 'WR', 'TE', 'DST'].includes(position) ? position : position || 'UNK';
  }
  if (sport === 'mlb') {
    if (parts.some((part) => ['P', 'SP', 'RP'].includes(part))) return 'P';
    if (parts.includes('OF')) return 'OF';
    if (parts.includes('C')) return 'C';
    return 'IF';
  }
  return parts[0] || 'UNK';
}

function calibrationSalaryTier(player: Player): string {
  const salary = Number(player.salary ?? 0);
  if (!Number.isFinite(salary) || salary <= 0) return 'unknown';
  if (salary < 5500) return 'value';
  if (salary < 8000) return 'mid';
  return 'premium';
}

function applyProjectionCalibration(players: Player[], calibration: ProjectionCalibrationBundle, sport: string): {
  players: Player[];
  applied: boolean;
  sportWideMultiplier: number;
  activeCellCount: number;
  appliedPlayerCount: number;
  v2AppliedPlayerCount: number;
} {
  const sampleSize = Number(calibration.sportWide?.sample_size ?? 0);
  const rawSportWideMultiplier = Number(calibration.sportWide?.projection_bias_multiplier ?? 1);
  const sportWideMultiplier = sampleSize >= 50 && Number.isFinite(rawSportWideMultiplier)
    ? Math.min(Math.max(rawSportWideMultiplier, 0.85), 1.2)
    : 1;
  const activeCells = new Map<string, number>();
  for (const cell of calibration.cells) {
    const cellSampleSize = Number(cell.sample_size ?? 0);
    const rawMultiplier = Number(cell.bias_multiplier ?? 1);
    if (cellSampleSize < 30 || !Number.isFinite(rawMultiplier)) continue;
    const multiplier = Math.min(Math.max(rawMultiplier, 0.85), 1.18);
    activeCells.set(`${cell.position_group}:${cell.salary_tier}`, multiplier);
  }

  let appliedPlayerCount = 0;
  let v2AppliedPlayerCount = 0;
  const calibratedPlayers = players.map((player) => {
    if (!player.projected_points || player.projection_source === 'position_baseline') return player;
    const cellKey = `${calibrationPositionGroup(player, sport)}:${calibrationSalaryTier(player)}`;
    const cellMultiplier = activeCells.get(cellKey);
    const multiplier = cellMultiplier ?? sportWideMultiplier;
    if (Math.abs(multiplier - 1) < 0.015) return player;
    appliedPlayerCount += 1;
    if (cellMultiplier !== undefined) v2AppliedPlayerCount += 1;
    const projectedPoints = Number((player.projected_points * multiplier).toFixed(2));
    return {
      ...player,
      projection_source: 'calibrated',
      projected_points: projectedPoints,
      last_5_stats: player.last_5_stats ? {
        ...player.last_5_stats,
        avg_fantasy_pts: projectedPoints,
      } : player.last_5_stats,
    };
  });

  return {
    applied: appliedPlayerCount > 0,
    sportWideMultiplier,
    activeCellCount: activeCells.size,
    appliedPlayerCount,
    v2AppliedPlayerCount,
    players: calibratedPlayers,
  };
}

interface MatchedNewsItem {
  raw: string;
  timestamp: number;
}

const PLAYER_NEWS_ALIASES: Record<string, string[]> = {
  lebronjames: ['lebron'],
  nikolajokic: ['joker'],
  shaigilgeousalexander: ['sga'],
};

function newsTimestamp(item: any): number {
  const value = item?.published_at ?? item?.publishedAt ?? item?.timestamp ?? item?.created_at ?? item?.date;
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentNewsCutoff(): number {
  return Date.now() - 48 * 60 * 60 * 1000;
}

function matchingNewsItems(player: Player, newsItems: any[]): MatchedNewsItem[] {
  const playerKey = normalizeName(player.name);
  if (!playerKey) return [];
  const nameParts = player.name.split(/\s+/).filter(Boolean);
  const lastNameKey = normalizeName(nameParts[nameParts.length - 1] ?? '');
  const teamKey = normalizeName(player.team ?? '');
  const aliases = PLAYER_NEWS_ALIASES[playerKey] ?? [];
  return newsItems
    .map((item) => ({ raw: String(item?.raw ?? item?.title ?? item?.description ?? ''), timestamp: newsTimestamp(item) }))
    .filter((item) => !item.timestamp || item.timestamp >= recentNewsCutoff())
    .filter((item) => {
      const rawKey = normalizeName(item.raw);
      const fullNameMatch = rawKey.includes(playerKey);
      const aliasMatch = aliases.some((alias) => rawKey.includes(normalizeName(alias)));
      const lastNameTeamMatch = Boolean(lastNameKey && teamKey && rawKey.includes(lastNameKey) && rawKey.includes(teamKey));
      return (fullNameMatch || aliasMatch || lastNameTeamMatch) && injuryContextNear(item.raw, fullNameMatch ? playerKey : lastNameKey);
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

function newsInjuryStatus(rawNews: MatchedNewsItem[]): InjuryStatus | null {
  const text = rawNews[0]?.raw.toLowerCase() ?? '';
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

  const roleNews = matchedNews.filter((item) => !/(questionable|doubtful|ruled out|will not play|inactive|out indefinitely|injured reserve)/i.test(item.raw));
  const negativeNews = roleNews.some((item) => /(bench|limited|slump|injur|not starting|minutes limit)/i.test(item.raw));
  const positiveNews = roleNews.some((item) => !/not starting/i.test(item.raw) && /(starting|available|healthy|upgrade|breakout|hot)/i.test(item.raw));
  const sentimentAdjustment = Math.min(Math.max(sentimentScore * 0.015, -0.02), 0.02);
  const projectionMultiplier = Math.min(
    Math.max(1 + (positiveNews ? 0.03 : 0) - (negativeNews ? 0.08 : 0) + sentimentAdjustment, 0.75),
    1.08,
  );
  const confidenceDelta = (positiveNews ? 0.04 : 0) - (negativeNews ? 0.12 : 0);
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
    news_score: Number(((positiveNews ? 0.5 : 0) - (negativeNews ? 0.75 : 0) + sentimentScore * 0.1).toFixed(2)),
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
  const [fallbackOddsContext, rawMlbFreeContexts, statcastQuality, confirmedLineups] = await Promise.all([
    hasFreeOddsContext(slate) ? Promise.resolve([]) : collectOddsApiContext(sport, slate),
    sport === 'mlb' ? collectMlbFreeGameContext(contestDate, slate) : Promise.resolve([]),
    Promise.resolve(new Map<string, StatcastQuality>()),
    ['nba', 'wnba', 'nfl', 'mlb'].includes(sport) ? collectConfirmedLineups(sport, contestDate) : Promise.resolve([]),
  ]);
  const mlbFreeContexts = sport === 'mlb' ? mergeRotowireMlbLineups(rawMlbFreeContexts, confirmedLineups) : rawMlbFreeContexts;
  const vegasContext = buildVegasContext(slate, fallbackOddsContext);
  sourceStatus.espn_news = injuries.length ? 'partial' : 'unavailable';
  sourceStatus.draftkings_salaries = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.draftkings_salary_source = effectiveSalaryRows.length ? 'ok' : 'unavailable';
  sourceStatus.free_game_schedule = slate?.status === 'schedule_derived' || slate?.data?.source === 'espn_scoreboard' ? 'ok' : 'unavailable';
  sourceStatus.free_odds = vegasContext.some((context) => context.over_under || context.spread) ? 'ok' : 'unavailable';
  if (sport === 'mlb') {
    sourceStatus.mlb_statsapi_context = mlbFreeContexts.length ? 'ok' : 'unavailable';
    sourceStatus.nws_weather = mlbFreeContexts.some((context) => context.weather_note && context.weather_note !== 'roof/indoor park') ? 'partial' : 'unavailable';
    sourceStatus.mlb_confirmed_lineups = mlbFreeContexts.some((context) => Object.keys(context.batting_orders ?? {}).some((team) => Object.keys(context.batting_orders?.[team] ?? {}).length >= 8))
      ? 'partial'
      : 'unavailable';
    sourceStatus.baseball_savant_statcast = statcastQuality.size ? 'partial' : 'unavailable';
  }
  if (['nba', 'wnba', 'nfl', 'mlb'].includes(sport)) {
    sourceStatus.rotowire_confirmed_lineups = confirmedLineups.length ? 'ok' : 'unavailable';
  }

  let playerRoster = filterRosterBySlateTeams(applyDraftKingsSalaries(dedupePlayers(roster), effectiveSalaryRows, sport), slate);
  if (slateTeamAbbreviations(slate).length && playerRoster.length === roster.length) {
    warnings.push('Selected slate included team metadata, but roster filtering did not reduce the player pool.');
  }
  if (!playerRoster.length) warnings.push('No roster players were collected; lineups cannot be generated.');
  if (playerRoster.length < effectiveSalaryRows.length) {
    warnings.push('Some DraftKings salary rows could not be matched to roster metadata and were omitted.');
  }
  const ownershipRows = await collectOwnershipProjections(sport, contestDate);
  const ownershipApplied = applyOwnershipProjections(playerRoster, ownershipRows);
  playerRoster = ownershipApplied.players;
  const ownershipCoverage = playerRoster.length ? ownershipApplied.matchedPlayers / playerRoster.length : 0;
  sourceStatus.ownership_projections = ownershipApplied.matchedPlayers
    ? (ownershipApplied.unmatchedSourceRows ? 'partial' : 'ok')
    : 'unavailable';
  warnings.push(ownershipApplied.matchedPlayers
    ? `Matched public ownership projections for ${ownershipApplied.matchedPlayers} of ${playerRoster.length} slate players (${ownershipApplied.matchedSourceRows} source rows matched, ${ownershipApplied.unmatchedSourceRows} source rows unmatched; scraped ${ownershipApplied.latestScrapedAt ?? 'at unknown time'}).`
    : 'Public ownership projections were unavailable or did not match slate players; lineup generation will use heuristic ownership estimates for unmatched players.');
  if (ownershipApplied.unmatchedSourceNames.length) {
    warnings.push(`Unmatched ownership source names: ${ownershipApplied.unmatchedSourceNames.join(', ')}.`);
  }
  if (ownershipApplied.latestScrapedAt) {
    const age = hoursSince(Date.parse(ownershipApplied.latestScrapedAt));
    if (age !== null && age > 3) warnings.push(`Ownership projections are ${age.toFixed(1)} hours old; late DFS ownership can move sharply near lock.`);
  }
  if (contestType === 'showdown' && ownershipCoverage < 0.7) {
    warnings.push(`Ownership coverage is ${(ownershipCoverage * 100).toFixed(0)}%; tournament leverage and duplicate estimates will use heuristic ownership until coverage reaches 70%.`);
  }
  const propCollection = await collectPlayerProps(sport, slate);
  const propBlend = applyPropProjections(playerRoster, propCollection, sport);
  playerRoster = propBlend.players;
  sourceStatus.player_props = propBlend.appliedCount
    ? (propBlend.appliedCount === propCollection.propPlayers ? 'ok' : 'partial')
    : 'unavailable';
  if (envOddsApiKey() && propCollection.requestsRemaining) {
    warnings.push(`The Odds API requests remaining: ${propCollection.requestsRemaining} of monthly budget ${envOddsApiMonthlyBudget()}.`);
  }
  if (propBlend.appliedCount) {
    warnings.push(`Applied sportsbook player props to ${propBlend.appliedCount} player projection${propBlend.appliedCount === 1 ? '' : 's'} across ${propCollection.matchedEvents} matched event${propCollection.matchedEvents === 1 ? '' : 's'} (${propCollection.cachedEvents} cached, ${propCollection.fetchedEvents} fetched).`);
  } else if (envOddsApiKey()) {
    warnings.push('Sportsbook player props were unavailable or did not match roster players; projections used existing sources.');
  }
  if (propBlend.unmatchedPropPlayers) {
    warnings.push(`${propBlend.unmatchedPropPlayers} player prop name${propBlend.unmatchedPropPlayers === 1 ? '' : 's'} did not match any slate roster player.`);
  }
  if (sourceStatus.free_odds === 'unavailable') {
    warnings.push('Verified free odds context is unavailable for the selected game; lineup confidence excludes odds signals.');
  }
  if (!enoughForClassic(playerRoster, sport) && contestType === 'classic') {
    warnings.push('Roster may not contain enough position depth for a complete classic lineup.');
  }

  const enrichmentPlan = prioritizedEnrichmentRoster(playerRoster, sport);
  const enrichmentRoster = enrichmentPlan.players;
  warnings.push(
    `Enriched ${enrichmentRoster.length} of ${playerRoster.length} slate players with recent game logs (${enrichmentPlan.counts.stud} studs, ${enrichmentPlan.counts.value} value candidates, ${enrichmentPlan.counts.mid} mid-salary${enrichmentPlan.counts.other ? `, ${enrichmentPlan.counts.other} others` : ''}).`,
  );
  const statAndSentiment = await mapWithConcurrency(enrichmentRoster, 8, async (player) => {
    const bucket = enrichmentPlan.bucketByPlayerId.get(player.id) ?? 'other';
    const sentimentPromise = bucket === 'stud'
      ? collectRedditSentiment(player.id, player.name, sport)
      : Promise.resolve(undefined);
    const [stats, sentiment] = await Promise.all([
      collectLast5Stats(player, sport),
      sentimentPromise,
    ]);
    return { playerId: player.id, stats, sentiment, bucket };
  });

  const statsByPlayer = new Map(statAndSentiment.map((item) => [item.playerId, item.stats]));
  const sentimentByPlayer = new Map(statAndSentiment.map((item) => [item.playerId, item.sentiment]));
  playerRoster = playerRoster.map((player) => applyLast5Stats(player, statsByPlayer.get(player.id), sport));
  playerRoster = playerRoster.map((player) => applyPlayerNewsSignals(player, injuries, sentimentByPlayer.get(player.id)));
  if (['nba', 'wnba', 'nfl'].includes(sport)) {
    const lineupContext = applyConfirmedLineupContext(playerRoster, confirmedLineups, sport);
    playerRoster = lineupContext.players;
    const confirmedAge = hoursSince(newestTimestamp(confirmedLineups));
    if (lineupContext.appliedCount || lineupContext.injuryCount) {
      warnings.push(`Applied Rotowire lineup context to ${lineupContext.appliedCount} starter/bench projection${lineupContext.appliedCount === 1 ? '' : 's'} and ${lineupContext.injuryCount} injury tag${lineupContext.injuryCount === 1 ? '' : 's'}${confirmedAge !== null ? `; latest scrape ${confirmedAge.toFixed(1)} hours old` : ''}.`);
    }
    if (confirmedLineups.length && confirmedAge !== null && confirmedAge > 2) {
      warnings.push(`Confirmed-lineup data is ${confirmedAge.toFixed(1)} hours old; verify starters close to lock.`);
    }
  }
  if (sport === 'nba' || sport === 'wnba') {
    const opportunity = computeOpportunityProjection(playerRoster, sport);
    playerRoster = opportunity.players;
    sourceStatus.opportunity_model = opportunity.projectedCount
      ? (opportunity.missingMinutesCount ? 'partial' : 'ok')
      : 'unavailable';
    warnings.push(opportunity.projectedCount
      ? `Opportunity model applied to ${opportunity.projectedCount} ${sport.toUpperCase()} player${opportunity.projectedCount === 1 ? '' : 's'} with ${opportunity.cascadeBoostCount} injury-cascade boost${opportunity.cascadeBoostCount === 1 ? '' : 's'}${opportunity.clampedCount ? ` and ${opportunity.clampedCount} clamp${opportunity.clampedCount === 1 ? '' : 's'}` : ''}.`
      : 'Opportunity model unavailable; no NBA/WNBA players had real last-5 minutes data.');
    if (opportunity.missingMinutesCount) {
      warnings.push(`${opportunity.missingMinutesCount} NBA/WNBA player${opportunity.missingMinutesCount === 1 ? '' : 's'} had real game logs without a minutes average and were skipped by the opportunity model.`);
    }
  } else {
    delete sourceStatus.opportunity_model;
  }
  if (['nba', 'wnba', 'nfl'].includes(sport)) {
    playerRoster = applyVegasContext(playerRoster, vegasContext, slate, sport);
    const vegasAppliedCount = playerRoster.filter((player) => /Team implied|DST opponent implied/.test(player.news_note ?? '')).length;
    sourceStatus.vegas_applied = vegasAppliedCount ? 'ok' : 'unavailable';
    warnings.push(vegasAppliedCount
      ? `Applied Vegas implied-total context to ${vegasAppliedCount} ${sport.toUpperCase()} player${vegasAppliedCount === 1 ? '' : 's'}.`
      : 'Vegas implied-total context was unavailable or could not be matched to slate teams; player projections were not adjusted by Vegas context.');
  } else {
    delete sourceStatus.vegas_applied;
  }
  if (sport === 'mlb') {
    playerRoster = applyMlbFreeContext(playerRoster, mlbFreeContexts);
    playerRoster = applyStatcastQuality(playerRoster, statcastQuality);
  }
  const projectedRows = effectiveSalaryRows.filter((row) => typeof row.projected_points === 'number' && row.projected_points > 0).length;
  const calibration = await getProjectionCalibration(sport);
  const calibrated = applyProjectionCalibration(playerRoster, calibration, sport);
  playerRoster = calibrated.players;
  sourceStatus.espn_last5 = statAndSentiment.some((item) => item.stats?.games_data?.length) ? 'partial' : 'unavailable';
  sourceStatus.projections = projectedRows > 0 ? 'ok' : sourceStatus.espn_last5 === 'unavailable' ? 'partial' : 'ok';
  sourceStatus.projection_calibration = calibrated.applied ? 'ok' : 'unavailable';
  sourceStatus.reddit_sentiment = statAndSentiment.some((item) => item.sentiment?.source_status === 'ok') ? 'partial' : 'unavailable';
  sourceStatus.player_news = playerRoster.some((player) => player.news_note) ? 'partial' : 'unavailable';

  if (projectedRows === 0) {
    warnings.push('DraftKings salary rows did not include projected points; projections were built from last-5 stats and position baselines.');
  } else if (projectedRows < effectiveSalaryRows.length * 0.6) {
    warnings.push(`Only ${projectedRows} of ${effectiveSalaryRows.length} DraftKings salary rows included projected points; remaining players used last-5 or baseline projections.`);
  }
  if (calibrated.applied) {
    warnings.push(`Projection calibration applied to ${calibrated.appliedPlayerCount} player${calibrated.appliedPlayerCount === 1 ? '' : 's'} using ${calibrated.activeCellCount} active v2 cell${calibrated.activeCellCount === 1 ? '' : 's'} (${calibrated.v2AppliedPlayerCount} cell-level, ${calibrated.appliedPlayerCount - calibrated.v2AppliedPlayerCount} sport-wide fallback from ${calibration.sportWide?.sample_size ?? 0} samples at ${calibrated.sportWideMultiplier.toFixed(2)}x).`);
  } else {
    warnings.push(`Projection calibration is not active yet; ${calibrated.activeCellCount} v2 cell${calibrated.activeCellCount === 1 ? '' : 's'} met the sample threshold, but no eligible non-baseline projection moved materially. Add actual results after slates to measure and correct projection bias.`);
  }
  if (sourceStatus.espn_last5 === 'unavailable') {
    warnings.push(sport === 'mlb'
      ? 'MLB last-5 game-log enrichment is skipped during live edge scans to stay within worker compute limits; using DraftKings projections and free game context.'
      : 'Verified last-5 game stats are unavailable; using position baseline projections.');
  }
  if (sourceStatus.reddit_sentiment === 'unavailable') {
    warnings.push('Reddit public RSS signals were unavailable and no cached sentiment was found; sentiment score is neutral.');
  }
  if (sourceStatus.player_news === 'unavailable') {
    warnings.push('Player-specific news signals were unavailable or did not match players in this slate.');
  }
  if (sport === 'mlb' && !mlbFreeContexts.length) {
    warnings.push('Free MLB schedule/probable-pitcher context was unavailable; park and weather adjustments were skipped.');
  } else if (sport === 'mlb') {
    warnings.push(`Applied free MLB context for ${mlbFreeContexts.length} game${mlbFreeContexts.length === 1 ? '' : 's'} using Stats API schedule, probable pitchers, park factors, and free weather where available.`);
    if (sourceStatus.mlb_confirmed_lineups === 'partial') {
      warnings.push('Confirmed MLB batting-order context was available for at least one team and was used in hitter projections.');
    } else {
      warnings.push('Confirmed MLB batting orders were not available yet; hitter projections did not receive lineup-slot boosts.');
    }
    if (statcastQuality.size) {
      const matchedStatcastPlayers = playerRoster.filter((player) => player.news_note?.includes('Statcast')).length;
      warnings.push(`Applied free Baseball Savant Statcast quality signals to ${matchedStatcastPlayers} slate player${matchedStatcastPlayers === 1 ? '' : 's'}.`);
    } else {
      warnings.push('Baseball Savant Statcast quality signals are skipped during live edge scans to stay within worker compute limits.');
    }
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
    vegas_context: vegasContext,
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
