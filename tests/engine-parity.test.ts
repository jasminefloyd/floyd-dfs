import assert from 'node:assert/strict';
import { applyAvailabilitySnapshot, withDegradedAvailability } from '../src/lib/engine/availability';
import { adjustSlate } from '../src/lib/engine/adjustment';
import { projectSlate } from '../src/lib/engine/projection';
import { buildCashLineCalibration, calibratedCashLineProbability } from '../src/lib/engine/cashLineCalibration';
import { classifyContestKind } from '../src/lib/engine/draftKingsSlate';
import { optimizeLineups } from '../src/lib/engine/optimizer';
import { selectWithOpenAi } from '../src/lib/engine/openAiSelection';
import { ResearchAgent } from '../src/lib/engine/researchAgent';
import { findingsFromAvailability } from '../src/lib/engine/researchEvidence';
import { selectLineups } from '../src/lib/engine/selection';
import { assertProjection, assertSlate } from '../src/lib/engine/validation';
import type { LineupCandidate, ProjectionPackage, ResearchFinding, ResearchPackage, ValidatedSlate } from '../src/lib/engine/contracts';

const now = new Date('2026-08-23T12:00:00.000Z');
const baseSlate: ValidatedSlate = {
  slateId: 'slate-1', version: 1, tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', receivedAt: now.toISOString(), createdAt: now.toISOString(), sport: 'NBA', league: 'NBA',
  event: { eventId: 'event-1', name: 'Test', eventDate: '2026-08-23T23:00:00.000Z', participants: ['A', 'B'] },
  contest: { draftKingsContestId: 'contest-1', name: 'Test', format: 'CLASSIC', lockTime: '2026-08-23T23:00:00.000Z', userEntryCount: 1, requestedEntryCount: 1, contestSize: 100 }, salaryCap: 10000,
  rosterRules: { rosterSize: 2, slots: { G: { count: 1 }, F: { count: 1 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2, maximumPlayersPerTeam: 2 } }, scoringRules: { points: { value: 1 } },
  playerPool: [
    { playerId: 'p1', playerName: 'One', team: 'A', salary: 5000, eligibility: { G: true, F: false } },
    { playerId: 'p2', playerName: 'Two', team: 'B', salary: 4500, eligibility: { G: false, F: true } },
    { playerId: 'p3', playerName: 'Three', team: 'A', salary: 4000, eligibility: { G: true, F: true } },
  ], sourceManifest: [{ source: 'DRAFTKINGS_API', receivedAt: now.toISOString(), fields: ['contest', 'playerPool'] }], validation: { status: 'VALID', warnings: [], errors: [] },
};
const research = { findings: [], unknowns: [], status: 'COMPLETE' } as unknown as ResearchPackage;
const projection: ProjectionPackage = {
  slateId: 'slate-1', tenantId: 'tenant-1', sport: 'NBA', version: 1, generatedAt: now.toISOString(), modelVersion: 'test', simulationRuns: 10,
  players: [
    { playerId: 'p1', salary: 5000, baselineOpportunity: { points: 30 }, adjustedOpportunity: { points: 30 }, opportunityDelta: { points: 0 }, componentProjection: { points: 30 }, projectedOutcomes: { floorP20: 20, medianP50: 30, ceilingP90: 45 }, salaryEfficiency: { medianPer1k: 6, ceilingPer1k: 9 }, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' },
    { playerId: 'p2', salary: 4500, baselineOpportunity: { points: 20 }, adjustedOpportunity: { points: 20 }, opportunityDelta: { points: 0 }, componentProjection: { points: 20 }, projectedOutcomes: { floorP20: 15, medianP50: 20, ceilingP90: 30 }, salaryEfficiency: { medianPer1k: 4.4, ceilingPer1k: 6.6 }, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' },
    { playerId: 'p3', salary: 4000, baselineOpportunity: { points: 25 }, adjustedOpportunity: { points: 25 }, opportunityDelta: { points: 0 }, componentProjection: { points: 25 }, projectedOutcomes: { floorP20: 18, medianP50: 25, ceilingP90: 38 }, salaryEfficiency: { medianPer1k: 6.25, ceilingPer1k: 9.5 }, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' },
  ], gaps: [], status: 'COMPLETE',
};

const showdownSlate = (): ValidatedSlate => ({ ...baseSlate, contest: { ...baseSlate.contest, format: 'SHOWDOWN' }, rosterRules: { rosterSize: 2, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 1 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } }, playerPool: [
  { playerId: 'home-1', playerName: 'Home One', team: 'HOME', salary: 5000, captainSalary: 7500, utilitySalary: 5000, eligibility: { CPT: true, UTIL: true } },
  { playerId: 'home-2', playerName: 'Home Two', team: 'HOME', salary: 4000, captainSalary: 6000, utilitySalary: 4000, eligibility: { CPT: true, UTIL: true } },
  { playerId: 'away-1', playerName: 'Away One', team: 'AWAY', salary: 3000, captainSalary: 4500, utilitySalary: 3000, eligibility: { CPT: true, UTIL: true } },
] });

const testOptimizerParity = (): void => {
  const result = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) { assert.ok(candidate.salaryUsed <= baseSlate.salaryCap); assert.equal(new Set(candidate.playerIds).size, candidate.playerIds.length); assert.ok(new Set(candidate.playerIds.map((id) => baseSlate.playerPool.find((player) => player.playerId === id)?.team)).size >= 2); assert.ok(candidate.candidateTypes.length > 0); }
  const illegal = showdownSlate();
  illegal.playerPool = illegal.playerPool.map((player) => ({ ...player, team: 'HOME' }));
  const showdown = optimizeLineups({ validatedSlate: illegal, projectionPackage: { ...projection, players: projection.players.map((player) => ({ ...player, playerId: player.playerId.replace('p', 'home-') })) } });
  assert.equal(showdown.status, 'BLOCKED');
};

const testUnprojectedPlayerExclusion = (): void => {
  const slateWithExtraPlayer: ValidatedSlate = { ...baseSlate, playerPool: [...baseSlate.playerPool, { playerId: 'p4', playerName: 'Four', team: 'B', salary: 100, eligibility: { G: true, F: true } }] };
  const result = optimizeLineups({ validatedSlate: slateWithExtraPlayer, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates.every((candidate) => !candidate.playerIds.includes('p4')));
  assert.ok(result.warnings.some((warning) => warning.includes('Four')));
};

const testCashLineFieldEstimateParity = (): void => {
  const cashSlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, contestKind: 'CASH', paidPositions: 50, contestSize: 100 } };
  const result = optimizeLineups({ validatedSlate: cashSlate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.cashLineEstimate, 'a cash-game contest with known paid positions/size should produce a simulated cash-line estimate');
  assert.equal(result.cashLineEstimate?.source, 'SIMULATED');
  for (const candidate of result.candidates) {
    assert.ok(candidate.cashLineProbability !== undefined, 'every candidate should get a cash-line probability once an estimate exists');
    assert.ok(candidate.cashLineProbability! >= 0 && candidate.cashLineProbability! <= 1);
  }

  const manualCashSlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, cashLine: 20 } };
  const manualResult = optimizeLineups({ validatedSlate: manualCashSlate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(manualResult.cashLineEstimate?.source, 'MANUAL');
  assert.equal(manualResult.cashLineEstimate?.value, 20);

  const gppSlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, contestKind: 'UNKNOWN' } };
  const gppResult = optimizeLineups({ validatedSlate: gppSlate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(gppResult.cashLineEstimate, undefined, 'no cash-line estimate should be fabricated when contest kind/payout data is unknown');
};

const testSalarySlotParity = (): void => {
  const slate = showdownSlate();
  const idMap: Record<string, string> = { 'home-1': 'p1', 'home-2': 'p2', 'away-1': 'p3' };
  const playerPool = slate.playerPool.map((player) => ({ ...player, playerId: idMap[player.playerId] ?? player.playerId }));
  const result = optimizeLineups({ validatedSlate: { ...slate, playerPool, salaryCap: 15000 }, projectionPackage: { ...projection, players: projection.players } });
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates.some((item) => item.rosterSlots.CPT === 'p1' && item.salaryUsed === 10500));
};

const testCashGameSelectionParity = (): void => {
  const optimizer = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection });
  assert.ok(optimizer.candidates.length >= 2);
  const cashSlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, contestKind: 'CASH' } };

  const withProbabilities = { ...optimizer, candidates: optimizer.candidates.map((candidate, index) => ({ ...candidate, cashLineProbability: index === 1 ? 0.92 : 0.4 })) };
  const result = selectLineups({ validatedSlate: cashSlate, researchPackage: research, optimizerPackage: withProbabilities }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.selectedLineups.length, 1);
  assert.equal(result.selectedLineups[0].cashLineProbability, 0.92, 'should rank the candidate that clears the 85% target first');
  assert.ok(!result.selectedLineups[0].rationale.some((line) => line.includes('below the')), 'a candidate that clears the target should not carry a shortfall disclosure');

  // Force every candidate below target -- selection must still return the requested count, never
  // fewer just because nothing clears the cash bar, and must disclose the shortfall.
  const allBelowTarget = { ...optimizer, candidates: optimizer.candidates.map((candidate) => ({ ...candidate, cashLineProbability: 0.5 })) };
  const shortfallResult = selectLineups({ validatedSlate: cashSlate, researchPackage: research, optimizerPackage: allBelowTarget }, now);
  assert.equal(shortfallResult.selectedLineups.length, 1, 'selection must never return fewer lineups just because no candidate clears the cash target');
  assert.ok(shortfallResult.selectedLineups[0].rationale.some((line) => line.includes('below the 85% target')), 'a shortfall must be disclosed, not hidden');
};

