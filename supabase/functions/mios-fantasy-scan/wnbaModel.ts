export interface WnbaRoleMetrics {
  weightedMinutes: number | null;
  weightedFantasyPoints: number | null;
  recentFantasyPerMinute: number | null;
  minutesTrend: 'up' | 'down' | 'stable' | 'unknown';
  minutesVolatility: number | null;
  roleStability: number | null;
  sampleSize: number;
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
