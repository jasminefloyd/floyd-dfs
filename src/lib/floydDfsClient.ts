import type { DraftKingsSlate } from './draftkingsSlateClient';
import type { FloydPipelineContext, MIOS_FantasyManifest, Player } from './MIOS_FantasyAgents';
import type { Lineup } from '../components/LineupDisplay';

type JsonRecord = Record<string, unknown>;
const DEFAULT_FLOYD_DFS_API_URL = '';

export interface FloydGenerationResult {
  manifest: MIOS_FantasyManifest;
  lineups: Lineup[];
  data_warnings: string[];
}

export const SCAN_STAGE_ORDER = ['SLATE', 'RESEARCH', 'SPORT_ADJUSTMENT', 'PROJECTION', 'OPTIMIZE', 'SELECTION'] as const;

export const SCAN_STAGE_LABELS: Record<(typeof SCAN_STAGE_ORDER)[number], string> = {
  SLATE: 'Loading slate',
  RESEARCH: 'Gathering research',
  SPORT_ADJUSTMENT: 'Adjusting for matchups',
  PROJECTION: 'Projecting scores',
  OPTIMIZE: 'Building lineups',
  SELECTION: 'Selecting your lineup',
};

export interface ScanProgressStage {
  stage: string;
  status: string;
}

function stageProgress(stagesValue: unknown): ScanProgressStage[] {
  if (!Array.isArray(stagesValue)) return [];
  return stagesValue.filter(isJsonRecord).map((stage) => ({ stage: String(stage.stage ?? 'UNKNOWN'), status: String(stage.status ?? 'UNKNOWN') }));
}

function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_FLOYD_DFS_API_URL?.replace(/\/$/, '') ?? DEFAULT_FLOYD_DFS_API_URL;
  return `${configured}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), { ...init, headers });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Floyd DFS request failed (${response.status}).`);
  return body as T;
}

export async function floydRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}

export interface FloydGameGroup { draftGroupId: string; matchupLabel: string; gameCount?: number; }

export async function listFloydGameGroups(params: { sport: string; contestType: string }, signal?: AbortSignal): Promise<FloydGameGroup[]> {
  const response = await fetch(apiUrl(`/api/slates?sport=${encodeURIComponent(params.sport.toUpperCase())}&format=${encodeURIComponent(params.contestType.toUpperCase())}`), { signal });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Slate request failed (${response.status}).`);
  return Array.isArray(body.groups) ? body.groups.filter(isJsonRecord).map((group) => ({ draftGroupId: String(group.draftGroupId ?? ''), matchupLabel: String(group.matchupLabel ?? 'Game'), gameCount: typeof group.gameCount === 'number' ? group.gameCount : undefined })).filter((group) => group.draftGroupId) : [];
}

export async function listFloydContests(params: { sport: string; contestType: string; draftGroupId?: string }, signal?: AbortSignal): Promise<DraftKingsSlate[]> {
  const groupQuery = params.draftGroupId ? `&draftGroupId=${encodeURIComponent(params.draftGroupId)}` : '';
  const response = await fetch(apiUrl(`/api/slates?sport=${encodeURIComponent(params.sport.toUpperCase())}&format=${encodeURIComponent(params.contestType.toUpperCase())}${groupQuery}`), { signal });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Slate request failed (${response.status}).`);
  const contests = flattenSlateResponse(body);
  return contests.map(({ contest, group }) => {
    const matchup = (contest.matchup ?? group?.matchup) as JsonRecord | null | undefined;
    const lockTime = String(contest.lockTime ?? group?.lockTime ?? '');
    const sport = String(contest.sport ?? group?.sport ?? params.sport);
    const format = String(contest.format ?? group?.format ?? params.contestType);
    return {
      contest_id: String(contest.id), external_contest_id: String(contest.id), sport: sport.toLowerCase(), contest_type: format.toLowerCase(), contest_date: lockTime.slice(0, 10), slate_name: String(contest.name ?? group?.name ?? 'DraftKings contest'), game_ids: matchup ? [String(matchup.away ?? ''), String(matchup.home ?? '')].filter(Boolean) : [], salary_cap: 50000, field_size: positiveInteger(contest.contestSize), status: 'draftkings_live', start_time: lockTime, salary_count: 0, data: { source: 'floyd-dfs', matchup, slate_id: group?.id, sport_logo_url: sportLogoUrl(sport) }, updated_at: String(body.retrievedAt ?? new Date().toISOString()),
    } satisfies DraftKingsSlate;
  });
}

