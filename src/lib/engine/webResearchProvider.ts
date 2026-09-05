import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, ValidatedSlate } from './contracts.js';

type ObjectRow = Record<string, unknown>;
function object(value: unknown): ObjectRow | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectRow : undefined; }
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
export function normalizeResearchPublishedAt(value: unknown): string | undefined {
  const raw = string(value);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
function searchTerms(slate: ValidatedSlate): string { return `${slate.sport} ${slate.event.participants.join(' ')} ${slate.playerPool.slice(0, 8).map((player) => player.playerName).join(' ')}`.trim(); }

export class SerpApiResearchProvider implements ResearchSourceProvider {
  readonly name = 'SerpAPI'; readonly tier = 3 as const;
  private readonly apiKey: string; private readonly fetcher: typeof fetch; private readonly baseUrl: string;
  constructor(apiKey: string, fetcher: typeof fetch = fetch, baseUrl = 'https://serpapi.com/search.json') { this.apiKey = apiKey; this.fetcher = fetcher; this.baseUrl = baseUrl; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const url = new URL(this.baseUrl); url.searchParams.set('engine', 'google_news'); url.searchParams.set('q', searchTerms(input.slate)); url.searchParams.set('api_key', this.apiKey); url.searchParams.set('num', '5');
    const response = await this.fetcher(url, { signal: input.signal, headers: { accept: 'application/json' } }); if (!response.ok) throw new Error(`SerpAPI returned HTTP ${response.status}.`);
    const payload = object(await response.json()); const news = Array.isArray(payload?.news_results) ? payload.news_results : [];
    return news.flatMap((item, index) => { const row = object(item); if (!row) return []; const title = string(row.title); const link = string(row.link); return [{ title: title ?? `SerpAPI result ${index + 1}`, url: link, sourceName: this.name, sourceTier: this.tier, publishedAt: normalizeResearchPublishedAt(row.date), summary: string(row.snippet) ?? title, tags: [input.slate.sport, 'SERPAPI'] }]; });
  }
}

export class FirecrawlResearchProvider implements ResearchSourceProvider {
  readonly name = 'Firecrawl'; readonly tier = 3 as const;
  private readonly apiKey: string; private readonly discovery: SerpApiResearchProvider; private readonly fetcher: typeof fetch; private readonly maxPages: number;
  constructor(apiKey: string, discovery: SerpApiResearchProvider, fetcher: typeof fetch = fetch, maxPages = 2) { this.apiKey = apiKey; this.discovery = discovery; this.fetcher = fetcher; this.maxPages = maxPages; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const discovered = await this.discovery.fetch(input); const selected = discovered.filter((article) => article.url).slice(0, this.maxPages); const articles: ResearchArticle[] = [];
    for (const article of selected) {
      const response = await this.fetcher('https://api.firecrawl.dev/v1/scrape', { method: 'POST', signal: input.signal, headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ url: article.url, formats: ['markdown'], onlyMainContent: true }) });
      if (!response.ok) throw new Error(`Firecrawl returned HTTP ${response.status}.`);
      const payload = object(await response.json()); const data = object(payload?.data); const markdown = string(data?.markdown) ?? string(payload?.markdown);
      if (markdown) articles.push({ ...article, sourceName: this.name, content: markdown.slice(0, 5000), summary: markdown.slice(0, 1400), tags: [...(article.tags ?? []), 'FIRECRAWL'] });
    }
    return articles;
  }
}
