import { lineupSignature, solveOptimalLineupsWithMeta, type ExactSolverResult } from './classicSolver.ts';
import { detectAntiCorrelation } from './antiCorrelation.ts';
import {
  correlateOutcomes,
  generateFieldLineups,
  indexFieldLineups,
  sampleLognormalOutcome,
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
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  last_5_stats?: {
    avg_fantasy_pts?: number;
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
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
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
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
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
  leverage_score?: number;
  ownership_sum?: number;
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
  late_swap_flags?: string[];
  strategy_notes?: string[];
  constraint_violations: string[];
}

interface PiosRequest {
  manifestId?: string;
  sport: string;
  contestType: string;
  contestDate?: string;
  contestId?: string;
  gameId?: string;
  slate?: DraftKingsSlate;
  playerRoster: ManifestPlayer[];
  excludedPlayers?: string[];
  riskTolerance?: string;
  lineupMode?: string;
  contestStrategy?: string;
  maxPlayerExposure?: number;
  maxTeamExposure?: number;
  minPrimaryStack?: number;
  diversifyLineups?: boolean;
  lateSwapMode?: boolean;
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

interface RosterSlot {
  slot: string;
  eligible: string[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'f1']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const VALID_RISK = new Set(['conservative', 'balanced', 'aggressive']);
const VALID_LINEUP_MODES = new Set(['max_fpts', 'balanced_ev', 'tournament', 'safe']);
const VALID_CONTEST_STRATEGIES = new Set(['cash', 'single_entry', 'small_field', 'large_field_gpp', 'showdown']);
const LINEUP_ELIGIBLE_INJURY_STATUSES = new Set(['active', 'probable', 'day_to_day', 'questionable']);
const LINEUP_EXCLUDED_INJURY_STATUSES = new Set(['out', 'doubtful']);
const MONTE_CARLO_ITERATIONS = 600;
const AGGRESSIVE_MONTE_CARLO_ITERATIONS = 800;
const CONSERVATIVE_MONTE_CARLO_ITERATIONS = 450;
const MAX_CANDIDATE_LINEUPS = 140;
const SIMULATION_LINEUP_CAP = 36;
const FIELD_LINEUP_CAP = 240;
const EXACT_SOLVER_DEADLINE_MS = 2_500;

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
  f1: [
    { slot: 'D1', eligible: ['DRIVER'] },
    { slot: 'D2', eligible: ['DRIVER'] },
    { slot: 'D3', eligible: ['DRIVER'] },
    { slot: 'D4', eligible: ['DRIVER'] },
    { slot: 'D5', eligible: ['DRIVER'] },
    { slot: 'D6', eligible: ['DRIVER'] },
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
  if (!VALID_LINEUP_MODES.has(payload.lineupMode ?? 'max_fpts')) throw new Error(`Unsupported lineup mode: ${payload.lineupMode}`);
  if (!VALID_CONTEST_STRATEGIES.has(payload.contestStrategy ?? defaultContestStrategy(payload.contestType, payload.lineupMode ?? 'max_fpts'))) {
    throw new Error(`Unsupported contest strategy: ${payload.contestStrategy}`);
  }
  if (!Array.isArray(payload.playerRoster)) throw new Error('playerRoster must be an array');
}

function defaultContestStrategy(contestType: string, lineupMode: string): string {
  if (contestType === 'showdown') return 'showdown';
  if (lineupMode === 'safe') return 'cash';
  if (lineupMode === 'tournament') return 'large_field_gpp';
  return 'single_entry';
}

function mapToDraftPlayers(players: ManifestPlayer[]): LineupPlayerDraft[] {
  return players.map((player) => {
    const projectedPoints = player.projected_points ?? player.last_5_stats?.avg_fantasy_pts ?? 0;
    return {
      name: player.name,
      team: player.team ?? '',
      image_url: player.image_url,
      team_logo_url: player.team_logo_url,
      position: player.position ?? '',
      salary: player.salary,
      base_salary: player.salary,
      salary_multiplier: 1,
      salary_source: player.salary_source,
      player_id: player.id,
      confidence_score: player.last_5_stats?.confidence ?? 0.5,
      last_5_avg_pts: player.last_5_stats?.avg_fantasy_pts ?? projectedPoints,
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
  const eligiblePlayers = roster.filter(
    (player) => LINEUP_ELIGIBLE_INJURY_STATUSES.has(player.injury_status) && !excludedLower.includes(normalizePlayerName(player.name ?? '')),
  );
  const sortedPlayers = eligiblePlayers
    .map((player) => ({
      ...player,
      ownership_projection: player.ownership_projection ?? estimateOwnership(player, eligiblePlayers),
    }))
    .map((player) => applyContextualProjectionEngine(player, sport, rules))
    .sort((a, b) => playerValueScore(b, sport, rules) - playerValueScore(a, sport, rules));
  const classicExact = contestType === 'classic'
    ? generateExactClassicCandidatePool(sortedPlayers, sport, rules)
    : undefined;
  const exactOptimalStatus = classicExact ? exactOptimalValidationStatus(classicExact.unfilteredBest, classicExact.result, sport, rules) : undefined;
  const candidates = contestType === 'showdown'
    ? generateExactShowdownLineups(sortedPlayers, showdownRosterSize(sport, slate))
    : classicExact?.candidates ?? generateClassicLineups(sortedPlayers, sport, rules);

  const baseCandidates = candidates
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => enrichLineupConstruction(lineup, rules, sport));
  const strategyCandidates = baseCandidates.filter((lineup) => validateLineup(lineup, contestType, sport, rules));
  const antiCorrelationFiltered = lineupMode === 'max_fpts'
    ? strategyCandidates
    : strategyCandidates.filter((lineup) => rules.contestStrategy === 'cash' || (lineup.anti_correlation_flags?.length ?? 0) === 0);
  const simulationSource = antiCorrelationFiltered.length ? antiCorrelationFiltered : strategyCandidates.length ? strategyCandidates : withRelaxedRuleNote(baseCandidates);
  const simulationCandidates = ensureLineupInSimulationPool(
    simulationSource
    .sort((a, b) => preSimulationLineupScore(b, rules) - preSimulationLineupScore(a, rules))
      .slice(0, SIMULATION_LINEUP_CAP),
    simulationSource,
    exactOptimalStatus?.signature,
  );

  const rankedSource = lineupMode === 'max_fpts'
    ? simulationCandidates
    : runMonteCarloSimulations(simulationCandidates, sortedPlayers, riskTolerance, sport, contestType, slate);
  const rankedLineups = rankedSource
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => ({
      ...lineup,
      confidence_score: calculateLineupConfidence(lineup),
      lineup_type: classifyLineup(lineup),
      rank_score: lineupRankScore(lineup, riskTolerance, lineupMode, rules),
    }))
    .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))
    .map((lineup, index) => ({ ...lineup, optimizer_rank: index + 1 }));

  const diversified = diversifyRankedLineups(rankedLineups, rules, lineupMode);
  const finalLineups = lineupMode === 'max_fpts'
    ? enforceExactOptimalTop(diversified, rankedLineups, exactOptimalStatus)
    : diversified;

  if (lineupMode === 'max_fpts') return finalLineups.slice(0, 5);
  if (riskTolerance === 'aggressive' || lineupMode === 'tournament') return finalLineups.slice(0, 5);
  return finalLineups.slice(0, 3);
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
  const exactTarget = sport === 'mlb' && rules.contestStrategy !== 'cash' && rules.minPrimaryStack >= 3 ? 80 : 32;
  const result = solveOptimalLineupsWithMeta(players, sport, exactTarget, { deadlineMs: EXACT_SOLVER_DEADLINE_MS });
  const unfilteredBest = result.lineups[0] as DraftLineup | undefined;
  const exactNote = `exact optimizer produced ${result.lineups.length} lineup${result.lineups.length === 1 ? '' : 's'} in ${result.elapsedMs}ms${result.timedOut ? ` before the ${EXACT_SOLVER_DEADLINE_MS}ms cap` : ''}`;
  let exactLineups = (result.lineups as DraftLineup[]).map((lineup, index) => (
    index === 0 ? addStrategyNote(lineup, exactNote) : lineup
  ));

  if (sport === 'mlb' && rules.contestStrategy !== 'cash' && rules.minPrimaryStack >= 3) {
    exactLineups = exactLineups.filter((lineup) => largestTeamStack(lineup).size >= rules.minPrimaryStack).slice(0, 36);
  } else {
    exactLineups = exactLineups.slice(0, 36);
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

function exactLineupKeepCount() {
  return MAX_CANDIDATE_LINEUPS;
}

function generateExactShowdownLineups(players: LineupPlayerDraft[], rosterSize = 6): DraftLineup[] {
  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  const salaryCapShowdown = 50_000;
  const keepCount = exactLineupKeepCount();
  const captains = [...players].sort((a, b) => adjustedProjection(b) - adjustedProjection(a));

  for (const captain of captains) {
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
      const worstKeptProjection = lineups.length >= keepCount ? lineups[lineups.length - 1].projected_points : -Infinity;
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
        insertTopLineup(lineups, {
          players: lineupPlayers,
          projected_points: calculateProjectedPoints(lineupPlayers),
          salary_used: salaryUsed,
          confidence_score: 0,
          constraint_violations: [],
        }, keepCount);
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
  }

  return lineups;
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

function generateClassicLineups(players: LineupPlayerDraft[], sport: string, rules: LineupConstructionRules): DraftLineup[] {
  const slots = ROSTER_SLOTS[sport];
  if (!slots) return [];

  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  let iterations = 0;
  const maxIterations = sport === 'mlb' ? 90_000 : 70_000;
  const candidateLists = slots.map((slotDef) => players
    .filter((player) => playerEligibleForSlot(player, slotDef))
    .sort((a, b) => playerValueScore(b, sport, rules) - playerValueScore(a, sport, rules))
    .slice(0, sport === 'mlb' ? 28 : 24));

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
  volatility += (player.ownership_projection ?? 0.12) < 0.1 ? 0.04 : 0;
  if (sport === 'mlb' && !isPitcher(player) && battingOrder && battingOrder >= 7) volatility += 0.045;
  if (['questionable', 'day_to_day'].includes(player.injury_status)) volatility += 0.08;
  return clampNumber(volatility, 0.16, 0.68, 0.3);
}

function playerValueScore(player: LineupPlayerDraft, sport = '', rules?: LineupConstructionRules): number {
  const projected = adjustedProjection(player);
  const salary = Math.max(player.salary, 1);
  const ownership = player.ownership_projection ?? 0.12;
  const newsBoost = (player.news_score ?? 0) * 0.8;
  const contextBoost = (player.context_score ?? 0) * 2.5;
  const ceiling = player.ceiling_projection ?? projected;
  const floor = player.floor_projection ?? projected;
  const battingOrderBoost = sport === 'mlb' && !isPitcher(player) && player.batting_order
    ? (player.batting_order <= 2 ? 1.4 : player.batting_order <= 5 ? 0.7 : player.batting_order >= 8 ? -0.8 : -0.2)
    : 0;
  const tournamentBoost = rules?.contestStrategy === 'large_field_gpp'
    ? (ceiling - projected) * 0.35 + (player.boom_probability ?? 0) * 2.2 - ownership * 6
    : 0;
  const cashBoost = rules?.contestStrategy === 'cash'
    ? floor * 0.15 - (player.bust_probability ?? 0) * 2.5
    : 0;
  return projected * 0.62
    + (projected / salary) * 10_000 * 0.28
    + ceiling * 0.08
    - ownership * 3
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
  if (lineup.players.length === 0) violations.push('no players selected');
  if (new Set(lineup.players.map((player) => player.player_id)).size !== lineup.players.length) {
    violations.push('duplicate player selected');
  }
  if (contestType === 'showdown' && uniqueTeams(lineup.players).length < 2) {
    violations.push('showdown lineups must include players from both teams');
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
  const stack = stackQualityScore(lineup, rules);
  const context = contextEdgeScore(lineup);
  const volatility = lineupVolatilityScore(lineup);
  const ownership = lineup.ownership_sum ?? lineup.players.reduce((sum, player) => sum + (player.ownership_projection ?? 0.12), 0);
  const boom = lineup.players.reduce((sum, player) => sum + (player.boom_probability ?? 0.12), 0);
  const bust = lineup.players.reduce((sum, player) => sum + (player.bust_probability ?? 0.18), 0);
  const antiPenalty = (lineup.anti_correlation_flags?.length ?? 0) * 8;
  const latePenalty = (lineup.late_swap_flags?.length ?? 0) * 0.75;
  const ownershipAdjustment = rules.contestStrategy === 'large_field_gpp'
    ? (1.15 - ownership) * 6
    : -Math.max(0, ownership - 1.8) * 1.5;
  return Number((
    stack
    + context
    + boom * (rules.contestStrategy === 'large_field_gpp' ? 2.3 : 1)
    + volatility * (rules.contestStrategy === 'cash' ? -2.5 : 2.2)
    + ownershipAdjustment
    - bust * (rules.contestStrategy === 'cash' ? 2 : 0.8)
    - antiPenalty
    - latePenalty
  ).toFixed(2));
}

function lineupWinCondition(lineup: DraftLineup, rules: LineupConstructionRules): string {
  const stack = largestTeamStack(lineup);
  const stackHitters = hitters(lineup).filter((player) => String(player.team ?? '').toUpperCase() === stack.team);
  const topContext = [...lineup.players]
    .sort((a, b) => ((b.context_score ?? 0) + (b.news_score ?? 0) * 0.2) - ((a.context_score ?? 0) + (a.news_score ?? 0) * 0.2))
    .slice(0, 2)
    .map((player) => player.name);
  if (rules.contestStrategy === 'cash') {
    return `Wins by holding floor: confirmed roles, minimized bust risk, and ${stack.team || 'the primary stack'} avoiding dead lineup spots.`;
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

function estimateOwnership(player: LineupPlayerDraft, roster: LineupPlayerDraft[]): number {
  const projected = player.projected_points || player.last_5_avg_pts || 0;
  const maxProjection = Math.max(...roster.map((item) => item.projected_points || item.last_5_avg_pts || 0), 1);
  const maxSalary = Math.max(...roster.map((item) => item.salary || 1), 1);
  const estimate = 0.04 + (projected / maxProjection) * 0.22 + (player.salary / maxSalary) * 0.08;
  return Math.min(Math.max(estimate, 0.02), 0.45);
}

function playerStdDev(player: LineupPlayerDraft): number {
  const projection = player.projected_points || player.last_5_avg_pts || 0;
  const confidence = Math.min(Math.max(player.confidence_score || 0.5, 0.2), 0.95);
  const volatility = player.volatility_score ?? 0.18 + (1 - confidence) * 0.35;
  const injuryBoost = ['questionable', 'doubtful', 'day_to_day'].includes(player.injury_status) ? 0.12 : 0;
  return Math.max(projection * (volatility + injuryBoost), 1.5);
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
  const fieldLineups = indexFieldLineups(
    generateFieldLineups(roster, sport, contestType, FIELD_LINEUP_CAP, ROSTER_SLOTS),
    playerIndex,
  );
  const lineupIndexes = new Map(lineups.map((lineup) => [
    lineup,
    lineup.players.map((player) => playerIndex.get(player.player_id)).filter((index): index is number => typeof index === 'number'),
  ]));
  const samples = new Map<DraftLineup, number[]>();
  const wins = new Map<DraftLineup, number>();
  const top10s = new Map<DraftLineup, number>();
  for (const lineup of lineups) {
    samples.set(lineup, []);
    wins.set(lineup, 0);
    top10s.set(lineup, 0);
  }

  const iterations = riskTolerance === 'conservative'
    ? CONSERVATIVE_MONTE_CARLO_ITERATIONS
    : riskTolerance === 'aggressive'
      ? AGGRESSIVE_MONTE_CARLO_ITERATIONS
      : MONTE_CARLO_ITERATIONS;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const outcomes = new Float64Array(indexedRoster.length);
    for (const entry of indexedRoster) {
      outcomes[entry.index] = sampleLognormalOutcome(entry.mean, entry.stdDev);
    }
    correlateOutcomes(outcomes, means, stdDevs, roster, sport, gamePairs);

    const fieldScores = fieldLineups.map((fieldLineup) => {
      let total = 0;
      for (const index of fieldLineup.indexes) total += outcomes[index] ?? 0;
      return total;
    }).sort((a, b) => a - b);

    for (const lineup of lineups) {
      let total = 0;
      for (const index of lineupIndexes.get(lineup) ?? []) total += outcomes[index] ?? 0;
      samples.get(lineup)?.push(total);
      const beaten = fieldScores.length
        ? lowerBound(fieldScores, total) / fieldScores.length
        : 0;
      if (beaten >= 0.99) wins.set(lineup, (wins.get(lineup) ?? 0) + 1);
      if (beaten >= 0.9) top10s.set(lineup, (top10s.get(lineup) ?? 0) + 1);
    }
  }

  return lineups.map((lineup) => {
    const outcomes = samples.get(lineup) ?? [];
    const ownershipSum = lineup.players.reduce((sum, player) => sum + (player.ownership_projection ?? 0.12), 0);
    const ev = outcomes.reduce((sum, value) => sum + value, 0) / Math.max(outcomes.length, 1);
    const winRate = (wins.get(lineup) ?? 0) / iterations;
    const top10Rate = (top10s.get(lineup) ?? 0) / iterations;
    return {
      ...lineup,
      simulation_ev: Number(ev.toFixed(2)),
      ceiling_score: percentile(outcomes, 96),
      floor_score: percentile(outcomes, 15),
      p99_score: percentile(outcomes, 99),
      win_rate: Number(winRate.toFixed(4)),
      top_10_rate: Number(top10Rate.toFixed(4)),
      ownership_sum: Number(ownershipSum.toFixed(4)),
      leverage_score: Number(((top10Rate * 100) - ownershipSum * 10).toFixed(2)),
    };
  });
}

function simulationIterations(riskTolerance: string): number {
  if (riskTolerance === 'conservative') return CONSERVATIVE_MONTE_CARLO_ITERATIONS;
  if (riskTolerance === 'aggressive') return AGGRESSIVE_MONTE_CARLO_ITERATIONS;
  return MONTE_CARLO_ITERATIONS;
}

function responseSimulationIterations(lineupMode: string, riskTolerance: string): number {
  return lineupMode === 'max_fpts' ? 0 : simulationIterations(riskTolerance);
}

function strategyProfile(payload: PiosRequest): LineupConstructionRules {
  const contestStrategy = payload.contestStrategy ?? defaultContestStrategy(payload.contestType, payload.lineupMode ?? 'max_fpts');
  if ((payload.lineupMode ?? 'max_fpts') === 'max_fpts') {
    return {
      contestStrategy,
      maxPlayerExposure: 1,
      maxTeamExposure: 1,
      minPrimaryStack: 0,
      diversifyLineups: false,
      lateSwapMode: payload.lateSwapMode ?? true,
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
    maxPlayerExposure: clampNumber(payload.maxPlayerExposure, 0.2, 1, defaults.maxPlayerExposure),
    maxTeamExposure: clampNumber(payload.maxTeamExposure, 0.2, 1, defaults.maxTeamExposure),
    minPrimaryStack: Math.round(clampNumber(payload.minPrimaryStack, 0, 5, defaults.minPrimaryStack)),
    diversifyLineups: payload.diversifyLineups ?? defaults.diversifyLineups,
    lateSwapMode: payload.lateSwapMode ?? defaults.lateSwapMode,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function diversifyRankedLineups(lineups: DraftLineup[], rules: LineupConstructionRules, lineupMode: string): DraftLineup[] {
  if (!rules.diversifyLineups || lineupMode === 'safe' || lineupMode === 'max_fpts') return lineups;
  const targetCount = 5;
  const selected: DraftLineup[] = [];
  const playerCounts = new Map<string, number>();
  const teamCountsAcrossLineups = new Map<string, number>();

  for (const lineup of lineups) {
    const nextIndex = selected.length + 1;
    const maxPlayerUses = Math.max(1, Math.ceil(targetCount * rules.maxPlayerExposure));
    const maxTeamUses = Math.max(1, Math.ceil(targetCount * rules.maxTeamExposure));
    const exposureFlags: string[] = [];

    for (const player of lineup.players) {
      const uses = playerCounts.get(player.player_id) ?? 0;
      if (uses >= maxPlayerUses) exposureFlags.push(`${player.name} exposure cap`);
    }
    const stackTeam = lineup.primary_stack_team;
    if (stackTeam && (teamCountsAcrossLineups.get(stackTeam) ?? 0) >= maxTeamUses) {
      exposureFlags.push(`${stackTeam} stack exposure cap`);
    }
    if (exposureFlags.length && nextIndex > 2) continue;

    selected.push({ ...lineup, exposure_flags: exposureFlags });
    for (const player of lineup.players) {
      playerCounts.set(player.player_id, (playerCounts.get(player.player_id) ?? 0) + 1);
    }
    if (stackTeam) teamCountsAcrossLineups.set(stackTeam, (teamCountsAcrossLineups.get(stackTeam) ?? 0) + 1);
    if (selected.length >= targetCount) break;
  }

  return selected.length ? selected.map((lineup, index) => ({ ...lineup, optimizer_rank: index + 1 })) : lineups;
}

function lineupRankScore(lineup: DraftLineup, riskTolerance: string, lineupMode: string, rules: LineupConstructionRules): number {
  const ev = lineup.simulation_ev ?? lineup.projected_points;
  const ceiling = lineup.ceiling_score ?? lineup.projected_points;
  const winRate = lineup.win_rate ?? 0;
  const confidence = lineup.confidence_score ?? 0;
  const floor = lineup.floor_score ?? 0;
  const leverage = lineup.leverage_score ?? 0;
  const projected = lineup.projected_points;
  const intelligence = lineup.lineup_intelligence_score ?? 0;
  const stackQuality = lineup.stack_quality_score ?? 0;
  const contextEdge = lineup.context_edge_score ?? 0;
  const volatility = lineup.volatility_score ?? 0.3;
  const stackBonus = (lineup.primary_stack_size ?? 0) * (rules.contestStrategy === 'large_field_gpp' ? 4 : rules.contestStrategy === 'cash' ? 0.4 : 1.8);
  const antiPenalty = (lineup.anti_correlation_flags?.length ?? 0) * 16;
  const latePenalty = (lineup.late_swap_flags?.length ?? 0) * (rules.lateSwapMode ? 0.8 : 0.1);
  const ownershipPenalty = rules.contestStrategy === 'large_field_gpp' ? (lineup.ownership_sum ?? 0) * 9 : 0;
  const strategyAdjustment = stackBonus
    + intelligence * (rules.contestStrategy === 'cash' ? 1.8 : 3.6)
    + stackQuality * (rules.contestStrategy === 'large_field_gpp' ? 2.4 : 1)
    + contextEdge * 1.5
    + volatility * (rules.contestStrategy === 'cash' ? -5 : 8)
    - antiPenalty
    - latePenalty
    - ownershipPenalty;

  if (lineupMode === 'max_fpts') return projected;
  if (lineupMode === 'safe') return floor * 100 + confidence * 10 + projected + strategyAdjustment;
  if (lineupMode === 'tournament') return ceiling * 100 + leverage * 10 + winRate * 30 + ev + strategyAdjustment;

  if (riskTolerance === 'conservative') return ev * 100 + floor * 0.8 + confidence * 4 + strategyAdjustment;
  if (riskTolerance === 'aggressive') return ev * 100 + ceiling * 0.8 + winRate * 8 + strategyAdjustment;
  return ev * 100 + ceiling * 0.4 + winRate * 5 + confidence * 2 + strategyAdjustment;
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
    payload.sport = String(payload.sport ?? '').toLowerCase();
    payload.contestType = String(payload.contestType ?? '').toLowerCase();
    payload.riskTolerance = String(payload.riskTolerance ?? 'balanced').toLowerCase();
    payload.lineupMode = String(payload.lineupMode ?? 'max_fpts').toLowerCase();
    validatePayload(payload);
    if (payload.slate) {
      if (String(payload.slate.sport).toLowerCase() !== payload.sport) throw new Error('Selected slate sport does not match request sport');
      if (String(payload.slate.contest_type).toLowerCase() !== payload.contestType) throw new Error('Selected slate contest type does not match request contest type');
      if (payload.contestDate && String(payload.slate.contest_date) !== payload.contestDate) throw new Error('Selected slate date does not match request contest date');
      if (payload.contestId && String(payload.slate.contest_id) !== payload.contestId) throw new Error('Selected slate contest_id does not match request contestId');
    }

    const requestedUserId = String(payload.userId ?? '');
    const auth = await validateFunctionAuth(req, requestedUserId);

    const draftPlayers = mapToDraftPlayers(payload.playerRoster);
    const constructionRules = strategyProfile(payload);
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

    const injuryExcludedCount = draftPlayers.filter((player) => LINEUP_EXCLUDED_INJURY_STATUSES.has(player.injury_status)).length;
    const questionableIncludedCount = draftPlayers.filter((player) => player.injury_status === 'questionable').length;
    const dataWarnings = [
      ...(injuryExcludedCount
        ? [`${injuryExcludedCount} player${injuryExcludedCount === 1 ? '' : 's'} excluded from lineup generation because injury status was out or doubtful.`]
        : []),
      ...(questionableIncludedCount
        ? [`${questionableIncludedCount} questionable player${questionableIncludedCount === 1 ? '' : 's'} included with discounted projections.`]
        : []),
      ...(lineups.length ? [] : ['No valid lineups could be generated from the provided roster.']),
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
      simulation_iterations: responseSimulationIterations(payload.lineupMode, payload.riskTolerance),
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
