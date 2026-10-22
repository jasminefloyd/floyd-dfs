import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, hasWorkerAuthorization, method, processRun, recordEvent, respondError, tenantContext, workerTenantContext, type TenantContext } from '../../../server/runtime.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof value.message === 'string' ? value.message : 'Pipeline failed.';
    const details = typeof value.details === 'string' ? ` ${value.details}` : '';
    const hint = typeof value.hint === 'string' ? ` Hint: ${value.hint}` : '';
    const code = typeof value.code === 'string' ? ` [${value.code}]` : '';
    return `${message}${code}.${details}${hint}`.replace('..', '.');
  }
  return 'Pipeline failed.';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  let jobId: string | undefined;
  let failureContext: Awaited<ReturnType<typeof tenantContext>> | Awaited<ReturnType<typeof workerTenantContext>> | undefined;
  try {
    let context: TenantContext | { db: Awaited<ReturnType<typeof workerTenantContext>>['db']; tenantId: string; worker: true };
    const workerMatch = hasWorkerAuthorization(req);
    context = workerMatch ? { ...(await workerTenantContext(req)), worker: true } : await tenantContext(req);
    failureContext = context;
    const id = String(req.query.runId ?? '');
    const found = await context.db.from('generation_runs').select('*').eq('id', id).eq('tenant_id', context.tenantId).single();
    if (found.error) throw found.error;
    if (!('worker' in context) && String(found.data.user_id) !== context.userId) { res.status(403).json({ error: 'You cannot process another user’s run.' }); return; }
    if (!['created', 'queued', 'failed', 'slate_validated'].includes(String(found.data.state))) { res.status(409).json({ error: 'This run is not in a processable state.' }); return; }
    const payload = found.data.request_payload as { input?: { validatedSlate?: unknown; lineupMode?: unknown; minSalaryUsed?: unknown; maxSharedPlayers?: unknown; fixedRosterSlots?: unknown } };
    if (!payload.input?.validatedSlate) throw new Error('This run does not contain a validated slate payload.');
    const existing = await context.db.from('engine_jobs').select('id,status,attempt,max_attempts').eq('tenant_id', context.tenantId).eq('generation_run_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw new Error('No engine job exists for this run.');
    if (existing.data.status === 'succeeded' || existing.data.status === 'running') { cors(req, res); res.status(409).json({ error: `This run is already ${existing.data.status}.` }); return; }
    if (existing.data.status === 'failed' && Number(existing.data.attempt) >= Number(existing.data.max_attempts)) { cors(req, res); res.status(409).json({ error: 'This run has exhausted its retry attempts.' }); return; }
    const nextAttempt = Number(existing.data.attempt ?? 0) + 1;
    const job = await context.db.from('engine_jobs').update({ status: 'running', attempt: nextAttempt, started_at: new Date().toISOString(), error: null }).eq('tenant_id', context.tenantId).eq('id', existing.data.id).eq('status', existing.data.status).select('id').maybeSingle();
    if (job.error) throw job.error;
    if (!job.data?.id) { cors(req, res); res.status(409).json({ error: 'This run was claimed by another worker.' }); return; }
    jobId = String(job.data.id);
    await recordEvent(context.db, { tenant_id: context.tenantId, generation_run_id: id, event_type: 'JOB_CLAIMED', stage: 'SLATE', payload: { attempt: nextAttempt } });
    const minSalaryUsed = Number(payload.input.minSalaryUsed);
    const maxSharedPlayers = Number(payload.input.maxSharedPlayers);
    const result = await processRun(context.db, found.data, payload.input.validatedSlate as Parameters<typeof processRun>[2], { lineupMode: typeof payload.input.lineupMode === 'string' ? payload.input.lineupMode : undefined, minSalaryUsed: Number.isFinite(minSalaryUsed) && minSalaryUsed > 0 ? minSalaryUsed : undefined, maxSharedPlayers: Number.isInteger(maxSharedPlayers) && maxSharedPlayers >= 0 ? maxSharedPlayers : undefined, fixedRosterSlots: isStringRecord(payload.input.fixedRosterSlots) ? payload.input.fixedRosterSlots : undefined });
    await context.db.from('engine_jobs').update({ status: 'succeeded', completed_at: new Date().toISOString(), error: null, output_ref: { selection: true } }).eq('tenant_id', context.tenantId).eq('id', jobId);
    cors(req, res); res.status(200).json(result);
  } catch (error) {
    const message = errorMessage(error);
    if (jobId) {
      try {
        const context = failureContext ?? await tenantContext(req);
        const failedAt = new Date().toISOString();
        await context.db.from('engine_jobs').update({ status: 'failed', completed_at: failedAt, error: { message } }).eq('tenant_id', context.tenantId).eq('id', jobId);
        await context.db.from('generation_runs').update({ state: 'failed', error: { message }, updated_at: failedAt }).eq('id', String(req.query.runId ?? '')).eq('tenant_id', context.tenantId);
      } catch { /* preserve original pipeline error */ }
    }
    respondError(req, res, error);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value as Record<string, unknown>).every(([key, item]) => Boolean(key) && typeof item === 'string')); }
