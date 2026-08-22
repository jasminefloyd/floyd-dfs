import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPORTS = ['nba', 'wnba', 'mlb', 'nfl'] as const;

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
}

function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function invoke(url: string, key: string, functionName: string, body: Record<string, unknown>) {
  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Preserve the raw response for diagnostics.
  }
  return { functionName, status: response.status, ok: response.ok, data };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase environment is not configured.' });
    return;
  }

  const contestDate = typeof req.query.date === 'string' ? req.query.date : todayUtc();
  const dates = [contestDate, addUtcDays(contestDate, 1)];
  const results = await Promise.all(dates.flatMap((gameDate) => SPORTS.flatMap((sport) => [
    invoke(url, key, 'scrape-ownership', { sport, contestDate: gameDate }),
    invoke(url, key, 'scrape-confirmed-lineups', { sport, game_date: gameDate }),
  ])));
  const understand = await invoke(url, key, 'ingest-understand-events', {
    sports: SPORTS,
    include_market: true,
  });
  results.push(understand);
  const failed = results.filter((result) => !result.ok);

  res.status(failed.length ? 207 : 200).json({
    contestDate,
    dates,
    generatedAt: new Date().toISOString(),
    results,
    failedCount: failed.length,
  });
}
