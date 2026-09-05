import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, ValidatedSlate } from './contracts.js';
import { fetchEspnJson } from './espnApiClient.js';

function dateForSlate(slate: ValidatedSlate): string { return new Date(slate.event.eventDate).toISOString().slice(0, 10).replaceAll('-', ''); }
function summarize(value: unknown): string { return JSON.stringify(value).slice(0, 1800); }

export class EspnStructuredResearchProvider implements ResearchSourceProvider {
  readonly name = 'ESPN Structured Context';
  readonly tier = 2 as const;
  private readonly baseUrl: string;
  private readonly fetcher?: typeof fetch;
  constructor(baseUrl: string, fetcher?: typeof fetch) { this.baseUrl = baseUrl; this.fetcher = fetcher; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const sportPath = input.slate.sport === 'CFB' ? 'football/college-football' : input.slate.sport === 'NFL' ? 'football/nfl' : input.slate.sport === 'NBA' ? 'basketball/nba' : input.slate.sport === 'WNBA' ? 'basketball/wnba' : undefined;
    if (!sportPath) return [];
    const root = this.baseUrl.replace(/\/+$/, '');
    const endpoints = [
      { label: 'scoreboard', path: `/sports/${sportPath}/scoreboard?dates=${dateForSlate(input.slate)}` },
      { label: 'injuries', path: `/sports/${sportPath}/injuries` },
      { label: 'transactions', path: `/sports/${sportPath}/transactions` },
    ];
    if (input.slate.sport === 'CFB') {
      endpoints.push({ label: 'rankings', path: `/sports/${sportPath}/rankings` }, { label: 'groups', path: `/sports/${sportPath}/groups` });
      for (const team of [...new Set(input.slate.playerPool.map((player) => String(player.team ?? '').trim().toLowerCase()).filter(Boolean))]) endpoints.push({ label: `${team} depth chart`, path: `/sports/${sportPath}/teams/${encodeURIComponent(team)}/depthcharts` });
    }
    const results = await Promise.all(endpoints.map(async (endpoint) => {
      try { const { payload } = await fetchEspnJson(`${root}${endpoint.path}`, { signal: input.signal, fetcher: this.fetcher }); return { endpoint: endpoint.label, payload }; }
      catch { return undefined; }
    }));
    return results.flatMap((result) => result ? [{ title: `ESPN ${input.slate.sport} ${result.endpoint} context`, sourceName: this.name, sourceTier: this.tier, summary: summarize(result.payload), tags: [input.slate.sport, 'ESPN_STRUCTURED', result.endpoint.toUpperCase()] }] : []);
  }
}
