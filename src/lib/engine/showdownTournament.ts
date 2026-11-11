import type { ValidatedSlate } from './contracts.js';

// Showdown tournament model.
//
// Large Showdown tournaments are won by lineups that score near the top *and* are not shared
// with many other entries: a first-place lineup duplicated 20 times splits first through
// twenty-first place. DraftKings publishes no opponent ownership, so the field is modeled by
// projection disagreement: each simulated opponent builds the best lineup under its own noisy
// version of the projections (sharp players stay close to consensus, casual players drift
// further). Those opponents concentrate on popular captains and lineups the way real fields do,
// which yields duplicate counts and finish positions. Each candidate is then scored against
// that field on the same correlated player outcome samples, and paid out from the contest's
// payout table when it is available, otherwise from an approximate top-heavy curve.
//
// This is a model, not observed entries. Weights (field mix, noise levels, payout curve) are
// provisional until compared with real contest results.

export interface ShowdownFieldLineup { rosterSlots: Record<string, string>; salaryUsed: number; copies: number; key: string; }
export interface ShowdownField { lineups: ShowdownFieldLineup[]; simulatedOpponents: number; }
export interface ShowdownTournamentMetrics { expectedDuplicates: number; winFrequency: number; topOnePercentFrequency: number; cashFrequency: number; expectedPayoutMultiple: number; roi: number; }
export interface ShowdownTournamentResult { contestSize: number; paidPositions: number; payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'APPROXIMATE_CURVE'; simulatedOpponents: number; metrics: Map<string, ShowdownTournamentMetrics>; }

// Sharp entrants stay near consensus projections; regular ones disagree more; casual entrants
// build loosely (very wide noise), which spreads the field across many more players, as real
// Showdown fields are.
const FIELD_MIX = [{ share: 0.4, noise: 0.15 }, { share: 0.35, noise: 0.35 }, { share: 0.25, noise: 0.9 }];
const DEFAULT_OPPONENTS = 3000;
const APPROX_PAID_SHARE = 0.22;
const APPROX_RAKE = 0.15;
const APPROX_MIN_CASH_MULTIPLE = 2;
const APPROX_CURVE_EXPONENT = 1.15;

/** Lineup identity for Showdown: the same six players with a different Captain is a different entry. */
export function showdownLineupKey(rosterSlots: Record<string, string>): string {
  const entries = Object.entries(rosterSlots);
  const captain = entries.find(([slot]) => /^(CPT|CAPTAIN|MVP)/i.test(slot))?.[1] ?? '';
  return `${captain}|${entries.filter(([slot]) => !/^(CPT|CAPTAIN|MVP)/i.test(slot)).map(([, id]) => id).sort().join(',')}`;
}

