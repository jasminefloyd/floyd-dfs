import type { ValidatedSlate } from './contracts.js';
import { normalizeTeamCode, type AvailabilityRecord, type AvailabilitySnapshot } from './availability.js';
import { fetchEspnJson } from './espnApiClient.js';

export interface BasketballProjectionRecord { name: string; team: string; providerFppg: number; source: string; }

const ESPN_AVAILABILITY_SPORT_PATH: Partial<Record<ValidatedSlate['sport'], { sportGroup: string; league: string }>> = {
  NBA: { sportGroup: 'basketball', league: 'nba' },
  WNBA: { sportGroup: 'basketball', league: 'wnba' },
  NFL: { sportGroup: 'football', league: 'nfl' },
  CFB: { sportGroup: 'football', league: 'college-football' },
};

export class EspnProjectionClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly commonBaseUrl: string;
  constructor(baseUrl: string, fetcher?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.commonBaseUrl = 'https://site.web.api.espn.com/apis/common/v3';
    this.fetcher = fetcher ?? fetch;
  }

  async getBasketballProjectionSnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<BasketballProjectionRecord[]> {
    if (slate.sport !== 'NBA' && slate.sport !== 'WNBA') return [];
    const league = slate.sport.toLowerCase();
    const date = espnDate(slate);
    const scoreboard = await this.getJson(`${this.baseUrl}/sports/basketball/${league}/scoreboard?dates=${date}`, signal);
    const teams = new Set(slate.playerPool.map((player) => normalizeTeamCode(String(player.team ?? ''))).filter(Boolean));
    const event = listRecords(scoreboard.events).find((candidate) => {
      const competitors = listRecords(listRecords(candidate.competitions)[0]?.competitors);
      return teams.size > 0 && teams.size === competitors.filter((competitor) => teams.has(teamCode(competitor.team))).length;
    });
    if (!event) return [];
    const competitors = listRecords(listRecords(event.competitions)[0]?.competitors);
    const rosterRows = await Promise.all(competitors.filter((competitor) => teams.has(teamCode(competitor.team))).map(async (competitor) => {
      const team = teamCode(competitor.team);
      const teamId = text(asRecord(competitor.team)?.id);
      if (!teamId) return [];
      const roster = await this.getJson(`${this.baseUrl}/sports/basketball/${league}/teams/${teamId}/roster`, signal);
      const athletes = listRecords(roster.athletes);
      const projections = await Promise.all(athletes.map(async (athlete) => {
        const athleteId = text(athlete.id);
        if (!athleteId) return undefined;
        try {
          const profile = await this.getJson(`${this.commonBaseUrl}/sports/basketball/${league}/athletes/${athleteId}`, signal);
          const statsSummary = asRecord(asRecord(profile.athlete)?.statsSummary);
          const stats = listRecords(statsSummary?.statistics);
          const values = new Map(stats.map((stat) => [text(stat.name), number(stat.value)]));
          const points = values.get('avgPoints'); const rebounds = values.get('avgRebounds'); const assists = values.get('avgAssists'); const steals = values.get('avgSteals');
          if (![points, rebounds, assists, steals].every((value) => Number.isFinite(value))) return undefined;
          const name = text(athlete.fullName ?? athlete.displayName);
          if (!name) return undefined;
          return { name, team, providerFppg: points! + rebounds! * 1.25 + assists! * 1.5 + steals! * 2, source: 'ESPN season averages' };
        } catch {
          return undefined;
        }
      }));
      return projections.filter((value): value is BasketballProjectionRecord => Boolean(value));
    }));
    return rosterRows.flat();
  }

  // NBA/WNBA/NFL/CFB availability, sourced from ESPN's team roster endpoint (already reachable via
  // this.baseUrl; no dedicated confirmed-lineup feed like MLB's SportsDataIO integration exists
  // for these sports). Each athlete carries a `status` object and an `injuries` array; the exact
  // non-"active" status.type/injury-status taxonomy wasn't verified against a real
  // injured/questionable player during implementation, so unrecognized values fall back to
  // UNKNOWN (never guessed as OUT) rather than risk excluding a healthy player. For CFB,
  // roster membership is deliberately not treated as a confirmed starting role.
  async getAvailabilitySnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const sportPath = ESPN_AVAILABILITY_SPORT_PATH[slate.sport];
    if (!sportPath) return { source: 'ESPN', retrievedAt: new Date().toISOString(), records: [], confirmedLineupAvailable: false, note: `${slate.sport} has no configured ESPN availability mapping.` };
    const teams = [...new Set(slate.playerPool.map((player) => normalizeTeamCode(player.team)).filter(Boolean))];
    const teamIds = slate.sport === 'CFB' ? await this.resolveCollegeTeamIds(slate, teams, signal) : new Map<string, string>();
    const rosterRows = await Promise.all(teams.map(async (team) => {
      try {
        const teamResource = teamIds.get(team) ?? team.toLowerCase();
        const roster = await this.getJson(`${this.baseUrl}/sports/${sportPath.sportGroup}/${sportPath.league}/teams/${teamResource}/roster`, signal);
        const groups = listRecords(roster.athletes);
        const athletes = groups.length && groups[0].items !== undefined ? groups.flatMap((group) => listRecords(group.items)) : groups;
        return athletes.flatMap((athlete): AvailabilityRecord[] => {
          const name = text(athlete.fullName ?? athlete.displayName);
          if (!name) return [];
          const status = espnAvailabilityStatus(athlete);
          return [{ playerName: name, team, status, confirmed: false, updatedAt: new Date().toISOString(), note: slate.sport === 'CFB' ? 'Listed on ESPN roster; starting role was not confirmed by this source.' : undefined }];
        });
      } catch { return []; }
    }));
    const records = rosterRows.flat();
    const teamsWithRecords = new Set(records.map((record) => record.team));
    const rosterComplete = teams.length > 0 && teams.every((team) => teamsWithRecords.has(team));
    return { source: 'ESPN', retrievedAt: new Date().toISOString(), records, confirmedLineupAvailable: false, rosterComplete, note: records.length ? undefined : 'ESPN roster data was unavailable for this slate.' };
  }

  private async resolveCollegeTeamIds(slate: ValidatedSlate, teams: string[], signal?: AbortSignal): Promise<Map<string, string>> {
    try {
      const date = espnDate(slate);
      const scoreboard = await this.getJson(`${this.baseUrl}/sports/football/college-football/scoreboard?dates=${date}`, signal);
      const resolved = new Map<string, string>();
      for (const event of listRecords(scoreboard.events)) {
        for (const competition of listRecords(event.competitions)) {
          for (const competitor of listRecords(competition.competitors)) {
            const team = asRecord(competitor.team);
            const code = normalizeTeamCode(text(team?.abbreviation));
            const id = text(team?.id);
            if (code && id && teams.includes(code)) resolved.set(code, id);
          }
        }
      }
      return resolved;
    } catch {
      return new Map();
    }
  }

  private async getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { payload } = await fetchEspnJson(url, { signal, fetcher: this.fetcher });
    return payload;
  }
}

