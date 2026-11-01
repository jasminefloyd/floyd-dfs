import assert from 'node:assert/strict';
import { assertRunLineageConsistency, buildProjectionArtifactRows, buildRunLineageRecord, sha256Json } from '../server/runLineage.js';
import { replayPlayerTeamAsOf, selectEvidenceAsOf } from '../server/streetTeam/asOfRepository.js';
import type { ProjectionPackage } from '../src/lib/engine/contracts.js';

const announcement = { id: 'injury-1', effective_at: '2026-10-30T18:05:00Z', ingested_at: '2026-10-30T18:30:00Z', subject_id: 'player-1' };
assert.equal(selectEvidenceAsOf([announcement], '2026-10-30T18:00:00Z', '2026-10-30T18:30:00Z').length, 0, 'an injury after event cutoff is excluded');
assert.equal(selectEvidenceAsOf([announcement], '2026-10-30T18:05:00Z', '2026-10-30T18:30:00Z').length, 1, 'the announcement appears at its effective time when known');
assert.equal(selectEvidenceAsOf([announcement], '2026-10-30T18:05:00Z', '2026-10-30T18:04:00Z').length, 0, 'an announcement not yet ingested is excluded');
assert.equal(selectEvidenceAsOf([announcement], '2026-10-30T18:05:00Z', '2026-10-30T17:55:00Z').length, 0, 'event and knowledge cutoffs remain independent');

const lineageInput = { tenantId: 'tenant', generationRunId: 'run', revision: 1, sport: 'NBA' as const, slateId: 'slate', contestId: 'contest', eventCutoff: '2026-10-30T18:05:00Z', knowledgeCutoff: '2026-10-30T17:55:00Z', baselineModelVersion: 'baseline.v1', houseModelVersion: null, simulationVersion: 'simulation.v1', optimizerVersion: 'optimizer.v1', fieldModelVersion: null, randomSeed: 'seed-7', sourceManifestHash: sha256Json([{ source: 'fixture' }]), driverPolicyVersion: null, contestTermsHash: sha256Json({ salaryCap: 50_000 }), inputs: { slate: { b: 2, a: 1 }, providers: ['x'] } };
assert.deepEqual(buildRunLineageRecord(lineageInput), buildRunLineageRecord(lineageInput), 'identical inputs and versions produce identical lineage checksums');
assert.notEqual(buildRunLineageRecord(lineageInput).content_sha256, buildRunLineageRecord({ ...lineageInput, randomSeed: 'seed-8' }).content_sha256, 'a changed seed changes lineage checksum');
assert.notEqual(buildRunLineageRecord(lineageInput).content_sha256, buildRunLineageRecord({ ...lineageInput, inputs: { ...lineageInput.inputs, slate: { a: 3 } } }).content_sha256, 'a changed input changes lineage checksum');

const projection = { sport: 'NBA', tenantId: 'tenant', slateId: 'slate', modelVersion: 'projection.v1', players: [], generatedAt: '2026-10-30T17:55:00Z' } as unknown as ProjectionPackage;
const artifactRows = buildProjectionArtifactRows({ tenantId: 'tenant', generationRunId: 'run', lineageRevision: 1, sport: 'NBA', slateId: 'slate', baselineModelVersion: 'baseline.v1', adjustedModelVersion: 'adjusted.v1', baselineProjection: projection, adjustedProjection: projection, adjustment: { adjustments: [{ playerId: 'p1', adjustments: [{ adjustmentType: 'ROLE', magnitude: 0.1, confidence: 'LOW' }] }] } as never, extraEvidenceIds: ['evidence-2', 'evidence-1'] });
assert.equal(artifactRows[0].artifact_type, 'BASELINE');
assert.equal(artifactRows[0].adjustment_reason, null);
assert.equal(artifactRows[1].adjustment_reason instanceof Array, true);
assert.equal((artifactRows[1].adjustment_reason as Array<{ reason: unknown }>)[0].reason, null, 'missing rationale remains explicitly null');
assert.deepEqual(artifactRows[1].evidence_ids, ['evidence-1', 'evidence-2']);
assertRunLineageConsistency(buildRunLineageRecord(lineageInput), artifactRows);
assert.throws(() => assertRunLineageConsistency(buildRunLineageRecord(lineageInput), [{ ...artifactRows[0], tenant_id: 'tenant-other' }]), /does not match/);

const transaction = { id: 'trade', subject: { kind: 'PLAYER', id: 'p1' }, factType: 'transaction.record', value: { fromTeamId: 'BOS', toTeamId: 'NY' }, effectiveAt: '2026-10-30T18:05:00Z', resolvedAt: '2026-10-30T18:30:00Z', state: 'ACCEPTED' } as never;
const history = [
  { asOf: '2026-10-30T17:00:00Z', rosterState: [{ playerId: 'p1', teamId: 'BOS' }], resolvedFacts: [] },
  { asOf: '2026-10-30T18:30:00Z', rosterState: [{ playerId: 'p1', teamId: 'NY' }], resolvedFacts: [transaction] },
];
assert.equal(replayPlayerTeamAsOf(history, 'p1', '2026-10-30T18:10:00Z', '2026-10-30T18:00:00Z'), 'BOS', 'later-ingested transaction is not visible at earlier knowledge cutoff');
assert.equal(replayPlayerTeamAsOf(history, 'p1', '2026-10-30T18:10:00Z', '2026-10-30T18:30:00Z'), 'NY', 'effective transaction is replayed after event time and knowledge permit it');
console.log('G2 independent-cutoff replay, deterministic lineage, and projection artifact assertions passed.');