const testGppSelectionUnaffectedByCashLineParity = (): void => {
  const optimizer = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection });
  // Deliberately invert: the best tournament candidate gets a LOW cash-line probability.
  const withProbabilities = { ...optimizer, candidates: optimizer.candidates.map((candidate) => ({ ...candidate, cashLineProbability: candidate.tournamentRank === 1 ? 0.1 : 0.99 })) };
  const gppSlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, contestKind: 'GPP' } };
  const result = selectLineups({ validatedSlate: gppSlate, researchPackage: research, optimizerPackage: withProbabilities }, now);
  const chosen = optimizer.candidates.find((candidate) => candidate.id === result.selectedLineups[0].candidateId);
  assert.equal(chosen?.tournamentRank, 1, 'GPP selection must rank by the tournament composite, ignoring cash-line probability entirely');
};

const testSelectionParity = (): void => {
  const optimizer = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection });
  const result = selectLineups({ validatedSlate: baseSlate, researchPackage: research, optimizerPackage: optimizer }, now);
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.selectedLineups.length, 1); assert.ok(optimizer.candidates.some((candidate) => candidate.id === result.selectedLineups[0].candidateId));
};

const testSelectionWatchItemsParity = (): void => {
  const optimizer = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection });
  const researchWithWatch: ResearchPackage = { ...research, watchItems: [{ subjectId: 'p1', importance: 'CRITICAL', reason: 'Confirmed starting lineup not yet posted.', expectedChangeBeforeLock: true }] };
  const result = selectLineups({ validatedSlate: baseSlate, researchPackage: researchWithWatch, optimizerPackage: optimizer }, now);
  assert.equal(result.status, 'COMPLETE');
  const lineup = result.selectedLineups[0];
  assert.ok(lineup.playerIds.includes('p1'));
  assert.equal(lineup.readinessStatus, 'READY_WITH_WATCH');
  assert.ok(lineup.watchItems.some((item) => item.includes('starting lineup')));
};

