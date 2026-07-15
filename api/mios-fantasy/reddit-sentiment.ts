import type { VercelRequest, VercelResponse } from '@vercel/node';

// Agent 3: Reddit Sentiment (PRAW simulation)
// For Build Core, this is intentionally mocked. In Refinement, integrate actual PRAW library.
export async function collectRedditSentiment(playerId: string, _sport: string): Promise<any> {
  try {
    const mockSentiment = Math.random(); // 0-1 scale

    return {
      player_id: playerId,
      reddit_mentions: Math.floor(Math.random() * 100),
      sentiment_score: mockSentiment - 0.5, // -0.5 to 0.5
      key_themes: mockSentiment > 0.6 ? ['breakout'] : mockSentiment < 0.4 ? ['injury_concern'] : ['neutral'],
      last_updated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('Reddit sentiment error:', error);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const playerId = String(req.query.playerId ?? '');
  const sport = String(req.query.sport ?? '');
  const sentiment = await collectRedditSentiment(playerId, sport);
  res.status(200).json(sentiment);
}