function flattenSlateResponse(body: JsonRecord): Array<{ contest: JsonRecord; group?: JsonRecord }> {
  if (Array.isArray(body.contests)) {
    return body.contests.filter(isJsonRecord).map((contest) => ({ contest }));
  }
  if (!Array.isArray(body.slates)) return [];

  return body.slates.filter(isJsonRecord).flatMap((group) => {
    if (!Array.isArray(group.contests)) return [];
    return group.contests.filter(isJsonRecord).map((contest) => ({ contest, group }));
  });
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

// `queued.slate` is a snapshot from BEFORE processRun() ever runs -- it predates availability
// enrichment (SportsDataIO/ESPN confirmed-lineup/injury data) entirely, so no player on it ever
// carries a real `availability` status. The SLATE stage's own persisted `output_payload` is the
// same slate AFTER that enrichment ran, and is what the roster/lineup display must use instead --
// otherwise "confirmed"/"unconfirmed" badges can never reflect reality.
function enrichedSlateFrom(stagesValue: unknown, fallbackSlate: unknown): unknown {
  if (!Array.isArray(stagesValue)) return fallbackSlate;
  const slateStage = stagesValue.find((value) => isJsonRecord(value) && String(value.stage ?? '').toUpperCase() === 'SLATE');
  return isJsonRecord(slateStage) && slateStage.output_payload ? slateStage.output_payload : fallbackSlate;
}

export async function generateFloydLineups(input: { sport: string; contestType: string; contest: DraftKingsSlate; entries: number; fieldSize: number; lineupMode?: string; minSalaryUsed?: number }, onProgress?: (stages: ScanProgressStage[]) => void): Promise<FloydGenerationResult> {
  const queued = await request<JsonRecord>('/api/generation-runs', { method: 'POST', body: JSON.stringify({ sport: input.sport.toUpperCase(), contestFormat: input.contestType.toUpperCase(), contestId: input.contest.contest_id, contestName: input.contest.slate_name, contestLockTime: input.contest.start_time, entries: input.entries, fieldSize: input.fieldSize, lineupMode: input.lineupMode, minSalaryUsed: input.minSalaryUsed }) });
  const run = queued.run as JsonRecord;
  // /process is a single request that runs the entire pipeline server-side and only resolves once
  // every stage is done -- awaiting it before polling meant onProgress never fired until the run
  // was already 100% complete (the button just sat on its initial label the whole time). Each
  // stage is written to Supabase as processRun() reaches it, so firing this WITHOUT awaiting it
  // and polling concurrently lets the GET calls below actually observe real incremental progress
  // while the POST is still in flight.
  let processError: unknown;
  const processPromise = request(`/api/runs/${String(run.id)}/process`, { method: 'POST', body: '{}' }).catch((error) => { processError = error; });
  let current: JsonRecord = run;
  // A real run commonly takes 2+ minutes end-to-end (Research/Sport Adjustment/Selection each
  // call OpenAI, on top of several external provider fetches) -- verified live against
  // production: a normal successful run took 144s, another ran past 120s. The old 90-attempt
  // (90s) cap was shorter than a normal run, not just a slow one, so it was throwing this timeout
  // on completely healthy runs. 300 attempts (5 minutes) gives real runs comfortable headroom;
  // a genuinely stuck run still surfaces immediately via processError without waiting it out.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const payload = await request<JsonRecord>(`/api/generation-runs/${String(run.id)}`);
    current = payload.run as JsonRecord;
    onProgress?.(stageProgress(payload.stages));
    if (processError) throw processError;
    if (['ready', 'blocked', 'failed', 'complete'].includes(String(current.state))) {
      await processPromise;
      if (processError) throw processError;
      const enrichedSlate = enrichedSlateFrom(payload.stages, queued.slate);
      const lineups = mapLineups(payload.lineups, enrichedSlate, payload.stages);
      if (current.state !== 'ready' && current.state !== 'complete') throw new Error(String((current.error as JsonRecord | undefined)?.message ?? 'Floyd DFS blocked lineup generation.'));
      return { manifest: mapManifest(input, enrichedSlate, payload), lineups, data_warnings: [] };
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
  const playerPool = Array.isArray(slate?.playerPool) ? slate.playerPool.map((player) => mapPlayer(player, input.sport)) : [];
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
    // payload.cashLineProbability (from SelectedLineup, computed in selection.ts) is the best
    // available number -- calibrated once enough real contest results exist, otherwise the
    // disclosed simulated estimate. The persisted row's own cash_line_probability column is only
    // ever the calibrated value (null pre-approval), kept as a fallback for older persisted rows.
    const cashLineProbability = typeof payload.cashLineProbability === 'number' ? Number(payload.cashLineProbability) : typeof (row as JsonRecord).cash_line_probability === 'number' ? Number((row as JsonRecord).cash_line_probability) : undefined;
    const cashLineConfidence = payload.cashLineConfidence === 'CALIBRATED' || payload.cashLineConfidence === 'SIMULATED_ESTIMATE' ? payload.cashLineConfidence : cashLineProbability !== undefined ? 'CALIBRATED' : 'UNAVAILABLE';
    const contestKind = asRecord(slate?.contest)?.contestKind;
    const contest_kind = contestKind === 'CASH' || contestKind === 'GPP' ? contestKind : 'UNKNOWN';
    return { id: typeof (row as JsonRecord).id === 'string' ? String((row as JsonRecord).id) : undefined, rank: Number(payload.bulletNumber ?? index + 1), players: lineupPlayers, projected_points: Number(payload.median ?? 0), salary_used: Number(payload.salaryUsed ?? 0), confidence_score: cashLineProbability ?? 0, cash_line_confidence: cashLineConfidence as Lineup['cash_line_confidence'], contest_kind: contest_kind as Lineup['contest_kind'], ceiling_score: Number(payload.ceiling ?? 0), simulation_ev: Number(payload.median ?? 0), narrative: String(payload.explanation ?? 'Selected from the verified optimizer candidate set.'), evidence_summary: Array.isArray(payload.rationale) ? payload.rationale.map(String) : [], strategy_notes: Array.isArray(payload.newsContext) ? payload.newsContext.map(String) : [], watch_items: Array.isArray(payload.watchItems) ? payload.watchItems.map(String) : [], readiness_status: payload.readinessStatus === 'READY_WITH_WATCH' ? 'READY_WITH_WATCH' : 'READY', lineup_type: 'high_ev' };
  });
}

