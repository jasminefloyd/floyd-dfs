import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, respondError, tenantContext } from '../../server/runtime.js';
import { getNbaPlayerTeamAsOf } from '../../server/streetTeam/asOfRepository.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req);
    const playerId = typeof req.query.playerId === 'string' ? req.query.playerId.trim() : '';
    const eventCutoff = typeof req.query.eventCutoff === 'string' ? req.query.eventCutoff.trim() : '';
    const knowledgeCutoff = typeof req.query.knowledgeCutoff === 'string' ? req.query.knowledgeCutoff.trim() : '';
    if (!/^nba:player:sportsdataio:[A-Za-z0-9._:-]{1,64}$/.test(playerId) || !Number.isFinite(Date.parse(eventCutoff)) || !Number.isFinite(Date.parse(knowledgeCutoff))) {
      res.status(400).json({ error: { message: 'playerId, eventCutoff, and knowledgeCutoff must identify a valid NBA player and valid timestamps.' } });
      return;
    }
    const teamId = await getNbaPlayerTeamAsOf(context.db, context.tenantId, playerId, eventCutoff, knowledgeCutoff);
    cors(req, res);
    res.status(200).json({ sport: 'NBA', playerId, eventCutoff: new Date(eventCutoff).toISOString(), knowledgeCutoff: new Date(knowledgeCutoff).toISOString(), teamId: teamId ?? null, status: teamId ? 'RESOLVED' : 'UNKNOWN_NO_AS_OF_EVIDENCE' });
  } catch (error) { respondError(req, res, error); }
}
