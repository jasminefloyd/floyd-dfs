import { buildMlbForensicScorecard, mergeMlbForensicActuals } from '../mlbForensic.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const playerRows = [
  { player_name: 'Ace Pitcher', team: 'AAA', position: 'P', projected_points: 20, actual_points: 35, projection_source: 'position_baseline' },
  { player_name: 'Lead Hitter', team: 'AAA', position: 'OF', projected_points: 10, actual_points: 15, projection_source: 'last_5', batting_order: 1, confirmed_starter: true },
  { player_name: 'Secondary Hitter', team: 'AAA', position: '1B', projected_points: 9, actual_points: 4, projection_source: 'last_5', batting_order: 4, confirmed_starter: true },
];

Deno.test('MLB forensic scorecard reports pitcher and projection-source error', () => {
  const scorecard = buildMlbForensicScorecard(playerRows, []);
  const pitcher = scorecard.pitcher_metrics[0];
  const source = scorecard.player_metrics.find((row) => row.bucket === 'projection_source:last_5');
  assert(pitcher.sample_size === 1, 'expected one pitcher');
  assert(pitcher.average_error === 15, 'expected pitcher error of 15');
  assert(source?.sample_size === 2, 'expected two last-five hitters');
});

Deno.test('MLB forensic scorecard separates primary and secondary stacks', () => {
  const lineups = [{
    contest_date: '2026-08-01', contest_type: 'classic', contest_id: 'mlb-1',
    projected_points: 39, actual_points: 54, field_size: 100, finish_rank: 10, cash_line: 20,
    entry_fee: 5, payout: 25, players: playerRows,
  }];
  const scorecard = buildMlbForensicScorecard(playerRows, lineups);
  assert(scorecard.primary_stack_metrics[0].sample_size === 2, 'expected two primary-stack hitters');
  assert(scorecard.coverage.lineup_rows_with_cash_line === 1, 'expected cash-line coverage');
  assert(scorecard.lineup_metrics[0].top_20_rate === 1, 'expected one top-20 finish');
  assert(scorecard.lineup_metrics[0].cash_rate === 1, 'expected one cash finish');
  assert(scorecard.lineup_metrics[0].roi === 4, 'expected 400% ROI');
});

Deno.test('MLB forensic actual merge uses player name and team without overwriting known actuals', () => {
  const merged = mergeMlbForensicActuals([
    { players: [{ player_name: 'Lead Hitter', team: 'AAA', actual_points: 12 }] },
  ], [{ player_name: 'Lead Hitter', team: 'AAA', actual_points: 20 }]);
  assert(merged[0].players[0].actual_points === 12, 'known lineup actual must be preserved');
});
