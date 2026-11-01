import type { AdjustmentPackage, ProjectionPackage, StreetTeamSnapshot, ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { projectSlate } from '../../../src/lib/engine/projection.js';
import { assertProjection } from '../../../src/lib/engine/validation.js';
import { evaluateDrivers, type DriverDecision } from './driverPolicy.js';

/** Recompute a shadow candidate from modified opportunity inputs; no direct FP bonuses. */
export function buildNbaCandidate(input: { slate: ValidatedSlate; snapshot: StreetTeamSnapshot; baseline: ProjectionPackage; asOf: Date; approvedPolicyVersion?: string }): { projection: ProjectionPackage; decisions: DriverDecision[] } {
  const decisions = input.slate.playerPool.flatMap((player) => evaluateDrivers({ baseline: input.baseline, evidence: input.snapshot, player, asOf: input.asOf.toISOString(), approvedPolicyVersion: input.approvedPolicyVersion }));
  const applied = decisions.filter((decision) => decision.decision === 'APPLY' && decision.driverType === 'MINUTES_RESTRICTION' && decision.dimension === 'expectedMinutes' && decision.proposedInput !== null);
  if (!applied.length) return { projection: input.baseline, decisions };
  const caps = new Map(applied.map((decision) => [decision.playerId, decision.constraintCap ?? decision.proposedInput!]));
  const candidateSlate: ValidatedSlate = { ...input.slate, playerPool: input.slate.playerPool.map((player) => {
    const cap = caps.get(player.playerId);
    if (cap === undefined) return player;
    return { ...player, projectionInputs: { ...(player.projectionInputs ?? {}), expectedMinutes: Math.min(player.projectionInputs?.expectedMinutes ?? cap, cap), minutesCap: Math.min(player.projectionInputs?.minutesCap ?? cap, cap), minutesP90: Math.min(player.projectionInputs?.minutesP90 ?? cap, cap) }, sportContext: { ...player.sportContext, nba: { ...player.sportContext?.nba, minutesP50: Math.min(player.sportContext?.nba?.minutesP50 ?? player.projectionInputs?.expectedMinutes ?? cap, cap), minutesP90: Math.min(player.sportContext?.nba?.minutesP90 ?? cap, cap) } } };
  }) };
  const emptyAdjustment: AdjustmentPackage = { slateId: candidateSlate.slateId, tenantId: candidateSlate.tenantId, sport: 'NBA', version: 1, generatedAt: input.asOf.toISOString(), adjustments: [], researchGaps: [], status: 'COMPLETE' };
  const projection = projectSlate(candidateSlate, emptyAdjustment, input.asOf);
  assertProjection(projection);
  return { projection, decisions };
}
