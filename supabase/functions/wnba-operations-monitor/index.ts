interface Body { maxSnapshotAgeMinutes?: number; contestDate?: string; contestType?: string; contestId?: string; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
async function post(url: string, key: string, path: string, body: unknown, merge = false) { const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: merge ? 'resolution=merge-duplicates,return=representation' : 'return=representation' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return await response.json() as unknown; }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Body; const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !key) throw new Error('Service-role configuration is required.');
    const signals = await post(url, key, '/rest/v1/rpc/fantasy_ai_wnba_operational_status', { p_max_snapshot_age_minutes: body.maxSnapshotAgeMinutes ?? 45 }) as Array<{ signal: string; severity: string; details: Record<string, unknown> }>;
    const events = signals.map((signal) => ({ event_key: signal.signal, severity: signal.severity, contest_date: String(signal.details.contest_date ?? body.contestDate ?? '') || null, contest_type: String(signal.details.contest_type ?? body.contestType ?? '') || null, contest_id: String(signal.details.contest_id ?? body.contestId ?? '') || null, details: signal.details }));
    if (events.length) await post(url, key, '/rest/v1/wnba_operational_events', events, true);
    return json({ healthy: !signals.some((signal) => signal.severity === 'critical'), signals, events_recorded: events.length });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
