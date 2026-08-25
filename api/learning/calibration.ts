import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCashLineCalibration, calibratedCashLineProbability, CASH_LINE_CALIBRATION_VERSION, type CashLineObservation } from '../../src/lib/engine/cashLineCalibration.js';
import { cors, method, respondError, tenantContext } from '../../server/runtime.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const context = await tenantContext();
    const lineups = await context.db.from('floyd_dfs_generated_lineups').select('id,raw_cash_line_probability').eq('tenant_id', context.tenantId).not('raw_cash_line_probability', 'is', null).limit(5000);
    if (lineups.error) throw lineups.error;
    const results = await context.db.from('floyd_dfs_contest_results').select('generated_lineup_id,beat_cash_line').eq('tenant_id', context.tenantId).not('beat_cash_line', 'is', null).limit(5000);
    if (results.error) throw results.error;
    const rawById = new Map((lineups.data ?? []).map((row) => [String(row.id), Number(row.raw_cash_line_probability)]));
    const observations: CashLineObservation[] = (results.data ?? []).flatMap((row) => { const raw = rawById.get(String(row.generated_lineup_id)); return raw === undefined ? [] : [{ rawProbability: raw, beatCashLine: row.beat_cash_line === true }]; });
    const calibration = buildCashLineCalibration(observations);
    let updated = 0;
    if (req.method === 'POST' && calibration.status === 'APPROVED') {
      for (const row of lineups.data ?? []) {
        const raw = Number(row.raw_cash_line_probability);
        const probability = calibratedCashLineProbability(raw, calibration);
        const update = await context.db.from('floyd_dfs_generated_lineups').update({ cash_line_probability: probability, cash_line_calibration_status: probability === null ? 'UNCALIBRATED' : 'APPROVED', cash_line_calibration_version: CASH_LINE_CALIBRATION_VERSION }).eq('id', row.id).eq('tenant_id', context.tenantId);
        if (update.error) throw update.error;
        updated += 1;
      }
    }
    cors(req, res); res.status(200).json({ calibration, updatedLineups: updated });
  } catch (error) { respondError(req, res, error); }
}
