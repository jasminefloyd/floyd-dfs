import { dkFantasyPoints } from '../dkScoring.ts';

function assertEquals(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

Deno.test('NBA triple-double earns double-double and triple-double bonuses', () => {
  const actual = dkFantasyPoints({
    points: 20,
    totalRebounds: 10,
    assists: 10,
    steals: 1,
    blocks: 1,
    turnovers: 4,
    threePointFieldGoalsMade: 2,
  }, 'nba');

  assertEquals(actual, 55, 'NBA triple-double');
});

Deno.test('NBA 3PT-heavy line includes 3PM scoring', () => {
  const actual = dkFantasyPoints({
    points: 30,
    totalRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    threePointFieldGoalsMade: 8,
  }, 'nba');

  assertEquals(actual, 44.5, 'NBA 3PT-heavy');
});

Deno.test('NFL QB receives passing yard bonus', () => {
  const actual = dkFantasyPoints({
    passingYards: 325,
    passingTouchdowns: 3,
  }, 'nfl');

  assertEquals(actual, 28, 'NFL QB');
});

Deno.test('NFL DST points-allowed tier scores correctly', () => {
  const actual = dkFantasyPoints({
    pointsAllowed: 10,
    sacks: 3,
  }, 'nfl', 'dst');

  assertEquals(actual, 7, 'NFL DST');
});

Deno.test('MLB 2-HR hitter line scores correctly', () => {
  const actual = dkFantasyPoints({
    hits: 3,
    homeRuns: 2,
    rbi: 5,
    runs: 2,
    baseOnBalls: 1,
  }, 'mlb', 'hitter');

  assertEquals(actual, 39, 'MLB hitter');
});

Deno.test('MLB 7IP 9K win pitcher line scores correctly', () => {
  const actual = dkFantasyPoints({
    inningsPitched: 7,
    strikeOuts: 9,
    wins: 1,
    earnedRuns: 2,
    hitsAllowed: 5,
    walksAllowed: 1,
  }, 'mlb', 'pitcher');

  assertEquals(actual, 30.15, 'MLB pitcher');
});
