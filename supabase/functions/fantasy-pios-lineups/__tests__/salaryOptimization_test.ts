import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { solveOptimalLineupsWithMeta } from '../classicSolver.ts';

Deno.test('salary-aware solver honors an imported non-default salary cap', () => {
  const result = solveOptimalLineupsWithMeta([
    { player_id: 'a', name: 'A', team: 'AAA', position: 'G', salary: 12000, projected_points: 20 },
    { player_id: 'b', name: 'B', team: 'BBB', position: 'G', salary: 9000, projected_points: 18 },
    { player_id: 'c', name: 'C', team: 'CCC', position: 'F', salary: 9000, projected_points: 17 },
    { player_id: 'd', name: 'D', team: 'DDD', position: 'F', salary: 7000, projected_points: 15 },
  ], 'wnba', 1, { salaryCap: 30000, slots: [{ slot: 'G', eligible: ['G'] }, { slot: 'F', eligible: ['F'] }] });
  assert(result.lineups.length > 0);
  assertEquals(result.lineups[0].salary_used <= 30000, true);
  assert(result.lineups[0].players.length === 2);
});
