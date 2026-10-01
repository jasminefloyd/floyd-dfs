import type { SlatePlayer, Sport, ValidatedSlate } from './contracts.js';

export interface AvailabilityRecord { playerName: string; team?: string; providerPlayerId?: string; status: NonNullable<SlatePlayer['availability']>['status']; roleStatus?: NonNullable<SlatePlayer['availability']>['roleStatus']; confirmed: boolean; battingOrder?: number; updatedAt?: string; note?: string; }
export interface AvailabilitySnapshot { source: string; retrievedAt: string; records: AvailabilityRecord[]; confirmedLineupAvailable: boolean; rosterComplete?: boolean; eventId?: string; eventTeams?: string[]; note?: string; diagnostics?: Array<{ provider: string; status: 'SUCCEEDED' | 'EMPTY' | 'FAILED'; error?: string; httpStatus?: number; retrievedAt: string }>; }

export function normalizeProviderName(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]/g, ''); }
// Both DraftKings and provider (SportsDataIO/ESPN) team codes pass through this same function
// before comparison, so it only matters that every known variant for one real team collapses
// to the same value -- not which specific variant is picked as "canonical."
const TEAM_CODE_ALIASES: Record<string, string> = { CHW: 'CWS', WAS: 'WSH', PDX: 'POR', SDP: 'SD', SFG: 'SF', TBR: 'TB', AZ: 'ARI', OAK: 'ATH', LV: 'LVA' };
export function normalizeTeamCode(value?: string): string { const code = (value ?? '').trim().toUpperCase(); return TEAM_CODE_ALIASES[code] ?? code; }

// A structured-availability provider call failing means the engine has zero confirmed signal
// distinguishing an OUT/scratched player from an active one for this sport -- players stay
// eligible (fabricating a status would be worse), but that degraded state must never be
// silent. Never escalates an already-BLOCKED slate, and never sets BLOCKED itself -- lineup
// generation still proceeds, just with an honest, persisted record of the gap.
export function withDegradedAvailability(slate: ValidatedSlate, message: string): ValidatedSlate {
  const status = slate.validation.status === 'BLOCKED' ? 'BLOCKED' : 'WARNING';
  return { ...slate, validation: { ...slate.validation, status, warnings: [...slate.validation.warnings, message] } };
}

