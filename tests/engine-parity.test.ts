import assert from 'node:assert/strict';
import { applyAvailabilitySnapshot, withDegradedAvailability } from '../src/lib/engine/availability';
import { adjustSlate } from '../src/lib/engine/adjustment';
import { projectSlate } from '../src/lib/engine/projection';
import { buildCashLineCalibration, calibratedCashLineProbability } from '../src/lib/engine/cashLineCalibration';
import { classifyContestKind, buildValidatedSlateFromBundle } from '../src/lib/engine/draftKingsSlate';
import { optimizeLineups } from '../src/lib/engine/optimizer';
import { selectWithOpenAi } from '../src/lib/engine/openAiSelection';
import { ResearchAgent } from '../src/lib/engine/researchAgent';
import { findingsFromAvailability } from '../src/lib/engine/researchEvidence';
import { normalizeArticles } from '../src/lib/engine/researchEvidence';
import { overlap, selectLineups } from '../src/lib/engine/selection';
import { deriveSeasonBasedInputs, gamesPlayedFromRow } from '../src/lib/engine/projectionInputs';
import { evaluateProjectionCalibration, validatePreLockBacktestRows } from '../src/lib/engine/calibration';
import { seasonParamFor } from '../src/lib/engine/sportsDataIoProvider';
import { getTeamMarketContext } from '../src/lib/engine/oddsProvider';
import { assertProjection, assertSlate } from '../src/lib/engine/validation';
import { dkMlbHitterFantasyPoints, dkMlbPitcherFantasyPoints, dkNflFantasyPoints } from '../src/lib/dkScoring';
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