const testAvailabilityParity = (): void => {
  const mlb = { ...baseSlate, sport: 'MLB' as const, league: 'MLB' as const, playerPool: [{ ...baseSlate.playerPool[0], playerName: 'Player One', team: 'CWS' }, { ...baseSlate.playerPool[1], playerName: 'Player Two', team: 'NYY' }] };
  const result = applyAvailabilitySnapshot(mlb, { source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), confirmedLineupAvailable: true, records: [{ playerName: 'Player One', team: 'CWS', status: 'CONFIRMED_STARTER', confirmed: true, battingOrder: 1 }] });
  assert.equal(result.playerPool.length, 1); assert.equal(result.playerPool[0].availability?.status, 'CONFIRMED_STARTER');
};

const testOutPlayersRemovedForNonMlbSportsParity = (): void => {
  const wnba = { ...baseSlate, sport: 'WNBA' as const, league: 'WNBA' as const, playerPool: [{ ...baseSlate.playerPool[0], playerName: 'Player One', team: 'SEA' }, { ...baseSlate.playerPool[1], playerName: 'Player Two', team: 'TOR' }] };
  const result = applyAvailabilitySnapshot(wnba, { source: 'ESPN', retrievedAt: now.toISOString(), confirmedLineupAvailable: false, records: [{ playerName: 'Player One', team: 'SEA', status: 'ACTIVE', confirmed: true }, { playerName: 'Player Two', team: 'TOR', status: 'OUT', confirmed: true }] });
  assert.equal(result.playerPool.length, 1, 'a player ESPN explicitly reports OUT must actually be removed from the pool, not just counted in the warning text');
  assert.equal(result.playerPool[0].playerName, 'Player One');
  assert.ok(result.validation.warnings.some((warning) => warning.includes('removed')));
};

