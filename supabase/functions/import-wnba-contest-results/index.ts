interface ImportRow { generated_lineup_id: string; finish_rank?: number; field_size?: number; cash_line?: number; entry_fee?: number; payout?: number; actual_duplicates?: number; }
interface ImportRequest { contestDate: string; contestType: string; contestId?: string; source: 'draftkings_contest_export'; rows: ImportRow[]; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const clean = (value: unknown) => String(value ?? '').trim();
async function rpc<T>(name: string, body: Record<string, unknown>) {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Service-role configuration is required.');
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!result.ok) throw new Error(`${name}: ${result.status} ${await result.text()}`);
  return await result.json() as T;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    const request = await req.json() as ImportRequest;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(request.contestDate)) || !['classic', 'showdown'].includes(clean(request.contestType).toLowerCase())) throw new Error('A valid WNBA contest date and type are required.');
    if (request.source !== 'draftkings_contest_export' || !Array.isArray(request.rows) || !request.rows.length) throw new Error('A non-empty authorized DraftKings contest export is required.');
    if (request.rows.some((row) => !/^[0-9a-f-]{36}$/i.test(clean(row.generated_lineup_id)))) throw new Error('Each import row needs a generated_lineup_id UUID; imports never match lineups by name.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request.rows)));
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    const updated = await rpc<number>('fantasy_ai_import_wnba_contest_results', { p_contest_date: request.contestDate, p_contest_type: request.contestType, p_contest_id: request.contestId ?? '', p_source: request.source, p_imported_by: null, p_payload_hash: hash, p_rows: request.rows });
    return response({ updated, rows_received: request.rows.length, source: request.source, idempotency_hash: hash });
  } catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
