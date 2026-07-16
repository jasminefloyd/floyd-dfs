import type { VercelRequest, VercelResponse } from '@vercel/node';
import { limitedFetch } from './rate-limiter.js';

// Agent 3: Reddit sentiment
// Reddit's public JSON search returned 403 in a direct verification check on 2026-07-15.
// This collector therefore returns an explicit unavailable result instead of random data.
export async function collectRedditSentiment(playerId: string, sport: string): Promise<any> {
  try {
    const subreddit = sport === 'f1' ? 'formula1' : sport;
    const response = await limitedFetch(
      `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(playerId)}&restrict_sr=1&limit=10`,
      'reddit',
      { headers: { 'User-Agent': 'fantasy-ai-core/1.0' } }
    );

    if (!response.ok) {
      return {
        player_id: playerId,
        reddit_mentions: 0,
        sentiment_score: 0,
        key_themes: ['reddit_unavailable'],
        source_status: 'unavailable',
        last_updated_at: new Date().toISOString()
      };
    }

    const data: any = await response.json();
    const posts = data?.data?.children ?? [];
    const text = posts
      .map((post: any) => `${post?.data?.title ?? ''} ${post?.data?.selftext ?? ''}`)
      .join(' ')
      .toLowerCase();
    const positive = ['breakout', 'hot', 'healthy', 'starting', 'upgrade', 'smash'];
    const negative = ['injury', 'out', 'questionable', 'limited', 'slump', 'bench'];
    const posHits = positive.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    const negHits = negative.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    const sentiment = Math.max(-1, Math.min(1, (posHits - negHits) / 5));

    const themes = [
      posHits > 0 ? 'positive_buzz' : null,
      negHits > 0 ? 'risk_mentions' : null,
      posts.length === 0 ? 'no_mentions' : null
    ].filter(Boolean);

    return {
      player_id: playerId,
      reddit_mentions: posts.length,
      sentiment_score: sentiment,
      key_themes: themes.length ? themes : ['neutral'],
      source_status: 'ok',
      last_updated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('Reddit sentiment error:', error);
    return {
      player_id: playerId,
      reddit_mentions: 0,
      sentiment_score: 0,
      key_themes: ['reddit_unavailable'],
      source_status: 'unavailable',
      last_updated_at: new Date().toISOString()
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const playerId = String(req.query.playerId ?? '');
  const sport = String(req.query.sport ?? '');
  const sentiment = await collectRedditSentiment(playerId, sport);
  res.status(200).json(sentiment);
}
