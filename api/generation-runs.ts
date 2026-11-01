import { cacheSlatePlayerPhotos } from '../server/playerPhotoCache.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, asFormat, asSport, createRun, cors, draftKingsClient, method, parseBody, respondError, requestId, tenantContext } from '../server/runtime.js';
import { buildValidatedSlateFromBundle } from '../src/lib/engine/draftKingsSlate.js';
import type { ContestObjective } from '../src/lib/engine/contracts.js';
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try { const body = parseBody(req); const context = await tenantContext(req); const sport = asSport(body.sport); const format = asFormat(body.contestFormat); const contestId = String(body.contestId ?? '').trim(); if (!contestId || contestId.length > 200) throw new Error('contestId is required and must be under 200 characters.'); const entries = Number(body.entries ?? body.requestedEntryCount ?? 1); if (!Number.isInteger(entries) || entries < 1 || entries > 150) throw new Error('entries must be an integer from 1 to 150.'); const fieldSize = body.fieldSize === undefined ? undefined : Number(body.fieldSize); if (fieldSize !== undefined && (!Number.isInteger(fieldSize) || fieldSize < 1 || fieldSize > 5_000_000)) throw new Error('fieldSize must be a positive integer no greater than 5_000_000.'); validateExposure(body.maxPlayerExposure, 'maxPlayerExposure'); validateExposure(body.maxCaptainExposure, 'maxCaptainExposure'); const manualTerms = parseManualContestTerms(body.manualContestTerms); const lineupMode = normalizeLineupMode(body.lineupMode); const simulationMode = normalizeSimulationMode(body.simulationMode, sport); const dk = draftKingsClient(); let draftGroupId = String(body.draftGroupId ?? '').trim(); if (!draftGroupId) draftGroupId = await dk.listContests(sport).then((contests) => contests.find((contest) => contest.draftKingsContestId === contestId)?.draftGroupId ?? ''); if (!draftGroupId) throw new Error('DraftKings could not find this contest in the current lobby. Refresh the slate and try again.'); const bundle = await dk.getSlateBundleForDraftGroup({ contestId, draftGroupId, sport, format, contestName: String(body.contestName ?? ''), contestLockTime: String(body.contestLockTime ?? '') || undefined, contestSize: fieldSize }); const id = requestId(); const cashLine = Number(body.cashLine); let slate = buildValidatedSlateFromBundle(bundle, { tenantId: context.tenantId, userId: context.userId, requestId: id, sport, league: sport, contestId, contestFormat: format, userEntryCount: entries, allowedPhotoHosts: (process.env.FDS_PLAYER_PHOTO_ALLOWED_HOSTS ?? '').split(','), contestName: String(body.contestName ?? ''), contestLockTime: String(body.contestLockTime ?? '') || undefined, contestSizeOverride: fieldSize, cashLine: Number.isFinite(cashLine) && cashLine > 0 ? cashLine : undefined, objective: objectiveForLineupMode(lineupMode) });
    if (manualTerms) slate = applyManualContestTerms(slate, manualTerms, context.userId);
    const photoHosts = (process.env.FDS_PLAYER_PHOTO_ALLOWED_HOSTS ?? '').split(','); slate = await cacheSlatePlayerPhotos(context.db, slate, photoHosts, Number(process.env.FDS_PLAYER_PHOTO_CACHE_TTL_DAYS ?? 7)); if (slate.validation.status === 'BLOCKED') throw new ApiError(422, slate.validation.errors.join(' '), 'VALIDATION_FAILED'); const run = await createRun(context.db, { tenantId: context.tenantId, userId: context.userId, requestId: id, entries: slate.contest.userEntryCount, payload: { ...body, tenantId: undefined, userId: undefined, lineupMode, simulationMode, entries, validatedSlate: slate } }); const job = await context.db.from('engine_jobs').insert({ tenant_id: context.tenantId, generation_run_id: run.id, stage: 'SLATE', status: 'queued', input_payload: { slate } }).select('*').single(); if (job.error) throw job.error; cors(req, res); res.status(202).json({ run, runId: run.id, state: run.state, queued: true, slate }); } catch (error) { respondError(req, res, error); }
}