function espnDate(slate: ValidatedSlate): string { const date = new Date(slate.event.eventDate); if (date.getUTCHours() < 6) date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10).replaceAll('-', ''); }
function listRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.flatMap((item) => asRecord(item) ? [asRecord(item)!] : []) : []; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function number(value: unknown): number { return typeof value === 'number' ? value : Number(value); }
function teamCode(value: unknown): string { return normalizeTeamCode(text(asRecord(value)?.abbreviation ?? asRecord(value)?.shortDisplayName)); }
function espnAvailabilityStatus(athlete: Record<string, unknown>): AvailabilityRecord['status'] {
  const injuries = listRecords(athlete.injuries);
  const injuryText = injuries.map((injury) => text(injury.status ?? asRecord(injury.details)?.type)).join(' ').toLowerCase();
  if (/out|inactive|suspend|injured.reserve|\bil\b/.test(injuryText)) return 'OUT';
  if (/day.to.day|questionable|probable|game.time/.test(injuryText)) return 'PROJECTED';
  const statusType = text(asRecord(athlete.status)?.type).toLowerCase();
  if (statusType === 'active') return injuries.length ? 'PROJECTED' : 'ACTIVE';
  if (/out|inactive|suspend/.test(statusType)) return 'OUT';
  return 'UNKNOWN';
}
