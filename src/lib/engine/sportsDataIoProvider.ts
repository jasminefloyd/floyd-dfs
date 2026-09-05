import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, Sport, ValidatedSlate } from './contracts.js';
import { normalizeProviderName, normalizeTeamCode, parseAvailabilityRecords, type AvailabilityRecord, type AvailabilitySnapshot } from './availability.js';

export interface SportsDataIoClientOptions { apiKey: string; baseUrl?: string; fetcher?: typeof fetch; availability?: Partial<Record<Sport, { feed: string; resource: string }>>; }

export class SportsDataIoClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly options: SportsDataIoClientOptions;
  constructor(options: SportsDataIoClientOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; this.baseUrl = (options.baseUrl ?? 'https://api.sportsdata.io/v3').replace(/\/+$/, ''); if (!options.apiKey) throw new Error('SportsDataIO API key is required.'); }
  async get<T>(sport: Sport, feed: string, resource: string, parameter?: string, signal?: AbortSignal): Promise<T> {
    const path = [this.baseUrl, sport.toLowerCase(), feed, 'json', resource, parameter].filter(Boolean).join('/');
    const response = await this.fetcher(path, { signal, headers: { accept: 'application/json', 'Ocp-Apim-Subscription-Key': this.options.apiKey } });
    if (!response.ok) { const detail = await response.text().catch(() => ''); if (response.status === 401 || response.status === 403) throw new Error(`SportsDataIO access denied for ${sport} ${feed}/${resource} (HTTP ${response.status}). Check subscription feed permissions.`); throw new Error(`SportsDataIO ${sport} ${feed}/${resource} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}.`); }
    return await response.json() as T;
  }
  async getAvailabilitySnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const date = sportsDataDate(slate);
    if (slate.sport === 'MLB') {
      const parsed = parseAvailabilityRecords(await this.get<unknown>('MLB', 'projections', 'StartingLineupsByDate', date, signal), slate.sport, new Date().toISOString());
      const slateTeams = new Set(slate.playerPool.map((player) => normalizeTeamCode(player.team)).filter(Boolean));
      const records = parsed.records.filter((record) => slateTeams.has(normalizeTeamCode(record.team)));
      const confirmedTeams = new Set(records.filter((record) => record.confirmed && record.battingOrder !== undefined).map((record) => normalizeTeamCode(record.team)).filter(Boolean));
      const confirmedLineupAvailable = slateTeams.size > 1 ? [...slateTeams].every((team) => confirmedTeams.has(team)) : records.some((record) => record.confirmed && record.battingOrder !== undefined);
      return { ...parsed, records, confirmedLineupAvailable, note: `SportsDataIO lineup records scoped to ${[...slateTeams].join('/')}.` };
    }
    if (slate.sport === 'CFB') return this.getCfbRosterSnapshot(slate, signal);
    const availability = this.options.availability?.[slate.sport];
    if (!availability) return { source: 'SPORTSDATAIO', retrievedAt: new Date().toISOString(), records: [], confirmedLineupAvailable: false, note: `${slate.sport} has no configured provider availability feed.` };
    return parseAvailabilityRecords(await this.get<unknown>(slate.sport, availability.feed, availability.resource, date, signal), slate.sport, new Date().toISOString());
  }
  private async getCfbRosterSnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const retrievedAt = new Date().toISOString();
    const slateTeams = [...new Set(slate.playerPool.map((player) => normalizeTeamCode(player.team)).filter(Boolean))];
    const teamsPayload = await this.get<unknown>('CFB', 'scores', 'Teams', undefined, signal);
    const teamRows = rowsFromPayload(teamsPayload);
    const teamKeys = new Map<string, string>();
    for (const value of teamRows) {
      const row = asRecord(value); if (!row) continue;
      const key = readString(row, ['Key', 'key']);
      if (!key) continue;
      for (const alias of [
        readString(row, ['Key', 'key']),
        readString(row, ['Abbreviation', 'abbreviation']),
        readString(row, ['ShortDisplayName', 'shortDisplayName']),
        readString(row, ['School', 'school']),
        readString(row, ['Name', 'name']),
        readString(row, ['Team', 'team']),
      ].filter((value): value is string => Boolean(value))) teamKeys.set(normalizeTeamCode(alias), key);
    }
    const records: AvailabilityRecord[] = [];
    const notes: string[] = [];
    let complete = true;
    for (const slateTeam of slateTeams) {
      const fallbackTeam = teamRows.map((value) => asRecord(value)).find((row) => row && normalizeProviderName(readString(row, ['Abbreviation', 'abbreviation']) ?? '') === normalizeProviderName(slateTeam));
      const providerKey = teamKeys.get(slateTeam) ?? (fallbackTeam ? readString(fallbackTeam, ['Key', 'key']) : undefined);
      if (typeof providerKey !== 'string' || !providerKey) { complete = false; notes.push(`SportsDataIO CFB team key was not resolved for ${slateTeam}.`); continue; }
      const payload = await this.get<unknown>('CFB', 'scores', 'PlayerDetailsByTeam', providerKey, signal);
      const rosterRows = rowsFromPayload(payload);
      if (!rosterRows.length) { complete = false; notes.push(`SportsDataIO CFB roster returned no players for ${slateTeam} (${providerKey}).`); continue; }
      for (const value of rosterRows) {
        const row = asRecord(value); if (!row) continue;
        const playerName = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']) ?? fullName(row);
        if (!playerName) continue;
        const injuryStatus = readString(row, ['InjuryStatus', 'injuryStatus', 'Status', 'status']);
        const injuryNotes = readString(row, ['InjuryNotes', 'injuryNotes', 'InjuryNote', 'injuryNote']);
        const status = /out/i.test(injuryStatus ?? '') ? 'OUT' : injuryStatus ? 'PROJECTED' : 'ACTIVE';
        records.push({ playerName, team: slateTeam, providerPlayerId: readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']), status, confirmed: false, updatedAt: retrievedAt, note: injuryStatus ? `SportsDataIO injury status: ${injuryStatus}${injuryNotes ? ` (${injuryNotes})` : ''}. CFB starter role was not provided.` : 'SportsDataIO roster membership verified; CFB starter role was not provided.' });
      }
    }
    return { source: 'SPORTSDATAIO', retrievedAt, records, confirmedLineupAvailable: false, rosterComplete: complete && slateTeams.length > 0, note: notes.length ? notes.join(' ') : `SportsDataIO CFB roster and injury records scoped to ${slateTeams.join('/')}. CFB depth charts/starting lineups are not provided by this feed.` };
  }
  /**
   * Real season-to-date box-score totals (verified live against this account -- unlike
   * `PlayerGameProjectionStatsByDate`, which returns SportsDataIO's premium/gated projection
   * product and comes back obfuscated on a free-trial key, `PlayerSeasonStats` numeric fields
   * are the account's own real, ungated stats). Used as the projection basis for MLB/NBA/NFL --
   * see projectionInputs.ts's deriveSeasonBasedInputs for how season totals become per-game rates.
   */
  async getSeasonStats(sport: Sport, seasonParam: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const payload = await this.get<unknown>(sport, 'stats', 'PlayerSeasonStats', seasonParam, signal);
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((value) => (value && typeof value === 'object' ? [value as Record<string, unknown>] : []));
  }
}

