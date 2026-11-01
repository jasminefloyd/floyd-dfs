import assert from 'node:assert/strict';
import { runNbaSimulationBatch } from '../server/houses/nba/simulationService.js';
import { evaluateNbaSimulation, type NbaSimulationEvaluationDataset, type NbaSimulationEvaluationRow } from '../server/houses/nba/simulationEvaluation.js';
import type { ProjectionPackage, StreetTeamSnapshot, ValidatedSlate } from '../src/lib/engine/contracts.js';

const asOf = '2026-08-23T11:00:00.000Z';
const generatedAt = '2026-08-23T12:00:00.000Z';
const fixtureNow = Date.parse(generatedAt);
const lockTime = '2026-08-23T23:00:00.000Z';
const slate = {
  slateId: 'g4-slate', tenantId: 'g4-tenant', sport: 'NBA', contest: { lockTime },
  playerPool: [
    { playerId: 'p1', playerName: 'One', team: 'A', opponent: 'B', position: 'G', salary: 5000, eligibility: { G: true }, availability: { status: 'ACTIVE', confirmed: true, source: 'test', retrievedAt: generatedAt }, sportContext: { nba: { overtimeProbability: 1, expectedOvertimePeriods: 1, minutesP50: 30 } } },
    { playerId: 'p2', playerName: 'Two', team: 'A', opponent: 'B', position: 'F', salary: 5000, eligibility: { F: true }, availability: { status: 'OUT', confirmed: true, source: 'test', retrievedAt: generatedAt }, sportContext: { nba: { overtimeProbability: 1, expectedOvertimePeriods: 1, minutesP50: 30 } } },
    { playerId: 'p3', playerName: 'Three', team: 'B', opponent: 'A', position: 'G', salary: 5000, eligibility: { G: true }, availability: { status: 'ACTIVE', confirmed: true, source: 'test', retrievedAt: generatedAt }, sportContext: { nba: { overtimeProbability: 1, expectedOvertimePeriods: 1, minutesP50: 30 } } },
    { playerId: 'p4', playerName: 'Four', team: 'B', opponent: 'A', position: 'F', salary: 5000, eligibility: { F: true }, availability: { status: 'ACTIVE', confirmed: true, source: 'test', retrievedAt: generatedAt }, sportContext: { nba: { overtimeProbability: 1, expectedOvertimePeriods: 1, minutesP50: 30 } } },
  ], scoringRules: { points: { value: 1 }, rebounds: { value: 1 }, assists: { value: 1 } },
} as unknown as ValidatedSlate;
const baseline: ProjectionPackage = {
  slateId: 'g4-slate', tenantId: 'g4-tenant', sport: 'NBA', version: 1, generatedAt, modelVersion: 'fixture-projection.v1', simulationRuns: 32,
  players: slate.playerPool.map((player, index) => ({ playerId: player.playerId, salary: 5000, modelPath: 'SPORT_STRUCTURED', distribution: { family: 'SPORT_CORRELATED', drivers: ['fixture minutes', 'fixture scoring'] }, baselineOpportunity: { expectedMinutes: 30 }, adjustedOpportunity: { expectedMinutes: 30, ...(player.playerId === 'p1' ? { minutesCap: 26 } : {}), pointsPerMinute: 1 }, opportunityDelta: {}, componentProjection: {}, projectedOutcomes: { floorP20: 10, medianP50: 20 + index, ceilingP90: 40 }, simulatedFantasyPointSamples: Array.from({ length: 32 }, (_, trial) => 15 + index + trial % 7), salaryEfficiency: { medianPer1k: 4, ceilingPer1k: 8 }, confidence: 'MEDIUM', uncertaintyFactors: [], watchDependencies: [], modelVersion: 'fixture-projection.v1' })), gaps: [], status: 'COMPLETE',
};
const snapshot = { snapshotId: 'g4-snapshot', tenantId: 'g4-tenant', sport: 'NBA', asOf, createdAt: asOf, evidenceHash: 'hash', contractVersion: 'v1', observations: [], resolvedFacts: [], rosterState: [], availability: [], transactions: [], behaviorSignals: [], unknowns: [], providerDiagnostics: [] } as unknown as StreetTeamSnapshot;

