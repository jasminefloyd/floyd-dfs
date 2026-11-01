import type { StreetTeamSnapshot, ValidatedSlate } from '../../src/lib/engine/contracts.js';

export interface NbaSlateIdentityGateResult {
  slate: ValidatedSlate;
  mappedPlayerIds: string[];
  excluded: Array<{ playerId: string; playerName: string; reason: string }>;
}

/** Only exact DK/provider identities present in the captured Street Team roster may enter auto-selection. */
export function applyNbaStreetTeamIdentityGate(slate: ValidatedSlate, snapshot: StreetTeamSnapshot, now = new Date()): NbaSlateIdentityGateResult {
  if (slate.sport !== 'NBA' || snapshot.sport !== 'NBA' || snapshot.tenantId !== slate.tenantId) throw new Error('NBA identity gate received a wrong-sport or cross-tenant input.');
  const ageMs = now.getTime() - Date.parse(snapshot.asOf);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 24 * 60 * 60_000) throw new Error('NBA identity gate requires a current Street Team snapshot no older than 24 hours.');
  const roster = snapshot.resolvedFacts.filter((fact) => fact.factType === 'roster.membership' && fact.state === 'ACCEPTED');
  const availability = new Map(snapshot.resolvedFacts.filter((fact) => fact.factType === 'availability.injury_status').map((fact) => [fact.subject.id, fact]));
  const mappedPlayerIds: string[] = [];
  const excluded: NbaSlateIdentityGateResult['excluded'] = [];
  const playerPool = slate.playerPool.flatMap((player) => {
    const providerId = player.identity?.sportsDataIoId;
    const dkId = player.identity?.draftKingsId ?? player.playerId;
    if (!providerId || player.identity?.confidence !== 'EXACT' || player.identity.matchedBy !== 'PROVIDER_ID') {
      excluded.push({ playerId: player.playerId, playerName: player.playerName, reason: 'Slate identity is not an exact DraftKings-to-SportsDataIO provider-ID match.' });
      return [];
    }
    const matches = roster.filter((fact) => {
      const value = asRecord(fact.value);
      return fact.subject.id === `nba:player:sportsdataio:${providerId}`
        && String(value?.providerPlayerId ?? '') === providerId
        && String(value?.draftKingsPlayerId ?? '') === dkId
        && normalizeTeam(String(value?.team ?? '')) === normalizeTeam(String(player.team ?? ''));
    });
    if (matches.length !== 1) {
      excluded.push({ playerId: player.playerId, playerName: player.playerName, reason: matches.length ? 'Street Team roster identity is ambiguous.' : 'No exact player ID, DraftKings pool ID, and team match exists in the Street Team snapshot.' });
      return [];
    }
    const statusFact = availability.get(matches[0]!.subject.id);
    const status = asRecord(statusFact?.value)?.normalizedStatus;
    if (statusFact?.state === 'CONFLICT' || status === 'UNKNOWN') {
      excluded.push({ playerId: player.playerId, playerName: player.playerName, reason: 'Street Team availability is conflicted or unknown.' });
      return [];
    }
    mappedPlayerIds.push(player.playerId);
    if (status === 'OUT') {
      excluded.push({ playerId: player.playerId, playerName: player.playerName, reason: 'Street Team has a resolved OUT status.' });
      return [];
    }
    return [player];
  });
  return { slate: { ...slate, playerPool }, mappedPlayerIds, excluded };
}

/** Recheck the selected entries against the freshest verified pre-lock NBA identity/status snapshot. */
export function validateNbaLineupAtEntry(slate: ValidatedSlate, snapshot: StreetTeamSnapshot, playerIds: string[], now = new Date()): string[] {
  if (slate.sport !== 'NBA' || snapshot.sport !== 'NBA' || snapshot.tenantId !== slate.tenantId) return ['Entry identity validation requires same-tenant NBA slate and Street Team snapshot.'];
  const lockTime = Date.parse(slate.contest.lockTime);
  if (!Number.isFinite(lockTime) || now.getTime() >= lockTime) return ['Entry confirmation requires a verified contest lock time that has not passed.'];
  const snapshotTime = Date.parse(snapshot.asOf);
  if (!Number.isFinite(snapshotTime) || snapshotTime > lockTime) return ['Entry confirmation requires an identity snapshot captured at or before contest lock.'];
  try {
    const gate = applyNbaStreetTeamIdentityGate(slate, snapshot, now);
    const eligible = new Set(gate.slate.playerPool.map((player) => player.playerId));
    const invalid = playerIds.filter((playerId) => !eligible.has(playerId));
    return invalid.length ? [`${invalid.length} lineup player(s) no longer pass exact identity and confirmed availability checks.`] : [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'Current NBA identity and availability verification failed.'];
  }
}

function normalizeTeam(value: string): string { return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
