import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, Sport, ValidatedSlate } from './contracts.js';
import { providerHttpError } from './providerDiagnostics.js';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined; }
function rows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => asObject(item) ? [item] : []);
  const object = asObject(value);
  for (const key of ['data', 'results', 'events', 'games', 'articles']) if (Array.isArray(object?.[key])) return (object[key] as unknown[]).flatMap((item): JsonObject[] => asObject(item) ? [asObject(item) as JsonObject] : []);
  return object ? [object] : [];
}
function text(value: unknown, fallback = ''): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function summarize(row: JsonObject): string {
  const preferred = ['status', 'state', 'date', 'startTime', 'homeTeam', 'awayTeam', 'home_team', 'away_team', 'venue', 'description', 'headline', 'name'];
  const values = preferred.flatMap((key) => row[key] === undefined ? [] : [`${key}: ${typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])}`]);
  return (values.length ? values.join('; ') : JSON.stringify(row)).slice(0, 1400);
}
function dateForSlate(slate: ValidatedSlate): string { const date = new Date(slate.event.eventDate); if (date.getUTCHours() < 6) date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10).replaceAll('-', ''); }
function sportPath(sport: Sport): string { return ({ NBA: 'basketball/nba', WNBA: 'basketball/wnba', MLB: 'baseball/mlb', NFL: 'football/nfl', CFB: 'football/college-football', GOLF: 'golf/pga' } as Record<Sport, string>)[sport]; }
function withTimeout(signal?: AbortSignal): AbortSignal | undefined { return signal; }

export interface JsonSportsProviderOptions { name: string; tier: SourceTier; apiKey?: string; baseUrl: string; path: (slate: ValidatedSlate) => string; headers?: Record<string, string>; fetcher?: typeof fetch; tags?: string[]; excludeSports?: Sport[]; }
export class JsonSportsResearchProvider implements ResearchSourceProvider {
  readonly name: string;
  readonly tier: SourceTier;
  private readonly options: JsonSportsProviderOptions;
  private readonly fetcher: typeof fetch;
  constructor(options: JsonSportsProviderOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; this.name = options.name; this.tier = options.tier; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    if (this.options.excludeSports?.includes(input.slate.sport)) return [];
    const url = new URL(this.options.path(input.slate), this.options.baseUrl.replace(/\/+$/, '') + '/');
    const response = await this.fetcher(url, { signal: withTimeout(input.signal), headers: { accept: 'application/json', ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}`, 'Ocp-Apim-Subscription-Key': this.options.apiKey } : {}), ...(this.options.headers ?? {}) } });
    if (!response.ok) throw await providerHttpError(this.name, response);
    const payload = await response.json() as unknown;
    return rows(payload).slice(0, 20).map((row, index) => ({
      title: text(row.title ?? row.headline ?? row.name, `${input.slate.sport} ${this.name} event ${index + 1}`),
      url: text(row.url ?? row.link, '') || undefined,
      sourceName: this.name,
      sourceTier: this.tier,
      publishedAt: parseDate(row.publishedAt ?? row.published_at ?? row.date ?? row.startTime),
      summary: summarize(row),
      tags: [input.slate.sport, ...(this.options.tags ?? [])],
    }));
  }
}

function parseDate(value: unknown): string | undefined { const valueText = text(value); return valueText && !Number.isNaN(Date.parse(valueText)) ? new Date(valueText).toISOString() : undefined; }

export function espnProvider(baseUrl: string, fetcher?: typeof fetch, options: { excludeSports?: Sport[] } = {}): JsonSportsResearchProvider {
  return new JsonSportsResearchProvider({ name: 'ESPN API', tier: 2, baseUrl, fetcher, excludeSports: options.excludeSports, path: (slate) => `/sports/${sportPath(slate.sport)}/scoreboard?dates=${dateForSlate(slate)}`, tags: ['ESPN'] });
}

export function ballDontLieProvider(baseUrl: string, apiKey: string, fetcher?: typeof fetch): JsonSportsResearchProvider {
  const normalized = baseUrl.replace(/\/account\/v1\/?$/, '/v1');
  return new JsonSportsResearchProvider({ name: 'BallDontLie', tier: 2, baseUrl: normalized, apiKey, fetcher, path: (slate) => `/games?start_date=${dateForSlate(slate)}&end_date=${dateForSlate(slate)}`, tags: ['BALLDONTLIE'] });
}
