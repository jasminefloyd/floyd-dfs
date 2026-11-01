import { createHash } from 'node:crypto';

export const NBA_SIMULATION_EVALUATION_POLICY = {
  version: 'nba-connected-simulation-evaluation.preregistered.v1',
  minimumHoldoutGames: 30,
  minimumHoldoutPlayerRows: 100,
  minimumMonteCarloDraws: 128,
  maximumQuantileCoverageRegression: 0.05,
} as const;

export interface NbaSimulationEvaluationRow {
  slateId: string; gameId: string; teamId: string; playerId: string;
  projectionGeneratedAt: string; lockTime: string;
  actualSourceVerified: boolean; actualFinality: 'FINAL' | 'CORRECTED' | 'PROVISIONAL' | 'UNKNOWN';
  actualPoints: number; actualMinutes?: number;
  baselineSamples: number[]; candidateSamples: number[];
  baselineMinutesSamples?: number[]; candidateMinutesSamples?: number[];
}
export interface NbaSimulationTeamTotalRow {
  slateId: string; gameId: string; teamId: string; projectionGeneratedAt: string; lockTime: string;
  actualSourceVerified: boolean; actualFinality: NbaSimulationEvaluationRow['actualFinality'];
  actualPoints: number; baselineSamples: number[]; candidateSamples: number[];
}
export interface NbaSimulationLineupRow {
  slateId: string; lineupId: string; projectionGeneratedAt: string; lockTime: string;
  actualSourceVerified: boolean; actualFinality: NbaSimulationEvaluationRow['actualFinality'];
  actualScore: number; baselineSamples: number[]; candidateSamples: number[];
}
export interface NbaSimulationEvaluationDataset {
  holdoutCutoff: string; registeredAt: string;
  simulationVersion: string; projectionVersion: string; seed: string;
  gameScenarioCount: number; fieldSimulationCount: number;
  rows: NbaSimulationEvaluationRow[]; teamTotals: NbaSimulationTeamTotalRow[]; lineups: NbaSimulationLineupRow[];
}

