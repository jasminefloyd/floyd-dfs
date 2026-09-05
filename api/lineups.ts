import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, respondError, tenantContext } from '../server/runtime.js';
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext();
    const result = await context.db.from('floyd_dfs_generated_lineups').select('*,floyd_dfs_selection_runs!inner(generation_run_id)').eq('tenant_id', context.tenantId).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    const runIds = [...new Set(rows.map((row) => relationRunId(row)).filter(Boolean))];
    const runs = runIds.length ? await context.db.from('generation_runs').select('id,request_payload').in('id', runIds) : { data: [], error: null };
    if (runs.error) throw runs.error;
    const runById = new Map((runs.data ?? []).map((run) => [String(run.id), run]));
    const lineups = rows.map((row) => {
      const generationRunId = relationRunId(row);
      const run = generationRunId ? runById.get(generationRunId) : undefined;
      const requestPayload = asRecord(run?.request_payload);
      const input = asRecord(requestPayload?.input);
      return { ...row, generation_run_id: generationRunId ?? null, contest_name: typeof input?.contestName === 'string' ? input.contestName : null, sport: typeof input?.sport === 'string' ? input.sport : null, contest_format: typeof input?.contestFormat === 'string' ? input.contestFormat : null };
    });
    res.status(200).json({ lineups });
  } catch (error) { respondError(req, res, error); }
}

function relationRunId(row: Record<string, unknown>): string | undefined {
  const relation = row.floyd_dfs_selection_runs;
  const selection = Array.isArray(relation) ? relation[0] : relation;
  const id = selection && typeof selection === 'object' ? (selection as Record<string, unknown>).generation_run_id : undefined;
  return typeof id === 'string' && id ? id : undefined;
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
