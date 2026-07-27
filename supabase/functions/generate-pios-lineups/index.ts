import { lineupSignature, solveOptimalLineupsWithMeta, type ExactSolverResult } from './classicSolver.ts';
import { detectAntiCorrelation } from './antiCorrelation.ts';
import { PIOS_WEIGHTS } from './weights.ts';
import {
  correlateOutcomes,
  generateFieldLineups,
  indexFieldLineups,
  sampleLognormalOutcome,
  scoreIndexedEntries,
} from './simulation.ts';

type InjuryStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';

interface ManifestPlayer {
  id: string;
  name: string;
  team: string;
  image_url?: string;
  team_logo_url?: string;
  position: string;
  salary: number;
  salary_source?: string;
  injury_status: InjuryStatus;
  projected_points?: number;
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
  depth_chart_order?: number;
  ownership_projection?: number;
  cpt_ownership_projection?: number;
  flex_ownership_projection?: number;
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  last_5_stats?: {
    avg_fantasy_pts?: number;
    stdev_fantasy_pts?: number;
    games_sample_size?: number;
    minutes_stdev?: number;
    confidence?: number;
    is_synthetic?: boolean;
  };
}

interface LineupPlayerDraft {
  name: string;
  team: string;
  image_url?: string;
  team_logo_url?: string;
  position: string;
  salary: number;
  base_salary?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  salary_source?: string;
  player_id: string;
  confidence_score: number;
  last_5_avg_pts: number;
  injury_status: string;
  projected_points?: number;
  prop_projection?: number;
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
  run_factor?: number;
  opponent_team?: string;
  opposing_probable_pitcher_id?: string;
  opposing_probable_pitcher_name?: string;
  own_probable_starter?: boolean;
  game_id?: string;
  depth_chart_order?: number;
  ownership_projection?: number;
  cpt_ownership_projection?: number;
  flex_ownership_projection?: number;
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
  stdev_fantasy_pts?: number;
  games_sample_size?: number;
  minutes_stdev?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  contextual_projection?: number;
  floor_projection?: number;
  ceiling_projection?: number;
  volatility_score?: number;
  boom_probability?: number;
  bust_probability?: number;
  batting_order?: number;
  game_context_tags?: string[];
}

interface LineupConstructionRules {
  requestId: string;
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
  entryCount: number;
  fieldSize: number;
  maxEntriesPerUser: number;
  payoutShape: string;
  ownershipWeight: number;
  correlationWeight: number;
  maxCaptainExposure: number;
  captainPool: string[];
  lockedPlayers: string[];
  minPerTeam: number;
  forceUniqueCaptains: boolean;
  minSalaryUsed: number;
  maxDuplication: number;
  simulationIterations: number;
  fieldSimulationSize: number;
  showDiagnostics: boolean;
}

interface DraftLineup {
  players: LineupPlayerDraft[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  simulation_ev?: number;
  ceiling_score?: number;
  floor_score?: number;
  p99_score?: number;
  win_rate?: number;
  top_10_rate?: number;
  top_decile_rate?: number;
  top_n_rate?: number;
  expected_payout?: number;
  leverage_score?: number;
  ownership_sum?: number;
  expected_duplicates?: number;
  lineup_type?: 'high_ev' | 'contrarian_tournament' | 'late_swap_candidate';
  optimizer_rank?: number;
  rank_score?: number;
  lineup_intelligence_score?: number;
  stack_quality_score?: number;
  context_edge_score?: number;
  volatility_score?: number;
  win_condition?: string;
  primary_stack_team?: string;
  primary_stack_size?: number;
  anti_correlation_flags?: string[];
  exposure_flags?: string[];
  portfolio_correlation_flags?: string[];
  late_swap_flags?: string[];
  strategy_notes?: string[];
  constraint_violations: string[];
}

interface PiosRequest {
  requestId?: string;
  manifestId?: string;
  sport: string;
  contestType: string;
  contestDate?: string;
  contestId?: string;
  gameId?: string;
  slate?: DraftKingsSlate;
  playerRoster: ManifestPlayer[];
  excludedPlayers?: string[];
  lockedPlayers?: string[];
  riskTolerance?: string;
  lineupMode?: string;
  contestStrategy?: string;
  maxPlayerExposure?: number;
  maxTeamExposure?: number;
  minPrimaryStack?: number;
  diversifyLineups?: boolean;
  lateSwapMode?: boolean;
  entryCount?: number;
  fieldSize?: number;
  maxEntriesPerUser?: number;
  payoutShape?: string;
  ownershipWeight?: number;
  correlationWeight?: number;
  maxCaptainExposure?: number;
  captainPool?: string[];
  minPerTeam?: number;
  forceUniqueCaptains?: boolean;
  minSalaryUsed?: number;
  maxDuplication?: number;
  simulationIterations?: number;
  fieldSimulationSize?: number;
  showDiagnostics?: boolean;
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

interface AuthResult {
  userId: string | null;
  required: boolean;
}

function logStage(requestId: string, stage: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    event: 'pios_generate_stage',
    request_id: requestId,
    stage,
    ...detail,
    timestamp: new Date().toISOString(),
  }));
}

function assertGenerationRateLimit(userId: string | null, req: Request) {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  const key = userId ?? `anon:${forwardedFor ?? userAgent}`;
  const now = Date.now();
  const recent = (generationRateLimit.get(key) ?? []).filter((timestamp) => now - timestamp < GENERATION_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= GENERATION_RATE_LIMIT_MAX) {
    throw new Error('Scan generation rate limit exceeded. Try again later.');
  }
  recent.push(now);
  generationRateLimit.set(key, recent);
}