/** Paired holdout evaluator. Connected slate/game components never cross the holdout boundary. */
export function evaluateNbaSimulation(dataset: NbaSimulationEvaluationDataset, evaluatedAt = new Date().toISOString()) {
  const cutoff = Date.parse(dataset.holdoutCutoff); const registered = Date.parse(dataset.registeredAt);
  if (!utc(dataset.holdoutCutoff) || !utc(dataset.registeredAt) || !utc(evaluatedAt) || registered > Date.parse(evaluatedAt) || registered >= cutoff || !dataset.simulationVersion || !dataset.projectionVersion || !dataset.seed) throw new Error('Evaluation requires a preregistered UTC holdout cutoff recorded before the holdout, model versions, and explicit seed.');
  if (dataset.gameScenarioCount < 1 || dataset.fieldSimulationCount < 1) throw new Error('gameScenarioCount and fieldSimulationCount must be positive.');
  const excluded: Record<string, number> = {};
  const validRows = dataset.rows.filter((row) => { const reason = invalidRow(row); if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1; return !reason; });
  const validTeams = dataset.teamTotals.filter((row) => { const reason = invalidAggregate(row, 'TEAM_TOTAL'); if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1; return !reason; });
  const validLineups = dataset.lineups.filter((row) => { const reason = invalidAggregate(row, 'LINEUP'); if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1; return !reason; });
  const partitions = chronologicalPartitions(validRows, validTeams, validLineups, cutoff);
  const isHoldoutSlate = (slateId: string) => partitions.get(slateId) === 'HOLDOUT';
  const training = validRows.filter((row) => !isHoldoutSlate(row.slateId));
  const holdout = validRows.filter((row) => isHoldoutSlate(row.slateId));
  const trainSlates = new Set(training.map((row) => row.slateId)); const holdoutSlates = new Set(holdout.map((row) => row.slateId));
  const baseline = distributionMetrics(holdout, 'baselineSamples'); const candidate = distributionMetrics(holdout, 'candidateSamples');
  const baselineMinutes = minuteMetrics(holdout, 'baselineMinutesSamples'); const candidateMinutes = minuteMetrics(holdout, 'candidateMinutesSamples');
  const holdoutTeams = validTeams.filter((row) => isHoldoutSlate(row.slateId));
  const teamBaseline = aggregateMetrics(holdoutTeams, 'baselineSamples'); const teamCandidate = aggregateMetrics(holdoutTeams, 'candidateSamples');
  const holdoutLineups = validLineups.filter((row) => isHoldoutSlate(row.slateId));
  const holdoutGames = new Set([...holdout.map((row) => row.gameId), ...holdoutTeams.map((row) => row.gameId)]);
  const lineup = lineupMetrics(holdoutLineups);
  const correlations = pairCorrelationMetrics(holdout);
  const quantileRegression = Math.max(coverageRegression(baseline, candidate, 0.1), coverageRegression(baseline, candidate, 0.5), coverageRegression(baseline, candidate, 0.9));
  const enough = holdoutGames.size >= NBA_SIMULATION_EVALUATION_POLICY.minimumHoldoutGames
    && holdout.length >= NBA_SIMULATION_EVALUATION_POLICY.minimumHoldoutPlayerRows
    && holdoutTeams.length > 0 && holdoutLineups.length > 0 && correlations.pairCount > 0
    && lineup.minimumDrawCount >= NBA_SIMULATION_EVALUATION_POLICY.minimumMonteCarloDraws
    && candidateMinutes.rows > 0 && baselineMinutes.rows > 0;
  const noRegression = candidate.mae <= baseline.mae
    && quantileRegression <= NBA_SIMULATION_EVALUATION_POLICY.maximumQuantileCoverageRegression
    && teamCandidate.mae <= teamBaseline.mae
    && lineup.candidateTailAbsoluteError <= lineup.baselineTailAbsoluteError
    && correlations.candidateMeanAbsoluteCorrelationError <= correlations.baselineMeanAbsoluteCorrelationError;
  const eligible = enough && noRegression;
  const report = {
    policy: NBA_SIMULATION_EVALUATION_POLICY, registeredAt: dataset.registeredAt, holdoutCutoff: new Date(cutoff).toISOString(), evaluatedAt,
    simulationVersion: dataset.simulationVersion, projectionVersion: dataset.projectionVersion, seed: dataset.seed,
    settings: { gameScenarioCount: dataset.gameScenarioCount, fieldSimulationCount: dataset.fieldSimulationCount },
    training: { playerRows: training.length, independentSlates: trainSlates.size },
    holdout: { playerRows: holdout.length, independentSlates: holdoutSlates.size, independentGames: holdoutGames.size, teamRows: holdoutTeams.length, lineupRows: holdoutLineups.length },
    baseline, candidate, minutes: { baseline: baselineMinutes, candidate: candidateMinutes },
    teamTotals: { baseline: teamBaseline, candidate: teamCandidate }, lineup, pairCorrelations: correlations,
    maximumQuantileCoverageRegression: quantileRegression, excludedRows: excluded,
    decision: eligible ? 'ELIGIBLE_FOR_REVIEW' as const : 'HOLD' as const,
    reason: eligible ? 'Sample and paired calibration checks passed; named human review is still required.' : 'Missing holdout evidence, insufficient independent samples, high Monte Carlo uncertainty, or a paired calibration regression keeps this simulation on HOLD.',
    releaseDecision: 'HUMAN_REVIEW_REQUIRED' as const,
  };
  return { ...report, datasetSha256: sha256(dataset), evaluationSha256: sha256(report) };
}

