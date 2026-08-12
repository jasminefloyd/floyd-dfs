import { sourceReliability, type LiveSlatePlayerState } from '../_shared/wnbaLateSwap.ts';
interface Body { snapshotId?: string; contestDate: string; contestType: 'classic' | 'showdown'; contestId?: string; rows: LiveSlatePlayerState[]; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json() as Body; const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key || !/^\d{4}-\d{2}-\d{2}$/.test(body.contestDate) || !['classic', 'showdown'].includes(body.contestType) || !Array.isArray(body.rows) || !body.rows.length) throw new Error('Authorized WNBA live-state metadata and rows are required.');
    if (body.rows.some((row) => !row.player_name || !['unlocked', 'locked', 'started', 'final', 'postponed'].includes(row.game_state) || sourceReliability(row.source, row.source_reliability) === undefined || !Number.isFinite(Date.parse(row.observed_at)))) throw new Error('Each state row requires a player, valid state, approved source tier, reliability, and timestamp.');
    const response = await fetch(`${url}/rest/v1/wnba_live_slate_states`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body.rows.map((row) => ({ snapshot_id: body.snapshotId ?? null, contest_date: body.contestDate, contest_type: body.contestType, contest_id: body.contestId ?? null, player_id: row.player_id ?? null, player_name: row.player_name, team: row.team ?? null, game_id: row.game_id ?? null, game_state: row.game_state, player_state: row.player_state, accrued_points: row.accrued_points ?? null, source: row.source, source_reliability: sourceReliability(row.source, row.source_reliability), observed_at: row.observed_at }))) });
    if (!response.ok) throw new Error(await response.text()); const rows = await response.json() as unknown[];
    return json({ imported: rows.length });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
