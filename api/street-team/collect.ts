import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isFeatureEnabled } from '../../server/featureFlags.js';
import { ApiError, cors, method, requireOperator, respondError, schedulerContext, tenantContext } from '../../server/runtime.js';
import { collectNbaStreetTeam } from '../../server/streetTeam.js';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    if (!isFeatureEnabled('STREET_TEAM_V2')) throw new ApiError(503, 'Street Team collection is disabled until STREET_TEAM_V2 is enabled.', 'FEATURE_DISABLED');
    const scheduled = req.method === 'GET';
    let db: Awaited<ReturnType<typeof tenantContext>>['db'];
    let tenantId: string;
    if (scheduled) {
      const context = await schedulerContext(req);
      db = context.db;
      tenantId = context.tenantId;
    } else {
      const context = await tenantContext(req);
      requireOperator(context);
      db = context.db;
      tenantId = context.tenantId;
    }
    const manualKey = scheduled ? undefined : String(req.headers['idempotency-key'] ?? '').trim();
    if (!scheduled && !/^[A-Za-z0-9._:-]{8,128}$/.test(manualKey ?? '')) throw new ApiError(400, 'Manual collection requires an Idempotency-Key header with 8 to 128 safe characters.', 'INVALID_REQUEST');
    const apiKey = process.env.SPORTS_DATA_IO_KEY?.trim();
    if (!apiKey) throw new ApiError(503, 'SPORTS_DATA_IO_KEY is not configured for NBA Street Team collection.', 'PROVIDER_UNAVAILABLE');
    const result = await collectNbaStreetTeam(db, tenantId, { apiKey, dataTier: process.env.SPORTS_DATA_IO_DATA_TIER, baseUrl: process.env.SPORTS_DATA_IO_BASE_URL?.trim() || undefined, idempotencyKey: manualKey });
    cors(req, res);
    res.status(result.status === 'FAILED' ? 503 : result.status === 'ALREADY_RUNNING' ? 202 : 200).json(result);
  } catch (error) { respondError(req, res, error); }
}
