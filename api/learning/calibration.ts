import type { VercelRequest, VercelResponse } from '@vercel/node';
import { calibratedCashLineProbability, CASH_LINE_CALIBRATION_VERSION } from '../../src/lib/engine/cashLineCalibration.js';
import { evaluatePairedProjectionBaseline } from '../../src/lib/engine/calibration.js';
import { ApiError, cors, loadCashLineCalibration, method, requireOperator, respondError, tenantContext } from '../../server/runtime.js';
import { isFeatureEnabled } from '../../server/featureFlags.js';

interface ForecastOutcome { sport: string; format: string; predicted: number; actual: number; p20?: number; p50?: number; p90?: number; }

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const context = await tenantContext(req); requireOperator(context);
    const lineups = await queryAll((start, end) => context.db.from('floyd_dfs_generated_lineups').select('id,raw_cash_line_probability,lineup_payload,floyd_dfs_selection_runs!inner(generation_run_id,selection_package)').eq('tenant_id', context.tenantId).order('id').range(start, end));
    if (lineups.error) throw lineups.error;
    const results = await queryAll((start, end) => context.db.from('floyd_dfs_contest_results').select('generated_lineup_id,contest_id,beat_cash_line,actual_dk_points,measured_at,reconciliation_status,model_evaluation_eligible,official_outcome,contest_format').eq('tenant_id', context.tenantId).eq('model_evaluation_eligible', true).eq('reconciliation_status', 'MATCHED').eq('official_outcome', true).order('measured_at', { ascending: false }).range(start, end));
    if (results.error) throw results.error;
    const projectionRuns = await queryAll((start, end) => context.db.from('floyd_dfs_projection_runs').select('id,generation_run_id,sport,model_version,projection_package,created_at').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).range(start, end));
    if (projectionRuns.error) throw projectionRuns.error;
    const generationRunIds = [...new Set((projectionRuns.data ?? []).map((row) => String(row.generation_run_id)))];
    const generationData = [];
    for (let offset = 0; offset < generationRunIds.length; offset += 300) {
      const page = await context.db.from('generation_runs').select('id,request_payload,created_at').eq('tenant_id', context.tenantId).in('id', generationRunIds.slice(offset, offset + 300));
      if (page.error) throw page.error;
      generationData.push(...(page.data ?? []));
    }
    const generationById = new Map(generationData.map((row) => [String(row.id), row]));
    const projectionAudit = summarizePreLockPackages(projectionRuns.data ?? [], generationById);
    const historicalActuals = await queryAll((start, end) => context.db.from('floyd_dfs_historical_player_actuals').select('slate_id,sport,contest_format,position,model_version,projection_generated_at,lock_time,projected_floor,projected_median,projected_ceiling,baseline_fppg,actual_dk_points,source_validation_status,finality_status').eq('tenant_id', context.tenantId).eq('source_validation_status', 'VERIFIED').in('finality_status', ['FINAL','CORRECTED']).order('event_date').range(start, end));
    if (historicalActuals.error) throw historicalActuals.error;
    const pairedRows = (historicalActuals.data ?? []).flatMap((row) => row.baseline_fppg === null || row.projected_median === null ? [] : [{ slateId: String(row.slate_id), sport: String(row.sport).toUpperCase() as import('../../src/lib/engine/contracts.js').Sport, role: `${String(row.contest_format ?? 'UNKNOWN')}:${row.position ? String(row.position) : 'UNKNOWN'}`, generatedAt: String(row.projection_generated_at), lockTime: String(row.lock_time), candidatePoints: Number(row.projected_median), candidateFloor: row.projected_floor === null ? undefined : Number(row.projected_floor), candidateCeiling: row.projected_ceiling === null ? undefined : Number(row.projected_ceiling), baselinePoints: Number(row.baseline_fppg), actualPoints: Number(row.actual_dk_points) }]);
    const pairedBaseline = evaluatePairedProjectionBaseline(pairedRows, '2026-09-08T00:00:00.000Z');
    const verifiedGameActuals = await queryAll((start, end) => context.db.from('floyd_dfs_historical_player_actuals').select('projection_run_id,generation_run_id,player_id,sport,contest_format,slate_id,actual_dk_points,source_validation_status,finality_status').eq('tenant_id', context.tenantId).eq('source_validation_status', 'VERIFIED').in('finality_status', ['FINAL','CORRECTED']).in('sport', ['NBA','NFL']).order('event_date').range(start, end));
    if (verifiedGameActuals.error) throw verifiedGameActuals.error;
    const gameSimulationValidation = summarizeGameSimulationValidation(projectionRuns.data ?? [], verifiedGameActuals.data ?? [], generationById, '2026-09-08T00:00:00.000Z');
    const lineupById = new Map((lineups.data ?? []).map((row) => [String(row.id), row]));
    const latestResults = new Map<string, (typeof results.data extends (infer T)[] | null ? T : never)>();
    for (const row of results.data ?? []) if (!latestResults.has(String(row.generated_lineup_id))) latestResults.set(String(row.generated_lineup_id), row);
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
      if (outcome?.model_evaluation_eligible !== true || outcome?.official_outcome !== true) continue;
      forecasts.push({ sport: String(selectionPackage?.sport ?? 'UNKNOWN').toUpperCase(), format: String(outcome?.contest_format ?? 'UNKNOWN').toUpperCase(), predicted, actual, ...optionalFinite(payload?.floor, 'p20'), ...optionalFinite(payload?.median, 'p50'), ...optionalFinite(payload?.ceiling, 'p90') });
    }
    const projectionValidation = summarizeForecasts(forecasts);
    const calibration = await loadCashLineCalibration(context.db, context.tenantId);
    if (req.method === 'POST' && asRecord(req.body)?.saveEvaluationOnly === true && !isFeatureEnabled('LEARNING_V2')) throw new ApiError(503, 'Evaluation snapshot writes are disabled by the LEARNING_V2 rollback switch.', 'FEATURE_DISABLED');
    let updated = 0;
    if (req.method === 'POST' && calibration.status === 'APPROVED' && asRecord(req.body)?.saveEvaluationOnly !== true) {
      for (const row of lineups.data ?? []) {
        if (row.raw_cash_line_probability === null || row.raw_cash_line_probability === undefined) continue;
        const raw = Number(row.raw_cash_line_probability);
        const probability = calibratedCashLineProbability(raw, calibration);
        const update = await context.db.from('floyd_dfs_generated_lineups').update({ cash_line_probability: probability, cash_line_calibration_status: probability === null ? 'UNCALIBRATED' : 'APPROVED', cash_line_calibration_version: CASH_LINE_CALIBRATION_VERSION }).eq('id', row.id).eq('tenant_id', context.tenantId);
        if (update.error) throw update.error;
        updated += 1;
      }
    }
    const evaluationArtifacts: Array<{ sport: string; format: string; sampleCount: number; status: string }> = [];
    if (req.method === 'POST') {
      const cutoff = '2026-09-08T00:00:00.000Z';
      for (const key of new Set(pairedRows.map((row) => `${row.sport}:${row.role.split(':', 1)[0]}`))) {
        const [sport, format] = key.split(':');
        const rows = pairedRows.filter((row) => row.sport === sport && row.role.startsWith(`${format}:`));
        const evaluation = evaluatePairedProjectionBaseline(rows, cutoff);
        const metrics = evaluation.holdoutBySport[sport] ?? { status: 'NO_HOLDOUT_ROWS', playerRows: 0, independentSlates: 0 };
        const modelVersion = (historicalActuals.data ?? []).find((row) => row.sport === sport && row.contest_format === format)?.model_version ?? 'UNKNOWN';
        const save = await context.db.from('floyd_dfs_model_evaluations').insert({ tenant_id: context.tenantId, sport, contest_format: format, component: 'PROJECTION', model_version: String(modelVersion), baseline_model_version: 'salary-compatible-baseline', candidate_model_version: String(modelVersion), evaluation_window: `[${cutoff},)`, sample_count: Number(metrics.playerRows ?? 0), holdout_name: 'pre-registered-chronological-holdout-2026-09-08', gate_decision: 'HOLD', metrics: { pairedCandidateVsSalaryCompatibleBaseline: metrics, promotionGate: { eligible: false, independentSlates: Number(metrics.independentSlates ?? 0), playerRows: Number(metrics.playerRows ?? 0), reason: 'Projection comparison is descriptive and does not meet the registered game-simulation CRPS plus interval-calibration promotion gate.' }, status: metrics.status, releaseDecision: 'HOLD', releaseReason: 'Evaluation artifact does not automatically approve predictive or financial claims.' }, data_manifest: { tenant: 'floyd-dfs', actualSource: 'official verified final/corrected rows only', forecastTimestamp: 'projection_generated_at strictly before lock_time', split: 'all rows grouped by slate_id; holdout lock time >= cutoff', cutoff, availableSnapshots: 'pre-decision projection package and timestamps; no post-event reconstruction', rowCount: rows.length } });
        if (save.error) throw save.error;
        evaluationArtifacts.push({ sport, format, sampleCount: Number(metrics.playerRows ?? 0), status: String(metrics.status ?? 'UNKNOWN') });
      }
      for (const report of Object.values(gameSimulationValidation.bySportFormat)) {
        const promotionEligible = report.status === 'CRITERIA_MET_REQUIRES_REVIEW';
        const save = await context.db.from('floyd_dfs_model_evaluations').insert({ tenant_id: context.tenantId, sport: report.sport, contest_format: report.format, component: 'SIMULATION', model_version: report.gameSimulationModelVersion, baseline_model_version: report.baselineModelVersion, candidate_model_version: report.gameSimulationModelVersion, evaluation_window: `[${report.cutoff},)`, sample_count: report.holdout.scenarioPlayerRows, holdout_name: 'connected-game-simulation-chronological-holdout-2026-09-08', gate_decision: 'HOLD', metrics: { ...report, promotionGate: { eligible: promotionEligible, independentSlates: report.holdout.gameSimulation.independentSlates, playerRows: report.holdout.gameSimulation.scenarioPlayerRows, reason: promotionEligible ? 'Registered sample, CRPS improvement, and interval-calibration criteria passed; an explicit operator review is still required.' : `Pre-registered criteria not met: ${report.status}.` }, releaseDecision: 'HOLD', releaseReason: 'Game simulation metrics are descriptive; model promotion requires sufficient independent slates, improvement over paired baseline, and independent review.' }, data_manifest: { tenant: 'floyd-dfs', forecastTimestamp: 'projection generated strictly before saved contest lock', actualSource: 'verified final/corrected NBA league stats or nflverse CC BY 4.0 final weekly player stats', split: 'chronological holdout grouped by saved slate ID', cutoff: report.cutoff } });
        if (save.error) throw save.error;
        evaluationArtifacts.push({ sport: report.sport, format: report.format, sampleCount: report.holdout.scenarioPlayerRows, status: report.status });
      }
    }
    cors(req, res); res.status(200).json({ calibration, projectionValidation, gameSimulationValidation, preLockProjectionAudit: projectionAudit, pairedBaseline, evaluationArtifacts, playerActualRows: historicalActuals.data?.length ?? 0, updatedLineups: updated, probabilityRelease: 'DISABLED_PENDING_OUT_OF_SAMPLE_BASELINE_VALIDATION' });
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
  const bySportFormat: Record<string, ReturnType<typeof summarize>> = {};
  for (const key of new Set(rows.map((row) => `${row.sport}:${row.format}`))) bySportFormat[key] = summarize(rows.filter((row) => `${row.sport}:${row.format}` === key));
  return { overall: summarize(rows), bySport, bySportFormat, note: 'Only verified final player actuals and complete official contest outcomes are eligible. Independent slates, not entries, determine validation sample size.' };
}
function coverage(rows: ForecastOutcome[], field: 'p20' | 'p50' | 'p90'): number | null { const available = rows.filter((row) => row[field] !== undefined); return available.length ? available.filter((row) => row.actual <= row[field]!).length / available.length : null; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function optionalFinite(value: unknown, key: 'p20' | 'p50' | 'p90'): Partial<Pick<ForecastOutcome, 'p20' | 'p50' | 'p90'>> { const number = Number(value); return value !== null && value !== undefined && Number.isFinite(number) ? { [key]: number } : {}; }

async function queryAll(makeQuery: (start: number, end: number) => any): Promise<{ data: any[]; error: null }> {
  const data: any[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await makeQuery(start, start + 999);
    if (page.error) throw page.error;
    const rows = (page.data ?? []) as any[];
    data.push(...rows);
    if (rows.length < 1000) return { data, error: null };
  }
}

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

function summarizeGameSimulationValidation(projections: Array<{ id: string; generation_run_id: string; sport: string; model_version: string; projection_package: unknown }>, actualRows: Array<{ projection_run_id: string; generation_run_id: string; player_id: string; sport: string; contest_format: string; slate_id: string; actual_dk_points: number }>, runs: Map<string, { request_payload: unknown }>, cutoffText: string) {
  const cutoff = Date.parse(cutoffText);
  const actualsByProjection = new Map<string, Map<string, (typeof actualRows)[number]>>();
  for (const row of actualRows) { const projectionId = String(row.projection_run_id); const playerId = String(row.player_id); const byPlayer = actualsByProjection.get(projectionId) ?? new Map<string, (typeof actualRows)[number]>(); byPlayer.set(playerId, row); actualsByProjection.set(projectionId, byPlayer); }
  const paired: Array<{ sport: string; format: string; slateId: string; lock: number; gameSamples: number[]; baselineSamples: number[]; actual: number; modelVersion: string }> = [];
  for (const projectionRun of projections) {
    const pkg = asRecord(projectionRun.projection_package); const simulation = asRecord(pkg?.gameSimulation);
    if (!simulation || !['GAME_SIMULATION', 'COMPARE'].includes(String(simulation.mode))) continue;
    const run = runs.get(String(projectionRun.generation_run_id)); const request = asRecord(run?.request_payload); const input = asRecord(request?.input); const slate = asRecord(input?.validatedSlate); const contest = asRecord(slate?.contest);
    const generatedAt = Date.parse(String(pkg?.generatedAt ?? '')); const lock = Date.parse(String(contest?.lockTime ?? ''));
    if (!Number.isFinite(generatedAt) || !Number.isFinite(lock) || generatedAt >= lock || !Number.isFinite(cutoff)) continue;
    const actuals = actualsByProjection.get(String(projectionRun.id)); if (!actuals) continue;
    for (const player of Array.isArray(pkg?.players) ? pkg.players : []) {
      const projection = asRecord(player); if (!projection) continue;
      const playerId = String(projection.playerId ?? ''); const actualRow = actuals.get(playerId); const actual = Number(actualRow?.actual_dk_points);
      const gameSamples = numbers(projection.simulatedFantasyPointSamples); const baselineSamples = numbers(projection.baselineSimulatedFantasyPointSamples);
      if (!Number.isFinite(actual) || gameSamples.length < 30 || baselineSamples.length < 30) continue;
      paired.push({ sport: String(projectionRun.sport).toUpperCase(), format: String(contest?.format ?? 'UNKNOWN').toUpperCase(), slateId: String(actualRow?.slate_id ?? `${String(slate?.slateId ?? '')}:${String(contest?.format ?? '')}`), lock, gameSamples, baselineSamples, actual, modelVersion: String(simulation.modelVersion ?? projectionRun.model_version) });
    }
  }
  const summarizeSamples = (rows: typeof paired, field: 'gameSamples' | 'baselineSamples') => {
    const independentSlates = new Set(rows.map((row) => row.slateId)).size;
    if (!rows.length) return { scenarioPlayerRows: 0, independentSlates: 0, meanAbsoluteError: null, meanBias: null, crps: null, p10Coverage: null, p20Coverage: null, p50Coverage: null, p80Coverage: null, p90Coverage: null };
    const outcomes = rows.map((row) => { const sorted = [...row[field]].sort((a, b) => a - b); const mean = row[field].reduce((sum, value) => sum + value, 0) / row[field].length; return { actual: row.actual, mean, samples: row[field], p05: quantile(sorted, .05), p10: quantile(sorted, .1), p20: quantile(sorted, .2), p25: quantile(sorted, .25), p50: quantile(sorted, .5), p75: quantile(sorted, .75), p80: quantile(sorted, .8), p90: quantile(sorted, .9), p95: quantile(sorted, .95) }; });
    return { scenarioPlayerRows: rows.length, independentSlates, meanAbsoluteError: average(outcomes.map((row) => Math.abs(row.mean - row.actual))), meanBias: average(outcomes.map((row) => row.mean - row.actual)), crps: average(outcomes.map((row) => empiricalCrps(row.samples, row.actual))), p10Coverage: average(outcomes.map((row) => Number(row.actual <= row.p10))), p20Coverage: average(outcomes.map((row) => Number(row.actual <= row.p20))), p50Coverage: average(outcomes.map((row) => Number(row.actual <= row.p50))), p80Coverage: average(outcomes.map((row) => Number(row.actual <= row.p80))), p90Coverage: average(outcomes.map((row) => Number(row.actual <= row.p90))), centralIntervalCoverage: { '50': average(outcomes.map((row) => Number(row.actual >= row.p25 && row.actual <= row.p75))), '80': average(outcomes.map((row) => Number(row.actual >= row.p10 && row.actual <= row.p90))), '90': average(outcomes.map((row) => Number(row.actual >= row.p05 && row.actual <= row.p95))) } };
  };
  const bySportFormat: Record<string, Record<string, any>> = {};
  for (const key of new Set(paired.map((row) => `${row.sport}:${row.format}`))) {
    const [sport, format] = key.split(':');
    const all = paired.filter((row) => row.sport === sport && row.format === format);
    const holdout = all.filter((row) => row.lock >= cutoff); const training = all.filter((row) => row.lock < cutoff);
    const baseline = summarizeSamples(holdout, 'baselineSamples'); const gameSimulation = summarizeSamples(holdout, 'gameSamples');
    const crpsImprovement = Number.isFinite(baseline.crps) && Number(baseline.crps) > 0 ? (Number(baseline.crps) - Number(gameSimulation.crps)) / Number(baseline.crps) : null;
    const enough = gameSimulation.independentSlates >= 30 && gameSimulation.scenarioPlayerRows >= 100;
    const calibrationRegression = (['50', '80', '90'] as const).some((level) => Math.abs(Number(gameSimulation.centralIntervalCoverage?.[level]) - Number(baseline.centralIntervalCoverage?.[level])) > 0.05);
    bySportFormat[key] = { sport, format, cutoff: new Date(cutoff).toISOString(), baselineModelVersion: 'projection.deterministic.v3', gameSimulationModelVersion: all[0]?.modelVersion ?? 'UNKNOWN', train: { baseline: summarizeSamples(training, 'baselineSamples'), gameSimulation: summarizeSamples(training, 'gameSamples') }, holdout: { baseline, gameSimulation, relativeCrpsImprovement: crpsImprovement, materialCalibrationRegression: calibrationRegression }, threshold: { minimumIndependentSlates: 30, minimumPlayerRows: 100, minimumCrpsImprovement: .03, maximumAbsoluteIntervalCoverageRegression: .05 }, status: !enough ? 'INSUFFICIENT_SAMPLE' : crpsImprovement !== null && crpsImprovement >= .03 && !calibrationRegression ? 'CRITERIA_MET_REQUIRES_REVIEW' : 'IMPROVEMENT_THRESHOLD_NOT_MET', releaseDecision: 'HOLD' };
  }
  return { cutoff: new Date(cutoff).toISOString(), pairedPlayerRows: paired.length, bySportFormat, releaseDecision: 'HOLD', note: 'Only final verified player actuals and strictly pre-lock forecasts are included. Paired scenario samples are compared against the saved baseline samples; this report never automatically promotes a model.' };
}
function numbers(value: unknown): number[] { return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []; }
function quantile(values: number[], probability: number): number { if (!values.length) return NaN; const index = (values.length - 1) * probability; const low = Math.floor(index); const high = Math.ceil(index); return values[low] + (values[high] - values[low]) * (index - low); }
function empiricalCrps(samples: number[], actual: number): number { if (!samples.length) return NaN; const first = average(samples.map((sample) => Math.abs(sample - actual))); const sorted = [...samples].sort((a, b) => a - b); const pairwiseHalf = sorted.reduce((sum, value, index) => sum + (2 * index - sorted.length + 1) * value, 0) / (sorted.length * sorted.length); return first - pairwiseHalf; }
