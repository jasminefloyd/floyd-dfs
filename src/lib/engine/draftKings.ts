import type { ContestFormat, Sport } from './contracts.js';

export const DRAFTKINGS_API_BASE_URL = 'https://api.draftkings.com';
export const DRAFTKINGS_LOBBY_BASE_URL = 'https://www.draftkings.com';
export const DEFAULT_DRAFTKINGS_API_ENDPOINTS = { sports: '/sites/US-DK/sports/v1/sports', contests: '/lobby/getcontests', contest: '/contests/v1/contests/{contestId}', draftGroup: '/draftgroups/v1/{draftGroupId}', gameTypeRules: '/lineups/v1/gametypes/{gameTypeId}/rules', draftables: '/draftgroups/v1/draftgroups/{draftGroupId}/draftables', availablePlayersCsv: '/lineup/getavailableplayerscsv' } as const;
// The public lobby endpoint used by /api/slates accepts the sport abbreviations as its
// `sport` query values. Keep this fallback shared by discovery and generation so a missing
// deployment override cannot make a sport selectable but impossible to generate.
export const DEFAULT_DRAFTKINGS_SPORT_CODES: Record<Sport, string> = { WNBA: 'WNBA', NBA: 'NBA', MLB: 'MLB', GOLF: 'GOLF', NFL: 'NFL', CFB: 'CFB' };

export interface DraftKingsContestSummary { draftKingsContestId: string; draftGroupId?: string; sport: Sport; format: ContestFormat; name: string; lockTime: string; contestSize?: number; currentEntries?: number; maxEntriesAllowed?: number; }
export interface DraftKingsGameGroup { draftGroupId: string; matchupLabel: string; gameCount?: number; }
export interface DraftKingsSportSummary { sportId: number; fullName: string; abbreviatedName: string; hasPublicContests: boolean; isEnabled: boolean; }
export interface DraftKingsHttpResponse<T = unknown> { data: T; url: string; retrievedAt: string; status: number; }
export interface DraftKingsApiBundle { contest: DraftKingsHttpResponse; draftGroup: DraftKingsHttpResponse; gameTypeRules: DraftKingsHttpResponse; draftables: DraftKingsHttpResponse; contestIdentityVerified?: boolean; }
export interface DraftKingsContestReference { contestId: string; draftGroupId: string; gameTypeId: string; }
export interface DraftKingsClientOptions { fetcher?: typeof fetch; apiBaseUrl?: string; lobbyBaseUrl?: string; sportCodes: Partial<Record<Sport, string>>; headers?: Record<string, string>; }

export class DraftKingsApiError extends Error { readonly details: { url: string; status?: number; body?: unknown }; constructor(message: string, details: { url: string; status?: number; body?: unknown }) { super(message); this.name = 'DraftKingsApiError'; this.details = details; } }

