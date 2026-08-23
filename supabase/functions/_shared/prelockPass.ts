import type { EvidenceRef, SlateResearchDossier } from './decisionContracts.ts';

export type PrelockPassStatus = 'scheduled' | 'ready' | 'stale' | 'blocked';

export interface PrelockChange {
  source: string;
  change_type: 'added' | 'updated' | 'removed';
  summary: string;
  evidence_ids: string[];
  player_ids: string[];
}

export interface PrelockPassDecision {
  pass_id: string;
  status: PrelockPassStatus;
  scheduled_for: string;
  executed_at: string | null;
  changed_sources: string[];
  affected_player_ids: string[];
  affected_script_keys: string[];
  rebuild_scope: 'none' | 'affected_players_scripts_lineups';
  supersede_lineup_ids: string[];
  changes: PrelockChange[];
  what_changed: string[];
  blocked_reasons: string[];
}

function evidenceKey(evidence: EvidenceRef): string {
  return `${evidence.source}:${evidence.normalized_fact?.fact_key ?? evidence.fact ?? evidence.evidence_id}`;
}

function evidencePlayerIds(evidence: EvidenceRef): string[] {
  const normalized = evidence.normalized_fact ?? {};
  const values = [normalized.player_id, normalized.player_ids, normalized.affected_player_ids];
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map(String))];
}

export function compareSourceEvidence(previous: EvidenceRef[] = [], current: EvidenceRef[] = []): PrelockChange[] {
  const before = new Map(previous.map((item) => [evidenceKey(item), item]));
  const after = new Map(current.map((item) => [evidenceKey(item), item]));
  const changes: PrelockChange[] = [];

  for (const [key, item] of after) {
    const prior = before.get(key);
    const changed = !prior || prior.fact !== item.fact || JSON.stringify(prior.normalized_fact ?? null) !== JSON.stringify(item.normalized_fact ?? null);
    if (changed) {
      changes.push({
        source: item.source,
        change_type: prior ? 'updated' : 'added',
        summary: item.fact ?? `${item.source} evidence changed`,
        evidence_ids: [item.evidence_id],
        player_ids: evidencePlayerIds(item),
      });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) {
      changes.push({
        source: item.source,
        change_type: 'removed',
        summary: `Prior ${item.source} evidence is no longer present`,
        evidence_ids: [item.evidence_id],
        player_ids: evidencePlayerIds(item),
      });
    }
  }
  return changes;
}

export function buildPrelockPassDecision(args: {
  previousDossier?: SlateResearchDossier | null;
  currentDossier?: SlateResearchDossier | null;
  lockTime?: string | null;
  now?: string;
  supersedeLineupIds?: string[];
  passId?: string;
}): PrelockPassDecision {
  const now = new Date(args.now ?? new Date().toISOString());
  const lock = args.lockTime ? new Date(args.lockTime) : null;
  const scheduled = lock && !Number.isNaN(lock.getTime())
    ? new Date(lock.getTime() - 12 * 60 * 1000)
    : new Date(now.getTime());
  const current = args.currentDossier;
  const changes = compareSourceEvidence(args.previousDossier?.source_evidence, current?.source_evidence);
  const changedSources = [...new Set(changes.map((change) => change.source))];
  const affectedPlayerIds = [...new Set(changes.flatMap((change) => change.player_ids))];
  const scriptKeys = (current?.game_scripts ?? [])
    .filter((script) => script.evidence_ids.some((id) => changes.some((change) => change.evidence_ids.includes(id))))
    .map((script) => script.script_key);
  const blockedReasons: string[] = [];
  if (!current) blockedReasons.push('A refreshed MIOS dossier was not produced.');
  if (current?.readiness_status === 'blocked') blockedReasons.push('The refreshed dossier is blocked for lineup generation.');
  if (lock && !Number.isNaN(lock.getTime()) && now.getTime() > lock.getTime()) blockedReasons.push('The slate lock time has passed.');
  const status: PrelockPassStatus = blockedReasons.length
    ? 'blocked'
    : changes.length
      ? 'ready'
      : 'stale';
  return {
    pass_id: args.passId ?? crypto.randomUUID(),
    status,
    scheduled_for: scheduled.toISOString(),
    executed_at: now.toISOString(),
    changed_sources: changedSources,
    affected_player_ids: affectedPlayerIds,
    affected_script_keys: [...new Set(scriptKeys)],
    rebuild_scope: changes.length ? 'affected_players_scripts_lineups' : 'none',
    supersede_lineup_ids: [...new Set(args.supersedeLineupIds ?? [])],
    changes,
    what_changed: changes.map((change) => `${change.source}: ${change.summary}`).slice(0, 50),
    blocked_reasons: blockedReasons,
  };
}