interface RosterSlot {
  slot: string;
  eligible: string[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const VALID_RISK = new Set(['conservative', 'balanced', 'aggressive']);
const VALID_LINEUP_MODES = new Set(['max_fpts', 'balanced_ev', 'tournament', 'safe']);
const VALID_CONTEST_STRATEGIES = new Set(['cash', 'single_entry', 'small_field', 'large_field_gpp', 'showdown']);
const VALID_PAYOUT_SHAPES = new Set(['flat', 'top_heavy', 'winner_take_all', 'double_up']);
const LINEUP_ELIGIBLE_INJURY_STATUSES = new Set(['active', 'probable', 'day_to_day', 'questionable']);
const LINEUP_EXCLUDED_INJURY_STATUSES = new Set(['out', 'doubtful']);
const DEFAULT_MONTE_CARLO_ITERATIONS = 1_000;
const MIN_MONTE_CARLO_ITERATIONS = 750;
const MAX_MONTE_CARLO_ITERATIONS = 2_000;
const MAX_CANDIDATE_LINEUPS = 80;
const SIMULATION_LINEUP_CAP = 40;
const DEFAULT_FIELD_LINEUP_CAP = 240;
const MAX_FIELD_LINEUP_CAP = 750;
const EXACT_SOLVER_DEADLINE_MS = 1_200;
const GENERATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const GENERATION_RATE_LIMIT_MAX = 12;
const generationRateLimit = new Map<string, number[]>();

const ROSTER_SLOTS: Record<string, RosterSlot[]> = {
  nba: [
    { slot: 'PG', eligible: ['PG'] },
    { slot: 'SG', eligible: ['SG'] },
    { slot: 'SF', eligible: ['SF'] },
    { slot: 'PF', eligible: ['PF'] },
    { slot: 'C', eligible: ['C'] },
    { slot: 'G', eligible: ['PG', 'SG'] },
    { slot: 'F', eligible: ['SF', 'PF'] },
    { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
  ],
  wnba: [
    { slot: 'G1', eligible: ['PG', 'SG'] },
    { slot: 'G2', eligible: ['PG', 'SG'] },
    { slot: 'F1', eligible: ['SF', 'PF'] },
    { slot: 'F2', eligible: ['SF', 'PF'] },
    { slot: 'UTIL1', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
    { slot: 'UTIL2', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
  ],
  nfl: [
    { slot: 'QB', eligible: ['QB'] },
    { slot: 'RB1', eligible: ['RB'] },
    { slot: 'RB2', eligible: ['RB'] },
    { slot: 'WR1', eligible: ['WR'] },
    { slot: 'WR2', eligible: ['WR'] },
    { slot: 'WR3', eligible: ['WR'] },
    { slot: 'TE', eligible: ['TE'] },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
    { slot: 'DST', eligible: ['DST', 'DEF'] },
  ],
  mlb: [
    { slot: 'P1', eligible: ['P', 'SP', 'RP'] },
    { slot: 'P2', eligible: ['P', 'SP', 'RP'] },
    { slot: 'C', eligible: ['C'] },
    { slot: '1B', eligible: ['1B'] },
    { slot: '2B', eligible: ['2B'] },
    { slot: '3B', eligible: ['3B'] },
    { slot: 'SS', eligible: ['SS'] },
    { slot: 'OF1', eligible: ['OF'] },
    { slot: 'OF2', eligible: ['OF'] },
    { slot: 'OF3', eligible: ['OF'] },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizePlayerKey(name: string): string {
  return normalizePlayerName(name).replace(/[^a-z0-9]/g, '');
}

async function validateFunctionAuth(req: Request, requestedUserId: string): Promise<AuthResult> {
  const required = Deno.env.get('REQUIRE_API_AUTH') === 'true';
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!required && !requestedUserId) {
    return { userId: null, required };
  }

  if (!token) {
    if (required) throw new Error('Missing Authorization bearer token');
    return { userId: null, required };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase auth environment is not configured');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) throw new Error('Invalid Authorization bearer token');
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error('Invalid Authorization bearer token');
  if (requestedUserId && requestedUserId !== data.id) throw new Error('Request user does not match token user');

  return { userId: data.id, required };
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envSupabaseServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

async function callSupabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T | null> {
  const supabaseUrl = envSupabaseUrl();
  const serviceRoleKey = envSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) throw new Error(`Supabase service-role env is not configured for ${functionName}`);

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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
  return text ? JSON.parse(text) as T : null;
}

function persistGeneratedLineups(
  lineups: DraftLineup[],
  payload: PiosRequest,
  userId: string | null,
  rules: LineupConstructionRules,
): string | null {
  if (!lineups.length || !payload.contestDate) return null;
  if (!envSupabaseUrl() || !envSupabaseServiceRoleKey()) {
    return 'Generated lineup persistence was skipped because Supabase service-role environment is not configured.';
  }

  const rows = lineups.map((lineup, index) => ({
    user_id: userId,
    sport: payload.sport,
    contest_date: payload.contestDate,
    contest_type: payload.contestType,
    contest_id: payload.contestId ?? payload.slate?.contest_id ?? null,
    lineup_mode: payload.lineupMode,
    contest_strategy: rules.contestStrategy,
    field_size: rules.fieldSize,
    entry_fee: null,
    max_entries_per_user: rules.maxEntriesPerUser,
    entry_count: rules.entryCount,
    expected_duplicates: lineup.expected_duplicates ?? null,
    weights_version: PIOS_WEIGHTS.weights_version,
    payout_shape: rules.payoutShape,
    ownership_weight: rules.ownershipWeight,
    config: {
      riskTolerance: payload.riskTolerance,
      lineupMode: payload.lineupMode,
      contestStrategy: rules.contestStrategy,
      maxPlayerExposure: rules.maxPlayerExposure,
      maxTeamExposure: rules.maxTeamExposure,
      minPrimaryStack: rules.minPrimaryStack,
      diversifyLineups: rules.diversifyLineups,
      lateSwapMode: rules.lateSwapMode,
      entryCount: rules.entryCount,
      fieldSize: rules.fieldSize,
      maxEntriesPerUser: rules.maxEntriesPerUser,
      payoutShape: rules.payoutShape,
      ownershipWeight: rules.ownershipWeight,
      correlationWeight: rules.correlationWeight,
      maxCaptainExposure: rules.maxCaptainExposure,
      captainPool: rules.captainPool,
      lockedPlayers: rules.lockedPlayers,
      minPerTeam: rules.minPerTeam,
      forceUniqueCaptains: rules.forceUniqueCaptains,
      minSalaryUsed: rules.minSalaryUsed,
      maxDuplication: rules.maxDuplication,
      simulationIterations: rules.simulationIterations,
      fieldSimulationSize: rules.fieldSimulationSize,
      showDiagnostics: rules.showDiagnostics,
      weightsVersion: PIOS_WEIGHTS.weights_version,
    },
    players: lineup.players.map((player) => ({
      player_id: player.player_id,
      player_name: player.name,
      team: player.team,
      position: player.position,
      salary: player.base_salary ?? player.salary,
      roster_slot: player.roster_slot,
      projected_points: player.contextual_projection ?? player.projected_points ?? player.last_5_avg_pts ?? 0,
    })),
    projected_points: lineup.projected_points,
    salary_used: lineup.salary_used,
    optimizer_rank: lineup.optimizer_rank ?? index + 1,
  }));

  const promise = callSupabaseRpc<number>('fantasy_ai_insert_generated_lineups', { p_rows: rows })
    .catch((error) => {
      console.error('Generated lineup persistence failed', error);
    });
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
  } else {
    void promise;
  }
  return null;
}

function validatePayload(payload: PiosRequest) {
  if (!VALID_SPORTS.has(payload.sport)) throw new Error(`Unsupported sport: ${payload.sport}`);
  if (!VALID_CONTEST_TYPES.has(payload.contestType)) throw new Error(`Unsupported contest type: ${payload.contestType}`);
  if (!VALID_RISK.has(payload.riskTolerance ?? 'balanced')) throw new Error(`Unsupported risk tolerance: ${payload.riskTolerance}`);
  if (!VALID_LINEUP_MODES.has(payload.lineupMode ?? defaultLineupMode(payload.payoutShape))) throw new Error(`Unsupported lineup mode: ${payload.lineupMode}`);
  if (!VALID_PAYOUT_SHAPES.has(payload.payoutShape ?? 'top_heavy')) throw new Error(`Unsupported payout shape: ${payload.payoutShape}`);
  if (!VALID_CONTEST_STRATEGIES.has(payload.contestStrategy ?? defaultContestStrategy(payload))) {
    throw new Error(`Unsupported contest strategy: ${payload.contestStrategy}`);
  }
  const entryCount = Number(payload.entryCount ?? 1);
  const fieldSize = Number(payload.fieldSize ?? 500);
  const maxEntriesPerUser = Number(payload.maxEntriesPerUser ?? 1);
  const maxCaptainExposure = Number(payload.maxCaptainExposure ?? 1);
  const minPerTeam = Number(payload.minPerTeam ?? 1);
  const minSalaryUsed = Number(payload.minSalaryUsed ?? 49_000);
  if (!Number.isInteger(entryCount) || entryCount < 1 || entryCount > 20) throw new Error('Entry count must be between 1 and 20');
  if (!Number.isInteger(fieldSize) || fieldSize < 2 || fieldSize > 500_000) throw new Error('Field size must be between 2 and 500,000');
  if (!Number.isInteger(maxEntriesPerUser) || maxEntriesPerUser < 1 || maxEntriesPerUser > 150) throw new Error('Max entries per user must be between 1 and 150');
  if (entryCount > maxEntriesPerUser) throw new Error('Entry count cannot exceed max entries per user');
  if (maxEntriesPerUser === 1 && entryCount > 1) throw new Error('Single-entry contests can only build one lineup');
  if (maxCaptainExposure * entryCount < 1) throw new Error('Captain exposure is too low for the requested entry count');
  if (payload.contestType === 'showdown' && (!Number.isInteger(minPerTeam) || minPerTeam < 1 || minPerTeam > 3)) {
    throw new Error('Showdown minimum players per team must be between 1 and 3');
  }
  if (payload.contestType === 'showdown' && minPerTeam * 2 > showdownRosterSize(payload.sport, payload.slate)) {
    throw new Error('Minimum players per team is not possible for the showdown roster size');
  }
  if (payload.contestType === 'showdown' && (!Number.isFinite(minSalaryUsed) || minSalaryUsed < 40_000 || minSalaryUsed > 50_000)) {
    throw new Error('Showdown minimum salary must be between 40,000 and 50,000');
  }
  if (payload.captainPool !== undefined && !Array.isArray(payload.captainPool)) throw new Error('captainPool must be an array');
  if (payload.lockedPlayers !== undefined && !Array.isArray(payload.lockedPlayers)) throw new Error('lockedPlayers must be an array');
  if (payload.excludedPlayers !== undefined && !Array.isArray(payload.excludedPlayers)) throw new Error('excludedPlayers must be an array');
  if (!Array.isArray(payload.playerRoster)) throw new Error('playerRoster must be an array');
  const locked = new Set((payload.lockedPlayers ?? []).map((name) => normalizePlayerName(String(name))));
  const excluded = new Set((payload.excludedPlayers ?? []).map((name) => normalizePlayerName(String(name))));
  for (const player of locked) {
    if (excluded.has(player)) throw new Error(`${player} cannot be both locked and excluded`);
  }
  const rosterByName = new Map(payload.playerRoster.map((player) => [normalizePlayerName(player.name ?? ''), player]));
  const lockedRoster = [...locked].map((name) => rosterByName.get(name)).filter((player): player is ManifestPlayer => Boolean(player));
  if (lockedRoster.length !== locked.size) throw new Error('Every locked player must exist on the slate roster');
  const lockedSalary = lockedRoster.reduce((sum, player) => sum + Number(player.salary ?? 0), 0);
  if (lockedSalary > 50_000) throw new Error('Locked players exceed the salary cap');
  if (payload.contestType === 'showdown' && minSalaryUsed > 0) {
    const rosterSize = showdownRosterSize(payload.sport, payload.slate);
    const lockedNames = new Set(lockedRoster.map((player) => normalizePlayerName(player.name ?? '')));
    const remaining = payload.playerRoster
      .filter((player) => !lockedNames.has(normalizePlayerName(player.name ?? '')))
      .map((player) => Number(player.salary ?? 0))
      .filter((salary) => Number.isFinite(salary) && salary > 0)
      .sort((a, b) => b - a)
      .slice(0, Math.max(rosterSize - lockedRoster.length, 0));
    const selectedBaseSalaries = [...lockedRoster.map((player) => Number(player.salary ?? 0)), ...remaining];
    const optimisticCaptainPremium = Math.max(...selectedBaseSalaries, 0) * 0.5;
    if (selectedBaseSalaries.reduce((sum, salary) => sum + salary, 0) + optimisticCaptainPremium < minSalaryUsed) {
      throw new Error('Minimum salary is unreachable with the locked players on this slate');
    }
  }
  if (payload.contestType === 'showdown' && payload.captainPool?.length && locked.size) {
    const captainPool = new Set(payload.captainPool.map((name) => normalizePlayerName(String(name))));
    if (![...locked].some((name) => captainPool.has(name))) {
      throw new Error('At least one locked player must be captain-eligible when a captain pool is set');
    }
  }
}

function defaultLineupMode(payoutShape?: string): string {
  if (payoutShape === 'double_up') return 'safe';
  if (payoutShape === 'flat') return 'balanced_ev';
  return 'tournament';
}

function defaultContestStrategy(payload: PiosRequest): string {
  const payoutShape = payload.payoutShape ?? 'top_heavy';
  const lineupMode = payload.lineupMode ?? defaultLineupMode(payoutShape);
  const fieldSize = normalizedFieldSize(payload.fieldSize);
  const maxEntriesPerUser = normalizedMaxEntriesPerUser(payload.maxEntriesPerUser);
  if (lineupMode === 'safe' || payoutShape === 'double_up') return 'cash';
  if (fieldSize >= 5_000 || maxEntriesPerUser >= 20 || payoutShape === 'winner_take_all') return 'large_field_gpp';
  if (fieldSize >= 500 || maxEntriesPerUser > 1 || payoutShape === 'top_heavy') return 'small_field';
  return 'single_entry';
}

function normalizeLineupPositionPart(raw: unknown, sport: string): string {
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
  return position;
}

function normalizeLineupPosition(raw: unknown, sport: string): string {
  const parts = String(raw ?? '')
    .toUpperCase()
    .split('/')
    .map((part) => normalizeLineupPositionPart(part, sport))
    .filter(Boolean);
  return [...new Set(parts)].join('/') || 'UTIL';
}

function mapToDraftPlayers(players: ManifestPlayer[], sport: string): LineupPlayerDraft[] {
  return players.map((player) => {
    const projectedPoints = player.projected_points ?? player.last_5_stats?.avg_fantasy_pts ?? 0;
    return {
      name: player.name,
      team: player.team ?? '',
      image_url: player.image_url,
      team_logo_url: player.team_logo_url,
      position: normalizeLineupPosition(player.position, sport),
      salary: player.salary,
      base_salary: player.salary,
      salary_multiplier: 1,
      salary_source: player.salary_source,
      player_id: player.id,
      confidence_score: player.last_5_stats?.confidence ?? 0.5,
      last_5_avg_pts: player.last_5_stats?.avg_fantasy_pts ?? projectedPoints,
      stdev_fantasy_pts: positiveNumber(player.last_5_stats?.stdev_fantasy_pts),
      games_sample_size: positiveNumber(player.last_5_stats?.games_sample_size),
      minutes_stdev: positiveNumber(player.last_5_stats?.minutes_stdev),
      injury_status: player.injury_status ?? 'active',
      projected_points: projectedPoints,
      prop_projection: player.prop_projection,
      implied_total: player.implied_total,
      spread: player.spread,
      confirmed_starter: player.confirmed_starter,
      run_factor: positiveNumber(player.run_factor),
      opponent_team: player.opponent_team,
      opposing_probable_pitcher_id: player.opposing_probable_pitcher_id,
      opposing_probable_pitcher_name: player.opposing_probable_pitcher_name,
      own_probable_starter: player.own_probable_starter,
      game_id: player.game_id,
      depth_chart_order: player.depth_chart_order,
      ownership_projection: normalizeOwnership(player.ownership_projection),
      cpt_ownership_projection: normalizeOwnership(player.cpt_ownership_projection),
      flex_ownership_projection: normalizeOwnership(player.flex_ownership_projection),
      minutes_projection: positiveNumber(player.minutes_projection),
      usage_rate: positiveNumber(player.usage_rate),
      pace_metric: positiveNumber(player.pace_metric),
      context_score: normalizeContextScore(player.context_score),
      news_score: normalizeNewsScore(player.news_score),
      news_note: player.news_note,
      batting_order: player.batting_order,
    };
  });
}

function rosterDiagnostics(
  players: LineupPlayerDraft[],
  sport: string,
  contestType: string,
  excludedPlayers: string[] = [],
): string[] {
  const excludedLower = excludedPlayers.map(normalizePlayerName);
  const eligiblePlayers = players.filter(
    (player) => LINEUP_ELIGIBLE_INJURY_STATUSES.has(player.injury_status) && !excludedLower.includes(normalizePlayerName(player.name ?? '')),
  );
  const validFieldPlayers = eligiblePlayers.filter((player) => player.name && player.position && player.salary > 0 && adjustedProjection(player) > 0);
  const diagnostics = [
    `Lineup diagnostics: ${eligiblePlayers.length} of ${players.length} roster players were eligible; ${validFieldPlayers.length} had valid name, position, salary, and projection fields.`,
  ];

  if (contestType === 'classic') {
    const slots = ROSTER_SLOTS[sport] ?? [];
    const slotCounts = slots.map((slot) => `${slot.slot}:${validFieldPlayers.filter((player) => playerEligibleForSlot(player, slot)).length}`);
    const missingSlots = slots
      .filter((slot) => !validFieldPlayers.some((player) => playerEligibleForSlot(player, slot)))
      .map((slot) => slot.slot);
    diagnostics.push(`Classic slot coverage: ${slotCounts.join(', ') || 'no configured slots for sport'}.`);
    if (missingSlots.length) diagnostics.push(`Classic lineup generation could not fill required slot${missingSlots.length === 1 ? '' : 's'}: ${missingSlots.join(', ')}.`);
  }

  if (contestType === 'showdown') {
    const teamCounts = [...validFieldPlayers.reduce<Map<string, number>>((counts, player) => {
      const team = String(player.team ?? '').toUpperCase();
      if (team) counts.set(team, (counts.get(team) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort((a, b) => b[1] - a[1]);
    diagnostics.push(`Showdown team coverage: ${teamCounts.map(([team, count]) => `${team}:${count}`).join(', ') || 'no teams found'}.`);
    if (teamCounts.length < 2) diagnostics.push('Showdown lineup generation requires usable players from at least two teams.');
  }

  return diagnostics;
}

function generateLineups(
  roster: LineupPlayerDraft[],
  sport: string,
  contestType: string,
  excludedPlayers: string[],
  riskTolerance: string,
  lineupMode: string,
  rules: LineupConstructionRules,
  slate?: DraftKingsSlate,
): DraftLineup[] {
  const excludedLower = excludedPlayers.map(normalizePlayerName);
  const lockedLower = rules.lockedPlayers;
  const eligiblePlayers = roster.filter(
    (player) => LINEUP_ELIGIBLE_INJURY_STATUSES.has(player.injury_status) && !excludedLower.includes(normalizePlayerName(player.name ?? '')),
  );
  const availableLockedPlayers = new Set(
    eligiblePlayers
      .map((player) => normalizePlayerName(player.name ?? ''))
      .filter((name) => lockedLower.includes(name)),
  );
  if (lockedLower.some((name) => !availableLockedPlayers.has(name))) return [];
  const sortedPlayers = eligiblePlayers
    .map((player) => withModeledShowdownOwnership(player, eligiblePlayers))
    .map((player) => applyContextualProjectionEngine(player, sport, rules))
    .sort((a, b) => playerValueScore(b, sport, rules) - playerValueScore(a, sport, rules));
  const classicExact = contestType === 'classic'
    ? generateExactClassicCandidatePool(sortedPlayers, sport, rules)
    : undefined;
  const exactOptimalStatus = classicExact ? exactOptimalValidationStatus(classicExact.unfilteredBest, classicExact.result, sport, rules) : undefined;
  const candidates = contestType === 'showdown'
    ? generateExactShowdownLineups(sortedPlayers, rules, showdownRosterSize(sport, slate))
    : classicExact?.candidates ?? generateClassicLineups(sortedPlayers, sport, rules);
  logStage(rules.requestId, 'candidates_generated', {
    candidates: candidates.length,
    eligible_players: eligiblePlayers.length,
    contest_type: contestType,
    sport,
  });

  const baseCandidates = candidates
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => enrichLineupConstruction(lineup, rules, sport));
  const strategyCandidates = baseCandidates.filter((lineup) => validateLineup(lineup, contestType, sport, rules));
  const antiCorrelationFiltered = lineupMode === 'max_fpts'
    ? strategyCandidates
    : strategyCandidates.filter((lineup) => rules.contestStrategy === 'cash' || (lineup.anti_correlation_flags?.length ?? 0) === 0);
  logStage(rules.requestId, 'candidates_filtered', {
    base_candidates: baseCandidates.length,
    strategy_candidates: strategyCandidates.length,
    anti_correlation_filtered: antiCorrelationFiltered.length,
  });
  const simulationSource = antiCorrelationFiltered.length ? antiCorrelationFiltered : strategyCandidates.length ? strategyCandidates : withRelaxedRuleNote(baseCandidates);
  const simulationCandidates = ensureLineupInSimulationPool(
    simulationSource
    .sort((a, b) => preSimulationLineupScore(b, rules) - preSimulationLineupScore(a, rules))
      .slice(0, simulationLineupCap(rules)),
    simulationSource,
    exactOptimalStatus?.signature,
  );
  logStage(rules.requestId, 'simulation_pool_ready', {
    simulation_candidates: simulationCandidates.length,
    simulation_iterations: rules.simulationIterations,
    field_simulation_size: rules.fieldSimulationSize,
  });

  const rankedSource = lineupMode === 'max_fpts'
    ? simulationCandidates
    : runMonteCarloSimulations(simulationCandidates, sortedPlayers, riskTolerance, sport, contestType, rules, slate);
  const rankedLineups = rankedSource
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => ({
      ...lineup,
      confidence_score: calculateLineupConfidence(lineup),
      lineup_type: classifyLineup(lineup),
      expected_duplicates: expectedDuplicates(lineup, rules),
      rank_score: lineupRankScore(lineup, riskTolerance, lineupMode, rules),
    }))
    .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))
    .map((lineup, index) => ({ ...lineup, optimizer_rank: index + 1 }));

  const diversified = diversifyRankedLineups(rankedLineups, rules, lineupMode);
  const finalLineups = lineupMode === 'max_fpts'
    ? enforceExactOptimalTop(diversified, rankedLineups, exactOptimalStatus)
    : diversified;

  return finalLineups.slice(0, rules.entryCount);
}

interface ExactClassicPool {
  candidates: DraftLineup[];
  unfilteredBest?: DraftLineup;
  result: ExactSolverResult;
}

interface ExactOptimalStatus {
  signature?: string;
  failure?: string;
}

function addStrategyNote(lineup: DraftLineup, note: string): DraftLineup {
  return {
    ...lineup,
    strategy_notes: [...(lineup.strategy_notes ?? []).filter((item) => item !== note), note],
  };
}

function dedupeLineups(lineups: DraftLineup[]): DraftLineup[] {
  const seen = new Set<string>();
  return lineups.filter((lineup) => {
    const signature = lineupSignature(lineup);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function generateExactClassicCandidatePool(
  players: LineupPlayerDraft[],
  sport: string,
  rules: LineupConstructionRules,
): ExactClassicPool {
  const exactTarget = sport === 'mlb' && rules.contestStrategy !== 'cash' && rules.minPrimaryStack >= 3 ? 36 : 24;
  const result = solveOptimalLineupsWithMeta(players, sport, exactTarget, { deadlineMs: EXACT_SOLVER_DEADLINE_MS });
  const unfilteredBest = result.lineups[0] as DraftLineup | undefined;
  const exactNote = `exact optimizer produced ${result.lineups.length} lineup${result.lineups.length === 1 ? '' : 's'} in ${result.elapsedMs}ms${result.timedOut ? ` before the ${EXACT_SOLVER_DEADLINE_MS}ms cap` : ''}`;
  let exactLineups = (result.lineups as DraftLineup[]).map((lineup, index) => (
    index === 0 ? addStrategyNote(lineup, exactNote) : lineup
  ));

  if (sport === 'mlb' && rules.contestStrategy !== 'cash' && rules.minPrimaryStack >= 3) {
    exactLineups = exactLineups.filter((lineup) => largestTeamStack(lineup).size >= rules.minPrimaryStack).slice(0, 24);
  } else {
    exactLineups = exactLineups.slice(0, 24);
  }

  const dfsLineups = generateClassicLineups(players, sport, rules);
  return {
    candidates: dedupeLineups([...exactLineups, ...dfsLineups]).slice(0, MAX_CANDIDATE_LINEUPS),
    unfilteredBest,
    result,
  };
}

function exactOptimalValidationStatus(
  exactOptimal: DraftLineup | undefined,
  result: ExactSolverResult,
  sport: string,
  rules: LineupConstructionRules,
): ExactOptimalStatus {
  if (result.timedOut && !result.bestVerified) {
    return { failure: `exact optimizer hit the ${EXACT_SOLVER_DEADLINE_MS}ms cap after producing ${result.lineups.length} lineup${result.lineups.length === 1 ? '' : 's'}; maximum projection was not fully verified` };
  }
  if (!exactOptimal) return { failure: 'exact optimizer found no valid salary-and-position lineup' };
  const validationProbe: DraftLineup = {
    ...exactOptimal,
    players: exactOptimal.players.map((player) => ({ ...player })),
    constraint_violations: [],
  };
  if (!validateLineup(validationProbe, 'classic', sport, rules)) {
    return { failure: validationProbe.constraint_violations.join(', ') || 'exact lineup failed validation' };
  }
  return { signature: lineupSignature(exactOptimal) };
}

function ensureLineupInSimulationPool(
  pool: DraftLineup[],
  source: DraftLineup[],
  requiredSignature?: string,
): DraftLineup[] {
  if (!requiredSignature || pool.some((lineup) => lineupSignature(lineup) === requiredSignature)) return pool;
  const required = source.find((lineup) => lineupSignature(lineup) === requiredSignature);
  if (!required) return pool;
  if (pool.length < SIMULATION_LINEUP_CAP) return [...pool, required];
  return [...pool.slice(0, Math.max(0, SIMULATION_LINEUP_CAP - 1)), required];
}

function simulationLineupCap(rules: LineupConstructionRules): number {
  return Math.min(SIMULATION_LINEUP_CAP, Math.max(16, rules.entryCount * 8));
}

function enforceExactOptimalTop(
  lineups: DraftLineup[],
  rankedLineups: DraftLineup[],
  exactStatus?: ExactOptimalStatus,
): DraftLineup[] {
  if (!lineups.length || !exactStatus) return lineups;
  if (exactStatus.signature) {
    const exact = rankedLineups.find((lineup) => lineupSignature(lineup) === exactStatus.signature)
      ?? lineups.find((lineup) => lineupSignature(lineup) === exactStatus.signature);
    if (!exact) return lineups;
    const promoted = addStrategyNote(exact, 'verified maximum-projection lineup');
    const rest = lineups.filter((lineup) => lineupSignature(lineup) !== exactStatus.signature);
    return [promoted, ...rest].map((lineup, index) => ({ ...lineup, optimizer_rank: index + 1 }));
  }
  if (exactStatus.failure) {
    return [
      addStrategyNote(lineups[0], `Exact maximum-projection lineup not promoted: ${exactStatus.failure}`),
      ...lineups.slice(1),
    ].map((lineup, index) => ({ ...lineup, optimizer_rank: index + 1 }));
  }
  return lineups;
}

function withRelaxedRuleNote(lineups: DraftLineup[]): DraftLineup[] {
  return lineups.map((lineup) => ({
    ...lineup,
    strategy_notes: [
      ...(lineup.strategy_notes ?? []),
      'Stack rules relaxed to preserve valid lineups',
    ],
  }));
}

function preSimulationLineupScore(lineup: DraftLineup, rules: LineupConstructionRules): number {
  return lineup.projected_points
    + (lineup.primary_stack_size ?? 0) * (rules.contestStrategy === 'large_field_gpp' ? 1.2 : 0.5)
    - (lineup.anti_correlation_flags?.length ?? 0) * 4
    - (lineup.late_swap_flags?.length ?? 0) * 0.25;
}

function insertTopLineup(lineups: DraftLineup[], lineup: DraftLineup, maxLineups: number) {
  lineups.push(lineup);
  lineups.sort((a, b) => b.projected_points - a.projected_points);
  if (lineups.length > maxLineups) lineups.pop();
}

function exactLineupKeepCount(rules?: LineupConstructionRules) {
  return Math.min(MAX_CANDIDATE_LINEUPS, Math.max(32, (rules?.entryCount ?? 1) * 16));
}

function generateExactShowdownLineups(players: LineupPlayerDraft[], rules: LineupConstructionRules, rosterSize = 6): DraftLineup[] {
  const lineupsByCaptain = new Map<string, DraftLineup[]>();
  const leverageLineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  const salaryCapShowdown = 50_000;
  const keepCount = exactLineupKeepCount(rules);
  const captainPool = new Set(rules.captainPool.map(normalizePlayerKey));
  const captains = [...players]
    .filter((player) => !captainPool.size || captainPool.has(normalizePlayerKey(player.name)))
    .sort((a, b) => captainLeverageScore(b) - captainLeverageScore(a));

  for (const captain of captains) {
    const captainLineups: DraftLineup[] = [];
    const captainWithMultiplier: LineupPlayerDraft = {
      ...captain,
      base_salary: captain.base_salary ?? captain.salary,
      salary: Math.floor(captain.salary * 1.5),
      salary_multiplier: 1.5,
      roster_slot: 'CPT',
      projected_points: adjustedProjection(captain) * 1.5,
    };
    const remainingSalary = salaryCapShowdown - captainWithMultiplier.salary;
    const fieldCandidates = players
      .filter((player) => player.player_id !== captain.player_id)
      .filter((player) => player.salary <= remainingSalary)
      .sort((a, b) => adjustedProjection(b) - adjustedProjection(a));

    function search(startIndex: number, selected: LineupPlayerDraft[], salaryUsed: number) {
      const needed = rosterSize - 1 - selected.length;
      if (needed < 0) return;
      if (fieldCandidates.length - startIndex < needed) return;

      const selectedProjection = selected.reduce((sum, player) => sum + adjustedProjection(player), 0);
      const captainKeepCount = Math.max(12, Math.ceil(keepCount / Math.max(captains.length, 1)));
      const worstKeptProjection = captainLineups.length >= captainKeepCount
        ? captainLineups[captainLineups.length - 1].projected_points
        : -Infinity;
      const upperBound = captainWithMultiplier.projected_points! + selectedProjection + bestRemainingProjection(fieldCandidates, startIndex, needed);
      if (upperBound <= worstKeptProjection) return;

      if (selected.length === rosterSize - 1) {
        const lineupPlayers = [
          captainWithMultiplier,
          ...selected.map((player) => ({
            ...player,
            base_salary: player.base_salary ?? player.salary,
            salary_multiplier: 1,
            roster_slot: 'FLEX',
          })),
        ];
        if (uniqueTeams(lineupPlayers).length < 2) return;
        const signature = `${captain.player_id}::${lineupPlayers.map((player) => player.player_id).sort().join('|')}`;
        if (signatures.has(signature)) return;
        signatures.add(signature);
        const nextLineup = {
          players: lineupPlayers,
          projected_points: calculateProjectedPoints(lineupPlayers),
          salary_used: salaryUsed,
          confidence_score: 0,
          constraint_violations: [],
        };
        insertTopLineup(captainLineups, nextLineup, captainKeepCount);
        insertLeverageLineup(leverageLineups, nextLineup, keepCount);
        return;
      }

      for (let index = startIndex; index < fieldCandidates.length; index += 1) {
        const candidate = fieldCandidates[index];
        if (salaryUsed + candidate.salary > salaryCapShowdown) continue;
        selected.push(candidate);
        search(index + 1, selected, salaryUsed + candidate.salary);
        selected.pop();
      }
    }

    if (captainWithMultiplier.salary <= salaryCapShowdown) {
      search(0, [], captainWithMultiplier.salary);
    }
    lineupsByCaptain.set(captain.player_id, captainLineups);
  }

  return dedupeLineups([...lineupsByCaptain.values()].flat().concat(leverageLineups)).slice(0, keepCount);
}

function insertLeverageLineup(lineups: DraftLineup[], lineup: DraftLineup, maxLineups: number) {
  lineups.push(lineup);
  lineups.sort((a, b) => showdownLeverageLineupScore(b) - showdownLeverageLineupScore(a));
  if (lineups.length > maxLineups) lineups.pop();
}

function captainLeverageScore(player: LineupPlayerDraft): number {
  return adjustedProjection(player) / Math.max(player.cpt_ownership_projection ?? player.ownership_projection ?? 0.08, 0.01);
}

function showdownLeverageLineupScore(lineup: DraftLineup): number {
  return lineup.projected_points / Math.max(lineupOwnershipProduct(lineup), 0.000001);
}

function bestRemainingProjection(players: LineupPlayerDraft[], startIndex: number, needed: number): number {
  if (needed <= 0) return 0;
  let total = 0;
  for (let index = startIndex; index < players.length && needed > 0; index += 1) {
    total += adjustedProjection(players[index]);
    needed -= 1;
  }
  return needed === 0 ? total : -Infinity;
}

function showdownRosterSize(_sport: string, slate?: DraftKingsSlate): number {
  const rawSize = Number(slate?.data?.roster_size);
  if (Number.isFinite(rawSize) && rawSize >= 2 && rawSize <= 8) return rawSize;
  // DraftKings showdown uses 6 roster spots: 1 CPT plus 5 FLEX.
  return 6;
}

function showdownRosterSizeWarnings(contestType: string, slate?: DraftKingsSlate): string[] {
  if (contestType !== 'showdown') return [];
  const rawSize = Number(slate?.data?.roster_size);
  return Number.isFinite(rawSize) && rawSize === 6
    ? []
    : ['Showdown roster size was not verified from the imported slate; defaulted to 6 roster spots.'];
}

function generateClassicLineups(players: LineupPlayerDraft[], sport: string, rules: LineupConstructionRules): DraftLineup[] {
  const slots = ROSTER_SLOTS[sport];
  if (!slots) return [];

  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  let iterations = 0;
  const maxIterations = sport === 'mlb' ? 35_000 : 45_000;
  const candidateLists = slots.map((slotDef) => players
    .filter((player) => playerEligibleForSlot(player, slotDef))
    .sort((a, b) => playerValueScore(b, sport, rules) - playerValueScore(a, sport, rules))
    .slice(0, sport === 'mlb' ? 18 : 20));

  function search(slotIndex: number, selected: LineupPlayerDraft[], usedIds: Set<string>, salaryUsed: number) {
    iterations += 1;
    if (iterations > maxIterations) return;

    if (slotIndex === slots.length) {
      const signature = selected.map((player) => player.player_id).sort().join('|');
      if (signatures.has(signature)) return;
      signatures.add(signature);
      insertTopLineup(lineups, {
        players: [...selected],
        projected_points: calculateProjectedPoints(selected),
        salary_used: salaryUsed,
        confidence_score: 0,
        constraint_violations: [],
      }, MAX_CANDIDATE_LINEUPS);
      return;
    }

    for (const candidate of candidateLists[slotIndex]) {
      if (usedIds.has(candidate.player_id)) continue;
      if (salaryUsed + candidate.salary > 50_000) continue;

      selected.push({ ...candidate, roster_slot: slots[slotIndex].slot, salary_multiplier: 1, base_salary: candidate.base_salary ?? candidate.salary });
      usedIds.add(candidate.player_id);
      search(slotIndex + 1, selected, usedIds, salaryUsed + candidate.salary);
      usedIds.delete(candidate.player_id);
      selected.pop();

      if (iterations > maxIterations) return;
    }
  }

  search(0, [], new Set<string>(), 0);
  return lineups;
}

// Deprecated prose fallback for one release. Prefer player.run_factor.
function parseRunFactor(note = ''): number | undefined {
  const match = note.match(/run factor\s+([0-9.]+)/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Deprecated prose fallback for one release. Prefer player.batting_order.
function parseBattingOrder(note = ''): number | undefined {
  const match = note.match(/\bbatting\s+([1-9])\b/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isConfirmedNonStarter(player: LineupPlayerDraft): boolean {
  if (typeof player.confirmed_starter === 'boolean') return player.confirmed_starter === false;
  return player.news_note?.includes('not in confirmed lineup') ?? false;
}

function hasBattingOrder(player: LineupPlayerDraft): boolean {
  if (typeof player.batting_order === 'number' && player.batting_order > 0) return true;
  return player.news_note?.includes('batting') ?? false;
}

function gameContextTags(player: LineupPlayerDraft, sport: string, battingOrder?: number): string[] {
  if (sport !== 'mlb') return [];
  const note = player.news_note ?? '';
  const runFactor = player.run_factor ?? parseRunFactor(note);
  return [
    runFactor && runFactor >= 1.06 ? 'run-positive park/weather' : '',
    runFactor && runFactor <= 0.94 ? 'run-suppressing park/weather' : '',
    battingOrder && battingOrder <= 2 ? 'top-of-order' : '',
    battingOrder && battingOrder >= 7 ? 'bottom-of-order' : '',
    isConfirmedNonStarter(player) ? 'lineup-risk' : '',
    player.opposing_probable_pitcher_name || note.includes('vs probable') ? 'probable-pitcher context' : '',
  ].filter(Boolean);
}

function applyContextualProjectionEngine(
  player: LineupPlayerDraft,
  sport: string,
  _rules: LineupConstructionRules,
): LineupPlayerDraft {
  const baseProjection = player.projected_points || player.last_5_avg_pts || 0;
  if (!baseProjection) return player;

  const note = player.news_note ?? '';
  const battingOrder = player.batting_order ?? parseBattingOrder(note);
  const runFactor = player.run_factor ?? parseRunFactor(note);
  const pitcher = isPitcher(player);
  const confirmedNonStarter = isConfirmedNonStarter(player);
  const confidence = Math.min(Math.max(player.confidence_score || 0.5, 0.2), 0.95);
  const contextScore = player.context_score ?? 0;
  const newsScore = player.news_score ?? 0;
  let multiplier = 1;
  const statusAdjustment = injuryStatusProjectionAdjustment(player.injury_status);

  if (sport === 'mlb') {
    if (typeof runFactor === 'number') {
      multiplier *= pitcher
        ? clampNumber(2 - runFactor, 0.9, 1.13, 1)
        : clampNumber(runFactor, 0.88, 1.2, 1);
    } else {
      multiplier *= 1 + contextScore * (pitcher ? 0.35 : 0.55);
    }

    if (!pitcher && battingOrder) {
      if (battingOrder === 1) multiplier *= 1.07;
      else if (battingOrder === 2) multiplier *= 1.055;
      else if (battingOrder <= 5) multiplier *= 1.025;
      else if (battingOrder >= 8) multiplier *= 0.94;
      else if (battingOrder === 7) multiplier *= 0.97;
    }

    if (!pitcher && confirmedNonStarter) multiplier *= 0.62;
    if (pitcher && (player.own_probable_starter === true || (player.own_probable_starter === undefined && note.includes('probable starter')))) multiplier *= 1.035;
  } else {
    multiplier *= 1 + contextScore * 0.45;
  }

  multiplier *= 1 + clampNumber(newsScore, -2, 2, 0) * 0.025;
  multiplier = clampNumber(multiplier, 0.68, sport === 'mlb' ? 1.28 : 1.2, 1);

  const effectiveMultiplier = multiplier * statusAdjustment.projectionMultiplier;
  const contextualProjection = Number((baseProjection * effectiveMultiplier).toFixed(2));
  const volatility = clampNumber(
    playerVolatilityScore(player, sport, battingOrder, runFactor) + statusAdjustment.volatilityBoost,
    0.16,
    0.68,
    0.3,
  );
  const floor = Number(Math.max(0, contextualProjection * (1 - volatility * 0.55)).toFixed(2));
  const ceiling = Number((contextualProjection * (1 + volatility * 0.85)).toFixed(2));
  const boomProbability = clampNumber(
    0.12 + volatility * 0.18 + Math.max(0, effectiveMultiplier - 1) * 0.9 + (1 - (player.ownership_projection ?? 0.12)) * 0.06,
    0.03,
    0.42,
    0.12,
  );
  const bustProbability = clampNumber(
    0.1 + (1 - confidence) * 0.28 + Math.max(0, 1 - effectiveMultiplier) * 0.75 + (confirmedNonStarter ? 0.28 : 0) + statusAdjustment.bustBoost,
    0.04,
    0.72,
    0.18,
  );

  return {
    ...player,
    projected_points: contextualProjection,
    contextual_projection: contextualProjection,
    floor_projection: floor,
    ceiling_projection: ceiling,
    volatility_score: Number(volatility.toFixed(3)),
    boom_probability: Number(boomProbability.toFixed(3)),
    bust_probability: Number(bustProbability.toFixed(3)),
    batting_order: battingOrder,
    game_context_tags: gameContextTags(player, sport, battingOrder),
  };
}

function injuryStatusProjectionAdjustment(status: string): { projectionMultiplier: number; volatilityBoost: number; bustBoost: number } {
  if (status === 'probable') return { projectionMultiplier: 0.98, volatilityBoost: 0, bustBoost: 0 };
  if (status === 'day_to_day') return { projectionMultiplier: 0.92, volatilityBoost: 0.05, bustBoost: 0 };
  if (status === 'questionable') return { projectionMultiplier: 0.8, volatilityBoost: 0.1, bustBoost: 0.15 };
  return { projectionMultiplier: 1, volatilityBoost: 0, bustBoost: 0 };
}

function playerVolatilityScore(
  player: LineupPlayerDraft,
  sport: string,
  battingOrder?: number,
  runFactor?: number,
): number {
  const confidence = Math.min(Math.max(player.confidence_score || 0.5, 0.2), 0.95);
  let volatility = sport === 'mlb' ? 0.34 : 0.24;
  volatility += (1 - confidence) * 0.22;
  volatility += Math.max(0, (runFactor ?? 1) - 1) * (isPitcher(player) ? 0.1 : 0.35);
  if (sport === 'mlb' && !isPitcher(player) && battingOrder && battingOrder >= 7) volatility += 0.045;
  if (['questionable', 'day_to_day'].includes(player.injury_status)) volatility += 0.08;
  return clampNumber(volatility, 0.16, 0.68, 0.3);
}

function playerValueScore(player: LineupPlayerDraft, sport = '', rules?: LineupConstructionRules): number {
  const weights = PIOS_WEIGHTS.playerValue;
  const projected = adjustedProjection(player);
  const salary = Math.max(player.salary, 1);
  const ownership = player.ownership_projection ?? 0.12;
  const newsBoost = (player.news_score ?? 0) * weights.news;
  const contextBoost = (player.context_score ?? 0) * weights.context;
  const ceiling = player.ceiling_projection ?? projected;
  const floor = player.floor_projection ?? projected;
  const battingOrderBoost = sport === 'mlb' && !isPitcher(player) && player.batting_order
    ? (player.batting_order <= 2 ? weights.battingOrderTopTwo : player.batting_order <= 5 ? weights.battingOrderMiddle : player.batting_order >= 8 ? weights.battingOrderBottom : weights.battingOrderLate)
    : 0;
  const ownershipWeight = rules?.ownershipWeight ?? (rules?.contestStrategy === 'large_field_gpp' ? 1 : 0);
  const tournamentBoost = ownershipWeight > 0
    ? (ceiling - projected) * weights.tournamentCeiling + (player.boom_probability ?? 0) * weights.tournamentBoom - ownership * weights.tournamentOwnership * ownershipWeight
    : 0;
  const cashBoost = rules?.contestStrategy === 'cash'
    ? floor * weights.cashFloor - (player.bust_probability ?? 0) * weights.cashBust
    : 0;
  return projected * weights.projection
    + (projected / salary) * 10_000 * weights.valuePerSalary
    + ceiling * weights.ceiling
    - ownership * weights.ownershipBasePenalty
    + newsBoost
    + contextBoost
    + battingOrderBoost
    + tournamentBoost
    + cashBoost;
}

function adjustedProjection(player: LineupPlayerDraft): number {
  return player.contextual_projection || player.projected_points || player.last_5_avg_pts || 0;
}

function playerEligibleForSlot(player: LineupPlayerDraft, slotDef: RosterSlot): boolean {
  return String(player.position ?? '')
    .split('/')
    .map((position) => position.trim())
    .some((position) => slotDef.eligible.includes(position));
}

function calculateProjectedPoints(players: LineupPlayerDraft[]): number {
  return players.reduce((sum, player) => sum + adjustedProjection(player), 0);
}

function validateLineup(lineup: DraftLineup, contestType: string, sport?: string, rules?: LineupConstructionRules): boolean {
  const violations: string[] = [];
  if (lineup.salary_used > 50_000) violations.push('salary cap exceeded');
  if (contestType === 'showdown' && rules?.minSalaryUsed && lineup.salary_used < rules.minSalaryUsed) {
    violations.push(`showdown salary below ${rules.minSalaryUsed}`);
  }
  if (rules?.lockedPlayers?.length) {
    const lineupNames = new Set(lineup.players.map((player) => normalizePlayerName(player.name ?? '')));
    const missingLocks = rules.lockedPlayers.filter((name) => !lineupNames.has(name));
    if (missingLocks.length) violations.push(`missing locked player${missingLocks.length === 1 ? '' : 's'}: ${missingLocks.join(', ')}`);
  }
  if (lineup.players.length === 0) violations.push('no players selected');
  if (new Set(lineup.players.map((player) => player.player_id)).size !== lineup.players.length) {
    violations.push('duplicate player selected');
  }
  if (contestType === 'showdown' && uniqueTeams(lineup.players).length < 2) {
    violations.push('showdown lineups must include players from both teams');
  }
  if (contestType === 'showdown' && rules?.minPerTeam) {
    const teamCounts = new Map<string, number>();
    for (const player of lineup.players) {
      const team = String(player.team ?? '').toUpperCase();
      if (team) teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
    }
    if ([...teamCounts.values()].some((count) => count < rules.minPerTeam)) {
      violations.push(`showdown team count below ${rules.minPerTeam}`);
    }
  }
  if (lineup.projected_points <= 0) violations.push('projected points must be positive');
  if (lineup.players.some((player) => !player.position || !player.name || player.salary <= 0)) {
    violations.push('player missing required fields');
  }
  if (sport === 'mlb' && contestType === 'classic' && rules?.contestStrategy !== 'cash' && rules?.minPrimaryStack && largestTeamStack(lineup).size < rules.minPrimaryStack) {
    violations.push(`primary MLB stack below ${rules.minPrimaryStack}`);
  }
  if (sport === 'mlb' && contestType === 'classic') {
    const riskyNonStarters = hitters(lineup).filter(isConfirmedNonStarter);
    const bottomOrderHitters = hitters(lineup).filter((player) => (player.batting_order ?? 0) >= 8);
    if (riskyNonStarters.length > (rules?.lateSwapMode ? 1 : 0)) {
      violations.push(`${riskyNonStarters.length} hitters not in confirmed lineups`);
    }
    if (rules?.contestStrategy === 'cash' && bottomOrderHitters.length >= 3) {
      violations.push('too many bottom-order hitters for cash construction');
    }
  }

  lineup.constraint_violations = violations;
  return violations.length === 0;
}

function uniqueTeams(players: LineupPlayerDraft[]): string[] {
  return [...new Set(players.map((player) => String(player.team ?? '').toUpperCase()).filter(Boolean))];
}

function isPitcher(player: LineupPlayerDraft): boolean {
  return /^(P|SP|RP)$/.test(String(player.position ?? '').toUpperCase());
}

function hitters(lineup: DraftLineup): LineupPlayerDraft[] {
  return lineup.players.filter((player) => !isPitcher(player));
}

function largestTeamStack(lineup: DraftLineup): { team: string; size: number } {
  const counts = hitters(lineup).reduce<Record<string, number>>((acc, player) => {
    const team = String(player.team ?? '').toUpperCase();
    if (team) acc[team] = (acc[team] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).reduce((best, [team, size]) => size > best.size ? { team, size } : best, { team: '', size: 0 });
}

function detectLateSwapFlags(lineup: DraftLineup, rules: LineupConstructionRules, sport: string): string[] {
  if (!rules.lateSwapMode) return [];
  return lineup.players.flatMap((player) => {
    const flags: string[] = [];
    if (isConfirmedNonStarter(player)) flags.push(`${player.name} not in confirmed lineup`);
    if (['questionable', 'day_to_day', 'probable'].includes(player.injury_status)) flags.push(`${player.name} status ${player.injury_status}`);
    if (sport === 'mlb' && !hasBattingOrder(player) && !isPitcher(player)) flags.push(`${player.name} batting order unconfirmed`);
    return flags;
  }).slice(0, 8);
}

function stackQualityScore(lineup: DraftLineup, rules: LineupConstructionRules): number {
  const stack = largestTeamStack(lineup);
  if (!stack.size) return 0;
  const stackHitters = hitters(lineup).filter((player) => String(player.team ?? '').toUpperCase() === stack.team);
  const avgContext = stackHitters.reduce((sum, player) => sum + (player.context_score ?? 0), 0) / Math.max(stackHitters.length, 1);
  const topOrderCount = stackHitters.filter((player) => (player.batting_order ?? 10) <= 5).length;
  const adjacencyBonus = battingOrderAdjacencyScore(stackHitters);
  const lowOrderPenalty = stackHitters.filter((player) => (player.batting_order ?? 0) >= 8).length * 0.45;
  const sizeWeight = rules.contestStrategy === 'large_field_gpp' ? 2.1 : rules.contestStrategy === 'cash' ? 0.4 : 1.2;
  return Number((
    stack.size * sizeWeight
    + topOrderCount * 0.75
    + adjacencyBonus
    + avgContext * 14
    - lowOrderPenalty
  ).toFixed(2));
}

function battingOrderAdjacencyScore(players: LineupPlayerDraft[]): number {
  const orders = players
    .map((player) => player.batting_order)
    .filter((order): order is number => Number.isFinite(order))
    .sort((a, b) => a - b);
  if (orders.length < 2) return 0;
  let score = 0;
  for (let index = 1; index < orders.length; index += 1) {
    const gap = orders[index] - orders[index - 1];
    if (gap === 1) score += 0.9;
    else if (gap === 2) score += 0.35;
  }
  return score;
}

function contextEdgeScore(lineup: DraftLineup): number {
  return Number(lineup.players.reduce((sum, player) => {
    const context = player.context_score ?? 0;
    const news = player.news_score ?? 0;
    const confirmedPenalty = isConfirmedNonStarter(player) ? -2.5 : 0;
    const battingBonus = !isPitcher(player) && player.batting_order
      ? player.batting_order <= 2 ? 1.1 : player.batting_order <= 5 ? 0.55 : player.batting_order >= 8 ? -0.75 : 0
      : 0;
    return sum + context * 8 + news * 0.45 + confirmedPenalty + battingBonus;
  }, 0).toFixed(2));
}

function lineupVolatilityScore(lineup: DraftLineup): number {
  return Number((lineup.players.reduce((sum, player) => sum + (player.volatility_score ?? 0.3), 0) / Math.max(lineup.players.length, 1)).toFixed(3));
}

function lineupIntelligenceScore(lineup: DraftLineup, rules: LineupConstructionRules): number {
  const weights = PIOS_WEIGHTS.lineupIntelligence;
  const stack = stackQualityScore(lineup, rules);
  const context = contextEdgeScore(lineup);
  const volatility = lineupVolatilityScore(lineup);
  const ownership = lineup.ownership_sum ?? lineup.players.reduce((sum, player) => sum + (player.ownership_projection ?? 0.12), 0);
  const boom = lineup.players.reduce((sum, player) => sum + (player.boom_probability ?? 0.12), 0);
  const bust = lineup.players.reduce((sum, player) => sum + (player.bust_probability ?? 0.18), 0);
  const antiPenalty = (lineup.anti_correlation_flags?.length ?? 0) * weights.antiCorrelationPenalty;
  const latePenalty = (lineup.late_swap_flags?.length ?? 0) * weights.lateSwapPenalty;
  const ownershipAdjustment = rules.contestStrategy === 'large_field_gpp'
    ? (weights.largeFieldOwnershipTarget - ownership) * weights.largeFieldOwnershipMultiplier
    : -Math.max(0, ownership - weights.chalkPenaltyThreshold) * weights.chalkPenaltyMultiplier;
  return Number((
    stack * rules.correlationWeight
    + context
    + boom * (rules.contestStrategy === 'large_field_gpp' ? weights.largeFieldBoom : weights.standardBoom)
    + volatility * (rules.contestStrategy === 'cash' ? weights.cashVolatility : weights.tournamentVolatility)
    + ownershipAdjustment
    - bust * (rules.contestStrategy === 'cash' ? weights.cashBust : weights.tournamentBust)
    - antiPenalty
    - latePenalty
  ).toFixed(2));
}

function lineupWinCondition(lineup: DraftLineup, rules: LineupConstructionRules): string {
  const stack = largestTeamStack(lineup);
  const captain = lineup.players.find((player) => player.roster_slot === 'CPT');
  const isShowdown = Boolean(captain);
  const teamCounts = new Map<string, number>();
  for (const player of lineup.players) {
    const team = String(player.team ?? '').toUpperCase();
    if (team) teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
  }
  const teamShape = [...teamCounts.entries()].sort((a, b) => b[1] - a[1]);
  const stackHitters = hitters(lineup).filter((player) => String(player.team ?? '').toUpperCase() === stack.team);
  const topContext = [...lineup.players]
    .sort((a, b) => ((b.context_score ?? 0) + (b.news_score ?? 0) * 0.2) - ((a.context_score ?? 0) + (a.news_score ?? 0) * 0.2))
    .slice(0, 2)
    .map((player) => player.name);
  if (rules.contestStrategy === 'cash') {
    return `Wins by holding floor: confirmed roles, minimized bust risk, and ${stack.team || 'the primary stack'} avoiding dead lineup spots.`;
  }
  if (isShowdown) {
    const leader = teamShape[0];
    const other = teamShape[1];
    const captainText = captain?.name ? `${captain.name} as captain` : 'the captain slot';
    if (leader && leader[1] >= 5) {
      return `Wins in a ${leader[0]} blowout script: ${captainText} leads, the rotation condenses, and the ${other?.[0] ?? 'opponent'} runback is enough to matter.`;
    }
    if (leader && leader[1] === 4) {
      return `Wins in a controlled ${leader[0]} edge: ${captainText} separates while the ${other?.[0] ?? 'opponent'} pieces keep the game competitive.`;
    }
    return `Wins in a shootout or overtime script: ${captainText} hits ceiling and both teams keep multiple fantasy-relevant roles alive.`;
  }
  if (stack.team && stack.size >= 3) {
    const orderText = stackHitters.some((player) => player.batting_order)
      ? ` with ${stackHitters.filter((player) => (player.batting_order ?? 10) <= 5).length} top-five bats`
      : '';
    return `Wins if ${stack.team} creates a crooked-number game${orderText}, while ${topContext.join(' and ') || 'the value pieces'} beat salary expectations.`;
  }
  return `Wins through ceiling outcomes from ${topContext.join(' and ') || 'the highest-context players'} plus enough salary efficiency to separate from chalk builds.`;
}

function enrichLineupConstruction(lineup: DraftLineup, rules: LineupConstructionRules, sport: string): DraftLineup {
  const stack = largestTeamStack(lineup);
  const antiCorrelationFlags = detectAntiCorrelation(lineup, sport);
  const lateSwapFlags = detectLateSwapFlags(lineup, rules, sport);
  const stackQuality = sport === 'mlb' ? stackQualityScore(lineup, rules) : 0;
  const contextEdge = contextEdgeScore(lineup);
  const volatility = lineupVolatilityScore(lineup);
  const strategyNotes = [
    ...(lineup.strategy_notes ?? []),
    stack.size ? `${stack.team} ${stack.size}-player primary stack` : '',
    sport === 'mlb' && stackQuality ? `Stack quality ${stackQuality.toFixed(1)} from batting order, context, and correlation` : '',
    contextEdge ? `Context edge ${contextEdge.toFixed(1)} from park/weather/news/role signals` : '',
    antiCorrelationFlags.length ? `Anti-correlation: ${antiCorrelationFlags.join(', ')}` : '',
    lateSwapFlags.length ? `${lateSwapFlags.length} late-swap watch item${lateSwapFlags.length === 1 ? '' : 's'}` : '',
    `Strategy: ${rules.contestStrategy.replace(/_/g, ' ')}`,
  ].filter(Boolean);
  const enriched = {
    ...lineup,
    primary_stack_team: stack.team || undefined,
    primary_stack_size: stack.size || undefined,
    anti_correlation_flags: antiCorrelationFlags,
    late_swap_flags: lateSwapFlags,
    stack_quality_score: stackQuality,
    context_edge_score: contextEdge,
    volatility_score: volatility,
    strategy_notes: strategyNotes,
  };
  return {
    ...enriched,
    lineup_intelligence_score: lineupIntelligenceScore(enriched, rules),
    win_condition: lineupWinCondition(enriched, rules),
  };
}

function calculateLineupConfidence(lineup: DraftLineup): number {
  const avgConfidence = lineup.players.reduce((sum, player) => sum + (player.confidence_score || 0.5), 0) / lineup.players.length;
  const salaryEfficiency = lineup.salary_used / 50_000;
  const efficiencyBoost = Math.min(salaryEfficiency * 0.1, 0.1);
  const injuryCount = lineup.players.filter((player) => player.injury_status !== 'active').length;
  const injuryPenalty = injuryCount * 0.05;

  return Math.min(Math.max(avgConfidence + efficiencyBoost - injuryPenalty, 0), 1);
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeOwnership(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed > 1 ? Math.min(parsed / 100, 1) : Math.min(parsed, 1);
}

function withModeledShowdownOwnership(player: LineupPlayerDraft, roster: LineupPlayerDraft[]): LineupPlayerDraft {
  const baseOwnership = player.ownership_projection;
  if (baseOwnership === undefined) return player;
  if (player.cpt_ownership_projection !== undefined && player.flex_ownership_projection !== undefined) return player;
  const sorted = [...roster].sort((a, b) => adjustedProjection(b) - adjustedProjection(a));
  const rank = Math.max(sorted.findIndex((candidate) => candidate.player_id === player.player_id), 0);
  const concentration = clampNumber(1.45 - rank * 0.035, 0.75, 1.55, 1);
  const cptOwnership = player.cpt_ownership_projection ?? clampNumber(baseOwnership * 0.55 * concentration, 0.005, 0.8, baseOwnership * 0.35);
  const flexOwnership = player.flex_ownership_projection ?? clampNumber((baseOwnership * 6 - cptOwnership) / 5, 0.005, 0.95, baseOwnership);
  return {
    ...player,
    ownership_projection: baseOwnership,
    cpt_ownership_projection: cptOwnership,
    flex_ownership_projection: flexOwnership,
  };
}

function lineupOwnershipProduct(lineup: DraftLineup): number {
  return lineup.players.reduce((product, player) => {
    const slotOwnership = player.roster_slot === 'CPT'
      ? player.cpt_ownership_projection ?? player.ownership_projection ?? 0.08
      : player.flex_ownership_projection ?? player.ownership_projection ?? 0.12;
    return product * clampNumber(slotOwnership, 0.001, 0.99, 0.1);
  }, 1);
}

function expectedDuplicates(lineup: DraftLineup, rules: LineupConstructionRules): number {
  return Number((lineupOwnershipProduct(lineup) * rules.fieldSize).toFixed(2));
}

function normalizeNewsScore(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, -2), 2);
}

function normalizeContextScore(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, -0.25), 0.25);
}

function playerStdDev(player: LineupPlayerDraft): number {
  const projection = player.projected_points || player.last_5_avg_pts || 0;
  const injuryBoost = ['questionable', 'doubtful', 'day_to_day'].includes(player.injury_status) ? 0.12 : 0;
  const observed = positiveNumber(player.stdev_fantasy_pts);
  const sampleSize = Math.max(Math.round(player.games_sample_size ?? 0), 0);
  const positionPrior = projection * (isCenterLike(player) ? 0.32 : isGuardLike(player) ? 0.38 : 0.35);
  const shrunkStdDev = observed
    ? observed * (sampleSize / (sampleSize + 4)) + positionPrior * (4 / (sampleSize + 4))
    : positionPrior;
  const minutesMean = Math.max(player.minutes_projection ?? 0, 1);
  const minutesUncertainty = player.minutes_stdev ? clampNumber(player.minutes_stdev / minutesMean, 0, 0.35, 0) : 0;
  return Math.max(shrunkStdDev * (1 + minutesUncertainty) + projection * injuryBoost, 1.5);
}

function isGuardLike(player: LineupPlayerDraft): boolean {
  return /(^|\/)(PG|SG|G)(\/|$)/.test(String(player.position ?? '').toUpperCase());
}

function isCenterLike(player: LineupPlayerDraft): boolean {
  return /(^|\/)C(\/|$)/.test(String(player.position ?? '').toUpperCase());
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentileValue / 100) * sorted.length)));
  return Number(sorted[index].toFixed(2));
}

function lowerBound(sortedValues: number[], value: number): number {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedValues[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function normalizeTeam(value: unknown): string {
  return String(value ?? '').toUpperCase();
}

function teamFromEventSide(event: Record<string, unknown>, side: 'home' | 'away'): string {
  const direct = normalizeTeam(event[`${side}_team`]);
  if (direct) return direct;
  const camel = event[`${side}Team`] as Record<string, unknown> | undefined;
  return normalizeTeam(camel?.abbreviation ?? camel?.teamName ?? camel?.city);
}

function deriveGamePairs(slate: DraftKingsSlate | undefined, roster: LineupPlayerDraft[], contestType: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const events = Array.isArray(slate?.data?.events) ? slate?.data?.events as Record<string, unknown>[] : [];
  for (const event of events) {
    const home = teamFromEventSide(event, 'home');
    const away = teamFromEventSide(event, 'away');
    if (home && away && home !== away) pairs.push([home, away]);
  }
  if (!pairs.length && contestType === 'showdown') {
    const teams = [...new Set(roster.map((player) => normalizeTeam(player.team)).filter(Boolean))];
    if (teams.length >= 2) pairs.push([teams[0], teams[1]]);
  }
  return pairs;
}

function runMonteCarloSimulations(
  lineups: DraftLineup[],
  roster: LineupPlayerDraft[],
  riskTolerance: string,
  sport: string,
  contestType: string,
  rules: LineupConstructionRules,
  slate?: DraftKingsSlate,
): DraftLineup[] {
  if (!lineups.length) return [];

  const indexedRoster = roster.map((player, index) => ({
    player,
    index,
    mean: player.projected_points || player.last_5_avg_pts || 0,
    // MLB hitter fantasy outcomes are more right-tailed than pitcher outcomes; 1.15
    // is a documented skew boost before lognormal parameterization.
    stdDev: playerStdDev(player) * (sport === 'mlb' && !isPitcher(player) ? 1.15 : 1),
  }));
  const playerIndex = new Map(indexedRoster.map((entry) => [entry.player.player_id, entry.index]));
  const means = new Float64Array(indexedRoster.map((entry) => entry.mean));
  const stdDevs = new Float64Array(indexedRoster.map((entry) => entry.stdDev));
  const gamePairs = deriveGamePairs(slate, roster, contestType);
  const fieldSize = Math.min(rules.fieldSize, rules.fieldSimulationSize, MAX_FIELD_LINEUP_CAP);
  const fieldLineups = indexFieldLineups(
    generateFieldLineups(roster, sport, contestType, fieldSize, ROSTER_SLOTS),
    playerIndex,
  );
  const lineupIndexes = new Map(lineups.map((lineup) => [
    lineup,
    lineup.players
      .map((player) => {
        const index = playerIndex.get(player.player_id);
        return typeof index === 'number' ? { index, multiplier: player.salary_multiplier ?? 1 } : null;
      })
      .filter((entry): entry is { index: number; multiplier: number } => entry !== null),
  ]));
  const samples = new Map<DraftLineup, number[]>();
  const wins = new Map<DraftLineup, number>();
  const topDeciles = new Map<DraftLineup, number>();
  const topNs = new Map<DraftLineup, number>();
  const expectedPayouts = new Map<DraftLineup, number>();
  for (const lineup of lineups) {
    samples.set(lineup, []);
    wins.set(lineup, 0);
    topDeciles.set(lineup, 0);
    topNs.set(lineup, 0);
    expectedPayouts.set(lineup, 0);
  }

  const iterations = rules.simulationIterations;
  const trueTopN = trueTopNForPayout(rules.fieldSize, rules.payoutShape);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const outcomes = new Float64Array(indexedRoster.length);
    for (const entry of indexedRoster) {
      outcomes[entry.index] = sampleLognormalOutcome(entry.mean, entry.stdDev);
    }
    correlateOutcomes(outcomes, means, stdDevs, roster, sport, gamePairs, contestType);

    const fieldScores = fieldLineups.map((fieldLineup) => {
      return scoreIndexedEntries(outcomes, fieldLineup.entries);
    }).sort((a, b) => a - b);

    for (const lineup of lineups) {
      const total = scoreIndexedEntries(outcomes, lineupIndexes.get(lineup) ?? []);
      samples.get(lineup)?.push(total);
      const beaten = fieldScores.length
        ? lowerBound(fieldScores, total) / fieldScores.length
        : 0;
      const finishRank = fieldScores.length ? fieldScores.length - lowerBound(fieldScores, total) + 1 : fieldSize;
      if (beaten >= 0.99) wins.set(lineup, (wins.get(lineup) ?? 0) + 1);
      if (beaten >= 0.9) topDeciles.set(lineup, (topDeciles.get(lineup) ?? 0) + 1);
      if (finishRank <= trueTopN) topNs.set(lineup, (topNs.get(lineup) ?? 0) + 1);
      expectedPayouts.set(lineup, (expectedPayouts.get(lineup) ?? 0) + payoutUnitsForFinish(finishRank, rules.fieldSize, rules.payoutShape));
    }
  }

  return lineups.map((lineup) => {
    const outcomes = samples.get(lineup) ?? [];
    const ownershipSum = lineup.players.reduce((sum, player) => sum + (player.ownership_projection ?? 0.12), 0);
    const ev = outcomes.reduce((sum, value) => sum + value, 0) / Math.max(outcomes.length, 1);
    const winRate = (wins.get(lineup) ?? 0) / iterations;
    const topDecileRate = (topDeciles.get(lineup) ?? 0) / iterations;
    const topNRate = (topNs.get(lineup) ?? 0) / iterations;
    const expectedPayout = (expectedPayouts.get(lineup) ?? 0) / iterations;
    return {
      ...lineup,
      simulation_ev: Number(ev.toFixed(2)),
      ceiling_score: percentile(outcomes, 96),
      floor_score: percentile(outcomes, 15),
      p99_score: percentile(outcomes, 99),
      win_rate: Number(winRate.toFixed(4)),
      top_10_rate: Number(topDecileRate.toFixed(4)),
      top_decile_rate: Number(topDecileRate.toFixed(4)),
      top_n_rate: Number(topNRate.toFixed(4)),
      expected_payout: Number(expectedPayout.toFixed(4)),
      ownership_sum: Number(ownershipSum.toFixed(4)),
      leverage_score: Number(((topDecileRate * 100) - ownershipSum * 10).toFixed(2)),
    };
  });
}

function normalizedSimulationIterations(value: unknown): number {
  return Math.round(clampNumber(value, MIN_MONTE_CARLO_ITERATIONS, MAX_MONTE_CARLO_ITERATIONS, DEFAULT_MONTE_CARLO_ITERATIONS));
}

function normalizedFieldSimulationSize(value: unknown, fieldSize: number): number {
  return Math.round(clampNumber(value, 120, MAX_FIELD_LINEUP_CAP, Math.min(Math.max(fieldSize, 120), DEFAULT_FIELD_LINEUP_CAP)));
}

function responseSimulationIterations(lineupMode: string, rules: LineupConstructionRules): number {
  return lineupMode === 'max_fpts' ? 0 : rules.simulationIterations;
}

function trueTopNForPayout(fieldSize: number, payoutShape: string): number {
  if (payoutShape === 'winner_take_all') return 1;
  if (payoutShape === 'double_up') return Math.max(1, Math.floor(fieldSize * 0.44));
  if (payoutShape === 'flat') return Math.max(1, Math.floor(fieldSize * 0.2));
  return Math.max(1, Math.floor(fieldSize * 0.01));
}

function payoutUnitsForFinish(finishRank: number, fieldSize: number, payoutShape: string): number {
  const percentile = finishRank / Math.max(fieldSize, 1);
  if (payoutShape === 'winner_take_all') return finishRank === 1 ? 1 : 0;
  if (payoutShape === 'double_up') return percentile <= 0.44 ? 1.8 : 0;
  if (payoutShape === 'flat') return percentile <= 0.2 ? 1 : 0;
  if (finishRank === 1) return 10;
  if (percentile <= 0.001) return 5;
  if (percentile <= 0.01) return 2.5;
  if (percentile <= 0.2) return 0.8;
  return 0;
}

function strategyProfile(payload: PiosRequest): LineupConstructionRules {
  const requestId = payload.requestId ?? crypto.randomUUID();
  const payoutShape = payload.payoutShape ?? 'top_heavy';
  const contestStrategy = payload.contestStrategy ?? defaultContestStrategy(payload);
  const entryCount = normalizedEntryCount(payload.entryCount);
  const fieldSize = normalizedFieldSize(payload.fieldSize);
  const maxEntriesPerUser = normalizedMaxEntriesPerUser(payload.maxEntriesPerUser);
  const ownershipWeight = clampNumber(payload.ownershipWeight, 0, 2, derivedOwnershipWeight(fieldSize, payoutShape, maxEntriesPerUser));
  const correlationWeight = clampNumber(payload.correlationWeight, 0, 2, 1);
  const captainPool = (payload.captainPool ?? []).map((name) => normalizePlayerKey(String(name))).filter(Boolean);
  const lockedPlayers = (payload.lockedPlayers ?? []).map((name) => normalizePlayerName(String(name))).filter(Boolean);
  const maxCaptainExposure = clampNumber(payload.maxCaptainExposure, 0.2, 1, entryCount <= 5 ? 0.4 : 0.6);
  const minPerTeam = Math.round(clampNumber(payload.minPerTeam, 1, 3, 1));
  const forceUniqueCaptains = Boolean(payload.forceUniqueCaptains ?? entryCount <= 5);
  const minSalaryUsed = Math.round(clampNumber(payload.minSalaryUsed, 40_000, 50_000, 49_000));
  const maxDuplication = Math.round(clampNumber(payload.maxDuplication, 1, 500, payoutShape === 'winner_take_all' ? 5 : 25));
  const simulationIterations = normalizedSimulationIterations(payload.simulationIterations);
  const fieldSimulationSize = Math.min(normalizedFieldSimulationSize(payload.fieldSimulationSize, fieldSize), fieldSize, MAX_FIELD_LINEUP_CAP);
  const showDiagnostics = Boolean(payload.showDiagnostics ?? false);
  if ((payload.lineupMode ?? defaultLineupMode(payoutShape)) === 'max_fpts') {
    return {
      contestStrategy,
      requestId,
      maxPlayerExposure: 1,
      maxTeamExposure: 1,
      minPrimaryStack: 0,
      diversifyLineups: false,
      lateSwapMode: payload.lateSwapMode ?? true,
      entryCount,
      fieldSize,
      maxEntriesPerUser,
      payoutShape,
      ownershipWeight: 0,
      correlationWeight,
      maxCaptainExposure: 1,
      captainPool,
      lockedPlayers,
      minPerTeam,
      forceUniqueCaptains: false,
      minSalaryUsed,
      maxDuplication: 500,
      simulationIterations: 0,
      fieldSimulationSize,
      showDiagnostics,
    };
  }
  const strategyDefaults: Record<string, Pick<LineupConstructionRules, 'maxPlayerExposure' | 'maxTeamExposure' | 'minPrimaryStack' | 'diversifyLineups' | 'lateSwapMode'>> = {
    cash: { maxPlayerExposure: 1, maxTeamExposure: 1, minPrimaryStack: 0, diversifyLineups: false, lateSwapMode: true },
    single_entry: { maxPlayerExposure: 0.8, maxTeamExposure: 0.8, minPrimaryStack: 3, diversifyLineups: true, lateSwapMode: true },
    small_field: { maxPlayerExposure: 0.7, maxTeamExposure: 0.75, minPrimaryStack: 3, diversifyLineups: true, lateSwapMode: true },
    large_field_gpp: { maxPlayerExposure: 0.55, maxTeamExposure: 0.65, minPrimaryStack: 4, diversifyLineups: true, lateSwapMode: true },
    showdown: { maxPlayerExposure: 0.8, maxTeamExposure: 1, minPrimaryStack: 0, diversifyLineups: true, lateSwapMode: true },
  };
  const defaults = strategyDefaults[contestStrategy] ?? strategyDefaults.single_entry;
  return {
    contestStrategy,
    requestId,
    maxPlayerExposure: clampNumber(payload.maxPlayerExposure, 0.2, 1, defaults.maxPlayerExposure),
    maxTeamExposure: clampNumber(payload.maxTeamExposure, 0.2, 1, defaults.maxTeamExposure),
    minPrimaryStack: Math.round(clampNumber(payload.minPrimaryStack, 0, 5, defaults.minPrimaryStack)),
    diversifyLineups: payload.diversifyLineups ?? defaults.diversifyLineups,
    lateSwapMode: payload.lateSwapMode ?? defaults.lateSwapMode,
    entryCount,
    fieldSize,
    maxEntriesPerUser,
    payoutShape,
    ownershipWeight,
    correlationWeight,
    maxCaptainExposure,
    captainPool,
    lockedPlayers,
    minPerTeam,
    forceUniqueCaptains,
    minSalaryUsed,
    maxDuplication,
    simulationIterations,
    fieldSimulationSize,
    showDiagnostics,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizedEntryCount(value: unknown): number {
  return Math.round(clampNumber(value, 1, 20, 1));
}

function normalizedFieldSize(value: unknown): number {
  return Math.round(clampNumber(value, 2, 500_000, 500));
}

function normalizedMaxEntriesPerUser(value: unknown): number {
  return Math.round(clampNumber(value, 1, 150, 1));
}

function derivedOwnershipWeight(fieldSize: number, payoutShape: string, maxEntriesPerUser: number): number {
  const fieldComponent = fieldSize >= 10_000 ? 1.2 : fieldSize >= 1_000 ? 0.8 : fieldSize >= 100 ? 0.45 : 0.15;
  const payoutComponent = payoutShape === 'winner_take_all' ? 0.6 : payoutShape === 'top_heavy' ? 0.35 : payoutShape === 'double_up' ? -0.2 : 0;
  const entryComponent = maxEntriesPerUser >= 20 ? 0.2 : maxEntriesPerUser >= 3 ? 0.1 : 0;
  return clampNumber(fieldComponent + payoutComponent + entryComponent, 0, 2, 0.6);
}

function diversifyRankedLineups(lineups: DraftLineup[], rules: LineupConstructionRules, lineupMode: string): DraftLineup[] {
  if (!rules.diversifyLineups || lineupMode === 'safe' || lineupMode === 'max_fpts') return lineups;
  const targetCount = rules.entryCount;
  const selected: DraftLineup[] = [];
  const playerCounts = new Map<string, number>();
  const teamCountsAcrossLineups = new Map<string, number>();
  const captainCounts = new Map<string, number>();
  const remaining = [...lineups];

  while (selected.length < targetCount && remaining.length) {
    remaining.sort((a, b) => portfolioMarginalScore(b, selected, rules) - portfolioMarginalScore(a, selected, rules));
    let selectedIndex = -1;
    let selectedLineup: DraftLineup | null = null;
    let selectedFlags: string[] = [];

    for (let index = 0; index < remaining.length; index += 1) {
      const lineup = remaining[index];
      const nextIndex = selected.length + 1;
      const maxPlayerUses = Math.max(1, Math.ceil(targetCount * rules.maxPlayerExposure));
      const maxTeamUses = Math.max(1, Math.ceil(targetCount * rules.maxTeamExposure));
      const maxCaptainUses = Math.max(1, Math.ceil(targetCount * rules.maxCaptainExposure));
      const captain = lineup.players.find((player) => player.roster_slot === 'CPT');
      const duplicateEstimate = expectedDuplicates(lineup, rules);
      const exposureFlags: string[] = [];

      if (duplicateEstimate > rules.maxDuplication) continue;
      if (captain) {
        const captainUses = captainCounts.get(captain.player_id) ?? 0;
        if (rules.forceUniqueCaptains && captainUses > 0) exposureFlags.push(`${captain.name} captain already used`);
        if (captainUses >= maxCaptainUses) exposureFlags.push(`${captain.name} captain exposure cap`);
      }
      for (const player of lineup.players) {
        const uses = playerCounts.get(player.player_id) ?? 0;
        if (uses >= maxPlayerUses) exposureFlags.push(`${player.name} exposure cap`);
      }
      const stackTeam = lineup.primary_stack_team;
      if (stackTeam && (teamCountsAcrossLineups.get(stackTeam) ?? 0) >= maxTeamUses) {
        exposureFlags.push(`${stackTeam} stack exposure cap`);
      }
      const pairwiseFlag = pairwisePortfolioFlag(lineup, selected, rules);
      if (pairwiseFlag) exposureFlags.push(pairwiseFlag);
      if (exposureFlags.length && nextIndex > Math.max(1, Math.ceil(targetCount * 0.2))) continue;

      selectedIndex = index;
      selectedLineup = lineup;
      selectedFlags = exposureFlags;
      break;
    }

    if (!selectedLineup || selectedIndex < 0) break;
    remaining.splice(selectedIndex, 1);
    selected.push({
      ...selectedLineup,
      exposure_flags: selectedFlags,
      strategy_notes: [
        ...(selectedLineup.strategy_notes ?? []),
        portfolioRoleNote(selectedLineup, selected, rules),
      ].filter(Boolean),
    });
    for (const player of selectedLineup.players) {
      playerCounts.set(player.player_id, (playerCounts.get(player.player_id) ?? 0) + 1);
    }
    const selectedStackTeam = selectedLineup.primary_stack_team;
    const selectedCaptain = selectedLineup.players.find((player) => player.roster_slot === 'CPT');
    if (selectedStackTeam) teamCountsAcrossLineups.set(selectedStackTeam, (teamCountsAcrossLineups.get(selectedStackTeam) ?? 0) + 1);
    if (selectedCaptain) captainCounts.set(selectedCaptain.player_id, (captainCounts.get(selectedCaptain.player_id) ?? 0) + 1);
  }

  const finalSet = selected.length ? selected : lineups;
  const portfolioFlags = portfolioCorrelationFlags(finalSet.slice(0, targetCount), rules);
  return finalSet.slice(0, targetCount).map((lineup, index) => ({
    ...lineup,
    optimizer_rank: index + 1,
    portfolio_correlation_flags: portfolioFlags,
  }));
}

function lineupPlayerIds(lineup: DraftLineup): Set<string> {
  return new Set(lineup.players.map((player) => player.player_id));
}

function sharedPlayerCount(first: DraftLineup, second: DraftLineup): number {
  const firstIds = lineupPlayerIds(first);
  return second.players.reduce((count, player) => count + (firstIds.has(player.player_id) ? 1 : 0), 0);
}

function pairwisePortfolioFlag(lineup: DraftLineup, selected: DraftLineup[], rules: LineupConstructionRules): string | null {
  const isSmallShowdown = rules.entryCount <= 5 && lineup.players.some((player) => player.roster_slot === 'CPT');
  if (!isSmallShowdown) return null;
  const maxSharedPlayers = Math.max(1, lineup.players.length - 2);
  const tooSimilar = selected.find((existing) => sharedPlayerCount(lineup, existing) > maxSharedPlayers);
  return tooSimilar ? `shares more than ${maxSharedPlayers} players with lineup #${tooSimilar.optimizer_rank ?? selected.indexOf(tooSimilar) + 1}` : null;
}

function portfolioMarginalScore(lineup: DraftLineup, selected: DraftLineup[], rules: LineupConstructionRules): number {
  const base = lineup.rank_score ?? lineup.expected_payout ?? lineup.simulation_ev ?? lineup.projected_points;
  if (!selected.length) return base;
  const setTopNBefore = portfolioAtLeastOneTopNRate(selected);
  const setTopNAfter = portfolioAtLeastOneTopNRate([...selected, lineup]);
  const setTopNGain = Math.max(0, setTopNAfter - setTopNBefore);
  const win = lineup.win_rate ?? 0;
  const duplicatePenalty = Math.max(0, lineup.expected_duplicates ?? 0) * 0.4;
  const similarityPenalty = selected.reduce((penalty, existing) => penalty + sharedPlayerCount(lineup, existing) * 8, 0);
  const captain = lineup.players.find((player) => player.roster_slot === 'CPT')?.player_id;
  const captainOverlapPenalty = captain && selected.some((existing) => existing.players.find((player) => player.roster_slot === 'CPT')?.player_id === captain)
    ? 80
    : 0;
  const scriptOverlapPenalty = selected.some((existing) => lineupWinCondition(existing, rules) === lineupWinCondition(lineup, rules)) ? 25 : 0;
  return base + setTopNGain * 5_000 + win * 2_000 - duplicatePenalty - similarityPenalty - captainOverlapPenalty - scriptOverlapPenalty;
}

function portfolioAtLeastOneTopNRate(lineups: DraftLineup[]): number {
  return 1 - lineups.reduce((missProbability, lineup) => missProbability * (1 - clampNumber(lineup.top_n_rate ?? 0, 0, 1, 0)), 1);
}

function portfolioRoleNote(lineup: DraftLineup, selected: DraftLineup[], rules: LineupConstructionRules): string {
  if (!selected.length) return 'Portfolio anchor: highest marginal payout path';
  const overlap = selected.length ? Math.min(...selected.map((existing) => sharedPlayerCount(lineup, existing))) : 0;
  const captain = lineup.players.find((player) => player.roster_slot === 'CPT')?.name;
  const script = lineupWinCondition(lineup, rules).replace(/^Wins in /, '').replace(/^Wins through /, '');
  return `Portfolio branch: ${captain ? `${captain} CPT, ` : ''}${overlap} shared players at closest overlap; ${script}`;
}

function portfolioCorrelationFlags(lineups: DraftLineup[], rules: LineupConstructionRules): string[] {
  if (lineups.length < 2) return [];
  const flags: string[] = [];
  const captainCounts = new Map<string, number>();
  const scriptCounts = new Map<string, number>();
  for (const lineup of lineups) {
    const captain = lineup.players.find((player) => player.roster_slot === 'CPT');
    if (captain) captainCounts.set(captain.name, (captainCounts.get(captain.name) ?? 0) + 1);
    const script = lineupWinCondition(lineup, rules);
    scriptCounts.set(script, (scriptCounts.get(script) ?? 0) + 1);
  }
  const repeatedCaptains = [...captainCounts.entries()].filter(([, count]) => count > 1);
  for (const [captain, count] of repeatedCaptains) flags.push(`${count} lineups use ${captain} at captain`);
  const repeatedScripts = [...scriptCounts.entries()].filter(([, count]) => count > 1);
  for (const [script, count] of repeatedScripts) flags.push(`${count} lineups share the same game script: ${script}`);
  const maxShared = Math.max(...lineups.flatMap((lineup, index) => lineups.slice(index + 1).map((other) => sharedPlayerCount(lineup, other))), 0);
  if (maxShared > Math.max(1, (lineups[0]?.players.length ?? 6) - 2)) flags.push(`Most similar pair shares ${maxShared} players`);
  return flags;
}

function lineupRankScore(lineup: DraftLineup, riskTolerance: string, lineupMode: string, rules: LineupConstructionRules): number {
  const weights = PIOS_WEIGHTS.lineupRank;
  const ev = lineup.simulation_ev ?? lineup.projected_points;
  const ceiling = lineup.ceiling_score ?? lineup.projected_points;
  const expectedPayout = lineup.expected_payout ?? 0;
  const winRate = lineup.win_rate ?? 0;
  const confidence = lineup.confidence_score ?? 0;
  const floor = lineup.floor_score ?? 0;
  const leverage = lineup.leverage_score ?? 0;
  const projected = lineup.projected_points;
  const intelligence = lineup.lineup_intelligence_score ?? 0;
  const stackQuality = lineup.stack_quality_score ?? 0;
  const contextEdge = lineup.context_edge_score ?? 0;
  const volatility = lineup.volatility_score ?? 0.3;
  const isShowdown = lineup.players.some((player) => player.roster_slot === 'CPT');
  const stackBonus = isShowdown ? 0 : (lineup.primary_stack_size ?? 0) * (rules.contestStrategy === 'large_field_gpp' ? weights.largeFieldStack : rules.contestStrategy === 'cash' ? weights.cashStack : weights.standardStack);
  const antiPenalty = (lineup.anti_correlation_flags?.length ?? 0) * weights.antiCorrelationPenalty;
  const latePenalty = (lineup.late_swap_flags?.length ?? 0) * (rules.lateSwapMode ? weights.lateSwapEnabledPenalty : weights.lateSwapDisabledPenalty);
  const ownershipPenalty = (lineup.ownership_sum ?? 0) * weights.ownershipPenalty * rules.ownershipWeight;
  const strategyAdjustment = stackBonus * rules.correlationWeight
    + intelligence * (rules.contestStrategy === 'cash' ? weights.cashIntelligence : weights.tournamentIntelligence)
    + stackQuality * (rules.contestStrategy === 'large_field_gpp' ? weights.largeFieldStackQuality : weights.standardStackQuality) * rules.correlationWeight
    + contextEdge * weights.contextEdge
    + volatility * (rules.contestStrategy === 'cash' ? weights.cashVolatility : weights.tournamentVolatility)
    - antiPenalty
    - latePenalty
    - ownershipPenalty;

  if (lineupMode === 'max_fpts') return projected;
  if (lineupMode === 'safe') return floor * weights.safeFloor + confidence * weights.safeConfidence + projected + strategyAdjustment;
  if (lineupMode === 'tournament') return expectedPayout * 10_000 + winRate * 100 + ceiling * 2 + leverage + strategyAdjustment;

  if (riskTolerance === 'conservative') return expectedPayout * 6_000 + ev * 2 + floor * weights.conservativeFloor + confidence * weights.conservativeConfidence + strategyAdjustment;
  if (riskTolerance === 'aggressive') return expectedPayout * 8_000 + winRate * 100 + ceiling * weights.aggressiveCeiling + strategyAdjustment;
  return expectedPayout * 7_000 + ev * 2 + ceiling * weights.balancedCeiling + confidence * weights.balancedConfidence + strategyAdjustment;
}

function classifyLineup(lineup: DraftLineup): DraftLineup['lineup_type'] {
  const ownership = lineup.ownership_sum ?? 1;
  const leverage = lineup.leverage_score ?? 0;
  if (ownership < 0.85 && leverage > 0) return 'contrarian_tournament';
  if (lineup.players.some((player) => ['questionable', 'day_to_day'].includes(player.injury_status))) return 'late_swap_candidate';
  return 'high_ev';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: PiosRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  try {
    payload.requestId = crypto.randomUUID();
    logStage(payload.requestId, 'request_received');
    payload.sport = String(payload.sport ?? '').toLowerCase();
    payload.contestType = String(payload.contestType ?? '').toLowerCase();
    payload.riskTolerance = String(payload.riskTolerance ?? 'balanced').toLowerCase();
    payload.payoutShape = String(payload.payoutShape ?? 'top_heavy').toLowerCase();
    payload.lineupMode = String(payload.lineupMode ?? defaultLineupMode(payload.payoutShape)).toLowerCase();
    validatePayload(payload);
    if (payload.slate) {
      if (String(payload.slate.sport).toLowerCase() !== payload.sport) throw new Error('Selected slate sport does not match request sport');
      if (String(payload.slate.contest_type).toLowerCase() !== payload.contestType) throw new Error('Selected slate contest type does not match request contest type');
      if (payload.contestDate && String(payload.slate.contest_date) !== payload.contestDate) throw new Error('Selected slate date does not match request contest date');
      if (payload.contestId && String(payload.slate.contest_id) !== payload.contestId) throw new Error('Selected slate contest_id does not match request contestId');
    }

    const requestedUserId = String(payload.userId ?? '');
    const auth = await validateFunctionAuth(req, requestedUserId);
    assertGenerationRateLimit(auth.userId, req);
    logStage(payload.requestId, 'auth_and_rate_limit_ok', {
      authenticated: Boolean(auth.userId),
      sport: payload.sport,
      contest_type: payload.contestType,
      lineup_mode: payload.lineupMode,
    });

    const draftPlayers = mapToDraftPlayers(payload.playerRoster, payload.sport);
    const constructionRules = strategyProfile(payload);
    const ownershipCoverage = draftPlayers.length
      ? draftPlayers.filter((player) => player.ownership_projection !== undefined).length / draftPlayers.length
      : 0;
    const tournamentNeedsOwnership = payload.lineupMode !== 'safe' && payload.lineupMode !== 'max_fpts';
    const startedAt = Date.now();
    const lineups = generateLineups(
      draftPlayers,
      payload.sport,
      payload.contestType,
      payload.excludedPlayers ?? [],
      payload.riskTolerance,
      payload.lineupMode,
      constructionRules,
      payload.slate,
    );
    logStage(payload.requestId, 'lineups_generated', {
      lineups: lineups.length,
      wall_time_ms: Date.now() - startedAt,
      ownership_coverage: Number(ownershipCoverage.toFixed(3)),
    });

    const injuryExcludedCount = draftPlayers.filter((player) => LINEUP_EXCLUDED_INJURY_STATUSES.has(player.injury_status)).length;
    const questionableIncludedCount = draftPlayers.filter((player) => player.injury_status === 'questionable').length;
    const dataWarnings = [
      ...(injuryExcludedCount
        ? [`${injuryExcludedCount} player${injuryExcludedCount === 1 ? '' : 's'} excluded from lineup generation because injury status was out or doubtful.`]
        : []),
      ...(questionableIncludedCount
        ? [`${questionableIncludedCount} questionable player${questionableIncludedCount === 1 ? '' : 's'} included with discounted projections.`]
        : []),
      ...(tournamentNeedsOwnership && ownershipCoverage < 0.7
        ? [`Ownership coverage is ${(ownershipCoverage * 100).toFixed(0)}%; tournament leverage and duplicate estimates are degraded until ownership scrape coverage reaches 70%.`]
        : []),
      ...(lineups.length ? [] : [
        'No valid lineups could be generated from the provided roster.',
        ...rosterDiagnostics(draftPlayers, payload.sport, payload.contestType, payload.excludedPlayers ?? []),
      ]),
      ...showdownRosterSizeWarnings(payload.contestType, payload.slate),
    ];
    const persistenceWarning = persistGeneratedLineups(lineups, payload, auth.userId, constructionRules);
    if (persistenceWarning) dataWarnings.push(persistenceWarning);

    return jsonResponse({
      manifest_id: payload.manifestId ?? null,
      sport: payload.sport,
      contest_type: payload.contestType,
      contest_date: payload.contestDate ?? null,
      contest_id: payload.contestId ?? null,
      game_id: payload.gameId ?? null,
      slate: payload.slate ?? null,
      lineups,
      simulation_iterations: responseSimulationIterations(payload.lineupMode, constructionRules),
      field_simulation_size: constructionRules.fieldSimulationSize,
      candidate_lineup_cap: MAX_CANDIDATE_LINEUPS,
      lineup_mode: payload.lineupMode,
      construction_rules: constructionRules,
      generated_at: new Date().toISOString(),
      data_warnings: dataWarnings,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
