export interface MlbForensicPlayerRow {
  contest_date?: string;
  contest_type?: string;
  contest_id?: string | null;
  player_id?: string | null;
  player_name: string;
  team?: string | null;
  position?: string | null;
  projected_points?: number | null;
  actual_points?: number | null;
  projection_source?: string | null;
  batting_order?: number | null;
  confirmed_starter?: boolean | null;
  ownership_projection?: number | null;
  actual_ownership?: number | null;
}

export interface MlbForensicLineupPlayer {
  player_id?: string | null;
  player_name?: string | null;
  team?: string | null;
  position?: string | null;
  projected_points?: number | null;
  actual_points?: number | null;
  ownership_projection?: number | null;
  actual_ownership?: number | null;
  batting_order?: number | null;
  confirmed_starter?: boolean | null;
  projection_source?: string | null;
}

export interface MlbForensicLineupRow {
  contest_date?: string;
  contest_type?: string;
  contest_id?: string | null;
  contest_strategy?: string | null;
  lineup_mode?: string | null;
  field_size?: number | null;
  entry_fee?: number | null;
  payout?: number | null;
  finish_rank?: number | null;
  cash_line?: number | null;
  projected_points?: number | null;
  actual_points?: number | null;
  optimal_points?: number | null;
  pct_of_optimal?: number | null;
  actual_duplicates?: number | null;
  optimizer_rank?: number | null;
  rank_score?: number | null;
  simulation_ev?: number | null;
  top_n_rate?: number | null;
  expected_payout?: number | null;
  players: MlbForensicLineupPlayer[];
}

export interface MlbForensicMetric {
  bucket: string;
  sample_size: number;
  average_projected: number | null;
  average_actual: number | null;
  average_error: number | null;
  mean_absolute_error: number | null;
  rmse: number | null;
}

