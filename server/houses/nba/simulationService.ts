import { createHash } from 'node:crypto';
import type { ProjectionPackage, StreetTeamSnapshot, ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { applyGameSimulation, GAME_SIMULATION_MODEL_VERSION, type GameSimulationOptions, type SimulationMode } from '../../../src/lib/engine/gameSimulation.js';
import { assertProjection } from '../../../src/lib/engine/validation.js';
import { streetTeamSnapshotFreshness } from '../../streetTeam.js';

export interface NbaSimulationBatchInput {
  slate: ValidatedSlate;
  projection: ProjectionPackage;
  availabilitySnapshot?: StreetTeamSnapshot | null;
  mode: SimulationMode;
  seed: string;
  gameScenarioCount: number;
  batchSize: number;
  maxComputeMs: number;
  now?: () => number;
}

/** Runs one NBA scenario batch against one exact, versioned projection and as-of snapshot. */
export function runNbaSimulationBatch(input: NbaSimulationBatchInput): ProjectionPackage {
  const snapshot = input.availabilitySnapshot;
  const checksum = sha256(stableJson(input.projection));
  const invalid = inputProblem(input);
  if (invalid) return incomplete(input.projection, input, checksum, invalid);

  const effectiveSlate = applySnapshotOutStatuses(input.slate, snapshot!);
  let result: ProjectionPackage;
  try {
    result = applyGameSimulation(effectiveSlate, input.projection, input.mode, input.seed, {
      trials: input.gameScenarioCount, batchSize: input.batchSize, maxComputeMs: input.maxComputeMs,
      ...(input.now ? { now: input.now } : {}),
    } satisfies GameSimulationOptions);
    assertProjection(result);
  } catch (error) {
    return incomplete(input.projection, input, checksum, error instanceof Error ? error.message : 'NBA simulation failed validation.');
  }
  const simulation = result.gameSimulation;
  if (!simulation || simulation.completedTrials !== input.gameScenarioCount || simulation.releaseStatus === 'INCOMPLETE' || (simulation.diagnostics?.invariantViolations ?? 1) > 0) {
    return incomplete(input.projection, input, checksum, 'The candidate batch did not complete every configured trial or failed a simulation invariant.');
  }
  return {
    ...result,
    gameSimulation: {
      ...simulation,
      availabilitySnapshotId: snapshot!.snapshotId,
      availabilitySnapshotAsOf: snapshot!.asOf,
      projectionInputSha256: checksum,
    },
  };
}

function inputProblem(input: NbaSimulationBatchInput): string | undefined {
  const { slate, projection, availabilitySnapshot: snapshot } = input;
  if (slate.sport !== 'NBA' || projection.sport !== 'NBA') return 'NBA simulation requires an NBA slate and projection package.';
  if (projection.slateId !== slate.slateId || projection.tenantId !== slate.tenantId) return 'Projection package slate or tenant does not match the simulation slate.';
  if (!input.seed.trim()) return 'NBA simulation requires an explicit seed.';
  if (![input.gameScenarioCount, input.batchSize, input.maxComputeMs].every(Number.isInteger) || input.gameScenarioCount < 1 || input.gameScenarioCount > 4096 || input.batchSize < 1 || input.batchSize > 256 || input.maxComputeMs < 1 || input.maxComputeMs > 60_000) return 'NBA simulation settings exceed their supported bounds.';
  if (!snapshot) return 'No immutable NBA availability snapshot was supplied; baseline distribution retained.';
  if (snapshot.sport !== 'NBA' || snapshot.tenantId !== slate.tenantId || !snapshot.snapshotId) return 'Availability snapshot sport, tenant, or identity does not match the run.';
  const snapshotTime = Date.parse(snapshot.asOf); const generated = Date.parse(projection.generatedAt); const lock = Date.parse(slate.contest.lockTime);
  if (![snapshotTime, generated, lock].every(Number.isFinite) || snapshotTime > generated || generated >= lock) return 'Availability snapshot and projection must be valid as-of inputs generated before contest lock.';
  const freshness = streetTeamSnapshotFreshness(snapshot, new Date((input.now ?? Date.now)()));
  if (freshness === 'STALE') return 'Availability snapshot is stale; baseline distribution retained.';
  const poolIds = new Set(slate.playerPool.map((player) => player.playerId));
  const projectionIds = new Set(projection.players.map((player) => player.playerId));
  if (poolIds.size !== slate.playerPool.length || projectionIds.size !== projection.players.length || poolIds.size !== projectionIds.size || [...poolIds].some((id) => !projectionIds.has(id))) return 'Projection package and slate player pools are not an exact one-to-one match.';
  return undefined;
}

function applySnapshotOutStatuses(slate: ValidatedSlate, snapshot: StreetTeamSnapshot): ValidatedSlate {
  const outSubjects = new Set<string>();
  for (const item of snapshot.availability) if (status(item.status) === 'OUT') outSubjects.add(item.playerId);
  for (const fact of snapshot.resolvedFacts) {
    if (fact.state === 'ACCEPTED' && fact.factType === 'availability.injury_status' && status(valueStatus(fact.value)) === 'OUT') outSubjects.add(fact.subject.id);
  }
  const outPlayerIds = new Set<string>();
  for (const player of slate.playerPool) {
    const aliases = [player.playerId, player.identity?.sportsDataIoId ? `nba:player:sportsdataio:${player.identity.sportsDataIoId}` : undefined].filter((value): value is string => Boolean(value));
    if (aliases.some((alias) => outSubjects.has(alias))) outPlayerIds.add(player.playerId);
  }
  return { ...slate, playerPool: slate.playerPool.map((player) => outPlayerIds.has(player.playerId) && player.availability?.status !== 'OUT'
    ? { ...player, availability: { status: 'OUT', confirmed: true, source: 'STREET_TEAM_SNAPSHOT', retrievedAt: snapshot.asOf, note: `Resolved OUT state from availability snapshot ${snapshot.snapshotId}.` } }
    : player) };
}

function incomplete(projection: ProjectionPackage, input: NbaSimulationBatchInput, checksum: string, reason: string): ProjectionPackage {
  const settingsValid = Number.isInteger(input.gameScenarioCount) && input.gameScenarioCount > 0 && input.gameScenarioCount <= 4096
    && Number.isInteger(input.batchSize) && input.batchSize > 0 && input.batchSize <= 256
    && Number.isInteger(input.maxComputeMs) && input.maxComputeMs > 0 && input.maxComputeMs <= 60_000;
  const trials = settingsValid ? input.gameScenarioCount : 0;
  return {
    ...projection,
    status: 'PARTIAL',
    gaps: [...projection.gaps, { reason: `NBA game simulation is incomplete; no partial quantiles were used. ${reason}` }],
    gameSimulation: {
      mode: input.mode === 'compare' ? 'COMPARE' : 'GAME_SIMULATION', modelVersion: GAME_SIMULATION_MODEL_VERSION,
      seed: input.seed || 'MISSING_SEED', trials: projection.simulationRuns, gameScenarioCount: trials, batchSize: settingsValid ? input.batchSize : 0,
      maxComputeMs: settingsValid ? input.maxComputeMs : 0, completedTrials: 0,
      availabilitySnapshotId: input.availabilitySnapshot?.snapshotId,
      availabilitySnapshotAsOf: input.availabilitySnapshot?.asOf,
      projectionInputSha256: checksum,
      computeDurationMs: 0, dependence: 'CONNECTED_GAME_EVENTS', releaseStatus: 'INCOMPLETE', gameScenarios: [],
      diagnostics: { mappedGames: 0, incompleteGames: 0, simulatedPlayers: 0, baselineFallbackPlayers: projection.players.length, excludedInactivePlayers: 0, invariantViolations: 0, overtimeTrials: 0, overtimeInputs: 'NOT_APPLICABLE', scoreMarginDistributions: [], covarianceChecks: [] },
    },
  };
}

function status(value: unknown): string { return String(value ?? '').trim().toUpperCase().replaceAll(' ', '_'); }
function valueStatus(value: unknown): unknown { return value && typeof value === 'object' ? (value as Record<string, unknown>).normalizedStatus ?? (value as Record<string, unknown>).status : value; }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
