import type { ValidatedSlate } from './contracts.js';

export interface BasketballProjectionRecord { name: string; team: string; providerFppg: number; source: string; }

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

  private async getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, { signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`ESPN projection endpoint returned HTTP ${response.status}.`);
    const payload = await response.json() as unknown;
    return asRecord(payload) ?? {};
  }
}

function espnDate(slate: ValidatedSlate): string { const date = new Date(slate.event.eventDate); if (date.getUTCHours() < 6) date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10).replaceAll('-', ''); }
function listRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.flatMap((item) => asRecord(item) ? [asRecord(item)!] : []) : []; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function number(value: unknown): number { return typeof value === 'number' ? value : Number(value); }
function teamCode(value: unknown): string { return normalizeTeamCode(text(asRecord(value)?.abbreviation ?? asRecord(value)?.shortDisplayName)); }
function normalizeTeamCode(value: string): string { return ({ WAS: 'WSH', PDX: 'POR' } as Record<string, string>)[value.toUpperCase()] ?? value.toUpperCase(); }
