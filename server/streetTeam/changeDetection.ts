import { createHash } from 'node:crypto';
import type { NbaStreetTeamObservationInput } from '../nbaStreetTeamProvider.js';

/** Hash only state-bearing evidence. Poll timestamps and generated observation IDs do not count as changes. */
export function meaningfulEvidenceHash(observations: NbaStreetTeamObservationInput[]): string {
  const state = observations.map((item) => ({
    provider: item.provider, sourceRecordId: item.sourceRecordId ?? null, sourceUrl: item.sourceUrl,
    subjectKind: item.subjectKind, subjectId: item.subjectId, claim: item.claim,
    classification: item.classification, confidence: item.confidence,
    publishedAt: item.publishedAt ?? null, effectiveAt: item.effectiveAt ?? null, payload: item.payload,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
