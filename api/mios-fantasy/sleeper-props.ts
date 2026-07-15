import type { VercelRequest, VercelResponse } from '@vercel/node';

// Agent 4: Sleeper API (NBA/WNBA only)
// NOTE: verified 2026-07-14. The real endpoint is /v1/players/{sport} (sport as a string
// slug: "nba" | "wnba"), and it returns an object keyed by player_id, not an array. The
// field for team abbreviation is "team", not "nfl_team".
export async function collectSleeperProps(sport: string, _contestDate: string): Promise<any[]> {
  if (!['nba', 'wnba'].includes(sport)) return [];

  try {
    const response = await fetch(`https://api.sleeper.app/v1/players/${sport}`);
    const data = (await response.json()) as Record<string, any>;

    return Object.values(data)
      .slice(0, 100)
      .map((player: any) => ({
        player_id: player.player_id,
        name: player.full_name,
        position: player.position,
        team: player.team
      }));
  } catch (error) {
    console.error('Sleeper error:', error);
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sport = String(req.query.sport ?? '');
  const contestDate = String(req.query.contestDate ?? '');
  const props = await collectSleeperProps(sport, contestDate);
  res.status(200).json(props);
}
