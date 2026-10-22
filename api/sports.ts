import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, draftKingsClient, method, respondError, tenantContext } from '../server/runtime.js';
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> { if (!method(req, res, ['GET'])) return; try { await tenantContext(req); const sports = await draftKingsClient().listSports(); cors(req, res); res.status(200).json({ sports }); } catch (error) { respondError(req, res, error); } }
