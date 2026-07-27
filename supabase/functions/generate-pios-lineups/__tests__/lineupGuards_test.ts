import {
  expectedDuplicatesFromOwnership,
  isValidShowdownLineup,
  maxPlayerExposureCount,
  playerExposureWithinCap,
  payoutObjectiveScore,
  shrunkFantasyStdDev,
  takeEntryCount,
  uniqueCaptainCount,
  type GuardLineup,
} from '../lineupGuards.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function player(id: string, team: string, slot = 'FLEX', ownership = 0.1) {
  return {
    player_id: id,
    name: id,
    team,
    salary: slot === 'CPT' ? 12_000 : 7_000,
    roster_slot: slot,
    salary_multiplier: slot === 'CPT' ? 1.5 : 1,
    ownership_projection: ownership,
    cpt_ownership_projection: slot === 'CPT' ? ownership : undefined,
    flex_ownership_projection: slot === 'FLEX' ? ownership : undefined,
  };
}

function showdownLineup(captainId = 'a1'): GuardLineup {
  return {
    salary_used: 47_000,
    players: [
      player(captainId, 'AAA', 'CPT', 0.25),
      player('a2', 'AAA'),
      player('a3', 'AAA'),
      player('b1', 'BBB'),
      player('b2', 'BBB'),
      player('b3', 'BBB'),
    ],
  };
}

Deno.test('9.1 showdown guard accepts only valid six-player two-team CPT lineups under cap', () => {
  assert(isValidShowdownLineup(showdownLineup(), 46_000), 'expected valid showdown lineup');
  assert(!isValidShowdownLineup({ ...showdownLineup(), salary_used: 51_000 }), 'salary cap must be enforced');
  assert(!isValidShowdownLineup({ salary_used: 47_000, players: showdownLineup().players.slice(0, 5) }), 'six players required');
  assert(!isValidShowdownLineup({ salary_used: 47_000, players: showdownLineup().players.map((p) => ({ ...p, team: 'AAA' })) }), 'both teams required');
});

Deno.test('9.3 entry count helper returns exactly requested entries', () => {
  assert(takeEntryCount([1, 2, 3, 4, 5], 3).length === 3, 'entry count should control returned lineups');
});

Deno.test('9.4 exposure helper detects max player appearances', () => {
  const lineups = [showdownLineup('a1'), showdownLineup('b1'), showdownLineup('c1'), showdownLineup('d1')];
  assert(maxPlayerExposureCount(lineups) === 4, 'shared flex players appear in all four lineups');
  assert(!playerExposureWithinCap(lineups, 0.5), 'maxPlayerExposure 0.5 over four entries allows at most two appearances');
});

Deno.test('9.5 unique captain helper counts distinct CPT slots', () => {
  const lineups = [showdownLineup('a1'), showdownLineup('b1'), showdownLineup('c1'), showdownLineup('d1'), showdownLineup('e1')];
  assert(uniqueCaptainCount(lineups) === 5, 'five entries should have five distinct captains');
});

Deno.test('9.6 variance shrinkage differs for identical means with different observed spread', () => {
  const lowVariance = shrunkFantasyStdDev(4, 5, 12);
  const highVariance = shrunkFantasyStdDev(20, 5, 12);
  assert(highVariance > lowVariance, 'observed game-log spread should change modeled sigma');
});

Deno.test('9.7 objective helper changes priority by payout shape', () => {
  const highEv = { salary_used: 0, players: [], expected_payout: 1.5, top_n_rate: 0.35, win_rate: 0.01 };
  const highWin = { salary_used: 0, players: [], expected_payout: 0.8, top_n_rate: 0.2, win_rate: 0.08 };
  assert(payoutObjectiveScore(highEv, 'flat') > payoutObjectiveScore(highWin, 'flat'), 'flat payout should favor cash/top-N rate');
  assert(payoutObjectiveScore(highWin, 'winner_take_all') > payoutObjectiveScore(highEv, 'winner_take_all'), 'winner-take-all should favor first-place probability');
});

Deno.test('9.10 duplicate estimate scales chalk ownership in large fields', () => {
  const chalk = expectedDuplicatesFromOwnership(showdownLineup().players.map((p) => ({ ...p, ownership_projection: 0.45, cpt_ownership_projection: p.roster_slot === 'CPT' ? 0.25 : undefined, flex_ownership_projection: p.roster_slot === 'FLEX' ? 0.45 : undefined })), 50_000);
  assert(chalk > 20, `expected high duplicate count in a 50k field, got ${chalk}`);
});