export interface MlbForensicScorecard {
  player_metrics: MlbForensicMetric[];
  pitcher_metrics: MlbForensicMetric[];
  primary_stack_metrics: MlbForensicMetric[];
  secondary_stack_metrics: MlbForensicMetric[];
  lineup_metrics: Array<{
    bucket: string;
    sample_size: number;
    average_projected: number | null;
    average_actual: number | null;
    mean_absolute_error: number | null;
    top_20_rate: number | null;
    top_1_percent_rate: number | null;
    first_place_rate: number | null;
    cash_rate: number | null;
    roi: number | null;
    duplication_coverage: number;
    optimal_points_coverage: number;
    average_pct_of_optimal: number | null;
  }>;
  coverage: {
    player_rows: number;
    player_rows_with_projection_and_actual: number;
    lineup_rows: number;
    lineup_rows_with_projection_and_actual: number;
    lineup_rows_with_finish_and_field: number;
    lineup_rows_with_cash_line: number;
    lineup_rows_with_entry_fee_and_payout: number;
    lineup_rows_with_actual_ownership: number;
    lineup_rows_with_candidate_metadata: number;
    lineup_rows_with_simulation_metadata: number;
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rounded(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(4));
}

function isPitcher(player: { position?: string | null }): boolean {
  return /^(P|SP|RP)$/i.test(String(player.position ?? '').trim());
}

function normalizeName(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function teamStacks(players: MlbForensicLineupPlayer[]): Array<{ team: string; players: MlbForensicLineupPlayer[] }> {
  const byTeam = new Map<string, MlbForensicLineupPlayer[]>();
  for (const player of players.filter((candidate) => !isPitcher(candidate))) {
    const team = String(player.team ?? '').toUpperCase();
    if (team) byTeam.set(team, [...(byTeam.get(team) ?? []), player]);
  }
  return [...byTeam.entries()]
    .map(([team, stackPlayers]) => ({ team, players: stackPlayers }))
    .sort((a, b) => b.players.length - a.players.length);
}

function metric(bucket: string, rows: Array<{ projected_points?: number | null; actual_points?: number | null }>): MlbForensicMetric {
  const usable = rows.filter((row) => finite(row.projected_points) && finite(row.actual_points));
  const projected = usable.map((row) => Number(row.projected_points));
  const actual = usable.map((row) => Number(row.actual_points));
  const errors = actual.map((value, index) => value - projected[index]);
  return {
    bucket,
    sample_size: usable.length,
    average_projected: rounded(average(projected)),
    average_actual: rounded(average(actual)),
    average_error: rounded(average(errors)),
    mean_absolute_error: rounded(average(errors.map((value) => Math.abs(value)))),
    rmse: rounded(errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length) : null),
  };
}

function playerMetricBuckets(row: MlbForensicPlayerRow): string[] {
  const position = isPitcher(row) ? 'pitcher' : 'hitter';
  const source = row.projection_source ?? 'source_unknown';
  const order = Number(row.batting_order);
  const orderBucket = Number.isFinite(order) ? order <= 2 ? 'top_order' : order >= 7 ? 'bottom_order' : 'middle_order' : 'order_unknown';
  const starter = row.confirmed_starter === true ? 'starter' : row.confirmed_starter === false ? 'non_starter' : 'starter_unknown';
  return ['overall', `position:${position}`, `projection_source:${source}`, `batting_order:${orderBucket}`, `starter_status:${starter}`];
}

function stackMetricRows(lineups: MlbForensicLineupRow[], index: number): Array<{ projected_points: number | null; actual_points: number | null }> {
  return lineups.map((lineup) => {
    const stack = teamStacks(lineup.players)[index];
    if (!stack) return { projected_points: null, actual_points: null };
    return {
      projected_points: stack.players.reduce((sum, player) => sum + (finite(player.projected_points) ? player.projected_points : 0), 0),
      actual_points: stack.players.every((player) => finite(player.actual_points))
        ? stack.players.reduce((sum, player) => sum + Number(player.actual_points), 0)
        : null,
    };
  });
}

function lineupBucket(row: MlbForensicLineupRow): string[] {
  return [
    'overall',
    `contest_type:${row.contest_type ?? 'contest_unknown'}`,
    `contest_strategy:${row.contest_strategy ?? 'strategy_unknown'}`,
    `lineup_mode:${row.lineup_mode ?? 'mode_unknown'}`,
  ];
}

export function buildMlbForensicScorecard(
  playerRows: MlbForensicPlayerRow[],
  lineupRows: MlbForensicLineupRow[],
): MlbForensicScorecard {
  const playerGroups = new Map<string, MlbForensicPlayerRow[]>();
  for (const row of playerRows) {
    for (const bucket of playerMetricBuckets(row)) playerGroups.set(bucket, [...(playerGroups.get(bucket) ?? []), row]);
  }

  const lineupGroups = new Map<string, MlbForensicLineupRow[]>();
  for (const row of lineupRows) {
    for (const bucket of lineupBucket(row)) lineupGroups.set(bucket, [...(lineupGroups.get(bucket) ?? []), row]);
  }

  const lineupMetrics = [...lineupGroups.entries()].map(([bucket, rows]) => {
    const usable = rows.filter((row) => finite(row.projected_points) && finite(row.actual_points));
    const projected = usable.map((row) => Number(row.projected_points));
    const actual = usable.map((row) => Number(row.actual_points));
    const ranked = rows.filter((row) => finite(row.finish_rank) && finite(row.field_size) && Number(row.field_size) > 1);
    const cashRanked = rows.filter((row) => finite(row.finish_rank) && finite(row.cash_line));
    const paid = rows.filter((row) => finite(row.entry_fee) && finite(row.payout));
    const withOptimal = rows.filter((row) => finite(row.pct_of_optimal));
    return {
      bucket,
      sample_size: usable.length,
      average_projected: rounded(average(projected)),
      average_actual: rounded(average(actual)),
      mean_absolute_error: rounded(average(actual.map((value, index) => Math.abs(value - projected[index])))),
      top_20_rate: ranked.length ? rounded(ranked.filter((row) => Number(row.finish_rank) <= 20).length / ranked.length) : null,
      top_1_percent_rate: ranked.length ? rounded(ranked.filter((row) => Number(row.finish_rank) <= Math.max(1, Number(row.field_size) * 0.01)).length / ranked.length) : null,
      first_place_rate: ranked.length ? rounded(ranked.filter((row) => Number(row.finish_rank) === 1).length / ranked.length) : null,
      cash_rate: cashRanked.length ? rounded(cashRanked.filter((row) => Number(row.finish_rank) <= Number(row.cash_line)).length / cashRanked.length) : null,
      roi: paid.length ? rounded((paid.reduce((sum, row) => sum + Number(row.payout) - Number(row.entry_fee), 0)) / paid.reduce((sum, row) => sum + Number(row.entry_fee), 0)) : null,
      duplication_coverage: rows.length ? rows.filter((row) => finite(row.actual_duplicates)).length / rows.length : 0,
      optimal_points_coverage: rows.length ? rows.filter((row) => finite(row.optimal_points)).length / rows.length : 0,
      average_pct_of_optimal: rounded(average(withOptimal.map((row) => Number(row.pct_of_optimal)))),
    };
  }).sort((a, b) => b.sample_size - a.sample_size);

  return {
    player_metrics: [...playerGroups.entries()].map(([bucket, rows]) => metric(bucket, rows)).sort((a, b) => b.sample_size - a.sample_size),
    pitcher_metrics: [metric('pitchers', playerRows.filter(isPitcher))],
    primary_stack_metrics: [metric('primary_stack', stackMetricRows(lineupRows, 0))],
    secondary_stack_metrics: [metric('secondary_stack', stackMetricRows(lineupRows, 1))],
    lineup_metrics: lineupMetrics,
    coverage: {
      player_rows: playerRows.length,
      player_rows_with_projection_and_actual: playerRows.filter((row) => finite(row.projected_points) && finite(row.actual_points)).length,
      lineup_rows: lineupRows.length,
      lineup_rows_with_projection_and_actual: lineupRows.filter((row) => finite(row.projected_points) && finite(row.actual_points)).length,
      lineup_rows_with_finish_and_field: lineupRows.filter((row) => finite(row.finish_rank) && finite(row.field_size)).length,
      lineup_rows_with_cash_line: lineupRows.filter((row) => finite(row.cash_line)).length,
      lineup_rows_with_entry_fee_and_payout: lineupRows.filter((row) => finite(row.entry_fee) && finite(row.payout)).length,
      lineup_rows_with_actual_ownership: lineupRows.filter((row) => row.players.some((player) => finite(player.actual_ownership))).length,
      lineup_rows_with_candidate_metadata: lineupRows.filter((row) => finite(row.optimizer_rank) && finite(row.rank_score)).length,
      lineup_rows_with_simulation_metadata: lineupRows.filter((row) => finite(row.simulation_ev) || finite(row.top_n_rate) || finite(row.expected_payout)).length,
    },
  };
}

export function mergeMlbForensicActuals(
  lineups: MlbForensicLineupRow[],
  actuals: MlbForensicPlayerRow[],
): MlbForensicLineupRow[] {
  const actualByNameTeam = new Map(actuals.map((row) => [`${normalizeName(row.player_name)}:${String(row.team ?? '').toUpperCase()}`, row.actual_points]));
  return lineups.map((lineup) => ({
    ...lineup,
    players: lineup.players.map((player) => ({
      ...player,
      actual_points: finite(player.actual_points)
        ? player.actual_points
        : actualByNameTeam.get(`${normalizeName(player.player_name)}:${String(player.team ?? '').toUpperCase()}`) ?? null,
    })),
  }));
}
