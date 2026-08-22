import type { VercelRequest, VercelResponse } from '@vercel/node';

function env(name: string) { return process.env[name] ?? ''; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) return res.status(500).json({ error: 'Supabase environment is not configured.' });
  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/run-learning-cycle`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ include_weekly: new Date().getUTCDay() === 0, send_email: true }),
  });
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* preserve raw */ }
  return res.status(response.ok ? 200 : 502).json({ ok: response.ok, data });
}
