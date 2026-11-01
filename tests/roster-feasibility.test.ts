import assert from 'node:assert/strict';
import test from 'node:test';
import type { SlatePlayer, ValidatedSlate } from '../src/lib/engine/contracts.js';
import { assertRosterFeasible } from '../src/lib/engine/validation.js';

function player(playerId: string, position: string, salary: number, team: string): SlatePlayer {
  const eligibility: Record<string, boolean> = { [position]: true };
  if (['RB', 'WR', 'TE'].includes(position)) eligibility.FLEX = true;
  return { playerId, playerName: playerId, position, salary, eligibility, team, providerStatus: 'ACTIVE' } as SlatePlayer;
}

function nflSlate(playerPool: SlatePlayer[]): ValidatedSlate {
  return {
    sport: 'NFL', salaryCap: 50_000, playerPool,
    rosterRules: { slots: { QB: { count: 1 }, RB: { count: 2 }, TE: { count: 1 }, WR: { count: 3 }, DST: { count: 1 }, FLEX: { count: 1 } }, rosterSize: 9, uniquePlayersRequired: true },
  } as unknown as ValidatedSlate;
}

test('feasibility check finds a legal NFL roster in a salary-descending, large player pool', () => {
  const pool: SlatePlayer[] = [];
  for (let index = 0; index < 50; index += 1) {
    pool.push(player(`QB-expensive-${index}`, 'QB', 8_000, `Q${index}`));
    pool.push(player(`RB-expensive-${index}`, 'RB', 8_000, `R${index}`));
    pool.push(player(`WR-expensive-${index}`, 'WR', 8_000, `W${index}`));
    pool.push(player(`TE-expensive-${index}`, 'TE', 8_000, `T${index}`));
    pool.push(player(`DST-expensive-${index}`, 'DST', 8_000, `D${index}`));
  }
  pool.push(player('QB-budget', 'QB', 3_000, 'B1'));
  pool.push(player('RB-budget-1', 'RB', 3_000, 'B2'));
  pool.push(player('RB-budget-2', 'RB', 3_000, 'B3'));
  pool.push(player('RB-budget-flex', 'RB', 3_000, 'B4'));
  pool.push(player('TE-budget', 'TE', 3_000, 'B5'));
  pool.push(player('WR-budget-1', 'WR', 3_000, 'B6'));
  pool.push(player('WR-budget-2', 'WR', 3_000, 'B7'));
  pool.push(player('WR-budget-3', 'WR', 3_000, 'B8'));
  pool.push(player('DST-budget', 'DST', 3_000, 'B9'));

  assert.doesNotThrow(() => assertRosterFeasible(nflSlate(pool)));
});
