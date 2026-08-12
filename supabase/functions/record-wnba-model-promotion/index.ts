interface Body { candidateModelVersion: string; baselineModelVersion: string; rollbackVersion: string; trainingRange?: string; evaluationRange?: string; approvalNote?: string; userId?: string; minSlates?: number; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
async function post(url: string, key: string, path: string, body: unknown) { const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return await response.json() as unknown; }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json() as Body; const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key || !body.candidateModelVersion || !body.baselineModelVersion || !body.rollbackVersion) throw new Error('Candidate, baseline, and rollback versions are required.');
    const scorecard = await post(url, key, '/rest/v1/rpc/fantasy_ai_wnba_promotion_scorecard', { p_candidate_model_version: body.candidateModelVersion, p_baseline_model_version: body.baselineModelVersion, p_min_slates: body.minSlates ?? 20 }) as Array<{ eligible_for_promotion?: boolean }>;
    const approved = Boolean(scorecard[0]?.eligible_for_promotion);
    const record = await post(url, key, '/rest/v1/wnba_model_promotions', [{ candidate_model_version: body.candidateModelVersion, baseline_model_version: body.baselineModelVersion, rollback_version: body.rollbackVersion, training_range: body.trainingRange ?? null, evaluation_range: body.evaluationRange ?? null, approval_status: approved ? 'approved' : 'pending_evidence', approval_note: body.approvalNote ?? null, evidence: scorecard[0] ?? {}, approved_by: approved ? body.userId ?? null : null, approved_at: approved ? new Date().toISOString() : null }]);
    return json({ approval_status: approved ? 'approved' : 'pending_evidence', promotion_record: Array.isArray(record) ? record[0] : record, scorecard: scorecard[0] ?? null });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
