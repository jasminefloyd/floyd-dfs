import { createHash } from 'node:crypto';
import type { BehaviorSignal, IntelligenceObservation } from '../../src/lib/engine/contracts.js';
import type { NbaStreetTeamObservationInput } from '../nbaStreetTeamProvider.js';

const CONTEXT_RULES = [
  {
    category: 'RETURN_TO_PLAY_CONTEXT',
    pattern: /\b(?:return(?:s|ed|ing)?\s+from\s+(?:an?\s+)?injur\w*|return(?:s|ed|ing)?\s+to\s+(?:practice|the\s+court|the\s+lineup|action)|back\s+in\s+(?:practice|the\s+lineup|action))\b/i,
    interpretation: 'The source reports a return-to-activity event. It does not establish workload, readiness, emotional state, or fantasy-performance impact.',
  },
  {
    category: 'FORMER_TEAM_CONTEXT',
    pattern: /\b(?:former\s+team|former\s+teammate|old\s+team|faces?\s+(?:his|her|their)\s+former\s+team)\b/i,
    interpretation: 'The source reports a former-team connection. No rivalry, motivation, or performance effect is inferred.',
  },
  {
    category: 'COMPETITIVE_PRESSURE_CONTEXT',
    pattern: /\b(?:playoff\s+pressure|play-in\s+pressure|must[- ]win|playoff\s+race|elimination\s+game)\b/i,
    interpretation: 'The source describes competitive context. It does not establish an individual emotional response or performance effect.',
  },
  {
    category: 'REPORTED_PUBLIC_STATEMENT',
    pattern: /\b(?:said|told|stated|says)\b[^\n]{0,240}[“"][^“”"]{3,}[”"]|[“"][^“”"]{3,}[”"][^\n]{0,240}\b(?:said|told|stated|says)\b/i,
    interpretation: 'The source reports a public statement. The statement is not treated as a validated measure of confidence, motivation, emotional state, or performance.',
  },
] as const;

/**
 * Extract only explicit context from single-source player news observations.
 * Signals quote the source headline as an event, retain the observation link,
 * and stay report-only with a zero numerical effect.
 */
export function deriveStreetTeamBehaviorSignals(
  tenantId: string,
  observations: NbaStreetTeamObservationInput[],
): BehaviorSignal[] {
  const output: BehaviorSignal[] = [];
  for (const observation of observations) {
    if (observation.subjectKind !== 'PLAYER' || observation.classification !== 'SINGLE_SOURCE_REPORT') continue;
    if (!['ESPN NBA', 'RotoWire NBA'].includes(observation.provider)) continue;
    const title = text(observation.payload.title);
    const summary = text(observation.payload.summary);
    const articleUrl = text(observation.payload.articleUrl);
    if (!title || !articleUrl?.startsWith('https://')) continue;
    const sourceText = `${title} ${summary ?? ''}`;
    for (const rule of CONTEXT_RULES) {
      if (!rule.pattern.test(sourceText)) continue;
      output.push({
        id: stableId(`${tenantId}:${observation.id}:${rule.category}`),
        tenantId,
        sport: 'NBA',
        subject: { kind: 'PLAYER', id: observation.subjectId },
        event: `${rule.category}: ${title}`,
        interpretation: rule.interpretation,
        observationIds: [observation.id],
        confidence: observation.confidence,
        effectStatus: 'REPORT_ONLY',
        numericEffect: 0,
      });
    }
  }
  return output;
}

/** Map snapshot signals to the additive, tenant-scoped behavior ledger rows. */
export function toStreetTeamBehaviorSignalRows(
  tenantId: string,
  signals: BehaviorSignal[],
  observations: Array<Pick<IntelligenceObservation, 'id' | 'classification' | 'observedAt' | 'publishedAt' | 'effectiveAt'>>,
): Array<Record<string, unknown>> {
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  return signals.map((signal) => {
    const observationId = signal.observationIds[0];
    const observation = observationById.get(observationId);
    if (!observation) throw new Error(`Behavior signal ${signal.id} has no persisted source observation.`);
    if (!['OFFICIAL_CONFIRMED', 'CORROBORATED_REPORT', 'SINGLE_SOURCE_REPORT', 'HYPOTHESIS'].includes(observation.classification)) {
      throw new Error(`Behavior signal ${signal.id} has an unsupported evidence class.`);
    }
    return {
      id: stableUuid(signal.id),
      tenant_id: tenantId,
      sport: signal.sport,
      player_id: signal.subject.kind === 'PLAYER' ? signal.subject.id : null,
      team_id: signal.subject.kind === 'TEAM' ? signal.subject.id : null,
      source_observation_id: observationId,
      signal_type: signal.event.split(':', 1)[0],
      claim: signal.event,
      evidence_class: observation.classification,
      confidence: signal.confidence,
      model_effect: signal.numericEffect ?? null,
      effect_status: signal.effectStatus,
      model_version: signal.modelVersion ?? null,
      effective_at: observation.effectiveAt ?? observation.publishedAt ?? null,
      observed_at: observation.observedAt,
    };
  });
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stableId(value: string): string {
  return `behavior:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
