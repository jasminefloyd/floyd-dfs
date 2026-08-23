export interface WnbaRoleMetrics {
  weightedMinutes: number | null;
  weightedFantasyPoints: number | null;
  recentFantasyPerMinute: number | null;
  minutesTrend: 'up' | 'down' | 'stable' | 'unknown';
  minutesVolatility: number | null;
  roleStability: number | null;
  sampleSize: number;
}

export interface WnbaMinutesDistribution {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  standardDeviation: number | null;
  didNotPlayProbability: number | null;
  sampleSize: number;
  drivers: string[];
}

export interface WnbaRolePrior {
  sampleSize: number;
  historicalMinutes: number | null;
  historicalMinutesStddev: number | null;
  replacementMinutesGain: number | null;
  didNotPlayProbability: number | null;
  cohort: 'starter' | 'stable_bench' | 'volatile_bench' | 'returning' | 'elevated' | 'unknown';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function weighted(values: number[]): number | null {
  if (!values.length) return null;
  const weights = [0.4, 0.25, 0.17, 0.11, 0.07];
  const selected = values.slice(0, weights.length);
  const totalWeight = selected.reduce((sum, _value, index) => sum + (weights[index] ?? 0), 0);
  return totalWeight > 0
    ? selected.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / totalWeight
    : null;
}

export function deriveWnbaRoleMetrics(games: Array<Record<string, unknown>>): WnbaRoleMetrics {
  const rows = games.map((game) => ({
    minutes: Number(game.minutes ?? game.avgMinutes),
    fantasyPoints: Number(game.fantasy_points ?? game.fantasy_pts),
  })).filter((row) => finite(row.minutes) && row.minutes > 0 && finite(row.fantasyPoints));
  if (!rows.length) {
    return { weightedMinutes: null, weightedFantasyPoints: null, recentFantasyPerMinute: null, minutesTrend: 'unknown', minutesVolatility: null, roleStability: null, sampleSize: 0 };
  }

  const minutes = rows.map((row) => row.minutes);
  const weightedMinutes = weighted(minutes);
  const weightedFantasyPoints = weighted(rows.map((row) => row.fantasyPoints));
  const recentFantasyPerMinute = weightedMinutes && weightedMinutes > 0 && weightedFantasyPoints !== null
    ? weightedFantasyPoints / weightedMinutes
    : null;
  const recentAverage = average(minutes.slice(0, 2));
  const olderAverage = average(minutes.slice(-2));
  const delta = recentAverage !== null && olderAverage !== null ? recentAverage - olderAverage : 0;
  const minutesTrend = rows.length < 4 || Math.abs(delta) < 2 ? 'stable' : delta > 0 ? 'up' : 'down';
  const mean = average(minutes) ?? 0;
  const variance = mean > 0 ? minutes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / minutes.length : 0;
  const minutesVolatility = mean > 0 ? Math.sqrt(variance) / mean : null;
  const sampleConfidence = Math.min(rows.length / 5, 1);
  const stability = minutesVolatility === null
    ? null
    : Math.max(0, Math.min(1, (1 - Math.min(minutesVolatility, 1)) * 0.75 + sampleConfidence * 0.25));

  return {
    weightedMinutes: weightedMinutes === null ? null : Number(weightedMinutes.toFixed(2)),
    weightedFantasyPoints: weightedFantasyPoints === null ? null : Number(weightedFantasyPoints.toFixed(2)),
    recentFantasyPerMinute: recentFantasyPerMinute === null ? null : Number(recentFantasyPerMinute.toFixed(4)),
    minutesTrend,
    minutesVolatility: minutesVolatility === null ? null : Number(minutesVolatility.toFixed(3)),
    roleStability: stability === null ? null : Number(stability.toFixed(3)),
    sampleSize: rows.length,
  };
}

export function deriveWnbaMinutesDistribution(
  games: Array<Record<string, unknown>>,
  options: {
    confirmedStarter?: boolean;
    injuryStatus?: string;
    depthChartOrder?: number;
    projectedMinutes?: number;
    historicalPrior?: WnbaRolePrior;
    restDays?: number;
    spread?: number;
  } = {},
): WnbaMinutesDistribution {
  const observedMinutes = games.map((game) => Number(game.minutes ?? game.avgMinutes)).filter(finite);
  const minutes = observedMinutes.filter((value) => value > 0);
  const role = deriveWnbaRoleMetrics(games);
  const center = Number.isFinite(options.projectedMinutes)
    ? Number(options.projectedMinutes)
    : role.weightedMinutes ?? options.historicalPrior?.historicalMinutes ?? null;
  const observedDnpRate = observedMinutes.length ? observedMinutes.filter((value) => value <= 0).length / observedMinutes.length : null;
  const didNotPlayProbability = Number.isFinite(Number(options.historicalPrior?.didNotPlayProbability))
    ? Number(options.historicalPrior?.didNotPlayProbability)
    : observedDnpRate;
  if (center === null || !Number.isFinite(center) || center <= 0) return { p10: null, p25: null, p50: null, p75: null, p90: null, standardDeviation: null, didNotPlayProbability, sampleSize: minutes.length, drivers: ['minutes history unavailable'] };
  const observedMean = average(minutes) ?? center;
  const observedVariance = minutes.length > 1 ? minutes.reduce((sum, value) => sum + (value - observedMean) ** 2, 0) / minutes.length : 0;
  let standardDeviation = Math.max(Math.sqrt(observedVariance), Number(options.historicalPrior?.historicalMinutesStddev) || 0, center * 0.09, 2.5);
  const drivers = [`${minutes.length}-game minutes sample`];
  if ((options.historicalPrior?.sampleSize ?? 0) >= 8) drivers.push(`${options.historicalPrior?.sampleSize}-game historical role prior`);
  if (options.confirmedStarter === true) { standardDeviation *= 0.9; drivers.push('confirmed starter reduces role uncertainty'); }
  else if (options.confirmedStarter === false) { standardDeviation *= 1.2; drivers.push('non-starter role increases uncertainty'); }
  if (['questionable', 'day_to_day'].includes(String(options.injuryStatus))) { standardDeviation *= 1.25; drivers.push('injury status increases uncertainty'); }
  if (Number.isFinite(options.depthChartOrder) && Number(options.depthChartOrder) >= 4) { standardDeviation *= 1.1; drivers.push('deep rotation role increases uncertainty'); }
  if (Number.isFinite(options.restDays) && Number(options.restDays) === 0) { standardDeviation *= 1.08; drivers.push('back-to-back increases rotation uncertainty'); }
  if (Math.abs(Number(options.spread)) >= 10) { standardDeviation *= 1.12; drivers.push('large spread increases blowout uncertainty'); }
  const bounded = (z: number) => Number(Math.min(40, Math.max(0, center + z * standardDeviation)).toFixed(2));
  if ((didNotPlayProbability ?? 0) > 0) drivers.push(`separate DNP probability ${(didNotPlayProbability! * 100).toFixed(0)}%`);
  return { p10: bounded(-1.2816), p25: bounded(-0.6745), p50: Number(center.toFixed(2)), p75: bounded(0.6745), p90: bounded(1.2816), standardDeviation: Number(standardDeviation.toFixed(2)), didNotPlayProbability, sampleSize: minutes.length, drivers };
}
