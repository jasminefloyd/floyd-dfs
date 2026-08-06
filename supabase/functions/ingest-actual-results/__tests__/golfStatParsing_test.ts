import {
  aggregateGolfRounds,
  allRoundsUnder70Bonus,
  hasBirdieStreakBonus,
  isBogeyFreeRound,
  rankWithTies,
  type GolfHoleResult,
  type GolfRoundResult,
} from '../golfStatParsing.ts';

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function hole(relativeToPar: number, strokes = relativeToPar + 4): GolfHoleResult {
  return { relativeToPar, strokes };
}

Deno.test('hasBirdieStreakBonus requires 3+ consecutive birdie-or-better holes', () => {
  const notConsecutive = [hole(-1), hole(0), hole(-1), hole(0), hole(-1)];
  const consecutive = [hole(0), hole(-1), hole(-2), hole(-1), hole(0)];
  assertEquals(hasBirdieStreakBonus(notConsecutive), false, 'non-consecutive birdies');
  assertEquals(hasBirdieStreakBonus(consecutive), true, 'consecutive birdie/eagle/birdie');
});

Deno.test('isBogeyFreeRound requires all 18 holes and none worse than par', () => {
  const fullBogeyFree = Array.from({ length: 18 }, () => hole(0));
  const shortRound = Array.from({ length: 15 }, () => hole(0));
  const withBogey = [...Array.from({ length: 17 }, () => hole(0)), hole(1)];
  assertEquals(isBogeyFreeRound(fullBogeyFree), true, 'full bogey-free round');
  assertEquals(isBogeyFreeRound(shortRound), false, 'shortened round never eligible');
  assertEquals(isBogeyFreeRound(withBogey), false, 'one bogey disqualifies the round');
});

Deno.test('aggregateGolfRounds buckets holes correctly and detects a hole-in-one', () => {
  const round: GolfRoundResult = {
    totalStrokes: 68,
    holes: [
      hole(-3, 2), // double eagle or better (par 5, 2 strokes)
      hole(-2), // eagle
      hole(-1), // birdie
      hole(0), // par
      hole(1), // bogey
      hole(2), // double bogey or worse
      { relativeToPar: -2, strokes: 1 }, // hole-in-one (also buckets as eagle)
    ],
  };
  const totals = aggregateGolfRounds([round]);
  assertEquals(totals.doubleEagleOrBetterHoles, 1, 'double eagle bucket');
  assertEquals(totals.eagleHoles, 2, 'eagle bucket (includes the ace)');
  assertEquals(totals.birdieHoles, 1, 'birdie bucket');
  assertEquals(totals.parHoles, 1, 'par bucket');
  assertEquals(totals.bogeyHoles, 1, 'bogey bucket');
  assertEquals(totals.doubleBogeyOrWorseHoles, 1, 'double bogey or worse bucket');
  assertEquals(totals.holesInOne, 1, 'hole in one detected by absolute strokes');
});

Deno.test('allRoundsUnder70Bonus requires every completed round under 70 and a full round count', () => {
  const allUnder70: GolfRoundResult[] = [
    { totalStrokes: 68, holes: [] },
    { totalStrokes: 69, holes: [] },
    { totalStrokes: 65, holes: [] },
    { totalStrokes: 67, holes: [] },
  ];
  const oneOver70: GolfRoundResult[] = [...allUnder70.slice(0, 3), { totalStrokes: 71, holes: [] }];
  const missedCut: GolfRoundResult[] = allUnder70.slice(0, 2);

  assertEquals(allRoundsUnder70Bonus(allUnder70, 4), 1, 'all 4 rounds under 70');
  assertEquals(allRoundsUnder70Bonus(oneOver70, 4), 0, 'one round at 70+ disqualifies');
  assertEquals(allRoundsUnder70Bonus(missedCut, 4), 0, 'fewer rounds than the tournament played is not eligible');
});

Deno.test('rankWithTies gives tied scores the same rank and skips ranks past a tie group', () => {
  const ranks = rankWithTies([
    { id: 'a', score: -20 },
    { id: 'b', score: -18 },
    { id: 'c', score: -18 },
    { id: 'd', score: -15 },
  ]);
  assertEquals(ranks.get('a'), 1, 'sole leader');
  assertEquals(ranks.get('b'), 2, 'first of the tie');
  assertEquals(ranks.get('c'), 2, 'second of the tie shares rank');
  assertEquals(ranks.get('d'), 4, 'next distinct score skips past the tied pair');
});
