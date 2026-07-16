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
  ownership_projection?: number;
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
  last_5_stats?: {
    avg_fantasy_pts?: number;
    confidence?: number;
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
  ownership_projection?: number;
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
}

interface DraftLineup {
  players: LineupPlayerDraft[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  simulation_ev?: number;
  ceiling_score?: number;
  floor_score?: number;
  win_rate?: number;
  top_10_rate?: number;
  leverage_score?: number;
  ownership_sum?: number;
  lineup_type?: 'high_ev' | 'contrarian_tournament' | 'late_swap_candidate';
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
const MONTE_CARLO_ITERATIONS = 3_000;
const AGGRESSIVE_MONTE_CARLO_ITERATIONS = 5_000;
const CONSERVATIVE_MONTE_CARLO_ITERATIONS = 2_000;
const MAX_CANDIDATE_LINEUPS = 120;

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

function validatePayload(payload: PiosRequest) {
  if (!VALID_SPORTS.has(payload.sport)) throw new Error(`Unsupported sport: ${payload.sport}`);
  if (!VALID_CONTEST_TYPES.has(payload.contestType)) throw new Error(`Unsupported contest type: ${payload.contestType}`);
  if (!VALID_RISK.has(payload.riskTolerance ?? 'balanced')) throw new Error(`Unsupported risk tolerance: ${payload.riskTolerance}`);
  if (!Array.isArray(payload.playerRoster)) throw new Error('playerRoster must be an array');
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
      ownership_projection: normalizeOwnership(player.ownership_projection),
      minutes_projection: positiveNumber(player.minutes_projection),
      usage_rate: positiveNumber(player.usage_rate),
      pace_metric: positiveNumber(player.pace_metric),
    };
  });
}

function generateLineups(
  roster: LineupPlayerDraft[],
  sport: string,
  contestType: string,
  excludedPlayers: string[],
  riskTolerance: string,
  slate?: DraftKingsSlate,
): DraftLineup[] {
  const excludedLower = excludedPlayers.map(normalizePlayerName);
  const eligiblePlayers = roster.filter(
    (player) => player.injury_status !== 'out' && !excludedLower.includes(normalizePlayerName(player.name ?? '')),
  );
  const sortedPlayers = eligiblePlayers
    .map((player) => ({
      ...player,
      ownership_projection: player.ownership_projection ?? estimateOwnership(player, eligiblePlayers),
    }))
    .sort((a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0));
  const candidates = contestType === 'showdown'
    ? generateShowdownLineups(sortedPlayers, showdownRosterSize(sport, slate))
    : generateClassicLineups(sortedPlayers, sport);

  const rankedLineups = runMonteCarloSimulations(candidates.filter((lineup) => validateLineup(lineup, contestType)), sortedPlayers, riskTolerance)
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => ({
      ...lineup,
      confidence_score: calculateLineupConfidence(lineup),
      lineup_type: classifyLineup(lineup),
    }))
    .sort((a, b) => lineupRankScore(b, riskTolerance) - lineupRankScore(a, riskTolerance));

  if (riskTolerance === 'aggressive') return rankedLineups.slice(0, 5);
  return rankedLineups.slice(0, 3);
}

