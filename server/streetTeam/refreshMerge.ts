import type { IntelligenceObservation, StreetTeamSnapshot } from '../../src/lib/engine/contracts.js';
import type { NbaStreetTeamProviderResult } from '../nbaStreetTeamProvider.js';
import type { NbaRefreshKind } from './scheduler.js';

export function mergeStreetTeamRefresh(previous: StreetTeamSnapshot | null, current: NbaStreetTeamProviderResult, kind: NbaRefreshKind, now = new Date()): NbaStreetTeamProviderResult & { retainedObservations: IntelligenceObservation[] } {
  if (!previous || kind === 'FULL') return { ...current, retainedObservations: [] };
  const replace = (factType: string): boolean => factType === 'roster.membership'
    || (kind !== 'TRANSACTIONS' && factType === 'availability.injury_status')
    || ((kind === 'LINEUPS' || kind === 'PRE_LOCK_VERIFY') && factType === 'lineup.status')
    || (kind === 'TRANSACTIONS' && factType === 'transaction.record');
  const currentTypes = new Set(current.resolvedFacts.map((fact) => fact.factType));
  const priorFacts = previous.resolvedFacts.filter((fact) => fact.state !== 'EXPIRED').map((fact) => ({ id: fact.id, subject: fact.subject, factType: fact.factType, value: fact.value, observationIds: fact.observationIds, confidence: fact.confidence, effectiveAt: fact.effectiveAt, resolvedAt: fact.resolvedAt, ruleVersion: fact.ruleVersion, state: fact.state as 'ACCEPTED' | 'CONFLICT' | 'UNKNOWN' }));
  const facts = [...priorFacts.filter((fact) => !replace(fact.factType)),
    ...current.resolvedFacts.filter((fact) => replace(fact.factType) || !currentTypes.has(fact.factType))];
  const byFact = new Map(facts.map((fact) => [`${fact.factType}:${fact.subject.id}:${fact.id}`, fact]));
  const resolvedFacts = [...byFact.values()];
  const retainedObservations = previous.observations.filter((item) => !refreshesObservation(item.sourceUrl ?? '', kind));
  const diagnostics = new Map(previous.providerDiagnostics.map((item) => [item.provider, { ...item, freshness: Date.parse(item.retrievedAt) < now.getTime() - 24 * 60 * 60_000 ? 'STALE' as const : item.freshness }]));
  for (const item of current.providerDiagnostics) diagnostics.set(item.provider, item);
  const rosterState = resolvedFacts.flatMap((fact) => {
    const value = asRecord(fact.value);
    if (fact.factType === 'roster.membership' && value?.teamId && value.providerStatus) return [{ playerId: fact.subject.id, teamId: String(value.teamId), status: String(value.providerStatus), validFrom: fact.effectiveAt ?? fact.resolvedAt, evidenceIds: fact.observationIds }];
    if (fact.factType === 'lineup.status' && value?.teamId && value.status) return [{ playerId: fact.subject.id, teamId: String(value.teamId), status: String(value.status), validFrom: fact.effectiveAt ?? fact.resolvedAt, evidenceIds: fact.observationIds }];
    return [];
  });
  const availability = resolvedFacts.filter((fact) => fact.factType === 'availability.injury_status').flatMap((fact) => {
    const status = asRecord(fact.value)?.normalizedStatus;
    return typeof status === 'string' ? [{ playerId: fact.subject.id, status, observedAt: fact.resolvedAt, evidenceIds: fact.observationIds }] : [];
  });
  const transactions = resolvedFacts.filter((fact) => fact.factType === 'transaction.record').flatMap((fact) => {
    const value = asRecord(fact.value);
    return value && fact.effectiveAt ? [{ playerId: fact.subject.id, transactionType: String(value.transactionType ?? 'UNKNOWN'), effectiveAt: fact.effectiveAt, evidenceIds: fact.observationIds }] : [];
  });
  const refreshedQuestion = (question: string): boolean => (/roster|identity|team assignment/i.test(question))
    || ((kind === 'AVAILABILITY' || kind === 'LINEUPS' || kind === 'PRE_LOCK_VERIFY') && /injur|availability|lineup/i.test(question))
    || (kind === 'TRANSACTIONS' && /transaction/i.test(question));
  return { ...current, retainedObservations, resolvedFacts, rosterState, availability, transactions, providerDiagnostics: [...diagnostics.values()], unknowns: [...previous.unknowns.filter((item) => !refreshedQuestion(item.question) && !current.unknowns.some((next) => next.question === item.question)), ...current.unknowns] };
}

function refreshesObservation(url: string, kind: NbaRefreshKind): boolean {
  if (kind === 'FULL') return true;
  const path = url.toLowerCase();
  if (path.includes('transactionsbydate')) return kind === 'TRANSACTIONS';
  if (path.endsWith('/players') || path.includes('/injuredplayers')) return true;
  if (path.includes('startinglineupsbydate')) return kind === 'LINEUPS' || kind === 'PRE_LOCK_VERIFY';
  return false;
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
