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

export interface WnbaWalkForwardPlayerRow extends WnbaBacktestRow {
  contest_date: string;
  contest_type: string;
  contest_id?: string | null;
  salary?: number | null;
  position?: string | null;
  injury_status?: string | null;
  confirmed_starter?: boolean | null;
  minutes_projection?: number | null;
  actual_minutes?: number | null;
}

export interface WnbaWalkForwardLineupRow {
  contest_date: string;
  contest_type: string;
  contest_id?: string | null;
  contest_strategy?: string | null;
  lineup_mode?: string | null;
  field_size?: number | null;
  entry_fee?: number | null;
  payout?: number | null;
  finish_rank?: number | null;
  projected_points?: number | null;
  actual_points?: number | null;
  actual_duplicates?: number | null;
}

export interface WnbaWalkForwardMetric {
  bucket: string;
  sample_size: number;
  average_projected: number | null;
  average_actual: number | null;
  average_error: number | null;
  mean_absolute_error: number | null;
  rmse: number | null;
  rank_correlation: number | null;
}

export interface WnbaWalkForwardLineupMetric {
  bucket: string;
  sample_size: number;
  average_projected: number | null;
  average_actual: number | null;
  mean_absolute_error: number | null;
  top_10_rate: number | null;
  top_1_rate: number | null;
  cash_rate: number | null;
  roi: number | null;
  duplication_coverage: number;
}

export interface WnbaWalkForwardScorecard {
  player_metrics: WnbaWalkForwardMetric[];
  lineup_metrics: WnbaWalkForwardLineupMetric[];
  coverage: {
    player_rows: number;
    lineup_rows: number;
    player_rows_with_projection_and_actual: number;
    lineup_rows_with_projection_and_actual: number;
    lineup_rows_with_finish_rank_and_field_size: number;
    lineup_rows_with_entry_fee_and_payout: number;
    lineup_rows_with_cash_line: number;
    lineup_rows_with_actual_duplicates: number;
  };
}

function rounded(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(4));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function salaryTier(salary: number | null | undefined): string {
  const value = Number(salary);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  if (value < 5500) return 'value';
  if (value < 8000) return 'mid';
  return 'premium';
}

function playerBuckets(row: WnbaWalkForwardPlayerRow): Array<[string, string]> {
  const roleStability = Number(row.role_stability);
  const role = Number.isFinite(roleStability)
    ? roleStability >= 0.7 ? 'stable_role' : roleStability >= 0.45 ? 'mixed_role' : 'volatile_role'
    : 'role_unknown';
  const starter = row.confirmed_starter === true ? 'starter' : row.confirmed_starter === false ? 'non_starter' : 'starter_unknown';
  const dimensions: Array<[string, string]> = [
    ['overall', 'overall'],
    ['projection_source', row.projection_source ?? 'source_unknown'],
    ['salary_tier', salaryTier(row.salary)],
    ['position', row.position ?? 'position_unknown'],
    ['role', role],
    ['starter_status', starter],
    ['injury_status', row.injury_status ?? 'status_unknown'],
    ['contest_type', row.contest_type || 'contest_unknown'],
  ];
  return dimensions.map(([dimension, value]) => [dimension, `${dimension}:${value}`]);
}

function rank(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array.from({ length: values.length }, () => 0);
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[start].value) end += 1;
    const midpoint = (start + end) / 2 + 1;
    for (let index = start; index <= end; index += 1) ranks[sorted[index].index] = midpoint;
    start = end + 1;
  }
  return ranks;
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length !== a.length) return null;
  const aMean = a.reduce((sum, value) => sum + value, 0) / a.length;
  const bMean = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0);
  const aVariance = a.reduce((sum, value) => sum + (value - aMean) ** 2, 0);
  const bVariance = b.reduce((sum, value) => sum + (value - bMean) ** 2, 0);
  if (aVariance <= 0 || bVariance <= 0) return null;
  return numerator / Math.sqrt(aVariance * bVariance);
}

function buildPlayerMetric(bucket: string, rows: WnbaWalkForwardPlayerRow[]): WnbaWalkForwardMetric {
  const usable = rows.filter((row) => Number.isFinite(Number(row.projected_points)) && Number.isFinite(Number(row.actual_points)));
  const projected = usable.map((row) => Number(row.projected_points));
  const actual = usable.map((row) => Number(row.actual_points));
  const errors = actual.map((value, index) => value - projected[index]);
  const slateGroups = new Map<string, Array<{ projected: number; actual: number }>>();
  usable.forEach((row) => {
    const key = `${row.contest_date}:${row.contest_type}:${row.contest_id ?? ''}`;
    slateGroups.set(key, [...(slateGroups.get(key) ?? []), { projected: Number(row.projected_points), actual: Number(row.actual_points) }]);
  });
  const slateCorrelations = [...slateGroups.values()]
    .map((slateRows) => correlation(rank(slateRows.map((row) => row.projected)), rank(slateRows.map((row) => row.actual))))
    .filter((value): value is number => value !== null);
  return {
    bucket,
    sample_size: usable.length,
    average_projected: rounded(average(projected)),
    average_actual: rounded(average(actual)),
    average_error: rounded(average(errors)),
    mean_absolute_error: rounded(average(errors.map((value) => Math.abs(value)))),
    rmse: rounded(errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length) : null),
    rank_correlation: rounded(average(slateCorrelations)),
  };
}