function generateShowdownLineups(players: LineupPlayerDraft[], rosterSize = 6): DraftLineup[] {
  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  const salaryCapShowdown = 50_000;
  const topCaptains = [...players].sort((a, b) => playerValueScore(b) - playerValueScore(a)).slice(0, 12);

  for (const captain of topCaptains) {
    const captainWithMultiplier: LineupPlayerDraft = {
      ...captain,
      base_salary: captain.base_salary ?? captain.salary,
      salary: Math.floor(captain.salary * 1.5),
      salary_multiplier: 1.5,
      roster_slot: 'CPT',
      projected_points: (captain.last_5_avg_pts || captain.projected_points || 0) * 1.5,
    };
    const remainingSalary = salaryCapShowdown - captainWithMultiplier.salary;
    const fieldCandidates = players
      .filter((player) => player.player_id !== captain.player_id)
      .filter((player) => player.salary <= remainingSalary)
      .sort((a, b) => playerValueScore(b) - playerValueScore(a))
      .slice(0, 30);

    function search(startIndex: number, selected: LineupPlayerDraft[], salaryUsed: number) {
      if (lineups.length >= MAX_CANDIDATE_LINEUPS) return;
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
        const signature = lineupPlayers.map((player) => player.player_id).sort().join('|');
        if (signatures.has(signature)) return;
        signatures.add(signature);
        lineups.push({
          players: lineupPlayers,
          projected_points: calculateProjectedPoints(lineupPlayers),
          salary_used: salaryUsed,
          confidence_score: 0,
          constraint_violations: [],
        });
        return;
      }

      for (let index = startIndex; index < fieldCandidates.length; index += 1) {
        const candidate = fieldCandidates[index];
        if (salaryUsed + candidate.salary > salaryCapShowdown) continue;
        selected.push(candidate);
        search(index + 1, selected, salaryUsed + candidate.salary);
        selected.pop();
        if (lineups.length >= MAX_CANDIDATE_LINEUPS) return;
      }
    }

    if (captainWithMultiplier.salary <= salaryCapShowdown) {
      search(0, [], captainWithMultiplier.salary);
    }
  }

  return lineups;
}

function showdownRosterSize(sport: string, slate?: DraftKingsSlate): number {
  const rawSize = Number(slate?.data?.roster_size);
  if (Number.isFinite(rawSize) && rawSize >= 2 && rawSize <= 8) return rawSize;
  if (sport === 'wnba') return 6;
  return 6;
}

function generateClassicLineups(players: LineupPlayerDraft[], sport: string): DraftLineup[] {
  const slots = ROSTER_SLOTS[sport];
  if (!slots) return [];

  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  let iterations = 0;
  const maxIterations = 200_000;
  const candidateLists = slots.map((slotDef) => players
    .filter((player) => playerEligibleForSlot(player, slotDef))
    .sort((a, b) => playerValueScore(b) - playerValueScore(a))
    .slice(0, 30));

  function search(slotIndex: number, selected: LineupPlayerDraft[], usedIds: Set<string>, salaryUsed: number) {
    iterations += 1;
    if (iterations > maxIterations || lineups.length >= MAX_CANDIDATE_LINEUPS) return;

    if (slotIndex === slots.length) {
      const signature = selected.map((player) => player.player_id).sort().join('|');
      if (signatures.has(signature)) return;
      signatures.add(signature);
      lineups.push({
        players: [...selected],
        projected_points: calculateProjectedPoints(selected),
        salary_used: salaryUsed,
        confidence_score: 0,
        constraint_violations: [],
      });
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

      if (iterations > maxIterations || lineups.length >= MAX_CANDIDATE_LINEUPS) return;
    }
  }

  search(0, [], new Set<string>(), 0);
  return lineups;
}

function playerValueScore(player: LineupPlayerDraft): number {
  const projected = player.projected_points || player.last_5_avg_pts || 0;
  const salary = Math.max(player.salary, 1);
  const ownership = player.ownership_projection ?? 0.12;
  return projected * 0.7 + (projected / salary) * 10_000 * 0.3 - ownership * 4;
}

function playerEligibleForSlot(player: LineupPlayerDraft, slotDef: RosterSlot): boolean {
  return String(player.position ?? '')
    .split('/')
    .map((position) => position.trim())
    .some((position) => slotDef.eligible.includes(position));
}

function calculateProjectedPoints(players: LineupPlayerDraft[]): number {
  return players.reduce((sum, player) => sum + (player.projected_points || player.last_5_avg_pts || 0), 0);
}

function validateLineup(lineup: DraftLineup, contestType: string): boolean {
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

  lineup.constraint_violations = violations;
  return violations.length === 0;
}

function uniqueTeams(players: LineupPlayerDraft[]): string[] {
  return [...new Set(players.map((player) => String(player.team ?? '').toUpperCase()).filter(Boolean))];
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
  const volatility = 0.18 + (1 - confidence) * 0.35;
  const injuryBoost = ['questionable', 'doubtful', 'day_to_day'].includes(player.injury_status) ? 0.12 : 0;
  return Math.max(projection * (volatility + injuryBoost), 1.5);
}