const testAvailabilitySeedsResearchParity = async (): Promise<void> => {
  const slateWithAvailability: ValidatedSlate = { ...baseSlate, playerPool: baseSlate.playerPool.map((player, index) => index === 0 ? { ...player, availability: { status: 'CONFIRMED_STARTER', confirmed: true, source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), mappedBy: 'NAME_AND_TEAM' } } : player) };
  const seeds = findingsFromAvailability(slateWithAvailability);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].subjectId, 'p1');
  assert.equal(seeds[0].sourceTier, 1);

  const agent = new ResearchAgent({ providers: [{ name: 'stub', tier: 3, fetch: async () => [] }], now: () => now });
  const result = await agent.run({ validatedSlate: slateWithAvailability });
  assert.ok(!(result.unknowns ?? []).some((unknown) => unknown.subjectId === 'p1'), 'a confirmed player should not raise an availability gap');
  assert.ok((result.unknowns ?? []).some((unknown) => unknown.subjectId === 'p2'), 'an unconfirmed player should still raise a gap');
};

const testContestKindClassificationParity = (): void => {
  const flatPayout = { payoutSummary: [{ minPosition: 1, maxPosition: 150, payoutDescriptions: [{ value: 10 }] }] };
  const cash = classifyContestKind(flatPayout);
  assert.equal(cash.kind, 'CASH');
  assert.equal(cash.paidPositions, 150);

  const topHeavyPayout = { payoutSummary: [
    { minPosition: 1, maxPosition: 1, payoutDescriptions: [{ value: 1_000_000 }] },
    { minPosition: 2, maxPosition: 2, payoutDescriptions: [{ value: 400 }] },
    { minPosition: 3, maxPosition: 240, payoutDescriptions: [{ value: 5 }] },
  ] };
  const gpp = classifyContestKind(topHeavyPayout);
  assert.equal(gpp.kind, 'GPP');
  assert.equal(gpp.paidPositions, 240);

  const noPayoutData = classifyContestKind({});
  assert.equal(noPayoutData.kind, 'UNKNOWN');
};

const testCashLineCalibrationBoundaryParity = (): void => {
  const observations = Array.from({ length: 120 }, (_, index) => ({ rawProbability: 0.85, beatCashLine: index % 20 !== 0 }));
  const calibration = buildCashLineCalibration(observations);
  assert.equal(calibration.status, 'APPROVED');
  const probability = calibratedCashLineProbability(0.85, calibration);
  assert.ok(probability !== null);
  const bin = calibration.bins.find((item) => item.lower === 0.85);
  assert.ok(bin);
  assert.equal(probability, bin?.observedRate);
};

const testConflictingEvidenceNetsRealSignalParity = (): void => {
  const findings: ResearchFinding[] = [
    { id: 'f-out', subjectId: 'p1', bucket: 'AVAILABILITY', finding: 'Player was ruled out for tonight.', sourceName: 'Test', sourceTier: 2, confidence: 'MEDIUM', retrievedAt: now.toISOString() },
    { id: 'f-usage', subjectId: 'p1', bucket: 'RECENT_ROLE_FORM', finding: 'Increased usage as the primary scoring option.', sourceName: 'Test', sourceTier: 2, confidence: 'MEDIUM', retrievedAt: now.toISOString() },
  ];
  const researchWithConflict: ResearchPackage = { ...research, findings };
  const adjustment = adjustSlate(baseSlate, researchWithConflict, now);
  const playerAdjustment = adjustment.adjustments.find((item) => item.playerId === 'p1')!;
  assert.equal(playerAdjustment.netOpportunityDirection, 'MATERIALLY_DOWN', 'a strong DOWN signal should still win out over a weaker conflicting UP signal, not collapse to NEUTRAL');
  assert.ok(playerAdjustment.netSignedMagnitude < 0);

  const providerFppgSlate: ValidatedSlate = { ...baseSlate, playerPool: baseSlate.playerPool.map((player) => player.playerId === 'p1' ? { ...player, providerFppg: 40 } : player) };
  const projected = projectSlate(providerFppgSlate, adjustment, now);
  const p1 = projected.players.find((player) => player.playerId === 'p1')!;
  assert.ok(p1.projectedOutcomes.medianP50 < 40, 'conflicting evidence that nets DOWN must reduce the projection, not leave it unchanged as if there were no evidence at all');
};