export class DraftKingsClient {
  private readonly fetcher: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly lobbyBaseUrl: string;
  private readonly sportCodes: DraftKingsClientOptions['sportCodes'];
  private readonly headers: Record<string, string>;
  constructor(options: DraftKingsClientOptions) { this.fetcher = options.fetcher ?? fetch; this.apiBaseUrl = (options.apiBaseUrl ?? DRAFTKINGS_API_BASE_URL).replace(/\/+$/, ''); this.lobbyBaseUrl = (options.lobbyBaseUrl ?? DRAFTKINGS_LOBBY_BASE_URL).replace(/\/+$/, ''); this.sportCodes = { ...DEFAULT_DRAFTKINGS_SPORT_CODES, ...options.sportCodes }; this.headers = { accept: 'application/json', ...options.headers }; }
  async listSports(): Promise<DraftKingsSportSummary[]> { const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.sports, this.apiBaseUrl, { format: 'json' }); const sports = asRecord(response.data)?.sports; if (!Array.isArray(sports)) throw new DraftKingsApiError('DraftKings sports response did not contain a sports array.', { url: response.url, body: response.data }); return sports.map((value) => { const sport = asRecord(value); if (!sport) throw new DraftKingsApiError('DraftKings sports response contained an invalid sport record.', { url: response.url, body: value }); return { sportId: Number(sport.sportId), fullName: String(sport.fullName ?? ''), abbreviatedName: String(sport.regionAbbreviatedSportName ?? ''), hasPublicContests: Boolean(sport.hasPublicContests), isEnabled: Boolean(sport.isEnabled) }; }); }
  async listContests(sport: Sport): Promise<DraftKingsContestSummary[]> { const sportCode = this.sportCodes[sport]; if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl }); const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode }); return extractContestSummaries(response.data, sport); }
  async listContestsAndGroups(sport: Sport, format: ContestFormat): Promise<{ contests: DraftKingsContestSummary[]; groups: DraftKingsGameGroup[] }> { const sportCode = this.sportCodes[sport]; if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl }); const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode }); return { contests: extractContestSummaries(response.data, sport), groups: extractGameGroups(response.data, sport, format) }; }
  async getContest(contestId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contest.replace('{contestId}', encodeURIComponent(contestId)), this.apiBaseUrl, { format: 'json' }); }
  async getDraftGroup(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftGroup.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  async getGameTypeRules(gameTypeId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.gameTypeRules.replace('{gameTypeId}', encodeURIComponent(gameTypeId)), this.apiBaseUrl); }
  async getDraftables(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftables.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  private async getAvailablePlayersCsv(draftGroupId: string): Promise<DraftKingsHttpResponse<string>> { const url = new URL(DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv, `${this.lobbyBaseUrl}/`); url.searchParams.set('draftGroupId', draftGroupId); const response = await this.fetcher(url, { headers: { accept: 'text/csv, text/plain;q=0.9, */*;q=0.8' } }); const data = await response.text(); if (!response.ok) throw new DraftKingsApiError(`DraftKings salary CSV request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status, body: data.slice(0, 500) }); return { data, url: url.toString(), retrievedAt: new Date().toISOString(), status: 200 }; }
  async getSlateBundleForDraftGroup(input: { contestId: string; draftGroupId: string; sport: Sport; format: ContestFormat; gameTypeId?: string; contestName?: string; contestLockTime?: string; contestSize?: number; maxEntriesAllowed?: number }): Promise<DraftKingsApiBundle & { reference: DraftKingsContestReference }> {
    if (!input.draftGroupId.trim()) throw new DraftKingsApiError('DraftKings draftGroupId is required.', { url: this.lobbyBaseUrl });
    const sportCode = this.sportCodes[input.sport];
    if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${input.sport}.`, { url: this.lobbyBaseUrl });
    // Bind contest, sport, format and group using the live public lobby before trying
    // endpoints that may be blocked for server-side requests.
    const lobbyResponse = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode });
    const lobbyContest = extractContestSummaries(lobbyResponse.data, input.sport).find((contest) => contest.draftKingsContestId === input.contestId);
    if (!lobbyContest) throw new DraftKingsApiError(`Contest ${input.contestId} was not found in the current DraftKings ${input.sport} lobby.`, { url: lobbyResponse.url, body: lobbyResponse.data });
    if (lobbyContest.format !== input.format) throw new DraftKingsApiError(`Contest ${input.contestId} is ${lobbyContest.format}, not the requested ${input.format} format.`, { url: lobbyResponse.url, body: lobbyResponse.data });
    if (!lobbyContest.draftGroupId || lobbyContest.draftGroupId !== input.draftGroupId) throw new DraftKingsApiError(`Contest ${input.contestId} is not bound to requested draft group ${input.draftGroupId}.`, { url: lobbyResponse.url, body: lobbyResponse.data });
    try {
      const draftGroup = await this.getDraftGroup(input.draftGroupId);
      const group = unwrapRecord(draftGroup.data, ['draftGroup']);
      const groupId = readStringOrNumber(group, ['draftGroupId', 'DraftGroupId']);
      if (groupId && groupId !== lobbyContest.draftGroupId) throw new DraftKingsApiError(`DraftKings draft-group response identity ${groupId} does not match lobby group ${lobbyContest.draftGroupId}.`, { url: draftGroup.url, body: draftGroup.data });
      const gameTypeId = readStringOrNumber(group, ['gameTypeId', 'gameTypeID']) ?? readStringOrNumber(asRecord(group.contestType) ?? {}, ['gameTypeId', 'gameTypeID']);
      if (!gameTypeId) throw new DraftKingsApiError(`DraftKings draft group ${input.draftGroupId} did not include a gameTypeId.`, { url: draftGroup.url, body: draftGroup.data });
      if (input.gameTypeId && input.gameTypeId !== gameTypeId) throw new DraftKingsApiError(`Requested gameTypeId ${input.gameTypeId} does not match DraftKings group gameTypeId ${gameTypeId}.`, { url: draftGroup.url, body: draftGroup.data });
      const reference = { contestId: input.contestId, draftGroupId: input.draftGroupId, gameTypeId };
      const [gameTypeRules, draftables] = await Promise.all([this.getGameTypeRules(reference.gameTypeId), this.getDraftables(reference.draftGroupId)]);
      const contest = { data: { contest: { contestId: lobbyContest.draftKingsContestId, name: lobbyContest.name, lockTime: lobbyContest.lockTime, draftGroupId: lobbyContest.draftGroupId, gameTypeId, contestSize: lobbyContest.contestSize, maximumEntries: lobbyContest.contestSize, maxEntriesAllowed: lobbyContest.maxEntriesAllowed } }, url: lobbyResponse.url, retrievedAt: lobbyResponse.retrievedAt, status: lobbyResponse.status };
      return { contest, draftGroup, gameTypeRules, draftables, contestIdentityVerified: true, reference };
    } catch (error) {
      if (!(error instanceof DraftKingsApiError) || error.details.status !== 403) throw error;
      const csv = await this.getAvailablePlayersCsv(input.draftGroupId);
      const players = mapAvailablePlayersCsv(csv.data, input.sport, input.format);
      if (!players.length) throw new DraftKingsApiError(`DraftKings salary CSV contained no players for draft group ${input.draftGroupId}.`, { url: csv.url, body: csv.data.slice(0, 500) });
      const rules = fallbackRules(input.sport, input.format);
      if (rules.profileVerified !== true) throw new DraftKingsApiError(`No reviewed DraftKings ${input.sport} ${input.format} rule profile is available for the public salary feed.`, { url: csv.url });
      const gameTypeId = input.gameTypeId ?? `published-${input.sport.toLowerCase()}-${input.format.toLowerCase()}`;
      const response = (data: unknown): DraftKingsHttpResponse => ({ data, url: csv.url, retrievedAt: csv.retrievedAt, status: 200 });
      const group = { draftGroupId: input.draftGroupId, name: lobbyContest.name, eventDate: lobbyContest.lockTime, startTime: lobbyContest.lockTime };
      const contest = { contestId: lobbyContest.draftKingsContestId, name: lobbyContest.name, lockTime: lobbyContest.lockTime, draftGroupId: lobbyContest.draftGroupId, gameTypeId, maximumEntries: lobbyContest.contestSize ?? input.contestSize, contestSize: lobbyContest.contestSize ?? input.contestSize, maxEntriesAllowed: lobbyContest.maxEntriesAllowed ?? input.maxEntriesAllowed };
      return { reference: { contestId: input.contestId, draftGroupId: input.draftGroupId, gameTypeId }, contest: response({ contest }), draftGroup: response({ draftGroup: group }), gameTypeRules: response({ gameTypeRules: rules }), draftables: response({ draftables: players }), contestIdentityVerified: true };
    }
  }
  async getSlateBundleForContest(input: { contestId: string; draftGroupId?: string; gameTypeId?: string }): Promise<DraftKingsApiBundle & { reference: DraftKingsContestReference }> { const contest = await this.getContest(input.contestId); const discovered = extractContestReference(contest.data, input.contestId); if (input.draftGroupId && input.draftGroupId !== discovered.draftGroupId) throw new DraftKingsApiError('Requested draft group does not match the contest metadata.', { url: contest.url, body: contest.data }); if (input.gameTypeId && input.gameTypeId !== discovered.gameTypeId) throw new DraftKingsApiError('Requested game type does not match the contest metadata.', { url: contest.url, body: contest.data }); const reference = discovered; const [draftGroup, gameTypeRules, draftables] = await Promise.all([this.getDraftGroup(reference.draftGroupId), this.getGameTypeRules(reference.gameTypeId), this.getDraftables(reference.draftGroupId)]); const group = unwrapRecord(draftGroup.data, ['draftGroup']); const groupGameType = readStringOrNumber(group, ['gameTypeId', 'gameTypeID']); if (groupGameType && groupGameType !== reference.gameTypeId) throw new DraftKingsApiError('Contest and draft-group game types do not match.', { url: draftGroup.url, body: draftGroup.data }); return { contest, draftGroup, gameTypeRules, draftables, contestIdentityVerified: true, reference }; }
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
    const draftGroupId = readNumber(contest, ['dg', 'draftGroupId']);
    return [{ draftKingsContestId: contestId, draftGroupId: draftGroupId !== undefined ? String(draftGroupId) : undefined, sport, format, name: readRequiredString(contest, ['name', 'contestName', 'ContestName', 'n'], `contests[${index}].name`), lockTime: readDateString(contest, ['lockTime', 'startTime', 'startDate', 'sd'], `contests[${index}].lockTime`), contestSize: readNumber(contest, ['maximumEntries', 'maximum_entries', 'contestSize', 'totalEntries']), currentEntries: readNumber(contest, ['entries', 'entryCount', 'ec']), maxEntriesAllowed: readNumber(contest, ['maxEntriesAllowed', 'maximumEntriesPerUser', 'maximum_entries_per_user', 'mec']) }];
  });
}

