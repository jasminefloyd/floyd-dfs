import type { ContestFormat, Sport } from './contracts.js';

export const DRAFTKINGS_API_BASE_URL = 'https://api.draftkings.com';
export const DRAFTKINGS_LOBBY_BASE_URL = 'https://www.draftkings.com';
export const DEFAULT_DRAFTKINGS_API_ENDPOINTS = { sports: '/sites/US-DK/sports/v1/sports', contests: '/lobby/getcontests', contest: '/contests/v1/contests/{contestId}', draftGroup: '/draftgroups/v1/{draftGroupId}', gameTypeRules: '/lineups/v1/gametypes/{gameTypeId}/rules', draftables: '/draftgroups/v1/draftgroups/{draftGroupId}/draftables' } as const;

export interface DraftKingsContestSummary { draftKingsContestId: string; sport: Sport; format: ContestFormat; name: string; lockTime: string; contestSize?: number; maxEntriesAllowed?: number; }
export interface DraftKingsSportSummary { sportId: number; fullName: string; abbreviatedName: string; hasPublicContests: boolean; isEnabled: boolean; }
export interface DraftKingsHttpResponse<T = unknown> { data: T; url: string; retrievedAt: string; status: number; }
export interface DraftKingsApiBundle { contest: DraftKingsHttpResponse; draftGroup: DraftKingsHttpResponse; gameTypeRules: DraftKingsHttpResponse; draftables: DraftKingsHttpResponse; }
export interface DraftKingsContestReference { contestId: string; draftGroupId: string; gameTypeId: string; }
export interface DraftKingsClientOptions { fetcher?: typeof fetch; apiBaseUrl?: string; lobbyBaseUrl?: string; sportCodes: Partial<Record<Sport, string>>; headers?: Record<string, string>; }

export class DraftKingsApiError extends Error { readonly details: { url: string; status?: number; body?: unknown }; constructor(message: string, details: { url: string; status?: number; body?: unknown }) { super(message); this.name = 'DraftKingsApiError'; this.details = details; } }

