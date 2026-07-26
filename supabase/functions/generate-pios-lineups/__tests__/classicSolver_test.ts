import { solveOptimalLineups, type SolverPlayer, type SolverRosterSlot } from '../classicSolver.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function projection(players: SolverPlayer[]): number {
  return players.reduce((sum, player) => sum + Number(player.projected_points ?? 0), 0);
}

function limitedDfsTopProjection(players: SolverPlayer[], slots: SolverRosterSlot[], salaryCap: number, iterationCap: number): number {
  const candidateLists = slots.map((slot) => players
    .filter((player) => String(player.position).split('/').some((position) => slot.eligible.includes(position)))
    .sort((a, b) => (Number(b.projected_points ?? 0) / b.salary) - (Number(a.projected_points ?? 0) / a.salary)));
  let iterations = 0;
  let best = 0;

  function search(slotIndex: number, selected: SolverPlayer[], usedIds: Set<string>, salaryUsed: number) {
    iterations += 1;
    if (iterations > iterationCap) return;
    if (slotIndex === slots.length) {
      best = Math.max(best, projection(selected));
      return;
    }
    for (const candidate of candidateLists[slotIndex]) {
      if (usedIds.has(candidate.player_id)) continue;
      if (salaryUsed + candidate.salary > salaryCap) continue;
      selected.push(candidate);
      usedIds.add(candidate.player_id);
      search(slotIndex + 1, selected, usedIds, salaryUsed + candidate.salary);
      usedIds.delete(candidate.player_id);
      selected.pop();
      if (iterations > iterationCap) return;
    }
  }

  search(0, [], new Set<string>(), 0);
  return best;
}

Deno.test('exact classic solver beats capped value-ordered DFS on stud-and-value construction', () => {
  const slots: SolverRosterSlot[] = [
    { slot: 'A', eligible: ['A'] },
    { slot: 'B', eligible: ['B'] },
    { slot: 'C', eligible: ['C'] },
  ];
  const players: SolverPlayer[] = [
    { player_id: 'a_stud', name: 'A Stud', team: 'X', position: 'A', salary: 60, projected_points: 60 },
    { player_id: 'a_value', name: 'A Value', team: 'X', position: 'A', salary: 20, projected_points: 30 },
    { player_id: 'a_filler_1', name: 'A Filler 1', team: 'X', position: 'A', salary: 35, projected_points: 20 },
    { player_id: 'a_filler_2', name: 'A Filler 2', team: 'X', position: 'A', salary: 45, projected_points: 22 },
    { player_id: 'b_mid', name: 'B Mid', team: 'Y', position: 'B', salary: 40, projected_points: 39 },
    { player_id: 'b_value', name: 'B Value', team: 'Y', position: 'B', salary: 20, projected_points: 30 },
    { player_id: 'b_filler_1', name: 'B Filler 1', team: 'Y', position: 'B', salary: 35, projected_points: 20 },
    { player_id: 'b_filler_2', name: 'B Filler 2', team: 'Y', position: 'B', salary: 45, projected_points: 21 },
    { player_id: 'c_mid', name: 'C Mid', team: 'Z', position: 'C', salary: 40, projected_points: 39 },
    { player_id: 'c_value', name: 'C Value', team: 'Z', position: 'C', salary: 20, projected_points: 30 },
    { player_id: 'c_filler_1', name: 'C Filler 1', team: 'Z', position: 'C', salary: 35, projected_points: 20 },
    { player_id: 'c_filler_2', name: 'C Filler 2', team: 'Z', position: 'C', salary: 45, projected_points: 21 },
  ];

  const dfsProjection = limitedDfsTopProjection(players, slots, 100, 4);
  const exact = solveOptimalLineups(players, 'synthetic', 1, { slots, salaryCap: 100, deadlineMs: 1_000 })[0];

  assert(dfsProjection === 90, `expected capped DFS to stop at 90, got ${dfsProjection}`);
  assert(exact.projected_points === 120, `expected exact optimum 120, got ${exact.projected_points}`);
  assert(exact.projected_points > dfsProjection, 'exact solver should exceed capped DFS');
});
