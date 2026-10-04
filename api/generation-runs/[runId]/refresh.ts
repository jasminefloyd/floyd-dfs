import type { VercelRequest, VercelResponse } from '@vercel/node';
import { asFormat, asSport, createRun, cors, draftKingsClient, method, respondError, requestId, tenantContext } from '../../../server/runtime.js';
import { buildValidatedSlateFromBundle } from '../../../src/lib/engine/draftKingsSlate.js';
import type { ContestObjective } from '../../../src/lib/engine/contracts.js';

/** Creates a replacement generation run from live DraftKings data before contest lock. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(); const runId = String(req.query.runId ?? '');
    const original = await context.db.from('generation_runs').select('request_payload').eq('tenant_id', context.tenantId).eq('id', runId).single();
    if (original.error) throw original.error;
    const payload = record(original.data.request_payload); const input = record(payload.input);
    const savedSlate = record(input.validatedSlate); const savedContest = record(savedSlate.contest);
    const lockTime = Date.parse(String(savedContest.lockTime ?? ''));
    if (!Number.isFinite(lockTime) || lockTime <= Date.now()) throw new Error('Contest lock has passed or was missing; replacement generation is unavailable.');
    const sport = asSport(input.sport ?? savedSlate.sport); const format = asFormat(input.contestFormat ?? savedContest.format);
    const contestId = String(input.contestId ?? savedContest.draftKingsContestId ?? '');
    const draftGroupId = String(input.draftGroupId ?? savedContest.draftGroupId ?? '');
    if (!contestId || !draftGroupId) throw new Error('Saved contest identity is incomplete; refresh from the Scan page to select the active DraftKings contest.');
    const objective = savedContest.objective as ContestObjective;
    const dk = draftKingsClient();
    const bundle = await dk.getSlateBundleForDraftGroup({ contestId, draftGroupId, sport, format, contestName: String(savedContest.name ?? ''), contestLockTime: String(savedContest.lockTime), contestSize: Number(savedContest.contestSize) || undefined });
    const id = requestId();
    const refreshedSlate = buildValidatedSlateFromBundle(bundle, { tenantId: context.tenantId, userId: context.userId, requestId: id, sport, league: sport, contestId, contestFormat: format, userEntryCount: Math.max(1, Number(savedContest.userEntryCount ?? payload.entries ?? 1)), contestName: String(savedContest.name ?? ''), contestLockTime: String(savedContest.lockTime), contestSizeOverride: Number(savedContest.contestSize) || undefined, objective });
    if (refreshedSlate.validation.status === 'BLOCKED') throw new Error(refreshedSlate.validation.errors.join(' '));
    const run = await createRun(context.db, { tenantId: context.tenantId, userId: context.userId, requestId: id, entries: refreshedSlate.contest.userEntryCount, payload: { ...input, refreshedFromRunId: runId, refreshRequestedAt: new Date().toISOString(), validatedSlate: refreshedSlate } });
    const job = await context.db.from('engine_jobs').insert({ tenant_id: context.tenantId, generation_run_id: run.id, stage: 'SLATE', status: 'queued', input_payload: { slate: refreshedSlate } }).select('*').single();
    if (job.error) throw job.error;
    cors(req, res); res.status(202).json({ runId: run.id, state: run.state, queued: true, replacesRunId: runId, slate: refreshedSlate, note: 'Replacement run is queued from current DraftKings slate data. Existing and entered lineups are unchanged.' });
  } catch (error) { respondError(req, res, error); }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
