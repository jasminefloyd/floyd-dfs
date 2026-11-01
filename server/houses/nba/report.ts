import type { NbaHouseDriverAttribution, ProjectionPackage } from '../../../src/lib/engine/contracts.js';
import type { DriverDecision } from './driverPolicy.js';

export function buildDriverAttributions(input: { decisions: DriverDecision[]; baseline: ProjectionPackage; candidate: ProjectionPackage; modelVersion: string }): NbaHouseDriverAttribution[] {
  const candidatePlayers = new Map(input.candidate.players.map((player) => [player.playerId, player]));
  const baselinePlayers = new Map(input.baseline.players.map((player) => [player.playerId, player]));
  return input.decisions.filter((decision) => decision.decision === 'APPLY' && decision.dimension).flatMap((decision) => {
    const before = baselinePlayers.get(decision.playerId)?.adjustedOpportunity[decision.dimension!];
    const after = candidatePlayers.get(decision.playerId)?.adjustedOpportunity[decision.dimension!];
    if (!Number.isFinite(before) || !Number.isFinite(after)) return [];
    return [{ playerId: decision.playerId, dimension: decision.dimension!, baselineValue: before!, adjustedValue: after!, evidenceIds: decision.evidenceIds, confidence: decision.confidence, modelVersion: input.modelVersion }];
  });
}

export function splitDriverDecisions(decisions: DriverDecision[]) {
  return {
    appliedDrivers: decisions.filter((decision) => decision.decision === 'APPLY'),
    reportOnlyContext: decisions.filter((decision) => decision.decision === 'REPORT_ONLY' && decision.driverType !== 'NO_ADJUSTMENT'),
    rejectedOrConflictingEvidence: decisions.filter((decision) => decision.decision === 'ABSTAIN'),
    noAdjustment: decisions.filter((decision) => decision.driverType === 'NO_ADJUSTMENT'),
  };
}
