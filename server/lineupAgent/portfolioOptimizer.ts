import { createHash } from 'node:crypto';
import type { LineupCandidate, OptimizerPackage, ResearchPackage, SelectionPackage, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { selectLineups, overlap } from '../../src/lib/engine/selection.js';
import { validateLineupCandidate } from '../../src/lib/engine/validation.js';
import type { CashLineCalibration } from '../../src/lib/engine/cashLineCalibration.js';
import { assessContestPayoutReadiness } from './contest.js';

export interface JointFieldScenarios {
  fieldModelVersion: string;
  datasetSha256: string;
  simulationVersion: string;
  seed: string;
  slateId: string;
  contestId: string;
  asOf: string;
  rulesHash: string;
  candidateIds: string[];
  /** One shared row per simulation. Each row contains the non-user contest field scores. */
  opponentScoresByTrial: number[][];
  /** Candidate fantasy score per same trial index; this preserves common scenario correlation. */
  candidateScoresById: Record<string, number[]>;
}
export interface PortfolioOptimizerInput {
  slate: ValidatedSlate; research: ResearchPackage; optimizer: OptimizerPackage; seed: string;
  fieldReadiness: 'CALIBRATED' | 'UNVALIDATED' | 'UNAVAILABLE';
  fieldReadinessReason?: string;
  cashLineCalibration?: CashLineCalibration; lockedRosterSlots?: Record<string, string>;
  jointFieldScenarios?: JointFieldScenarios; searchBudget?: number;
}

/** Bounded combination search. Dollar optimization is enabled only with complete verified terms and explicit calibrated common field scenarios. */
export function optimizePortfolio(input: PortfolioOptimizerInput, now = new Date()): SelectionPackage {
  const count = input.slate.contest.requestedEntryCount; const entryLimit = input.slate.contest.maxEntriesAllowed ?? count;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(entryLimit) || entryLimit < 1 || count > entryLimit) throw new Error('Requested portfolio entry count must be a positive integer within the verified contest entry limit.');
  if (!input.seed.trim()) throw new Error('Portfolio optimization requires an explicit replay seed.');
  const budget = Math.max(1, Math.min(1_000_000, Math.floor(input.searchBudget ?? 50_000)));
  const constraints = input.optimizer.portfolioConstraints ?? {};
  for (const [name, value] of Object.entries(constraints)) if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`Portfolio constraint ${name} must be a finite fraction from 0 to 1.`);
  const payout = assessContestPayoutReadiness(input.slate, { status: input.fieldReadiness === 'UNVALIDATED' ? 'EXPERIMENTAL' : input.fieldReadiness, ...(input.jointFieldScenarios?.fieldModelVersion ? { version: input.jointFieldScenarios.fieldModelVersion } : {}) });
  const scenarios = validJointScenarios(input, payout.payoutTiers.length);
  const financialReady = payout.status === 'READY' && input.fieldReadiness === 'CALIBRATED' && scenarios !== null;
  const legalCandidates = input.optimizer.candidates.filter((candidate, index, all) => all.findIndex((row) => row.id === candidate.id) === index
    && validateLineupCandidate(candidate, input.slate, { lockedSlotAssignments: input.lockedRosterSlots }).length === 0);
  const baseline = selectLineups({ validatedSlate: input.slate, researchPackage: input.research, optimizerPackage: { ...input.optimizer, candidates: legalCandidates }, ...(input.cashLineCalibration ? { cashLineCalibration: input.cashLineCalibration } : {}), ...(input.lockedRosterSlots ? { lockedRosterSlots: input.lockedRosterSlots } : {}) }, now);
  const utility = new Map(legalCandidates.map((candidate) => [candidate.id, candidateUtility(candidate, legalCandidates, input.slate)]));
  let best = baseline.selectedLineups.map((lineup) => legalCandidates.find((candidate) => candidate.id === lineup.candidateId)).filter((row): row is LineupCandidate => Boolean(row));
  let bestValue = best.length === count ? (financialReady ? jointNetSamples(best, scenarios!, payout.payoutTiers, payout.fieldSize!, payout.entryFee!).mean : best.reduce((sum, row) => sum + (utility.get(row.id) ?? 0), 0)) : -Infinity;
  let nodes = 0; let exhausted = false; let constraintRejectedBranches = 0; const chosen: LineupCandidate[] = [];
  const visit = (start: number) => {
    if (nodes >= budget) { exhausted = true; return; }
    nodes += 1;
    if (chosen.length === count) {
      const value = financialReady ? jointNetSamples(chosen, scenarios!, payout.payoutTiers, payout.fieldSize!, payout.entryFee!).mean : chosen.reduce((sum, row) => sum + (utility.get(row.id) ?? 0), 0);
      if (value > bestValue) { bestValue = value; best = [...chosen]; }
      return;
    }
    if (legalCandidates.length - start < count - chosen.length) return;
    for (let index = start; index <= legalCandidates.length - (count - chosen.length); index += 1) {
      const candidate = legalCandidates[index]!;
      if (!canAdd(chosen, candidate, constraints, count)) { constraintRejectedBranches += 1; continue; }
      chosen.push(candidate); visit(index + 1); chosen.pop();
      if (exhausted) return;
    }
  };
  visit(0);
  const selectedPackage = best.length === count
    ? selectLineups({ validatedSlate: input.slate, researchPackage: input.research, optimizerPackage: { ...input.optimizer, candidates: best, portfolioConstraints: undefined }, ...(input.cashLineCalibration ? { cashLineCalibration: input.cashLineCalibration } : {}), ...(input.lockedRosterSlots ? { lockedRosterSlots: input.lockedRosterSlots } : {}) }, now)
    : baseline;
  const partial = selectedPackage.status === 'BLOCKED' || selectedPackage.selectedLineups.length !== count || exhausted || input.optimizer.searchCompleteness === 'BOUNDED';
  const jointOutcomes = financialReady && best.length === count ? jointNetSamples(best, scenarios!, payout.payoutTiers, payout.fieldSize!, payout.entryFee!) : null;
  const samples = jointOutcomes?.samples ?? [];
  const ev = samples.length ? summary(samples) : null;
  const readinessReason = financialReady ? null : [input.fieldReadinessReason, ...payout.warnings, input.fieldReadinessReason || payout.warnings.length ? null : input.fieldReadiness !== 'CALIBRATED' ? 'An independently reviewed calibrated field model is not available.' : !input.jointFieldScenarios ? 'A certified joint field scenario set is not available.' : 'The joint field scenario set failed identity, cutoff, candidate, rules, or score-shape validation.'].filter((reason): reason is string => Boolean(reason)).join(' ');
  const result: SelectionPackage = {
    ...selectedPackage, status: selectedPackage.status === 'BLOCKED' ? 'BLOCKED' : partial ? 'PARTIAL' : 'COMPLETE',
    warnings: [...selectedPackage.warnings, ...(!financialReady ? ['Portfolio used bounded joint score/upside selection. Expected net return is unavailable because complete contest/payout and calibrated common field scenarios are not present.'] : []), ...(exhausted ? [`Portfolio combination search reached its ${budget} node budget; the best feasible portfolio found is returned.`] : [])],
    portfolioOptimization: {
      modelVersion: 'lineup-agent.portfolio-optimizer.v2', seed: input.seed,
      candidateSetSha256: sha256(stableJson(legalCandidates.map((candidate) => ({ id: candidate.id, rosterSlots: candidate.rosterSlots, simulatedScoreSamples: candidate.simulatedScoreSamples ?? [], median: candidate.median, ceiling: candidate.ceiling })))),
      requestedCount: count, entryLimit, selectedCount: selectedPackage.selectedLineups.length,
      objective: financialReady ? 'MAX_EXPECTED_NET_RETURN' : 'SAFE_SCORE_UPSIDE', fieldReadiness: input.fieldReadiness, fieldReadinessReason: readinessReason, constraints,
      rejectedConstraintCount: Math.max(0, legalCandidates.length - best.length), status: partial ? 'OPTIMIZATION_PARTIAL' : 'COMPLETE', globalOptimalityClaimed: false,
      search: { algorithm: 'BOUNDED_COMBINATION_ENUMERATION', nodesVisited: nodes, nodeBudget: budget, complete: !exhausted, constraintRejectedBranches },
      fieldScenarioSetSha256: financialReady ? sha256(stableJson(scenarios)) : null,
      fieldScenarioDatasetSha256: financialReady ? scenarios.datasetSha256 : null,
      fieldScenarioSeed: financialReady ? scenarios.seed : null,
      fieldScenarioSimulationVersion: financialReady ? scenarios.simulationVersion : null,
      fieldScenarioAsOf: financialReady ? scenarios.asOf : null,
      fieldScenarioRulesHash: financialReady ? scenarios.rulesHash : null,
      portfolioCashProbability: jointOutcomes?.grossPayouts.length ? jointOutcomes.grossPayouts.filter((value) => value > 0).length / jointOutcomes.grossPayouts.length : null,
      portfolioLossProbability: samples.length ? samples.filter((value) => value < 0).length / samples.length : null,
      expectedNetReturn: ev?.mean ?? null, expectedNetReturnStandardError: ev?.standardError ?? null,
      expectedNetReturnP10: ev?.p10 ?? null, expectedNetReturnP90: ev?.p90 ?? null,
    },
  };
  return result;
}

