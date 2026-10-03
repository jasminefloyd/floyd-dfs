import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCashLineCalibration, calibratedCashLineProbability, CASH_LINE_CALIBRATION_VERSION, type CashLineObservation } from '../../src/lib/engine/cashLineCalibration.js';
import { evaluatePairedProjectionBaseline } from '../../src/lib/engine/calibration.js';
import { cors, method, respondError, tenantContext } from '../../server/runtime.js';

interface ForecastOutcome { sport: string; predicted: number; actual: number; p20?: number; p50?: number; p90?: number; }

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const context = await tenantContext();
    const lineups = await context.db.from('floyd_dfs_generated_lineups').select('id,raw_cash_line_probability,lineup_payload,floyd_dfs_selection_runs!inner(generation_run_id,selection_package)').eq('tenant_id', context.tenantId).limit(5000);
    if (lineups.error) throw lineups.error;
    const results = await context.db.from('floyd_dfs_contest_results').select('generated_lineup_id,contest_id,beat_cash_line,actual_dk_points,measured_at').eq('tenant_id', context.tenantId).order('measured_at', { ascending: false }).limit(5000);
    if (results.error) throw results.error;
    const projectionRuns = await context.db.from('floyd_dfs_projection_runs').select('generation_run_id,sport,model_version,projection_package,created_at').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).limit(5000);
    if (projectionRuns.error) throw projectionRuns.error;
    const generationRunIds = [...new Set((projectionRuns.data ?? []).map((row) => String(row.generation_run_id)))];
    const generationRows = generationRunIds.length ? await context.db.from('generation_runs').select('id,request_payload,created_at').eq('tenant_id', context.tenantId).in('id', generationRunIds) : { data: [], error: null };
    if (generationRows.error) throw generationRows.error;
    const generationById = new Map((generationRows.data ?? []).map((row) => [String(row.id), row]));
    const projectionAudit = summarizePreLockPackages(projectionRuns.data ?? [], generationById);
    const historicalActuals = await context.db.from('floyd_dfs_historical_player_actuals').select('slate_id,sport,position,projection_generated_at,lock_time,projected_floor,projected_median,projected_ceiling,baseline_fppg,actual_dk_points').eq('tenant_id', context.tenantId).limit(20000);
    if (historicalActuals.error) throw historicalActuals.error;
    const pairedRows = (historicalActuals.data ?? []).flatMap((row) => row.baseline_fppg === null || row.projected_median === null ? [] : [{ slateId: String(row.slate_id), sport: String(row.sport).toUpperCase() as import('../../src/lib/engine/contracts.js').Sport, role: row.position ? String(row.position) : 'UNKNOWN', generatedAt: String(row.projection_generated_at), lockTime: String(row.lock_time), candidatePoints: Number(row.projected_median), candidateFloor: row.projected_floor === null ? undefined : Number(row.projected_floor), candidateCeiling: row.projected_ceiling === null ? undefined : Number(row.projected_ceiling), baselinePoints: Number(row.baseline_fppg), actualPoints: Number(row.actual_dk_points) }]);
    const pairedBaseline = evaluatePairedProjectionBaseline(pairedRows, '2026-09-08T00:00:00.000Z');
    const lineupById = new Map((lineups.data ?? []).map((row) => [String(row.id), row]));
    const latestResults = new Map<string, (typeof results.data extends (infer T)[] | null ? T : never)>();
    for (const row of results.data ?? []) latestResults.set(String(row.generated_lineup_id), row);
    const observations: CashLineObservation[] = [...latestResults.values()].flatMap((row) => { const lineup = lineupById.get(String(row.generated_lineup_id)); const rawValue = lineup?.raw_cash_line_probability; const raw = Number(rawValue); return row.beat_cash_line === null || rawValue === null || rawValue === undefined || !Number.isFinite(raw) || typeof row.contest_id !== 'string' || !row.contest_id ? [] : [{ contestId: row.contest_id, rawProbability: raw, beatCashLine: row.beat_cash_line === true }]; });
    const forecasts: ForecastOutcome[] = [];
    for (const [lineupId, row] of lineupById) {
      const outcome = latestResults.get(lineupId);
      const payload = asRecord(row.lineup_payload);
      const actual = Number(outcome?.actual_dk_points);
      const predicted = Number(payload?.expectedPoints ?? payload?.median);
      if (!Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
      const relationValue = row.floyd_dfs_selection_runs;
      const selection = Array.isArray(relationValue) ? relationValue[0] : relationValue;
      const selectionPackage = asRecord(asRecord(selection)?.selection_package);
      forecasts.push({ sport: String(selectionPackage?.sport ?? 'UNKNOWN').toUpperCase(), predicted, actual, ...optionalFinite(payload?.floor, 'p20'), ...optionalFinite(payload?.median, 'p50'), ...optionalFinite(payload?.ceiling, 'p90') });
    }
    const projectionValidation = summarizeForecasts(forecasts);
    const calibration = buildCashLineCalibration(observations);
    let updated = 0;
    if (req.method === 'POST' && calibration.status === 'APPROVED') {
      for (const row of lineups.data ?? []) {
        if (row.raw_cash_line_probability === null || row.raw_cash_line_probability === undefined) continue;
        const raw = Number(row.raw_cash_line_probability);
        const probability = calibratedCashLineProbability(raw, calibration);
        const update = await context.db.from('floyd_dfs_generated_lineups').update({ cash_line_probability: probability, cash_line_calibration_status: probability === null ? 'UNCALIBRATED' : 'APPROVED', cash_line_calibration_version: CASH_LINE_CALIBRATION_VERSION }).eq('id', row.id).eq('tenant_id', context.tenantId);
        if (update.error) throw update.error;
        updated += 1;
      }
    }
    cors(req, res); res.status(200).json({ calibration, projectionValidation, preLockProjectionAudit: projectionAudit, pairedBaseline, playerActualRows: historicalActuals.data?.length ?? 0, updatedLineups: updated, probabilityRelease: 'DISABLED_PENDING_OUT_OF_SAMPLE_BASELINE_VALIDATION' });
  } catch (error) { respondError(req, res, error); }
}

