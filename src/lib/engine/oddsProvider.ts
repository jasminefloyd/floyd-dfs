import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, ValidatedSlate } from './contracts.js';

export interface OddsResearchProviderOptions { apiKey: string; baseUrl?: string; sportKey?: string; fetcher?: typeof fetch; }
export class OddsResearchProvider implements ResearchSourceProvider {
  readonly name = 'The Odds API'; readonly tier = 1 as const;
  private readonly options: OddsResearchProviderOptions; private readonly fetcher: typeof fetch;
  constructor(options: OddsResearchProviderOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const sportKey = this.options.sportKey ?? oddsApiSportKey(input.slate.sport);
    if (!sportKey) return [];
    const baseUrl = (this.options.baseUrl ?? 'https://api.the-odds-api.com').replace(/\/+$/, '');
    const apiBase = baseUrl.endsWith('/v4') ? baseUrl : `${baseUrl}/v4`;
    const url = new URL(`sports/${sportKey}/odds`, `${apiBase}/`); url.searchParams.set('apiKey', this.options.apiKey); url.searchParams.set('regions', 'us'); url.searchParams.set('markets', 'h2h,spreads,totals');
    const response = await this.fetcher(url, { signal: input.signal, headers: { accept: 'application/json' } }); if (!response.ok) throw new Error(`The Odds API returned HTTP ${response.status}.`); const payload = await response.json() as unknown[];
    return payload.slice(0, 25).map((event, index) => ({ title: `${input.slate.sport} market context ${index + 1}`, sourceName: this.name, sourceTier: this.tier, summary: JSON.stringify(event).slice(0, 1200), tags: ['MARKET_SIGNALS', input.slate.sport] }));
  }
}

function oddsApiSportKey(sport: ValidatedSlate['sport']): string | undefined {
  return ({ MLB: 'baseball_mlb', NBA: 'basketball_nba', WNBA: 'basketball_wnba', NFL: 'americanfootball_nfl', GOLF: 'golf_pga' } as const)[sport];
}
