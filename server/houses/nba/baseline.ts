import type { ProjectionPackage, StreetTeamSnapshot, ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { projectSlate } from '../../../src/lib/engine/projection.js';
import { assertProjection } from '../../../src/lib/engine/validation.js';

export const NBA_HOUSE_BASELINE_VERSION = 'nba-house.baseline.deterministic.v1';

/** Reuses the established projection math with an empty adjustment package. */
export function buildNbaBaseline(input: { slate: ValidatedSlate; snapshot: StreetTeamSnapshot; asOf: Date; modelVersion?: string }): ProjectionPackage {
  if (input.slate.sport !== 'NBA' || input.snapshot.sport !== 'NBA' || input.snapshot.tenantId !== input.slate.tenantId) throw new Error('NBA baseline requires a tenant-matched NBA slate and snapshot.');
  if (!Number.isFinite(input.asOf.getTime()) || input.asOf.getTime() < Date.parse(input.snapshot.asOf)) throw new Error('NBA baseline asOf must be valid and cannot precede its evidence snapshot.');
  const projection = projectSlate(input.slate, { slateId: input.slate.slateId, tenantId: input.slate.tenantId, sport: 'NBA', version: 1, generatedAt: input.asOf.toISOString(), adjustments: [], researchGaps: [], status: 'COMPLETE' }, input.asOf);
  const versioned = { ...projection, modelVersion: input.modelVersion ?? NBA_HOUSE_BASELINE_VERSION, players: projection.players.map((player) => ({ ...player, modelVersion: input.modelVersion ?? NBA_HOUSE_BASELINE_VERSION })) };
  assertProjection(versioned);
  return versioned;
}
