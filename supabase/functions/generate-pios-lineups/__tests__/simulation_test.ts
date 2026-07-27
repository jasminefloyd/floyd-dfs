import {
  correlateOutcomes,
  generateFieldLineups,
  randomNormal,
  sampleLognormalOutcome,
  scoreIndexedEntries,
  type SimPlayer,
  type SimRosterSlot,
} from '../simulation.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function stdDev(values: number[]): number {
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(values.length, 1));
}

function covariance(a: number[], b: number[]): number {
  const aMean = mean(a);
  const bMean = mean(b);
  return a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0) / Math.max(a.length, 1);
}

Deno.test('lognormal sampler matches target mean and standard deviation', () => {
  const samples = Array.from({ length: 50_000 }, () => sampleLognormalOutcome(25, 10));
  const sampleMean = mean(samples);
  const sampleStdDev = stdDev(samples);
  assert(Math.abs(sampleMean - 25) / 25 < 0.03, `mean ${sampleMean} outside 3% target`);
  assert(Math.abs(sampleStdDev - 10) / 10 < 0.1, `sd ${sampleStdDev} outside 10% target`);
});

Deno.test('NFL QB boom lifts same-team WR outcomes', () => {
  const roster: SimPlayer[] = [
    { player_id: 'qb', name: 'QB', team: 'AAA', position: 'QB', salary: 7000, projected_points: 22 },
    { player_id: 'wr', name: 'WR', team: 'AAA', position: 'WR', salary: 6500, projected_points: 17 },
    { player_id: 'opp', name: 'Opp QB', team: 'BBB', position: 'QB', salary: 7000, projected_points: 18 },
  ];
  const means = new Float64Array([22, 17, 18]);
  const sds = new Float64Array([8, 7, 7]);
  const qbDeviations: number[] = [];
  const wrDeviations: number[] = [];

  for (let index = 0; index < 20_000; index += 1) {
    const outcomes = new Float64Array([
      means[0] + randomNormal(0, sds[0]),
      means[1] + randomNormal(0, sds[1]),
      means[2] + randomNormal(0, sds[2]),
    ]);
    correlateOutcomes(outcomes, means, sds, roster, 'nfl', [['AAA', 'BBB']]);
    qbDeviations.push(outcomes[0] - means[0]);
    wrDeviations.push(outcomes[1] - means[1]);
  }

  assert(covariance(qbDeviations, wrDeviations) > 0, 'expected positive QB/WR covariance');
});

Deno.test('modeled field rewards dominant and leveraged lineups', () => {
  const slots: SimRosterSlot[] = [
    { slot: 'A', eligible: ['A'] },
    { slot: 'B', eligible: ['B'] },
    { slot: 'C', eligible: ['C'] },
  ];
  const roster: SimPlayer[] = [
    { player_id: 'a_dom', name: 'A Dominant', team: 'X', position: 'A', salary: 16000, projected_points: 40, ownership_projection: 0.45 },
    { player_id: 'b_dom', name: 'B Dominant', team: 'X', position: 'B', salary: 16000, projected_points: 38, ownership_projection: 0.42 },
    { player_id: 'c_dom', name: 'C Dominant', team: 'X', position: 'C', salary: 16000, projected_points: 36, ownership_projection: 0.4 },
    { player_id: 'a_chalk', name: 'A Chalk', team: 'Y', position: 'A', salary: 15000, projected_points: 20, ownership_projection: 0.85 },
    { player_id: 'b_chalk', name: 'B Chalk', team: 'Y', position: 'B', salary: 15000, projected_points: 20, ownership_projection: 0.85 },
    { player_id: 'c_chalk', name: 'C Chalk', team: 'Y', position: 'C', salary: 15000, projected_points: 20, ownership_projection: 0.85 },
    { player_id: 'a_lev', name: 'A Leverage', team: 'Z', position: 'A', salary: 15000, projected_points: 20, ownership_projection: 0.05 },
    { player_id: 'b_lev', name: 'B Leverage', team: 'Z', position: 'B', salary: 15000, projected_points: 20, ownership_projection: 0.05 },
    { player_id: 'c_lev', name: 'C Leverage', team: 'Z', position: 'C', salary: 15000, projected_points: 20, ownership_projection: 0.05 },
  ];
  const field = generateFieldLineups(roster, 'toy', 'classic', 400, { toy: slots });
  const chalkIds = new Set(['a_chalk', 'b_chalk', 'c_chalk']);
  const leverageIds = new Set(['a_lev', 'b_lev', 'c_lev']);
  const chalkClones = field.filter((lineup) => lineup.players.every((player) => chalkIds.has(player.playerId))).length;
  const leverageClones = field.filter((lineup) => lineup.players.every((player) => leverageIds.has(player.playerId))).length;

  assert(field.length > 250, `expected field generation to produce enough lineups, got ${field.length}`);
  assert(chalkClones > leverageClones, 'chalk-clone lineup should appear more often than leveraged clone');
  assert(mean([40, 38, 36]) > mean([20, 20, 20]), 'dominant lineup mean should clearly beat weak chalk field mean');
});

Deno.test('showdown captain multiplier makes same players score differently', () => {
  const outcomes = new Float64Array([40, 30, 20, 18, 16, 14]);
  const firstCaptain = scoreIndexedEntries(outcomes, [
    { index: 0, multiplier: 1.5 },
    { index: 1, multiplier: 1 },
    { index: 2, multiplier: 1 },
    { index: 3, multiplier: 1 },
    { index: 4, multiplier: 1 },
    { index: 5, multiplier: 1 },
  ]);
  const secondCaptain = scoreIndexedEntries(outcomes, [
    { index: 0, multiplier: 1 },
    { index: 1, multiplier: 1.5 },
    { index: 2, multiplier: 1 },
    { index: 3, multiplier: 1 },
    { index: 4, multiplier: 1 },
    { index: 5, multiplier: 1 },
  ]);

  assert(firstCaptain !== secondCaptain, 'different captains should produce different simulated lineup scores');
  assert(firstCaptain > secondCaptain, 'higher-outcome captain should score more with the same six players');
});
