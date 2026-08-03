// Intended schedule: daily at 6am ET per sport after prior-day box scores settle.
// This repo has no supabase/config.toml scheduling pattern, so cron wiring is documented
// here and intentionally not implemented in this change.

import { dkFantasyPoints, type DkRole, type DkSport } from '../_shared/dkScoring.ts';
import { solveOptimalLineups, type SolverPlayer, type SolverRosterSlot } from '../_shared/lineupSolver.ts';

type Sport = 'nba' | 'wnba' | 'nfl' | 'mlb';

interface SlatePlayer {
  contest_id: string | null;
  contest_type: string;
  player_id: string | null;
  player_name: string;
  team: string | null;
  position: string | null;
  salary?: number | null;
  projected_points: number | null;
  projection_source?: string | null;
}

interface ActualPlayer {
  player_name: string;
  team: string | null;
  position?: string | null;
  actual_points: number;
}

interface ProjectionResultRow {
  contest_type: string;
  contest_id: string | null;
  player_id: string | null;
  player_name: string;
  team: string | null;
  position: string | null;
  projected_points: number | null;
  actual_points: number | null;
  projection_source?: string | null;
}

interface GeneratedLineupRow {
  id: string;
  sport: string;
  contest_date: string;
  contest_type: string;
  contest_id: string | null;
  lineup_mode: string;
  contest_strategy: string;
  config?: { scenarioKey?: string; scenarioConfidence?: number; relationshipScore?: number } | null;
  players: Array<{
    player_id?: string | null;
    player_name?: string | null;
    team?: string | null;
    position?: string | null;
    salary?: number | null;
    roster_slot?: string | null;
    projected_points?: number | null;
    projection_source?: string | null;
  }>;
  projected_points: number;
  salary_used: number;
  optimizer_rank: number;
}