function lineupBucket(row: WnbaWalkForwardLineupRow): string[] {
  return [
    'overall',
    `contest_type:${row.contest_type || 'contest_unknown'}`,
    `contest_strategy:${row.contest_strategy || 'strategy_unknown'}`,
    `lineup_mode:${row.lineup_mode || 'mode_unknown'}`,
  ];
}

function buildLineupMetric(bucket: string, rows: WnbaWalkForwardLineupRow[]): WnbaWalkForwardLineupMetric {
  const scored = rows.filter((row) => Number.isFinite(Number(row.projected_points)) && Number.isFinite(Number(row.actual_points)));
  const projected = scored.map((row) => Number(row.projected_points));
  const actual = scored.map((row) => Number(row.actual_points));
  const fees = rows.filter((row) => Number.isFinite(Number(row.entry_fee))).map((row) => Number(row.entry_fee));
  const payouts = rows.filter((row) => Number.isFinite(Number(row.entry_fee)) && Number.isFinite(Number(row.payout)));
  const ranked = rows.filter((row) => Number.isFinite(Number(row.finish_rank)) && Number(row.field_size) > 1);
  const top10 = ranked.filter((row) => Number(row.finish_rank) <= Number(row.field_size) * 0.1).length;
  const top1 = ranked.filter((row) => Number(row.finish_rank) <= Number(row.field_size) * 0.01).length;
  return {
    bucket,
    sample_size: scored.length,
    average_projected: rounded(average(projected)),
    average_actual: rounded(average(actual)),
    mean_absolute_error: rounded(average(actual.map((value, index) => Math.abs(value - projected[index])))),
    top_10_rate: ranked.length ? rounded(top10 / ranked.length) : null,
    top_1_rate: ranked.length ? rounded(top1 / ranked.length) : null,
    cash_rate: null,
    roi: payouts.length && fees.length ? rounded((payouts.reduce((sum, row) => sum + Number(row.payout), 0) - payouts.reduce((sum, row) => sum + Number(row.entry_fee), 0)) / payouts.reduce((sum, row) => sum + Number(row.entry_fee), 0)) : null,
    duplication_coverage: rows.length ? rows.filter((row) => Number.isFinite(Number(row.actual_duplicates))).length / rows.length : 0,
  };
}

export function buildWnbaWalkForwardScorecard(
  playerRows: WnbaWalkForwardPlayerRow[],
  lineupRows: WnbaWalkForwardLineupRow[],
): WnbaWalkForwardScorecard {
  const playerGroups = new Map<string, WnbaWalkForwardPlayerRow[]>();
  for (const row of playerRows) {
    for (const [, bucket] of playerBuckets(row)) playerGroups.set(bucket, [...(playerGroups.get(bucket) ?? []), row]);
  }
  const lineupGroups = new Map<string, WnbaWalkForwardLineupRow[]>();
  for (const row of lineupRows) {
    for (const bucket of lineupBucket(row)) lineupGroups.set(bucket, [...(lineupGroups.get(bucket) ?? []), row]);
  }
  const lineupWithProjectionAndActual = lineupRows.filter((row) => Number.isFinite(Number(row.projected_points)) && Number.isFinite(Number(row.actual_points)));
  return {
    player_metrics: [...playerGroups.entries()].map(([bucket, rows]) => buildPlayerMetric(bucket, rows)).sort((a, b) => b.sample_size - a.sample_size),
    lineup_metrics: [...lineupGroups.entries()].map(([bucket, rows]) => buildLineupMetric(bucket, rows)).sort((a, b) => b.sample_size - a.sample_size),
    coverage: {
      player_rows: playerRows.length,
      lineup_rows: lineupRows.length,
      player_rows_with_projection_and_actual: playerRows.filter((row) => Number.isFinite(Number(row.projected_points)) && Number.isFinite(Number(row.actual_points))).length,
      lineup_rows_with_projection_and_actual: lineupWithProjectionAndActual.length,
      lineup_rows_with_finish_rank_and_field_size: lineupRows.filter((row) => Number.isFinite(Number(row.finish_rank)) && Number(row.field_size) > 1).length,
      lineup_rows_with_entry_fee_and_payout: lineupRows.filter((row) => Number.isFinite(Number(row.entry_fee)) && Number.isFinite(Number(row.payout))).length,
      lineup_rows_with_cash_line: 0,
      lineup_rows_with_actual_duplicates: lineupRows.filter((row) => Number.isFinite(Number(row.actual_duplicates))).length,
    },
  };
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
