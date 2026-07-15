import type { VercelRequest, VercelResponse } from '@vercel/node';

// Agent 1: ESPN RSS News & Injuries
export async function collectNewsAndInjuries(sport: string, _contestDate: string): Promise<any[]> {
  const sportMap: Record<string, string> = {
    nba: 'https://feeds.espn.com/feeds/site/espn/nba/news',
    wnba: 'https://feeds.espn.com/feeds/site/espn/wnba/news',
    nfl: 'https://feeds.espn.com/feeds/site/espn/nfl/news',
    mlb: 'https://feeds.espn.com/feeds/site/espn/mlb/news',
    f1: 'https://feeds.espn.com/feeds/site/espn/racing/f1/news'
  };

  try {
    const feedUrl = sportMap[sport] || '';
    const response = await fetch(feedUrl);
    const xml = await response.text();

    // Parse XML for injury keywords (out, doubtful, questionable, day-to-day)
    const injuries = [];
    const lines = xml.split('\n');

    for (const line of lines) {
      if (line.includes('out') || line.includes('injured') || line.includes('questionable')) {
        injuries.push({
          raw: line,
          timestamp: new Date().toISOString()
        });
      }
    }

    return injuries;
  } catch (error) {
    console.error('ESPN RSS error:', error);
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sport = String(req.query.sport ?? '');
  const contestDate = String(req.query.contestDate ?? '');
  const injuries = await collectNewsAndInjuries(sport, contestDate);
  res.status(200).json(injuries);
}