function validJointScenarios(input: PortfolioOptimizerInput, paidRankCount: number) {
  const scenarios = input.jointFieldScenarios; const fieldSize = input.slate.contest.contestSize; const count = input.slate.contest.requestedEntryCount;
  const expectedIds = input.optimizer.candidates.map((candidate) => candidate.id).sort();
  const declaredIds = scenarios?.candidateIds?.slice().sort() ?? [];
  if (!scenarios || !scenarios.fieldModelVersion.trim() || !/^[a-f0-9]{64}$/i.test(scenarios.datasetSha256) || !scenarios.simulationVersion.trim() || !scenarios.seed.trim() || scenarios.seed !== input.seed || scenarios.slateId !== input.slate.slateId || scenarios.contestId !== input.slate.contest.draftKingsContestId || !utc(scenarios.asOf) || Date.parse(scenarios.asOf) > Date.parse(input.slate.contest.lockTime) || scenarios.rulesHash !== contestRulesHash(input.slate) || !sameStrings(expectedIds, declaredIds) || !sameStrings(expectedIds, Object.keys(scenarios.candidateScoresById).sort()) || !Number.isInteger(fieldSize) || fieldSize! < count || !Number.isFinite(input.slate.contest.entryFee) || !paidRankCount) return null;
  const trials = scenarios.opponentScoresByTrial.length;
  if (trials < 1 || scenarios.opponentScoresByTrial.some((row) => row.length !== fieldSize! - count || row.some((value) => !Number.isFinite(value)))) return null;
  for (const candidate of input.optimizer.candidates) { const values = scenarios.candidateScoresById[candidate.id]; if (!values || values.length !== trials || values.some((value) => !Number.isFinite(value))) return null; }
  return scenarios;
}
function jointNetSamples(portfolio: LineupCandidate[], scenarios: JointFieldScenarios, tiers: Array<{ rank: number; payout: number }>, fieldSize: number, fee: number) {
  const grossPayouts = scenarios.opponentScoresByTrial.map((opponents, trial) => {
    const selectedScores = portfolio.map((candidate) => scenarios.candidateScoresById[candidate.id]![trial]!);
    const allUserScores = [...selectedScores];
    const gross = selectedScores.reduce((sum, score) => { const higher = [...opponents, ...allUserScores].filter((other) => other > score).length; const tied = [...opponents, ...allUserScores].filter((other) => other === score).length; const rank = higher + 1; return sum + averagePayout(rank, tied, tiers, fieldSize); }, 0);
    return gross;
  });
  const samples = grossPayouts.map((gross) => gross - fee * portfolio.length);
  return { samples, grossPayouts, mean: samples.reduce((sum, value) => sum + value, 0) / samples.length };
}
function averagePayout(rank: number, tieSize: number, tiers: Array<{ rank: number; payout: number }>, fieldSize: number): number {
  const payouts = new Map(tiers.map((tier) => [tier.rank, tier.payout])); let total = 0;
  for (let position = rank; position < Math.min(fieldSize, rank + tieSize); position += 1) total += payouts.get(position) ?? 0;
  return total / Math.max(1, tieSize);
}
function summary(values: number[]) { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; const standardError = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) / Math.sqrt(values.length) : 0; const sorted = [...values].sort((a,b) => a-b); return { mean, standardError, p10: quantile(sorted, .1), p90: quantile(sorted, .9) }; }
function quantile(values: number[], p: number) { const index = (values.length - 1) * p; const low = Math.floor(index); return values[low]! + (values[Math.ceil(index)]! - values[low]!) * (index - low); }
export function contestRulesHash(slate: ValidatedSlate): string { return sha256(stableJson({ sport: slate.sport, format: slate.contest.format, scoringRules: slate.scoringRules, rosterRules: slate.rosterRules })); }
function sameStrings(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function utc(value: string): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
function candidateUtility(candidate: LineupCandidate, candidates: LineupCandidate[], slate: ValidatedSlate) { if (slate.contest.objective === 'MAX_FPTS') return candidate.expectedPoints ?? candidate.median; const rank = [...candidates].sort((a,b) => (a.heuristicTournamentRank ?? a.medianRank) - (b.heuristicTournamentRank ?? b.medianRank)).findIndex((row) => row.id === candidate.id); return 1 - rank / Math.max(1, candidates.length - 1); }
function canAdd(chosen: LineupCandidate[], candidate: LineupCandidate, constraints: OptimizerPackage['portfolioConstraints'], count: number) {
  if (chosen.some((row) => row.id === candidate.id || stableJson(row.rosterSlots) === stableJson(candidate.rosterSlots) || constraints?.maxLineupOverlap !== undefined && overlap(row.playerIds, candidate.playerIds) > constraints.maxLineupOverlap)) return false;
  const maxPlayer = constraints?.maxPlayerExposure === undefined ? Infinity : Math.floor(constraints.maxPlayerExposure * count + 1e-9);
  const maxCaptain = constraints?.maxCaptainExposure === undefined ? Infinity : Math.floor(constraints.maxCaptainExposure * count + 1e-9);
  const players = new Map<string, number>(); const captains = new Map<string, number>();
  for (const lineup of [...chosen, candidate]) { for (const id of lineup.playerIds) players.set(id, (players.get(id) ?? 0) + 1); const captain = Object.entries(lineup.rosterSlots).find(([slot]) => /(^|_)(CPT|CAPTAIN|MVP)(_|$)/i.test(slot))?.[1]; if (captain) captains.set(captain, (captains.get(captain) ?? 0) + 1); }
  return [...players.values()].every((value) => value <= maxPlayer) && [...captains.values()].every((value) => value <= maxCaptain);
}
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
