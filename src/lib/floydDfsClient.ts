import type { DraftKingsSlate } from './draftkingsSlateClient';
import type { FloydPipelineContext, MIOS_FantasyManifest, Player } from './MIOS_FantasyAgents';
import type { Lineup } from '../components/LineupDisplay';

type JsonRecord = Record<string, unknown>;
const DEFAULT_FLOYD_DFS_API_URL = 'https://dfs-engine-kappa.vercel.app';

export interface FloydGenerationResult {
  manifest: MIOS_FantasyManifest;
  lineups: Lineup[];
  data_warnings: string[];
}

function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_FLOYD_DFS_API_URL?.replace(/\/$/, '') ?? DEFAULT_FLOYD_DFS_API_URL;
  return `${configured}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), { ...init, headers });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Floyd DFS request failed (${response.status}).`);
  return body as T;
}

export async function floydRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}

export async function listFloydContests(params: { sport: string; contestType: string }, signal?: AbortSignal): Promise<DraftKingsSlate[]> {
  const response = await fetch(apiUrl(`/api/slates?sport=${encodeURIComponent(params.sport.toUpperCase())}&format=${encodeURIComponent(params.contestType.toUpperCase())}`), { signal });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Slate request failed (${response.status}).`);
  const contests = Array.isArray(body.contests) ? body.contests as JsonRecord[] : [];
  return contests.map((contest) => {
    const matchup = contest.matchup as JsonRecord | null | undefined;
    const lockTime = String(contest.lockTime ?? '');
    return {
      contest_id: String(contest.id), external_contest_id: String(contest.id), sport: String(contest.sport ?? params.sport).toLowerCase(), contest_type: String(contest.format ?? params.contestType).toLowerCase(), contest_date: lockTime.slice(0, 10), slate_name: String(contest.name ?? 'DraftKings contest'), game_ids: matchup ? [String(matchup.away ?? ''), String(matchup.home ?? '')].filter(Boolean) : [], salary_cap: 50000, field_size: positiveInteger(contest.contestSize), status: 'draftkings_live', start_time: lockTime, salary_count: 0, data: { source: 'floyd-dfs', matchup, sport_logo_url: sportLogoUrl(String(contest.sport ?? params.sport)) }, updated_at: String(body.retrievedAt ?? new Date().toISOString()),
    } satisfies DraftKingsSlate;
  });
}

export async function getFloydContestFieldSize(contestId: string): Promise<number | undefined> {
  const payload = await request<JsonRecord>(`/api/contests/${encodeURIComponent(contestId)}`);
  const contest = payload.contest as JsonRecord | undefined;
  return positiveInteger(contest?.contestSize);
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export async function generateFloydLineups(input: { sport: string; contestType: string; contest: DraftKingsSlate; entries: number; fieldSize: number }): Promise<FloydGenerationResult> {
  const queued = await request<JsonRecord>('/api/generation-runs', { method: 'POST', body: JSON.stringify({ sport: input.sport.toUpperCase(), contestFormat: input.contestType.toUpperCase(), contestId: input.contest.contest_id, contestName: input.contest.slate_name, contestLockTime: input.contest.start_time, entries: input.entries, fieldSize: input.fieldSize }) });
  const run = queued.run as JsonRecord;
  await request(`/api/runs/${String(run.id)}/process`, { method: 'POST', body: '{}' });
  let current: JsonRecord = run;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const payload = await request<JsonRecord>(`/api/generation-runs/${String(run.id)}`);
    current = payload.run as JsonRecord;
    if (['ready', 'blocked', 'failed', 'complete'].includes(String(current.state))) {
      const lineups = mapLineups(payload.lineups, queued.slate, payload.stages);
      if (current.state !== 'ready' && current.state !== 'complete') throw new Error(String((current.error as JsonRecord | undefined)?.message ?? 'Floyd DFS blocked lineup generation.'));
      return { manifest: mapManifest(input, queued.slate, payload), lineups, data_warnings: [] };
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error('Floyd DFS lineup generation timed out while waiting for the durable run.');
}

export async function markFloydLineupEntered(lineupId: string): Promise<void> {
  await request(`/api/lineups/${encodeURIComponent(lineupId)}/entered`, { method: 'POST', body: '{}' });
}

function mapManifest(input: { sport: string; contestType: string; contest: DraftKingsSlate }, slateValue: unknown, payloadValue: unknown): MIOS_FantasyManifest {
  const slate = slateValue as JsonRecord | undefined;
  const payload = payloadValue as JsonRecord;
  const research = asRecord(payload.research);
  const pipeline = buildPipeline(payload.stages, research, payload.lineups);
  const availability = Array.isArray(research?.availability) ? research.availability as JsonRecord[] : [];
  const availabilityByPlayer = new Map(availability.map((item) => [String(item.playerId), String(item.status)]));
  const playerPool = Array.isArray(slate?.playerPool) ? slate.playerPool.map((player) => mapPlayer(player, input.sport, availabilityByPlayer.get(String((player as JsonRecord).playerId)))) : [];
  const blocked = pipeline.stages.some((stage) => ['BLOCKED', 'FAILED'].includes(stage.status.toUpperCase()));
  const cautions = pipeline.stages.filter((stage) => !['COMPLETE', 'READY', 'SUCCEEDED'].includes(stage.status.toUpperCase())).map((stage) => `${stage.stage} stage: ${stage.status}`);
  return { manifest_id: String(slate?.slateId ?? crypto.randomUUID()), sport: input.sport, contest_type: input.contestType, contest_date: input.contest.contest_date, contest_id: input.contest.contest_id, game_id: input.contest.game_ids[0], slate: input.contest, player_roster: playerPool, injury_updates: [], vegas_context: [], social_sentiment: [], catalysts: [], narrative_seeds: [], source_status: { draftkings: 'ok' }, source_health: {}, readiness: { status: blocked ? 'blocked' : cautions.length ? 'caution' : 'ready', eligible_for_lineups: !blocked, eligible_for_tournament: !blocked && !cautions.length, hard_blocks: blocked ? cautions : [], cautions }, model_version: 'floyd-dfs', data_warnings: cautions, collected_at: new Date().toISOString(), dossier_version: 'floyd-dfs-research', dossier: research ?? undefined, floyd_pipeline: pipeline };
}

function mapLineups(value: unknown, slateValue: unknown, stagesValue: unknown): Lineup[] {
  const slate = slateValue as JsonRecord | undefined;
  const projections = new Map<string, number>();
  const stages = Array.isArray(stagesValue) ? stagesValue as JsonRecord[] : [];
  const projectionStage = [...stages].reverse().find((stage) => String(stage.stage) === 'PROJECTION');
  const projectionOutput = (projectionStage?.output_payload ?? projectionStage?.output) as JsonRecord | undefined;
  if (Array.isArray(projectionOutput?.players)) {
    for (const value of projectionOutput.players) {
      const player = value as JsonRecord;
      if (typeof player.playerId === 'string' && typeof (player.projectedOutcomes as JsonRecord | undefined)?.medianP50 === 'number') projections.set(player.playerId, Number((player.projectedOutcomes as JsonRecord).medianP50));
    }
  }
  const players = new Map((Array.isArray(slate?.playerPool) ? slate.playerPool : []).map((player) => {
    const mapped = mapPlayer(player, String(slate?.sport ?? ''));
    const projection = projections.get(mapped.id);
    return [mapped.id, projection === undefined ? mapped : { ...mapped, projected_points: projection, contextual_projection: projection }] as const;
  }));
  return (Array.isArray(value) ? value : []).map((row, index) => {
    const payload = ((row as JsonRecord).lineup_payload ?? {}) as JsonRecord;
    const playerIds = Array.isArray(payload.playerIds) ? payload.playerIds.map(String) : [];
    const rosterSlots = asRecord(payload.rosterSlots) ?? {};
    const slotByPlayer = new Map(Object.entries(rosterSlots).map(([slot, id]) => [String(id), slot]));
    const lineupPlayers: Lineup['players'] = playerIds.flatMap((id) => {
      const player = players.get(id);
      if (!player) return [];
      const rosterSlot = slotByPlayer.get(id);
      const captain = isCaptainSlot(rosterSlot);
      return [{ ...player, roster_slot: rosterSlot, base_salary: player.salary, salary: captain ? player.captain_salary ?? Math.round(player.salary * 1.5) : player.utility_salary ?? player.salary, salary_multiplier: captain ? 1.5 : 1 }];
    });
    return { id: typeof (row as JsonRecord).id === 'string' ? String((row as JsonRecord).id) : undefined, rank: Number(payload.bulletNumber ?? index + 1), players: lineupPlayers, projected_points: Number(payload.median ?? 0), salary_used: Number(payload.salaryUsed ?? 0), confidence_score: 0.5, ceiling_score: Number(payload.ceiling ?? 0), simulation_ev: Number(payload.median ?? 0), narrative: String(payload.explanation ?? 'Selected from the verified optimizer candidate set.'), evidence_summary: Array.isArray(payload.rationale) ? payload.rationale.map(String) : [], strategy_notes: Array.isArray(payload.newsContext) ? payload.newsContext.map(String) : [], lineup_type: 'high_ev' };
  });
}

function mapPlayer(value: unknown, sport: string, availability?: string): Player {
  const player = value as JsonRecord;
  const team = String(player.team ?? '');
  const confirmed = player.confirmedStarter === true || player.lineupStatus === 'CONFIRMED' || typeof player.battingOrder === 'number';
  return { id: String(player.playerId), name: String(player.playerName), team, position: String(player.position ?? Object.keys((player.eligibility as JsonRecord | undefined) ?? {})[0] ?? 'UTIL'), salary: Number(player.salary ?? 0), base_salary: Number(player.salary ?? 0), captain_salary: positiveNumber(player.captainSalary), utility_salary: positiveNumber(player.utilitySalary), lineup_status: sport.toLowerCase() === 'mlb' ? confirmed ? 'confirmed' : 'unconfirmed' : undefined, injury_status: mapAvailability(availability), image_url: typeof player.imageUrl === 'string' ? player.imageUrl : undefined, team_logo_url: typeof player.teamLogoUrl === 'string' ? player.teamLogoUrl : teamLogoUrl(sport, team), projected_points: undefined };
}

function isCaptainSlot(slot?: string): boolean {
  const normalized = slot?.toUpperCase() ?? '';
  return normalized.includes('CPT') || normalized.includes('CAPTAIN') || normalized.includes('MVP');
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function asRecord(value: unknown): JsonRecord | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined; }

function buildPipeline(stagesValue: unknown, research: JsonRecord | undefined, lineups: unknown): FloydPipelineContext {
  const stages = Array.isArray(stagesValue) ? stagesValue.map((value) => {
    const stage = value as JsonRecord;
    return { stage: String(stage.stage ?? 'UNKNOWN'), status: String(stage.status ?? 'UNKNOWN'), version: typeof stage.version === 'number' ? stage.version : undefined, output_payload: asRecord(stage.output_payload ?? stage.output), error: asRecord(stage.error) };
  }) : [];
  const outputFor = (name: string) => stages.find((stage) => stage.stage.toUpperCase() === name)?.output_payload;
  const completeStatuses = new Set(['COMPLETE', 'READY', 'SUCCEEDED']);
  return { stages, research, adjustment: outputFor('SPORT_ADJUSTMENT') ?? outputFor('ADJUSTMENT'), projection: outputFor('PROJECTION'), optimizer: outputFor('OPTIMIZE') ?? outputFor('OPTIMIZER'), selection: outputFor('SELECTION'), completedCount: stages.filter((stage) => completeStatuses.has(stage.status.toUpperCase())).length, totalCount: stages.length || (Array.isArray(lineups) ? 1 : 0) };
}

function mapAvailability(value?: string): Player['injury_status'] {
  if (value === 'OUT') return 'out';
  if (value === 'QUESTIONABLE') return 'questionable';
  if (value === 'AVAILABLE') return 'active';
  return 'unknown';
}

function sportLogoUrl(sport: string): string | undefined {
  const league = sport.toLowerCase();
  return ['nba', 'wnba', 'mlb', 'nfl'].includes(league) ? `https://a.espncdn.com/i/teamlogos/leagues/500/${league}.png` : undefined;
}

function teamLogoUrl(sport: string, team: string): string | undefined {
  const league = sport.toLowerCase();
  const abbreviation = team.trim().toLowerCase();
  return abbreviation && ['nba', 'wnba', 'mlb', 'nfl'].includes(league) ? `https://a.espncdn.com/i/teamlogos/${league}/500/${abbreviation}.png` : undefined;
}
