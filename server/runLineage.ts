import { createHash } from 'node:crypto';
import type { AdjustmentPackage, ProjectionPackage, Sport } from '../src/lib/engine/contracts.js';

export interface RunLineageInput {
  tenantId: string;
  generationRunId: string;
  revision: number;
  sport: Sport;
  intelSnapshotId?: string | null;
  snapshotHash?: string | null;
  slateId: string;
  contestId: string;
  eventCutoff: string;
  knowledgeCutoff: string;
  baselineModelVersion: string;
  houseModelVersion?: string | null;
  simulationVersion?: string | null;
  optimizerVersion: string;
  fieldModelVersion?: string | null;
  randomSeed?: string | null;
  sourceManifestHash: string;
  driverPolicyVersion?: string | null;
  contestTermsHash: string;
  inputs: Record<string, unknown>;
}

export function buildRunLineageRecord(input: RunLineageInput): Record<string, unknown> {
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error('Lineage revision must be a positive integer.');
  requireUtcTimestamp(input.eventCutoff, 'eventCutoff');
  requireUtcTimestamp(input.knowledgeCutoff, 'knowledgeCutoff');
  const inputChecksums = Object.fromEntries(Object.entries(input.inputs).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, sha256Json(value)]));
  const record = {
    tenant_id: input.tenantId,
    generation_run_id: input.generationRunId,
    revision: input.revision,
    sport: input.sport,
    intel_snapshot_id: input.intelSnapshotId ?? null,
    snapshot_hash: input.snapshotHash ?? null,
    slate_id: input.slateId,
    contest_id: input.contestId,
    event_cutoff: input.eventCutoff,
    decision_cutoff: input.eventCutoff,
    knowledge_cutoff: input.knowledgeCutoff,
    baseline_model_version: input.baselineModelVersion,
    house_model_version: input.houseModelVersion ?? null,
    simulation_version: input.simulationVersion ?? null,
    optimizer_version: input.optimizerVersion,
    field_model_version: input.fieldModelVersion ?? null,
    random_seed: input.randomSeed ?? null,
    source_manifest_hash: hashToken(input.sourceManifestHash, 'sourceManifestHash'),
    driver_policy_version: input.driverPolicyVersion ?? null,
    contest_terms_hash: hashToken(input.contestTermsHash, 'contestTermsHash'),
    input_checksums: inputChecksums,
  };
  return { ...record, content_sha256: sha256Json(record) };
}

export function buildProjectionArtifactRows(input: {
  tenantId: string;
  generationRunId: string;
  lineageRevision: number;
  sport: Sport;
  slateId: string;
  baselineModelVersion: string;
  adjustedModelVersion: string;
  baselineProjection: ProjectionPackage;
  adjustedProjection: ProjectionPackage;
  adjustment: AdjustmentPackage;
  extraEvidenceIds?: string[];
}): Array<Record<string, unknown>> {
  for (const [label, projection] of [['baseline', input.baselineProjection], ['adjusted', input.adjustedProjection]] as const) {
    if (projection.tenantId !== input.tenantId || projection.slateId !== input.slateId || projection.sport !== input.sport) throw new Error(`${label} projection lineage does not match its tenant, slate, and sport.`);
  }
  const adjustmentReason = input.adjustment.adjustments.flatMap((player) => player.adjustments.map((item) => ({
    playerId: player.playerId,
    adjustmentType: item.adjustmentType ?? null,
    reason: item.rationale ?? null,
    evidenceFindingIds: item.evidenceFindingIds ?? [],
  })));
  const evidenceIds = [...new Set([
    ...(input.extraEvidenceIds ?? []),
    ...adjustmentReason.flatMap((item) => item.evidenceFindingIds),
    ...(input.adjustedProjection.evidenceInputBoundary?.acceptedEvidenceFactIds ?? []),
    ...(input.adjustedProjection.effectOutcomes ?? []).flatMap((item) => item.evidenceFindingIds),
  ])].sort();
  const artifacts = [
    { artifactType: 'BASELINE', modelVersion: input.baselineModelVersion, projection: input.baselineProjection, reason: null, evidence: [] as string[] },
    { artifactType: 'ADJUSTED', modelVersion: input.adjustedModelVersion, projection: input.adjustedProjection, reason: adjustmentReason.length ? adjustmentReason : null, evidence: evidenceIds },
  ];
  return artifacts.map((artifact) => {
    const content = {
      tenantId: input.tenantId,
      generationRunId: input.generationRunId,
      lineageRevision: input.lineageRevision,
      artifactType: artifact.artifactType,
      modelVersion: artifact.modelVersion,
      projection: artifact.projection,
      adjustmentReason: artifact.reason,
      evidenceIds: artifact.evidence,
    };
    return {
      tenant_id: input.tenantId,
      generation_run_id: input.generationRunId,
      lineage_revision: input.lineageRevision,
      artifact_type: artifact.artifactType,
      sport: input.sport,
      slate_id: input.slateId,
      model_version: artifact.modelVersion,
      projection_payload: artifact.projection,
      adjustment_reason: artifact.reason,
      evidence_ids: artifact.evidence,
      content_sha256: sha256Json(content),
    };
  });
}

/** Fail before persistence if a projection artifact drifts from its pinned run manifest. */
export function assertRunLineageConsistency(lineage: Record<string, unknown>, artifacts: Array<Record<string, unknown>>): void {
  const revision = lineage.revision;
  const identity = { tenant_id: lineage.tenant_id, generation_run_id: lineage.generation_run_id, slate_id: lineage.slate_id, sport: lineage.sport };
  if (!identity.tenant_id || !identity.generation_run_id || !identity.slate_id || !identity.sport || !Number.isInteger(revision)) throw new Error('Run lineage is missing a required identity or revision.');
  if (!lineage.content_sha256 || !lineage.source_manifest_hash || !lineage.contest_terms_hash) throw new Error('Run lineage is missing a required content or contest checksum.');
  if (!artifacts.length || artifacts.some((artifact) => artifact.tenant_id !== identity.tenant_id || artifact.generation_run_id !== identity.generation_run_id || artifact.slate_id !== identity.slate_id || artifact.sport !== identity.sport || artifact.lineage_revision !== revision)) throw new Error('Projection artifact lineage does not match its pinned run manifest.');
}

export function sha256Json(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }

function requireUtcTimestamp(value: string, label: string): void {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !/(?:Z|\+00:00)$/i.test(value)) throw new Error(`${label} must be a UTC ISO timestamp.`);
}

function hashToken(value: string, label: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`); return value; }

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}
