import type { SlatePlayer, Sport, ValidatedSlate } from './contracts.js';

export interface AvailabilityRecord { playerName: string; team?: string; providerPlayerId?: string; status: NonNullable<SlatePlayer['availability']>['status']; confirmed: boolean; battingOrder?: number; updatedAt?: string; note?: string; }
export interface AvailabilitySnapshot { source: string; retrievedAt: string; records: AvailabilityRecord[]; confirmedLineupAvailable: boolean; note?: string; }

export function normalizeProviderName(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const TEAM_CODE_ALIASES: Record<string, string> = { CHW: 'CWS', WAS: 'WSH', PDX: 'POR' };
export function normalizeTeamCode(value?: string): string { const code = (value ?? '').trim().toUpperCase(); return TEAM_CODE_ALIASES[code] ?? code; }

export function applyAvailabilitySnapshot(slate: ValidatedSlate, snapshot: AvailabilitySnapshot): ValidatedSlate {
  const byKey = new Map<string, AvailabilityRecord[]>();
  for (const record of snapshot.records) { const key = identityKey(record.playerName, record.team); byKey.set(key, [...(byKey.get(key) ?? []), record]); }
  const warnings = [...slate.validation.warnings];
  const playerPool = slate.playerPool.map((player) => {
    const records = byKey.get(identityKey(player.playerName, player.team)) ?? [];
    if (records.length !== 1) return { ...player, availability: { status: 'UNKNOWN' as const, confirmed: false, source: snapshot.source, retrievedAt: snapshot.retrievedAt, mappedBy: 'UNMAPPED' as const, note: records.length > 1 ? 'Provider identity match was ambiguous.' : snapshot.note ?? 'Provider returned no exact name/team match.' } };
    const record = records[0];
    return { ...player, availability: { status: record.status, confirmed: record.confirmed, source: snapshot.source, retrievedAt: snapshot.retrievedAt, providerPlayerId: record.providerPlayerId, mappedBy: 'NAME_AND_TEAM' as const, note: record.note ?? (record.battingOrder ? `Batting order ${record.battingOrder}.` : undefined) } };
  });
  const removed = playerPool.filter((player) => player.availability?.status === 'OUT' || player.availability?.status === 'INACTIVE').length;
  const filtered = slate.sport === 'MLB' && snapshot.confirmedLineupAvailable ? playerPool.filter((player) => ['CONFIRMED_STARTER', 'ACTIVE'].includes(player.availability?.status ?? '')) : playerPool;
  if (removed) warnings.push(`${removed} DraftKings player(s) removed after an explicit ${snapshot.source} OUT/INACTIVE status.`);
  warnings.push(snapshot.confirmedLineupAvailable ? `${snapshot.source} confirmed lineup state applied at ${snapshot.retrievedAt}.` : `${snapshot.source} did not provide a confirmed pregame lineup; unconfirmed players remain labeled UNKNOWN.`);
  return { ...slate, playerPool: filtered, validation: { ...slate.validation, warnings } };
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
    const inactive = /inactive|out|scratched|doubtful/i.test(state); const battingOrder = readNumber(row, ['BattingOrder', 'battingOrder']);
    const status: AvailabilityRecord['status'] = inactive ? (/(out|scratched|doubtful)/i.test(state) ? 'OUT' : 'INACTIVE') : sport === 'MLB' && confirmed && battingOrder !== undefined ? 'CONFIRMED_STARTER' : confirmed && starting ? 'ACTIVE' : available === false ? 'INACTIVE' : 'PROJECTED';
    return [{ playerName, team, providerPlayerId: readString(row, ['PlayerID', 'PlayerId', 'playerId']), status, confirmed, battingOrder, updatedAt: readString(row, ['Updated', 'DateTime', 'updatedAt']) }];
  });
  return { source: 'SPORTSDATAIO', retrievedAt, records, confirmedLineupAvailable: sport === 'MLB' && records.some((record) => record.confirmed && record.battingOrder !== undefined) };
}
function extractProviderPlayerRows(payload: unknown): unknown[] { if (!Array.isArray(payload)) return []; return payload.flatMap((game) => { const row = asRecord(game); if (!row) return []; return ['HomeBattingLineup', 'AwayBattingLineup'].flatMap((key) => Array.isArray(row[key]) ? row[key] : []).concat(['HomeStartingPitcher', 'AwayStartingPitcher'].flatMap((key) => row[key] && typeof row[key] === 'object' ? [row[key]] : [])); }); }
function identityKey(name: string, team?: string): string { return `${normalizeProviderName(name)}|${normalizeTeamCode(team)}`; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function fullName(record: Record<string, unknown>): string | undefined { const first = readString(record, ['FirstName', 'firstName']); const last = readString(record, ['LastName', 'lastName']); return first && last ? `${first} ${last}` : first ?? last; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readBoolean(record: Record<string, unknown>, keys: string[]): boolean { for (const key of keys) { if (typeof record[key] === 'boolean') return record[key] as boolean; if (record[key] === 1 || record[key] === '1' || String(record[key]).toLowerCase() === 'true') return true; } return false; }
function readOptionalBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'boolean') return value; if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true; if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false; } return undefined; }
