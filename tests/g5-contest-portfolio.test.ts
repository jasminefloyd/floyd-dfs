import assert from 'node:assert/strict';
import { buildContestSpec, assessContestPayoutReadiness } from '../server/lineupAgent/contest.js';
import { contestFieldReadiness } from '../server/lineupAgent/fieldModel.js';
import { calculateContestExpectedValue } from '../server/lineupAgent/expectedValue.js';
import { contestRulesHash, optimizePortfolio } from '../server/lineupAgent/portfolioOptimizer.js';
import { selectRuntimePortfolio } from '../server/lineupAgent/runtimeSelection.js';
import { validateLineupCandidate } from '../src/lib/engine/validation.js';
import { validateNbaLineupAtEntry } from '../server/streetTeam/slateGate.js';
import { deriveMaxPlayerExposure } from '../src/lib/portfolioDefaults.js';
import { extractContestSummaries } from '../src/lib/engine/draftKings.js';
import { validateFinalLineupIndependently } from '../server/lineupAgent/entryValidator.js';
import type { LineupCandidate, OptimizerPackage, ResearchPackage, ValidatedSlate } from '../src/lib/engine/contracts.js';

function slateFor(count: number): ValidatedSlate {
  const players = ['p1','p2','p3','p4'].map((playerId, index) => ({ playerId, playerName: playerId, team: `T${index}`, opponent: `O${index}`, position: 'UTIL', salary: 5_000, eligibility: { UTIL: true }, availability: { status: 'ACTIVE' as const, confirmed: true, source: 'FIXTURE', retrievedAt: '2026-10-30T12:00:00.000Z' } }));
  return { slateId: 'g5-slate', version: 1, tenantId: 'g5-tenant', userId: 'user', requestId: 'request', receivedAt: '2026-10-30T12:00:00.000Z', createdAt: '2026-10-30T12:00:00.000Z', sport: 'NBA', league: 'NBA', event: { eventId: 'event', name: 'fixture', eventDate: '2026-10-30T22:00:00.000Z', participants: [] }, contest: { draftKingsContestId: 'contest', name: 'GPP', format: 'CLASSIC', lockTime: '2026-10-30T22:00:00.000Z', userEntryCount: count, requestedEntryCount: count, maxEntriesAllowed: 4, contestSize: 100, contestKind: 'GPP', tieHandling: 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS', lateSwapAllowed: false }, salaryCap: 10_000, rosterRules: { rosterSize: 1, slots: { UTIL: { count: 1 } }, uniquePlayersRequired: true }, scoringRules: { points: { value: 1 } }, playerPool: players, sourceManifest: [{ source: 'DRAFTKINGS_API', receivedAt: '2026-10-30T12:00:00.000Z', fields: ['contest','draftGroup','gameTypeRules','draftables','tieHandling','lateSwapAllowed'] }], validation: { status: 'VALID', warnings: [], errors: [] } } as ValidatedSlate;
}

assert.equal(deriveMaxPlayerExposure(2, 'top_heavy'), 1, 'two-entry portfolios must not get an implicit one-use-per-player cap from rounding 60% down');
assert.equal(deriveMaxPlayerExposure(3, 'top_heavy'), 0.6);
assert.equal(deriveMaxPlayerExposure(3, 'flat'), 0.8);
const dkTerms = extractContestSummaries({ Contests: [{ contestId: 7, name: 'NBA Showdown fixture', gameType: 'SHOWDOWN', lockTime: '2026-10-30T22:00:00Z', maximumEntries: 100, maxEntriesAllowed: 20, entryFee: 0.25, lateSwapEnabled: true, tieHandling: 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS', payoutSummary: [{ minPosition: 1, maxPosition: 1, payoutDescriptions: [{ value: 50 }] }, { minPosition: 2, maxPosition: 2, payoutDescriptions: [{ value: 25 }] }] }] }, 'NBA');
assert.deepEqual(dkTerms[0]?.payoutStructure, [{ rank: 1, payout: 50 }, { rank: 2, payout: 25 }]);
assert.equal(dkTerms[0]?.entryFee, 0.25);
assert.equal(dkTerms[0]?.lateSwapAllowed, true);
assert.equal(dkTerms[0]?.tieHandling, 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS');

const candidates: LineupCandidate[] = ['p1','p2','p3','p4'].map((playerId, index) => ({ id: `candidate-${index + 1}`, playerIds: [playerId], rosterSlots: { UTIL: playerId }, salaryUsed: 5_000, salaryRemaining: 5_000, floor: 5 + index, expectedPoints: 10 + index, median: 10 + index, ceiling: 15 + index, simulatedScoreSamples: [10 + index, 12 + index], correlationScore: 0, medianRank: index + 1, ceilingRank: index + 1, heuristicTournamentRank: index + 1, candidateTypes: [], gameScriptCluster: 'fixture', strategicSimilarity: 0, riskFlags: [] }));
const optimizer: OptimizerPackage = { slateId: 'g5-slate', tenantId: 'g5-tenant', sport: 'NBA', version: 1, generatedAt: '2026-10-30T12:00:00.000Z', objectiveProfile: { name: 'fixture', medianWeight: 1, ceilingWeight: 0, leverageWeight: 0, duplicationPenalty: 0, correlationWeight: 0 }, candidates, warnings: [], gaps: [], status: 'COMPLETE', engineState: 'MODEL_VALIDATION_REQUIRED', searchCompleteness: 'EXHAUSTIVE', searchDiagnostics: { algorithm: 'DETERMINISTIC_VALUE_ORDERED_DFS', terminationReason: 'SEARCH_SPACE_EXHAUSTED', nodesVisited: 20, elapsedMilliseconds: 1, candidatesEvaluated: 4, uniqueLineups: 4 }, portfolioConstraints: { maxLineupOverlap: 0 } };
const research: ResearchPackage = { slateId: 'g5-slate', tenantId: 'g5-tenant', version: 1, generatedAt: '2026-10-30T12:00:00.000Z', freshThrough: '2026-10-30T12:00:00.000Z', findings: [], status: 'COMPLETE' };

for (const count of [1, 2, 4]) {
  const slate = slateFor(count);
  const result = optimizePortfolio({ slate, research, optimizer, seed: `seed-${count}`, fieldReadiness: 'UNAVAILABLE' });
  assert.equal(result.selectedLineups.length, count);
  assert.equal(result.portfolioOptimization?.status, 'COMPLETE');
  assert.equal(result.portfolioOptimization?.objective, 'SAFE_SCORE_UPSIDE');
  assert.match(result.portfolioOptimization?.candidateSetSha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(new Set(result.selectedLineups.map((lineup) => lineup.playerIds[0])).size, count, 'joint portfolio respects uniqueness and overlap constraint');
  for (const lineup of result.selectedLineups) {
    assert.deepEqual(validateLineupCandidate({ playerIds: lineup.playerIds, rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed }, slate), []);
    assert.deepEqual(validateFinalLineupIndependently(lineup, slate), [], 'independent last-mile validator accepts each Classic roster');
  }
}

const baseSlate = slateFor(1);
const showdownSlate = { ...baseSlate, contest: { ...baseSlate.contest, format: 'SHOWDOWN' as const }, salaryCap: 15_000, rosterRules: { rosterSize: 2, uniquePlayersRequired: true, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 1 } } }, playerPool: baseSlate.playerPool.map((player) => ({ ...player, eligibility: { ...player.eligibility, CPT: true }, captainSalary: 7_500 })) } as ValidatedSlate;
assert.deepEqual(validateFinalLineupIndependently({ playerIds: ['p1','p2'], rosterSlots: { CPT: 'p1', UTIL: 'p2' }, salaryUsed: 12_500 }, showdownSlate), [], 'independent validator recomputes Showdown captain salary');
assert.ok(validateFinalLineupIndependently({ playerIds: ['p1','p1'], rosterSlots: { CPT: 'p1', UTIL: 'p1' }, salaryUsed: 12_500 }, showdownSlate).some((issue) => issue.includes('duplicate')));
const spec = buildContestSpec(baseSlate);
assert.equal(spec.readiness, 'NEEDS_PAYOUTS');
assert.equal(spec.provenance.contestIdentity, 'DRAFTKINGS_API');
assert.deepEqual(spec.eligiblePlayerIds, ['p1','p2','p3','p4']);
assert.ok(spec.multiplierRules && spec.sourceVersion.length > 0, 'the replay contract includes explicit salary/scoring multipliers and source version provenance');
const manuallyConfirmedSlate = { ...baseSlate, contest: { ...baseSlate.contest, entryFee: 5, contestSize: 20, paidPositions: 2, payoutStructure: [{ rank: 1, payout: 40 }, { rank: 2, payout: 20 }] }, sourceManifest: [...baseSlate.sourceManifest, { source: 'USER_CONFIRMED_CONTEST_TERMS', receivedAt: '2026-10-30T12:01:00.000Z', fields: ['entryFee', 'fieldSize', 'payoutTiers', 'confirmed:true', 'confirmedBy:user'] }] };
const manualSpec = buildContestSpec(manuallyConfirmedSlate as ValidatedSlate, 'EXPERIMENTAL');
assert.equal(manualSpec.provenance.entryFee, 'USER_CONFIRMED');
assert.equal(manualSpec.provenance.fieldSize, 'USER_CONFIRMED');
assert.equal(manualSpec.provenance.payout, 'USER_CONFIRMED');
assert.equal(manualSpec.readiness, 'NEEDS_FIELD_CALIBRATION', 'manual confirmation cannot bypass opponent-field calibration');
const incompleteReadiness = assessContestPayoutReadiness({ ...baseSlate, contest: { ...baseSlate.contest, entryFee: 10, paidPositions: 10, payoutStructure: [{ rank: 1, payout: 100 }] } }, { status: 'EXPERIMENTAL' });
assert.equal(incompleteReadiness.decisionStatus, 'NEEDS_PAYOUTS');
const held = calculateContestExpectedValue({ readiness: incompleteReadiness, candidateScores: [10], opponentScoresByTrial: [[9,8]] });
assert.equal(held.expectedNetProfit, null, 'incomplete payout inputs never produce dollar EV');
const ready = { ...incompleteReadiness, status: 'READY' as const, decisionStatus: 'READY' as const, payoutStatus: 'VERIFIED' as const, fieldModelStatus: 'CALIBRATED' as const, fieldModelVersion: 'field.v1', fieldSize: 3, entryFee: 10, paidPositions: undefined, payoutTiers: [{ rank: 1, payout: 100 }, { rank: 2, payout: 50 }] };
const tied = calculateContestExpectedValue({ readiness: ready, candidateScores: [10], opponentScoresByTrial: [[10,9]] });
assert.equal(tied.expectedGrossPayout, 75, 'rank 1 and rank 2 prizes are divided across a two-way tie');
assert.equal(tied.expectedNetProfit, 65);
assert.equal(tied.cashProbability, 1);
assert.equal(contestFieldReadiness().status, 'UNAVAILABLE');
assert.equal(contestFieldReadiness({ modelVersion: 'field.v1', independentContests: 1, minimumIndependentContests: 30, datasetSha256: 'hash', passedPredeterminedChecks: true, humanApproved: true }).status, 'EXPERIMENTAL');

const jointSlate = { ...slateFor(2), contest: { ...slateFor(2).contest, objective: 'MAX_FPTS' as const, contestSize: 4, maxEntriesAllowed: 2 }, rosterRules: { rosterSize: 2, slots: { UTIL: { count: 2 } }, uniquePlayersRequired: true }, playerPool: [...slateFor(2).playerPool, { ...slateFor(2).playerPool[0]!, playerId: 'p5' }, { ...slateFor(2).playerPool[1]!, playerId: 'p6' }] } as ValidatedSlate;
const jointCandidates: LineupCandidate[] = [
  { ...candidates[0]!, id: 'greedy-first', playerIds: ['p1','p2'], rosterSlots: { UTIL: 'p1', UTIL_2: 'p2' }, expectedPoints: 100, median: 100 },
  { ...candidates[1]!, id: 'joint-a', playerIds: ['p1','p3'], rosterSlots: { UTIL: 'p1', UTIL_2: 'p3' }, expectedPoints: 99, median: 99 },
  { ...candidates[2]!, id: 'joint-b', playerIds: ['p2','p4'], rosterSlots: { UTIL: 'p2', UTIL_2: 'p4' }, expectedPoints: 98, median: 98 },
  { ...candidates[3]!, id: 'greedy-safe', playerIds: ['p5','p6'], rosterSlots: { UTIL: 'p5', UTIL_2: 'p6' }, expectedPoints: 60, median: 60 },
].map((candidate) => ({ ...candidate, salaryUsed: 10_000, salaryRemaining: 0 }));
const jointOptimizer: OptimizerPackage = { ...optimizer, candidates: jointCandidates, portfolioConstraints: { maxLineupOverlap: 0 } };
const joint = optimizePortfolio({ slate: jointSlate, research, optimizer: jointOptimizer, seed: 'joint', fieldReadiness: 'UNAVAILABLE' });
assert.deepEqual(joint.selectedLineups.map((lineup) => lineup.candidateId).sort(), ['joint-a','joint-b'], 'combination search beats the greedy top candidate plus its best non-overlapping fallback');
assert.equal(joint.portfolioOptimization?.search?.algorithm, 'BOUNDED_COMBINATION_ENUMERATION');
assert.equal(joint.portfolioOptimization?.expectedNetReturn, null);
const paidContest = { ...baseSlate, contest: { ...baseSlate.contest, userEntryCount: 2, requestedEntryCount: 2, maxEntriesAllowed: 2, contestSize: 4, entryFee: 1, paidPositions: 2, payoutStructure: [{ rank: 1, payout: 10 }, { rank: 2, payout: 5 }] } } as ValidatedSlate;
const fieldScores = { fieldModelVersion: 'field.v1', datasetSha256: 'b'.repeat(64), simulationVersion: 'game-simulation.fixture.v1', seed: 'field-seed', slateId: paidContest.slateId, contestId: paidContest.contest.draftKingsContestId, asOf: '2026-10-30T21:59:00.000Z', rulesHash: contestRulesHash(paidContest), candidateIds: optimizer.candidates.map((candidate) => candidate.id).sort(), opponentScoresByTrial: [[80,80],[80,80]], candidateScoresById: { 'candidate-1': [100,0], 'candidate-2': [90,90], 'candidate-3': [85,85], 'candidate-4': [0,100] } };
const financial = optimizePortfolio({ slate: paidContest, research, optimizer, seed: 'field-seed', fieldReadiness: 'CALIBRATED', jointFieldScenarios: fieldScores });
assert.equal(financial.portfolioOptimization?.objective, 'MAX_EXPECTED_NET_RETURN');
assert.equal(financial.portfolioOptimization?.expectedNetReturn, 13);
assert.equal(financial.portfolioOptimization?.expectedNetReturnStandardError, 0);
assert.equal(financial.portfolioOptimization?.portfolioCashProbability, 1);
assert.equal(financial.portfolioOptimization?.portfolioLossProbability, 0);
const runtimeCalibratedOptimizer: OptimizerPackage = { ...optimizer, contestSimulation: { status: 'COMPLETE', simulations: 2, fieldEntries: 2, fieldModel: 'PROJECTED_OWNERSHIP', payoutModel: 'UNAVAILABLE', readiness: 'CALIBRATED', jointFieldScenarios: fieldScores } };
const runtimeFinancial = selectRuntimePortfolio({ slate: paidContest, research, optimizer: runtimeCalibratedOptimizer, seed: 'field-seed' });
assert.equal(runtimeFinancial.portfolioOptimization?.objective, 'MAX_EXPECTED_NET_RETURN', 'runtime bridge passes the optimizer-produced calibrated scenario artifact');
const uncalibratedWithScenario: OptimizerPackage = { ...optimizer, contestSimulation: { status: 'COMPLETE', simulations: 2, fieldEntries: 2, fieldModel: 'PROJECTED_OWNERSHIP', payoutModel: 'UNAVAILABLE', readiness: 'UNVALIDATED', jointFieldScenarios: fieldScores } };
const runtimeFallback = selectRuntimePortfolio({ slate: paidContest, research, optimizer: uncalibratedWithScenario, seed: 'field-seed' });
assert.equal(runtimeFallback.portfolioOptimization?.objective, 'SAFE_SCORE_UPSIDE', 'runtime ignores scenarios without calibrated optimizer readiness');
assert.equal(runtimeFallback.portfolioOptimization?.expectedNetReturn, null);
const candidateMismatch = optimizePortfolio({ slate: paidContest, research, optimizer, seed: 'field-seed', fieldReadiness: 'CALIBRATED', jointFieldScenarios: { ...fieldScores, candidateIds: [...fieldScores.candidateIds, 'unknown-candidate'] } });
assert.equal(candidateMismatch.portfolioOptimization?.objective, 'SAFE_SCORE_UPSIDE', 'scenario candidate identities must exactly match the current candidate set');
assert.equal(candidateMismatch.portfolioOptimization?.expectedNetReturn, null);
const lockLeak = optimizePortfolio({ slate: paidContest, research, optimizer, seed: 'field-seed', fieldReadiness: 'CALIBRATED', jointFieldScenarios: { ...fieldScores, asOf: '2026-10-30T22:01:00.000Z' } });
assert.equal(lockLeak.portfolioOptimization?.expectedNetReturn, null, 'post-lock scenarios cannot be used for a pre-lock financial decision');
const noField = optimizePortfolio({ slate: paidContest, research, optimizer, seed: 'no-field', fieldReadiness: 'CALIBRATED' });
assert.equal(noField.portfolioOptimization?.expectedNetReturn, null, 'without common opponent scenarios calibrated EV stays null');

const entryNow = new Date('2026-10-30T20:00:00.000Z');
const identitySlate = { ...baseSlate, playerPool: [{ ...baseSlate.playerPool[0]!, identity: { draftKingsId: '42', sportsDataIoId: '42', confidence: 'EXACT', matchedBy: 'PROVIDER_ID' } }] } as ValidatedSlate;
const identitySnapshot = {
  sport: 'NBA', tenantId: 'g5-tenant', asOf: '2026-10-30T19:45:00.000Z', observations: [], unknowns: [], rosterState: [], behaviorSignals: [],
  resolvedFacts: [{ id: 'roster-1', subject: { kind: 'PLAYER', id: 'nba:player:sportsdataio:42' }, factType: 'roster.membership', value: { providerPlayerId: '42', draftKingsPlayerId: '42', team: 'T0' }, state: 'ACCEPTED', observationIds: [] }],
} as unknown as import('../src/lib/engine/contracts.js').StreetTeamSnapshot;
assert.deepEqual(validateNbaLineupAtEntry(identitySlate, identitySnapshot, ['p1'], entryNow), [], 'pre-lock exact identity remains eligible');
assert.ok(validateNbaLineupAtEntry(identitySlate, { ...identitySnapshot, asOf: '2026-10-30T22:01:00.000Z' }, ['p1'], entryNow).length, 'post-lock identity evidence cannot authorize an entry');
assert.ok(validateNbaLineupAtEntry(identitySlate, { ...identitySnapshot, asOf: '2026-10-29T19:00:00.000Z' }, ['p1'], entryNow).length, 'stale identity evidence cannot authorize an entry');
const outSnapshot = { ...identitySnapshot, resolvedFacts: [...identitySnapshot.resolvedFacts, { id: 'out-1', subject: { kind: 'PLAYER', id: 'nba:player:sportsdataio:42' }, factType: 'availability.injury_status', value: { normalizedStatus: 'OUT' }, state: 'ACCEPTED', observationIds: [] }] } as unknown as import('../src/lib/engine/contracts.js').StreetTeamSnapshot;
assert.ok(validateNbaLineupAtEntry(identitySlate, outSnapshot, ['p1'], entryNow).length, 'confirmed OUT players cannot pass final entry revalidation');
console.log('G5 contest provenance/terms parsing, payout readiness, tied payout, bounded joint selection, constraints and replay metadata passed.');
