import { assertReplayTimestampSafety, replayPayloadFromManifest } from '../_shared/eval/replay.ts';
import { evaluateReplay } from '../_shared/eval/scorecard.ts';

interface SnapshotRow {
  id: string;
  manifest_id: string;
  sport: string;
  contest_type: string;
  contest_date: string;
  contest_id: string | null;
  game_id: string | null;
  model_version: string;
  collected_at: string;
  manifest_data: Record<string, unknown>;
  provenance: Array<{ observed_at?: string | null }>;
}

interface ActualRow {
  player_name: string;
  team: string | null;
  actual_points: number | null;
  recorded_at?: string | null;
}

interface ContestLineRow { cash_line?: number | null; top_20_cutoff?: number | null; entry_fee?: number | null; payout?: number | null; }

interface ReplayRequest {
  snapshotId: string;
  config?: Record<string, unknown>;
  modelVersion?: string;
  lockState?: 'pre_lock' | 'post_confirmed_lineup' | 'late_swap';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envServiceRole() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = envSupabaseUrl();
  const key = envServiceRole();
  if (!url || !key) throw new Error('Supabase service-role environment is required for replay.');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function playerKey(name: unknown, team: unknown): string {
  return `${normalize(name)}:${String(team ?? '').toUpperCase()}`;
}

function stableSeed(snapshotId: string): number {
  let hash = 2_166_136_261;
  for (const character of snapshotId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  try {
    const request = await req.json() as ReplayRequest;
    if (!request.snapshotId) throw new Error('snapshotId is required.');
    const snapshots = await rpc<SnapshotRow[]>('fantasy_ai_get_wnba_replay_snapshot', { p_snapshot_id: request.snapshotId });
    const snapshot = snapshots[0];
    if (!snapshot) throw new Error('WNBA snapshot was not found.');
    const slate = (snapshot.manifest_data.slate ?? {}) as { start_time?: string | null };
    assertReplayTimestampSafety({
      lock_time: slate.start_time ?? null,
      collected_at: snapshot.collected_at,
      observed_at: snapshot.provenance.reduce<string | null>((latest, row) => row.observed_at && (!latest || row.observed_at > latest) ? row.observed_at : latest, null),
    });
    const actuals = await rpc<ActualRow[]>('fantasy_ai_get_wnba_replay_actuals', {
      p_contest_date: snapshot.contest_date,
      p_contest_type: snapshot.contest_type,
      p_contest_id: snapshot.contest_id,
    });
    if (!actuals.length) throw new Error('Replay requires settled player actuals for this snapshot.');
    const contestRows = await rpc<ContestLineRow[]>('fantasy_ai_get_wnba_replay_contest_result', {
      p_contest_date: snapshot.contest_date, p_contest_type: snapshot.contest_type, p_contest_id: snapshot.contest_id,
    });
    const contest = contestRows[0] ?? {};
    const actualByPlayer = new Map(actuals.map((row) => [playerKey(row.player_name, row.team), Number(row.actual_points)]));
    const config = { ...request.config, simulationSeed: Number(request.config?.simulationSeed ?? stableSeed(snapshot.id)) };
    const replayPayload = replayPayloadFromManifest({
      ...snapshot.manifest_data,
      manifest_id: snapshot.manifest_id,
      snapshot_id: snapshot.id,
      sport: snapshot.sport,
      contest_type: snapshot.contest_type,
      contest_date: snapshot.contest_date,
      contest_id: snapshot.contest_id ?? undefined,
      game_id: snapshot.game_id ?? undefined,
    }, config);
    const url = envSupabaseUrl();
    const key = envServiceRole();
    if (!url || !key) throw new Error('Supabase service-role environment is required for replay.');
    const generatorResponse = await fetch(`${url.replace(/\/$/, '')}/functions/v1/generate-pios-lineups`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...replayPayload, userId: null }),
    });
    if (!generatorResponse.ok) throw new Error(`Generator replay failed: ${generatorResponse.status} ${await generatorResponse.text()}`);
    const generated = await generatorResponse.json() as { lineups?: Array<{ projected_points: number; players: Array<{ player_id?: string; name?: string; team?: string }> }> };
    const lineups = generated.lineups ?? [];
    const playerOutcomes = (snapshot.manifest_data.player_roster as Array<{ id?: string; name?: string; team?: string; projected_points?: number }> ?? [])
      .map((player) => ({ player_id: String(player.id ?? ''), projected_points: Number(player.projected_points), actual_points: actualByPlayer.get(playerKey(player.name, player.team)) }))
      .filter((player): player is { player_id: string; projected_points: number; actual_points: number } => Number.isFinite(player.projected_points) && Number.isFinite(player.actual_points));
    const lineupOutcomes = lineups.map((lineup) => {
      const points = lineup.players.map((player) => actualByPlayer.get(playerKey(player.name, player.team)));
      return {
        projected_points: Number(lineup.projected_points),
        actual_points: points.every((point) => Number.isFinite(point)) ? points.reduce((sum, point) => sum + Number(point), 0) : NaN,
        player_ids: lineup.players.map((player) => String(player.player_id ?? player.name ?? '')).filter(Boolean),
        top_20_cutoff: contest.top_20_cutoff ?? null,
        entry_fee: contest.entry_fee ?? null,
        payout: contest.payout ?? null,
      };
    }).filter((lineup): lineup is { projected_points: number; actual_points: number; player_ids: string[]; top_20_cutoff: number | null; entry_fee: number | null; payout: number | null } => Number.isFinite(lineup.projected_points) && Number.isFinite(lineup.actual_points));
    const scorecard = evaluateReplay(playerOutcomes, lineupOutcomes);
    const replayId = await rpc<string>('fantasy_ai_insert_wnba_replay_run', {
      p_snapshot_id: snapshot.id,
      p_model_version: request.modelVersion ?? snapshot.model_version,
      p_lock_state: request.lockState ?? 'pre_lock',
      p_config: config,
      p_seed: config.simulationSeed,
      p_scorecard: scorecard,
      p_lineups: lineups,
      p_player_sample_size: scorecard.player_sample_size,
      p_lineup_sample_size: scorecard.lineup_sample_size,
    });
    return jsonResponse({ replay_id: replayId, snapshot_id: snapshot.id, model_version: request.modelVersion ?? snapshot.model_version, scorecard, generated_lineups: lineups.length });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