function invalidRow(row: NbaSimulationEvaluationRow): string | undefined {
  if (!row.actualSourceVerified || !['FINAL', 'CORRECTED'].includes(row.actualFinality)) return 'ACTUAL_NOT_VERIFIED_FINAL';
  if (!row.slateId || !row.gameId || !row.teamId || !row.playerId) return 'MISSING_GROUP_IDENTITY';
  const generated = Date.parse(row.projectionGeneratedAt); const lock = Date.parse(row.lockTime);
  if (!Number.isFinite(generated) || !Number.isFinite(lock) || generated >= lock) return 'INVALID_OR_POST_LOCK_PROJECTION';
  if (!Number.isFinite(row.actualPoints)) return 'INVALID_PAIRED_DISTRIBUTION';
  const distributionError = pairedDistributionError(row.baselineSamples, row.candidateSamples);
  if (distributionError) return distributionError;
  if (row.actualMinutes !== undefined && (!Number.isFinite(row.actualMinutes) || row.actualMinutes < 0)) return 'INVALID_ACTUAL_MINUTES';
  return undefined;
}
function invalidAggregate(row: NbaSimulationTeamTotalRow | NbaSimulationLineupRow, kind: 'TEAM_TOTAL' | 'LINEUP'): string | undefined {
  if (!row.actualSourceVerified || !['FINAL', 'CORRECTED'].includes(row.actualFinality)) return 'AGGREGATE_ACTUAL_NOT_VERIFIED_FINAL';
  if (!row.slateId || ('teamId' in row ? !row.gameId || !row.teamId : !row.lineupId)) return 'AGGREGATE_MISSING_IDENTITY';
  if (!utc(row.projectionGeneratedAt) || !utc(row.lockTime) || Date.parse(row.projectionGeneratedAt) >= Date.parse(row.lockTime)) return 'AGGREGATE_INVALID_OR_POST_LOCK_PROJECTION';
  const actual = 'actualPoints' in row ? row.actualPoints : row.actualScore;
  if (!Number.isFinite(actual)) return 'AGGREGATE_INVALID_ACTUAL';
  return pairedDistributionError(row.baselineSamples, row.candidateSamples) ?? (kind === 'TEAM_TOTAL' && !('teamId' in row) ? 'AGGREGATE_MISSING_IDENTITY' : undefined);
}
function pairedDistributionError(baseline: number[], candidate: number[]): string | undefined {
  if (!finiteSamples(baseline) || !finiteSamples(candidate)) return 'INVALID_PAIRED_DISTRIBUTION';
  if (baseline.length !== candidate.length || baseline.length < NBA_SIMULATION_EVALUATION_POLICY.minimumMonteCarloDraws) return 'UNPAIRED_OR_INSUFFICIENT_MONTE_CARLO_DRAWS';
  return undefined;
}
function chronologicalPartitions(rows: NbaSimulationEvaluationRow[], teams: NbaSimulationTeamTotalRow[], lineups: NbaSimulationLineupRow[], cutoff: number): Map<string, 'TRAIN' | 'HOLDOUT'> {
  const parent = new Map<string, string>();
  const find = (key: string): string => { const prior = parent.get(key); if (!prior) { parent.set(key, key); return key; } if (prior === key) return key; const root = find(prior); parent.set(key, root); return root; };
  const union = (left: string, right: string) => { const a = find(left); const b = find(right); if (a !== b) parent.set(b, a); };
  for (const row of [...rows, ...teams]) union(`S:${row.slateId}`, `G:${row.gameId}`);
  for (const row of lineups) find(`S:${row.slateId}`);
  const cutoffByRoot = new Map<string, number>();
  for (const row of [...rows, ...teams, ...lineups]) {
    const root = find(`S:${row.slateId}`);
    cutoffByRoot.set(root, Math.max(cutoffByRoot.get(root) ?? Number.NEGATIVE_INFINITY, Date.parse(row.lockTime)));
  }
  const result = new Map<string, 'TRAIN' | 'HOLDOUT'>();
  for (const row of [...rows, ...teams, ...lineups]) {
    const root = find(`S:${row.slateId}`);
    result.set(row.slateId, (cutoffByRoot.get(root) ?? Number.NEGATIVE_INFINITY) >= cutoff ? 'HOLDOUT' : 'TRAIN');
  }
  return result;
}
function distributionMetrics(rows: NbaSimulationEvaluationRow[], key: 'baselineSamples' | 'candidateSamples') {
  const errors = rows.map((row) => mean(row[key]) - row.actualPoints); const variances = rows.map((row) => variance(row[key]));
  const coverage = (p: number) => rows.length ? rows.filter((row) => row.actualPoints <= quantile(row[key], p)).length / rows.length : null;
  const monteCarloStandardErrors = rows.map((row) => Math.sqrt(variance(row[key]) / row[key].length));
  return { rows: rows.length, mae: mae(errors), rmse: errors.length ? Math.sqrt(mean(errors.map((value) => value ** 2))) : 0, bias: mean(errors), predictedVariance: mean(variances), meanMonteCarloStandardError: mean(monteCarloStandardErrors), maximumMonteCarloStandardError: monteCarloStandardErrors.length ? Math.max(...monteCarloStandardErrors) : 0, p10Coverage: coverage(0.1), p50Coverage: coverage(0.5), p90Coverage: coverage(0.9) };
}
function minuteMetrics(rows: NbaSimulationEvaluationRow[], key: 'baselineMinutesSamples' | 'candidateMinutesSamples') { const valid = rows.filter((row) => row.actualMinutes !== undefined && finiteSamples(row[key])); const errors = valid.map((row) => mean(row[key]!) - row.actualMinutes!); return { rows: valid.length, mae: mae(errors), bias: mean(errors) }; }
function aggregateMetrics(rows: NbaSimulationTeamTotalRow[], key: 'baselineSamples' | 'candidateSamples') { const errors = rows.map((row) => mean(row[key]) - row.actualPoints); return { rows: rows.length, mae: mae(errors), rmse: errors.length ? Math.sqrt(mean(errors.map((value) => value ** 2))) : 0, bias: mean(errors), p10Coverage: coverage(rows, key, 0.1), p50Coverage: coverage(rows, key, 0.5), p90Coverage: coverage(rows, key, 0.9) }; }
function lineupMetrics(rows: NbaSimulationLineupRow[]) {
  const paired = rows.filter((row) => row.baselineSamples.length === row.candidateSamples.length && row.baselineSamples.length > 0);
  const drawCount = paired.length ? Math.min(...paired.map((row) => row.baselineSamples.length)) : 0;
  const baselineTailAbsoluteError = mean(paired.map((row) => Math.abs(quantile(row.baselineSamples, 0.1) - row.actualScore)));
  const candidateTailAbsoluteError = mean(paired.map((row) => Math.abs(quantile(row.candidateSamples, 0.1) - row.actualScore)));
  const differences = paired.flatMap((row) => Array.from({ length: row.baselineSamples.length }, (_, index) => row.candidateSamples[index]! - row.baselineSamples[index]!));
  return { rows: paired.length, minimumDrawCount: drawCount, baselineTailAbsoluteError, candidateTailAbsoluteError, pairedMeanScoreDelta: mean(differences), monteCarloStandardError: differences.length ? Math.sqrt(variance(differences) / differences.length) : 0, candidateP10Coverage: paired.length ? paired.filter((row) => row.actualScore <= quantile(row.candidateSamples, 0.1)).length / paired.length : null, baselineP10Coverage: paired.length ? paired.filter((row) => row.actualScore <= quantile(row.baselineSamples, 0.1)).length / paired.length : null };
}
function pairCorrelationMetrics(rows: NbaSimulationEvaluationRow[]) {
  const byPair = new Map<string, Array<{ actualA: number; actualB: number; baseline: number; candidate: number }>>();
  const byGame = new Map<string, NbaSimulationEvaluationRow[]>();
  for (const row of rows) byGame.set(`${row.slateId}:${row.gameId}`, [...(byGame.get(`${row.slateId}:${row.gameId}`) ?? []), row]);
  for (const gameRows of byGame.values()) for (let i = 0; i < gameRows.length; i++) for (let j = i + 1; j < gameRows.length; j++) {
    const a = gameRows[i]!; const b = gameRows[j]!;
    if (a.teamId !== b.teamId) continue;
    const baselineCorrelation = sampleCorrelation(a.baselineSamples, b.baselineSamples); const candidateCorrelation = sampleCorrelation(a.candidateSamples, b.candidateSamples);
    if (baselineCorrelation === null || candidateCorrelation === null) continue;
    const ids = [a.playerId, b.playerId].sort(); const key = `${a.gameId}:${ids.join(':')}`;
    byPair.set(key, [...(byPair.get(key) ?? []), { actualA: a.actualPoints, actualB: b.actualPoints, baseline: baselineCorrelation, candidate: candidateCorrelation }]);
  }
  const observed = [...byPair.values()].filter((values) => values.length >= 3).flatMap((values) => {
    const actual = sampleCorrelation(values.map((value) => value.actualA), values.map((value) => value.actualB));
    return actual === null ? [] : [{ actual, baseline: mean(values.map((value) => value.baseline)), candidate: mean(values.map((value) => value.candidate)), samples: values.length }];
  });
  return { pairCount: observed.length, meanObservationsPerPair: mean(observed.map((row) => row.samples)), baselineMeanAbsoluteCorrelationError: mean(observed.map((row) => Math.abs(row.baseline - row.actual))), candidateMeanAbsoluteCorrelationError: mean(observed.map((row) => Math.abs(row.candidate - row.actual))) };
}
function coverage(rows: NbaSimulationTeamTotalRow[], key: 'baselineSamples' | 'candidateSamples', p: number) { return rows.length ? rows.filter((row) => row.actualPoints <= quantile(row[key], p)).length / rows.length : null; }
function coverageRegression(before: { p10Coverage: number | null; p50Coverage: number | null; p90Coverage: number | null }, after: { p10Coverage: number | null; p50Coverage: number | null; p90Coverage: number | null }, target: 0.1 | 0.5 | 0.9): number { const beforeValue = target === 0.1 ? before.p10Coverage : target === 0.5 ? before.p50Coverage : before.p90Coverage; const afterValue = target === 0.1 ? after.p10Coverage : target === 0.5 ? after.p50Coverage : after.p90Coverage; if (beforeValue === null || afterValue === null) return Number.POSITIVE_INFINITY; return Math.abs(afterValue - target) - Math.abs(beforeValue - target); }
function finiteSamples(values: number[] | undefined): values is number[] { return Array.isArray(values) && values.length > 0 && values.every(Number.isFinite); }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function mae(values: number[]) { return mean(values.map(Math.abs)); }
function variance(values: number[]) { if (values.length < 2) return 0; const average = mean(values); return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1); }
function quantile(values: number[], p: number) { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return 0; const index = (sorted.length - 1) * p; const low = Math.floor(index); const high = Math.ceil(index); return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low); }
function sampleCorrelation(a: number[], b: number[]): number | null { const length = Math.min(a.length, b.length); if (length < 2) return null; const meanA = mean(a.slice(0, length)); const meanB = mean(b.slice(0, length)); const covariance = mean(a.slice(0, length).map((value, index) => (value - meanA) * (b[index]! - meanB))); const sdA = Math.sqrt(variance(a.slice(0, length))); const sdB = Math.sqrt(variance(b.slice(0, length))); return sdA && sdB ? covariance / (sdA * sdB) : null; }
function utc(value: string): boolean { return Number.isFinite(Date.parse(value)) && /(?:Z|\+00:00)$/i.test(value); }
function sha256(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