// DraftKings' lobby response separately carries a `DraftGroups` array (one entry per underlying
// game/draft group, with a ready-made matchup label) alongside the flat `Contests` array (one
// entry per contest -- many contests can share one game). `DraftGroups[].GameType` is often null,
// so group membership is derived from which draft group IDs actually appear among contests that
// already passed the same sport/format matching used by extractContestSummaries, rather than
// trusting a possibly-absent field on the group itself.
export function extractGameGroups(payload: unknown, sport: Sport, format: ContestFormat): DraftKingsGameGroup[] {
  const root = asRecord(payload);
  const contests = root && (Array.isArray(root.Contests) ? root.Contests : Array.isArray(root.contests) ? root.contests : undefined);
  const groups = root && (Array.isArray(root.DraftGroups) ? root.DraftGroups : Array.isArray(root.draftGroups) ? root.draftGroups : undefined);
  if (!contests || !groups) return [];
  const matchingDraftGroupIds = new Set(contests.flatMap((value) => {
    const contest = asRecord(value);
    if (!contest || !contestMatchesSport(contest, sport)) return [];
    const formatValue = readString(contest, ['format', 'contestFormat', 'gameTypeName', 'gameType'], 'CLASSIC');
    if (parseContestFormat(formatValue) !== format) return [];
    const draftGroupId = readNumber(contest, ['dg', 'draftGroupId']);
    return draftGroupId !== undefined ? [String(draftGroupId)] : [];
  }));
  const byId = new Map<string, DraftKingsGameGroup>();
  for (const value of groups) {
    const group = asRecord(value);
    if (!group) continue;
    const draftGroupId = readNumber(group, ['DraftGroupId', 'draftGroupId']);
    if (draftGroupId === undefined || !matchingDraftGroupIds.has(String(draftGroupId))) continue;
    const suffix = readOptionalString(group, ['ContestStartTimeSuffix']);
    const matchupLabel = suffix ? suffix.replace(/^[\s(]+|[\s)]+$/g, '').trim() : readOptionalString(group, ['DraftGroupTag']) ?? `Group ${draftGroupId}`;
    byId.set(String(draftGroupId), { draftGroupId: String(draftGroupId), matchupLabel, gameCount: readNumber(group, ['GameCount']) });
  }
  return [...byId.values()];
}
export function extractContestReference(payload: unknown, contestId: string): DraftKingsContestReference { const root = asRecord(payload); const contest = root ? asRecord(root.contest) ?? asRecord(root.Contest) ?? asRecord(root.contestDetail) ?? asRecord(root.ContestDetail) ?? root : undefined; if (!contest) throw new DraftKingsApiError('DraftKings contest response was not a JSON object.', { url: 'contest', body: payload }); return { contestId, draftGroupId: readRequiredString(contest, ['draftGroupId', 'draftGroupID', 'draftGroup', 'dg'], 'draftGroupId'), gameTypeId: readRequiredString(contest, ['gameTypeId', 'gameTypeID', 'gameType', 'gt'], 'gameTypeId') }; }
function fallbackRules(sport: Sport, format: ContestFormat): Record<string, unknown> {
  const verified = { sourceFallback: true, profileVerified: true, ruleProfileVersion: 'DK_PUBLISHED_SALARY_CAP_RULES_2026-10-01', salaryCap: { maxValue: 50_000 } };
  if (format === 'SHOWDOWN' && sport !== 'GOLF') return { ...verified, rosterRules: { rosterSize: 6, captainMultiplier: 1.5, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } } };
  const slots: Record<Sport, Record<string, number>> = {
    MLB: { P: 2, C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3 },
    NFL: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DST: 1 },
    CFB: { QB: 1, RB: 2, WR: 3, FLEX: 1, SFLEX: 1 },
    NBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
    WNBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
    GOLF: { G: 6 },
  };
  if (sport === 'GOLF' && format === 'SHOWDOWN') return { sourceFallback: true, profileVerified: false, salaryCap: { maxValue: 50_000 }, rosterRules: { rosterSize: 6, slots: { G: { count: 6 } }, uniquePlayersRequired: true } };
  return { ...verified, rosterRules: { rosterSize: Object.values(slots[sport]).reduce((sum, count) => sum + count, 0), slots: Object.fromEntries(Object.entries(slots[sport]).map(([name, count]) => [name, { count }])), uniquePlayersRequired: true } };
}
function mapAvailablePlayersCsv(csv: string, sport: Sport, format: ContestFormat): Array<Record<string, unknown>> {
  const [header = [], ...rows] = parseCsvRecords(csv.replace(/^\uFEFF/, ''));
  const indexes = new Map(header.map((value, index) => [value.trim().toLowerCase(), index]));
  for (const required of ['id', 'name', 'salary']) if (!indexes.has(required)) throw new DraftKingsApiError(`DraftKings salary CSV is missing the required ${required} column.`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
  const value = (row: string[], column: string): string => row[indexes.get(column.toLowerCase()) ?? -1]?.trim() ?? '';
  const players = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = value(row, 'id'); const name = value(row, 'name'); const salary = Number(value(row, 'salary'));
    if (!id || !name || !Number.isFinite(salary) || salary <= 0) continue;
    const position = value(row, 'position'); const rosterPosition = value(row, 'roster position');
    const game = value(row, 'game info').match(/([A-Z0-9]+)@([A-Z0-9]+)/i);
    const team = value(row, 'teamabbrev');
    const opponent = game ? (game[1].toUpperCase() === team.toUpperCase() ? game[2] : game[1]) : undefined;
    const fppgText = value(row, 'avgpointspergame'); const fppg = fppgText ? Number(fppgText) : NaN;
    const status = value(row, 'status');
    const normalizedSlots = rosterPosition.replaceAll('S-FLEX', 'SFLEX').replaceAll('/', ' ').split(/[|,\s]+/).filter(Boolean);
    const captainRow = normalizedSlots.some((slot) => ['CPT', 'CAPTAIN', 'MVP'].includes(slot.toUpperCase()));
    const key = `${name.trim().toLowerCase()}|${(team || '').toUpperCase()}|${position.toUpperCase()}`;
    const player = players.get(key) ?? { draftableId: id, displayName: name, position, eligibility: [], salary, utilitySalary: salary, team, opponent, status: status || 'None', providerFppg: Number.isFinite(fppg) ? fppg : undefined, sport };
    const eligible = new Set([...(player.eligibility as string[]), ...normalizedSlots]);
    if (captainRow) { eligible.add('CPT'); eligible.add('UTIL'); player.captainSalary = salary; }
    if (normalizedSlots.some((slot) => ['UTIL', 'FLEX'].includes(slot.toUpperCase()))) eligible.add('UTIL');
    if (sport === 'GOLF') eligible.add('G');
    player.eligibility = [...eligible];
    if (!captainRow) { player.draftableId = id; player.salary = salary; player.utilitySalary = salary; }
    if (!player.team && team) player.team = team;
    if (!player.opponent && opponent) player.opponent = opponent;
    if (player.providerFppg === undefined && Number.isFinite(fppg)) player.providerFppg = fppg;
    players.set(key, player);
  }
  const result = [...players.values()];
  if (format === 'SHOWDOWN' && sport !== 'GOLF') {
    const invalidMultipliers = result.filter((player) => {
      const utilitySalary = Number(player.utilitySalary);
      const captainSalary = Number(player.captainSalary);
      return !Number.isFinite(utilitySalary) || utilitySalary <= 0 || !Number.isFinite(captainSalary) || Math.abs(captainSalary / utilitySalary - 1.5) > 0.01;
    });
    if (invalidMultipliers.length) throw new DraftKingsApiError(`DraftKings salary CSV did not provide a consistent 1.5x Captain salary for ${invalidMultipliers.length} ${sport} Showdown player(s).`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
  }
  return result;
}
function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"' && quoted && csv[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && csv[index + 1] === '\n') index += 1; row.push(field); if (row.some((item) => item.trim())) records.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  return records;
}
function parseContestFormat(value: string): ContestFormat | undefined { const normalized = value.toUpperCase(); if (normalized.includes('SHOWDOWN') || normalized.includes('CAPTAIN') || normalized.includes('MVP')) return 'SHOWDOWN'; if (normalized.includes('CLASSIC')) return 'CLASSIC'; return undefined; }
function contestMatchesSport(contest: Record<string, unknown>, sport: Sport): boolean {
  const name = readString(contest, ['name', 'contestName', 'ContestName', 'n'], '').toUpperCase();
  if (sport === 'NBA' && /(^|[^A-Z])WNBA([^A-Z]|$)/.test(name)) return false;
  // DraftKings Golf contests often use the tournament name (for example, "DP World
  // Tour") and do not include the words Golf or PGA in the contest name. The lobby
  // response supplies the authoritative numeric sport id (`s: 13`) instead.
  if (sport === 'GOLF' && readNumber(contest, ['s', 'sportId', 'SportId']) === 13) return true;
  const aliases: Record<Sport, RegExp> = {
    WNBA: /(^|[^A-Z])WNBA([^A-Z]|$)/,
    NBA: /(^|[^A-Z])NBA([^A-Z]|$)/,
    MLB: /(^|[^A-Z])MLB([^A-Z]|$)/,
    NFL: /(^|[^A-Z])NFL([^A-Z]|$)/,
    CFB: /(^|[^A-Z])(CFB|NCAAF|NCAA|COLLEGE[ -]?FOOTBALL)([^A-Z]|$)/,
    GOLF: /(^|[^A-Z])(GOLF|PGA)([^A-Z]|$)/,
  };
  return aliases[sport].test(name);
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function unwrapRecord(value: unknown, keys: string[]): Record<string, unknown> { let record = asRecord(value) ?? {}; for (const key of keys) { const nested = asRecord(record[key]); if (nested) { record = nested; break; } } return record; }
function readStringOrNumber(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); } return undefined; }
function readString(record: Record<string, unknown>, keys: string[], fallback?: string): string { return readOptionalString(record, keys) ?? fallback ?? (() => { throw new DraftKingsApiError(`Missing required field: ${keys.join(' / ')}.`, { url: 'lobby' }); })(); }
function readRequiredString(record: Record<string, unknown>, keys: string[], field: string): string { return readOptionalString(record, keys) ?? readNumber(record, keys)?.toString() ?? (() => { throw new DraftKingsApiError(`Missing required field: ${field}.`, { url: 'lobby' }); })(); }
function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readDateString(record: Record<string, unknown>, keys: string[], field: string): string { const value = readOptionalString(record, keys); const parsed = value ? parseDraftKingsDateValue(value) : undefined; if (parsed) return parsed; throw new DraftKingsApiError(`Missing required date field: ${field}.`, { url: 'lobby' }); }
export function parseDraftKingsDateValue(value: string): string | undefined { const dotNet = value.match(/^\/Date\((\d+)\)\/$/); const parsed = new Date(dotNet ? Number(dotNet[1]) : value); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString(); }