function summarizeForecasts(rows: ForecastOutcome[]) {
  const summarize = (items: ForecastOutcome[]) => items.length ? {
    sampleSize: items.length,
    meanAbsoluteError: average(items.map((row) => Math.abs(row.predicted - row.actual))),
    meanBias: average(items.map((row) => row.predicted - row.actual)),
    p20Coverage: coverage(items, 'p20'),
    p50Coverage: coverage(items, 'p50'),
    p90Coverage: coverage(items, 'p90'),
    validationStatus: items.length < 30 ? 'INSUFFICIENT_SAMPLE' : 'DESCRIPTIVE_ONLY',
  } : { sampleSize: 0, meanAbsoluteError: null, meanBias: null, p20Coverage: null, p50Coverage: null, p90Coverage: null, validationStatus: 'NO_RECORDED_RESULTS' };
  const bySport: Record<string, ReturnType<typeof summarize>> = {};
  for (const sport of new Set(rows.map((row) => row.sport))) bySport[sport] = summarize(rows.filter((row) => row.sport === sport));
  return { overall: summarize(rows), bySport, note: 'Descriptive historical scores are not a substitute for pre-lock out-of-sample backtesting; fewer than 30 results is insufficient even for a stable descriptive read.' };
}
function coverage(rows: ForecastOutcome[], field: 'p20' | 'p50' | 'p90'): number | null { const available = rows.filter((row) => row[field] !== undefined); return available.length ? available.filter((row) => row.actual <= row[field]!).length / available.length : null; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function optionalFinite(value: unknown, key: 'p20' | 'p50' | 'p90'): Partial<Pick<ForecastOutcome, 'p20' | 'p50' | 'p90'>> { const number = Number(value); return value !== null && value !== undefined && Number.isFinite(number) ? { [key]: number } : {}; }

function summarizePreLockPackages(projections: Array<{ generation_run_id: string; sport: string; model_version: string; projection_package: unknown }>, runs: Map<string, { request_payload: unknown }>) {
  const bySport: Record<string, { packages: number; preLock: number; missingSlateOrLock: number; generatedAtMissing: number; generatedAtAtOrAfterLock: number; modelVersions: string[] }> = {};
  let linked = 0;
  for (const projection of projections) {
    const key = String(projection.sport ?? 'UNKNOWN').toUpperCase();
    const summary = bySport[key] ??= { packages: 0, preLock: 0, missingSlateOrLock: 0, generatedAtMissing: 0, generatedAtAtOrAfterLock: 0, modelVersions: [] };
    summary.packages += 1;
    if (!summary.modelVersions.includes(projection.model_version)) summary.modelVersions.push(projection.model_version);
    const run = runs.get(String(projection.generation_run_id));
    if (!run) continue;
    linked += 1;
    const request = asRecord(run.request_payload);
    const input = asRecord(request?.input);
    const slate = asRecord(input?.validatedSlate);
    const contest = asRecord(slate?.contest);
    const packageValue = asRecord(projection.projection_package);
    const lockTime = Date.parse(String(contest?.lockTime ?? ''));
    const generatedAt = Date.parse(String(packageValue?.generatedAt ?? ''));
    if (!Number.isFinite(lockTime)) { summary.missingSlateOrLock += 1; continue; }
    if (!Number.isFinite(generatedAt)) { summary.generatedAtMissing += 1; continue; }
    if (generatedAt < lockTime) summary.preLock += 1;
    else summary.generatedAtAtOrAfterLock += 1;
  }
  return { totalPackages: projections.length, linkedPackages: linked, eligiblePreLockPackages: Object.values(bySport).reduce((sum, row) => sum + row.preLock, 0), bySport, method: 'Projection package generatedAt must be strictly earlier than validatedSlate.contest.lockTime; no missing timestamps qualify.' };
}
