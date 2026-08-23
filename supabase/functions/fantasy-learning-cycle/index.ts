const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }
function url() { return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL'); }
function key() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY'); }

async function recordShadow(endpoint: string, serviceKey: string, row: Record<string, unknown>) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/rest/v1/rpc/fantasy_ai_record_learning_shadow_evaluation`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_row: row }),
  });
  if (!response.ok) throw new Error(`Shadow evaluation failed: ${response.status} ${await response.text()}`);
  return response.text();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const endpoint = url(); const serviceKey = key();
    if (!endpoint || !serviceKey) throw new Error('Supabase service-role environment is not configured');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/functions/v1/run-learning-cycle`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = {}; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    const shadowEvaluation = body.shadow_evaluation && typeof body.shadow_evaluation === 'object'
      ? await recordShadow(endpoint, serviceKey, body.shadow_evaluation as Record<string, unknown>)
      : null;
    return json({ ...(typeof payload === 'object' && payload ? payload : { payload }), function: 'fantasy-learning-cycle', shadow_evaluation: shadowEvaluation, live_testing: 'not performed' }, response.status);
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500); }
});
