import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isFeatureEnabled } from '../../server/featureFlags.js';
import { ApiError, cors, method, requireOperator, respondError, tenantContext } from '../../server/runtime.js';
import { collectNbaStreetTeam } from '../../server/streetTeam.js';

export const config = { maxDuration: 300 };

/** Authenticated operator refresh. The tenant-scoped ten-minute key throttles repeats and
 * makes concurrent/manual retries idempotent. The endpoint does not imply a scheduler exists. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    if (!isFeatureEnabled('STREET_TEAM_V2')) throw new ApiError(503, 'Street Team collection is disabled until STREET_TEAM_V2 is enabled.', 'FEATURE_DISABLED');
    const context = await tenantContext(req);
    requireOperator(context);
    const apiKey = process.env.SPORTS_DATA_IO_KEY?.trim();
    if (!apiKey) throw new ApiError(503, 'SPORTS_DATA_IO_KEY is not configured for NBA Street Team collection.', 'PROVIDER_UNAVAILABLE');
    const tenMinuteWindow = Math.floor(Date.now() / (10 * 60_000));
    const result = await collectNbaStreetTeam(context.db, context.tenantId, {
      apiKey,
      dataTier: process.env.SPORTS_DATA_IO_DATA_TIER,
      baseUrl: process.env.SPORTS_DATA_IO_BASE_URL?.trim() || undefined,
      idempotencyKey: `operator:${tenMinuteWindow}`,
    });
    cors(req, res);
    res.status(result.status === 'FAILED' ? 503 : result.status === 'ALREADY_RUNNING' ? 202 : 200).json(result);
  } catch (error) { respondError(req, res, error); }
}