// MLB/NBA/CFB accept a bare year; NFL requires the season-type suffix ('REG' = regular season).
export function seasonParamFor(sport: Sport, eventDate: string, yearOffset = 0): string {
  const year = new Date(eventDate).getUTCFullYear() + yearOffset;
  return sport === 'NFL' ? `${year}REG` : String(year);
}

export interface SportsDataIoResearchProviderOptions { client: SportsDataIoClient; feed?: string; resource?: string; tier?: SourceTier; }
export class SportsDataIoResearchProvider implements ResearchSourceProvider {
  readonly name = 'SportsDataIO';
  readonly tier: SourceTier;
  private readonly options: SportsDataIoResearchProviderOptions;
  constructor(options: SportsDataIoResearchProviderOptions) { this.options = options; this.tier = options.tier ?? 2; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const payload = await this.options.client.get<unknown>(input.slate.sport, this.options.feed ?? 'scores', this.options.resource ?? 'GamesByDate', sportsDataDate(input.slate), input.signal);
    return (Array.isArray(payload) ? payload : []).slice(0, 20).map((row, index) => ({ title: `${input.slate.sport} schedule context ${index + 1}`, sourceName: this.name, sourceTier: this.tier, summary: summarize(row), tags: [input.slate.sport, 'sportsdataio'] }));
  }
}
function sportsDataDate(slate: ValidatedSlate): string { const date = new Date(slate.event.eventDate); if (slate.sport === 'MLB' && date.getUTCHours() < 6) date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }
function summarize(value: unknown): string { if (!value || typeof value !== 'object') return String(value ?? 'No schedule context returned.'); const row = value as Record<string, unknown>; const fields = ['Status', 'Date', 'HomeTeam', 'AwayTeam', 'HomeTeamName', 'AwayTeamName', 'VenueName', 'StadiumDetails']; const parts = fields.flatMap((field) => typeof row[field] === 'string' || typeof row[field] === 'number' ? [`${field}: ${row[field]}`] : []); return parts.join('; ') || JSON.stringify(value).slice(0, 500); }
function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['data', 'results', 'teams', 'players', 'athletes']) if (Array.isArray(record[key])) return record[key];
  return [];
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readIdentifier(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) { const value = record[key]; if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim(); } return undefined; }
function fullName(record: Record<string, unknown>): string | undefined { const first = readString(record, ['FirstName', 'firstName']); const last = readString(record, ['LastName', 'lastName']); return first && last ? `${first} ${last}` : first ?? last; }
