export interface SolverPlayer {
  name: string;
  team: string;
  position: string;
  salary: number;
  base_salary?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  player_id: string;
  projected_points?: number;
  contextual_projection?: number;
  last_5_avg_pts?: number;
  [key: string]: unknown;
}

export interface SolverRosterSlot {
  slot: string;
  eligible: string[];
}

export interface SolverLineup {
  players: SolverPlayer[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  strategy_notes?: string[];
  constraint_violations: string[];
}

export interface ExactSolverResult {
  lineups: SolverLineup[];
  elapsedMs: number;
  timedOut: boolean;
  iterations: number;
  bestVerified: boolean;
}

export interface SolverOptions {
  slots?: SolverRosterSlot[];
  salaryCap?: number;
  deadlineMs?: number;
  minDistinctTeams?: number;
  minDistinctGames?: number;
  maxSharedPlayers?: number;
  maxPerTeam?: { max: number; excludePositions?: string[] };
  incompatiblePairs?: Array<[string, string]>;
}

const DEFAULT_SALARY_CAP = 50_000;

const DEFAULT_ROSTER_SLOTS: Record<string, SolverRosterSlot[]> = {
  nba: [
    { slot: 'PG', eligible: ['PG'] },
    { slot: 'SG', eligible: ['SG'] },
    { slot: 'SF', eligible: ['SF'] },
    { slot: 'PF', eligible: ['PF'] },
    { slot: 'C', eligible: ['C'] },
    { slot: 'G', eligible: ['PG', 'SG'] },
    { slot: 'F', eligible: ['SF', 'PF'] },
    { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
  ],
  wnba: [
    { slot: 'G1', eligible: ['PG', 'SG'] },
    { slot: 'G2', eligible: ['PG', 'SG'] },
    { slot: 'F1', eligible: ['SF', 'PF'] },
    { slot: 'F2', eligible: ['SF', 'PF'] },
    { slot: 'UTIL1', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
    { slot: 'UTIL2', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
  ],
  nfl: [
    { slot: 'QB', eligible: ['QB'] },
    { slot: 'RB1', eligible: ['RB'] },
    { slot: 'RB2', eligible: ['RB'] },
    { slot: 'WR1', eligible: ['WR'] },
    { slot: 'WR2', eligible: ['WR'] },
    { slot: 'WR3', eligible: ['WR'] },
    { slot: 'TE', eligible: ['TE'] },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
    { slot: 'DST', eligible: ['DST', 'DEF'] },
  ],
  mlb: [
    { slot: 'P1', eligible: ['P', 'SP', 'RP'] },
    { slot: 'P2', eligible: ['P', 'SP', 'RP'] },
    { slot: 'C', eligible: ['C'] },
    { slot: '1B', eligible: ['1B'] },
    { slot: '2B', eligible: ['2B'] },
    { slot: '3B', eligible: ['3B'] },
    { slot: 'SS', eligible: ['SS'] },
    { slot: 'OF1', eligible: ['OF'] },
    { slot: 'OF2', eligible: ['OF'] },
    { slot: 'OF3', eligible: ['OF'] },
  ],
  golf: [
    { slot: 'G1', eligible: ['G'] },
    { slot: 'G2', eligible: ['G'] },
    { slot: 'G3', eligible: ['G'] },
    { slot: 'G4', eligible: ['G'] },
    { slot: 'G5', eligible: ['G'] },
    { slot: 'G6', eligible: ['G'] },
  ],
};

interface OrderedSlot {
  slot: SolverRosterSlot;
  originalIndex: number;
  candidates: SolverPlayer[];
}

interface SearchState {
  timedOut: boolean;
  iterations: number;
}

interface DpCandidate {
  salary: number;
  projection: number;
  playersByOriginalSlot: Array<SolverPlayer | undefined>;
}

function adjustedProjection(player: SolverPlayer): number {
  return Number(player.contextual_projection ?? player.projected_points ?? player.last_5_avg_pts ?? 0);
}

function playerEligibleForSlot(player: SolverPlayer, slotDef: SolverRosterSlot): boolean {
  return String(player.position ?? '')
    .split('/')
    .map((position) => position.trim())
    .some((position) => slotDef.eligible.includes(position));
}

function calculateProjectedPoints(players: SolverPlayer[]): number {
  return Number(players.reduce((sum, player) => sum + adjustedProjection(player), 0).toFixed(2));
}

export function lineupSignature(lineup: Pick<SolverLineup, 'players'>): string {
  const isShowdown = lineup.players.some((player) => player.roster_slot === 'CPT');
  return lineup.players
    .map((player) => isShowdown ? `${player.roster_slot ?? 'FLEX'}:${player.player_id}` : player.player_id)
    .sort()
    .join('|');
}

function violatesNoGoodCut(selectedIds: Set<string>, noGoodCuts: string[][], maxSharedPlayers?: number): boolean {
  return noGoodCuts.some((cut) => {
    const sharedPlayers = cut.reduce((count, playerId) => count + (selectedIds.has(playerId) ? 1 : 0), 0);
    return maxSharedPlayers === undefined ? sharedPlayers === cut.length : sharedPlayers > maxSharedPlayers;
  });
}

function satisfiesDistinctConstraints(players: SolverPlayer[], options: SolverOptions): boolean {
  if (options.minDistinctTeams !== undefined) {
    const teams = new Set(players.map((player) => String(player.team ?? '').trim()).filter(Boolean));
    if (teams.size < options.minDistinctTeams) return false;
  }
  if (options.minDistinctGames !== undefined) {
    const hasCompleteGameData = players.every((player) => String(player.game_id ?? '').trim().length > 0);
    const groups = hasCompleteGameData
      ? players.map((player) => String(player.game_id).trim())
      : players.map((player) => String(player.team ?? '').trim()).filter(Boolean);
    if (new Set(groups).size < options.minDistinctGames) return false;
  }
  if (options.maxPerTeam) {
    const { max, excludePositions = [] } = options.maxPerTeam;
    const excluded = new Set(excludePositions.map((position) => position.toUpperCase()));
    const counts = new Map<string, number>();
    for (const player of players) {
      if (excluded.has(String(player.position ?? '').toUpperCase())) continue;
      const team = String(player.team ?? '').trim();
      if (!team) continue;
      const count = (counts.get(team) ?? 0) + 1;
      if (count > max) return false;
      counts.set(team, count);
    }
  }
  if (options.incompatiblePairs?.length) {
    const selected = new Set(players.map((player) => player.player_id));
    if (options.incompatiblePairs.some(([first, second]) => selected.has(first) && selected.has(second))) return false;
  }
  return true;
}

function fractionalKnapsackProjectionBound(
  players: SolverPlayer[],
  usedIds: Set<string>,
  remainingSalary: number,
  remainingSlots: SolverRosterSlot[],
): number {
  if (remainingSalary <= 0 || !remainingSlots.length) return 0;
  const pool = players
    .filter((player) => !usedIds.has(player.player_id))
    .filter((player) => player.salary > 0 && remainingSlots.some((slot) => playerEligibleForSlot(player, slot)))
    .sort((a, b) => (adjustedProjection(b) / b.salary) - (adjustedProjection(a) / a.salary));

  let capacity = remainingSalary;
  let bound = 0;
  for (const player of pool) {
    if (capacity <= 0) break;
    const projection = adjustedProjection(player);
    if (player.salary <= capacity) {
      bound += projection;
      capacity -= player.salary;
    } else {
      bound += projection * (capacity / player.salary);
      break;
    }
  }
  return bound;
}

function slotProjectionBound(
  orderedSlots: OrderedSlot[],
  slotIndex: number,
  usedIds: Set<string>,
): number {
  let bound = 0;
  for (let index = slotIndex; index < orderedSlots.length; index += 1) {
    const best = orderedSlots[index].candidates
      .filter((player) => !usedIds.has(player.player_id))
      .reduce((maxProjection, player) => Math.max(maxProjection, adjustedProjection(player)), -Infinity);
    if (!Number.isFinite(best)) return -Infinity;
    bound += best;
  }
  return bound;
}

function cheapestSlotFeasible(
  orderedSlots: OrderedSlot[],
  slotIndex: number,
  usedIds: Set<string>,
  remainingSalary: number,
): boolean {
  let optimisticMinimumSalary = 0;
  for (let index = slotIndex; index < orderedSlots.length; index += 1) {
    const cheapest = orderedSlots[index].candidates
      .filter((player) => !usedIds.has(player.player_id))
      .reduce((best, player) => Math.min(best, player.salary), Infinity);
    if (!Number.isFinite(cheapest)) return false;
    optimisticMinimumSalary += cheapest;
  }
  return optimisticMinimumSalary <= remainingSalary;
}

function solveOneLineup(
  players: SolverPlayer[],
  slots: SolverRosterSlot[],
  salaryCap: number,
  deadlineAt: number,
  noGoodCuts: string[][],
  state: SearchState,
  options: SolverOptions,
): SolverLineup | null {
  const orderedSlots = slots
    .map((slot, originalIndex) => ({
      slot,
      originalIndex,
      candidates: players
        .filter((player) => playerEligibleForSlot(player, slot))
        .sort((a, b) => adjustedProjection(b) - adjustedProjection(a) || a.player_id.localeCompare(b.player_id)),
    }))
    .sort((a, b) => a.candidates.length - b.candidates.length || a.originalIndex - b.originalIndex);

  if (orderedSlots.some((slot) => slot.candidates.length === 0)) return null;

  let bestLineup: SolverLineup | null = null;
  let bestProjection = -Infinity;
  const selectedByOriginalSlot: Array<SolverPlayer | undefined> = new Array(slots.length);

  function search(slotIndex: number, usedIds: Set<string>, salaryUsed: number, projection: number) {
    state.iterations += 1;
    if (Date.now() > deadlineAt) {
      state.timedOut = true;
      return;
    }
    if (state.timedOut) return;

    const remainingSalary = salaryCap - salaryUsed;
    if (remainingSalary < 0) return;
    if (!cheapestSlotFeasible(orderedSlots, slotIndex, usedIds, remainingSalary)) return;

    const remainingSlots = orderedSlots.slice(slotIndex).map((entry) => entry.slot);
    // Admissible upper bound: take the tighter of two relaxations. The first relaxes
    // roster slots, uniqueness, and integrality into a fractional salary knapsack over
    // every unused player eligible for any remaining slot. The second sums the best
    // unused projection for each remaining slot while ignoring salary and cross-slot
    // duplicates. Every real lineup is feasible inside both relaxed problems, so their
    // minimum is still an upper bound and cannot prune the true optimum.
    const relaxedSalaryBound = fractionalKnapsackProjectionBound(players, usedIds, remainingSalary, remainingSlots);
    const relaxedSlotBound = slotProjectionBound(orderedSlots, slotIndex, usedIds);
    const upperBound = projection + Math.min(relaxedSalaryBound, relaxedSlotBound);
    if (upperBound < bestProjection - 1e-9) return;

    if (slotIndex === orderedSlots.length) {
      const lineupPlayers = selectedByOriginalSlot.filter((player): player is SolverPlayer => Boolean(player));
      if (!satisfiesDistinctConstraints(lineupPlayers, options)) return;
      if (violatesNoGoodCut(usedIds, noGoodCuts, options.maxSharedPlayers)) return;
      const candidateKey = lineupSignature({ players: lineupPlayers });
      const bestKey = bestLineup ? lineupSignature(bestLineup) : '';
      const isBetter = projection > bestProjection + 1e-9
        || (Math.abs(projection - bestProjection) <= 1e-9 && (salaryUsed < (bestLineup?.salary_used ?? Infinity)
          || (salaryUsed === bestLineup?.salary_used && candidateKey < bestKey)));
      if (!isBetter) return;
      bestProjection = projection;
      bestLineup = {
        players: lineupPlayers,
        projected_points: calculateProjectedPoints(lineupPlayers),
        salary_used: salaryUsed,
        confidence_score: 0,
        constraint_violations: [],
      };
      return;
    }

    const currentSlot = orderedSlots[slotIndex];
    for (const candidate of currentSlot.candidates) {
      if (usedIds.has(candidate.player_id)) continue;
      if (salaryUsed + candidate.salary > salaryCap) continue;

      usedIds.add(candidate.player_id);
      selectedByOriginalSlot[currentSlot.originalIndex] = {
        ...candidate,
        roster_slot: currentSlot.slot.slot,
        salary_multiplier: 1,
        base_salary: candidate.base_salary ?? candidate.salary,
      };
      search(slotIndex + 1, usedIds, salaryUsed + candidate.salary, projection + adjustedProjection(candidate));
      selectedByOriginalSlot[currentSlot.originalIndex] = undefined;
      usedIds.delete(candidate.player_id);

      if (state.timedOut) return;
    }
  }

  search(0, new Set<string>(), 0, 0);
  return bestLineup;
}

function addDpCandidate(frontier: DpCandidate[], candidate: DpCandidate) {
  if (frontier.some((existing) => existing.salary <= candidate.salary && existing.projection >= candidate.projection)) return;
  for (let index = frontier.length - 1; index >= 0; index -= 1) {
    const existing = frontier[index];
    if (candidate.salary <= existing.salary && candidate.projection >= existing.projection) frontier.splice(index, 1);
  }
  frontier.push(candidate);
}

function solveBestLineupDp(
  players: SolverPlayer[],
  slots: SolverRosterSlot[],
  salaryCap: number,
  deadlineAt: number,
  state: SearchState,
): SolverLineup | null {
  const fullMask = (1 << slots.length) - 1;
  const states = new Map<number, DpCandidate[]>();
  states.set(0, [{ salary: 0, projection: 0, playersByOriginalSlot: new Array(slots.length) }]);

  for (const player of players) {
    state.iterations += 1;
    if (Date.now() > deadlineAt) {
      state.timedOut = true;
      return null;
    }
    const eligibleSlotIndexes = slots
      .map((slot, index) => playerEligibleForSlot(player, slot) ? index : -1)
      .filter((index) => index >= 0);
    if (!eligibleSlotIndexes.length) continue;

    const snapshot = [...states.entries()].map(([mask, frontier]) => [mask, [...frontier]] as const);
    for (const [mask, frontier] of snapshot) {
      for (const existing of frontier) {
        for (const slotIndex of eligibleSlotIndexes) {
          const slotBit = 1 << slotIndex;
          if (mask & slotBit) continue;
          const salary = existing.salary + player.salary;
          if (salary > salaryCap) continue;
          const newMask = mask | slotBit;
          const nextPlayers = [...existing.playersByOriginalSlot];
          nextPlayers[slotIndex] = {
            ...player,
            roster_slot: slots[slotIndex].slot,
            salary_multiplier: 1,
            base_salary: player.base_salary ?? player.salary,
          };
          const next: DpCandidate = {
            salary,
            projection: existing.projection + adjustedProjection(player),
            playersByOriginalSlot: nextPlayers,
          };
          const targetFrontier = states.get(newMask) ?? [];
          addDpCandidate(targetFrontier, next);
          states.set(newMask, targetFrontier);
        }
      }
    }
  }

  const best = (states.get(fullMask) ?? [])
    .filter((candidate) => candidate.salary <= salaryCap)
    .sort((a, b) => b.projection - a.projection)[0];
  if (!best) return null;
  const lineupPlayers = best.playersByOriginalSlot.filter((player): player is SolverPlayer => Boolean(player));
  return {
    players: lineupPlayers,
    projected_points: calculateProjectedPoints(lineupPlayers),
    salary_used: best.salary,
    confidence_score: 0,
    constraint_violations: [],
  };
}

export function solveOptimalLineupsWithMeta(
  players: SolverPlayer[],
  sport: string,
  count: number,
  options: SolverOptions = {},
): ExactSolverResult {
  const startedAt = Date.now();
  const deadlineAt = startedAt + (options.deadlineMs ?? 8_000);
  const slots = options.slots ?? DEFAULT_ROSTER_SLOTS[sport] ?? [];
  const salaryCap = options.salaryCap ?? DEFAULT_SALARY_CAP;
  const noGoodCuts: string[][] = [];
  const lineups: SolverLineup[] = [];
  const signatures = new Set<string>();
  const state: SearchState = { timedOut: false, iterations: 0 };
  let bestVerified = false;

  const hasAdditionalConstraints = options.minDistinctTeams !== undefined
    || options.minDistinctGames !== undefined
    || options.maxSharedPlayers !== undefined
    || options.maxPerTeam !== undefined;
  const dpBest = hasAdditionalConstraints ? null : solveBestLineupDp(players, slots, salaryCap, deadlineAt, state);
  if (dpBest) {
    bestVerified = !state.timedOut;
    const signature = lineupSignature(dpBest);
    signatures.add(signature);
    lineups.push(dpBest);
    noGoodCuts.push(dpBest.players.map((player) => player.player_id));
  }

  while (lineups.length < count && !state.timedOut) {
    const lineup = solveOneLineup(players, slots, salaryCap, deadlineAt, noGoodCuts, state, options);
    if (!lineup) break;
    const signature = lineupSignature(lineup);
    if (!signatures.has(signature)) {
      signatures.add(signature);
      lineups.push(lineup);
    }
    noGoodCuts.push(lineup.players.map((player) => player.player_id));
  }

  if (hasAdditionalConstraints && lineups.length > 0) bestVerified = !state.timedOut;

  return {
    lineups,
    elapsedMs: Date.now() - startedAt,
    timedOut: state.timedOut,
    iterations: state.iterations,
    bestVerified,
  };
}

export function solveOptimalLineups(
  players: SolverPlayer[],
  sport: string,
  count: number,
  options: SolverOptions = {},
): SolverLineup[] {
  return solveOptimalLineupsWithMeta(players, sport, count, options).lineups;
}
