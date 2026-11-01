/** Shared schema and identity contracts for persisted and transported intelligence. */
import { FDS_ERROR_CODES as ENGINE_FDS_ERROR_CODES, FDS_SCHEMA_VERSION as ENGINE_FDS_SCHEMA_VERSION, type FdsErrorCode, type ProviderQualifiedPlayerId, type Sport } from '../../src/lib/engine/contracts.js';

export const FDS_SCHEMA_VERSION = ENGINE_FDS_SCHEMA_VERSION;
export const SUPPORTED_FDS_SCHEMA_VERSIONS = [FDS_SCHEMA_VERSION] as const;

export type FdsSchemaVersion = (typeof SUPPORTED_FDS_SCHEMA_VERSIONS)[number];
export type IsoTimestamp = string & { readonly __isoTimestamp: unique symbol };
export type { ProviderQualifiedPlayerId } from '../../src/lib/engine/contracts.js';

export interface SchemaVersionedContract {
  schemaVersion: FdsSchemaVersion;
}

/** IDs used to join canonical records across the run, projection, lineup and learning path. */
export interface CanonicalIds {
  sport: Sport;
  slateId: string;
  contestId: string;
  playerId: ProviderQualifiedPlayerId;
  runId: string;
  snapshotId: string;
  projectionVersion: string;
  modelVersion: string;
  lineupId: string;
  portfolioId: string;
  tenantId: string;
}

/** `observedAt` describes the source claim; `effectiveAt` when it applies;
 * `collectedAt` when fetched; `availableAt` when the app could use it;
 * `asOf` is the query's knowledge cutoff; `lockAt` is the contest cutoff. */
export interface PointInTimeTimestamps {
  observedAt: IsoTimestamp;
  effectiveAt: IsoTimestamp;
  collectedAt: IsoTimestamp;
  availableAt: IsoTimestamp;
  asOf: IsoTimestamp;
  lockAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}

export const FDS_ERROR_CODES = ENGINE_FDS_ERROR_CODES;

export class FdsContractError extends Error {
  readonly code: FdsErrorCode;
  readonly path: string;
  constructor(code: FdsErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'FdsContractError';
    this.code = code;
    this.path = path;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Legacy payloads may be upgraded only when they have no schema marker. Unknown versions fail closed. */
export function resolveSchemaVersion(value: unknown, path = 'schemaVersion'): FdsSchemaVersion {
  if (value === undefined || value === null) return FDS_SCHEMA_VERSION;
  if (typeof value === 'string' && (SUPPORTED_FDS_SCHEMA_VERSIONS as readonly string[]).includes(value)) return value as FdsSchemaVersion;
  throw new FdsContractError('VALIDATION_FAILED', path, `unsupported schema version ${String(value)}`);
}

/** Attach the current schema marker at persistence/transport boundaries. */
export function versionPayload<T extends object>(value: T): T & SchemaVersionedContract {
  resolveSchemaVersion((value as T & { schemaVersion?: unknown }).schemaVersion);
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as T & SchemaVersionedContract;
}

/** Explicit migration entry point: legacy payloads without a marker are validated by
 * their boundary parser, then upgraded to v1; unknown marked versions are rejected. */
export function migrateSchemaPayload<T extends object>(value: T): T & SchemaVersionedContract {
  const schemaVersion = (value as T & { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === undefined || schemaVersion === null) return versionPayload(value);
  resolveSchemaVersion(schemaVersion);
  return versionPayload(value);
}

/** Validate the canonical cross-stage identity tuple without coercing numeric or absent IDs. */
export function parseCanonicalIds(value: unknown): CanonicalIds {
  if (!isRecord(value)) throw new FdsContractError('VALIDATION_FAILED', '$', 'expected an identity object');
  const keys = ['sport', 'slateId', 'contestId', 'playerId', 'runId', 'snapshotId', 'projectionVersion', 'modelVersion', 'lineupId', 'portfolioId', 'tenantId'] as const;
  for (const key of keys) if (typeof value[key] !== 'string' || !(value[key] as string).trim()) throw new FdsContractError('VALIDATION_FAILED', key, 'must be a non-empty string');
  if (!['NBA', 'WNBA', 'MLB', 'GOLF', 'NFL', 'CFB'].includes(value.sport as string)) throw new FdsContractError('VALIDATION_FAILED', 'sport', 'must be a supported FDS sport');
  if (!/^[A-Za-z][A-Za-z0-9_-]*:[^:\s][^\s]*$/.test(value.playerId as string)) throw new FdsContractError('ENTITY_UNRESOLVED', 'playerId', 'must be provider-qualified as PROVIDER:id');
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as CanonicalIds;
}

export function parseIsoTimestamp(value: unknown, path: string): IsoTimestamp {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|\+00:00)$/i.test(value)) {
    throw new FdsContractError('VALIDATION_FAILED', path, 'must be a valid UTC ISO timestamp');
  }
  return value as IsoTimestamp;
}
