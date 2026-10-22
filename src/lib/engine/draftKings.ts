import type { ContestFormat, Sport } from './contracts.js';

export const DRAFTKINGS_API_BASE_URL = 'https://api.draftkings.com';
export const DRAFTKINGS_LOBBY_BASE_URL = 'https://www.draftkings.com';
export const DEFAULT_DRAFTKINGS_API_ENDPOINTS = { sports: '/sites/US-DK/sports/v1/sports', contests: '/lobby/getcontests', contest: '/contests/v1/contests/{contestId}', draftGroup: '/draftgroups/v1/{draftGroupId}', gameTypeRules: '/lineups/v1/gametypes/{gameTypeId}/rules', draftables: '/draftgroups/v1/draftgroups/{draftGroupId}/draftables', availablePlayersCsv: '/lineup/getavailableplayerscsv' } as const;
export type DraftKingsEndpointName = keyof typeof DEFAULT_DRAFTKINGS_API_ENDPOINTS;
export interface DraftKingsEndpointDefinition { routeTemplate: string; host: 'API' | 'LOBBY'; queryParameters: readonly string[]; parserVersion: string; requiredFields: readonly string[]; access: 'PUBLIC_JSON' | 'PUBLIC_CSV'; representativeFixture: string; }
export const DRAFTKINGS_ENDPOINT_REGISTRY: Record<DraftKingsEndpointName, DraftKingsEndpointDefinition> = {
  sports: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.sports, host: 'API', queryParameters: ['format'], parserVersion: 'sports.v1', requiredFields: ['sports[]'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/sports-list.json' },
  contests: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, host: 'LOBBY', queryParameters: ['sport'], parserVersion: 'lobby-contests.v1', requiredFields: ['Contests[]'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/contest-lobby.json' },
  contest: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.contest, host: 'API', queryParameters: ['format'], parserVersion: 'contest.v1', requiredFields: ['contestId', 'draftGroupId', 'gameTypeId'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/contest-detail.json' },
  draftGroup: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftGroup, host: 'API', queryParameters: [], parserVersion: 'draft-group.v1', requiredFields: ['draftGroupId', 'gameTypeId'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/draft-group.json' },
  gameTypeRules: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.gameTypeRules, host: 'API', queryParameters: [], parserVersion: 'game-rules.v1', requiredFields: ['salaryCap', 'rosterRules', 'scoringRules'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/game-type-rules.json' },
  draftables: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftables, host: 'API', queryParameters: [], parserVersion: 'draftables.v1', requiredFields: ['draftables[]'], access: 'PUBLIC_JSON', representativeFixture: 'tests/fixtures/providers/draftkings/draftables.json' },
  availablePlayersCsv: { routeTemplate: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv, host: 'LOBBY', queryParameters: ['draftGroupId'], parserVersion: 'salary-csv.v1', requiredFields: ['ID', 'Name', 'Salary'], access: 'PUBLIC_CSV', representativeFixture: 'tests/fixtures/providers/draftkings/available-players.csv' },
};
// The public lobby endpoint used by /api/slates accepts the sport abbreviations as its
// `sport` query values. Keep this fallback shared by discovery and generation so a missing
// deployment override cannot make a sport selectable but impossible to generate.
export const DEFAULT_DRAFTKINGS_SPORT_CODES: Record<Sport, string> = { WNBA: 'WNBA', NBA: 'NBA', MLB: 'MLB', GOLF: 'GOLF', NFL: 'NFL', CFB: 'CFB' };

export interface DraftKingsContestSummary { draftKingsContestId: string; draftGroupId?: string; sport: Sport; format: ContestFormat; name: string; lockTime: string; contestSize?: number; currentEntries?: number; maxEntriesAllowed?: number; }
export interface DraftKingsGameGroup { draftGroupId: string; matchupLabel: string; gameCount?: number; }
export interface DraftKingsSportSummary { sportId: number; fullName: string; abbreviatedName: string; hasPublicContests: boolean; isEnabled: boolean; }
export interface DraftKingsHttpResponse<T = unknown> { data: T; url: string; retrievedAt: string; status: number; }
export interface DraftKingsApiBundle { contest: DraftKingsHttpResponse; draftGroup: DraftKingsHttpResponse; gameTypeRules: DraftKingsHttpResponse; draftables: DraftKingsHttpResponse; contestIdentityVerified?: boolean; accessFallback?: { status: number; endpoint: string; retrievedAt: string }; }
export interface DraftKingsContestReference { contestId: string; draftGroupId: string; gameTypeId: string; }
export interface DraftKingsClientOptions { fetcher?: typeof fetch; apiBaseUrl?: string; lobbyBaseUrl?: string; sportCodes: Partial<Record<Sport, string>>; headers?: Record<string, string>; timeoutMs?: number; maxAttempts?: number; }

export class DraftKingsApiError extends Error { readonly details: { url: string; status?: number; body?: unknown }; constructor(message: string, details: { url: string; status?: number; body?: unknown }) { super(message); this.name = 'DraftKingsApiError'; this.details = details; } }

export class DraftKingsClient {
  private readonly fetcher: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly lobbyBaseUrl: string;
  private readonly sportCodes: DraftKingsClientOptions['sportCodes'];
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  constructor(options: DraftKingsClientOptions) { this.fetcher = options.fetcher ?? fetch; this.apiBaseUrl = (options.apiBaseUrl ?? DRAFTKINGS_API_BASE_URL).replace(/\/+$/, ''); this.lobbyBaseUrl = (options.lobbyBaseUrl ?? DRAFTKINGS_LOBBY_BASE_URL).replace(/\/+$/, ''); this.sportCodes = { ...DEFAULT_DRAFTKINGS_SPORT_CODES, ...options.sportCodes }; this.headers = { accept: 'application/json', ...options.headers }; this.timeoutMs = options.timeoutMs ?? 12_000; this.maxAttempts = options.maxAttempts ?? 3; }
  async listSports(): Promise<DraftKingsSportSummary[]> { const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.sports, this.apiBaseUrl, { format: 'json' }); const sports = asRecord(response.data)?.sports; if (!Array.isArray(sports)) throw new DraftKingsApiError('DraftKings sports response did not contain a sports array.', { url: response.url, body: response.data }); return sports.map((value) => { const sport = asRecord(value); const sportId = readNumber(sport ?? {}, ['sportId']); const fullName = readOptionalString(sport ?? {}, ['fullName']); const abbreviatedName = readOptionalString(sport ?? {}, ['regionAbbreviatedSportName']); if (!sport || sportId === undefined || !fullName || !abbreviatedName) throw new DraftKingsApiError('DraftKings sports response contained an invalid or incomplete sport record.', { url: response.url, body: value }); return { sportId, fullName, abbreviatedName, hasPublicContests: Boolean(sport.hasPublicContests), isEnabled: Boolean(sport.isEnabled) }; }); }
  async listContests(sport: Sport): Promise<DraftKingsContestSummary[]> { const sportCode = this.sportCodes[sport]; if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl }); const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode }); return extractContestSummaries(response.data, sport); }
  async listContestsAndGroups(sport: Sport, format: ContestFormat): Promise<{ contests: DraftKingsContestSummary[]; groups: DraftKingsGameGroup[] }> { const sportCode = this.sportCodes[sport]; if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl }); const response = await this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contests, this.lobbyBaseUrl, { sport: sportCode }); return { contests: extractContestSummaries(response.data, sport), groups: extractGameGroups(response.data, sport, format) }; }
  async getContest(contestId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.contest.replace('{contestId}', encodeURIComponent(contestId)), this.apiBaseUrl, { format: 'json' }); }
  async getDraftGroup(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftGroup.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  async getGameTypeRules(gameTypeId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.gameTypeRules.replace('{gameTypeId}', encodeURIComponent(gameTypeId)), this.apiBaseUrl); }
  async getDraftables(draftGroupId: string): Promise<DraftKingsHttpResponse> { return this.get(DEFAULT_DRAFTKINGS_API_ENDPOINTS.draftables.replace('{draftGroupId}', encodeURIComponent(draftGroupId)), this.apiBaseUrl); }
  private async getAvailablePlayersCsv(draftGroupId: string): Promise<DraftKingsHttpResponse<string>> {
    const url = new URL(DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv, `${this.lobbyBaseUrl}/`); url.searchParams.set('draftGroupId', draftGroupId);
    const response = await this.request(url, { accept: 'text/csv, text/plain;q=0.9' }, 'salary CSV');
    const contentType = response.headers.get('content-type') ?? '';
    const data = await response.text();
    if (!response.ok) throw new DraftKingsApiError(`DraftKings salary CSV request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status, body: data.slice(0, 500) });
    if (!/^(text\/csv|text\/plain)(\s*;|$)/i.test(contentType)) throw new DraftKingsApiError(`DraftKings salary feed returned unexpected content type: ${contentType || 'missing'}.`, { url: url.toString(), status: response.status, body: data.slice(0, 200) });
    if (!data.trim() || /^\s*</.test(data)) throw new DraftKingsApiError('DraftKings salary CSV response was empty or looked like an HTML error page.', { url: url.toString(), status: response.status, body: data.slice(0, 200) });
    return { data, url: url.toString(), retrievedAt: new Date().toISOString(), status: response.status };
  }
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
      if (!groupId || groupId !== lobbyContest.draftGroupId) throw new DraftKingsApiError(`DraftKings draft-group response identity ${groupId ?? '(missing)'} does not match lobby group ${lobbyContest.draftGroupId}.`, { url: draftGroup.url, body: draftGroup.data });
      const gameTypeId = readStringOrNumber(group, ['gameTypeId', 'gameTypeID']) ?? readStringOrNumber(asRecord(group.contestType) ?? {}, ['gameTypeId', 'gameTypeID']);
      if (!gameTypeId) throw new DraftKingsApiError(`DraftKings draft group ${input.draftGroupId} did not include a gameTypeId.`, { url: draftGroup.url, body: draftGroup.data });
      if (input.gameTypeId && input.gameTypeId !== gameTypeId) throw new DraftKingsApiError(`Requested gameTypeId ${input.gameTypeId} does not match DraftKings group gameTypeId ${gameTypeId}.`, { url: draftGroup.url, body: draftGroup.data });
      const reference = { contestId: input.contestId, draftGroupId: input.draftGroupId, gameTypeId };
      const [gameTypeRules, draftables] = await Promise.all([this.getGameTypeRules(reference.gameTypeId), this.getDraftables(reference.draftGroupId)]);
      const rulesRecord = unwrapRecord(gameTypeRules.data, ['gameTypeRules', 'rules']);
      const returnedGameType = readStringOrNumber(rulesRecord, ['gameTypeId', 'gameTypeID']);
      if (returnedGameType && returnedGameType !== reference.gameTypeId) throw new DraftKingsApiError(`DraftKings rules game type ${returnedGameType} does not match requested game type ${reference.gameTypeId}.`, { url: gameTypeRules.url, body: gameTypeRules.data });
      const draftablesRecord = unwrapRecord(draftables.data, ['draftables']);
      const returnedDraftGroup = readStringOrNumber(draftablesRecord, ['draftGroupId', 'draftGroupID']);
      if (returnedDraftGroup && returnedDraftGroup !== reference.draftGroupId) throw new DraftKingsApiError(`DraftKings player pool group ${returnedDraftGroup} does not match requested group ${reference.draftGroupId}.`, { url: draftables.url, body: draftables.data });
      const contest = { data: { contest: { contestId: lobbyContest.draftKingsContestId, name: lobbyContest.name, lockTime: lobbyContest.lockTime, draftGroupId: lobbyContest.draftGroupId, gameTypeId, contestSize: lobbyContest.contestSize, maximumEntries: lobbyContest.contestSize, maxEntriesAllowed: lobbyContest.maxEntriesAllowed } }, url: lobbyResponse.url, retrievedAt: lobbyResponse.retrievedAt, status: lobbyResponse.status };
      return { contest, draftGroup, gameTypeRules, draftables, contestIdentityVerified: true, reference };
    } catch (error) {
      if (!(error instanceof DraftKingsApiError) || error.details.status !== 403) throw error;
      const csv = await this.getAvailablePlayersCsv(input.draftGroupId);
      const players = mapAvailablePlayersCsv(csv.data, input.sport, input.format);
      if (!players.length) throw new DraftKingsApiError(`DraftKings salary CSV contained no players for draft group ${input.draftGroupId}.`, { url: csv.url, body: csv.data.slice(0, 500) });
      const rules = fallbackRules(input.sport, input.format);
      const gameTypeId = input.gameTypeId ?? `published-${input.sport.toLowerCase()}-${input.format.toLowerCase()}`;
      const response = (data: unknown): DraftKingsHttpResponse => ({ data, url: csv.url, retrievedAt: csv.retrievedAt, status: 200 });
      const group = { draftGroupId: input.draftGroupId, name: lobbyContest.name, eventDate: lobbyContest.lockTime, startTime: lobbyContest.lockTime };
      const contest = { contestId: lobbyContest.draftKingsContestId, name: lobbyContest.name, lockTime: lobbyContest.lockTime, draftGroupId: lobbyContest.draftGroupId, gameTypeId, maximumEntries: lobbyContest.contestSize ?? input.contestSize, contestSize: lobbyContest.contestSize ?? input.contestSize, maxEntriesAllowed: lobbyContest.maxEntriesAllowed ?? input.maxEntriesAllowed };
      return { reference: { contestId: input.contestId, draftGroupId: input.draftGroupId, gameTypeId }, contest: response({ contest }), draftGroup: response({ draftGroup: group }), gameTypeRules: response({ gameTypeRules: rules }), draftables: response({ draftables: players }), contestIdentityVerified: true, accessFallback: { status: error.details.status, endpoint: error.details.url, retrievedAt: csv.retrievedAt } };
    }
  }
  async getSlateBundleForContest(input: { contestId: string; draftGroupId?: string; gameTypeId?: string }): Promise<DraftKingsApiBundle & { reference: DraftKingsContestReference }> { const contest = await this.getContest(input.contestId); const discovered = extractContestReference(contest.data, input.contestId); if (input.draftGroupId && input.draftGroupId !== discovered.draftGroupId) throw new DraftKingsApiError('Requested draft group does not match the contest metadata.', { url: contest.url, body: contest.data }); if (input.gameTypeId && input.gameTypeId !== discovered.gameTypeId) throw new DraftKingsApiError('Requested game type does not match the contest metadata.', { url: contest.url, body: contest.data }); const reference = discovered; const [draftGroup, gameTypeRules, draftables] = await Promise.all([this.getDraftGroup(reference.draftGroupId), this.getGameTypeRules(reference.gameTypeId), this.getDraftables(reference.draftGroupId)]); const group = unwrapRecord(draftGroup.data, ['draftGroup']); const groupGameType = readStringOrNumber(group, ['gameTypeId', 'gameTypeID']); if (groupGameType && groupGameType !== reference.gameTypeId) throw new DraftKingsApiError('Contest and draft-group game types do not match.', { url: draftGroup.url, body: draftGroup.data }); return { contest, draftGroup, gameTypeRules, draftables, contestIdentityVerified: true, reference }; }
  private async get(path: string, baseUrl: string, query?: Record<string, string>): Promise<DraftKingsHttpResponse> {
    const url = new URL(path, `${baseUrl}/`); for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const response = await this.request(url, this.headers, 'JSON');
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    if (!response.ok) throw new DraftKingsApiError(`DraftKings request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status, body: text.slice(0, 600) });
    if (!/^application\/(json|[a-z0-9.+-]+\+json)(\s*;|$)/i.test(contentType)) throw new DraftKingsApiError(`DraftKings endpoint returned non-JSON content type: ${contentType || 'missing'}.`, { url: url.toString(), status: response.status, body: text.slice(0, 300) });
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new DraftKingsApiError('DraftKings endpoint returned malformed JSON.', { url: url.toString(), status: response.status, body: text.slice(0, 600) }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DraftKingsApiError('DraftKings endpoint returned a non-object JSON payload.', { url: url.toString(), status: response.status, body });
    return { data: body, url: url.toString(), retrievedAt: new Date().toISOString(), status: response.status };
  }
  private async request(url: URL, headers: Record<string, string>, label: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`DraftKings ${label} request timed out.`)), this.timeoutMs);
      let response: Response | undefined;
      try { response = await this.fetcher(url, { headers, signal: controller.signal, redirect: 'error' }); }
      catch (error) { lastError = error; }
      finally { clearTimeout(timeout); }
      if (response) {
        if (response.status < 500 && response.status !== 408 && response.status !== 429) return response;
        lastError = new DraftKingsApiError(`DraftKings ${label} request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status });
        if (attempt < this.maxAttempts) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : undefined;
          const delay = Math.min(5_000, seconds ?? (200 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150)));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } else if (attempt < this.maxAttempts) await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 200 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150))));
    }
    throw lastError instanceof Error ? lastError : new DraftKingsApiError(`DraftKings ${label} request failed.`, { url: url.toString() });
  }
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

/** Read contest eligibility only when DraftKings explicitly returns a boolean field. */
export function extractLateSwapEligibility(payload: unknown): boolean | null {
  const acceptedKeys = new Set(['lateswap', 'lateswapallowed', 'lateswapenabled', 'lateswapeligible', 'allowslateswap', 'islateswapeligible', 'islateswapenabled', 'islateswapallowed']);
  const values: boolean[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) visit(item, depth + 1); return; }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/[^a-z]/gi, '').toLowerCase();
      if (acceptedKeys.has(normalized) && typeof item === 'boolean') values.push(item);
      else if (item && typeof item === 'object') visit(item, depth + 1);
    }
  };
  visit(payload, 0);
  if (!values.length || values.some((value) => value !== values[0])) return null;
  return values[0];
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
  // DraftKings documents the generic cap and Showdown structure, but the per-sport
  // Classic roster templates are contest-specific. Until those are read from DK's
  // response they are discovery hints only and must never be labeled verified.
  const unverified = { sourceFallback: true, profileVerified: false, ruleProfileVersion: 'UNVERIFIED_DISCOVERY_TEMPLATE', salaryCap: { maxValue: 50_000 } };
  if (format === 'SHOWDOWN' && sport !== 'GOLF') return { ...unverified, rosterRules: { rosterSize: 6, captainMultiplier: 1.5, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } } };
  const slots: Record<Sport, Record<string, number>> = {
    MLB: { P: 2, C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3 },
    NFL: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DST: 1 },
    CFB: { QB: 1, RB: 2, WR: 3, FLEX: 1, SFLEX: 1 },
    NBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
    WNBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
    GOLF: { G: 6 },
  };
  if (sport === 'GOLF' && format === 'SHOWDOWN') return { ...unverified, rosterRules: { rosterSize: 6, slots: { G: { count: 6 } }, uniquePlayersRequired: true } };
  return { ...unverified, rosterRules: { rosterSize: Object.values(slots[sport]).reduce((sum, count) => sum + count, 0), slots: Object.fromEntries(Object.entries(slots[sport]).map(([name, count]) => [name, { count }])), uniquePlayersRequired: true } };
}
function mapAvailablePlayersCsv(csv: string, sport: Sport, format: ContestFormat): Array<Record<string, unknown>> {
  const [header = [], ...rows] = parseCsvRecords(csv.replace(/^\uFEFF/, ''));
  const indexes = new Map(header.map((value, index) => [value.trim().toLowerCase(), index]));
  for (const required of ['id', 'name', 'salary']) if (!indexes.has(required)) throw new DraftKingsApiError(`DraftKings salary CSV is missing the required ${required} column.`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
  if (indexes.size !== header.length) throw new DraftKingsApiError('DraftKings salary CSV contains duplicate or empty column names.', { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
  const value = (row: string[], column: string): string => row[indexes.get(column.toLowerCase()) ?? -1]?.trim() ?? '';
  const players = new Map<string, Record<string, unknown>>();
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== header.length) throw new DraftKingsApiError(`DraftKings salary CSV row ${rowIndex + 2} has ${row.length} fields; expected ${header.length}.`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
    const id = value(row, 'id'); const name = value(row, 'name'); const salary = Number(value(row, 'salary'));
    if (!id || !name || !Number.isFinite(salary) || salary <= 0) throw new DraftKingsApiError(`DraftKings salary CSV row ${rowIndex + 2} has a missing identity or invalid salary.`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
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
    const slotIds = player.draftKingsSlotIds as Record<string, string> | undefined ?? {};
    const canonicalSlots = normalizedSlots.map((slot) => slot.toUpperCase() === 'CAPTAIN' || slot.toUpperCase() === 'MVP' ? 'CPT' : slot.toUpperCase() === 'FLEX' ? 'UTIL' : slot.toUpperCase());
    for (const slot of canonicalSlots) {
      if (slotIds[slot] && slotIds[slot] !== id) throw new DraftKingsApiError(`DraftKings salary CSV contains conflicting ${slot} identifiers for ${name}.`, { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
      slotIds[slot] = id;
    }
    player.draftKingsSlotIds = slotIds;
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
  if (quoted) throw new DraftKingsApiError('DraftKings salary CSV contains an unterminated quoted field.', { url: DEFAULT_DRAFTKINGS_API_ENDPOINTS.availablePlayersCsv });
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
