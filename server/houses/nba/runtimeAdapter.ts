import { createHash } from 'node:crypto';
import type { ProjectionPackage } from '../../../src/lib/engine/contracts.js';

export type NbaHouseMode = 'LEGACY' | 'SHADOW' | 'CANARY' | 'ACTIVE';
export interface NbaHouseRolloutAssignment { requestedMode: NbaHouseMode; assignedMode: NbaHouseMode; runId: string; cohortHash: string; candidateSelected: boolean; effectiveProjection: 'LEGACY' | 'HOUSE'; reason: string; }

/** Pure runtime gate. A caller supplies only registry- and evaluation-approved candidates. */
export function selectNbaHouseProjection(input: { runId: string; legacy: ProjectionPackage; candidate?: ProjectionPackage | null; requestedMode: NbaHouseMode; killSwitch: boolean; approved: boolean; snapshotFresh: boolean; canaryPercent?: number }): { projection: ProjectionPackage; assignment: NbaHouseRolloutAssignment } {
  const cohortHash = createHash('sha256').update(input.runId).digest('hex');
  const fallback = (assignedMode: NbaHouseMode, reason: string) => ({ projection: input.legacy, assignment: { requestedMode: input.requestedMode, assignedMode, runId: input.runId, cohortHash, candidateSelected: false, effectiveProjection: 'LEGACY' as const, reason } });
  if (input.killSwitch) return fallback('LEGACY', 'NBA House kill switch routes new runs to legacy.');
  if (input.requestedMode === 'LEGACY') return fallback('LEGACY', 'Legacy mode is selected.');
  if (!input.candidate) return fallback('LEGACY', 'House candidate output is unavailable; legacy projection retained.');
  if (!input.snapshotFresh) return fallback('LEGACY', 'Street Team snapshot is stale; legacy projection retained.');
  if (!input.approved) return input.requestedMode === 'SHADOW' ? { projection: input.legacy, assignment: { requestedMode: input.requestedMode, assignedMode: 'SHADOW', runId: input.runId, cohortHash, candidateSelected: false, effectiveProjection: 'LEGACY', reason: 'House candidate is shadow-only; evaluation or authorized model approval is incomplete.' } } : fallback('LEGACY', 'Unapproved House version cannot enter canary or active routing.');
  if (input.requestedMode === 'SHADOW') return { projection: input.legacy, assignment: { requestedMode: 'SHADOW', assignedMode: 'SHADOW', runId: input.runId, cohortHash, candidateSelected: false, effectiveProjection: 'LEGACY', reason: 'Shadow mode retains legacy optimizer inputs.' } };
  if (input.requestedMode === 'CANARY') {
    if (!Number.isFinite(input.canaryPercent) || input.canaryPercent! <= 0 || input.canaryPercent! > 100) return fallback('LEGACY', 'Canary percentage is missing or outside the reviewed 1–100 range.');
    const bucket = Number.parseInt(cohortHash.slice(0, 8), 16) / 0xffffffff * 100;
    if (bucket >= input.canaryPercent!) return { projection: input.legacy, assignment: { requestedMode: 'CANARY', assignedMode: 'CANARY', runId: input.runId, cohortHash, candidateSelected: false, effectiveProjection: 'LEGACY', reason: `Run is outside the deterministic ${input.canaryPercent}% canary cohort.` } };
  }
  return { projection: input.candidate, assignment: { requestedMode: input.requestedMode, assignedMode: input.requestedMode, runId: input.runId, cohortHash, candidateSelected: true, effectiveProjection: 'HOUSE', reason: 'Reviewed House candidate selected for this NBA run.' } };
}

/** Preserve a generation run's saved cohort/model assignment during retry. */
export function restoreNbaHouseAssignment(input: { legacy: ProjectionPackage; candidate?: ProjectionPackage | null; frozen: Record<string, unknown>; approved: boolean; snapshotFresh: boolean }): { projection: ProjectionPackage; assignment: NbaHouseRolloutAssignment } {
  const assignment = input.frozen as unknown as NbaHouseRolloutAssignment;
  if (assignment.candidateSelected && assignment.effectiveProjection === 'HOUSE') {
    if (input.approved && input.snapshotFresh && input.candidate) return { projection: input.candidate, assignment };
    return { projection: input.legacy, assignment: { ...assignment, assignedMode: 'LEGACY', candidateSelected: false, effectiveProjection: 'LEGACY', reason: 'The pinned House candidate is no longer available, fresh, or approved; legacy projection retained for this retry.' } };
  }
  return { projection: input.legacy, assignment };
}