const replayA = runNbaSimulationBatch({ slate, projection: baseline, availabilitySnapshot: snapshot, mode: 'game_simulation', seed: 'g4-seed', gameScenarioCount: 32, batchSize: 8, maxComputeMs: 10000, now: () => fixtureNow });
const replayB = runNbaSimulationBatch({ slate, projection: baseline, availabilitySnapshot: snapshot, mode: 'game_simulation', seed: 'g4-seed', gameScenarioCount: 32, batchSize: 8, maxComputeMs: 10000, now: () => fixtureNow });
assert.deepEqual(replayA.gameSimulation?.gameScenarios, replayB.gameSimulation?.gameScenarios, 'identical seed and versioned inputs reproduce scenarios');
assert.equal(replayA.gameSimulation?.availabilitySnapshotId, snapshot.snapshotId);
assert.equal(replayA.gameSimulation?.gameScenarioCount, 32);
assert.equal(replayA.gameSimulation?.diagnostics?.overtimeTrials, 32, 'game-level overtime scenario is shared by all player outcomes in the game');
assert.equal(replayA.gameSimulation?.diagnostics?.invariantViolations, 0, 'simulated hard minutes caps remain satisfied during overtime');
assert.equal(new Set(replayA.gameSimulation?.gameScenarios.map((scenario) => scenario.trial)).size, 32, 'each game scenario has a stable trial identifier shared by player samples');
assert.equal(replayA.gameSimulation?.gameScenarios.every((scenario) => Number.isFinite(scenario.teamScores.A) && Number.isFinite(scenario.teamScores.B)), true, 'each scenario propagates both teams through one shared game context');
assert.ok(replayA.gameSimulation?.diagnostics?.covarianceChecks?.[0]?.opposingTeamPairCount, 'the game context reports opposing-team dependence');
assert.ok(replayA.gaps.some((gap) => gap.reason.includes('Blowout-driven minutes adjustments are disabled')), 'unvalidated blowout adjustments remain disabled');
assert.equal(replayA.gameSimulation?.diagnostics?.excludedInactivePlayers, 1, JSON.stringify({ gaps: replayA.gaps, sim: replayA.gameSimulation }));
assert.ok(replayA.players.find((player) => player.playerId === 'p2')?.simulatedFantasyPointSamples?.every((value) => value === 0), 'OUT players cannot participate or retain independent baseline samples');
assert.ok(replayA.players.every((player) => player.simulatedFantasyPointSamples?.length === 32), JSON.stringify({ status: replayA.status, gaps: replayA.gaps, gameSimulation: replayA.gameSimulation }));
const withP2Active = { ...slate, playerPool: slate.playerPool.map((player) => player.playerId === 'p2' ? { ...player, availability: { ...player.availability, status: 'ACTIVE' as const } } : player) } as ValidatedSlate;
const activeAvailabilityRun = runNbaSimulationBatch({ slate: withP2Active, projection: baseline, availabilitySnapshot: snapshot, mode: 'game_simulation', seed: 'g4-seed', gameScenarioCount: 32, batchSize: 8, maxComputeMs: 10000, now: () => fixtureNow });
assert.notDeepEqual(activeAvailabilityRun.players.find((player) => player.playerId === 'p1')?.simulatedFantasyPointSamples, replayA.players.find((player) => player.playerId === 'p1')?.simulatedFantasyPointSamples, 'changed active availability changes connected teammate allocation');

let clockReads = 0;
const timedOut = runNbaSimulationBatch({ slate, projection: baseline, availabilitySnapshot: snapshot, mode: 'game_simulation', seed: 'g4-timeout', gameScenarioCount: 32, batchSize: 4, maxComputeMs: 2, now: () => [fixtureNow, 0, 5][clockReads++] ?? 5 });
assert.equal(timedOut.gameSimulation?.releaseStatus, 'INCOMPLETE');
assert.equal(timedOut.gameSimulation?.completedTrials, 0);
assert.deepEqual(timedOut.players[0]?.simulatedFantasyPointSamples, baseline.players[0]?.simulatedFantasyPointSamples, 'timeout uses the complete baseline distribution, not partial samples');
const missingSnapshot = runNbaSimulationBatch({ slate, projection: baseline, mode: 'game_simulation', seed: 'g4-missing', gameScenarioCount: 32, batchSize: 8, maxComputeMs: 10000 });
assert.equal(missingSnapshot.gameSimulation?.releaseStatus, 'INCOMPLETE');

