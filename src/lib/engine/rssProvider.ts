import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, ValidatedSlate } from './contracts.js';

export interface RssFeedConfig { url: string; name: string; tier: SourceTier; tags?: string[]; }
export const DEFAULT_RSS_FEEDS: readonly RssFeedConfig[] = [
  { url: 'https://dknetwork.draftkings.com/feed/', name: 'DraftKings Network', tier: 3, tags: ['draftkings'] },
  { url: 'https://feeds.megaphone.fm/dkndailybets', name: 'DK Daily Bets', tier: 3, tags: ['draftkings', 'betting'] },
  { url: 'https://www.espn.com/espn/rss/news', name: 'ESPN News', tier: 2 },
  { url: 'https://www.espn.com/espn/rss/nfl/news', name: 'ESPN NFL', tier: 2, tags: ['NFL'] },
  { url: 'https://www.espn.com/espn/rss/nba/news', name: 'ESPN NBA', tier: 2, tags: ['NBA'] },
  { url: 'https://www.espn.com/espn/rss/wnba/news', name: 'ESPN WNBA', tier: 2, tags: ['WNBA'] },
  { url: 'https://www.espn.com/espn/rss/mlb/news', name: 'ESPN MLB', tier: 2, tags: ['MLB'] },
  { url: 'https://www.espn.com/espn/rss/golf/news', name: 'ESPN Golf', tier: 2, tags: ['GOLF'] },
  { url: 'https://www.rotowire.com/rss/news.php?sport=NFL', name: 'RotoWire NFL', tier: 3, tags: ['NFL'] },
  { url: 'https://www.rotowire.com/rss/news.php?sport=MLB', name: 'RotoWire MLB', tier: 3, tags: ['MLB'] },
  { url: 'https://www.rotowire.com/rss/news.php?sport=NBA', name: 'RotoWire NBA', tier: 3, tags: ['NBA'] },
  { url: 'https://www.rotowire.com/rss/news.php?sport=GOLF', name: 'RotoWire Golf', tier: 3, tags: ['GOLF'] },
];

// The site ticker is league news, not the broader research feed. Keep this
// source allowlist separate from DEFAULT_RSS_FEEDS because the engine's
// research stage may use fantasy-oriented context while the global ticker may
// not.
export const LEAGUE_NEWS_RSS_FEEDS: readonly RssFeedConfig[] = DEFAULT_RSS_FEEDS.filter((feed) => feed.name.startsWith('ESPN ') && feed.tags?.some((tag) => ['NFL', 'NBA', 'WNBA', 'MLB', 'GOLF'].includes(tag)));

export class RssResearchProvider implements ResearchSourceProvider {
  readonly name: string;
  readonly tier: SourceTier;
  private readonly feed: RssFeedConfig;
  private readonly fetcher: typeof fetch;
  constructor(feed: RssFeedConfig, fetcher: typeof fetch = fetch) { this.feed = feed; this.fetcher = fetcher; this.name = feed.name; this.tier = feed.tier; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const response = await this.fetcher(this.feed.url, { signal: input.signal, headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
    if (response.status === 304) return [];
    if (!response.ok) throw new Error(`${this.name} RSS returned HTTP ${response.status}.`);
    return parseRss(await response.text(), this.feed);
  }
}

export function createDefaultRssProviders(fetcher?: typeof fetch): RssResearchProvider[] { return DEFAULT_RSS_FEEDS.map((feed) => new RssResearchProvider(feed, fetcher)); }
export function createLeagueNewsProviders(fetcher?: typeof fetch): RssResearchProvider[] { return LEAGUE_NEWS_RSS_FEEDS.map((feed) => new RssResearchProvider(feed, fetcher)); }
export function parseRss(xml: string, feed: RssFeedConfig, retrievedAt = new Date()): ResearchArticle[] {
  return (xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []).flatMap((item) => {
    const title = cleanXml(readTag(item, 'title'));
    if (!title) return [];
    const published = cleanXml(readTag(item, 'pubDate')) || cleanXml(readTag(item, 'published'));
    return [{ title, url: cleanXml(readTag(item, 'link')) || undefined, sourceName: feed.name, sourceTier: feed.tier, publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined, summary: cleanXml(readTag(item, 'description')) || undefined, tags: feed.tags, content: `Retrieved ${retrievedAt.toISOString()}.` }];
  });
}
function readTag(item: string, tag: string): string | undefined { return item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]; }
function cleanXml(value?: string): string { return (value ?? '').replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').replace(/<[^>]+>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim(); }
