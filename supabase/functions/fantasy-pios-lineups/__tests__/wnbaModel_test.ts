import { buildWnbaWalkForwardScorecard } from '../wnbaModel.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function metric(scorecard: ReturnType<typeof buildWnbaWalkForwardScorecard>, bucket: string) {
  return scorecard.player_metrics.find((row) => row.bucket === bucket);
}

Deno.test('WNBA walk-forward scorecard separates projection-source and salary buckets', () => {
  const scorecard = buildWnbaWalkForwardScorecard([
    {
      contest_date: '2026-08-01', contest_type: 'classic', contest_id: 'a',
      projected_points: 20, actual_points: 24, projection_source: 'last_5', salary: 5000,
      position: 'G', role_stability: 0.8, confirmed_starter: true,
    },
    {
      contest_date: '2026-08-01', contest_type: 'classic', contest_id: 'a',
      projected_points: 30, actual_points: 25, projection_source: 'opportunity_blend', salary: 9000,
      position: 'C', role_stability: 0.3, confirmed_starter: false,
    },
  ], []);

  const source = metric(scorecard, 'projection_source:last_5');
  const salary = metric(scorecard, 'salary_tier:premium');
  assert(source?.sample_size === 1, 'expected one last-five row');
  assert(source?.mean_absolute_error === 4, 'expected last-five MAE of 4');
  assert(salary?.sample_size === 1, 'expected one premium row');
  assert(salary?.average_error === -5, 'expected premium average error of -5');
});

Deno.test('WNBA walk-forward scorecard reports top rates and leaves cash rate unavailable without a cash line', () => {
  const scorecard = buildWnbaWalkForwardScorecard([], [
    {
      contest_date: '2026-08-01', contest_type: 'classic', contest_id: 'a',
      projected_points: 100, actual_points: 110, field_size: 100, finish_rank: 1,
      entry_fee: 5, payout: 100, actual_duplicates: 2,
    },
    {
      contest_date: '2026-08-01', contest_type: 'classic', contest_id: 'a',
      projected_points: 90, actual_points: 80, field_size: 100, finish_rank: 50,
      entry_fee: 5, payout: 0,
    },
  ]);

  const overall = scorecard.lineup_metrics.find((row) => row.bucket === 'overall');
  assert(overall?.top_10_rate === 0.5, 'expected one of two lineups in the top 10%');
  assert(overall?.top_1_rate === 0.5, 'expected one of two evaluated lineups in the top 1%');
  assert(overall?.cash_rate === null, 'cash rate must remain unavailable without an explicit cash line');
  assert(scorecard.coverage.lineup_rows_with_actual_duplicates === 1, 'expected duplicate coverage to report one row');
});

Deno.test('WNBA walk-forward scorecard computes per-slate Spearman correlation', () => {
  const scorecard = buildWnbaWalkForwardScorecard([
    { contest_date: '2026-08-01', contest_type: 'classic', projected_points: 10, actual_points: 30 },
    { contest_date: '2026-08-01', contest_type: 'classic', projected_points: 20, actual_points: 20 },
    { contest_date: '2026-08-01', contest_type: 'classic', projected_points: 30, actual_points: 10 },
  ], []);
  const overall = metric(scorecard, 'overall');
  assert(overall?.rank_correlation === -1, 'expected perfectly inverse rank correlation');
});
