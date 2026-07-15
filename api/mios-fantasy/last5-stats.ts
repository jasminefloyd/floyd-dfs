import type { VercelRequest, VercelResponse } from '@vercel/node';

// Agent 2: ESPN Stats API - Last 5 Games
// NOTE: this endpoint returned 404 when verified on 2026-07-14 (path looks malformed:
// duplicated "site/api/site/v2" segments). Left as-is per instruction to keep it as a
// real fetch call that fails gracefully via the existing try/catch, rather than inventing
// a replacement API. Confirm the real ESPN stats endpoint before relying on this in production.
export async function collectLast5Stats(playerId: string, sport: string): Promise<any> {
  const apiMap: Record<string, string | null> = {
    nba: `https://site.api.espn.com/v2/site/api/site/v2/sports/basketball/nba/players/${playerId}/statistics`,
    wnba: `https://site.api.espn.com/v2/site/api/site/v2/sports/basketball/wnba/players/${playerId}/statistics`,
    nfl: `https://site.api.espn.com/v2/site/api/site/v2/sports/football/nfl/players/${playerId}/statistics`,
    mlb: `https://site.api.espn.com/v2/site/api/site/v2/sports/baseball/mlb/players/${playerId}/statistics`,
    f1: null // Use Ergast for F1
  };

  try {
    const url = apiMap[sport];
    if (!url) return null;

    const response = await fetch(url);
    const data: any = await response.json();

    // Parse last 5 games from response
    const games = data.stats?.slice(0, 5) || [];

    // Compute aggregated stats
    const totals: Record<string, number> = {};
    games.forEach((game: any) => {
      Object.keys(game).forEach((key) => {
        totals[key] = (totals[key] || 0) + (game[key] || 0);
      });
    });

    const avg: Record<string, number> = {};
    Object.keys(totals).forEach((key) => {
      avg[key] = totals[key] / games.length;
    });

    return {
      player_id: playerId,
      games_data: games,
      aggregated_stats: avg,
      confidence_score: games.length === 5 ? 0.9 : 0.7,
      last_updated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`ESPN Stats API error for ${playerId}:`, error);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const playerId = String(req.query.playerId ?? '');
  const sport = String(req.query.sport ?? '');
  const stats = await collectLast5Stats(playerId, sport);
  res.status(200).json(stats);
}
