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
  fieldModel: 'HEURISTIC_CONSTRUCTION_PROXY' | 'PROJECTED_OWNERSHIP';
  payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'UNAVAILABLE';
  reason?: string;
  metrics: Map<string, { variance: number; winFrequency: number; topOnePercentFrequency: number; cashFrequency: number; expectedDuplicates: number; expectedPayout?: number; roi?: number }>;
}

/**
 * Simulates a coherent contest field from the same candidate outcome samples used by Optimize.
 * Because this repo has no verified projected-ownership feed, the field weights are explicitly
 * construction proxies. Payout metrics are emitted only when a payout table and entry fee are
 * present on the validated contest.
 */
export function simulateContestField(slate: ValidatedSlate, candidates: LineupCandidate[], options: ContestSimulationOptions = {}): ContestSimulationResult {
  const requestedFieldEntries = slate.contest.contestSize;
  if (!requestedFieldEntries || requestedFieldEntries < 2) return unavailable('contest.contestSize is required for field simulation.');
  const fieldEntries = Math.min(10_000, requestedFieldEntries);
  const simulationCount = Math.max(1, Math.min(2048, options.simulations ?? 512));
  const hasProjectedOwnership = candidates.every((candidate) => candidate.rosterSlots && Object.entries(candidate.rosterSlots).every(([slot, playerId]) => { const player = slate.playerPool.find((row) => row.playerId === playerId); const ownership = player?.projectedOwnership; const value = slot.toUpperCase() === 'CPT' ? ownership?.captain : slot.toUpperCase() === 'UTIL' ? ownership?.utility : ownership?.classic; return ownership?.source === 'PROVIDER' && typeof value === 'number' && Number.isFinite(value) && value >= 0; }));
  const weights = candidates.map((candidate) => Math.max(0.001, hasProjectedOwnership ? projectedOwnershipWeight(candidate, slate) : candidate.heuristicOwnershipProxy ?? 0));
  if (!candidates.length || weights.every((weight) => !Number.isFinite(weight))) return unavailable('No candidate construction weights are available for field simulation.');
  const totals = new Map(candidates.map((candidate) => [candidate.id, { sum: 0, sumSquared: 0, wins: 0, top: 0, cash: 0, duplicates: 0, payout: 0 }]));
  const candidateIndexes = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  let seed = hash(options.seed ?? slate.slateId);
  const payoutModel = Array.isArray(slate.contest.payoutStructure) && Number.isFinite(slate.contest.entryFee) ? 'CONTEST_PAYOUT_STRUCTURE' : 'UNAVAILABLE';
  const paidFraction = slate.contest.paidPositions && fieldEntries ? slate.contest.paidPositions / fieldEntries : undefined;
  for (let simulation = 0; simulation < simulationCount; simulation += 1) {
    const field = Array.from({ length: fieldEntries }, () => { seed = next(seed); return weightedIndex(weights, seed / 4294967296); });
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
      if (rank <= Math.max(1, Math.ceil(fieldEntries * 0.01))) state.top += 1;
      if (paidFraction !== undefined && rank <= Math.max(1, slate.contest.paidPositions ?? 0)) state.cash += 1;
      const duplicateCount = Math.max(0, (fieldCounts.get(candidateIndexes.get(candidate.id)!) ?? 0) - 1);
      state.duplicates += duplicateCount;
      if (payoutModel === 'CONTEST_PAYOUT_STRUCTURE') state.payout += payoutForRank(slate, rank, duplicateCount, fieldScores.filter((fieldScore) => fieldScore === score).length);
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
  return { status: 'COMPLETE', simulations: simulationCount, fieldEntries, fieldModel: hasProjectedOwnership ? 'PROJECTED_OWNERSHIP' : 'HEURISTIC_CONSTRUCTION_PROXY', payoutModel, metrics };
}

function unavailable(reason: string): ContestSimulationResult { return { status: 'UNAVAILABLE', simulations: 0, fieldModel: 'HEURISTIC_CONSTRUCTION_PROXY', payoutModel: 'UNAVAILABLE', reason, metrics: new Map() }; }
function sampleAt(candidate: LineupCandidate, index: number): number { const samples = candidate.simulatedScoreSamples; return samples?.length ? samples[index % samples.length] : candidate.median; }
function projectedOwnershipWeight(candidate: LineupCandidate, slate: ValidatedSlate): number { const values = Object.entries(candidate.rosterSlots).flatMap(([slot, playerId]) => { const ownership = slate.playerPool.find((player) => player.playerId === playerId)?.projectedOwnership; const value = slot.toUpperCase() === 'CPT' ? ownership?.captain : slot.toUpperCase() === 'UTIL' ? ownership?.utility : ownership?.classic; return typeof value === 'number' && Number.isFinite(value) ? [Math.max(0.001, value)] : []; }); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0. }
function weightedIndex(weights: number[], random: number): number { const total = weights.reduce((sum, weight) => sum + weight, 0); let cursor = random * total; for (let index = 0; index < weights.length; index += 1) { cursor -= weights[index]; if (cursor <= 0) return index; } return weights.length - 1; }
function payoutForRank(slate: ValidatedSlate, rank: number, duplicateCount: number, tieCount: number): number { const payout = slate.contest.payoutStructure?.find((entry) => entry.rank === rank)?.payout ?? 0; const splitCount = Math.max(1, tieCount) * Math.max(1, duplicateCount + 1); return payout / splitCount; }
function countGreater(sortedDescending: number[], value: number): number { let low = 0; let high = sortedDescending.length; while (low < high) { const middle = Math.floor((low + high) / 2); if (sortedDescending[middle] > value) low = middle + 1; else high = middle; } return low; }
function hash(value: string): number { return [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 17); }
function next(seed: number): number { return (1664525 * seed + 1013904223) >>> 0; }
