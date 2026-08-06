// Intended schedule: daily. Prunes derived_from_slate_context relationship rows once
// they're older than the retention window -- they regenerate automatically the next time
// the same two players share a slate, so nothing real is lost. historical_pair_data rows
// (real, earned history) are never touched by this, regardless of age.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_RETENTION_DAYS = 10;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envSupabaseServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = envSupabaseUrl();
  const serviceRoleKey = envSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase service-role environment is not configured.' }, 500);
  }

  let payload: { days?: number } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const days = Number.isFinite(Number(payload.days)) && Number(payload.days) > 0
    ? Number(payload.days)
    : DEFAULT_RETENTION_DAYS;

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/fantasy_ai_cleanup_stale_pios_relationships`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_days: days }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`cleanup RPC failed: ${response.status} ${message}`);
    }
    const deletedCount = Number(await response.text()) || 0;
    return jsonResponse({ days, deleted_count: deletedCount, generated_at: new Date().toISOString() });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
