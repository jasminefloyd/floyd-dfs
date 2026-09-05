import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, ValidatedSlate } from './contracts.js';
import { fetchEspnJson } from './espnApiClient.js';

const SPORT_LEAGUE: Record<ValidatedSlate['sport'], { sport: string; league: string }> = {
  MLB: { sport: 'baseball', league: 'mlb' }, NBA: { sport: 'basketball', league: 'nba' }, WNBA: { sport: 'basketball', league: 'wnba' }, NFL: { sport: 'football', league: 'nfl' }, CFB: { sport: 'football', league: 'college-football' }, GOLF: { sport: 'golf', league: 'pga' },
};

function rows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  for (const key of ['articles', 'results', 'news']) if (Array.isArray(object[key])) return (object[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  return [];
}
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }

export class EspnLeagueNewsProvider implements ResearchSourceProvider {
  readonly name = 'ESPN League News API';
  readonly tier = 2 as const;
  private readonly sport: ValidatedSlate['sport'];
  private readonly fetcher?: typeof fetch;
  constructor(sport: ValidatedSlate['sport'], fetcher?: typeof fetch) { this.sport = sport; this.fetcher = fetcher; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const league = SPORT_LEAGUE[this.sport];
    const url = `https://now.core.api.espn.com/v1/sports/news?sport=${encodeURIComponent(league.sport)}&leagues=${encodeURIComponent(league.league)}&limit=50`;
    const { payload } = await fetchEspnJson(url, { signal: input.signal, fetcher: this.fetcher });
    return rows(payload).flatMap((row) => {
      const links = row.links && typeof row.links === 'object' ? row.links as Record<string, unknown> : {};
      const web = links.web && typeof links.web === 'object' ? links.web as Record<string, unknown> : {};
      const title = string(row.headline ?? row.title);
      if (!title) return [];
      const published = string(row.published ?? row.publishedAt);
      return [{ title, url: string(web.href ?? row.link ?? row.url), sourceName: this.name, sourceTier: this.tier, publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined, summary: string(row.description ?? row.story) ?? title, tags: [this.sport, league.league.toUpperCase(), 'ESPN_LEAGUE_NEWS'] }];
    });
  }
}

export function createEspnLeagueNewsProvider(sport: ValidatedSlate['sport'], fetcher?: typeof fetch): EspnLeagueNewsProvider { return new EspnLeagueNewsProvider(sport, fetcher); }