const testMlbUnconfirmedStarterExclusion = (): void => {
  const mlbSlate: ValidatedSlate = {
    ...baseSlate,
    sport: 'MLB',
    league: 'MLB',
    playerPool: baseSlate.playerPool.map((player, index) => ({
      ...player,
      position: index === 0 ? 'SP' : 'OF',
      availability: index === 0
        ? { status: 'UNKNOWN' as const, confirmed: false, source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), mappedBy: 'UNMAPPED' as const }
        : { status: 'ACTIVE' as const, confirmed: true, source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), mappedBy: 'NAME_AND_TEAM' as const },
    })),
  };
  const result = optimizeLineups({ validatedSlate: mlbSlate, projectionPackage: { ...projection, sport: 'MLB' } }, { maxCandidates: 20 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.warnings.some((warning) => warning.includes('MLB starting pitcher(s) excluded')));
  assert.ok(result.candidates.every((candidate) => !candidate.playerIds.includes('p1')), 'an unconfirmed MLB starting pitcher must not enter a lineup');

  const confirmed = { ...mlbSlate, playerPool: mlbSlate.playerPool.map((player, index) => index === 0 ? { ...player, availability: { ...player.availability!, status: 'CONFIRMED_STARTER' as const, confirmed: true } } : player) };
  const confirmedResult = optimizeLineups({ validatedSlate: confirmed, projectionPackage: { ...projection, sport: 'MLB' } }, { maxCandidates: 20 }, now);
  assert.ok(confirmedResult.candidates.some((candidate) => candidate.playerIds.includes('p1')), 'a confirmed MLB starting pitcher must remain eligible');
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
  assert.equal(chosen?.heuristicTournamentRank ?? chosen?.tournamentRank, 1, 'GPP selection must rank by the heuristic tournament composite, ignoring cash-line probability entirely');
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
  assert.equal(result.playerPool.length, 2, 'a confirmed lineup must not silently remove an otherwise unmapped player'); assert.equal(result.playerPool[0].availability?.status, 'CONFIRMED_STARTER'); assert.equal(result.playerPool[1].availability?.status, 'UNKNOWN');
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

  assert.equal(highSpread, lowSpread, 'confidence must not mechanically widen or narrow performance variance for identical inputs');
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
    id, playerIds, rosterSlots: Object.fromEntries(playerIds.map((playerId, index) => [`SLOT_${index}`, playerId])), salaryUsed: 9000, salaryRemaining: 1000, floor: 30, median: 40, ceiling: 55,
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
  assert.ok(result.selectedLineups.every((lineup) => lineup.floor === 30), 'the OpenAI selection path must preserve floor from the optimizer candidate, not silently drop it (a real production bug: a missing floor made a real post-contest diagnosis fall back to a cruder tolerance check instead of the real floor/ceiling range)');
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
  assert.ok(volatileCandidate.heuristicOwnershipProxy! < stableCandidate.heuristicOwnershipProxy!, 'a lineup built from a higher-relative-variance player should get a lower ownership proxy (more leverage) than an identical-median, lower-variance lineup');
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

const testSearchOrderFindsHighValueStudParity = (): void => {
  // Mirrors a real production bug: cheap bench players with decent production have HIGHER
  // points-per-$1k efficiency than an expensive stud (salary doesn't scale linearly with
  // production), so sorting the DFS search by efficiency tries every cheap-player combination
  // before ever trying the stud -- and can exhaust a small search budget before backtracking to
  // try them at all, in any slot including captain. Sorting by raw projected value instead
  // fixes this; this test would fail under the old efficiency-based sort.
  const cheapPlayer = (id: string, team: string) => ({ playerId: id, playerName: id, team, salary: 2000, captainSalary: 3000, utilitySalary: 2000, eligibility: { CPT: true, UTIL: true } });
  const studSlate: ValidatedSlate = {
    ...showdownSlate(),
    salaryCap: 50000,
    playerPool: [
      cheapPlayer('chp-a1', 'A'), cheapPlayer('chp-a2', 'A'), cheapPlayer('chp-a3', 'A'),
      cheapPlayer('chp-b1', 'B'), cheapPlayer('chp-b2', 'B'), cheapPlayer('chp-b3', 'B'),
      { playerId: 'stud-a', playerName: 'Stud', team: 'A', salary: 10000, captainSalary: 15000, utilitySalary: 10000, eligibility: { CPT: true, UTIL: true } },
    ],
  };
  const cheapProjection = (id: string) => ({ playerId: id, salary: 2000, baselineOpportunity: { points: 8 }, adjustedOpportunity: { points: 8 }, opportunityDelta: { points: 0 }, componentProjection: { points: 8 }, projectedOutcomes: { floorP20: 6, medianP50: 8, ceilingP90: 10 }, salaryEfficiency: { medianPer1k: 4, ceilingPer1k: 5 }, confidence: 'HIGH' as const, uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' });
  const studProjection: ProjectionPackage = {
    slateId: 'slate-1', tenantId: 'tenant-1', sport: 'NBA', version: 1, generatedAt: now.toISOString(), modelVersion: 'test', simulationRuns: 10,
    players: [...['chp-a1', 'chp-a2', 'chp-a3', 'chp-b1', 'chp-b2', 'chp-b3'].map(cheapProjection),
      { playerId: 'stud-a', salary: 10000, baselineOpportunity: { points: 30 }, adjustedOpportunity: { points: 30 }, opportunityDelta: { points: 0 }, componentProjection: { points: 30 }, projectedOutcomes: { floorP20: 24, medianP50: 30, ceilingP90: 36 }, salaryEfficiency: { medianPer1k: 3, ceilingPer1k: 3.6 }, confidence: 'HIGH' as const, uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' },
    ], gaps: [], status: 'COMPLETE',
  };
  const result = optimizeLineups({ validatedSlate: studSlate, projectionPackage: studProjection }, { maxCandidates: 2 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates.some((candidate) => candidate.rosterSlots.CPT === 'stud-a'), 'the highest-value player must be reachable as captain even under a small search budget, not pruned out purely because cheaper players rank higher on salary efficiency');
};

const testGolfClassicSlateBuildParity = (): void => {
  // Mirrors real production bugs found live against a real DK Golf Classic contest: (1) DK's own
  // gameTypeRules response has no scoring-rules field at all for Golf, so the slate build hard-
  // crashed with "scoring rules are required" until standardScoringRules() got a real GOLF entry;
  // (2) Golf draftables carry no eligibility/eligiblePositions/positions array (DK represents
  // eligibility via a single rosterSlotId instead, since every Classic Golf slot is the same
  // interchangeable "G" slot) -- the array-based parser silently produced an empty eligibility
  // object for every golfer, which would have blocked every roster combination downstream even
  // once scoring worked. Shapes below mirror the real API responses fetched live for this test.
  const now2 = new Date('2026-08-27T13:00:00.000Z');
  const bundle = {
    contest: { data: { contestDetail: { name: 'Test Golf Classic', gameTypeId: 6, draftGroupId: 152473, maximumEntries: 17, entries: 10, payoutSummary: [] } }, url: 'x', retrievedAt: now2.toISOString(), status: 200 },
    draftGroup: { data: { draftGroup: { eventId: 'evt-1', name: 'TOUR Championship', startTime: '2026-08-27T15:00:00.000Z' } }, url: 'x', retrievedAt: now2.toISOString(), status: 200 },
    gameTypeRules: { data: { salaryCap: { maxValue: 50000 }, lineupTemplate: Array.from({ length: 6 }, (_, index) => ({ rosterSlot: { id: 118, name: 'G' }, order: index + 1 })) }, url: 'x', retrievedAt: now2.toISOString(), status: 200 },
    draftables: { data: { draftables: [
      { draftableId: 1, playerId: 1496, playerDkId: 607, displayName: 'Scottie Scheffler', position: 'G', rosterSlotId: 118, salary: 14000, status: 'None' },
      { draftableId: 2, playerId: 1497, playerDkId: 608, displayName: 'Rory McIlroy', position: 'G', rosterSlotId: 118, salary: 13000, status: 'None' },
    ] }, url: 'x', retrievedAt: now2.toISOString(), status: 200 },
  };
  const slate = buildValidatedSlateFromBundle(bundle, { tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', sport: 'GOLF', league: 'GOLF', contestId: '194164749', contestFormat: 'CLASSIC', userEntryCount: 1, contestName: 'Test Golf Classic', contestLockTime: '2026-08-27T15:00:00.000Z' });
  assert.equal(slate.validation.status, 'VALID', `Golf Classic slate build must not fail validation: ${JSON.stringify(slate.validation.errors)}`);
  assert.ok(Object.keys(slate.scoringRules).length > 0, 'GOLF must have a real, non-empty scoring-rules fallback');
  assert.ok(['birdies', 'eagles', 'bogeys', 'pars'].every((key) => key in slate.scoringRules), 'GOLF scoring rules must use the component keys the projection model reads (birdies/eagles/bogeys/pars)');
  assert.equal(slate.playerPool.length, 2);
  assert.equal(slate.playerPool[0].eligibility.G, true, 'every Golf Classic player must be eligible for the G slot, not left with an empty eligibility object');
  assert.equal(slate.rosterRules.slots.G?.count, 6);
};

const testSeasonBasedInputsParity = (): void => {
  const hitter = { ...baseSlate.playerPool[0], playerName: 'Yordan Alvarez', team: 'HOU', position: 'OF' };
  const hitterRow = { Name: 'Yordan Alvarez', Team: 'HOU', Games: 130, PlateAppearances: 569.3, AtBats: 466.6, Hits: 150.5, Singles: 85.7, Doubles: 27.9, Triples: 1, HomeRuns: 35.9, TotalBases: 288.1, RunsBattedIn: 90.7, Runs: 87.7, StolenBases: 1, Walks: 90.7 };
  const hitterInputs = deriveSeasonBasedInputs('MLB', hitter, [hitterRow]);
  assert.ok(hitterInputs);
  assert.ok(hitterInputs!.expectedPA > 3 && hitterInputs!.expectedPA < 6, 'a real slugger\'s per-game plate appearances should land in a realistic 3-6 range, not a season total or a scrambled fraction');
  assert.ok(Math.abs(hitterInputs!.hitRate - hitterRow.Hits / hitterRow.PlateAppearances) < 1e-9, 'rate stats must stay computed against season totals, not divided by games again');

  const pitcher = { ...baseSlate.playerPool[0], playerName: 'Patrick Corbin', team: 'TOR', position: 'SP' };
  const pitcherRow = { Name: 'Patrick Corbin', Team: 'TOR', Games: 19, InningsPitchedDecimal: 79.8, PitchingStrikeouts: 62.8, PitchingWalks: 24.9, PitchingHits: 97.7, PitchingEarnedRuns: 48.9, Strikeouts: 0, Walks: 0 };
  const pitcherInputs = deriveSeasonBasedInputs('MLB', pitcher, [pitcherRow]);
  assert.ok(pitcherInputs);
  assert.ok(pitcherInputs!.strikeoutsPerInning > 0, 'a pitcher\'s real strikeouts live under PitchingStrikeouts, not the bare (batting) Strikeouts field, which is 0 for this row');
  assert.ok(pitcherInputs!.expectedInnings > 3 && pitcherInputs!.expectedInnings < 8, 'a real starter\'s per-game innings should land in a realistic range');

  const wr = { ...baseSlate.playerPool[0], playerName: 'K.Allen', team: 'JAX', position: 'WR' };
  const wrRow = { Name: 'K.Allen', Team: 'JAX', Played: 17, ReceivingTargets: 138.2, Receptions: 91.8, ReceivingYards: 880.3, ReceivingTouchdowns: 5.1, RushingAttempts: 0, RushingYards: 0, RushingTouchdowns: 0 };
  const wrInputs = deriveSeasonBasedInputs('NFL', wr, [wrRow]);
  assert.ok(wrInputs);
  assert.ok(wrInputs!.targets > 5, 'NFL season rows report targets under ReceivingTargets, not the bare Targets field, which is absent');
  assert.ok(gamesPlayedFromRow(wrRow) === 17, 'NFL season rows report games played under Played, not Games');

  assert.equal(deriveSeasonBasedInputs('MLB', hitter, [{ ...hitterRow, Games: 0 }]), undefined, 'zero games played must be treated as no data, never a divide-by-zero guess');
  assert.equal(deriveSeasonBasedInputs('MLB', hitter, []), undefined, 'no matching row must be treated as no data');
};

const testSeasonParamForParity = (): void => {
  assert.equal(seasonParamFor('MLB', '2026-08-26T23:05:00.000Z'), '2026');
  assert.equal(seasonParamFor('NBA', '2026-08-26T23:05:00.000Z'), '2026');
  assert.equal(seasonParamFor('NFL', '2026-08-26T23:05:00.000Z'), '2026REG');
  assert.equal(seasonParamFor('NFL', '2026-08-26T23:05:00.000Z', -1), '2025REG');
};

const testMarketContextImpliedTotalParity = async (): Promise<void> => {
  const fetcher = (async () => ({ ok: true, json: async () => ([
    {
      home_team: 'Los Angeles Lakers', away_team: 'Boston Celtics',
      bookmakers: [
        { markets: [
          { key: 'totals', outcomes: [{ name: 'Over', point: 220 }, { name: 'Under', point: 220 }] },
          { key: 'spreads', outcomes: [{ name: 'Los Angeles Lakers', point: -4 }, { name: 'Boston Celtics', point: 4 }] },
        ] },
        { markets: [
          { key: 'totals', outcomes: [{ name: 'Over', point: 222 }, { name: 'Under', point: 222 }] },
          { key: 'spreads', outcomes: [{ name: 'Los Angeles Lakers', point: -4 }, { name: 'Boston Celtics', point: 4 }] },
        ] },
      ],
    },
  ]) })) as unknown as typeof fetch;
  const result = await getTeamMarketContext('NBA', 'test-key', { fetcher });
  const lakers = result.get('LAL');
  const celtics = result.get('BOS');
  assert.ok(lakers, 'a real Odds API team name must resolve to its DK short code');
  assert.ok(celtics);
  assert.equal(lakers!.gameTotal, 221, 'the game total should be averaged across bookmakers, not taken from just the first one');
  assert.equal(lakers!.spread, -4);
  assert.equal(lakers!.opponent, 'BOS');
  assert.equal(lakers!.impliedTeamTotal, 221 / 2 - -4 / 2, 'impliedTeamTotal = gameTotal/2 - spread/2, using the team\'s own signed spread');
  assert.equal(celtics!.impliedTeamTotal, 221 / 2 - 4 / 2);

  const noMatch = await getTeamMarketContext('NBA', 'test-key', { fetcher: (async () => ({ ok: true, json: async () => ([{ home_team: 'Unknown Team', away_team: 'Boston Celtics', bookmakers: [] }]) })) as unknown as typeof fetch });
  assert.equal(noMatch.size, 0, 'a team name that cannot be confidently matched must be skipped entirely, never force-matched');
};

const testMarketDerivedOwnershipNudgeParity = (): void => {
  const marketSlate: ValidatedSlate = {
    ...baseSlate,
    rosterRules: { rosterSize: 2, slots: { G: { count: 1 }, F: { count: 1 } }, uniquePlayersRequired: true },
    playerPool: [
      { playerId: 'm1', playerName: 'M1', team: 'HIGH', salary: 5000, eligibility: { G: true, F: true }, marketContext: { impliedTeamTotal: 130, spread: -6, gameTotal: 240 } },
      { playerId: 'm2', playerName: 'M2', team: 'HIGH', salary: 4500, eligibility: { G: true, F: true }, marketContext: { impliedTeamTotal: 130, spread: -6, gameTotal: 240 } },
      { playerId: 'm3', playerName: 'M3', team: 'LOW', salary: 4000, eligibility: { G: true, F: true }, marketContext: { impliedTeamTotal: 90, spread: 6, gameTotal: 240 } },
      { playerId: 'm4', playerName: 'M4', team: 'LOW', salary: 3500, eligibility: { G: true, F: true }, marketContext: { impliedTeamTotal: 90, spread: 6, gameTotal: 240 } },
    ],
  };
  const identicalOutcomes = { floorP20: 20, medianP50: 30, ceilingP90: 45 };
  const identicalEfficiency = { medianPer1k: 6, ceilingPer1k: 9 };
  const marketProjection: ProjectionPackage = { ...projection, players: marketSlate.playerPool.map((player) => ({ playerId: player.playerId, salary: player.salary, baselineOpportunity: { points: 30 }, adjustedOpportunity: { points: 30 }, opportunityDelta: { points: 0 }, componentProjection: { points: 30 }, projectedOutcomes: identicalOutcomes, salaryEfficiency: identicalEfficiency, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' })) };
  const result = optimizeLineups({ validatedSlate: marketSlate, projectionPackage: marketProjection }, { maxCandidates: 20 }, now);
  const highLineup = result.candidates.find((candidate) => candidate.playerIds.includes('m1') && candidate.playerIds.includes('m2'));
  const lowLineup = result.candidates.find((candidate) => candidate.playerIds.includes('m3') && candidate.playerIds.includes('m4'));
  assert.ok(highLineup && lowLineup, 'both an all-above-average-team and an all-below-average-team lineup should be reachable candidates');
  assert.ok(highLineup!.heuristicOwnershipProxy! > lowLineup!.heuristicOwnershipProxy!, 'an identical-quality lineup built from teams with an above-average implied total should get a higher ownership proxy than one from below-average teams');

  // A slate where every team's implied total exactly equals the slate average produces an exact
  // 0 nudge (multiplier stays at exactly 1) -- the same "no nudge" outcome as no marketContext at
  // all, and comparing matched candidate IDs sidesteps the medianRank tie-break noise that a
  // direct high-vs-low comparison on an all-identical-projection fixture would otherwise carry.
  const neutralMarketSlate: ValidatedSlate = { ...marketSlate, playerPool: marketSlate.playerPool.map((player) => ({ ...player, marketContext: { impliedTeamTotal: 110, spread: 0, gameTotal: 220 } })) };
  const neutralResult = optimizeLineups({ validatedSlate: neutralMarketSlate, projectionPackage: marketProjection }, { maxCandidates: 20 }, now);
  const noMarketSlate: ValidatedSlate = { ...marketSlate, playerPool: marketSlate.playerPool.map((player) => ({ ...player, marketContext: undefined })) };
  const noMarketResult = optimizeLineups({ validatedSlate: noMarketSlate, projectionPackage: marketProjection }, { maxCandidates: 20 }, now);
  assert.ok(noMarketResult.candidates.length > 0);
  for (const candidate of noMarketResult.candidates) {
    const matched = neutralResult.candidates.find((item) => item.id === candidate.id);
    assert.ok(matched, 'the same rosterSlots combination should be generated regardless of marketContext presence');
    assert.ok(Math.abs(matched!.heuristicOwnershipProxy! - candidate.heuristicOwnershipProxy!) < 1e-9, 'with no marketContext at all, the ownership proxy must fall back to exactly the prior (identical) behavior — no phantom nudge');
  }
};

const testBringBackCorrelationParity = (): void => {
  const nflRoster = { rosterSize: 2, slots: { QB: { count: 1 }, WR: { count: 1 } }, uniquePlayersRequired: true };
  const nflProjectionFor = (ids: string[]): ProjectionPackage => ({ ...projection, players: ids.map((playerId) => ({ playerId, salary: 4000, baselineOpportunity: { points: 20 }, adjustedOpportunity: { points: 20 }, opportunityDelta: { points: 0 }, componentProjection: { points: 20 }, projectedOutcomes: { floorP20: 15, medianP50: 20, ceilingP90: 28 }, salaryEfficiency: { medianPer1k: 5, ceilingPer1k: 7 }, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' })) });

  const bringBackSlate: ValidatedSlate = { ...baseSlate, sport: 'NFL', league: 'NFL', rosterRules: nflRoster, playerPool: [
    { playerId: 'qb1', playerName: 'QB1', team: 'A', opponent: 'B', position: 'QB', salary: 5000, eligibility: { QB: true, WR: false } },
    { playerId: 'wr1', playerName: 'WR1', team: 'B', opponent: 'A', position: 'WR', salary: 4000, eligibility: { QB: false, WR: true } },
  ] };
  const bringBackResult = optimizeLineups({ validatedSlate: bringBackSlate, projectionPackage: nflProjectionFor(['qb1', 'wr1']) }, { maxCandidates: 5 }, now);
  assert.equal(bringBackResult.status, 'COMPLETE');
  assert.ok(bringBackResult.candidates[0].correlationScore > 0, 'a QB and the OPPOSING team\'s WR in the same game (a classic bring-back) must correlate positively, not fall through to the old flat 0 for different-team pairs');

  const unrelatedSlate: ValidatedSlate = { ...baseSlate, sport: 'NFL', league: 'NFL', rosterRules: nflRoster, playerPool: [
    { playerId: 'qb1', playerName: 'QB1', team: 'A', opponent: 'B', position: 'QB', salary: 5000, eligibility: { QB: true, WR: false } },
    { playerId: 'wr1', playerName: 'WR1', team: 'C', opponent: 'D', position: 'WR', salary: 4000, eligibility: { QB: false, WR: true } },
  ] };
  const unrelatedResult = optimizeLineups({ validatedSlate: unrelatedSlate, projectionPackage: nflProjectionFor(['qb1', 'wr1']) }, { maxCandidates: 5 }, now);
  assert.equal(unrelatedResult.candidates[0].correlationScore, 0, 'players on unrelated teams (not in the same game at all) must still correlate at exactly 0');
};

const testMlbHitterCorrelationParity = (): void => {
  const mlbSlate: ValidatedSlate = { ...baseSlate, sport: 'MLB', league: 'MLB', rosterRules: { rosterSize: 2, slots: { OF: { count: 1 }, '1B': { count: 1 } }, uniquePlayersRequired: true }, playerPool: [
    { playerId: 'of1', playerName: 'OF1', team: 'A', position: 'OF', salary: 5000, eligibility: { OF: true, '1B': false } },
    { playerId: 'b1', playerName: 'B1', team: 'A', position: '1B', salary: 4000, eligibility: { OF: false, '1B': true } },
  ] };
  const mlbProjection: ProjectionPackage = { ...projection, players: mlbSlate.playerPool.map((player) => ({ playerId: player.playerId, salary: player.salary, baselineOpportunity: { points: 15 }, adjustedOpportunity: { points: 15 }, opportunityDelta: { points: 0 }, componentProjection: { points: 15 }, projectedOutcomes: { floorP20: 10, medianP50: 15, ceilingP90: 22 }, salaryEfficiency: { medianPer1k: 3, ceilingPer1k: 4.4 }, confidence: 'HIGH', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'test' })) };
  const result = optimizeLineups({ validatedSlate: mlbSlate, projectionPackage: mlbProjection }, { maxCandidates: 5 }, now);
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates[0].correlationScore > 0, 'two same-team MLB hitters must now correlate positively — this was zero before MLB had any POSITION_CORRELATION entries');
};

const testGenuinePortfolioDiversityParity = (): void => {
  const makeCandidate = (id: string, playerIds: string[], tournamentRank: number): LineupCandidate => ({
    id, playerIds, rosterSlots: Object.fromEntries(playerIds.map((playerId, index) => [`SLOT_${index}`, playerId])), salaryUsed: 9000, salaryRemaining: 1000, median: 40 - tournamentRank * 0.1, ceiling: 55,
    correlationScore: 0, optimalLineupFrequency: 1, topOnePercentFrequency: 1, ownershipEstimate: 0.2, leverageScore: 0.8, duplicationRisk: 'LOW',
    estimatedDuplicates: 5, medianRank: tournamentRank, ceilingRank: tournamentRank, tournamentRank, candidateTypes: [], gameScriptCluster: 'SINGLE_TEAM_OR_UNKNOWN', strategicSimilarity: 0, riskFlags: [],
  });
  // The 4 top-ranked candidates are near-duplicates (share 4 of 5 players); a genuinely distinct
  // build only shows up ranked 5th. Old pure-rank selection would pick exactly the 4 duplicates.
  const candidates = [
    makeCandidate('c1', ['p1', 'p2', 'p3', 'p4', 'p5'], 1),
    makeCandidate('c2', ['p1', 'p2', 'p3', 'p4', 'p6'], 2),
    makeCandidate('c3', ['p1', 'p2', 'p3', 'p4', 'p7'], 3),
    makeCandidate('c4', ['p1', 'p2', 'p3', 'p4', 'p8'], 4),
    makeCandidate('c5', ['q1', 'q2', 'q3', 'q4', 'q5'], 5),
  ];
  const fourEntrySlate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, userEntryCount: 4, requestedEntryCount: 4 } };
  const result = selectLineups({ validatedSlate: fourEntrySlate, researchPackage: research, optimizerPackage: { candidates } }, now);
  assert.equal(result.selectedLineups.length, 4, 'must always fill the requested count when the candidate pool has enough candidates -- diversity must never reduce the portfolio size');
  const oldTop4Overlap = averagePairwiseOverlapForTest([['p1', 'p2', 'p3', 'p4', 'p5'], ['p1', 'p2', 'p3', 'p4', 'p6'], ['p1', 'p2', 'p3', 'p4', 'p7'], ['p1', 'p2', 'p3', 'p4', 'p8']]);
  const newOverlap = averagePairwiseOverlapForTest(result.selectedLineups.map((lineup) => lineup.playerIds));
  assert.ok(newOverlap < oldTop4Overlap, 'genuine diversity must produce measurably lower average pairwise overlap than picking strictly by rank');
  assert.ok(result.selectedLineups.some((lineup) => lineup.playerIds.includes('q1')), 'the genuinely distinct 5th-ranked build should actually be pulled into the portfolio once it out-scores a near-duplicate on the diversity-adjusted score');
};
function averagePairwiseOverlapForTest(playerIdLists: string[][]): number {
  let total = 0, count = 0;
  for (let i = 0; i < playerIdLists.length; i += 1) for (let j = i + 1; j < playerIdLists.length; j += 1) { total += overlap(playerIdLists[i], playerIdLists[j]); count += 1; }
  return count ? total / count : 0;
}

const testContractParity = (): void => {
  assertSlate(baseSlate);
  assertProjection(projection);
  assert.throws(() => assertSlate({ ...baseSlate, scoringRules: {} }), /scoring rules are required/);
};

const testGate1ScoringGoldenFixtures = (): void => {
  assert.equal(dkMlbHitterFantasyPoints({ singles: 1, doubles: 1, triples: 1, homeRuns: 1, rbi: 2, runs: 1, walks: 1, hitByPitch: 1, stolenBases: 1 }), 41);
  assert.equal(dkMlbPitcherFantasyPoints({ inningsPitched: 6, strikeouts: 8, wins: 1, earnedRuns: 2, hitsAllowed: 5, walksAllowed: 2 }), 25.3);
  assert.equal(dkNflFantasyPoints({ passingYards: 350, passingTouchdowns: 3, interceptions: 1, rushingYards: 30, rushingTouchdowns: 1 }), 37);
  assert.equal(dkNflFantasyPoints({ receptions: 8, receivingYards: 120, receivingTouchdowns: 2, fumblesLost: 1 }), 34);
};

const testGate1TypedAdjustmentParity = (): void => {
  const nfl = { ...baseSlate, sport: 'NFL' as const, league: 'NFL' as const, scoringRules: { reception: { value: 1 }, receivingYards: { value: 0.1 }, rushingYards: { value: 0.1 }, receivingTouchdown: { value: 6 } }, playerPool: [{ ...baseSlate.playerPool[0], position: 'WR', projectionInputs: { snaps: 50, routes: 35, targets: 10, carries: 1, catchRate: 0.7, yardsPerTarget: 10, yardsPerCarry: 4, touchdownProbability: 0.2 } }] };
  const adjustment = adjustSlate(nfl, { ...research, findings: [{ id: 'target', subjectId: 'p1', bucket: 'RECENT_ROLE_FORM', finding: 'Target share increased.', sourceName: 'test', sourceTier: 1, confidence: 'HIGH' }] }, now);
  const projected = projectSlate(nfl, adjustment, now).players[0];
  assert.equal(projected.adjustedOpportunity.targets, 10.8);
  assert.equal(projected.adjustedOpportunity.catchRate, 0.7, 'TARGET_SHARE must not multiply catch rate');
  assert.equal(projected.adjustedOpportunity.yardsPerTarget, 10, 'TARGET_SHARE must not multiply yards per target');
};

const testGate1RoleRedistributionAndMinutesParity = (): void => {
  const slate = { ...baseSlate, playerPool: [
    { ...baseSlate.playerPool[0], playerName: 'Out PG', team: 'A', position: 'PG' },
    { ...baseSlate.playerPool[1], playerName: 'Direct PG', team: 'A', position: 'PG' },
    { ...baseSlate.playerPool[2], playerName: 'Bench C', team: 'A', position: 'C' },
  ] };
  const researchWithOut: ResearchPackage = { ...research, findings: [{ id: 'out', subjectId: 'p1', bucket: 'AVAILABILITY', finding: 'Out for tonight.', sourceName: 'test', sourceTier: 1, confidence: 'HIGH' }] };
  const adjustments = adjustSlate(slate, researchWithOut, now);
  assert.equal(adjustments.adjustments.find((item) => item.playerId === 'p2')?.adjustments.at(-1)?.magnitude, 'MATERIAL');
  assert.equal(adjustments.adjustments.find((item) => item.playerId === 'p3')?.adjustments.at(-1)?.magnitude, 'SMALL');
  assert.equal(adjustments.adjustments.find((item) => item.playerId === 'p2')?.adjustments.at(-1)?.adjustmentType, 'MINUTES');

  const basketballRules = { points: { value: 1 }, threePointersMade: { value: 0.5 }, rebounds: { value: 1.25 }, assists: { value: 1.5 }, steals: { value: 2 }, blocks: { value: 2 }, turnovers: { value: -0.5 } };
  const minutesSlate = { ...slate, playerPool: slate.playerPool.slice(0, 2).map((player) => ({ ...player, projectionInputs: { expectedMinutes: 30, pointsPerMinute: 1, reboundsPerMinute: 0, assistsPerMinute: 0, stealsPerMinute: 0, blocksPerMinute: 0, turnoversPerMinute: 0, threesPerMinute: 0 } })), scoringRules: basketballRules };
  const minutesAdjustment = adjustSlate(minutesSlate, { ...research, findings: minutesSlate.playerPool.map((player) => ({ id: `availability-${player.playerId}`, subjectId: player.playerId, bucket: 'AVAILABILITY' as const, finding: 'Active.', sourceName: 'test', sourceTier: 1 as const, confidence: 'HIGH' as const })) }, now);
  const projected = projectSlate(minutesSlate, minutesAdjustment, now);
  assert.equal(projected.players.reduce((sum, player) => sum + player.adjustedOpportunity.expectedMinutes, 0), 240, 'NBA team minutes must reconcile to 240');
};

const testGate1ResearchAttributionParity = (): void => {
  const slate = { ...baseSlate, playerPool: [{ ...baseSlate.playerPool[0], playerName: 'Player A' }, { ...baseSlate.playerPool[1], playerName: 'Player B' }] };
  const findings = normalizeArticles([{ title: 'Availability update', sourceName: 'test', sourceTier: 1, summary: 'Player A is questionable. Player B starts if Player A sits.' }], slate, now);
  assert.equal(findings.length, 3, 'each player-specific sentence context is retained for every named subject');
  assert.ok(findings.some((finding) => finding.subjectId === 'p1' && finding.bucket === 'AVAILABILITY'));
  assert.ok(findings.some((finding) => finding.subjectId === 'p2' && finding.bucket === 'RECENT_ROLE_FORM'));
};

const testGate1LineupDistributionParity = (): void => {
  const slate = { ...baseSlate, rosterRules: { rosterSize: 2, slots: { G: { count: 1 }, F: { count: 1 } }, uniquePlayersRequired: true }, playerPool: baseSlate.playerPool.slice(0, 2) };
  const packageWithJointSamples: ProjectionPackage = { ...projection, players: projection.players.slice(0, 2).map((player, index) => ({ ...player, simulatedFantasyPointSamples: index === 0 ? [0, 100] : [100, 0], projectedOutcomes: { floorP20: 0, medianP50: 50, ceilingP90: 100 } })) };
  const result = optimizeLineups({ validatedSlate: slate, projectionPackage: packageWithJointSamples }, { maxCandidates: 10 }, now);
  assert.equal(result.candidates[0].ceiling, 100, 'lineup ceiling must be computed from joint lineup samples, not summed player ceilings');
};

const testGate1OptimizerExhaustiveParity = (): void => {
  const slate = { ...baseSlate, salaryCap: 20000, rosterRules: { rosterSize: 2, slots: { G: { count: 1 }, F: { count: 1 } }, uniquePlayersRequired: true }, playerPool: baseSlate.playerPool.slice(0, 4).map((player, index) => ({ ...player, team: index % 2 ? 'B' : 'A' })) };
  const projections: ProjectionPackage = { ...projection, players: slate.playerPool.map((player, index) => ({ ...projection.players[0], playerId: player.playerId, salary: player.salary, projectedOutcomes: { floorP20: index + 1, medianP50: (index + 1) * 10, ceilingP90: (index + 1) * 12 }, simulatedFantasyPointSamples: [(index + 1) * 10, (index + 1) * 10] })) };
  const result = optimizeLineups({ validatedSlate: slate, projectionPackage: projections }, { lineupMode: 'max_fpts', maxCandidates: 10 }, now);
  const legalScores = slate.playerPool.flatMap((left, leftIndex) => slate.playerPool.flatMap((right, rightIndex) => leftIndex === rightIndex || left.team === right.team ? [] : [(leftIndex + 1) * 10 + (rightIndex + 1) * 10]));
  assert.equal(result.candidates[0].median, Math.max(...legalScores), 'reference-sized optimizer output must match independently enumerated legal-lineup truth');
  assert.ok(result.warnings.some((warning) => warning.includes('Exhaustive legal lineup enumeration')));
};

const testGate1IdentitySuffixParity = (): void => {
  const slate = { ...baseSlate, sport: 'MLB' as const, league: 'MLB' as const, playerPool: [{ ...baseSlate.playerPool[0], playerName: 'Player Jr.', team: 'CWS' }] };
  const result = applyAvailabilitySnapshot(slate, { source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), confirmedLineupAvailable: false, records: [{ playerName: 'Player', team: 'CHW', status: 'ACTIVE', confirmed: true }] });
  assert.equal(result.playerPool[0].availability?.mappedBy, 'NAME_AND_TEAM');
  assert.equal(result.playerPool[0].availability?.status, 'ACTIVE');
};

const testGate2SportDistributionAndFallbackParity = (): void => {
  const basketballRules = { points: { value: 1 }, threePointersMade: { value: 0.5 }, rebounds: { value: 1.25 }, assists: { value: 1.5 }, steals: { value: 2 }, blocks: { value: 2 }, turnovers: { value: -0.5 } };
  const slate = { ...baseSlate, sport: 'NBA' as const, league: 'NBA' as const, scoringRules: basketballRules, playerPool: baseSlate.playerPool.slice(0, 2).map((player) => ({ ...player, team: 'A', opponent: 'B', projectionInputs: { expectedMinutes: 30, pointsPerMinute: 1, reboundsPerMinute: 0.2, assistsPerMinute: 0.1, stealsPerMinute: 0.05, blocksPerMinute: 0.02, turnoversPerMinute: 0.1, threesPerMinute: 0.1 } })) };
  const projected = projectSlate(slate, adjustSlate(slate, research, now), now);
  assert.equal(projected.players[0].modelPath, 'SPORT_STRUCTURED');
  assert.equal(projected.players[0].distribution?.family, 'SPORT_CORRELATED');
  assert.equal(projected.players[0].distribution?.correlationGroup, projected.players[1].distribution?.correlationGroup, 'same verified team/opponent context must share a game correlation group');
  assert.deepEqual(projected.players[0].simulatedFantasyPointSamples, projectSlate(slate, adjustSlate(slate, research, now), now).players[0].simulatedFantasyPointSamples, 'sport distributions must be deterministic for reproducible backtests');

  const fallbackSlate = { ...slate, playerPool: [{ ...slate.playerPool[0], projectionInputs: undefined, providerFppg: 25 }] };
  const fallback = projectSlate(fallbackSlate, adjustSlate(fallbackSlate, research, now), now).players[0];
  assert.equal(fallback.modelPath, 'PROVIDER_FPPG_FALLBACK');
  assert.equal(fallback.distribution?.family, 'AGGREGATE_FPPG');
};

const testGate2CalibrationMetricsParity = (): void => {
  const packageForCalibration: ProjectionPackage = { ...projection, sport: 'NBA', players: projection.players.slice(0, 2).map((player, index) => ({ ...player, playerId: `cal-${index}`, projectedOutcomes: { floorP20: 8 + index, medianP50: 10 + index, ceilingP90: 14 + index }, componentProjection: { points: 10 + index } })) };
  const metrics = evaluateProjectionCalibration(packageForCalibration, [{ playerId: 'cal-0', actualFantasyPoints: 12, actualComponents: { points: 12 }, actualPosition: 'G' }, { playerId: 'not-joined', actualFantasyPoints: 999 }, { playerId: 'cal-1', actualFantasyPoints: 9, actualComponents: { points: 9 }, actualPosition: 'F' }]);
  assert.equal(metrics.sampleSize, 2, 'unjoined outcomes must not enter calibration metrics');
  assert.equal(metrics.fantasyPointMae, 2);
  assert.equal(metrics.componentMae.points, 2);
  assert.equal(metrics.byRole.G.sampleSize, 1);
  assert.deepEqual(validatePreLockBacktestRows([{ projectionGeneratedAt: '2026-08-23T11:00:00.000Z', lockTime: '2026-08-23T12:00:00.000Z', observation: { playerId: 'cal-0', actualFantasyPoints: 12 } }]), []);
  assert.equal(validatePreLockBacktestRows([{ projectionGeneratedAt: '2026-08-23T12:00:00.000Z', lockTime: '2026-08-23T12:00:00.000Z', observation: { playerId: 'cal-0', actualFantasyPoints: 12 } }]).length, 1, 'post-lock projections must be rejected from pre-lock backtests');
};

const testGate3ContestSimulationParity = (): void => {
  const slate: ValidatedSlate = { ...baseSlate, contest: { ...baseSlate.contest, contestSize: 10, paidPositions: 5, entryFee: 10, payoutStructure: [{ rank: 1, payout: 100 }, { rank: 2, payout: 50 }] } };
  const candidates = optimizeLineups({ validatedSlate: slate, projectionPackage: projection }, { maxCandidates: 20 }, now);
  assert.equal(candidates.contestSimulation?.status, 'COMPLETE');
  assert.equal(candidates.contestSimulation?.fieldModel, 'HEURISTIC_CONSTRUCTION_PROXY');
  assert.equal(candidates.contestSimulation?.payoutModel, 'CONTEST_PAYOUT_STRUCTURE');
  assert.ok(candidates.candidates.every((candidate) => candidate.contestMetricProvenance === 'JOINT_FIELD_SIMULATION'));
  assert.ok(candidates.candidates.every((candidate) => (candidate.winFrequency ?? -1) >= 0 && (candidate.winFrequency ?? 2) <= 1));
  assert.ok(candidates.candidates.every((candidate) => (candidate.expectedDuplicates ?? -1) >= 0));
};

(async () => {
  testOptimizerParity(); testUnprojectedPlayerExclusion(); testMlbUnconfirmedStarterExclusion(); testCashLineFieldEstimateParity(); testSalarySlotParity(); testCashGameSelectionParity(); testGppSelectionUnaffectedByCashLineParity(); testSelectionParity(); testSelectionWatchItemsParity(); testAvailabilityParity(); testOutPlayersRemovedForNonMlbSportsParity(); testContestKindClassificationParity(); testCashLineCalibrationBoundaryParity(); testConflictingEvidenceNetsRealSignalParity(); testNoiseWidthReflectsRoleCertaintyParity(); testDegradedAvailabilityParity(); testThinPoolDiversityDisclosureParity(); testRoleCertaintyThreeTierParity(); testOwnershipEstimateReflectsVolatilityParity(); testAdjustmentStatusReflectsResolvedConflictsParity(); testSearchOrderFindsHighValueStudParity(); testGolfClassicSlateBuildParity(); testSeasonBasedInputsParity(); testSeasonParamForParity(); testMarketDerivedOwnershipNudgeParity(); testBringBackCorrelationParity(); testMlbHitterCorrelationParity(); testGenuinePortfolioDiversityParity(); testContractParity(); testGate1ScoringGoldenFixtures(); testGate1TypedAdjustmentParity(); testGate1RoleRedistributionAndMinutesParity(); testGate1ResearchAttributionParity(); testGate1LineupDistributionParity(); testGate1OptimizerExhaustiveParity(); testGate1IdentitySuffixParity(); testGate2SportDistributionAndFallbackParity(); testGate2CalibrationMetricsParity(); testGate3ContestSimulationParity();
  await testAvailabilitySeedsResearchParity();
  await testOpenAiSelectionNearDuplicateDisclosureParity();
  await testMarketContextImpliedTotalParity();
  console.log('engine parity tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
