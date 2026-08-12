interface OwnershipRow { player_name: string; player_id?: string; roster_slot?: 'CPT' | 'FLEX'; ownership_pct: number; }
interface RequestBody { contestDate: string; contestType: 'classic' | 'showdown'; contestId?: string; fieldSize?: number; entryLimit?: number; payoutShape?: string; lockTime?: string; source: 'draftkings_contest_export'; rows: OwnershipRow[]; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
async function rpc<T>(body: RequestBody) {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !key) throw new Error('Service-role configuration is required.');
  const response = await fetch(`${url}/rest/v1/wnba_observed_ownership`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body.rows.map((row) => ({ contest_date: body.contestDate, contest_type: body.contestType, contest_id: body.contestId ?? null, player_id: row.player_id ?? null, player_name: row.player_name, roster_slot: row.roster_slot ?? 'FLEX', ownership_pct: row.ownership_pct, field_size: body.fieldSize ?? null, entry_limit: body.entryLimit ?? null, payout_shape: body.payoutShape ?? null, lock_time: body.lockTime ?? null, source: body.source }))) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`); return await response.json() as T;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json() as RequestBody;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.contestDate) || !['classic', 'showdown'].includes(body.contestType) || body.source !== 'draftkings_contest_export') throw new Error('Authorized WNBA contest metadata is required.');
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.some((row) => !row.player_name || !Number.isFinite(Number(row.ownership_pct)) || Number(row.ownership_pct) < 0 || Number(row.ownership_pct) > 100)) throw new Error('Ownership rows require player_name and ownership_pct between 0 and 100.');
    const inserted = await rpc<Array<unknown>>(body); return json({ imported: inserted.length, source: body.source });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
