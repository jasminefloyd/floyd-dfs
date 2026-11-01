import type { ProjectionPackage, SlatePlayer, StreetTeamSnapshot, StreetTeamResolvedFact } from '../../../src/lib/engine/contracts.js';

export const NBA_HOUSE_DRIVER_POLICY_VERSION = 'nba-house.driver-policy.v1';
export type NbaDriverType = 'MINUTES_RESTRICTION' | 'TEAMMATE_OUT' | 'STARTING_ROLE' | 'ROTATION_CHANGE' | 'BEHAVIORAL_CONTEXT';
export interface DriverDecision {
  playerId: string; driverType: NbaDriverType | 'NO_ADJUSTMENT'; decision: 'APPLY' | 'REPORT_ONLY' | 'ABSTAIN';
  baselineInput: number | null; proposedInput: number | null; delta: number | null; dimension: string | null;
  constraintCap?: number;
  evidenceIds: string[]; source: string | null; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; policyVersion: string;
  validationState: 'UNVALIDATED' | 'SHADOW_PASS' | 'APPROVED'; reasonCode: string; reason: string; asOf: string;
}

/** Candidate decisions remain report-only unless a registry-linked reviewed policy is supplied. */
export function evaluateDrivers(input: { baseline: ProjectionPackage; evidence: StreetTeamSnapshot; player: SlatePlayer; asOf: string; approvedPolicyVersion?: string }): DriverDecision[] {
  if (input.baseline.sport !== 'NBA' || input.evidence.sport !== 'NBA' || input.baseline.tenantId !== input.evidence.tenantId) throw new Error('NBA driver evaluation requires same-tenant NBA inputs.');
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf) || asOf > Date.now()) throw new Error('NBA driver evaluation requires a valid non-future cutoff.');
  const projection = input.baseline.players.find((row) => row.playerId === input.player.playerId);
  const baselineMinutes = projection?.adjustedOpportunity.expectedMinutes;
  const subjectId = input.player.identity?.sportsDataIoId ? `nba:player:sportsdataio:${input.player.identity.sportsDataIoId}` : input.player.playerId;
  const facts = input.evidence.resolvedFacts.filter((fact) => fact.subject.id === subjectId && (!fact.effectiveAt || Date.parse(fact.effectiveAt) <= asOf) && Date.parse(fact.resolvedAt) <= asOf);
  const freshIds = new Set(input.evidence.observations.filter((item) => Date.parse(item.retrievedAt) <= asOf && (!item.expiresAt || Date.parse(item.expiresAt) > asOf)).map((item) => item.id));
  const relevant = facts.filter((fact) => fact.observationIds.some((id) => freshIds.has(id)));
  if (input.evidence.unknowns.some((item) => item.subjectId === subjectId) || relevant.some((fact) => fact.state === 'CONFLICT')) return [decision(input.player.playerId, 'ROTATION_CHANGE', 'ABSTAIN', baselineMinutes, null, null, ids(relevant), 'CONFLICT_OR_UNKNOWN', 'Conflicting or unresolved evidence prevents a candidate adjustment.', input.asOf)];
  const behavior = input.evidence.behaviorSignals.filter((signal) => signal.subject.id === subjectId && Date.parse(input.evidence.asOf) <= asOf);
  if (behavior.length) return [decision(input.player.playerId, 'BEHAVIORAL_CONTEXT', 'REPORT_ONLY', baselineMinutes, baselineMinutes ?? null, baselineMinutes === undefined ? null : 0, [...new Set(behavior.flatMap((signal) => signal.observationIds))], 'BEHAVIORAL_CONTEXT', 'Behavioral context is retained for explanation and has zero numeric effect.', input.asOf)];
  const restriction = relevant.filter((fact) => fact.state === 'ACCEPTED' && fact.factType === 'minutes.restriction');
  if (restriction.length) {
    const parsed = restriction.map((fact) => ({ fact, cap: minutesCap(fact.value) }));
    if (parsed.some((item) => item.cap === null || !directProvider(input.evidence, item.fact))) return [decision(input.player.playerId, 'MINUTES_RESTRICTION', 'ABSTAIN', baselineMinutes, null, null, ids(restriction), 'UNVERIFIED_MINUTES_CAP', 'A restriction lacks a complete directly sourced numeric cap.', input.asOf)];
    const caps = [...new Set(parsed.map((item) => item.cap!))];
    if (caps.length !== 1 || baselineMinutes === undefined || !Number.isFinite(baselineMinutes) || caps[0]! < 0 || caps[0]! > 48) return [decision(input.player.playerId, 'MINUTES_RESTRICTION', 'ABSTAIN', baselineMinutes, null, null, ids(restriction), 'CONFLICTING_OR_INVALID_MINUTES_CAP', 'A unique valid baseline and 0–48 minute cap are required.', input.asOf)];
    const proposed = Math.min(baselineMinutes, caps[0]!); const approved = input.approvedPolicyVersion === NBA_HOUSE_DRIVER_POLICY_VERSION;
    return [decision(input.player.playerId, 'MINUTES_RESTRICTION', approved ? 'APPLY' : 'REPORT_ONLY', baselineMinutes, proposed, proposed - baselineMinutes, ids(restriction), 'EXPLICIT_MINUTES_CAP', approved ? 'Explicit provider cap is eligible under the reviewed policy; run validation remains required.' : 'Candidate follows the explicit cap but remains report-only pending evaluation and review.', input.asOf, approved ? 'APPROVED' : 'UNVALIDATED', caps[0])];
  }
  const teammateOut = input.evidence.resolvedFacts.filter((fact) => fact.state === 'ACCEPTED' && fact.factType === 'availability.injury_status' && fact.subject.id !== subjectId && isOut(fact.value) && sameTeam(subjectId, fact.subject.id, input.evidence));
  if (teammateOut.length) return [decision(input.player.playerId, 'TEAMMATE_OUT', 'REPORT_ONLY', baselineMinutes, null, null, ids(teammateOut), 'TEAMMATE_OUT_NO_CALIBRATED_ALLOCATION', 'Teammate absence is captured, but no verified model supports minutes or usage redistribution.', input.asOf)];
  const starter = relevant.filter((fact) => fact.state === 'ACCEPTED' && fact.factType === 'lineup.status');
  if (starter.length) return [decision(input.player.playerId, 'STARTING_ROLE', 'REPORT_ONLY', baselineMinutes, null, null, ids(starter), 'STARTING_ROLE_NO_CALIBRATED_EFFECT', 'Starting designation is reported without a validated numeric coefficient.', input.asOf)];
  const rotation = relevant.filter((fact) => fact.state === 'ACCEPTED' && fact.factType === 'rotation.role');
  if (rotation.length) return [decision(input.player.playerId, 'ROTATION_CHANGE', 'REPORT_ONLY', baselineMinutes, null, null, ids(rotation), 'ROTATION_ROLE_NO_CALIBRATED_EFFECT', 'Rotation evidence is retained without a calibrated numeric effect.', input.asOf)];
  return [decision(input.player.playerId, 'NO_ADJUSTMENT', 'REPORT_ONLY', baselineMinutes, baselineMinutes ?? null, baselineMinutes === undefined ? null : 0, [], 'NO_ADJUSTMENT', 'No eligible as-of numeric evidence; baseline is unchanged.', input.asOf)];
}

