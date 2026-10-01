import type { VercelRequest, VercelResponse } from '@vercel/node';
import { asFormat, asSport, createRun, cors, draftKingsClient, method, parseBody, respondError, requestId, tenantContext } from '../server/runtime.js';
import { buildValidatedSlateFromBundle } from '../src/lib/engine/draftKingsSlate.js';
import type { ContestObjective } from '../src/lib/engine/contracts.js';
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try { const body = parseBody(req); const context = await tenantContext(); const sport = asSport(body.sport); const format = asFormat(body.contestFormat); const contestId = String(body.contestId ?? ''); if (!contestId) throw new Error('contestId is required.'); const lineupMode = normalizeLineupMode(body.lineupMode); const dk = draftKingsClient(); let draftGroupId = String(body.draftGroupId ?? '').trim(); if (!draftGroupId) draftGroupId = await dk.listContests(sport).then((contests) => contests.find((contest) => contest.draftKingsContestId === contestId)?.draftGroupId ?? ''); if (!draftGroupId) throw new Error('DraftKings could not find this contest in the current lobby. Refresh the slate and try again.'); const bundle = await dk.getSlateBundleForDraftGroup({ contestId, draftGroupId, sport, format, contestName: String(body.contestName ?? ''), contestLockTime: String(body.contestLockTime ?? '') || undefined, contestSize: Number(body.fieldSize) || undefined }); const id = requestId(); const cashLine = Number(body.cashLine); const slate = buildValidatedSlateFromBundle(bundle, { tenantId: context.tenantId, userId: context.userId, requestId: id, sport, league: sport, contestId, contestFormat: format, userEntryCount: Math.max(1, Number(body.entries ?? body.requestedEntryCount ?? 1)), contestName: String(body.contestName ?? ''), contestLockTime: String(body.contestLockTime ?? '') || undefined, contestSizeOverride: Number(body.fieldSize) || undefined, cashLine: Number.isFinite(cashLine) && cashLine > 0 ? cashLine : undefined, objective: objectiveForLineupMode(lineupMode) }); if (slate.validation.status === 'BLOCKED') throw new Error(slate.validation.errors.join(' ')); const run = await createRun(context.db, { tenantId: context.tenantId, userId: context.userId, requestId: id, entries: slate.contest.userEntryCount, payload: { ...body, lineupMode, validatedSlate: slate } }); const job = await context.db.from('engine_jobs').insert({ tenant_id: context.tenantId, generation_run_id: run.id, stage: 'SLATE', status: 'queued', input_payload: { slate } }).select('*').single(); if (job.error) throw job.error; cors(req, res); res.status(202).json({ run, runId: run.id, state: run.state, queued: true, slate }); } catch (error) { respondError(req, res, error); }
}

function normalizeLineupMode(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'max_fpts';
  if (typeof value !== 'string' || !['max_fpts', 'tournament', 'balanced_ev', 'safe'].includes(value)) throw new Error('Unsupported lineup objective. Refresh the app and choose a supported objective.');
  return value;
}

function objectiveForLineupMode(value: string): ContestObjective {
  const map: Record<string, ContestObjective> = { max_fpts: 'MAX_FPTS', tournament: 'LARGE_FIELD', balanced_ev: 'SMALL_FIELD', safe: 'CASH' };
  return map[value];
}
