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
    cors(req, res);
    res.status(200).json({ sport: 'NBA', reports: result.data ?? [] });
  } catch (error) { respondError(req, res, error); }
}
