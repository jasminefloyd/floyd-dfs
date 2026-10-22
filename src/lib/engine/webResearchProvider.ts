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
interface SearchBatch { kind: 'GAME' | 'PLAYER'; subjects: string[]; query: string; }
const serpCache = new Map<string, { expiresAt: number; articles: ResearchArticle[] }>();

function searchBatches(slate: ValidatedSlate, plan: ResearchPlan, batchSize: number): SearchBatch[] {
  const date = new Date(slate.event.eventDate).toISOString().slice(0, 10);
  const pairs = new Set<string>();
  for (const game of slate.games ?? []) {
    const teams = game.teamIds.map((team) => String(team).trim()).filter(Boolean);
    if (teams.length === 2) pairs.add(teams.sort().join('@'));
  }
  if (!pairs.size) for (const player of slate.playerPool) if (player.team && player.opponent) pairs.add([player.team, player.opponent].sort().join('@'));
  const gamePairs = [...pairs].sort();
  const byId = new Map(slate.playerPool.map((player) => [player.playerId, player]));
  const priorityPlayers = plan.questions.flatMap((question) => question.subjectId && byId.has(question.subjectId) ? [byId.get(question.subjectId)!] : []);
  const priorityIds = new Set(priorityPlayers.map((player) => player.playerId));
  const players = [...priorityPlayers, ...slate.playerPool.filter((player) => !priorityIds.has(player.playerId)).sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0) || a.playerId.localeCompare(b.playerId))];
  const batches: SearchBatch[] = [];
  for (let index = 0; index < gamePairs.length; index += batchSize) {
    const subjects = gamePairs.slice(index, index + batchSize);
    batches.push({ kind: 'GAME', subjects, query: `${slate.sport} ${date} ${subjects.map((pair) => pair.replace('@', ' vs ')).join(' OR ')} injury lineup news` });
  }
  const playerNames = players.map((player) => player.playerName);
  for (let index = 0; index < playerNames.length; index += batchSize) {
    const subjects = playerNames.slice(index, index + batchSize);
    batches.push({ kind: 'PLAYER', subjects, query: `${slate.sport} ${date} ${subjects.map((name) => `"${name}"`).join(' OR ')} injury minutes role news` });
  }
  return batches;
}

export class SerpApiResearchProvider implements ResearchSourceProvider {
  readonly name = 'SerpAPI'; readonly tier = 3 as const;
  private readonly apiKey: string; private readonly fetcher: typeof fetch; private readonly baseUrl: string; private readonly queryBudget: number; private readonly batchSize: number;
  constructor(apiKey: string, fetcher: typeof fetch = fetch, baseUrl = 'https://serpapi.com/search.json', options: { queryBudget?: number; batchSize?: number } = {}) { this.apiKey = apiKey; this.fetcher = fetcher; this.baseUrl = baseUrl; this.queryBudget = Math.max(1, Math.min(20, Math.floor(options.queryBudget ?? 8))); this.batchSize = Math.max(1, Math.min(10, Math.floor(options.batchSize ?? 5))); }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const batches = searchBatches(input.slate, input.plan, this.batchSize);
    const selected = batches.slice(0, this.queryBudget);
    const attemptedGames = new Set(selected.filter((batch) => batch.kind === 'GAME').flatMap((batch) => batch.subjects));
    const attemptedPlayers = new Set(selected.filter((batch) => batch.kind === 'PLAYER').flatMap((batch) => batch.subjects));
    const allGames = new Set(batches.filter((batch) => batch.kind === 'GAME').flatMap((batch) => batch.subjects));
    const allPlayers = new Set(batches.filter((batch) => batch.kind === 'PLAYER').flatMap((batch) => batch.subjects));
    const articles: ResearchArticle[] = [];
    const diagnostics: ResearchArticle[] = [];
    for (const [index, batch] of selected.entries()) {
      const cacheKey = `${input.slate.tenantId}:${batch.query}`;
      const cached = serpCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) { articles.push(...cached.articles); continue; }
      const url = new URL(this.baseUrl); url.searchParams.set('engine', 'google_news'); url.searchParams.set('q', batch.query); url.searchParams.set('api_key', this.apiKey); url.searchParams.set('num', '5');
      try {
        const response = await this.fetcher(url, { signal: input.signal, headers: { accept: 'application/json' } });
        if (!response.ok) {
          diagnostics.push({ title: `${this.name} ${batch.kind.toLowerCase()} batch ${index + 1}`, sourceName: this.name, sourceTier: this.tier, diagnostic: { status: 'FAILED', httpStatus: response.status, error: `SerpAPI ${batch.kind.toLowerCase()} batch returned HTTP ${response.status}.` } });
          if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
          continue;
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!/^application\/(json|[a-z0-9.+-]+\+json)(\s*;|$)/i.test(contentType)) throw new Error(`SerpAPI returned non-JSON content type: ${contentType || 'missing'}.`);
        const payload = object(await response.json());
        const news = Array.isArray(payload?.news_results) ? payload.news_results : [];
        const batchArticles = news.flatMap((item, resultIndex) => { const row = object(item); if (!row) return []; const title = string(row.title); const link = string(row.link); return [{ title: title ?? `SerpAPI result ${resultIndex + 1}`, url: link, sourceName: this.name, sourceTier: this.tier, publishedAt: normalizeResearchPublishedAt(row.date), summary: string(row.snippet) ?? title, tags: [input.slate.sport, 'SERPAPI', `BATCH_${index + 1}`, batch.kind] }]; });
        serpCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, articles: batchArticles });
        articles.push(...batchArticles);
        diagnostics.push({ title: `${this.name} ${batch.kind.toLowerCase()} batch ${index + 1}`, sourceName: this.name, sourceTier: this.tier, diagnostic: { status: batchArticles.length ? 'SUCCEEDED' : 'EMPTY', coverage: `${batch.kind} batch ${index + 1}/${selected.length}: covered ${batch.subjects.length} subjects and returned ${batchArticles.length} articles.` } });
      } catch (error) {
        diagnostics.push({ title: `${this.name} ${batch.kind.toLowerCase()} batch ${index + 1}`, sourceName: this.name, sourceTier: this.tier, diagnostic: { status: 'FAILED', error: error instanceof Error ? error.message : 'SerpAPI batch failed.' } });
      }
    }
    const coverage = `Research query budget ${selected.length}/${batches.length}; game coverage ${attemptedGames.size}/${allGames.size}; player coverage ${attemptedPlayers.size}/${allPlayers.size}.`;
    diagnostics.push({ title: `${this.name} coverage`, sourceName: this.name, sourceTier: this.tier, diagnostic: { status: 'SUCCEEDED', coverage } });
    return [...articles, ...diagnostics];
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