function randomNormal(mean: number, stdDev: number): number {
  const first = Math.max(Math.random(), Number.EPSILON);
  const second = Math.max(Math.random(), Number.EPSILON);
  const z = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return Math.max(0, mean + z * stdDev);
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentileValue / 100) * sorted.length)));
  return Number(sorted[index].toFixed(2));
}

function runMonteCarloSimulations(
  lineups: DraftLineup[],
  roster: LineupPlayerDraft[],
  riskTolerance: string,
): DraftLineup[] {
  if (!lineups.length) return [];

  const playerProfiles = new Map(roster.map((player) => [
    player.player_id,
    {
      mean: player.projected_points || player.last_5_avg_pts || 0,
      stdDev: playerStdDev(player),
    },
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
    const playerOutcomes = new Map<string, number>();
    for (const [playerId, profile] of playerProfiles.entries()) {
      playerOutcomes.set(playerId, randomNormal(profile.mean, profile.stdDev));
    }

    const scored = lineups.map((lineup) => {
      const total = lineup.players.reduce((sum, player) => sum + (playerOutcomes.get(player.player_id) ?? 0), 0);
      samples.get(lineup)?.push(total);
      return { lineup, total };
    }).sort((a, b) => b.total - a.total);

    const winner = scored[0]?.lineup;
    if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
    scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.1))).forEach(({ lineup }) => {
      top10s.set(lineup, (top10s.get(lineup) ?? 0) + 1);
    });
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
      ceiling_score: percentile(outcomes, 85),
      floor_score: percentile(outcomes, 15),
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

function lineupRankScore(lineup: DraftLineup, riskTolerance: string): number {
  const ev = lineup.simulation_ev ?? lineup.projected_points;
  const ceiling = lineup.ceiling_score ?? lineup.projected_points;
  const winRate = lineup.win_rate ?? 0;
  const confidence = lineup.confidence_score ?? 0;
  const floor = lineup.floor_score ?? 0;

  if (riskTolerance === 'conservative') return ev * 100 + floor * 0.8 + confidence * 4;
  if (riskTolerance === 'aggressive') return ev * 100 + ceiling * 0.8 + winRate * 8;
  return ev * 100 + ceiling * 0.4 + winRate * 5 + confidence * 2;
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
    validatePayload(payload);
    if (payload.slate) {
      if (String(payload.slate.sport).toLowerCase() !== payload.sport) throw new Error('Selected slate sport does not match request sport');
      if (String(payload.slate.contest_type).toLowerCase() !== payload.contestType) throw new Error('Selected slate contest type does not match request contest type');
      if (payload.contestDate && String(payload.slate.contest_date) !== payload.contestDate) throw new Error('Selected slate date does not match request contest date');
      if (payload.contestId && String(payload.slate.contest_id) !== payload.contestId) throw new Error('Selected slate contest_id does not match request contestId');
    }

    const requestedUserId = String(payload.userId ?? '');
    await validateFunctionAuth(req, requestedUserId);

    const draftPlayers = mapToDraftPlayers(payload.playerRoster);
    const lineups = generateLineups(
      draftPlayers,
      payload.sport,
      payload.contestType,
      payload.excludedPlayers ?? [],
      payload.riskTolerance,
      payload.slate,
    );

    return jsonResponse({
      manifest_id: payload.manifestId ?? null,
      sport: payload.sport,
      contest_type: payload.contestType,
      contest_date: payload.contestDate ?? null,
      contest_id: payload.contestId ?? null,
      game_id: payload.gameId ?? null,
      slate: payload.slate ?? null,
      lineups,
      simulation_iterations: simulationIterations(payload.riskTolerance),
      candidate_lineup_cap: MAX_CANDIDATE_LINEUPS,
      generated_at: new Date().toISOString(),
      data_warnings: lineups.length ? [] : ['No valid lineups could be generated from the provided roster.'],
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
