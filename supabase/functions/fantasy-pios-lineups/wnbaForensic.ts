export interface WnbaForensicPlayerRow {
  player_id?: string | null;
  player_name?: string | null;
  team?: string | null;
  position?: string | null;
  projected_points?: number | null;
  actual_points?: number | null;
  minutes_projection?: number | null;
  actual_minutes?: number | null;
  ownership_projection?: number | null;
  projection_source?: string | null;
  confirmed_starter?: boolean | null;
}

export interface WnbaForensicLineupRow {
  generated_lineup_id: string;
  contest_date: string;
  contest_type: string;
  contest_id?: string | null;
  contest_strategy?: string | null;
  lineup_mode?: string | null;
  field_size?: number | null;
  entry_fee?: number | null;
  finish_rank?: number | null;
  cash_line?: number | null;
  payout?: number | null;
  actual_duplicates?: number | null;
  expected_duplicates?: number | null;
  projected_points?: number | null;
  actual_points?: number | null;
  optimal_points?: number | null;
  optimizer_rank?: number | null;
  scan_snapshot_id?: string | null;
  players: WnbaForensicPlayerRow[];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rounded(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(4));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function lossCategories(lineup: WnbaForensicLineupRow): string[] {
  const categories = new Set<string>();
  const players = lineup.players;
  if (players.some((player) => !finite(player.actual_points))) categories.add('missing_player_result');
  if (!finite(lineup.finish_rank) || !finite(lineup.field_size)) categories.add('contest_result_unavailable');
  if (players.some((player) => !finite(player.ownership_projection))) categories.add('ownership_unavailable');
  if (players.some((player) => !finite(player.actual_minutes))) categories.add('minutes_unavailable');
  for (const player of players) {
    if (!finite(player.projected_points) || !finite(player.actual_points)) continue;
    const pointsMiss = player.actual_points - player.projected_points;
    const minutesMiss = finite(player.actual_minutes) && finite(player.minutes_projection)
      ? player.actual_minutes - player.minutes_projection
      : null;
    if (minutesMiss !== null && Math.abs(minutesMiss) >= 4 && Math.abs(pointsMiss) >= 5) categories.add('minutes_or_role_error');
    else if (pointsMiss <= -7) categories.add('production_error');
  }
  if (finite(lineup.expected_duplicates) && finite(lineup.actual_duplicates)
    && Math.abs(lineup.expected_duplicates - lineup.actual_duplicates) >= 2) categories.add('duplication_error');
  return [...categories].sort();
}

export function buildWnbaForensicScorecard(lineups: WnbaForensicLineupRow[]) {
  const playerRows = lineups.flatMap((lineup) => lineup.players);
  const playerErrors = playerRows
    .filter((player) => finite(player.projected_points) && finite(player.actual_points))
    .map((player) => Number(player.actual_points) - Number(player.projected_points));
  const minutesErrors = playerRows
    .filter((player) => finite(player.minutes_projection) && finite(player.actual_minutes))
    .map((player) => Number(player.actual_minutes) - Number(player.minutes_projection));
  const ranked = lineups.filter((lineup) => finite(lineup.finish_rank) && finite(lineup.field_size) && Number(lineup.field_size) > 1);
  const paid = lineups.filter((lineup) => finite(lineup.entry_fee) && finite(lineup.payout));
  const lossCounts = new Map<string, number>();
  for (const lineup of lineups) {
    for (const category of lossCategories(lineup)) lossCounts.set(category, (lossCounts.get(category) ?? 0) + 1);
  }
  return {
    player_metrics: {
      sample_size: playerErrors.length,
      mean_error: rounded(average(playerErrors)),
      mean_absolute_error: rounded(average(playerErrors.map((value) => Math.abs(value)))),
    },
    minutes_metrics: {
      sample_size: minutesErrors.length,
      mean_error: rounded(average(minutesErrors)),
      mean_absolute_error: rounded(average(minutesErrors.map((value) => Math.abs(value)))),
    },
    lineup_metrics: {
      sample_size: lineups.length,
      top_20_rate: ranked.length ? rounded(ranked.filter((lineup) => Number(lineup.finish_rank) <= 20).length / ranked.length) : null,
      top_1_percent_rate: ranked.length ? rounded(ranked.filter((lineup) => Number(lineup.finish_rank) <= Math.max(1, Number(lineup.field_size) * 0.01)).length / ranked.length) : null,
      roi: paid.length ? rounded(paid.reduce((sum, lineup) => sum + Number(lineup.payout) - Number(lineup.entry_fee), 0) / paid.reduce((sum, lineup) => sum + Number(lineup.entry_fee), 0)) : null,
      rank_coverage: lineups.length ? rounded(ranked.length / lineups.length) : 0,
      duplicate_coverage: lineups.length ? rounded(lineups.filter((lineup) => finite(lineup.actual_duplicates)).length / lineups.length) : 0,
    },
    loss_categories: [...lossCounts.entries()].map(([category, count]) => ({ category, lineup_count: count })).sort((a, b) => b.lineup_count - a.lineup_count || a.category.localeCompare(b.category)),
    coverage: {
      lineups: lineups.length,
      players: playerRows.length,
      players_with_actual_minutes: playerRows.filter((player) => finite(player.actual_minutes)).length,
      lineups_with_contest_result: ranked.length,
      lineups_with_payout: paid.length,
    },
  };
}

export function enrichWnbaForensicLineup(lineup: WnbaForensicLineupRow) {
  return { ...lineup, loss_categories: lossCategories(lineup) };
}
