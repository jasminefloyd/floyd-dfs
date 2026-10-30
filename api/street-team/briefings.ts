import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, cors, method, respondError, tenantContext } from '../../server/runtime.js';
import { getStreetTeamSnapshot, listStreetTeamSnapshots } from '../../server/streetTeam.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req);
    const snapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : undefined;
    const historyRequested = String(req.query.history ?? '') === '1';
    const historyLimit = Number(req.query.limit ?? 20);
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) throw new ApiError(400, 'limit must be an integer from 1 to 100.', 'INVALID_REQUEST');
    if (historyRequested) {
      const snapshots = await listStreetTeamSnapshots(context.db, context.tenantId, historyLimit);
      cors(req, res);
      res.status(200).json({ sport: 'NBA', snapshots });
      return;
    }
    const snapshot = await getStreetTeamSnapshot(context.db, context.tenantId, snapshotId);
    if (!snapshot) throw new ApiError(404, 'Street Team snapshot was not found.', 'NOT_FOUND');
    const ageMs = Date.now() - Date.parse(snapshot.asOf);
    const currentStateFreshness = ageMs > 60 * 60_000
      ? 'STALE'
      : snapshot.unknowns.length || snapshot.providerDiagnostics.some((diagnostic) => diagnostic.status === 'FAILED' || diagnostic.status === 'RATE_LIMITED')
        ? 'PARTIAL'
        : 'FRESH';
    const response = { snapshot, currentStateFreshness, ageMs: Math.max(0, ageMs) };
    cors(req, res);
    res.status(200).json(response);
  } catch (error) { respondError(req, res, error); }
}
