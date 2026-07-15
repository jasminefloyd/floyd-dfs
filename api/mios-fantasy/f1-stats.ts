import type { VercelRequest, VercelResponse } from '@vercel/node';
import { limitedFetch } from './rate-limiter';

// Agent 5: OpenF1 driver list (F1 only)
// Verified with GET on 2026-07-15. The old Ergast endpoint was unreachable, so Core
// uses OpenF1 for the driver roster and keeps performance projections conservative.
export async function collectF1Stats(season: number, round: number): Promise<any[]> {
  try {
    void season;
    void round;
    const response = await limitedFetch('https://api.openf1.org/v1/drivers?session_key=latest', 'openf1', {
      timeoutMs: 10_000,
      retries: 1
    });
    if (!response.ok) throw new Error(`OpenF1 ${response.status}`);
    const data: any = await response.json();

    return data.map((driver: any) => ({
      driver_id: String(driver.driver_number),
      name: driver.full_name,
      team: driver.team_name,
      position: 'DRIVER',
      nationality: driver.country_code,
      headshot_url: driver.headshot_url
    }));
  } catch (error) {
    console.error('OpenF1 error:', error);
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const season = Number(req.query.season ?? 2026);
  const round = Number(req.query.round ?? 1);
  const drivers = await collectF1Stats(season, round);
  res.status(200).json(drivers);
}
