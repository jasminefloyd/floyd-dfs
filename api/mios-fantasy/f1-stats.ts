import type { VercelRequest, VercelResponse } from '@vercel/node';

// Agent 5: Ergast F1 API (F1 only)
// NOTE: ergast.com returned 522 (unreachable) when verified on 2026-07-14, consistent with
// its known shutdown. Left as a real fetch call that fails gracefully via the existing
// try/catch, rather than inventing a replacement API. Confirm a real F1 data source before
// relying on this in production.
export async function collectF1Stats(season: number, round: number): Promise<any[]> {
  try {
    const response = await fetch(`https://ergast.com/api/f1/${season}/${round}/drivers.json`);
    const data: any = await response.json();

    const drivers = data.MRData?.DriverTable?.Drivers || [];
    return drivers.map((driver: any) => ({
      driver_id: driver.driverId,
      name: `${driver.givenName} ${driver.familyName}`,
      team: driver.Constructors?.[0]?.name,
      nationality: driver.nationality
    }));
  } catch (error) {
    console.error('Ergast F1 error:', error);
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const season = Number(req.query.season ?? 2026);
  const round = Number(req.query.round ?? 1);
  const drivers = await collectF1Stats(season, round);
  res.status(200).json(drivers);
}
