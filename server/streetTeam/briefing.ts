import type { StreetTeamSnapshot, StreetTeamResolvedFact } from '../../src/lib/engine/contracts.js';

export interface StreetTeamBriefingChange {
  key: string; subjectId: string; factType: string; before?: unknown; after: unknown;
  observationIds: string[]; actionable: boolean;
}

/** Compare by canonical entity/fact rather than observation IDs, which change on each poll. */
export function snapshotChanges(current: StreetTeamSnapshot, previous?: StreetTeamSnapshot): StreetTeamBriefingChange[] {
  if (!previous) return [];
  const priorFacts = new Map(previous.resolvedFacts.map((fact) => [factKey(fact), fact]));
  const currentFacts = new Map(current.resolvedFacts.map((fact) => [factKey(fact), fact]));
  const changed = current.resolvedFacts.flatMap((fact) => {
    const key = factKey(fact);
    const prior = priorFacts.get(key);
    if (prior && stableJson(prior.value) === stableJson(fact.value) && prior.state === fact.state) return [];
    const availability = fact.factType.startsWith('availability.');
    const roster = fact.factType === 'roster.membership' || fact.factType === 'transaction.record';
    return [{ key, subjectId: fact.subject.id, factType: fact.factType, ...(prior ? { before: prior.value } : {}), after: fact.value, observationIds: fact.observationIds, actionable: availability || roster }];
  });
  const removed = previous.resolvedFacts.flatMap((fact) => currentFacts.has(factKey(fact)) ? [] : [{ key: factKey(fact), subjectId: fact.subject.id, factType: fact.factType, before: fact.value, after: null, observationIds: fact.observationIds, actionable: fact.factType === 'roster.membership' || fact.factType === 'transaction.record' }]);
  return [...changed, ...removed];
}

export function canonicalFactKey(fact: StreetTeamResolvedFact): string { return factKey(fact); }
function factKey(fact: StreetTeamResolvedFact): string { return `${fact.subject.kind}:${fact.subject.id}:${fact.factType}`; }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
