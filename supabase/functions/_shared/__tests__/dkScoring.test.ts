import { dkFantasyPoints, golfFinishPositionBonus } from '../dkScoring.ts';

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

Deno.test('NFL punt returner return TD and offensive fumble recovery TD score correctly', () => {
  const actual = dkFantasyPoints({
    kickReturnTouchdowns: 1,
    puntReturnTouchdowns: 1,
    offensiveFumbleRecoveryTouchdowns: 1,
  }, 'nfl');

  assertEquals(actual, 18, 'NFL return/fumble-recovery TDs');
});

Deno.test('NFL DST two-point return scores correctly', () => {
  const actual = dkFantasyPoints({
    pointsAllowed: 10,
    twoPointReturns: 1,
  }, 'nfl', 'dst');

  assertEquals(actual, 6, 'NFL DST two-point return');
});

Deno.test('NFL kicker scores extra points and field goals by distance tier', () => {
  const actual = dkFantasyPoints({
    extraPointsMade: 2,
    fieldGoalsMade0to39: 1,
    fieldGoalsMade40to49: 1,
    fieldGoalsMade50Plus: 1,
  }, 'nfl', 'kicker');

  assertEquals(actual, 14, 'NFL kicker');
});

Deno.test('NFL DST points-allowed tier scores correctly', () => {
  const actual = dkFantasyPoints({
    pointsAllowed: 10,
    sacks: 3,
  }, 'nfl', 'dst');

  assertEquals(actual, 7, 'NFL DST');
});

Deno.test('golf Classic per-hole scoring with a bogey mixed in', () => {
  const actual = dkFantasyPoints({
    birdieHoles: 4,
    parHoles: 12,
    bogeyHoles: 2,
  }, 'golf', undefined, 'classic');

  assertEquals(actual, 17, 'golf Classic mixed round');
});

Deno.test('golf Classic bogey-free round and birdie-streak bonuses stack', () => {
  const actual = dkFantasyPoints({
    birdieHoles: 3,
    parHoles: 15,
    bogeyFreeRounds: 1,
    birdieStreakBonusRounds: 1,
  }, 'golf', undefined, 'classic');

  assertEquals(actual, 22.5, 'golf Classic bogey-free + streak');
});

Deno.test('golf Classic and Showdown use different point tables for the same holes', () => {
  const classic = dkFantasyPoints({ birdieHoles: 1 }, 'golf', undefined, 'classic');
  const showdown = dkFantasyPoints({ birdieHoles: 1 }, 'golf', undefined, 'showdown');

  assertEquals(classic, 3, 'golf Classic single birdie');
  assertEquals(showdown, 5.75, 'golf Showdown single birdie');
});

Deno.test('golf Showdown ignores finish position (single round, no tournament placement)', () => {
  const actual = dkFantasyPoints({ birdieHoles: 1, finishPosition: 1 }, 'golf', undefined, 'showdown');
  assertEquals(actual, 5.75, 'golf Showdown ignores finishPosition');
});

Deno.test('golf finish-position bonus pays ties in full, not split', () => {
  assertEquals(golfFinishPositionBonus(1), 30, '1st place');
  assertEquals(golfFinishPositionBonus(3), 18, '3rd place');
  assertEquals(golfFinishPositionBonus(11), 6, '11th-15th tier');
  assertEquals(golfFinishPositionBonus(50), 1, '41st-50th tier');
  assertEquals(golfFinishPositionBonus(51), 0, 'outside paid positions');
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
