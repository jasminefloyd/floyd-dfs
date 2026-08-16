interface ResultRow {
  generated_lineup_id: string;
  sport: 'nba' | 'wnba' | 'mlb' | 'nfl' | 'golf';
  contest_date: string;
  contest_type: 'classic' | 'showdown';
  field_size?: number;
  finish_rank?: number;
  entry_fee?: number;
  payout?: number;
  entry_count?: number;
  actual_duplicates?: number;
  cash_line?: number;
}

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const validSports = new Set(['nba', 'wnba', 'mlb', 'nfl', 'golf']);
const validTypes = new Set(['classic', 'showdown']);

function serviceRole() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY'); }
function authorized(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return Boolean(token && (token === serviceRole() || token.split('.')[1] && (() => {
    try { const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.split('.')[1].length / 4) * 4, '='))); return payload.role === 'service_role'; } catch { return false; }
  })()));
}
async function importRows(rows: ResultRow[]) {
  const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
  const key = serviceRole();
  if (!url || !key) throw new Error('Supabase service-role configuration is required.');
  const result = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/fantasy_ai_import_contest_results`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_rows: rows }),
  });
  if (!result.ok) throw new Error(`Contest result import failed: ${result.status} ${await result.text()}`);
  return await result.json() as number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return response({ error: 'Service-role authorization is required.' }, 401);
  try {
    const body = await req.json() as { rows?: ResultRow[] };
    const rows = body.rows ?? [];
    if (!rows.length || rows.length > 5000) throw new Error('Provide between 1 and 5000 contest result rows.');
    for (const row of rows) {
      if (!/^[0-9a-f-]{36}$/i.test(String(row.generated_lineup_id ?? ''))) throw new Error('Each row requires a generated_lineup_id UUID.');
      if (!validSports.has(row.sport) || !validTypes.has(row.contest_type) || !/^\d{4}-\d{2}-\d{2}$/.test(row.contest_date)) throw new Error('Each row requires valid sport, contest type, and contest date.');
      if (row.field_size !== undefined && (!Number.isInteger(row.field_size) || row.field_size < 1)) throw new Error('field_size must be a positive integer.');
      if (row.finish_rank !== undefined && (!Number.isInteger(row.finish_rank) || row.finish_rank < 1)) throw new Error('finish_rank must be a positive integer.');
    }
    const updated = await importRows(rows);
    return response({ updated, received: rows.length, unmatched: rows.length - updated, captured_at: new Date().toISOString() });
  } catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
