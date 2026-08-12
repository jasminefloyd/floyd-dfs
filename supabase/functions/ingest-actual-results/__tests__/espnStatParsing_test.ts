import { parseEspnAthleteStats, parseMinutes, statKeyFromLabel } from '../espnStatParsing.ts';

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

Deno.test('identical ESPN column labels resolve differently by stat group', () => {
  assertEquals(statKeyFromLabel('TD', 'passing'), 'passingTouchdowns', 'passing TD');
  assertEquals(statKeyFromLabel('TD', 'rushing'), 'rushingTouchdowns', 'rushing TD');
  assertEquals(statKeyFromLabel('TD', 'receiving'), 'receivingTouchdowns', 'receiving TD');
  assertEquals(statKeyFromLabel('TD', 'kickReturns'), 'kickReturnTouchdowns', 'kick return TD');
  assertEquals(statKeyFromLabel('TD', 'puntReturns'), 'puntReturnTouchdowns', 'punt return TD');
  assertEquals(statKeyFromLabel('YDS', 'passing'), 'passingYards', 'passing YDS');
  assertEquals(statKeyFromLabel('YDS', 'rushing'), 'rushingYards', 'rushing YDS');
  assertEquals(statKeyFromLabel('YDS', 'receiving'), 'receivingYards', 'receiving YDS');
});

Deno.test('receiving REC and fumbles REC do not collide', () => {
  assertEquals(statKeyFromLabel('REC', 'receiving'), 'receptions', 'receiving REC');
  assertEquals(statKeyFromLabel('REC', 'fumbles'), 'fumblesRecovered', 'fumbles REC');
});

Deno.test('basketball minutes retain seconds from ESPN clock values', () => {
  assertEquals(parseMinutes('31:30'), 31.5, 'clock minutes');
  assertEquals(parseEspnAthleteStats({ stats: ['31:30'] }, ['MIN']).minutes, 31.5, 'MIN stat');
});

Deno.test('a QB line summed across passing, rushing, and fumbles groups keeps stats distinct', () => {
  const passing = parseEspnAthleteStats({ stats: ['20/30', '250', '8.3', '1', '1', '3', '62.2', '86.7'] },
    ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], 'passing');
  const rushing = parseEspnAthleteStats({ stats: ['1', '0', '0', '0', '0'] },
    ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], 'rushing');
  const fumbles = parseEspnAthleteStats({ stats: ['5', '2', '3'] }, ['FUM', 'LOST', 'REC'], 'fumbles');

  const combined: Record<string, number> = {};
  for (const line of [passing, rushing, fumbles]) {
    for (const [key, value] of Object.entries(line)) combined[key] = (combined[key] ?? 0) + value;
  }

  assertEquals(combined.passingYards, 250, 'passingYards');
  assertEquals(combined.passingTouchdowns, 1, 'passingTouchdowns');
  assertEquals(combined.rushingYards, 0, 'rushingYards');
  assertEquals(combined.rushingTouchdowns, 0, 'rushingTouchdowns');
  assertEquals(combined.fumblesRecovered, 3, 'fumblesRecovered');
  assertEquals(combined.receptions, undefined, 'no spurious receptions key from fumbles REC');
});
