import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createLeagueNewsProviders } from '../src/lib/engine/rssProvider.js';
import { createEspnLeagueNewsProvider } from '../src/lib/engine/espnNewsProvider.js';
import type { ResearchArticle } from '../src/lib/engine/contracts.js';
import { cors, method, respondError } from '../server/runtime.js';

// SportsNewsTicker (src/components/SportsNewsTicker.tsx) expects `{ items, generated_at,
// source_status }`, not the raw `{ articles }` the RSS providers return. The ticker uses the
// league-specific ESPN allowlist only; fantasy, betting, and untagged general-news feeds are
// deliberately excluded rather than classified from article text.
const INJURY_PATTERN = /\binjur(?:y|ed|ies)\b|\bruled out\b|\bquestionable\b|\bday-to-day\b|\bIL\b/i;
const TRADE_PATTERN = /\btrade[ds]?\b|\bacquir(?:e|ed|es)\b/i;
const TRANSACTION_PATTERN = /\bsign(?:s|ed)?\b|\bwaive[ds]?\b|\bactivat(?:e|ed|es)\b|\bpromot(?:e|ed|es)\b|\brelease[ds]?\b|\bclaim(?:s|ed)?\b|\boption(?:s|ed)?\b/i;
const FANTASY_OR_BETTING_PATTERN = /\bfantasy\b|\bdfs\b|\bdaily fantasy\b|\bbett(?:ing|or|ors)\b|\bodds\b|\bsportsbook\b|\bprop bets?\b|\bwaiver wire\b|\bfanduel\b|\bdraftkings\b|\bparlay\b|\b(implied|moneyline|spread|over\/under)\b/i;
function categorize(article: ResearchArticle): 'injury' | 'trade' | 'transaction' | 'news' {
  const text = `${article.title} ${article.summary ?? ''}`;
  if (INJURY_PATTERN.test(text)) return 'injury';
  if (TRADE_PATTERN.test(text)) return 'trade';
  if (TRANSACTION_PATTERN.test(text)) return 'transaction';
  return 'news';
}
const KNOWN_SPORTS = new Set(['nfl', 'nba', 'mlb', 'golf', 'wnba', 'cfb']);
function sportFor(article: ResearchArticle): string {
  const tag = article.tags?.find((candidate) => KNOWN_SPORTS.has(candidate.toLowerCase()));
  return tag ? tag.toLowerCase() : 'general';
}
function isLeagueNews(article: ResearchArticle): boolean {
  const sport = sportFor(article);
  if (!KNOWN_SPORTS.has(sport)) return false;
  const text = `${article.title} ${article.summary ?? ''}`;
  return !FANTASY_OR_BETTING_PATTERN.test(text);
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
    const providers = [
      ...createLeagueNewsProviders(),
      ...(['NFL', 'NBA', 'WNBA', 'MLB', 'GOLF', 'CFB'] as const).map((sport) => createEspnLeagueNewsProvider(sport)),
    ];
    const sourceStatus: Record<string, 'ok' | 'unavailable'> = {};
    const items = (await Promise.all(providers.map(async (provider) => {
      try { const fetched = await provider.fetch({ slate: {} as never, plan: { slateId: 'news', generatedAt: new Date().toISOString(), questions: [] } }); sourceStatus[provider.name] = 'ok'; return fetched; }
      catch { sourceStatus[provider.name] = 'unavailable'; return []; }
    }))).flat().filter(isLeagueNews).sort((left, right) => Date.parse(right.publishedAt ?? '') - Date.parse(left.publishedAt ?? '')).map((article) => ({
      id: stableArticleId(article),
      sport: sportFor(article),
      title: article.title,
      link: article.url ?? null,
      published_at: article.publishedAt ?? null,
      category: categorize(article),
      source_name: article.sourceName,
      source_kind: article.sourceName.toUpperCase().includes('ESPN') ? 'espn' as const : 'league' as const,
    })).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 40);
    cors(req, res);
    res.status(200).json({ items, generated_at: new Date().toISOString(), source_status: sourceStatus });
  } catch (error) { respondError(req, res, error); }
}
