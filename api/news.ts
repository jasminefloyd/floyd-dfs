import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createDefaultRssProviders } from '../src/lib/engine/rssProvider.js';
import type { ResearchArticle } from '../src/lib/engine/contracts.js';
import { cors, method, respondError } from '../server/runtime.js';

// SportsNewsTicker (src/components/SportsNewsTicker.tsx) expects `{ items, generated_at,
// source_status }`, not the raw `{ articles }` the RSS providers return -- this maps one to the
// other. Sport is read from the feed's own tag (set per-feed in rssProvider.ts's
// DEFAULT_RSS_FEEDS); untagged feeds (general ESPN/DK Network feeds) fall back to 'general'
// rather than guessing a sport from article text. Category is a lightweight keyword heuristic,
// same spirit as the engine's other regex-based classification -- approximate, not authoritative.
const INJURY_PATTERN = /\binjur(?:y|ed|ies)\b|\bruled out\b|\bquestionable\b|\bday-to-day\b|\bIL\b/i;
const TRADE_PATTERN = /\btrade[ds]?\b|\bacquir(?:e|ed|es)\b/i;
const TRANSACTION_PATTERN = /\bsign(?:s|ed)?\b|\bwaive[ds]?\b|\bactivat(?:e|ed|es)\b|\bpromot(?:e|ed|es)\b|\brelease[ds]?\b|\bclaim(?:s|ed)?\b|\boption(?:s|ed)?\b/i;
function categorize(article: ResearchArticle): 'injury' | 'trade' | 'transaction' | 'news' {
  const text = `${article.title} ${article.summary ?? ''}`;
  if (INJURY_PATTERN.test(text)) return 'injury';
  if (TRADE_PATTERN.test(text)) return 'trade';
  if (TRANSACTION_PATTERN.test(text)) return 'transaction';
  return 'news';
}
const KNOWN_SPORTS = new Set(['nfl', 'nba', 'mlb', 'golf', 'wnba']);
function sportFor(article: ResearchArticle): string {
  const tag = article.tags?.find((candidate) => KNOWN_SPORTS.has(candidate.toLowerCase()));
  return tag ? tag.toLowerCase() : 'general';
}
function stableArticleId(article: ResearchArticle): string {
  const raw = `${article.url ?? ''}|${article.title}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) { hash ^= raw.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const providers = createDefaultRssProviders();
    const sourceStatus: Record<string, 'ok' | 'unavailable'> = {};
    const articles = (await Promise.all(providers.slice(0, 6).map(async (provider) => {
      try { const fetched = await provider.fetch({ slate: {} as never, plan: { slateId: 'news', generatedAt: new Date().toISOString(), questions: [] } }); sourceStatus[provider.name] = 'ok'; return fetched; }
      catch { sourceStatus[provider.name] = 'unavailable'; return []; }
    }))).flat().slice(0, 40);
    const items = articles.map((article) => ({
      id: stableArticleId(article),
      sport: sportFor(article),
      title: article.title,
      link: article.url ?? null,
      published_at: article.publishedAt ?? null,
      category: categorize(article),
      source_name: article.sourceName,
      source_kind: article.sourceName.toUpperCase().includes('ESPN') ? 'espn' as const : 'unknown' as const,
    }));
    cors(req, res);
    res.status(200).json({ items, generated_at: new Date().toISOString(), source_status: sourceStatus });
  } catch (error) { respondError(req, res, error); }
}
