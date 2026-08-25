import assert from 'node:assert/strict';
import { applyAvailabilitySnapshot } from '../src/lib/engine/availability';
import { optimizeLineups } from '../src/lib/engine/optimizer';
import { selectLineups } from '../src/lib/engine/selection';
import { assertProjection, assertSlate } from '../src/lib/engine/validation';
import type { ProjectionPackage, ResearchPackage, ValidatedSlate } from '../src/lib/engine/contracts';

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

const testSalarySlotParity = (): void => {
  const slate = showdownSlate();
  const playerPool = slate.playerPool.map((player) => ({ ...player, playerId: player.playerId.replace('home-', 'p') }));
  const result = optimizeLineups({ validatedSlate: { ...slate, playerPool, salaryCap: 15000 }, projectionPackage: { ...projection, players: projection.players } });
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.candidates.some((item) => item.rosterSlots.CPT === 'p1' && item.salaryUsed === 10500));
};

const testSelectionParity = (): void => {
  const optimizer = optimizeLineups({ validatedSlate: baseSlate, projectionPackage: projection });
  const result = selectLineups({ validatedSlate: baseSlate, researchPackage: research, optimizerPackage: optimizer }, now);
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.selectedLineups.length, 1); assert.ok(optimizer.candidates.some((candidate) => candidate.id === result.selectedLineups[0].candidateId));
};

const testAvailabilityParity = (): void => {
  const mlb = { ...baseSlate, sport: 'MLB' as const, league: 'MLB' as const, playerPool: [{ ...baseSlate.playerPool[0], playerName: 'Player One', team: 'CWS' }, { ...baseSlate.playerPool[1], playerName: 'Player Two', team: 'NYY' }] };
  const result = applyAvailabilitySnapshot(mlb, { source: 'SPORTSDATAIO', retrievedAt: now.toISOString(), confirmedLineupAvailable: true, records: [{ playerName: 'Player One', team: 'CWS', status: 'CONFIRMED_STARTER', confirmed: true, battingOrder: 1 }] });
  assert.equal(result.playerPool.length, 1); assert.equal(result.playerPool[0].availability?.status, 'CONFIRMED_STARTER');
};

const testContractParity = (): void => {
  assertSlate(baseSlate);
  assertProjection(projection);
  assert.throws(() => assertSlate({ ...baseSlate, scoringRules: {} }), /scoring rules are required/);
};

testOptimizerParity(); testSalarySlotParity(); testSelectionParity(); testAvailabilityParity(); testContractParity();
console.log('engine parity tests passed');
