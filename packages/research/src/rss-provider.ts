import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, ValidatedSlate, SourceTier } from "@sports-engine/contracts";

export interface RssFeedConfig { url: string; name: string; tier: SourceTier; tags?: string[]; }

export const DEFAULT_RSS_FEEDS: readonly RssFeedConfig[] = [
  { url: "https://dknetwork.draftkings.com/feed/", name: "DraftKings Network", tier: 3, tags: ["draftkings"] },
  { url: "https://feeds.megaphone.fm/dkndailybets", name: "DK Daily Bets", tier: 3, tags: ["draftkings", "betting"] },
  { url: "https://www.espn.com/espn/rss/news", name: "ESPN News", tier: 2 },
  { url: "https://www.espn.com/espn/rss/nfl/news", name: "ESPN NFL", tier: 2, tags: ["NFL"] },
  { url: "https://www.espn.com/espn/rss/nba/news", name: "ESPN NBA", tier: 2, tags: ["NBA"] },
  { url: "https://www.espn.com/espn/rss/mlb/news", name: "ESPN MLB", tier: 2, tags: ["MLB"] },
  { url: "https://www.espn.com/espn/rss/golf/news", name: "ESPN Golf", tier: 2, tags: ["GOLF"] },
  { url: "https://www.rotowire.com/rss/news.php?sport=NFL", name: "RotoWire NFL", tier: 3, tags: ["NFL"] },
  { url: "https://www.rotowire.com/rss/news.php?sport=MLB", name: "RotoWire MLB", tier: 3, tags: ["MLB"] },
  { url: "https://www.rotowire.com/rss/news.php?sport=NBA", name: "RotoWire NBA", tier: 3, tags: ["NBA"] },
  { url: "https://www.rotowire.com/rss/news.php?sport=GOLF", name: "RotoWire Golf", tier: 3, tags: ["GOLF"] },
];

export function createDefaultRssProviders(fetcher?: typeof fetch): RssResearchProvider[] {
  return DEFAULT_RSS_FEEDS.map((feed) => new RssResearchProvider(feed, fetcher));
}

export class RssResearchProvider implements ResearchSourceProvider {
  readonly name: string;
  readonly tier: SourceTier;
  constructor(private readonly feed: RssFeedConfig, private readonly fetcher: typeof fetch = fetch) {
    this.name = feed.name;
    this.tier = feed.tier;
  }

  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const response = await this.fetcher(this.feed.url, { signal: input.signal as AbortSignal | undefined, headers: { accept: "application/rss+xml, application/xml, text/xml" } });
    // 304 means the feed has not changed. This provider does not persist an
    // HTTP cache body yet, so there are no new articles to normalize here.
    if (response.status === 304) return [];
    if (!response.ok) throw new Error(`${this.name} RSS returned HTTP ${response.status}.`);
    return parseRss(await response.text(), this.feed);
  }
}

export function parseRss(xml: string, feed: RssFeedConfig, retrievedAt = new Date()): ResearchArticle[] {
  const articles: ResearchArticle[] = [];
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = cleanXml(readTag(item, "title"));
    const url = cleanXml(readTag(item, "link")) || undefined;
    const description = cleanXml(readTag(item, "description")) || undefined;
    const published = cleanXml(readTag(item, "pubDate")) || cleanXml(readTag(item, "published"));
    if (!title) continue;
    const date = published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined;
    articles.push({ title, url, sourceName: feed.name, sourceTier: feed.tier, publishedAt: date, summary: description, tags: feed.tags });
  }
  return articles.map((article) => ({ ...article, content: article.content ?? `Retrieved ${retrievedAt.toISOString()}.` }));
}

function readTag(item: string, tag: string): string | undefined {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1];
}

function cleanXml(value?: string): string {
  return (value ?? "")
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}
