export interface ReplayPlayerOutcome {
  player_id: string;
  projected_points: number;
  actual_points: number;
}

export interface ReplayLineupOutcome {
  entry_id?: string;
  projected_points: number;
  actual_points: number;
  payout?: number;
  entry_fee?: number;
  player_ids?: string[];
  top_20_cutoff?: number;
}

export interface ReplayScorecard {
  player_sample_size: number;
  mean_absolute_error: number | null;
  mean_error: number | null;
  spearman_rank_correlation: number | null;
  lineup_sample_size: number;
  lineup_mean_absolute_error: number | null;
  lineup_roi: number | null;
  lineup_hit_rate: number | null;
  duplication_rate: number | null;
  top_20_rate: number | null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rank(values: number[]): number[] {
  return values.map((value) => 1 + values.filter((candidate) => candidate < value).length + (values.filter((candidate) => candidate === value).length - 1) / 2);
}

export function spearmanRankCorrelation(actual: number[], projected: number[]): number | null {
  if (actual.length !== projected.length || actual.length < 2) return null;
  const actualRank = rank(actual);
  const projectedRank = rank(projected);
  const actualMean = actualRank.reduce((sum, value) => sum + value, 0) / actualRank.length;
  const projectedMean = projectedRank.reduce((sum, value) => sum + value, 0) / projectedRank.length;
  const numerator = actualRank.reduce((sum, value, index) => sum + (value - actualMean) * (projectedRank[index] - projectedMean), 0);
  const denominator = Math.sqrt(
    actualRank.reduce((sum, value) => sum + (value - actualMean) ** 2, 0)
      * projectedRank.reduce((sum, value) => sum + (value - projectedMean) ** 2, 0),
  );
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

export function evaluateReplay(
  players: ReplayPlayerOutcome[],
  lineups: ReplayLineupOutcome[] = [],
): ReplayScorecard {
  const playerErrors = players.map((row) => row.actual_points - row.projected_points);
  const lineupErrors = lineups.map((row) => row.actual_points - row.projected_points);
  const paidLineups = lineups.filter((row) => Number.isFinite(row.entry_fee) && Number(row.entry_fee) > 0);
  const totalFees = paidLineups.reduce((sum, row) => sum + Number(row.entry_fee), 0);
  const totalPayouts = paidLineups.reduce((sum, row) => sum + Number(row.payout ?? 0), 0);
  const signatures = lineups.map((lineup) => [...(lineup.player_ids ?? [])].sort().join('|')).filter(Boolean);
  const uniqueSignatures = new Set(signatures);
  const top20Eligible = lineups.filter((lineup) => Number.isFinite(lineup.top_20_cutoff));
  const hitRate = paidLineups.length
    ? paidLineups.filter((row) => Number(row.payout ?? 0) > 0).length / paidLineups.length
    : null;
  return {
    player_sample_size: players.length,
    mean_absolute_error: average(playerErrors.map((error) => Math.abs(error))),
    mean_error: average(playerErrors),
    spearman_rank_correlation: spearmanRankCorrelation(
      players.map((row) => row.actual_points),
      players.map((row) => row.projected_points),
    ),
    lineup_sample_size: lineups.length,
    lineup_mean_absolute_error: average(lineupErrors.map((error) => Math.abs(error))),
    lineup_roi: totalFees ? Number(((totalPayouts - totalFees) / totalFees).toFixed(4)) : null,
    lineup_hit_rate: hitRate === null ? null : Number(hitRate.toFixed(4)),
    duplication_rate: signatures.length ? Number((1 - uniqueSignatures.size / signatures.length).toFixed(4)) : null,
    top_20_rate: top20Eligible.length
      ? Number((top20Eligible.filter((lineup) => lineup.actual_points >= Number(lineup.top_20_cutoff)).length / top20Eligible.length).toFixed(4))
      : null,
  };
}