interface ManualContestTerms { confirmed: true; entryFee?: number; fieldSize?: number; entryLimit?: number; payoutTiers?: Array<{ rank: number; payout: number }>; }
function parseManualContestTerms(value: unknown): ManualContestTerms | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manualContestTerms must be an object with confirmed: true.');
  const input = value as Record<string, unknown>;
  if (input.confirmed !== true) throw new Error('Manual contest terms require explicit confirmed: true.');
  const result: ManualContestTerms = { confirmed: true };
  if (input.entryFee !== undefined) { const n = Number(input.entryFee); if (!Number.isFinite(n) || n <= 0) throw new Error('Manual entryFee must be a positive finite amount.'); result.entryFee = n; }
  if (input.fieldSize !== undefined) { const n = Number(input.fieldSize); if (!Number.isInteger(n) || n < 2 || n > 5_000_000) throw new Error('Manual fieldSize must be an integer from 2 to 5,000,000.'); result.fieldSize = n; }
  if (input.entryLimit !== undefined) { const n = Number(input.entryLimit); if (!Number.isInteger(n) || n < 1 || n > 5_000) throw new Error('Manual entryLimit must be an integer from 1 to 5,000.'); result.entryLimit = n; }
  if (input.payoutTiers !== undefined) {
    if (!Array.isArray(input.payoutTiers) || !input.payoutTiers.length) throw new Error('Manual payoutTiers must be a non-empty array.');
    const ranks = new Set<number>();
    result.payoutTiers = input.payoutTiers.map((item) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each manual payout tier requires rank and payout.'); const row = item as Record<string, unknown>; const rank = Number(row.rank); const payout = Number(row.payout); if (!Number.isInteger(rank) || rank < 1 || ranks.has(rank) || !Number.isFinite(payout) || payout < 0) throw new Error('Manual payout tiers require unique positive integer ranks and nonnegative finite payouts.'); ranks.add(rank); return { rank, payout }; }).sort((a, b) => a.rank - b.rank);
  }
  if (result.entryFee === undefined && result.fieldSize === undefined && result.entryLimit === undefined && result.payoutTiers === undefined) throw new Error('Provide at least one manual contest term.');
  return result;
}
function applyManualContestTerms<T extends { contest: { entryFee?: number; contestSize?: number; maxEntriesAllowed?: number; paidPositions?: number; payoutStructure?: Array<{ rank: number; payout: number }> }; sourceManifest: Array<{ source: string; receivedAt: string; fields: string[] }> }>(slate: T, terms: ManualContestTerms, userId: string): T {
  const payoutStructure = terms.payoutTiers ?? slate.contest.payoutStructure;
  return { ...slate, contest: { ...slate.contest, ...(terms.entryFee !== undefined ? { entryFee: terms.entryFee } : {}), ...(terms.fieldSize !== undefined ? { contestSize: terms.fieldSize } : {}), ...(terms.entryLimit !== undefined ? { maxEntriesAllowed: terms.entryLimit } : {}), ...(payoutStructure ? { payoutStructure, paidPositions: Math.max(...payoutStructure.map((tier) => tier.rank)) } : {}) }, sourceManifest: [...slate.sourceManifest, { source: 'USER_CONFIRMED_CONTEST_TERMS', receivedAt: new Date().toISOString(), fields: [...Object.keys(terms).filter((key) => key !== 'confirmed'), `confirmed:${terms.confirmed}`, `confirmedBy:${userId}`] }] };
}

function normalizeSimulationMode(value: unknown, sport: string): 'baseline' | 'game_simulation' | 'compare' {
  if (value === undefined || value === null || value === '') return 'baseline';
  if (!['baseline', 'game_simulation', 'compare'].includes(String(value))) throw new Error('Unsupported game simulation mode.');
  if (String(value) !== 'baseline' && !['NBA', 'NFL'].includes(sport)) throw new Error('Game simulation is currently supported for NBA and NFL only.');
  return value as 'baseline' | 'game_simulation' | 'compare';
}

function normalizeLineupMode(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'max_fpts';
  if (typeof value !== 'string' || !['max_fpts', 'tournament', 'balanced_ev', 'safe'].includes(value)) throw new Error('Unsupported lineup objective. Refresh the app and choose a supported objective.');
  return value;
}

function validateExposure(value: unknown, name: string): void {
  if (value === undefined || value === null) return;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) throw new Error(`${name} must be greater than 0 and no greater than 1.`);
}

function objectiveForLineupMode(value: string): ContestObjective {
  const map: Record<string, ContestObjective> = { max_fpts: 'MAX_FPTS', tournament: 'LARGE_FIELD', balanced_ev: 'SMALL_FIELD', safe: 'CASH' };
  return map[value];
}