function decision(playerId: string, driverType: DriverDecision['driverType'], choice: DriverDecision['decision'], before: number | undefined, after: number | null, delta: number | null, evidenceIds: string[], reasonCode: string, reason: string, asOf: string, validationState: DriverDecision['validationState'] = 'UNVALIDATED', constraintCap?: number): DriverDecision { return { playerId, driverType, decision: choice, baselineInput: before ?? null, proposedInput: after, delta, dimension: driverType === 'MINUTES_RESTRICTION' ? 'expectedMinutes' : null, ...(constraintCap !== undefined ? { constraintCap } : {}), evidenceIds, source: evidenceIds.length ? 'STREET_TEAM_SNAPSHOT' : null, confidence: choice === 'ABSTAIN' ? 'LOW' : evidenceIds.length ? 'MEDIUM' : 'LOW', policyVersion: NBA_HOUSE_DRIVER_POLICY_VERSION, validationState, reasonCode, reason, asOf }; }
function minutesCap(value: unknown): number | null { const row = record(value); const cap = Number(row?.minutesCap); return Number.isFinite(cap) ? cap : null; }
function directProvider(snapshot: StreetTeamSnapshot, fact: StreetTeamResolvedFact): boolean { const evidence = new Set(fact.observationIds); return snapshot.observations.some((item) => evidence.has(item.id) && item.source === 'SportsDataIO' && item.classification === 'OFFICIAL_CONFIRMED' && item.confidence >= 0.9); }
function isOut(value: unknown): boolean { const row = record(value); return String(row?.normalizedStatus ?? row?.status ?? '').toUpperCase() === 'OUT'; }
function sameTeam(playerId: string, otherId: string, snapshot: StreetTeamSnapshot): boolean { const rows = snapshot.rosterState.filter((row) => row.playerId === playerId || row.playerId === otherId); return rows.length >= 2 && rows.every((row) => row.teamId === rows[0]!.teamId); }
function ids(facts: StreetTeamResolvedFact[]): string[] { return [...new Set(facts.flatMap((fact) => fact.observationIds))].sort(); }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
