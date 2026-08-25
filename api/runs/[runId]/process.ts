import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, processRun, recordEvent, respondError, tenantContext } from '../../../server/runtime.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  let jobId: string | undefined;
  try {
    const context = await tenantContext();
    const id = String(req.query.runId ?? '');
    const found = await context.db.from('generation_runs').select('*').eq('id', id).eq('tenant_id', context.tenantId).single();
    if (found.error) throw found.error;
    const payload = found.data.request_payload as { input?: { validatedSlate?: unknown } };
    if (!payload.input?.validatedSlate) throw new Error('This run does not contain a validated slate payload.');
    const existing = await context.db.from('engine_jobs').select('id,status,attempt,max_attempts').eq('generation_run_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw new Error('No engine job exists for this run.');
    if (existing.data.status === 'succeeded' || existing.data.status === 'running') { cors(req, res); res.status(409).json({ error: `This run is already ${existing.data.status}.` }); return; }
    if (existing.data.status === 'failed' && Number(existing.data.attempt) >= Number(existing.data.max_attempts)) { cors(req, res); res.status(409).json({ error: 'This run has exhausted its retry attempts.' }); return; }
    const nextAttempt = Number(existing.data.attempt ?? 0) + 1;
    const job = await context.db.from('engine_jobs').update({ status: 'running', attempt: nextAttempt, started_at: new Date().toISOString(), error: null }).eq('id', existing.data.id).eq('status', existing.data.status).select('id').maybeSingle();
    if (job.error) throw job.error;
    if (!job.data?.id) { cors(req, res); res.status(409).json({ error: 'This run was claimed by another worker.' }); return; }
    jobId = String(job.data.id);
    await recordEvent(context.db, { tenant_id: context.tenantId, generation_run_id: id, event_type: 'JOB_CLAIMED', stage: 'SLATE', payload: { attempt: nextAttempt } });
    const result = await processRun(context.db, found.data, payload.input.validatedSlate as Parameters<typeof processRun>[2]);
    await context.db.from('engine_jobs').update({ status: 'succeeded', completed_at: new Date().toISOString(), output_ref: { selection: true } }).eq('id', jobId);
    cors(req, res); res.status(200).json(result);
  } catch (error) {
    if (jobId) { try { const context = await tenantContext(); await context.db.from('engine_jobs').update({ status: 'failed', completed_at: new Date().toISOString(), error: { message: error instanceof Error ? error.message : 'Pipeline failed.' } }).eq('id', jobId); } catch { /* preserve original pipeline error */ } }
    respondError(req, res, error);
  }
}
