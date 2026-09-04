import type { PlayerProjection, ProjectionPackage, Sport } from './contracts.js';

/** A pre-lock observation joined to the projection by the caller's verified player id. */
export interface ProjectionObservation {
  playerId: string;
  actualFantasyPoints: number;
  actualComponents?: Record<string, number>;
  actualRank?: number;
  actualTeam?: string;
  actualPosition?: string;
}

export interface PreLockBacktestRow {
  projectionGeneratedAt: string;
  lockTime: string;
  observation: ProjectionObservation;
}

export interface LineupBacktestObservation {
  lineupId: string;
  generatedScore: number;
  actualScore: number;
  legalUniverseOptimalActualScore?: number;
  cashLine?: number;
  actualRank?: number;
  fieldSize?: number;
}

export interface LineupBacktestMetrics {
  sampleSize: number;
  meanActualScore: number;
  cashRate?: number;
  topTenPercentRate?: number;
  topOnePercentRate?: number;
  meanRegret?: number;
  meanRankPercentile?: number;
}

export interface CalibrationMetrics {
  sport: Sport;
  sampleSize: number;
  fantasyPointMae: number;
  fantasyPointRmse: number;
  fantasyPointBias: number;
  p20Coverage: number;
  p50Coverage: number;
  p90Coverage: number;
  rankCorrelation?: number;
  componentMae: Record<string, number>;
  byRole: Record<string, { sampleSize: number; fantasyPointMae: number; fantasyPointBias: number }>;
}

/** Returns data-integrity errors before a historical backtest is evaluated. */
export function validatePreLockBacktestRows(rows: PreLockBacktestRow[]): string[] {
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    const generated = Date.parse(row.projectionGeneratedAt);
    const lock = Date.parse(row.lockTime);
    if (!Number.isFinite(generated) || !Number.isFinite(lock)) errors.push(`row ${index} has an invalid projection or lock timestamp.`);
    else if (generated >= lock) errors.push(`row ${index} was generated at or after lock and is excluded from a pre-lock backtest.`);
  }
  return errors;
}

/** Evaluates generated lineups without inventing contest results or optimal scores. */
export function evaluateLineupBacktest(rows: LineupBacktestObservation[]): LineupBacktestMetrics {
  const valid = rows.filter((row) => Number.isFinite(row.generatedScore) && Number.isFinite(row.actualScore));
  const withCash = valid.filter((row) => Number.isFinite(row.cashLine));
  const withRank = valid.filter((row) => Number.isFinite(row.actualRank) && Number.isFinite(row.fieldSize) && row.fieldSize! > 0);
  return { sampleSize: valid.length, meanActualScore: mean(valid.map((row) => row.actualScore)), cashRate: withCash.length ? withCash.filter((row) => row.actualScore >= row.cashLine!).length / withCash.length : undefined, topTenPercentRate: withRank.length ? withRank.filter((row) => row.actualRank! / row.fieldSize! <= 0.1).length / withRank.length : undefined, topOnePercentRate: withRank.length ? withRank.filter((row) => row.actualRank! / row.fieldSize! <= 0.01).length / withRank.length : undefined, meanRegret: valid.some((row) => Number.isFinite(row.legalUniverseOptimalActualScore)) ? mean(valid.flatMap((row) => Number.isFinite(row.legalUniverseOptimalActualScore) ? [row.legalUniverseOptimalActualScore! - row.actualScore] : [])) : undefined, meanRankPercentile: withRank.length ? mean(withRank.map((row) => 1 - (row.actualRank! - 1) / Math.max(1, row.fieldSize! - 1))) : undefined };
}

export interface BaselineResult { name: 'PROVIDER_FPPG' | 'SEASON_AVERAGE' | 'RANDOM_LEGAL' | 'VALUE_OPTIMIZER' | 'FULL_ENGINE'; actualScores: number[]; }

/** Compares named historical baselines; callers must supply pre-lock generated results. */
export function compareBaselines(results: BaselineResult[]): Record<string, { sampleSize: number; meanActualScore: number }> {
  return Object.fromEntries(results.map((result) => [result.name, { sampleSize: result.actualScores.length, meanActualScore: mean(result.actualScores.filter(Number.isFinite)) }]));
}

/**
 * Computes calibration metrics from a pre-lock projection package and verified outcomes.
 * This function does not fetch data, infer missing outcomes, or permit post-lock joins.
 * The caller owns the historical-data and leakage controls.
 */
export function evaluateProjectionCalibration(projection: ProjectionPackage, observations: ProjectionObservation[]): CalibrationMetrics {
  const byId = new Map(projection.players.map((player) => [player.playerId, player]));
  const rows = observations.flatMap((observation) => {
    const player = byId.get(observation.playerId);
    return player && Number.isFinite(observation.actualFantasyPoints) ? [{ player, observation }] : [];
  });
  const errors = rows.map(({ player, observation }) => observation.actualFantasyPoints - player.projectedOutcomes.medianP50);
  const abs = errors.map(Math.abs);
  const squared = errors.map((error) => error * error);
  const componentErrors: Record<string, number[]> = {};
  for (const { player, observation } of rows) for (const [key, actual] of Object.entries(observation.actualComponents ?? {})) {
    const predicted = player.componentProjection[key];
    if (Number.isFinite(actual) && Number.isFinite(predicted)) (componentErrors[key] ??= []).push(Math.abs(actual - predicted));
  }
  const componentMae = Object.fromEntries(Object.entries(componentErrors).map(([key, values]) => [key, mean(values)]));
  const roles = new Map<string, number[]>();
  for (const { player, observation } of rows) {
    const role = observation.actualPosition ?? 'UNKNOWN';
    let roleErrors = roles.get(role);
    if (!roleErrors) { roleErrors = []; roles.set(role, roleErrors); }
    roleErrors.push(observation.actualFantasyPoints - player.projectedOutcomes.medianP50);
  }
  const byRole = Object.fromEntries([...roles.entries()].map(([role, roleErrors]) => [role, { sampleSize: roleErrors.length, fantasyPointMae: mean(roleErrors.map(Math.abs)), fantasyPointBias: mean(roleErrors) }]));
  const ranked = rows.filter(({ observation }) => Number.isFinite(observation.actualRank));
  const rankCorrelation = ranked.length >= 2 ? spearman(ranked.map(({ player }) => player.projectedOutcomes.medianP50), ranked.map(({ observation }) => observation.actualRank!)) : undefined;
  return { sport: projection.sport, sampleSize: rows.length, fantasyPointMae: mean(abs), fantasyPointRmse: Math.sqrt(mean(squared)), fantasyPointBias: mean(errors), p20Coverage: quantileCoverage(rows, (player) => player.projectedOutcomes.floorP20), p50Coverage: quantileCoverage(rows, (player) => player.projectedOutcomes.medianP50), p90Coverage: quantileCoverage(rows, (player) => player.projectedOutcomes.ceilingP90), rankCorrelation, componentMae, byRole };
}

function quantileCoverage(rows: Array<{ player: PlayerProjection; observation: ProjectionObservation }>, quantile: (player: PlayerProjection) => number): number { return rows.length ? rows.filter(({ player, observation }) => observation.actualFantasyPoints <= quantile(player)).length / rows.length : 0; }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function spearman(left: number[], right: number[]): number { const a = ranks(left); const b = ranks(right); const aMean = mean(a); const bMean = mean(b); const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0); const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - aMean) ** 2, 0) * b.reduce((sum, value) => sum + (value - bMean) ** 2, 0)); return denominator ? numerator / denominator : 0; }
function ranks(values: number[]): number[] { return values.map((value) => 1 + values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2); }