const testNoiseWidthReflectsRoleCertaintyParity = (): void => {
  const providerFppgSlate: ValidatedSlate = { ...baseSlate, playerPool: baseSlate.playerPool.map((player) => player.playerId === 'p1' ? { ...player, providerFppg: 40 } : player) };
  const emptyAdjustment = adjustSlate(providerFppgSlate, research, now);
  const lowProjection = projectSlate(providerFppgSlate, emptyAdjustment, now);
  const lowP1 = lowProjection.players.find((player) => player.playerId === 'p1')!;
  const lowSpread = lowP1.projectedOutcomes.ceilingP90 - lowP1.projectedOutcomes.floorP20;

  const highCertaintyAdjustment = { ...emptyAdjustment, adjustments: emptyAdjustment.adjustments.map((item) => item.playerId === 'p1' ? { ...item, roleCertainty: 'HIGH' as const } : item) };
  const highProjection = projectSlate(providerFppgSlate, highCertaintyAdjustment, now);
  const highP1 = highProjection.players.find((player) => player.playerId === 'p1')!;
  const highSpread = highP1.projectedOutcomes.ceilingP90 - highP1.projectedOutcomes.floorP20;

  assert.ok(highSpread < lowSpread, 'a HIGH-certainty player should have a narrower floor/ceiling band than a LOW-certainty player projected from the same inputs');
};

const testDegradedAvailabilityParity = (): void => {
  const degraded = withDegradedAvailability(baseSlate, 'Availability refresh failed.');
  assert.equal(degraded.validation.status, 'WARNING');
  assert.ok(degraded.validation.warnings.includes('Availability refresh failed.'));

  const alreadyBlocked: ValidatedSlate = { ...baseSlate, validation: { ...baseSlate.validation, status: 'BLOCKED' } };
  const stillBlocked = withDegradedAvailability(alreadyBlocked, 'Availability refresh failed.');
  assert.equal(stillBlocked.validation.status, 'BLOCKED', 'an already-BLOCKED slate must stay BLOCKED, never silently downgraded');
};

const testThinPoolDiversityDisclosureParity = (): void => {
  const makeCandidate = (id: string, playerIds: string[]): LineupCandidate => ({
    id, playerIds, rosterSlots: Object.fromEntries(playerIds.map((playerId, index) => [`SLOT_${index}`, playerId])), salaryUsed: 9000, salaryRemaining: 1000, median: 40, ceiling: 55,
    correlationScore: 0, optimalLineupFrequency: 1, topOnePercentFrequency: 1, ownershipEstimate: 0.2, leverageScore: 0.8, duplicationRisk: 'LOW',
    estimatedDuplicates: 5, medianRank: 1, ceilingRank: 1, tournamentRank: 1, candidateTypes: [], gameScriptCluster: 'SINGLE_TEAM_OR_UNKNOWN', strategicSimilarity: 0, riskFlags: [],
  });
  // 4-of-5 shared players -> 0.8 overlap, at the "near-duplicate" threshold choosePortfolio itself uses.
  const nearDuplicatePool = { candidates: [makeCandidate('c1', ['p1', 'p2', 'p3', 'p4', 'p5']), makeCandidate('c2', ['p1', 'p2', 'p3', 'p4', 'p6'])] };
  const twoEntrySlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, userEntryCount: 2, requestedEntryCount: 2 } };
  const result = selectLineups({ validatedSlate: twoEntrySlate, researchPackage: research, optimizerPackage: nearDuplicatePool }, now);
  assert.equal(result.selectedLineups.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('closely overlap')), 'a thin pool of near-duplicate candidates must be disclosed as a portfolio-level warning');
  assert.ok(result.selectedLineups.some((lineup) => lineup.rationale.some((line) => line.includes('closely overlaps'))), 'the affected lineup(s) must carry a per-lineup disclosure too');
};