export class DraftKingsClient {
  private readonly fetcher: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly lobbyBaseUrl: string;
  private readonly sportCodes: DraftKingsClientOptions['sportCodes'];
  private readonly headers: Record<string, string>;
  constructor(options: DraftKingsClientOptions) { this.fetcher = options.fetcher ?? fetch; this.apiBaseUrl = (options.apiBaseUrl ?? DRAFTKINGS_API_BASE_URL).replace(/\/+$/, ''); this.lobbyBaseUrl = (options.lobbyBaseUrl ?? DRAFTKINGS_LOBBY_BASE_URL).replace(/\/+$/, ''); this.sportCodes = options.sportCodes; this.headers = { accept: 'application/json', ...options.headers }; }
  async listSports(): Promise<DraftKingsSportSummary[]> { const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.sports, this.apiBaseUrl, { format: 'json' }); const sports = asRecord(response.data)?.sports; if (!Array.isArray(sports)) throw new DraftKingsApiError('DraftKings sports response did not contain a sports array.', { url: response.url, body: response.data }); return sports.map((value) => { const sport = asRecord(value); if (!sport) throw new DraftKingsApiError('DraftKings sports response contained an invalid sport record.', { url: response.url, body: value }); return { sportId: Number(sport.sportId), fullName: String(sport.fullName ?? ''), abbreviatedName: String(sport.regionAbbreviatedSportName ?? ''), hasPublicContests: Boolean(sport.hasPublicContests), isEnabled: Boolean(sport.isEnabled) }; }); }
  async listContests(sport: Sport): Promise<DraftKingsContestSummary[]> { const sportCode = this.sportCodes[sport]; if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl }); const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode }); return extractContestSummaries(response.data, sport); }
  async getContest(contestId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contest.replace('{contestId}', encodeURIComponent(contestId)), this.apiBaseUrl, { format: 'json' }); }
  async getDraftGroup(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftGroup.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  async getGameTypeRules(gameTypeId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.gameTypeRules.replace('{gameTypeId}', encodeURIComponent(gameTypeId)), this.apiBaseUrl); }
  async getDraftables(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftables.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  async getSlateBundleForContest(input: { contestId: string; draftGroupId?: string; gameTypeId?: string }): Promise<DraftKingsApiBundle & { reference: DraftKingsContestReference }> { const contest = await this.getContest(input.contestId); const discovered = extractContestReference(contest.data, input.contestId); const reference = { ...discovered, draftGroupId: input.draftGroupId ?? discovered.draftGroupId, gameTypeId: input.gameTypeId ?? discovered.gameTypeId }; const [draftGroup, gameTypeRules, draftables] = await Promise.all([this.getDraftGroup(reference.draftGroupId), this.getGameTypeRules(reference.gameTypeId), this.getDraftables(reference.draftGroupId)]); return { contest, draftGroup, gameTypeRules, draftables, reference }; }
  private async get(path: string, baseUrl: string, query?: Record<string, string>): Promise<DraftKingsHttpResponse> { const url = new URL(path, `${baseUrl}/`); for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value); const response = await this.fetcher(url, { headers: this.headers }); const text = await response.text(); let body: unknown = null; if (text) { try { body = JSON.parse(text); } catch { body = text; } } if (!response.ok) throw new DraftKingsApiError(`DraftKings request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status, body }); return { data: body, url: url.toString(), retrievedAt: new Date().toISOString(), status: response.status }; }
}

export function extractContestSummaries(payload: unknown, sport: Sport): DraftKingsContestSummary[] {
  const root = asRecord(payload);
  const contests = root && (Array.isArray(root.Contests) ? root.Contests : Array.isArray(root.contests) ? root.contests : undefined);
  if (!contests) throw new DraftKingsApiError('DraftKings contest discovery response did not contain a Contests array.', { url: 'lobby' });
  return contests.flatMap((value, index) => {
    const contest = asRecord(value);
    if (!contest) return [];
    if (!contestMatchesSport(contest, sport)) return [];
    const formatValue = readString(contest, ['format', 'contestFormat', 'gameTypeName', 'gameType'], 'CLASSIC');
    const format = parseContestFormat(formatValue);
    if (!format) return [];
    const contestId = readRequiredString(contest, ['contestId', 'contestID', 'id', 'ContestId'], `contests[${index}].contestId`);
    return [{ draftKingsContestId: contestId, sport, format, name: readRequiredString(contest, ['name', 'contestName', 'ContestName', 'n'], `contests[${index}].name`), lockTime: readDateString(contest, ['lockTime', 'startTime', 'startDate', 'sd'], `contests[${index}].lockTime`), contestSize: readNumber(contest, ['contestSize', 'totalEntries', 'entryCount', 'ec', 'cs']), maxEntriesAllowed: readNumber(contest, ['maxEntriesAllowed', 'maxEntries', 'maximumEntries', 'mec']) }];
  });
}
export function extractContestReference(payload: unknown, contestId: string): DraftKingsContestReference { const root = asRecord(payload); const contest = root ? asRecord(root.contest) ?? asRecord(root.Contest) ?? asRecord(root.contestDetail) ?? asRecord(root.ContestDetail) ?? root : undefined; if (!contest) throw new DraftKingsApiError('DraftKings contest response was not a JSON object.', { url: 'contest', body: payload }); return { contestId, draftGroupId: readRequiredString(contest, ['draftGroupId', 'draftGroupID', 'draftGroup', 'dg'], 'draftGroupId'), gameTypeId: readRequiredString(contest, ['gameTypeId', 'gameTypeID', 'gameType', 'gt'], 'gameTypeId') }; }
function parseContestFormat(value: string): ContestFormat | undefined { const normalized = value.toUpperCase(); if (normalized.includes('SHOWDOWN') || normalized.includes('CAPTAIN') || normalized.includes('MVP')) return 'SHOWDOWN'; if (normalized.includes('CLASSIC')) return 'CLASSIC'; return undefined; }
function contestMatchesSport(contest: Record<string, unknown>, sport: Sport): boolean {
  const name = readString(contest, ['name', 'contestName', 'ContestName', 'n'], '').toUpperCase();
  if (sport === 'NBA' && /(^|[^A-Z])WNBA([^A-Z]|$)/.test(name)) return false;
  const aliases: Record<Sport, RegExp> = {
    WNBA: /(^|[^A-Z])WNBA([^A-Z]|$)/,
    NBA: /(^|[^A-Z])NBA([^A-Z]|$)/,
    MLB: /(^|[^A-Z])MLB([^A-Z]|$)/,
    NFL: /(^|[^A-Z])NFL([^A-Z]|$)/,
    GOLF: /(^|[^A-Z])(GOLF|PGA)([^A-Z]|$)/,
  };
  return aliases[sport].test(name);
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[], fallback?: string): string { return readOptionalString(record, keys) ?? fallback ?? (() => { throw new DraftKingsApiError(`Missing required field: ${keys.join(' / ')}.`, { url: 'lobby' }); })(); }
function readRequiredString(record: Record<string, unknown>, keys: string[], field: string): string { return readOptionalString(record, keys) ?? readNumber(record, keys)?.toString() ?? (() => { throw new DraftKingsApiError(`Missing required field: ${field}.`, { url: 'lobby' }); })(); }
function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readDateString(record: Record<string, unknown>, keys: string[], field: string): string { const value = readOptionalString(record, keys); if (value) { const dotNet = value.match(/^\/Date\((\d+)\)\/$/); const parsed = new Date(dotNet ? Number(dotNet[1]) : value); if (!Number.isNaN(parsed.getTime())) return parsed.toISOString(); } throw new DraftKingsApiError(`Missing required date field: ${field}.`, { url: 'lobby' }); }