interface IngestRequest {
  sport?: Sport;
  contestDate?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPORT_ROUTE: Record<Sport, string> = {
  nba: 'basketball/nba',
  wnba: 'basketball/wnba',
  nfl: 'football/nfl',
  mlb: 'baseball/mlb',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function yesterdayDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function espnDate(date: string): string {
  return date.replace(/-/g, '');
}

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeTeam(value: unknown): string {
  return String(value ?? '').toUpperCase();
}

function normalizePositionForSolver(value: unknown, sport: Sport): string {
  const position = String(value ?? '').toUpperCase();
  if (sport === 'wnba' && position === 'G') return 'PG';
  if (sport === 'wnba' && position === 'F') return 'SF';
  if (sport === 'nfl' && position === 'D/ST') return 'DST';
  if (sport === 'mlb' && ['LF', 'CF', 'RF'].includes(position)) return 'OF';
  return position;
}

function parseNumber(value: unknown): number {
  const parsed = Number(String(value ?? '').split('-')[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMlbInnings(value: unknown): number {
  const [whole, outs = '0'] = String(value ?? '0').split('.');
  return Number(whole || 0) + Number(outs || 0) / 3;
}

function statKeyFromLabel(label: string): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map: Record<string, string> = {
    min: 'minutes',
    minutes: 'minutes',
    pts: 'points',
    points: 'points',
    reb: 'totalRebounds',
    rebounds: 'totalRebounds',
    ast: 'assists',
    assists: 'assists',
    stl: 'steals',
    steals: 'steals',
    blk: 'blocks',
    blocks: 'blocks',
    to: 'turnovers',
    tov: 'turnovers',
    turnovers: 'turnovers',
    '3pt': 'threePointFieldGoalsMade',
    fg3m: 'threePointFieldGoalsMade',
    passyds: 'passingYards',
    passingyards: 'passingYards',
    passtd: 'passingTouchdowns',
    passingtd: 'passingTouchdowns',
    int: 'interceptions',
    interceptions: 'interceptions',
    rushyds: 'rushingYards',
    rushingyards: 'rushingYards',
    rushtd: 'rushingTouchdowns',
    rushingtd: 'rushingTouchdowns',
    rec: 'receptions',
    receptions: 'receptions',
    receiving: 'receptions',
    recyds: 'receivingYards',
    receivingyards: 'receivingYards',
    rectd: 'receivingTouchdowns',
    receivingtd: 'receivingTouchdowns',
    fumlost: 'fumblesLost',
    fumbleslost: 'fumblesLost',
  };
  return map[key] ?? key;
}

function parseEspnAthleteStats(athlete: any, labels: string[]): Record<string, number> {
  const stats = Array.isArray(athlete?.stats) ? athlete.stats : [];
  const statLine: Record<string, number> = {};
  labels.forEach((label, index) => {
    statLine[statKeyFromLabel(label)] = parseNumber(stats[index]);
  });
  return statLine;
}

async function fetchEspnActuals(sport: Sport, contestDate: string): Promise<ActualPlayer[]> {
  const route = SPORT_ROUTE[sport];
  const scoreboard = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=${espnDate(contestDate)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!scoreboard.ok) throw new Error(`ESPN scoreboard ${scoreboard.status}`);
  const data = await scoreboard.json() as any;
  const events = data?.events ?? [];
  const rows: ActualPlayer[] = [];
  const statLinesByPlayer = new Map<string, {
    player_name: string;
    team: string;
    position: string | null;
    statLine: Record<string, number>;
  }>();

  for (const event of events) {
    const eventId = String(event?.id ?? '');
    if (!eventId) continue;
    const summary = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${encodeURIComponent(eventId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!summary.ok) continue;
    const summaryData = await summary.json() as any;
    for (const teamBox of summaryData?.boxscore?.players ?? []) {
      const team = normalizeTeam(teamBox?.team?.abbreviation);
      for (const group of teamBox?.statistics ?? []) {
        const labels = (group?.names ?? group?.labels ?? []).map(String);
        for (const athleteRow of group?.athletes ?? []) {
          const athlete = athleteRow?.athlete ?? athleteRow;
          const playerName = String(athlete?.displayName ?? athlete?.fullName ?? athlete?.name ?? '');
          if (!playerName) continue;
          const statLine = parseEspnAthleteStats(athleteRow, labels);
          const key = `${normalizeName(playerName)}:${team}`;
          const existing = statLinesByPlayer.get(key) ?? {
            player_name: playerName,
            team,
            position: athlete?.position?.abbreviation ?? null,
            statLine: {},
          };
          for (const [statKey, statValue] of Object.entries(statLine)) {
            existing.statLine[statKey] = (existing.statLine[statKey] ?? 0) + statValue;
          }
          statLinesByPlayer.set(key, existing);
        }
      }
    }
  }

  for (const item of statLinesByPlayer.values()) {
    rows.push({
      player_name: item.player_name,
      team: item.team,
      position: item.position,
      actual_points: Number(dkFantasyPoints(item.statLine, sport as DkSport).toFixed(2)),
    });
  }

  return rows.filter((row) => row.player_name && Number.isFinite(row.actual_points));
}

async function fetchMlbActuals(contestDate: string): Promise<ActualPlayer[]> {
  const schedule = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(contestDate)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!schedule.ok) throw new Error(`MLB schedule ${schedule.status}`);
  const scheduleData = await schedule.json() as any;
  const games = (scheduleData?.dates ?? []).flatMap((date: any) => date?.games ?? []);
  const rows: ActualPlayer[] = [];

  for (const game of games) {
    const gamePk = String(game?.gamePk ?? '');
    if (!gamePk) continue;
    const response = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(gamePk)}/feed/live`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) continue;
    const data = await response.json() as any;
    for (const side of ['home', 'away']) {
      const teamBox = data?.liveData?.boxscore?.teams?.[side];
      const team = normalizeTeam(teamBox?.team?.abbreviation);
      for (const player of Object.values(teamBox?.players ?? {}) as any[]) {
        const person = player?.person ?? {};
        const batting = player?.stats?.batting ?? {};
        const pitching = player?.stats?.pitching ?? {};
        const hasPitching = Object.keys(pitching).length > 0;
        const role: DkRole = hasPitching ? 'pitcher' : 'hitter';
        const statLine = hasPitching
          ? {
            inningsPitched: parseMlbInnings(pitching.inningsPitched),
            strikeOuts: Number(pitching.strikeOuts ?? 0),
            wins: Number(pitching.wins ?? 0),
            earnedRuns: Number(pitching.earnedRuns ?? 0),
            hitsAllowed: Number(pitching.hits ?? 0),
            walksAllowed: Number(pitching.baseOnBalls ?? 0),
            hitBatsmen: Number(pitching.hitBatsmen ?? 0),
            completeGames: Number(pitching.completeGames ?? 0),
            completeGameShutouts: Number(pitching.shutouts ?? 0),
            noHitters: Number(pitching.noHitters ?? 0),
          }
          : {
            hits: Number(batting.hits ?? 0),
            doubles: Number(batting.doubles ?? 0),
            triples: Number(batting.triples ?? 0),
            homeRuns: Number(batting.homeRuns ?? 0),
            rbi: Number(batting.rbi ?? 0),
            runs: Number(batting.runs ?? 0),
            baseOnBalls: Number(batting.baseOnBalls ?? 0),
            hitByPitch: Number(batting.hitByPitch ?? 0),
            stolenBases: Number(batting.stolenBases ?? 0),
          };
        rows.push({
          player_name: String(person.fullName ?? ''),
          team,
          position: player?.position?.abbreviation ?? null,
          actual_points: Number(dkFantasyPoints(statLine, 'mlb', role).toFixed(2)),
        });
      }
    }
  }

  return rows.filter((row) => row.player_name && Number.isFinite(row.actual_points));
}

async function fetchActuals(sport: Sport, contestDate: string): Promise<ActualPlayer[]> {
  if (sport === 'mlb') return fetchMlbActuals(contestDate);
  return fetchEspnActuals(sport, contestDate);
}

function matchActualsToSlate(slatePlayers: SlatePlayer[], actuals: ActualPlayer[]) {
  const byNameTeam = new Map<string, ActualPlayer>();
  const actualsByName = new Map<string, ActualPlayer[]>();
  const slateNameCounts = new Map<string, number>();
  for (const player of slatePlayers) {
    const nameKey = normalizeName(player.player_name);
    slateNameCounts.set(nameKey, (slateNameCounts.get(nameKey) ?? 0) + 1);
  }
  for (const actual of actuals) {
    const nameKey = normalizeName(actual.player_name);
    byNameTeam.set(`${nameKey}:${normalizeTeam(actual.team)}`, actual);
    actualsByName.set(nameKey, [...(actualsByName.get(nameKey) ?? []), actual]);
  }

  const rows = [];
  const unmatched: string[] = [];
  for (const player of slatePlayers) {
    const nameKey = normalizeName(player.player_name);
    const teamKey = normalizeTeam(player.team);
    const exact = byNameTeam.get(`${nameKey}:${teamKey}`);
    const actualNameMatches = actualsByName.get(nameKey) ?? [];
    const uniqueName = slateNameCounts.get(nameKey) === 1 && actualNameMatches.length === 1
      ? actualNameMatches[0]
      : undefined;
    const actual = exact ?? uniqueName;
    if (!actual) {
      unmatched.push(player.player_name);
      continue;
    }
    rows.push({
      sport: '',
      contest_date: '',
      contest_type: player.contest_type,
      contest_id: player.contest_id,
      player_id: player.player_id,
      player_name: player.player_name,
      team: player.team,
      position: player.position,
      projected_points: player.projected_points,
      actual_points: actual.actual_points,
      source: 'auto_boxscore',
      projection_source: player.projection_source ?? 'unknown',
    });
  }
  return { rows, unmatched };
}

function actualKey(playerName: string, team: unknown): string {
  return `${normalizeName(playerName)}:${normalizeTeam(team)}`;
}

function buildActualMap(rows: ProjectionResultRow[]) {
  const actualByNameTeam = new Map<string, number>();
  for (const row of rows) {
    const actual = Number(row.actual_points ?? 0);
    if (!row.player_name || !Number.isFinite(actual)) continue;
    actualByNameTeam.set(actualKey(row.player_name, row.team), actual);
  }
  return actualByNameTeam;
}

async function getUnscoredLineupsForDate(sport: Sport, contestDate: string): Promise<GeneratedLineupRow[]> {
  const unscored = await callSupabaseRpc<GeneratedLineupRow[]>('fantasy_ai_get_unscored_lineups', {
    p_sport: sport,
    p_before_date: contestDate,
  }) ?? [];
  return unscored.filter((lineup) => String(lineup.contest_date) === contestDate);
}

function slatePlayersFromGeneratedLineups(lineups: GeneratedLineupRow[]): SlatePlayer[] {
  const byKey = new Map<string, SlatePlayer>();
  for (const lineup of lineups) {
    for (const player of lineup.players ?? []) {
      const playerName = String(player.player_name ?? '');
      if (!playerName) continue;
      const key = [
        lineup.contest_type,
        lineup.contest_id ?? '',
        normalizeName(playerName),
        normalizeTeam(player.team),
      ].join(':');
      const projectedPoints = Number(player.projected_points ?? 0);
      const existing = byKey.get(key);
      if (existing && Number(existing.projected_points ?? 0) >= projectedPoints) continue;
      byKey.set(key, {
        contest_id: lineup.contest_id,
        contest_type: lineup.contest_type,
        player_id: player.player_id ?? null,
        player_name: playerName,
        team: player.team ?? null,
        position: player.position ?? null,
        salary: player.salary ?? null,
        projected_points: Number.isFinite(projectedPoints) && projectedPoints > 0 ? projectedPoints : null,
        projection_source: player.projection_source ?? 'unknown',
      });
    }
  }
  return [...byKey.values()];
}

function mergeSlatePlayersForResults(primary: SlatePlayer[], fallback: SlatePlayer[]): SlatePlayer[] {
  const merged = new Map<string, SlatePlayer>();
  for (const player of [...primary, ...fallback]) {
    const key = [
      player.contest_type,
      player.contest_id ?? '',
      normalizeName(player.player_name),
      normalizeTeam(player.team),
    ].join(':');
    const existing = merged.get(key);
    if (!existing || (!existing.projected_points && player.projected_points)) {
      merged.set(key, player);
    }
  }
  return [...merged.values()];
}

function lineupActualPoints(lineup: GeneratedLineupRow, actualByNameTeam: Map<string, number>) {
  let missingPlayers = 0;
  const actual = (lineup.players ?? []).reduce((sum, player) => {
    const key = actualKey(String(player.player_name ?? ''), player.team);
    const points = actualByNameTeam.get(key);
    if (points === undefined) {
      missingPlayers += 1;
      return sum;
    }
    return sum + points;
  }, 0);
  return { actual: Number(actual.toFixed(2)), missingPlayers };
}

function showdownSlots(sport: Sport): SolverRosterSlot[] {
  const eligible = sport === 'mlb'
    ? ['P', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF']
    : sport === 'nfl'
      ? ['QB', 'RB', 'WR', 'TE', 'DST', 'DEF']
      : ['PG', 'SG', 'SF', 'PF', 'C'];
  return Array.from({ length: 6 }, (_, index) => ({ slot: `UTIL${index + 1}`, eligible }));
}

function slatePlayersForOptimization(
  slatePlayers: SlatePlayer[],
  actualRows: ProjectionResultRow[],
  sport: Sport,
  contestType: string,
  contestId: string | null,
): SolverPlayer[] {
  const actualByNameTeam = buildActualMap(actualRows);
  const typedRows = slatePlayers.filter((player) => String(player.contest_type).toLowerCase() === contestType);
  const exactContestRows = contestId
    ? typedRows.filter((player) => String(player.contest_id ?? '') === contestId)
    : [];
  const sourceRows = exactContestRows.length ? exactContestRows : typedRows;

  return sourceRows
    .map((player) => {
      const actual = actualByNameTeam.get(actualKey(player.player_name, player.team));
      return {
        name: player.player_name,
        team: normalizeTeam(player.team),
        position: normalizePositionForSolver(player.position, sport),
        salary: Number(player.salary ?? 0),
        player_id: player.player_id ?? actualKey(player.player_name, player.team),
        projected_points: actual ?? 0,
        contextual_projection: actual ?? 0,
      };
    })
    .filter((player) => player.salary > 0 && (player.contextual_projection ?? 0) >= 0);
}

function optimalActualPoints(
  slatePlayers: SlatePlayer[],
  actualRows: ProjectionResultRow[],
  sport: Sport,
  contestType: string,
  contestId: string | null,
): number {
  const players = slatePlayersForOptimization(slatePlayers, actualRows, sport, contestType, contestId);
  if (!players.length) return 0;
  const options = contestType === 'showdown'
    ? { slots: showdownSlots(sport), salaryCap: 50_000, deadlineMs: 4_000 }
    : { salaryCap: 50_000, deadlineMs: 4_000 };
  const lineup = solveOptimalLineups(players, sport, 1, options)[0];
  return Number((lineup?.projected_points ?? 0).toFixed(2));
}

async function scoreGeneratedLineups(
  sport: Sport,
  contestDate: string,
  slatePlayers: SlatePlayer[],
  actualRows: ProjectionResultRow[],
  lineups?: GeneratedLineupRow[],
) {
  const targetLineups = lineups ?? await getUnscoredLineupsForDate(sport, contestDate);
  if (!targetLineups.length) return { scored: 0, missing_players: 0 };

  const actualByNameTeam = buildActualMap(actualRows);
  const optimalCache = new Map<string, number>();
  let scored = 0;
  let missingPlayers = 0;
  const piosEvaluations: Array<Record<string, unknown>> = [];

  for (const lineup of targetLineups) {
    const { actual, missingPlayers: missingForLineup } = lineupActualPoints(lineup, actualByNameTeam);
    missingPlayers += missingForLineup;
    const cacheKey = `${lineup.contest_type}:${lineup.contest_id ?? ''}`;
    const optimal = optimalCache.get(cacheKey) ?? optimalActualPoints(
      slatePlayers,
      actualRows,
      sport,
      String(lineup.contest_type).toLowerCase(),
      lineup.contest_id,
    );
    optimalCache.set(cacheKey, optimal);
    await callSupabaseRpc('fantasy_ai_score_generated_lineup', {
      p_id: lineup.id,
      p_actual: actual,
      p_optimal: optimal,
    });
    piosEvaluations.push({
      generated_lineup_id: lineup.id,
      sport,
      contest_date: contestDate,
      scenario_key: lineup.config?.scenarioKey,
      scenario_confidence: lineup.config?.scenarioConfidence,
      relationship_score: lineup.config?.relationshipScore,
      projection_reliability: null,
      projected_points: lineup.projected_points,
      actual_points: actual,
      point_error: actual - lineup.projected_points,
      outperformed_projection: actual > lineup.projected_points,
    });
    scored += 1;
  }

  if (piosEvaluations.length) {
    await callSupabaseRpc('fantasy_ai_upsert_pios_lineup_evaluations', { p_rows: piosEvaluations }).catch((error) => {
      console.error('PIOS lineup evaluation persistence failed:', error);
    });
  }

  return { scored, missing_players: missingPlayers };
}

async function ingestSport(sport: Sport, contestDate: string) {
  const [storedSlatePlayers, generatedLineups] = await Promise.all([
    callSupabaseRpc<SlatePlayer[]>('fantasy_ai_get_slate_players_for_results', {
      p_sport: sport,
      p_contest_date: contestDate,
    }),
    getUnscoredLineupsForDate(sport, contestDate),
  ]);
  const slatePlayers = mergeSlatePlayersForResults(storedSlatePlayers ?? [], slatePlayersFromGeneratedLineups(generatedLineups));
  if (!slatePlayers.length) {
    return { sport, matched: 0, unmatched: 0, upserted: 0, lineups_scored: 0, lineup_missing_players: 0, unmatched_names: [] };
  }

  const actuals = await fetchActuals(sport, contestDate);
  const matched = matchActualsToSlate(slatePlayers, actuals);
  const rows = matched.rows.map((row) => ({
    ...row,
    sport,
    contest_date: contestDate,
  }));
  const upserted = rows.length
    ? await callSupabaseRpc<number>('fantasy_ai_upsert_projection_results_v2', { p_rows: rows }) ?? 0
    : 0;
  const scoreboard = rows.length
    ? await scoreGeneratedLineups(sport, contestDate, slatePlayers, rows as ProjectionResultRow[], generatedLineups)
    : { scored: 0, missing_players: 0 };
  const snapshotsEvaluated = await callSupabaseRpc<number>('fantasy_ai_evaluate_mios_snapshots', {
    p_sport: sport,
    p_contest_date: contestDate,
  }).catch(() => 0) ?? 0;
  const piosRelationshipsEvaluated = await callSupabaseRpc<number>('fantasy_ai_evaluate_pios_relationships_for_date', {
    p_sport: sport,
    p_contest_date: contestDate,
  }).catch(() => 0) ?? 0;
  return {
    sport,
    matched: rows.length,
    unmatched: matched.unmatched.length,
    upserted,
    lineups_scored: scoreboard.scored,
    lineup_missing_players: scoreboard.missing_players,
    snapshots_evaluated: snapshotsEvaluated,
    pios_relationships_evaluated: piosRelationshipsEvaluated,
    unmatched_names: matched.unmatched.slice(0, 40),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: IngestRequest = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const contestDate = payload.contestDate && !Number.isNaN(new Date(`${payload.contestDate}T00:00:00`).getTime())
    ? payload.contestDate
    : yesterdayDate();
  const requestedSport = payload.sport ? String(payload.sport).toLowerCase() as Sport : undefined;
  const sports: Sport[] = requestedSport ? [requestedSport] : ['nba', 'wnba', 'nfl', 'mlb'];
  if (requestedSport && !SPORT_ROUTE[requestedSport]) return jsonResponse({ error: 'Unsupported sport' }, 400);

  try {
    const results = [];
    for (const sport of sports) {
      results.push(await ingestSport(sport, contestDate));
    }
    return jsonResponse({
      contestDate,
      results,
      matched: results.reduce((sum, item) => sum + item.matched, 0),
      unmatched: results.reduce((sum, item) => sum + item.unmatched, 0),
      upserted: results.reduce((sum, item) => sum + item.upserted, 0),
      lineups_scored: results.reduce((sum, item) => sum + item.lineups_scored, 0),
      lineup_missing_players: results.reduce((sum, item) => sum + item.lineup_missing_players, 0),
      snapshots_evaluated: results.reduce((sum, item) => sum + item.snapshots_evaluated, 0),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
