import type { ResolvedFact, SourceObservation } from './contracts.js';

export const FACT_RESOLUTION_RULE_VERSION = 'fact-resolution.v1';

/** Resolve same-scope observations without letting an expired, future, or identity-ambiguous
 * source assertion silently win. Ties between equally credible contradictory assertions remain
 * conflicts and must not be turned into an unconditional projection input. */
export function resolveObservations(observations: SourceObservation[], now = new Date()): ResolvedFact[] {
  const groups = new Map<string, SourceObservation[]>();
  for (const observation of observations) {
    const key = [observation.tenantId, observation.slateId, observation.gameId ?? observation.eventId, observation.subject.kind, observation.subject.id, observation.factType, effectivePeriod(observation.effectiveAt)].join(':');
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  return [...groups.values()].map((group) => resolveGroup(group, now));
}

function resolveGroup(group: SourceObservation[], now: Date): ResolvedFact {
  const first = group[0];
  const fresh = group.filter((item) => {
    const retrieved = Date.parse(item.retrievedAt);
    const observed = Date.parse(item.observedAt);
    const published = item.publishedAt ? Date.parse(item.publishedAt) : Number.NEGATIVE_INFINITY;
    const effective = item.effectiveAt ? Date.parse(item.effectiveAt) : Number.NEGATIVE_INFINITY;
    return Number.isFinite(retrieved) && Number.isFinite(observed) && (!item.effectiveAt || Number.isFinite(effective)) && (!item.publishedAt || Number.isFinite(published)) && published <= now.getTime() && retrieved <= now.getTime() + 5 * 60_000 && observed <= now.getTime() + 5 * 60_000 && (!item.expiresAt || Date.parse(item.expiresAt) > now.getTime());
  });
  const canonicalFactKey = [first.tenantId, first.slateId, first.gameId ?? first.eventId, first.subject.kind, first.subject.id, first.factType, effectivePeriod(first.effectiveAt)].join(':');
  const common = { tenantId: first.tenantId, slateId: first.slateId, eventId: first.eventId, subjectId: first.subject.id, factType: first.factType, resolvedAt: now.toISOString(), decisionAt: now.toISOString(), ruleVersion: FACT_RESOLUTION_RULE_VERSION, canonicalFactKey };
  if (!fresh.length) return { ...common, id: factId(group), observationIds: group.map((item) => item.id), supportingObservationIds: [], rejectedObservationIds: group.map((item) => item.id), state: 'EXPIRED', rationale: 'No observation is within its effective and freshness window.' };
  const identifiable = fresh.filter((item) => item.identityConfidence === 'EXACT' || item.identityConfidence === 'HIGH');
  if (!identifiable.length) return { ...common, id: factId(fresh), observationIds: fresh.map((item) => item.id), supportingObservationIds: [], rejectedObservationIds: fresh.map((item) => item.id), state: 'UNKNOWN', rationale: 'All fresh observations have low or conflicting subject identity.' };
  const statusPriority = (status: SourceObservation['status']) => ({ CONFIRMED: 4, PROJECTED: 3, REPORTED: 2, UNVERIFIED: 1 })[status];
  const strongestStatus = Math.max(...identifiable.map((item) => statusPriority(item.status)));
  const statusCandidates = identifiable.filter((item) => statusPriority(item.status) === strongestStatus);
  const strongestIdentity = Math.max(...statusCandidates.map((item) => item.identityConfidence === 'EXACT' ? 2 : 1));
  const credible = statusCandidates.filter((item) => (item.identityConfidence === 'EXACT' ? 2 : 1) === strongestIdentity);
  const newest = Math.max(...credible.map((item) => Date.parse(item.observedAt)));
  const contenders = credible.filter((item) => Date.parse(item.observedAt) === newest);
  const distinctValues = new Set(contenders.map((item) => stableValue(item.value)));
  const observationIds = credible.map((item) => item.id);
  if (distinctValues.size > 1) return { ...common, id: factId(credible), observationIds, supportingObservationIds: [], rejectedObservationIds: group.filter((item) => !credible.includes(item)).map((item) => item.id), state: 'CONFLICT', rationale: `Equally trusted ${contenders[0].status.toLowerCase()} observations at ${new Date(newest).toISOString()} disagree.` };
  const winner = contenders[0];
  return { ...common, id: factId(credible), observationIds, supportingObservationIds: contenders.map((item) => item.id), rejectedObservationIds: group.filter((item) => !contenders.includes(item)).map((item) => item.id), value: winner.value, state: 'ACCEPTED', rationale: `Selected the freshest ${winner.status.toLowerCase()} observation with ${winner.identityConfidence.toLowerCase()} identity confidence.` };
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
}
function factId(observations: SourceObservation[]): string { return observations.map((item) => item.id).sort().join('|'); }
function effectivePeriod(value?: string): string { if (!value) return 'undated'; const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : 'invalid'; }
