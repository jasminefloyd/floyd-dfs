import assert from 'node:assert/strict';
import { FDS_SCHEMA_VERSION, migrateSchemaPayload, parseCanonicalIds, parseIsoTimestamp, resolveSchemaVersion, versionPayload } from '../server/intelligence/contracts';
import { redactSensitiveErrorText } from '../server/safeApiError';
import { createProjectionSourceAssignment, completeProjectionSourceAssignment } from '../server/houses/contracts';
import { isNbaHouseShadowEnabled, readFeatureFlags } from '../server/featureFlags';
import { parseValidatedSlate, serializeContract } from '../src/lib/engine/boundaryContracts';

const flags = readFeatureFlags({});
assert.equal(flags.NBA_HOUSE_V1, false);
assert.equal(flags.NBA_HOUSE_READ_V1, false);
assert.equal(flags.NBA_HOUSE_SHADOW_V1, false);
assert.equal(flags.NBA_HOUSE_CANARY_V1, false);
assert.equal(flags.NBA_HOUSE_ACTIVE_V1, false);
assert.equal(isNbaHouseShadowEnabled({ NBA_HOUSE_V1: 'true' }), true, 'legacy House flag remains a shadow-report alias');
assert.equal(isNbaHouseShadowEnabled({ NBA_HOUSE_SHADOW_V1: 'TRUE' }), true);
assert.equal(isNbaHouseShadowEnabled({ NBA_HOUSE_ACTIVE_V1: 'true' }), false, 'active flag does not enable shadow behavior');

assert.equal(resolveSchemaVersion(undefined), FDS_SCHEMA_VERSION, 'legacy unversioned values receive the current schema on migration');
assert.equal(versionPayload({ value: 1 }).schemaVersion, FDS_SCHEMA_VERSION);
assert.equal(migrateSchemaPayload({ value: 2 }).schemaVersion, FDS_SCHEMA_VERSION);
assert.throws(() => resolveSchemaVersion('fds.schema.future'), /unsupported schema version/);
assert.throws(() => versionPayload({ schemaVersion: 'fds.schema.future' }), /unsupported schema version/);
assert.equal(parseIsoTimestamp('2026-10-30T12:00:00.000Z', 'asOf'), '2026-10-30T12:00:00.000Z');
assert.throws(() => parseIsoTimestamp(undefined, 'asOf'), /valid UTC ISO timestamp/);
assert.throws(() => parseIsoTimestamp('2026-10-30T12:00:00-04:00', 'asOf'), /valid UTC ISO timestamp/);

const canonicalIds = { sport: 'NBA', slateId: 'slate-1', contestId: 'contest-1', playerId: 'DRAFTKINGS:123', runId: 'run-1', snapshotId: 'snapshot-1', projectionVersion: '2', modelVersion: 'projection.v1', lineupId: 'lineup-1', portfolioId: 'portfolio-1', tenantId: 'tenant-1' };
assert.deepEqual(parseCanonicalIds(canonicalIds), canonicalIds);
assert.throws(() => parseCanonicalIds({ ...canonicalIds, playerId: '123' }), /provider-qualified/);
assert.throws(() => parseCanonicalIds({ ...canonicalIds, runId: '' }), /non-empty string/);

const legacySlate = { tenantId: 'tenant-1', slateId: 'slate-1', requestId: 'request-1', event: { eventId: 'event-1', eventDate: '2026-10-30T12:00:00.000Z', participants: [] }, playerPool: [] };
assert.equal(parseValidatedSlate(legacySlate, 'tenant-1').schemaVersion, FDS_SCHEMA_VERSION, 'legacy API payloads are explicitly upgraded at the boundary');
assert.throws(() => parseValidatedSlate({ ...legacySlate, schemaVersion: 'future.schema.v99' }, 'tenant-1'), /unsupported version/);
assert.throws(() => serializeContract({ schemaVersion: 'future.schema.v99' }), /unsupported version/);

const legacy = createProjectionSourceAssignment({ sport: 'NBA', runId: 'run-1', assignedAt: '2026-10-30T12:00:00.000Z' });
assert.equal(legacy.selectedSource, 'LEGACY');
assert.equal(legacy.requestedSource, 'LEGACY');
const requestedCanary = createProjectionSourceAssignment({ sport: 'NBA', runId: 'run-2', requestedSource: 'NBA_HOUSE_CANARY', assignedAt: '2026-10-30T12:00:00.000Z' });
assert.equal(requestedCanary.selectedSource, 'LEGACY', 'unimplemented candidate routing remains fail-closed');
assert.equal(requestedCanary.reason, 'CANDIDATE_ADAPTER_UNAVAILABLE');
const exact = completeProjectionSourceAssignment(legacy, 'projection.deterministic.v3', 'game-simulation.v1');
assert.equal(exact.modelVersion, 'projection.deterministic.v3');
assert.equal(exact.simulationVersion, 'game-simulation.v1');
assert.equal(legacy.modelVersion, null, 'model assignment returns a new value and does not mutate the frozen source record');
const nonNba = createProjectionSourceAssignment({ sport: 'NFL', runId: 'run-3', requestedSource: 'NBA_HOUSE_ACTIVE', assignedAt: '2026-10-30T12:00:00.000Z' });
assert.equal(nonNba.selectedSource, 'LEGACY');
assert.equal(nonNba.reason, 'NON_NBA_LEGACY');
assert.throws(() => createProjectionSourceAssignment({ sport: 'NBA', runId: 'run-4', requestedSource: 'INVALID', assignedAt: '2026-10-30T12:00:00.000Z' }), /Unsupported NBA projection source/);

const redactedMessage = redactSensitiveErrorText('provider rejected Authorization: Bearer eyJhbGciOi-secret api_key=abc123 password: hunter2 safe context');
assert.match(redactedMessage, /Bearer \[REDACTED\]/);
assert.match(redactedMessage, /api_key=\[REDACTED\]/);
assert.match(redactedMessage, /password: \[REDACTED\]/);
assert.match(redactedMessage, /safe context/);

console.log('G0 schema, ID, feature-flag, and legacy source-safety checks passed.');