const testOpenAiSelectionNearDuplicateDisclosureParity = async (): Promise<void> => {
  const makeCandidate = (id: string, playerIds: string[]): LineupCandidate => ({
    id, playerIds, rosterSlots: Object.fromEntries(playerIds.map((playerId, index) => [`SLOT_${index}`, playerId])), salaryUsed: 9000, salaryRemaining: 1000, median: 40, ceiling: 55,
    correlationScore: 0, optimalLineupFrequency: 1, topOnePercentFrequency: 1, ownershipEstimate: 0.2, leverageScore: 0.8, duplicationRisk: 'LOW',
    estimatedDuplicates: 5, medianRank: 1, ceilingRank: 1, tournamentRank: 1, candidateTypes: [], gameScriptCluster: 'SINGLE_TEAM_OR_UNKNOWN', strategicSimilarity: 0, riskFlags: [],
  });
  const candidates = [makeCandidate('c1', ['p1', 'p2', 'p3', 'p4', 'p5']), makeCandidate('c2', ['p1', 'p2', 'p3', 'p4', 'p6'])];
  const twoEntrySlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, userEntryCount: 2, requestedEntryCount: 2 } };
  const baselineSelection = selectLineups({ validatedSlate: twoEntrySlate, researchPackage: research, optimizerPackage: { candidates } }, now);
  assert.ok(baselineSelection.warnings.some((warning) => warning.includes('closely overlap')), 'sanity check: the deterministic pass should already flag this pair as near-duplicate');

  const fetcher = (async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ selections: [{ candidateId: 'c1', explanation: 'Top build.' }, { candidateId: 'c2', explanation: 'Second build.' }] }) }) })) as unknown as typeof fetch;
  const result = await selectWithOpenAi({ slate: twoEntrySlate, research, candidates, selection: baselineSelection, cashLineCalibration: undefined }, { apiKey: 'test-key', fetcher });
  assert.equal(result.selectedLineups.length, 2);
  assert.ok((result.warnings ?? []).some((warning) => warning.includes('closely overlap')), 'a near-duplicate pair within the actual OpenAI-selected set must be disclosed at the portfolio level, not just via Optimizer\'s pool-wide average');
  assert.ok(result.selectedLineups.some((lineup) => lineup.rationale.some((line) => line.includes('closely overlaps'))), 'the affected lineup(s) must carry a per-lineup disclosure too');
};