function mapPlayer(value: unknown, sport: string): Player {
  const player = value as JsonRecord;
  const team = String(player.team ?? '');
  // The authoritative availability data lives at player.availability (set by
  // applyAvailabilitySnapshot server-side before the slate is returned) — not on flat
  // top-level fields, which never exist on a SlatePlayer.
  const availability = asRecord(player.availability);
  const availabilityStatus = typeof availability?.status === 'string' ? availability.status : undefined;
  const confirmed = availabilityStatus === 'CONFIRMED_STARTER' || availability?.confirmed === true;
  return { id: String(player.playerId), name: String(player.playerName), team, position: String(player.position ?? Object.keys((player.eligibility as JsonRecord | undefined) ?? {})[0] ?? 'UTIL'), salary: Number(player.salary ?? 0), base_salary: Number(player.salary ?? 0), captain_salary: positiveNumber(player.captainSalary), utility_salary: positiveNumber(player.utilitySalary), lineup_status: sport.toLowerCase() === 'mlb' ? confirmed ? 'confirmed' : 'unconfirmed' : undefined, injury_status: mapAvailability(availabilityStatus), image_url: typeof player.imageUrl === 'string' ? player.imageUrl : undefined, team_logo_url: typeof player.teamLogoUrl === 'string' ? player.teamLogoUrl : teamLogoUrl(sport, team), projected_points: undefined };
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

// The engine reports a richer status vocabulary per stage (Slate uses VALID/WARNING/BLOCKED;
// the rest use COMPLETE/PARTIAL/BLOCKED) because those distinctions matter for diagnostics.
// User-facing display only supports two states: a stage either delivered everything it needed
// (COMPLETE) or delivered something usable but incomplete (PARTIAL). BLOCKED shouldn't reach
// this code path in practice -- a genuinely blocked run fails before the lineup screen renders
// -- but is mapped defensively rather than left to display a raw, unrecognized value.
const READY_STAGE_STATUSES = new Set(['COMPLETE', 'VALID', 'READY', 'SUCCEEDED']);
function displayStageStatus(rawStatus: string): 'COMPLETE' | 'PARTIAL' {
  return READY_STAGE_STATUSES.has(rawStatus.toUpperCase()) ? 'COMPLETE' : 'PARTIAL';
}

function buildPipeline(stagesValue: unknown, research: JsonRecord | undefined, lineups: unknown): FloydPipelineContext {
  const stages = Array.isArray(stagesValue) ? stagesValue.map((value) => {
    const stage = value as JsonRecord;
    return { stage: String(stage.stage ?? 'UNKNOWN'), status: displayStageStatus(String(stage.status ?? 'UNKNOWN')), version: typeof stage.version === 'number' ? stage.version : undefined, output_payload: asRecord(stage.output_payload ?? stage.output), error: asRecord(stage.error) };
  }) : [];
  const outputFor = (name: string) => stages.find((stage) => stage.stage.toUpperCase() === name)?.output_payload;
  return { stages, research, adjustment: outputFor('SPORT_ADJUSTMENT') ?? outputFor('ADJUSTMENT'), projection: outputFor('PROJECTION'), optimizer: outputFor('OPTIMIZE') ?? outputFor('OPTIMIZER'), selection: outputFor('SELECTION'), completedCount: stages.filter((stage) => stage.status === 'COMPLETE').length, totalCount: stages.length || (Array.isArray(lineups) ? 1 : 0) };
}

// Maps SlatePlayer.availability.status ('CONFIRMED_STARTER' | 'PROJECTED' | 'ACTIVE' |
// 'INACTIVE' | 'OUT' | 'UNKNOWN') onto the UI's narrower Player['injury_status'] vocabulary.
function mapAvailability(value?: string): Player['injury_status'] {
  if (value === 'OUT' || value === 'INACTIVE') return 'out';
  if (value === 'CONFIRMED_STARTER' || value === 'ACTIVE' || value === 'PROJECTED') return 'active';
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
