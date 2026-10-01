import type { LineupCandidate, ValidatedSlate } from './contracts.js';

export interface ContestSimulationOptions {
  simulations?: number;
  fieldEntries?: number;
  seed?: string;
}

export interface ContestSimulationResult {
  status: 'COMPLETE' | 'UNAVAILABLE';
  simulations: number;
  fieldEntries?: number;
  fieldModel: 'PROJECTED_OWNERSHIP' | 'UNAVAILABLE';
  payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'UNAVAILABLE';
  reason?: string;
  metrics: Map<string, { variance: number; winFrequency: number; topOnePercentFrequency: number; cashFrequency: number; expectedDuplicates: number; expectedPayout?: number; roi?: number }>;
}

/**
 * Simulates a coherent contest field from the same candidate outcome samples used by Optimize.
 * A contest field is simulated only from verified projected ownership supplied on every roster
 * slot. Construction proxies are useful optimizer diagnostics, but cannot support tournament
 * frequency or ROI claims.
 */
export function simulateContestField(slate: ValidatedSlate, candidates: LineupCandidate[], options: ContestSimulationOptions = {}): ContestSimulationResult {
  const totalEntries = slate.contest.contestSize;
  if (!totalEntries || totalEntries < 2) return unavailable('contest.contestSize must include the evaluated entry and at least one opponent.');
  if (!Number.isInteger(totalEntries)) return unavailable('contest.contestSize must be an integer count of total entries, including the evaluated entry.');
  if (totalEntries > 10_000) return unavailable('Contest fields above 10,000 entries are unavailable until a validated large-field approximation is implemented.');
  const opponentEntries = totalEntries - 1;
  const simulationCount = Math.max(1, Math.min(2048, options.simulations ?? 512));
  const hasProjectedOwnership = candidates.length > 0 && candidates.every((candidate) => candidate.rosterSlots && Object.entries(candidate.rosterSlots).every(([slot, playerId]) => {
    const player = slate.playerPool.find((row) => row.playerId === playerId);
    const ownership = player?.projectedOwnership;
    const value = slot.toUpperCase() === 'CPT' ? ownership?.captain : slot.toUpperCase() === 'UTIL' ? ownership?.utility : ownership?.classic;
    return ownership?.source === 'PROVIDER' && typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }));
  if (!candidates.length) return unavailable('No optimizer candidates are available for field simulation.');
  if (!hasProjectedOwnership) return unavailable('Verified provider projected ownership is required for contest-field simulation; construction heuristics are not used as a field model.');
  const weights = candidates.map((candidate) => Math.max(0.001, projectedOwnershipWeight(candidate, slate)));
  const totals = new Map(candidates.map((candidate) => [candidate.id, { sum: 0, sumSquared: 0, wins: 0, top: 0, cash: 0, duplicates: 0, payout: 0 }]));
  const candidateIndexes = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  let seed = hash(options.seed ?? slate.slateId);
  const payoutModel = hasCompletePayoutStructure(slate) ? 'CONTEST_PAYOUT_STRUCTURE' : 'UNAVAILABLE';
  const paidPositions = slate.contest.paidPositions;
  const validPaidPositions = Number.isInteger(paidPositions) && paidPositions! > 0 && paidPositions! <= totalEntries;
  const paidFraction = validPaidPositions ? paidPositions! / totalEntries : undefined;
  for (let simulation = 0; simulation < simulationCount; simulation += 1) {
    const field = Array.from({ length: opponentEntries }, () => { seed = next(seed); return weightedIndex(weights, seed / 4294967296); });
    const fieldScores = field.map((candidateIndex) => sampleAt(candidates[candidateIndex], simulation)).sort((a, b) => b - a);
    const fieldCounts = new Map<number, number>();
    for (const candidateIndex of field) fieldCounts.set(candidateIndex, (fieldCounts.get(candidateIndex) ?? 0) + 1);
    for (const candidate of candidates) {
      const score = sampleAt(candidate, simulation);
      const rank = 1 + countGreater(fieldScores, score);
      const state = totals.get(candidate.id)!;
      state.sum += score;
      state.sumSquared += score * score;
      if (rank === 1) state.wins += 1;
      if (rank <= Math.max(1, Math.ceil(totalEntries * 0.01))) state.top += 1;
      if (paidFraction !== undefined && rank <= paidPositions!) state.cash += 1;
      const duplicateCount = Math.max(0, (fieldCounts.get(candidateIndexes.get(candidate.id)!) ?? 0) - 1);
      state.duplicates += duplicateCount;
      if (payoutModel === 'CONTEST_PAYOUT_STRUCTURE') state.payout += payoutForRank(slate, rank, fieldScores.filter((fieldScore) => fieldScore === score).length + 1);
    }
  }
  const metrics = new Map<string, ContestSimulationResult['metrics'] extends Map<string, infer V> ? V : never>();
  for (const candidate of candidates) {
    const state = totals.get(candidate.id)!;
    const mean = state.sum / simulationCount;
    const variance = Math.max(0, state.sumSquared / simulationCount - mean * mean);
    const expectedPayout = payoutModel === 'CONTEST_PAYOUT_STRUCTURE' ? state.payout / simulationCount : undefined;
    metrics.set(candidate.id, { variance, winFrequency: state.wins / simulationCount, topOnePercentFrequency: state.top / simulationCount, cashFrequency: state.cash / simulationCount, expectedDuplicates: state.duplicates / simulationCount, ...(expectedPayout !== undefined ? { expectedPayout, roi: slate.contest.entryFee ? expectedPayout / slate.contest.entryFee - 1 : undefined } : {}) });
  }
  return { status: 'COMPLETE', simulations: simulationCount, fieldEntries: totalEntries, fieldModel: 'PROJECTED_OWNERSHIP', payoutModel, metrics };
}

