import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getOwnedLineupSlate, method, parseBody, requireOwnedLineup, respondError, tenantContext } from '../../../server/runtime.js';
import { rawCashLineProbability } from '../../../src/lib/engine/cashLineCalibration.js';
import { reconcileAndDiagnose } from '../../results/import.js';

function optionalText(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null; }
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(req); await requireOwnedLineup(context, String(req.query.lineupId ?? '')); const lineupId = String(req.query.lineupId ?? '');
    const lineup = await context.db.from('floyd_dfs_generated_lineups').select('status,lineup_payload,selection_run_id').eq('id', lineupId).eq('tenant_id', context.tenantId).single();
    if (lineup.error) throw lineup.error;
    if (lineup.data.status !== 'ENTERED') { res.status(409).json({ error: 'Contest results can only be recorded for an ENTERED lineup.' }); return; }
    const body = parseBody(req); const actual = typeof body.actualDkPoints === 'number' ? body.actualDkPoints : null;
    if (actual === null || !Number.isFinite(actual)) { res.status(400).json({ error: 'actualDkPoints is required and must be a finite number.' }); return; }
    const optionalNumber = (key: string): number | null => { const value = body[key]; if (value === undefined || value === null || value === '') return null; if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number when supplied.`); return value; };
    const cashLine = optionalNumber('cashLine'); const finishPosition = optionalNumber('finishPosition'); const finishPercentile = optionalNumber('finishPercentile'); const payout = optionalNumber('payout'); const roi = optionalNumber('roi'); const fieldSize = optionalNumber('fieldSize'); const entryFee = optionalNumber('entryFee'); const paidPositions = optionalNumber('paidPositions');
    if (cashLine !== null && cashLine <= 0) throw new Error('cashLine must be greater than zero.');
    if (finishPosition !== null && (finishPosition < 1 || !Number.isInteger(finishPosition))) throw new Error('finishPosition must be a positive integer.');
    if (finishPercentile !== null && (finishPercentile < 0 || finishPercentile > 100)) throw new Error('finishPercentile must be between 0 and 100.');
    if (payout !== null && payout < 0) throw new Error('payout cannot be negative.');
    if (fieldSize !== null && (!Number.isInteger(fieldSize) || fieldSize < 1)) throw new Error('fieldSize must be a positive integer.');
    if (finishPosition !== null && fieldSize !== null && finishPosition > fieldSize) throw new Error('finishPosition cannot exceed fieldSize.');
    if (entryFee !== null && entryFee < 0) throw new Error('entryFee cannot be negative.');
    if (paidPositions !== null && (!Number.isInteger(paidPositions) || paidPositions < 1 || (fieldSize !== null && paidPositions > fieldSize))) throw new Error('paidPositions is outside the valid field size.');
    const savedSlate = await getOwnedLineupSlate(context, lineupId);
    const suppliedContestId = optionalText(body.contestId);
    if (suppliedContestId && savedSlate?.contest.draftKingsContestId && suppliedContestId !== savedSlate.contest.draftKingsContestId) throw new Error('Contest ID does not match the contest selected for this saved lineup.');
    const contestId = suppliedContestId ?? savedSlate?.contest.draftKingsContestId ?? null;
    const contestName = optionalText(body.contestName) ?? savedSlate?.contest.name ?? null;
    const sport = optionalText(body.sport)?.toUpperCase() ?? savedSlate?.sport ?? null;
    const contestFormat = optionalText(body.contestFormat)?.toUpperCase() ?? savedSlate?.contest.format ?? null;
    const externalEntryId = optionalText(body.externalEntryId);
    if (contestFormat && !['CLASSIC','SHOWDOWN'].includes(contestFormat)) throw new Error('contestFormat must be CLASSIC or SHOWDOWN.');
    if (sport && !['MLB','NFL','WNBA','CFB','GOLF','NBA'].includes(sport)) throw new Error('sport is not supported.');
    if (externalEntryId) {
      if (!contestId || !sport || !contestFormat) throw new Error('Linking a DraftKings entry requires contest ID, sport, and contest format.');
      const existing = await context.db.from('floyd_dfs_entry_links').select('generated_lineup_id').eq('tenant_id', context.tenantId).eq('contest_id', contestId).eq('external_entry_id', externalEntryId).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && String(existing.data.generated_lineup_id) !== lineupId) throw new Error('This DraftKings entry ID is already linked to a different saved lineup.');
      if (!existing.data) { const linked = await context.db.from('floyd_dfs_entry_links').insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, contest_id: contestId, contest_name: contestName, external_entry_id: externalEntryId, sport, contest_format: contestFormat }); if (linked.error) throw linked.error; }
    }
    const payload = (lineup.data.lineup_payload ?? {}) as Record<string, unknown>; const median = Number(payload.median); const floor = Number(payload.floor); const ceiling = Number(payload.ceiling);
    const retrospectiveProbability = cashLine !== null && Number.isFinite(median) ? rawCashLineProbability({ median, floor, ceiling, cashLine }) : null;
    const resultPayload = { ...body, retrospectiveRawCashLineProbability: retrospectiveProbability, probabilityReference: 'computed after lock against the actual cash line; diagnostic only, not the archived forecast' };
    const finishPercentileValue = finishPercentile ?? (finishPosition !== null && fieldSize !== null && fieldSize > 1 ? 100 * (1 - (finishPosition - 1) / (fieldSize - 1)) : null);
    const values = { actual_dk_points: actual, cash_line: cashLine, beat_cash_line: cashLine === null ? null : actual >= cashLine, finish_position: finishPosition, finish_percentile: finishPercentileValue, payout, roi: roi ?? (payout !== null && entryFee !== null && entryFee > 0 ? (payout - entryFee) / entryFee : null), result_payload: resultPayload, contest_id: contestId, contest_name: contestName, sport, contest_format: contestFormat, field_size: fieldSize, entry_fee: entryFee, paid_positions: paidPositions, outcome_source: 'MANUAL', external_entry_id: externalEntryId, official_outcome: false, model_evaluation_eligible: false, reconciliation_status: 'UNVERIFIED' };
    const previous = await context.db.from('floyd_dfs_contest_results').select('id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).order('measured_at', { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw previous.error;
    const result = previous.data ? await context.db.from('floyd_dfs_contest_results').update(values).eq('id', previous.data.id).eq('tenant_id', context.tenantId).select('*').single() : await context.db.from('floyd_dfs_contest_results').insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, ...values }).select('*').single();
    if (result.error) throw result.error;
    const selectionRunId = String(lineup.data.selection_run_id ?? '');
    await reconcileAndDiagnose({ context, resultId: String(result.data.id), lineupId, lineupPayload: lineup.data.lineup_payload, selectionRunId, enteredScore: actual, contestKey: contestId ?? contestName ?? `result:${lineupId}`, officialOutcome: false });
    const reconciled = await context.db.from('floyd_dfs_contest_results').select('reconciliation_status,model_evaluation_eligible,result_payload').eq('tenant_id', context.tenantId).eq('id', String(result.data.id)).single();
    if (reconciled.error) throw reconciled.error;
    const diagnostic = { status: String(reconciled.data.reconciliation_status), modelEvaluationEligible: reconciled.data.model_evaluation_eligible === true, message: reconciled.data.model_evaluation_eligible ? 'Score matched verified player actuals and was accepted for model evaluation. Contest cash-line calibration still requires verified standings.' : 'Score saved. Model evaluation will become available when verified final player actuals exist for every lineup player.' };
    res.status(201).json({ result: reconciled.data, cashLineOutcome: cashLine === null ? null : { actualPoints: actual, cashLine, beatCashLine: actual >= cashLine }, retrospectiveRawCashLineProbability: retrospectiveProbability, diagnostic });
  } catch (error) { respondError(req, res, error); }
}