const testRoleCertaintyThreeTierParity = (): void => {
  const findings: ResearchFinding[] = Array.from({ length: 3 }, (_, index) => ({ id: `f-${index}`, subjectId: 'p1', bucket: 'RECENT_ROLE_FORM', finding: 'Confirmed starting role with stable, well-established playing time.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() }));
  const highCertaintyResearch: ResearchPackage = { ...research, findings };
  const highAdjustment = adjustSlate(baseSlate, highCertaintyResearch, now).adjustments.find((item) => item.playerId === 'p1')!;
  assert.equal(highAdjustment.roleCertainty, 'HIGH', 'three or more corroborating findings for the same player should reach HIGH role certainty on the deterministic-only path');

  const mediumCertaintyResearch: ResearchPackage = { ...research, findings: [findings[0]] };
  const mediumAdjustment = adjustSlate(baseSlate, mediumCertaintyResearch, now).adjustments.find((item) => item.playerId === 'p1')!;
  assert.equal(mediumAdjustment.roleCertainty, 'MEDIUM');
};

const testOwnershipEstimateReflectsVolatilityParity = (): void => {
  const volatileProjection: ProjectionPackage = { ...projection, players: projection.players.map((player) => player.playerId === 'p1' ? { ...player, projectedOutcomes: { floorP20: 5, medianP50: 30, ceilingP90: 70 } } : player) };
  const stableResult = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  const volatileResult = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: volatileProjection }, { maxCandidates: 20 }, now);
  const stableCandidate = stableResult.candidates.find((candidate) => candidate.playerIds.includes('p1'))!;
  const volatileCandidate = volatileResult.candidates.find((candidate) => candidate.playerIds.includes('p1'))!;
  assert.ok(volatileCandidate.ownershipEstimate < stableCandidate.ownershipEstimate, 'a lineup built from a higher-relative-variance player should get a lower ownership estimate (more leverage) than an identical-median, lower-variance lineup');
};

const testAdjustmentStatusReflectsResolvedConflictsParity = (): void => {
  const coverAll: ResearchFinding[] = [
    { id: 'f-p2', subjectId: 'p2', bucket: 'RECENT_ROLE_FORM', finding: 'Confirmed starting role with stable, established playing time.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
    { id: 'f-p3', subjectId: 'p3', bucket: 'RECENT_ROLE_FORM', finding: 'Confirmed starting role with stable, established playing time.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
  ];

  const nettedFindings: ResearchFinding[] = [...coverAll,
    { id: 'f-out', subjectId: 'p1', bucket: 'AVAILABILITY', finding: 'Player was ruled out for tonight.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
    { id: 'f-usage', subjectId: 'p1', bucket: 'RECENT_ROLE_FORM', finding: 'Increased usage as the primary scoring option.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
  ];
  const nettedConflicts = [{ findingIds: ['f-out', 'f-usage'], subjectId: 'p1', summary: 'Conflicting availability/role evidence.', resolved: false }];
  const resolvedResearch: ResearchPackage = { ...research, findings: nettedFindings, unknowns: [], conflicts: nettedConflicts, status: 'PARTIAL' };
  const resolvedAdjustment = adjustSlate(baseSlate, resolvedResearch, now);
  assert.equal(resolvedAdjustment.status, 'COMPLETE', 'a conflict Adjustment itself nets into a real signal must no longer keep Adjustment PARTIAL just because Research never marks it resolved');

  const unnettedFindings: ResearchFinding[] = [...coverAll,
    { id: 'f-usage2', subjectId: 'p1', bucket: 'RECENT_ROLE_FORM', finding: 'Increased usage as the primary scoring option.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
    { id: 'f-restricted', subjectId: 'p1', bucket: 'AVAILABILITY', finding: 'Questionable due to a minor workload restriction.', sourceName: 'Test', sourceTier: 1, confidence: 'HIGH', retrievedAt: now.toISOString() },
  ];
  const unnettedConflicts = [{ findingIds: ['f-usage2', 'f-restricted'], subjectId: 'p1', summary: 'Conflicting role/availability evidence that nets to near zero.', resolved: false }];
  const unresolvedResearch: ResearchPackage = { ...research, findings: unnettedFindings, unknowns: [], conflicts: unnettedConflicts, status: 'PARTIAL' };
  const stillPartialAdjustment = adjustSlate(baseSlate, unresolvedResearch, now);
  assert.equal(stillPartialAdjustment.status, 'PARTIAL', 'a conflict Adjustment could NOT net into a real signal must still be reported PARTIAL');
};

const testContractParity = (): void => {
  assertSlate(baseSlate);
  assertProjection(projection);
  assert.throws(() => assertSlate({ ...baseSlate, scoringRules: {} }), /scoring rules are required/);
};

(async () => {
  testOptimizerParity(); testUnprojectedPlayerExclusion(); testCashLineFieldEstimateParity(); testSalarySlotParity(); testCashGameSelectionParity(); testGppSelectionUnaffectedByCashLineParity(); testSelectionParity(); testSelectionWatchItemsParity(); testAvailabilityParity(); testOutPlayersRemovedForNonMlbSportsParity(); testContestKindClassificationParity(); testCashLineCalibrationBoundaryParity(); testConflictingEvidenceNetsRealSignalParity(); testNoiseWidthReflectsRoleCertaintyParity(); testDegradedAvailabilityParity(); testThinPoolDiversityDisclosureParity(); testRoleCertaintyThreeTierParity(); testOwnershipEstimateReflectsVolatilityParity(); testAdjustmentStatusReflectsResolvedConflictsParity(); testContractParity();
  await testAvailabilitySeedsResearchParity();
  await testOpenAiSelectionNearDuplicateDisclosureParity();
  console.log('engine parity tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
