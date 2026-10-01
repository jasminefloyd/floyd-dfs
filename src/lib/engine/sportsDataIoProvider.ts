import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, Sport, ValidatedSlate } from './contracts.js';
import { normalizeProviderName, normalizeTeamCode, parseAvailabilityRecords, type AvailabilityRecord, type AvailabilitySnapshot } from './availability.js';

export interface SportsDataIoClientOptions { apiKey: string; baseUrl?: string; fetcher?: typeof fetch; availability?: Partial<Record<Sport, { feed: string; resource: string }>>; }
export interface GolfProjectionRefresh { rows: Record<string, unknown>[]; tournamentName?: string; warning?: string; }

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
  private async getGolf<T>(resource: string, parameter?: string, signal?: AbortSignal): Promise<T> {
    const golfBaseUrl = this.baseUrl.replace(/\/v3$/, '');
    const path = [golfBaseUrl, 'golf', 'v2', 'json', resource, parameter].filter(Boolean).join('/');
    const response = await this.fetcher(path, { signal, headers: { accept: 'application/json', 'Ocp-Apim-Subscription-Key': this.options.apiKey } });
    if (!response.ok) { const detail = await response.text().catch(() => ''); if (response.status === 401 || response.status === 403) throw new Error(`SportsDataIO access denied for GOLF v2/${resource} (HTTP ${response.status}). Check subscription feed permissions.`); throw new Error(`SportsDataIO GOLF v2/${resource} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}.`); }
    return await response.json() as T;
  }
  async getAvailabilitySnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const date = sportsDataDate(slate);
    if (slate.sport === 'MLB') {
      const retrievedAt = new Date().toISOString();
      const parsed = parseAvailabilityRecords(await this.get<unknown>('MLB', 'projections', 'StartingLineupsByDate', date, signal), slate.sport, retrievedAt);
      const slateTeams = new Set(slate.playerPool.map((player) => normalizeTeamCode(player.team)).filter(Boolean));
      const lineupRecords = parsed.records.filter((record) => slateTeams.has(normalizeTeamCode(record.team)));
      const rosterRecords = (await Promise.all([...slateTeams].map(async (team) => {
        const payload = await this.get<unknown>('MLB', 'scores', 'Players', team, signal);
        return (Array.isArray(payload) ? payload : []).flatMap((value): AvailabilityRecord[] => {
          const row = asRecord(value); if (!row) return [];
          const playerName = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']) ?? fullName(row); if (!playerName) return [];
          const providerTeam = readString(row, ['Team', 'team', 'TeamAbbreviation', 'Key']);
          if (providerTeam && normalizeTeamCode(providerTeam) !== normalizeTeamCode(team)) return [];
          const status = readString(row, ['Status', 'status']) ?? '';
          const unavailable = /inactive|injury|injured|restricted|bereavement|military|paternity/i.test(status);
          return [{ playerName, team, providerPlayerId: readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']), status: unavailable ? 'INACTIVE' : 'ACTIVE', roleStatus: 'UNKNOWN', confirmed: false, updatedAt: retrievedAt, note: 'SportsDataIO MLB player profile confirms team-roster membership; starting lineup is tracked separately.' }];
        });
      }))).flat();
      const byKey = new Map(rosterRecords.map((record) => [`${normalizeProviderName(record.playerName)}|${normalizeTeamCode(record.team)}`, record]));
      for (const record of lineupRecords) byKey.set(`${normalizeProviderName(record.playerName)}|${normalizeTeamCode(record.team)}`, record);
      const records = [...byKey.values()];
      const confirmedTeams = new Set(lineupRecords.filter((record) => record.confirmed && record.battingOrder !== undefined).map((record) => normalizeTeamCode(record.team)).filter(Boolean));
      const confirmedLineupAvailable = slateTeams.size > 1 ? [...slateTeams].every((team) => confirmedTeams.has(team)) : records.some((record) => record.confirmed && record.battingOrder !== undefined);
      return { ...parsed, retrievedAt, records, confirmedLineupAvailable, note: `SportsDataIO MLB roster profiles and lineup records scoped to ${[...slateTeams].join('/')}.` };
    }
    if (slate.sport === 'CFB') return this.getCfbRosterSnapshot(slate, signal);
    if (slate.sport === 'NFL') return this.getNflAvailabilitySnapshot(slate, signal);
    const availability = this.options.availability?.[slate.sport];
    if (!availability) return { source: 'SPORTSDATAIO', retrievedAt: new Date().toISOString(), records: [], confirmedLineupAvailable: false, note: `${slate.sport} has no configured provider availability feed.` };
    return parseAvailabilityRecords(await this.get<unknown>(slate.sport, availability.feed, availability.resource, date, signal), slate.sport, new Date().toISOString());
  }
  private async getNflAvailabilitySnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const retrievedAt = new Date().toISOString();
    const teams = new Set(slate.playerPool.map((player) => normalizeTeamCode(player.team)).filter(Boolean));
    const diagnostics: NonNullable<AvailabilitySnapshot['diagnostics']> = [];
    const load = async (feed: string, resource: string, parameter?: string, label = resource): Promise<unknown[]> => {
      try {
        const payload = await this.get<unknown>('NFL', feed, resource, parameter, signal);
        diagnostics.push({ provider: `SportsDataIO NFL ${feed}/${label}`, status: 'SUCCEEDED', retrievedAt });
        return rowsFromPayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : `SportsDataIO NFL ${feed}/${label} failed.`;
        const httpStatus = /HTTP (\d+)/.exec(message)?.[1];
        diagnostics.push({ provider: `SportsDataIO NFL ${feed}/${label}`, status: 'FAILED', error: message, httpStatus: httpStatus ? Number(httpStatus) : undefined, retrievedAt });
        return [];
      }
    };
    // SportsDataIO documents NFL DepthCharts and Injuries as separate feeds: depth order
    // represents current coaching intent, while injury/game status represents availability.
    const [teamRows, depthRows, scheduleRows] = await Promise.all([
      load('scores', 'Teams'),
      load('scores', 'DepthCharts'),
      load('scores', 'ScoresByDate', sportsDataDate(slate)),
    ]);
    const schedule = scheduleRows.find((value) => {
      const row = asRecord(value); if (!row) return false;
      const home = normalizeTeamCode(readString(row, ['HomeTeam', 'homeTeam']) ?? '');
      const away = normalizeTeamCode(readString(row, ['AwayTeam', 'awayTeam']) ?? '');
      return home && away && teams.has(home) && teams.has(away);
    });
    const scheduleRecord = asRecord(schedule);
    const scheduleWeek = scheduleRecord ? readIdentifier(scheduleRecord, ['Week', 'week']) : undefined;
    const scheduleSeason = scheduleRecord ? readIdentifier(scheduleRecord, ['Season', 'season']) : undefined;
    const injuryRows = scheduleWeek
      ? await load('stats', 'Injuries', `${scheduleSeason ?? new Date(slate.event.eventDate).getUTCFullYear()}/${scheduleWeek}`, `Injuries/${scheduleSeason ?? new Date(slate.event.eventDate).getUTCFullYear()}/${scheduleWeek}`)
      : [];
    if (!scheduleWeek) diagnostics.push({ provider: 'SportsDataIO NFL stats/Injuries', status: 'EMPTY', error: `No matching NFL schedule event with a provider week was found for ${sportsDataDate(slate)} and teams ${[...teams].join('/')}; injury endpoint was not called.`, retrievedAt });
    const teamKeys = new Map(teamRows.flatMap((value) => { const row = asRecord(value); const id = row ? readIdentifier(row, ['TeamID', 'TeamId', 'teamId']) : undefined; const key = row ? readString(row, ['Key', 'key', 'Abbreviation', 'abbreviation']) : undefined; return id && key ? [[id, normalizeTeamCode(key)] as const] : []; }));
    const records: AvailabilityRecord[] = [];
    const depthByPlayer = new Map<string, { name?: string; providerPlayerId?: string; team?: string; depthOrder?: number; position?: string }>();
    for (const value of depthRows) for (const row of flattenDepthRows(value)) {
      const id = readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']);
      const name = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']);
      const rawTeam = readString(row, ['Team', 'Key', 'team', 'TeamAbbreviation']) ?? readIdentifier(row, ['TeamID', 'TeamId', 'teamId']);
      const team = rawTeam && teamKeys.get(rawTeam) ? teamKeys.get(rawTeam) : rawTeam;
      if (!name && !id) continue;
      const key = id ?? normalizeProviderName(name ?? '');
      depthByPlayer.set(`${key}|${normalizeTeamCode(team)}`, { name, providerPlayerId: id, team, depthOrder: readNumber(row, ['DepthOrder', 'depthOrder']), position: readString(row, ['Position', 'position']) });
    }
    for (const value of injuryRows) {
      const row = asRecord(value); if (!row) continue;
      const id = readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']);
      const name = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']);
      const rawTeam = readString(row, ['Team', 'Key', 'team', 'TeamAbbreviation']) ?? readIdentifier(row, ['TeamID', 'TeamId', 'teamId']);
      const team = rawTeam && teamKeys.get(rawTeam) ? teamKeys.get(rawTeam) : rawTeam;
      if (!name && !id) continue;
      const key = id ?? normalizeProviderName(name ?? '');
      const depth = [...depthByPlayer.entries()].find(([depthKey]) => depthKey.startsWith(`${key}|`))?.[1];
      if (team && !teams.has(normalizeTeamCode(team))) continue;
      const injuryStatus = readString(row, ['InjuryStatus', 'Status', 'status', 'InjuryStatusDescription']) ?? '';
      const rosterStatus = readString(row, ['RosterStatus', 'PlayerStatus', 'ActiveStatus']) ?? '';
      const combined = `${injuryStatus} ${rosterStatus}`;
      const unavailable = /out|inactive|injured reserve|physically unable|suspended|non.?football/i.test(combined);
      const questionable = /questionable|doubtful|probable|limited|day.to.day/i.test(combined);
      const depthOrder = depth?.depthOrder;
      records.push({ playerName: name ?? '', team: team ?? depth?.team, providerPlayerId: id, status: unavailable ? 'OUT' : questionable ? 'PROJECTED' : 'ACTIVE', roleStatus: depthOrder === 1 ? 'EXPECTED_STARTER' : depthOrder && depthOrder > 1 ? 'NOT_STARTER' : 'ROLE_UNCONFIRMED', confirmed: true, updatedAt: retrievedAt, note: `${injuryStatus || rosterStatus || 'No active injury designation'}; depth order ${depthOrder ?? 'not supplied'}.` });
    }
    for (const [key, depth] of depthByPlayer) {
      if (!depth.team || !teams.has(normalizeTeamCode(depth.team))) continue;
      if (records.some((record) => record.providerPlayerId && key.startsWith(`${record.providerPlayerId}|`))) continue;
      if (!depth.name) continue;
      records.push({ playerName: depth.name, team: depth.team, providerPlayerId: depth.providerPlayerId, status: 'ACTIVE', roleStatus: depth.depthOrder === 1 ? 'EXPECTED_STARTER' : depth.depthOrder && depth.depthOrder > 1 ? 'NOT_STARTER' : 'ROLE_UNCONFIRMED', confirmed: true, updatedAt: retrievedAt, note: `SportsDataIO depth chart status; depth order ${depth.depthOrder ?? 'not supplied'}.` });
    }
    const rosterComplete = records.length > 0 && [...teams].every((team) => records.some((record) => normalizeTeamCode(record.team) === team));
    return { source: 'SPORTSDATAIO', retrievedAt, records, confirmedLineupAvailable: false, rosterComplete, diagnostics, note: 'NFL availability combines SportsDataIO Injuries with DepthCharts; depth order is role intent, not game-day inactive confirmation.' };
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
    // The account-accessible CFB roster operation is PlayersByActive. The older
    // PlayerDetailsByTeam operation is listed in legacy client metadata but returns
    // HTTP 404 for this account, so fetch the verified active-player roster once and
    // partition it by the provider's unique team Key.
    const activePlayers = rowsFromPayload(await this.get<unknown>('CFB', 'scores', 'PlayersByActive', undefined, signal));
    for (const slateTeam of slateTeams) {
      const fallbackTeam = teamRows.map((value) => asRecord(value)).find((row) => row && normalizeProviderName(readString(row, ['Abbreviation', 'abbreviation']) ?? '') === normalizeProviderName(slateTeam));
      const providerKey = teamKeys.get(slateTeam) ?? (fallbackTeam ? readString(fallbackTeam, ['Key', 'key']) : undefined);
      if (typeof providerKey !== 'string' || !providerKey) { complete = false; notes.push(`SportsDataIO CFB team key was not resolved for ${slateTeam}.`); continue; }
      const rosterRows = activePlayers.filter((value) => {
        const row = asRecord(value); if (!row) return false;
        const providerTeam = readString(row, ['Team', 'team']);
        return providerTeam ? normalizeTeamCode(providerTeam) === normalizeTeamCode(providerKey) : false;
      });
      if (!rosterRows.length) { complete = false; notes.push(`SportsDataIO CFB roster returned no players for ${slateTeam} (${providerKey}).`); continue; }
      for (const value of rosterRows) {
        const row = asRecord(value); if (!row) continue;
        const playerName = readString(row, ['Name', 'PlayerName', 'FullName', 'name', 'playerName']) ?? fullName(row);
        if (!playerName) continue;
        const injuryStatus = readString(row, ['InjuryStatus', 'injuryStatus', 'Status', 'status']);
        const injuryNotes = readString(row, ['InjuryNotes', 'injuryNotes', 'InjuryNote', 'injuryNote']);
        const status = /out/i.test(injuryStatus ?? '') ? 'OUT' : injuryStatus ? 'PROJECTED' : 'ACTIVE';
        records.push({ playerName, team: slateTeam, providerPlayerId: readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']), status, roleStatus: 'ROLE_UNCONFIRMED', confirmed: false, updatedAt: retrievedAt, note: injuryStatus ? `SportsDataIO injury status: ${injuryStatus}${injuryNotes ? ` (${injuryNotes})` : ''}. CFB starter role was not provided.` : 'SportsDataIO roster membership verified; CFB starter role was not provided.' });
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
    // WNBA exposes PlayerSeasonStats under the scores subfeed. The other supported
    // season-stat routes used here are under stats (verified against the published
    // OpenAPI schemas and the configured account).
    const feed = sport === 'WNBA' ? 'scores' : 'stats';
    const payload = await this.get<unknown>(sport, feed, 'PlayerSeasonStats', seasonParam, signal);
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((value) => (value && typeof value === 'object' ? [value as Record<string, unknown>] : []));
  }
  async getGolfTournamentProjectionInputs(slate: ValidatedSlate, signal?: AbortSignal): Promise<GolfProjectionRefresh> {
    const season = String(new Date(slate.event.eventDate).getUTCFullYear());
    const tournaments = rowsFromPayload(await this.getGolf<unknown>('Tournaments', season, signal));
    const slateNames = [slate.contest.name, slate.event.name].map(normalizeProviderName).filter((name) => name.length >= 5);
    const tournamentRows = tournaments.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
    const eventDate = new Date(slate.event.eventDate).toISOString().slice(0, 10);
    const dateMatches = preferCoveredGolfTournaments(tournamentRows.filter((row) => tournamentMatchesDate(row, eventDate)));
    const namedMatches = preferCoveredGolfTournaments(tournamentRows.filter((row) => {
      const name = normalizeProviderName(readString(row, ['Name', 'name']) ?? '');
      // Contest names often say only "PGA TOUR Showdown"; retain title matching when
      // the event carries a meaningful tournament name, but use schedule dates otherwise.
      return name.length >= 5 && slateNames.some((candidate) => candidate.includes(name) || name.includes(candidate));
    }));
    const candidates = dateMatches.length ? dateMatches : namedMatches;
    const tournament = candidates.length === 1 ? candidates[0] : undefined;
    if (!tournament) {
      const reason = candidates.length > 1 ? `multiple SportsDataIO Golf tournaments matched date/name (${candidates.map((row) => readString(row, ['Name', 'name']) ?? 'unnamed').join(', ')})` : `no SportsDataIO Golf tournament matched slate date ${eventDate} or event name`;
      return { rows: [], warning: `${reason} for DraftKings contest "${slate.contest.name}" in season ${season}; tournament-specific Golf inputs were not available.` };
    }
    const tournamentId = readIdentifier(tournament, ['TournamentID', 'TournamentId', 'tournamentId']);
    if (!tournamentId) return { rows: [], warning: `SportsDataIO Golf matched tournament "${readString(tournament, ['Name', 'name']) ?? 'unknown'}" but returned no TournamentID.` };
    const projectionRows = rowsFromPayload(await this.getGolf<unknown>('PlayerTournamentProjectionStats', tournamentId, signal));
    const rounds = Array.isArray(tournament.Rounds) ? tournament.Rounds : [];
    const totalRounds = rounds.length || 4;
    if (!projectionRows.length) return { rows: [], tournamentName: readString(tournament, ['Name', 'name']), warning: `SportsDataIO Golf matched tournament "${readString(tournament, ['Name', 'name']) ?? tournamentId}" but returned no PlayerTournamentProjectionStats rows.` };
    let playersById = new Map<string, Record<string, unknown>>();
    let playerCatalogWarning = '';
    try {
      playersById = new Map(rowsFromPayload(await this.getGolf<unknown>('Players', undefined, signal)).flatMap((value) => {
        const row = asRecord(value);
        const id = row && readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']);
        return row && id ? [[id, row] as const] : [];
      }));
    } catch (error) {
      playerCatalogWarning = error instanceof Error ? ` Golf player-ID crosswalk unavailable: ${error.message}` : ' Golf player-ID crosswalk unavailable.';
    }
    const rows = projectionRows.flatMap((value) => {
      const row = asRecord(value); if (!row) return [];
      const birdies = readNumber(row, ['Birdies', 'birdies']);
      const eagles = readNumber(row, ['Eagles', 'eagles']);
      const bogeys = readNumber(row, ['Bogeys', 'bogeys']);
      const pars = readNumber(row, ['Pars', 'pars']);
      if (![birdies, eagles, bogeys, pars].every((number) => number !== undefined)) return [];
      // PlayerTournamentProjectionStats are event totals. Convert to per-round rates;
      // Showdown consumes one round while Classic consumes the event's remaining rounds.
      const roundsRemaining = slate.contest.format === 'SHOWDOWN' ? 1 : totalRounds;
      const playerId = readIdentifier(row, ['PlayerID', 'PlayerId', 'playerId']);
      const player = playerId ? playersById.get(playerId) : undefined;
      return [{ ...row, ...(player ? { DraftKingsPlayerID: player.DraftKingsPlayerID ?? player.DraftKingsPlayerId, DraftKingsName: player.DraftKingsName } : {}), birdiesPerRound: birdies! / totalRounds, eaglesPerRound: eagles! / totalRounds, bogeysPerRound: bogeys! / totalRounds, parsPerRound: pars! / totalRounds, roundsRemaining }];
    });
    return { rows, tournamentName: readString(tournament, ['Name', 'name']), warning: rows.length ? `Golf inputs sourced from SportsDataIO tournament projections for ${readString(tournament, ['Name', 'name']) ?? tournamentId}.${playerCatalogWarning}` : `SportsDataIO Golf tournament projections for ${readString(tournament, ['Name', 'name']) ?? tournamentId} did not contain all required scoring fields.${playerCatalogWarning}` };
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
    const resource = this.options.resource ?? (input.slate.sport === 'NFL' ? 'ScoresByDate' : 'GamesByDate');
    const payload = await this.options.client.get<unknown>(input.slate.sport, this.options.feed ?? 'scores', resource, sportsDataDate(input.slate), input.signal);
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
function tournamentMatchesDate(row: Record<string, unknown>, eventDate: string): boolean {
  const rounds = Array.isArray(row.Rounds) ? row.Rounds : [];
  if (rounds.some((value) => { const round = asRecord(value); return round && golfDateOnly(readString(round, ['Day', 'Date', 'day', 'date'])) === eventDate; })) return true;
  const start = golfDateOnly(readString(row, ['StartDate', 'startDate']));
  const end = golfDateOnly(readString(row, ['EndDate', 'endDate']));
  return Boolean(start && end && start <= eventDate && eventDate <= end);
}
function golfDateOnly(value: string | undefined): string | undefined { return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]; }
function preferCoveredGolfTournaments(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const covered = rows.filter((row) => row.Covered === true || row.Covered === 'true');
  return covered.length ? covered : rows.filter((row) => row.Covered !== false && row.Covered !== 'false');
}
function flattenDepthRows(value: unknown, inheritedTeam?: string): Record<string, unknown>[] {
  const row = asRecord(value); if (!row) return [];
  const ownTeam = readString(row, ['Team', 'Key', 'team', 'TeamAbbreviation']) ?? readIdentifier(row, ['TeamID', 'TeamId', 'teamId']) ?? inheritedTeam;
  const normalized = ownTeam && !readString(row, ['Team', 'team', 'TeamAbbreviation']) ? { ...row, Team: ownTeam } : row;
  return [normalized].concat(...['Offense', 'Defense', 'SpecialTeams', 'offense', 'defense', 'specialTeams'].map((key) => Array.isArray(row[key]) ? row[key].flatMap((item) => flattenDepthRows(item, ownTeam)) : []));
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readIdentifier(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) { const value = record[key]; if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim(); } return undefined; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function fullName(record: Record<string, unknown>): string | undefined { const first = readString(record, ['FirstName', 'firstName']); const last = readString(record, ['LastName', 'lastName']); return first && last ? `${first} ${last}` : first ?? last; }
