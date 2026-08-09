export interface WnbaMatchupPlayer {
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
  role_stability?: number;
  ownership_projection?: number;
  projected_points?: number;
  actual_points?: number;
  projection_source?: string;
}

export function wnbaMatchupScore(players: WnbaMatchupPlayer[]): number {
  const totals = players.map((player) => Number(player.implied_total)).filter(Number.isFinite);
  const spreads = players.map((player) => Number(player.spread)).filter(Number.isFinite);
  const averageTotal = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
  const averageSpread = spreads.length ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : null;
  const highTotal = averageTotal !== null ? Math.max(0, Math.min(1, (averageTotal - 81) / 8)) : 0;
  const closeGame = averageSpread !== null ? Math.max(0, 1 - Math.abs(averageSpread) / 8) : 0;
  const confirmedRate = players.length ? players.filter((player) => player.confirmed_starter === true).length / players.length : 0;
  const uncertainRate = players.length ? players.filter((player) => player.confirmed_starter === false).length / players.length : 0;
  const stability = players.length
    ? players.reduce((sum, player) => sum + (Number(player.role_stability) || 0), 0) / players.length
    : 0;
  return Number((highTotal * 2.2 + closeGame * 1.2 + confirmedRate * 0.8 + stability * 0.6 - uncertainRate * 1.4).toFixed(2));
}

export function wnbaOwnershipLeverage(player: WnbaMatchupPlayer): number {
  const ownership = Math.max(0.01, Math.min(0.99, Number(player.ownership_projection) || 0.12));
  const projected = Math.max(0, Number(player.projected_points) || 0);
  const actual = Number(player.actual_points);
  const ceilingSignal = Number.isFinite(actual) ? Math.max(0, actual - projected) : projected * 0.15;
  return Number((ceilingSignal / Math.sqrt(ownership)).toFixed(3));
}

export interface WnbaBacktestRow {
  projected_points?: number;
  actual_points?: number;
  ownership_projection?: number;
  role_stability?: number;
  projection_source?: string;
}

export interface WnbaBacktestBucket {
  bucket: string;
  sample_size: number;
  average_projected: number;
  average_actual: number;
  average_error: number;
  mean_absolute_error: number;
}

export function summarizeWnbaBacktest(rows: WnbaBacktestRow[]): WnbaBacktestBucket[] {
  const groups = new Map<string, WnbaBacktestRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(Number(row.projected_points)) || !Number.isFinite(Number(row.actual_points))) continue;
    const stability = Number(row.role_stability);
    const roleBucket = Number.isFinite(stability) ? stability >= 0.7 ? 'stable_role' : stability >= 0.45 ? 'mixed_role' : 'volatile_role' : 'role_unknown';
    const ownership = Number(row.ownership_projection);
    const ownershipBucket = Number.isFinite(ownership) ? ownership >= 0.25 ? 'chalk' : ownership <= 0.1 ? 'leverage' : 'mid_ownership' : 'ownership_unknown';
    const bucket = `${roleBucket}:${ownershipBucket}:${row.projection_source ?? 'source_unknown'}`;
    groups.set(bucket, [...(groups.get(bucket) ?? []), row]);
  }
  return [...groups.entries()].map(([bucket, bucketRows]) => {
    const projected = bucketRows.map((row) => Number(row.projected_points));
    const actual = bucketRows.map((row) => Number(row.actual_points));
    const errors = actual.map((value, index) => value - projected[index]);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      bucket,
      sample_size: bucketRows.length,
      average_projected: Number(mean(projected).toFixed(2)),
      average_actual: Number(mean(actual).toFixed(2)),
      average_error: Number(mean(errors).toFixed(2)),
      mean_absolute_error: Number(mean(errors.map((value) => Math.abs(value))).toFixed(2)),
    };
  }).sort((a, b) => b.sample_size - a.sample_size);
}