function unavailable(reason: string): ContestSimulationResult { return { status: 'UNAVAILABLE', simulations: 0, fieldModel: 'UNAVAILABLE', payoutModel: 'UNAVAILABLE', reason, metrics: new Map() }; }
function sampleAt(candidate: LineupCandidate, index: number): number { const samples = candidate.simulatedScoreSamples; return samples?.length ? samples[index % samples.length] : candidate.median; }
function projectedOwnershipWeight(candidate: LineupCandidate, slate: ValidatedSlate): number { const values = Object.entries(candidate.rosterSlots).flatMap(([slot, playerId]) => { const ownership = slate.playerPool.find((player) => player.playerId === playerId)?.projectedOwnership; const value = slot.toUpperCase() === 'CPT' ? ownership?.captain : slot.toUpperCase() === 'UTIL' ? ownership?.utility : ownership?.classic; return typeof value === 'number' && Number.isFinite(value) ? [Math.max(0.001, value)] : []; }); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0. }
function weightedIndex(weights: number[], random: number): number { const total = weights.reduce((sum, weight) => sum + weight, 0); let cursor = random * total; for (let index = 0; index < weights.length; index += 1) { cursor -= weights[index]; if (cursor <= 0) return index; } return weights.length - 1; }
function hasCompletePayoutStructure(slate: ValidatedSlate): boolean {
  const paidPositions = slate.contest.paidPositions;
  const fee = slate.contest.entryFee;
  const payouts = slate.contest.payoutStructure;
  if (!Number.isInteger(paidPositions) || !paidPositions || !Number.isFinite(fee) || !fee || !payouts?.length) return false;
  const byRank = new Map<number, number>();
  for (const payout of payouts) {
    if (!Number.isInteger(payout.rank) || payout.rank < 1 || !Number.isFinite(payout.payout) || payout.payout < 0 || byRank.has(payout.rank)) return false;
    byRank.set(payout.rank, payout.payout);
  }
  return Array.from({ length: paidPositions }, (_, index) => index + 1).every((rank) => byRank.has(rank));
}
function payoutForRank(slate: ValidatedSlate, rank: number, tieCount: number): number {
  // A tie shares the sum of the prizes for the occupied ranks; repeated copies of the same
  // lineup then split that tied payout again. This avoids the old error of awarding only the
  // first tied rank's prize and dividing it by an unrelated count.
  const tiedPrize = Array.from({ length: Math.max(1, tieCount) }, (_, index) => slate.contest.payoutStructure?.find((entry) => entry.rank === rank + index)?.payout ?? 0).reduce((sum, payout) => sum + payout, 0);
  return tiedPrize / Math.max(1, tieCount);
}
function countGreater(sortedDescending: number[], value: number): number { let low = 0; let high = sortedDescending.length; while (low < high) { const middle = Math.floor((low + high) / 2); if (sortedDescending[middle] > value) low = middle + 1; else high = middle; } return low; }
function hash(value: string): number { return [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 17); }
function next(seed: number): number { return (1664525 * seed + 1013904223) >>> 0; }
