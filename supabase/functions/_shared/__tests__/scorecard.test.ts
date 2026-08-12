import { assertEquals } from '../testAssert.ts';
import { assertReplayTimestampSafety } from '../eval/replay.ts';
import { evaluateReplay, spearmanRankCorrelation } from '../eval/scorecard.ts';

Deno.test('scorecard computes rank correlation from pre-lock projections and actuals', () => {
  assertEquals(spearmanRankCorrelation([10, 20, 30], [9, 18, 31]), 1);
});

Deno.test('scorecard reports ROI, hit rate, and duplicate lineups', () => {
  const result = evaluateReplay(
    [
      { player_id: 'a', projected_points: 10, actual_points: 12 },
      { player_id: 'b', projected_points: 8, actual_points: 6 },
    ],
    [
      { projected_points: 18, actual_points: 20, payout: 30, entry_fee: 10, player_ids: ['a', 'b'] },
      { projected_points: 18, actual_points: 20, payout: 0, entry_fee: 10, player_ids: ['b', 'a'] },
    ],
  );
  assertEquals(result.mean_absolute_error, 2);
  assertEquals(result.lineup_roi, 0.5);
  assertEquals(result.lineup_hit_rate, 0.5);
  assertEquals(result.duplication_rate, 0.5);
});

Deno.test('replay rejects inputs observed after lock', () => {
  let rejected = false;
  try {
    assertReplayTimestampSafety({ lock_time: '2026-08-10T23:00:00Z', observed_at: '2026-08-10T23:00:01Z' });
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