export function applyAvailabilitySnapshot(slate: ValidatedSlate, snapshot: AvailabilitySnapshot, now?: Date): ValidatedSlate {
  const retrievedAt = Date.parse(snapshot.retrievedAt);
  const staleAfterMs = 12 * 60 * 60 * 1000;
  const stale = now !== undefined && (!Number.isFinite(retrievedAt) || retrievedAt > now.getTime() + 5 * 60 * 1000 || (now.getTime() - retrievedAt > staleAfterMs));
  const eventMismatch = snapshot.eventId !== undefined && snapshot.eventId !== slate.event.eventId;
  const teamMismatch = snapshot.eventTeams !== undefined && new Set(snapshot.eventTeams.map(normalizeTeamCode)).size > 0 && [...new Set(slate.event.participants.map(normalizeTeamCode))].some((team) => !snapshot.eventTeams!.map(normalizeTeamCode).includes(team));
  const slateTeams = new Set([...slate.playerPool.map((player) => player.team), ...slate.event.participants].filter(Boolean).map((team) => normalizeTeamCode(String(team))));
  const foreignRecord = snapshot.records.some((record) => record.team && slateTeams.size > 0 && !slateTeams.has(normalizeTeamCode(record.team)));
  if (stale || eventMismatch || teamMismatch || foreignRecord) {
    const reason = stale ? 'snapshot is stale, future-dated, or has an invalid retrieval timestamp' : eventMismatch ? 'snapshot event ID does not match the selected slate event' : teamMismatch || foreignRecord ? 'snapshot scope contains teams outside the selected slate event' : 'snapshot does not match the selected slate event';
    return withDegradedAvailability({ ...slate, providerDiagnostics: [...(slate.providerDiagnostics ?? []), ...(snapshot.diagnostics ?? [])] }, `${snapshot.source} availability was rejected because the ${reason}; no provider status was applied.`);
  }
  const byKey = new Map<string, AvailabilityRecord[]>();
  const byProviderId = new Map<string, AvailabilityRecord[]>();
  for (const record of snapshot.records) {
    const key = identityKey(record.playerName, record.team);
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
    if (record.providerPlayerId) byProviderId.set(record.providerPlayerId, [...(byProviderId.get(record.providerPlayerId) ?? []), record]);
  }
  const warnings = [...slate.validation.warnings];
  let rejectedIdentityCount = 0;
  const playerPool = slate.playerPool.map((player) => {
    // DraftKings team defenses are fantasy assets, not individual athletes. Roster/injury
    // feeds contain defensive players and team records with unrelated names, so exact player
    // reconciliation incorrectly labeled every DST NOT_IN_PROVIDER_ROSTER and removed them.
    if (slate.sport === 'NFL' && /^DST$/i.test(String(player.position ?? ''))) return player;
    const sourceName = snapshot.source.toUpperCase();
    const identityProviderIds = sourceName.includes('ESPN')
      ? [player.identity?.espnId]
      : sourceName.includes('SPORTSDATAIO')
        ? [player.identity?.sportsDataIoId]
        : [];
    const providerIds = identityProviderIds.filter((value): value is string => Boolean(value));
    const providerIdRecords = providerIds.flatMap((id) => byProviderId.get(id) ?? []);
    const exactRecords = byKey.get(identityKey(player.playerName, player.team)) ?? [];
    const nameOnlyRecords = snapshot.records.filter((record) => normalizeProviderName(record.playerName) === normalizeProviderName(player.playerName) && !record.team);
    const providerIdentityConflict = providerIdRecords.length > 0 && providerIdRecords.some((record) => normalizeProviderName(record.playerName) !== normalizeProviderName(player.playerName) || (record.team && normalizeTeamCode(record.team) !== normalizeTeamCode(player.team)));
    const records = providerIdentityConflict ? [] : providerIdRecords.length ? providerIdRecords : exactRecords.length ? exactRecords : nameOnlyRecords;
    if (providerIdentityConflict) rejectedIdentityCount += 1;
    const confirmedMlbLineup = snapshot.source === 'SPORTSDATAIO' && snapshot.confirmedLineupAvailable;
    if (records.length !== 1 && records.length === 0 && player.availability && snapshot.source.toUpperCase().includes('ESPN') && !snapshot.rosterComplete) return player;
    if (records.length !== 1) {
      // For basketball, only ESPN snapshots that passed the provider's minimum roster
      // size check can prove non-membership. This prevents unmatched DraftKings-only
      // entries from remaining eligible when they are absent from both team rosters.
      const completeRosterSport = ['NFL', 'CFB'].includes(slate.sport) || (['NBA', 'WNBA'].includes(slate.sport) && snapshot.source.toUpperCase().includes('ESPN'));
      const notInProviderRoster = snapshot.rosterComplete === true && completeRosterSport && records.length === 0;
      return { ...player, availability: { status: confirmedMlbLineup ? 'NOT_IN_CONFIRMED_LINEUP' as const : notInProviderRoster ? 'NOT_IN_PROVIDER_ROSTER' as const : 'UNKNOWN' as const, roleStatus: 'UNKNOWN' as const, confirmed: false, source: snapshot.source, retrievedAt: snapshot.retrievedAt, mappedBy: 'UNMAPPED' as const, note: providerIdentityConflict ? 'Provider ID contradicted the player name/team; identity was rejected.' : records.length > 1 ? 'Provider identity match was ambiguous.' : confirmedMlbLineup ? 'No matching record in the confirmed lineup; treated as a non-starter for primary optimization.' : notInProviderRoster ? 'DraftKings player could not be matched to the complete provider roster; excluded from the primary slate.' : snapshot.note ?? 'Provider returned no exact name/team match.' } };
    }
    const record = records[0];
    if (player.availability && snapshot.source.toUpperCase().includes('ESPN') && !shouldReplaceAvailability(player.availability, record)) return player;
    const mappedBy: NonNullable<SlatePlayer['availability']>['mappedBy'] = providerIdRecords.length ? 'PROVIDER_ID' : exactRecords.length ? 'NAME_AND_TEAM' : 'NAME_ONLY';
    const identity = record.providerPlayerId ? snapshot.source.toUpperCase().includes('ESPN') ? { ...player.identity, espnId: record.providerPlayerId, confidence: 'HIGH' as const, matchedBy: mappedBy === 'PROVIDER_ID' ? 'PROVIDER_ID' as const : mappedBy } : snapshot.source.toUpperCase().includes('SPORTSDATAIO') ? { ...player.identity, sportsDataIoId: record.providerPlayerId, confidence: 'HIGH' as const, matchedBy: mappedBy === 'PROVIDER_ID' ? 'PROVIDER_ID' as const : mappedBy } : player.identity : player.identity;
    return { ...player, ...(identity ? { identity } : {}), availability: { status: record.status, roleStatus: record.roleStatus ?? roleStatusFor(slate.sport, record), confirmed: record.confirmed, source: snapshot.source, retrievedAt: snapshot.retrievedAt, providerPlayerId: record.providerPlayerId, mappedBy, battingOrder: record.battingOrder, note: record.note ?? (record.battingOrder ? `Batting order ${record.battingOrder}.` : undefined) } };
  });
  const isExcluded = (player: SlatePlayer) => player.availability?.status === 'OUT' || player.availability?.status === 'INACTIVE' || player.availability?.status === 'NOT_IN_CONFIRMED_LINEUP' || player.availability?.status === 'NOT_IN_PROVIDER_ROSTER';
  const removed = playerPool.filter(isExcluded).length;
  // DraftKings exposes every eligible player, including bench and bullpen players. Once both
  // MLB lineups are confirmed, the primary slate must be the confirmed starters only; otherwise
  // downstream research/projection treats every unlisted draftable as an unresolved starter.
  // The raw DraftKings snapshot remains in the run request payload for auditability.
  const filtered = playerPool.filter((player) => !isExcluded(player));
  const mapped = playerPool.filter((player) => player.availability?.mappedBy && player.availability.mappedBy !== 'UNMAPPED').length;
  if (removed) warnings.push(`${removed} DraftKings player(s) removed from the primary slate after ${snapshot.source} returned an explicit OUT/INACTIVE/non-roster status.`);
  if (rejectedIdentityCount) warnings.push(`${rejectedIdentityCount} player identity match(es) were rejected because the provider ID disagreed with the provider name/team; those players remain UNKNOWN and are not treated as confirmed.`);
  warnings.push(`${snapshot.source} availability reconciliation: ${mapped}/${playerPool.length} DraftKings players mapped to a provider record; statuses and role status are tracked separately.`);
  if (snapshot.confirmedLineupAvailable) warnings.push(`${snapshot.source} confirmed lineup state applied at ${snapshot.retrievedAt}.`);
  else if (snapshot.rosterComplete && ['NFL', 'CFB'].includes(slate.sport)) warnings.push(`${snapshot.source} verified roster membership for the primary ${slate.sport} slate, but did not verify starters; remaining role status is not a confirmed starting lineup.`);
  else warnings.push(`${snapshot.source} did not provide a confirmed pregame lineup; unconfirmed players remain labeled UNKNOWN.`);
  return { ...slate, playerPool: filtered, providerDiagnostics: [...(slate.providerDiagnostics ?? []), ...(snapshot.diagnostics ?? [])], validation: { ...slate.validation, warnings } };
}

