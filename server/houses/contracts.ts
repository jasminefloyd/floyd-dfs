import { FDS_SCHEMA_VERSION, type SchemaVersionedContract } from '../intelligence/contracts.js';
import type { Sport } from '../../src/lib/engine/contracts.js';

export type ProjectionSource = 'LEGACY' | 'NBA_HOUSE_CANARY' | 'NBA_HOUSE_ACTIVE';
export interface ProjectionSourceAssignment extends SchemaVersionedContract {
  sport: Sport;
  runId: string;
  requestedSource: ProjectionSource;
  selectedSource: 'LEGACY';
  modelVersion: string | null;
  simulationVersion: string | null;
  assignedAt: string;
  reason?: 'DEFAULT_LEGACY' | 'NON_NBA_LEGACY' | 'CANDIDATE_ADAPTER_UNAVAILABLE' | 'LEGACY_RETRY';
}

const validSources = new Set<ProjectionSource>(['LEGACY', 'NBA_HOUSE_CANARY', 'NBA_HOUSE_ACTIVE']);

/** G0 exposes the rollout contract while deliberately keeping the implemented source on legacy. */
export function createProjectionSourceAssignment(input: {
  sport: Sport;
  runId: string;
  requestedSource?: string;
  assignedAt: string;
}): ProjectionSourceAssignment {
  if (!input.runId.trim()) throw new Error('Projection source assignment requires a run ID.');
  if (!Number.isFinite(Date.parse(input.assignedAt))) throw new Error('Projection source assignment requires a valid assignedAt timestamp.');
  const source = input.requestedSource?.trim().toUpperCase() || 'LEGACY';
  if (!validSources.has(source as ProjectionSource)) throw new Error(`Unsupported NBA projection source: ${source}.`);
  const requestedSource = source as ProjectionSource;
  const isNba = input.sport === 'NBA';
  const reason = !isNba ? 'NON_NBA_LEGACY' : requestedSource === 'LEGACY' ? 'DEFAULT_LEGACY' : 'CANDIDATE_ADAPTER_UNAVAILABLE';
  return {
    schemaVersion: FDS_SCHEMA_VERSION,
    sport: input.sport,
    runId: input.runId,
    requestedSource,
    selectedSource: 'LEGACY',
    modelVersion: null,
    simulationVersion: null,
    assignedAt: input.assignedAt,
    reason,
  };
}

/** Freeze the exact model versions on the original run assignment; retries reuse this value. */
export function completeProjectionSourceAssignment(assignment: ProjectionSourceAssignment, modelVersion: string, simulationVersion?: string): ProjectionSourceAssignment {
  if (!modelVersion.trim()) throw new Error('Projection source assignment requires a model version.');
  return { ...assignment, modelVersion, simulationVersion: simulationVersion ?? null };
}
