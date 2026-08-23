import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Compatibility adapter only. MIOS has one canonical implementation in the
 * Supabase Edge Function. Keeping this route as a thin proxy prevents the old
 * Vercel collector from producing a different manifest contract.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    res.status(500).json({ error: 'Supabase environment is not configured.' });
    return;
  }

  let body: unknown = req.body ?? {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/fantasy-mios-scan`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();

  res.status(response.status)
    .setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json')
    .send(responseText);
}
