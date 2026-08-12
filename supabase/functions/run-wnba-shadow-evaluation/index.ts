interface Body { snapshotId: string; baselineModelVersion: string; candidateModelVersion: string; baselineConfig?: Record<string, unknown>; candidateConfig?: Record<string, unknown>; lockState?: 'pre_lock' | 'post_confirmed_lineup' | 'late_swap'; }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
async function post(url: string, key: string, path: string, body: unknown) {
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return await response.json() as unknown;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json() as Body; const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key || !body.snapshotId || !body.baselineModelVersion || !body.candidateModelVersion) throw new Error('Snapshot and both model versions are required.');
    const lockState = body.lockState ?? 'pre_lock';
    // Replays are deterministic and read only immutable snapshot data; production
    // configuration is never changed by a shadow run.
    const baseline = await post(url, key, '/functions/v1/replay-wnba-lineups', { snapshotId: body.snapshotId, modelVersion: body.baselineModelVersion, lockState, config: body.baselineConfig ?? {} }) as Record<string, unknown>;
    const candidate = await post(url, key, '/functions/v1/replay-wnba-lineups', { snapshotId: body.snapshotId, modelVersion: body.candidateModelVersion, lockState, config: body.candidateConfig ?? {} }) as Record<string, unknown>;
    const baselineScore = (baseline.scorecard ?? {}) as Record<string, number | null>;
    const candidateScore = (candidate.scorecard ?? {}) as Record<string, number | null>;
    const comparison = {
      player_mae_delta: Number(candidateScore.mean_absolute_error ?? 0) - Number(baselineScore.mean_absolute_error ?? 0),
      lineup_mae_delta: Number(candidateScore.lineup_mean_absolute_error ?? 0) - Number(baselineScore.lineup_mean_absolute_error ?? 0),
      rank_correlation_delta: Number(candidateScore.spearman_rank_correlation ?? 0) - Number(baselineScore.spearman_rank_correlation ?? 0),
      lineup_roi_delta: Number(candidateScore.lineup_roi ?? 0) - Number(baselineScore.lineup_roi ?? 0),
      data_complete: Object.values(candidateScore).some((value) => value !== null),
    };
    const saved = await post(url, key, '/rest/v1/wnba_shadow_runs', [{ snapshot_id: body.snapshotId, baseline_model_version: body.baselineModelVersion, candidate_model_version: body.candidateModelVersion, lock_state: lockState, baseline_config: body.baselineConfig ?? {}, candidate_config: body.candidateConfig ?? {}, baseline_result: baseline, candidate_result: candidate, comparison, status: 'completed' }]);
    return json({ shadow_run: Array.isArray(saved) ? saved[0] : saved, comparison });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
