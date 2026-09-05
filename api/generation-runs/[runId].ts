import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, respondError, tenantContext } from '../../server/runtime.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext();
    const id = String(req.query.runId ?? '');
    const pollOnly = String(req.query.poll ?? '') === '1';
    const runQuery = pollOnly
      ? context.db.from('generation_runs').select('id,state,current_stage,error,created_at,updated_at,requested_entry_count').eq('id', id).eq('tenant_id', context.tenantId).single()
      : context.db.from('generation_runs').select('*').eq('id', id).eq('tenant_id', context.tenantId).single();
    const run = await runQuery;
    if (run.error) throw run.error;
    const stagesQuery = pollOnly
      ? context.db.from('engine_stage_runs').select('id,stage,version,status,warnings,errors,created_at,completed_at').eq('generation_run_id', id).order('created_at', { ascending: true })
      : context.db.from('engine_stage_runs').select('*').eq('generation_run_id', id).order('created_at', { ascending: true });
    const stages = await stagesQuery;
    if (stages.error) throw stages.error;
    if (pollOnly) { res.status(200).json({ run: run.data, stages: stages.data ?? [], lineups: [] }); return; }
    const selection = await context.db.from('floyd_dfs_selection_runs').select('id,version,status,created_at,floyd_dfs_generated_lineups(*)').eq('generation_run_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (selection.error) throw selection.error;
    res.status(200).json({ run: run.data, stages: stages.data ?? [], lineups: selection.data?.floyd_dfs_generated_lineups ?? [] });
  } catch (error) { respondError(req, res, error); }
}