export function buildShowdownField(playerMeans: Map<string, number>, findBest: (value: (playerId: string) => number) => { rosterSlots: Record<string, string>; salaryUsed: number } | undefined, seedText: string, opponents = DEFAULT_OPPONENTS): ShowdownField {
  let state = hash(seedText) || 1;
  const random = () => { state = next(state); return state / 0x1_0000_0000; };
  const normal = () => { const u1 = Math.max(1e-12, random()); const u2 = random(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
  const byKey = new Map<string, ShowdownFieldLineup>();
  let built = 0;
  for (const group of FIELD_MIX) {
    const count = Math.round(opponents * group.share);
    for (let index = 0; index < count; index += 1) {
      const view = new Map<string, number>();
      for (const [playerId, mean] of playerMeans) view.set(playerId, mean * Math.exp(group.noise * normal() - group.noise * group.noise / 2));
      const lineup = findBest((playerId) => view.get(playerId) ?? 0);
      if (!lineup) continue;
      built += 1;
      const key = showdownLineupKey(lineup.rosterSlots);
      const existing = byKey.get(key);
      if (existing) existing.copies += 1; else byKey.set(key, { ...lineup, copies: 1, key });
    }
  }
  return { lineups: [...byKey.values()], simulatedOpponents: built };
}

export interface ShowdownSolverPlayer { playerId: string; team?: string; utilitySalary: number; captainSalary: number; }

/**
 * Exact best Showdown lineup (one Captain at 1.5x value, the rest as an unordered set) under the
 * salary cap and a minimum-teams rule. Treating the UTIL spots as a set avoids re-searching the
 * same players in every slot order, which is what makes simulating thousands of opponents cheap.
 */
export function bestShowdownLineup(players: ShowdownSolverPlayer[], value: (playerId: string) => number, options: { salaryCap: number; captainSlot: string; utilitySlots: string[]; minimumTeams?: number; captainMultiplier?: number }): { rosterSlots: Record<string, string>; salaryUsed: number } | undefined {
  const picks = options.utilitySlots.length;
  const multiplier = options.captainMultiplier ?? 1.5;
  const sorted = players.map((player) => ({ ...player, value: value(player.playerId) })).sort((a, b) => b.value - a.value);
  const n = sorted.length;
  if (n < picks + 1) return undefined;
  // Upper bounds: suffixTop[i][k] = sum of the k highest values at index >= i (sorted, so the next k).
  const prefix = [0]; for (const player of sorted) prefix.push(prefix[prefix.length - 1] + player.value);
  const nextK = (start: number, k: number) => prefix[Math.min(n, start + k)] - prefix[start];
  const cheapest = [...sorted.map((player) => player.utilitySalary)].sort((a, b) => a - b);
  const cheapSum = [0]; for (const salary of cheapest) cheapSum.push(cheapSum[cheapSum.length - 1] + salary);
  let bestValue = -Infinity; let best: { captain: number; utility: number[]; salary: number } | undefined;
  const chosen: number[] = [];
  for (let captain = 0; captain < n; captain += 1) {
    const captainPlayer = sorted[captain];
    const captainValue = captainPlayer.value * multiplier;
    // The top `picks` values bound any UTIL set; captains are value-sorted, so later ones are worse.
    if (captainValue + nextK(0, picks) <= bestValue) break;
    // `salary` below already includes the Captain's salary, so compare it against the full cap.
    if (captainPlayer.captainSalary + cheapSum[picks] > options.salaryCap) continue;
    const visit = (start: number, valueSoFar: number, salary: number): void => {
      const remaining = picks - chosen.length;
      if (remaining === 0) {
        if (options.minimumTeams && options.minimumTeams > 1) {
          const teams = new Set([captainPlayer.team, ...chosen.map((index) => sorted[index].team)].filter(Boolean));
          if (teams.size < options.minimumTeams) return;
        }
        if (valueSoFar > bestValue) { bestValue = valueSoFar; best = { captain, utility: [...chosen], salary }; }
        return;
      }
      for (let index = start; index < n; index += 1) {
        if (index === captain) continue;
        const player = sorted[index];
        // Values are sorted descending, so once even the best remaining picks cannot win, stop.
        if (valueSoFar + player.value + nextK(index + 1, remaining - 1) <= bestValue) break;
        if (salary + player.utilitySalary + cheapSum[remaining - 1] > options.salaryCap) continue;
        chosen.push(index);
        visit(index + 1, valueSoFar + player.value, salary + player.utilitySalary);
        chosen.pop();
      }
    };
    visit(0, captainValue, captainPlayer.captainSalary);
  }
  if (!best) return undefined;
  const rosterSlots: Record<string, string> = { [options.captainSlot]: sorted[best.captain].playerId };
  best.utility.forEach((index, position) => { rosterSlots[options.utilitySlots[position]] = sorted[index].playerId; });
  return { rosterSlots, salaryUsed: best.salary };
}

export function evaluateShowdownTournament(slate: ValidatedSlate, candidates: Array<{ id: string; rosterSlots: Record<string, string>; simulatedScoreSamples?: number[] }>, field: ShowdownField, scoreLineup: (rosterSlots: Record<string, string>) => number[], contestSize: number): ShowdownTournamentResult | undefined {
  if (!field.simulatedOpponents || !(contestSize >= 2)) return undefined;
  const opponents = contestSize - 1;
  const weightPerCopy = opponents / field.simulatedOpponents;
  const fieldScores = field.lineups.map((lineup) => scoreLineup(lineup.rosterSlots));
  const sampleCount = Math.min(...fieldScores.map((scores) => scores.length), ...candidates.map((candidate) => candidate.simulatedScoreSamples?.length ?? Infinity));
  if (!Number.isFinite(sampleCount) || sampleCount < 16) return undefined;

  const payout = payoutTable(slate, contestSize);
  // Per outcome sample: field scores sorted descending with cumulative entry counts, so the
  // number of opponents ahead of any score is a binary search.
  const sortedBySample = Array.from({ length: sampleCount }, (_, sample) => {
    const rows = field.lineups.map((lineup, index) => ({ score: fieldScores[index][sample], weight: lineup.copies * weightPerCopy })).sort((a, b) => b.score - a.score);
    const cumulative: number[] = []; let running = 0;
    for (const row of rows) { running += row.weight; cumulative.push(running); }
    return { scores: rows.map((row) => row.score), cumulative };
  });
  const fieldCopies = new Map(field.lineups.map((lineup) => [lineup.key, lineup.copies * weightPerCopy]));
  const topOnePercent = Math.max(1, Math.ceil(contestSize * 0.01));
  const metrics = new Map<string, ShowdownTournamentMetrics>();
  for (const candidate of candidates) {
    const samples = candidate.simulatedScoreSamples;
    if (!samples?.length) continue;
    const key = showdownLineupKey(candidate.rosterSlots);
    const duplicates = fieldCopies.get(key) ?? 0;
    let wins = 0; let topOne = 0; let cash = 0; let paid = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const score = samples[sample];
      const { scores, cumulative } = sortedBySample[sample];
      // Opponents strictly ahead. Identical lineups score identically, so this excludes duplicates.
      let low = 0; let high = scores.length;
      while (low < high) { const mid = (low + high) >> 1; if (scores[mid] > score + 1e-9) low = mid + 1; else high = mid; }
      const ahead = low > 0 ? cumulative[low - 1] : 0;
      const position = ahead + 1;
      // The entry and its duplicates share positions position..position+duplicates equally.
      const share = averagePayout(payout, position, duplicates);
      paid += share;
      if (position <= 1) wins += 1 / (1 + duplicates);
      if (position <= topOnePercent) topOne += 1;
      if (position <= payout.paidPositions) cash += 1;
    }
    const expectedPayoutMultiple = paid / sampleCount;
    metrics.set(candidate.id, { expectedDuplicates: duplicates, winFrequency: wins / sampleCount, topOnePercentFrequency: topOne / sampleCount, cashFrequency: cash / sampleCount, expectedPayoutMultiple, roi: expectedPayoutMultiple - 1 });
  }
  return { contestSize, paidPositions: payout.paidPositions, payoutModel: payout.model, simulatedOpponents: field.simulatedOpponents, metrics };
}

interface PayoutTable { paidPositions: number; model: ShowdownTournamentResult['payoutModel']; prefix: number[]; }

// Payouts in multiples of the entry fee. prefix[k] = total paid to positions 1..k.
function payoutTable(slate: ValidatedSlate, contestSize: number): PayoutTable {
  const fee = slate.contest.entryFee;
  const structure = slate.contest.payoutStructure ?? [];
  const paidPositions = slate.contest.paidPositions;
  if (fee && fee > 0 && paidPositions && paidPositions >= 1 && structure.length) {
    const byRank = new Map(structure.map((row) => [row.rank, row.payout / fee]));
    if (Array.from({ length: paidPositions }, (_, index) => index + 1).every((rank) => byRank.has(rank))) {
      const prefix = [0]; for (let rank = 1; rank <= paidPositions; rank += 1) prefix.push(prefix[rank - 1] + (byRank.get(rank) ?? 0));
      return { paidPositions, model: 'CONTEST_PAYOUT_STRUCTURE', prefix };
    }
  }
  // Approximate DraftKings Showdown tournament: ~22% of entries paid, ~15% rake, min cash 2x,
  // the rest on a power-law curve toward first place.
  const paid = Math.max(1, Math.round(contestSize * APPROX_PAID_SHARE));
  const pool = contestSize * (1 - APPROX_RAKE);
  const floor = Math.pow(paid, -APPROX_CURVE_EXPONENT);
  let shape = 0; for (let rank = 1; rank <= paid; rank += 1) shape += Math.pow(rank, -APPROX_CURVE_EXPONENT) - floor;
  const minCash = Math.min(APPROX_MIN_CASH_MULTIPLE, pool / paid);
  const scale = shape > 0 ? (pool - minCash * paid) / shape : 0;
  const prefix = [0]; for (let rank = 1; rank <= paid; rank += 1) prefix.push(prefix[rank - 1] + minCash + scale * (Math.pow(rank, -APPROX_CURVE_EXPONENT) - floor));
  return { paidPositions: paid, model: 'APPROXIMATE_CURVE', prefix };
}

/** Average payout over positions [position, position + duplicates] (fractional positions allowed). */
function averagePayout(table: PayoutTable, position: number, duplicates: number): number {
  const start = position - 1; const end = position + duplicates;
  const total = cumulativeAt(table, end) - cumulativeAt(table, start);
  return total / (duplicates + 1);
}
function cumulativeAt(table: PayoutTable, positions: number): number {
  if (positions <= 0) return 0;
  const capped = Math.min(positions, table.paidPositions);
  const whole = Math.floor(capped);
  const fraction = capped - whole;
  const next = whole < table.paidPositions ? table.prefix[whole + 1] - table.prefix[whole] : 0;
  return table.prefix[whole] + fraction * next;
}

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; }
function next(value: number): number { let result = value; result ^= result << 13; result ^= result >>> 17; result ^= result << 5; return result >>> 0; }
