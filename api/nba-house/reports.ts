import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, cors, method, respondError, tenantContext } from '../../server/runtime.js';

/** Return only this tenant's saved NBA House reports. Reports remain audit artifacts. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'limit must be an integer from 1 to 100.', 'INVALID_REQUEST');
    const query = context.db.from('floyd_dfs_house_reports')
      .select('id,generation_run_id,intel_snapshot_id,model_version,baseline_model_version,forecast_cutoff,baseline,adjustments,scenario_metadata,trust_status,created_at')
      .eq('tenant_id', context.tenantId)
      .eq('sport', 'NBA')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (typeof req.query.reportId === 'string' && req.query.reportId.trim()) query.eq('id', req.query.reportId.trim());
    const result = await query;
    if (result.error) throw result.error;
    const runIds = [...new Set((result.data ?? []).flatMap((report) => report.generation_run_id ? [String(report.generation_run_id)] : []))];
    const lineageByRun = new Map<string, Record<string, unknown>>();
    for (let offset = 0; offset < runIds.length; offset += 300) {
      const runs = await context.db.from('generation_runs').select('id,lineage').eq('tenant_id', context.tenantId).in('id', runIds.slice(offset, offset + 300));
      if (runs.error) throw runs.error;
      for (const run of runs.data ?? []) { const lineage = record(run.lineage); const assignment = record(lineage?.nbaHouseRolloutAssignment); if (assignment) lineageByRun.set(String(run.id), assignment); }
    }
    cors(req, res);
    res.status(200).json({ sport: 'NBA', reports: (result.data ?? []).map((report) => ({ ...report, runtimeAssignment: report.generation_run_id ? lineageByRun.get(String(report.generation_run_id)) ?? null : null })) });
  } catch (error) { respondError(req, res, error); }
}
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
