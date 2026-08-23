import { buildPrelockPassDecision } from '../_shared/prelockPass.ts';
import type { SlateResearchDossier } from '../_shared/decisionContracts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

interface PrelockRequest {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  userId?: string;
  lockTime?: string;
  slate?: Record<string, unknown>;
  previousDossier?: SlateResearchDossier | null;
  priorLineupIds?: string[];
  piosConfig?: Record<string, unknown>;
  runNow?: boolean;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function supabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error(`Supabase service-role env is not configured for ${name}`);
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) as T : null;
}

async function invokeFunction(name: string, body: Record<string, unknown>, authorization?: string): Promise<Record<string, unknown>> {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('Supabase function environment is not configured');
  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: authorization ?? `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${text}`);
  return data;
}

function dossierFromScan(scan: Record<string, unknown>): SlateResearchDossier | null {
  return scan.dossier && typeof scan.dossier === 'object' ? scan.dossier as SlateResearchDossier : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: PrelockRequest;
  try { payload = await req.json() as PrelockRequest; } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const sport = String(payload.sport ?? '').toLowerCase();
  const contestType = String(payload.contestType ?? '').toLowerCase();
  const contestDate = String(payload.contestDate ?? '');
  if (!sport || !contestType || !/^\d{4}-\d{2}-\d{2}$/.test(contestDate)) {
    return jsonResponse({ error: 'sport, contestType, and contestDate (YYYY-MM-DD) are required' }, 400);
  }

  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const previous = payload.previousDossier ?? (await rpc<Array<{ dossier?: SlateResearchDossier }>>('fantasy_ai_get_previous_mios_dossier', {
      p_sport: sport, p_contest_date: contestDate, p_contest_type: contestType, p_contest_id: payload.contestId ?? '',
    }))?.[0]?.dossier ?? null;
    const scheduledFor = payload.lockTime ? new Date(new Date(payload.lockTime).getTime() - 12 * 60 * 1000) : new Date();
    if (!payload.runNow && scheduledFor.getTime() > Date.now()) {
      const scheduled = buildPrelockPassDecision({ previousDossier: previous, lockTime: payload.lockTime, now: new Date().toISOString(), passId: crypto.randomUUID() });
      return jsonResponse({ status: 'scheduled', prelock_pass: { ...scheduled, executed_at: null }, next_action: 'Invoke this function at scheduled_for to perform the final refresh.' });
    }

    const scan = await invokeFunction('fantasy-mios-scan', {
      sport, contestType, contestDate, contestId: payload.contestId, gameId: payload.gameId, userId: payload.userId, slate: payload.slate,
    }, authorization);
    const current = dossierFromScan(scan);
    const decision = buildPrelockPassDecision({ previousDossier: previous, currentDossier: current, lockTime: payload.lockTime, passId: crypto.randomUUID() });
    let pios: Record<string, unknown> | null = null;
    let supersededCount = 0;
    if (decision.status === 'ready' && Array.isArray(scan.player_roster) && scan.player_roster.length) {
      const requestId = crypto.randomUUID();
      pios = await invokeFunction('fantasy-pios-lineups', {
        ...(payload.piosConfig ?? {}),
        requestId,
        sport, contestType, contestDate, contestId: payload.contestId, userId: payload.userId,
        snapshotId: scan.snapshot_id, manifestId: scan.manifest_id,
        slate: scan.slate ?? payload.slate,
        playerRoster: scan.player_roster,
        dossier: current,
        dossierVersion: scan.dossier_version ?? 'dossier-v1',
        prelockPass: {
          passId: decision.pass_id,
          changedSources: decision.changed_sources,
          affectedPlayerIds: decision.affected_player_ids,
          affectedScriptKeys: decision.affected_script_keys,
          supersedesLineupIds: payload.priorLineupIds ?? [],
        },
      }, authorization);
      const generated = Array.isArray(pios.lineups) ? pios.lineups.length : 0;
      if (generated && payload.priorLineupIds?.length) {
        supersededCount = await rpc<number>('fantasy_ai_mark_pios_lineups_superseded', {
          p_lineup_ids: payload.priorLineupIds,
          p_reason: `Superseded by Phase 6 pre-lock pass ${decision.pass_id}`,
          p_replaced_by_request_id: requestId,
        }) ?? 0;
        decision.supersede_lineup_ids = [...payload.priorLineupIds];
      }
    }

    return jsonResponse({
      status: decision.status,
      prelock_pass: decision,
      refreshed_manifest_id: scan.manifest_id ?? null,
      refreshed_snapshot_id: scan.snapshot_id ?? null,
      pios,
      superseded_count: supersededCount,
      live_testing: 'not performed',
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
