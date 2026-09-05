import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, Sport, ValidatedSlate } from './contracts.js';
import { normalizeTeamCode, parseAvailabilityRecords, type AvailabilitySnapshot } from './availability.js';

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
    const availability = this.options.availability?.[slate.sport];
    if (!availability) return { source: 'SPORTSDATAIO', retrievedAt: new Date().toISOString(), records: [], confirmedLineupAvailable: false, note: `${slate.sport} has no configured provider availability feed.` };
    return parseAvailabilityRecords(await this.get<unknown>(slate.sport, availability.feed, availability.resource, date, signal), slate.sport, new Date().toISOString());
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
