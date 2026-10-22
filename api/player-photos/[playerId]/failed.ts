import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, respondError, tenantContext } from '../../../server/runtime.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(req);
    const playerId = String(req.query.playerId ?? '').trim();
    if (!playerId || playerId.length > 200) throw new Error('A canonical player ID is required.');
    const now = new Date().toISOString();
    const { error } = await context.db.from('floyd_dfs_player_photos').update({ photo_url: null, expires_at: now }).eq('tenant_id', context.tenantId).eq('canonical_player_id', playerId).eq('provider', 'DRAFTKINGS');
    if (error) throw error;
    cors(req, res); res.status(204).end();
  } catch (error) { respondError(req, res, error); }
}