function shouldReplaceAvailability(existing: NonNullable<SlatePlayer['availability']>, incoming: AvailabilityRecord): boolean {
  const rank = (status: string): number => ({ OUT: 5, INACTIVE: 4, NOT_IN_CONFIRMED_LINEUP: 4, PROJECTED: 3, ACTIVE: 2, CONFIRMED_STARTER: 2, UNKNOWN: 1 }[status] ?? 1);
  if (rank(incoming.status) !== rank(existing.status)) return rank(incoming.status) > rank(existing.status);
  if (incoming.roleStatus === 'EXPECTED_STARTER' || incoming.roleStatus === 'CONFIRMED_STARTER') return true;
  return existing.source.toUpperCase().includes('SPORTSDATAIO');
}

export function parseAvailabilityRecords(payload: unknown, sport: Sport, retrievedAt: string): AvailabilitySnapshot {
  const rows = extractProviderPlayerRows(payload);
  const records = rows.flatMap((value) => {
    const row = asRecord(value); if (!row) return [];
    const playerName = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']) ?? fullName(row); if (!playerName) return [];
    const team = readString(row, ['Team', 'team', 'TeamAbbreviation']);
    const confirmed = readBoolean(row, ['Confirmed', 'BattingOrderConfirmed', 'confirmed']);
    const starting = readBoolean(row, ['Starting', 'starting']);
    const available = readOptionalBoolean(row, ['Available', 'available']);
    const state = readString(row, ['Status', 'InjuryStatus', 'LineupStatus', 'status']) ?? '';
    // Treat only explicit negative status tokens as unavailable. Substring matching incorrectly
    // marks phrases such as "not out" as OUT and loses the negation in provider descriptions.
    const inactive = /(?:^|\b)(inactive|out|scratched)(?:\b|$)/i.test(state) && !/\bnot\s+(?:inactive|out|scratched)\b/i.test(state);
    const battingOrder = readNumber(row, ['BattingOrder', 'battingOrder']); const position = readString(row, ['Position', 'position']);
    const confirmedMlbStarter = sport === 'MLB' && confirmed && (battingOrder !== undefined || (starting && /^(P|SP)$/i.test(position ?? '')));
    const status: AvailabilityRecord['status'] = inactive ? (/(out|scratched|doubtful)/i.test(state) ? 'OUT' : 'INACTIVE') : confirmedMlbStarter ? 'CONFIRMED_STARTER' : confirmed && starting ? 'ACTIVE' : available === false ? 'INACTIVE' : 'PROJECTED';
    const roleStatus: NonNullable<SlatePlayer['availability']>['roleStatus'] = sport === 'MLB' ? (confirmedMlbStarter ? 'CONFIRMED_STARTER' : 'UNKNOWN') : confirmed && starting ? 'EXPECTED_STARTER' : 'ROLE_UNCONFIRMED';
    return [{ playerName, team, providerPlayerId: readString(row, ['PlayerID', 'PlayerId', 'playerId']), status, roleStatus, confirmed, battingOrder, updatedAt: readString(row, ['Updated', 'DateTime', 'updatedAt']), note: /doubtful|questionable|probable/i.test(state) ? state : undefined }];
  });
  return { source: 'SPORTSDATAIO', retrievedAt, records, confirmedLineupAvailable: sport === 'MLB' && records.some((record) => record.confirmed && record.battingOrder !== undefined) };
}
function roleStatusFor(sport: Sport, record: AvailabilityRecord): NonNullable<SlatePlayer['availability']>['roleStatus'] {
  if (sport === 'MLB') return record.status === 'CONFIRMED_STARTER' ? 'CONFIRMED_STARTER' : 'UNKNOWN';
  if (record.confirmed && record.status === 'ACTIVE') return 'EXPECTED_STARTER';
  if (record.status === 'OUT' || record.status === 'INACTIVE' || record.status === 'NOT_IN_CONFIRMED_LINEUP') return 'NOT_STARTER';
  return 'ROLE_UNCONFIRMED';
}
function extractProviderPlayerRows(payload: unknown): unknown[] { if (!Array.isArray(payload)) return []; return payload.flatMap((game) => { const row = asRecord(game); if (!row) return []; return ['HomeBattingLineup', 'AwayBattingLineup'].flatMap((key) => Array.isArray(row[key]) ? row[key] : []).concat(['HomeStartingPitcher', 'AwayStartingPitcher'].flatMap((key) => row[key] && typeof row[key] === 'object' ? [row[key]] : [])); }); }
function identityKey(name: string, team?: string): string { return `${normalizeProviderName(name)}|${normalizeTeamCode(team)}`; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function fullName(record: Record<string, unknown>): string | undefined { const first = readString(record, ['FirstName', 'firstName']); const last = readString(record, ['LastName', 'lastName']); return first && last ? `${first} ${last}` : first ?? last; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readBoolean(record: Record<string, unknown>, keys: string[]): boolean { for (const key of keys) { if (typeof record[key] === 'boolean') return record[key] as boolean; if (record[key] === 1 || record[key] === '1' || String(record[key]).toLowerCase() === 'true') return true; } return false; }
function readOptionalBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'boolean') return value; if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true; if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false; } return undefined; }
