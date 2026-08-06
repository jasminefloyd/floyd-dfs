import type { VercelRequest, VercelResponse } from '@vercel/node';

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
}

function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) {
    res.status(500).json({ error: 'Supabase environment is not configured.' });
    return;
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/cleanup-pios-relationships`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const text = await response.text();

  res.status(response.ok ? 200 : response.status)
    .setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json');
  res.send(text);
}