const rows: NbaSimulationEvaluationRow[] = [];
for (let slateIndex = 0; slateIndex < 3; slateIndex++) for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
  const date = new Date(Date.UTC(2026, 0, slateIndex + 1));
  const actualPoints = 18 + playerIndex + slateIndex;
  rows.push({ slateId: `s${slateIndex}`, gameId: `g${slateIndex}`, teamId: 'A', playerId: `p${playerIndex}`, projectionGeneratedAt: new Date(date.getTime() - 3_600_000).toISOString(), lockTime: date.toISOString(), actualSourceVerified: true, actualFinality: 'FINAL', actualPoints, actualMinutes: 30, baselineSamples: Array.from({ length: 128 }, (_, trial) => actualPoints + 3 + trial % 3), candidateSamples: Array.from({ length: 128 }, (_, trial) => actualPoints + (trial % 3) - 1), baselineMinutesSamples: Array(128).fill(32), candidateMinutesSamples: Array(128).fill(30) });
}
const dataset: NbaSimulationEvaluationDataset = { holdoutCutoff: '2026-01-01T00:00:00.000Z', registeredAt: '2025-12-01T00:00:00.000Z', simulationVersion: 'sim.v1', projectionVersion: 'proj.v1', seed: 'seed', gameScenarioCount: 128, fieldSimulationCount: 64, rows, teamTotals: [], lineups: [] };
const evaluation = evaluateNbaSimulation(dataset, '2026-02-01T00:00:00.000Z');
assert.equal(evaluation.holdout.independentSlates, 3);
assert.equal(evaluation.baseline.rows, 12);
assert.ok(/^[0-9a-f]{64}$/.test(evaluation.datasetSha256));
assert.equal(evaluation.decision, 'HOLD', 'insufficient paired holdout evidence remains on HOLD');
assert.throws(() => evaluateNbaSimulation({ ...dataset, registeredAt: '2026-03-02T00:00:00.000Z' }, '2026-02-01T00:00:00.000Z'), /preregistered UTC holdout cutoff/);
assert.throws(() => evaluateNbaSimulation({ ...dataset, registeredAt: '2026-01-02T00:00:00.000Z' }, '2026-02-01T00:00:00.000Z'), /recorded before the holdout/);
const connectedPartition = evaluateNbaSimulation({ ...dataset, holdoutCutoff: '2026-01-02T00:00:00.000Z', rows: [
  { ...rows[0]!, slateId: 'early-slate', gameId: 'shared-game', lockTime: '2026-01-01T00:00:00.000Z', projectionGeneratedAt: '2025-12-31T23:00:00.000Z' },
  { ...rows[1]!, slateId: 'late-slate', gameId: 'shared-game', lockTime: '2026-01-02T00:00:00.000Z', projectionGeneratedAt: '2026-01-01T23:00:00.000Z' },
] }, '2026-02-01T00:00:00.000Z');
assert.equal(connectedPartition.training.playerRows, 0, 'a game shared across slate IDs stays wholly in holdout');
assert.equal(connectedPartition.holdout.playerRows, 2);
assert.equal(connectedPartition.holdout.independentGames, 1);
const shortDraws = evaluateNbaSimulation({ ...dataset, rows: [{ ...rows[0]!, baselineSamples: Array(32).fill(1), candidateSamples: Array(32).fill(1) }] }, '2026-02-01T00:00:00.000Z');
assert.equal(shortDraws.excludedRows.UNPAIRED_OR_INSUFFICIENT_MONTE_CARLO_DRAWS, 1);
const leakingRows = rows.map((row, index) => index === 0 ? { ...row, projectionGeneratedAt: row.lockTime } : row);
assert.equal(evaluateNbaSimulation({ ...dataset, rows: leakingRows }, '2026-02-01T00:00:00.000Z').excludedRows.INVALID_OR_POST_LOCK_PROJECTION, 1);
console.log('G4 NBA simulation replay, snapshot, OUT-player, budget fallback, and paired-evaluation assertions passed.');
