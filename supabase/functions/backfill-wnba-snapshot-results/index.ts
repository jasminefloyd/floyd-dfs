import { dkFantasyPoints } from '../_shared/dkScoring.ts';
import { parseEspnAthleteStats } from '../ingest-actual-results/espnStatParsing.ts';

interface SnapshotRow {
  id: string;
  contest_date: string;
  contest_type: string;
  contest_id: string | null;
  manifest_data: { player_roster?: Array<{ id?: string; name?: string; team?: string; position?: string; projected_points?: number; projection_source?: string }> };
}

interface BackfillRequest { snapshotId: string; }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

function envSupabaseUrl() { return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL'); }
function envServiceRole() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY'); }

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = envSupabaseUrl();
  const key = envServiceRole();
  if (!url || !key) throw new Error('Supabase service-role environment is required.');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

function normalizedName(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const TEAM_ALIASES: Record<string, string> = {
  PHX: 'PHO',
  LV: 'LVA',
  LA: 'LAS',
  NY: 'NYL',
  WSH: 'WAS',
};

function normalizedTeam(value: unknown) {
  const team = String(value ?? '').toUpperCase();
  return TEAM_ALIASES[team] ?? team;
}

function key(name: unknown, team: unknown) { return `${normalizedName(name)}:${normalizedTeam(team)}`; }

function previousDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

async function espnEvents(date: string) {
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${date.replace(/-/g, '')}`);
  if (!response.ok) throw new Error(`ESPN scoreboard ${response.status}`);
  return ((await response.json()) as { events?: any[] }).events ?? [];
}

async function officialActuals(contestDate: string) {
  const events = [...await espnEvents(previousDate(contestDate)), ...await espnEvents(contestDate)];
  const byEvent = new Map(events.map((event) => [String(event.id), event]));
  const actuals = new Map<string, { points: number; minutes: number | null }>();
  for (const event of byEvent.values()) {
    if (!event?.status?.type?.completed) continue;
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(String(event.id))}`);
    if (!response.ok) continue;
    const summary = await response.json() as any;
    for (const teamBox of summary?.boxscore?.players ?? []) {
      const team = String(teamBox?.team?.abbreviation ?? '').toUpperCase();
      for (const group of teamBox?.statistics ?? []) {
        const labels = (group?.names ?? group?.labels ?? []).map(String);
        for (const athleteRow of group?.athletes ?? []) {
          const athlete = athleteRow?.athlete ?? athleteRow;
          const name = String(athlete?.displayName ?? athlete?.fullName ?? athlete?.name ?? '');
          if (!name || !team) continue;
          const statLine = parseEspnAthleteStats(athleteRow, labels, String(group?.name ?? ''));
          const points = Number(dkFantasyPoints(statLine, 'wnba').toFixed(2));
          if (!Number.isFinite(points)) continue;
          const minutes = Number(statLine.minutes);
          actuals.set(key(name, team), { points, minutes: Number.isFinite(minutes) ? minutes : null });
        }
      }
    }
  }
  return actuals;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  try {
    const request = await req.json() as BackfillRequest;
    if (!request.snapshotId) throw new Error('snapshotId is required.');
    const snapshots = await rpc<SnapshotRow[]>('fantasy_ai_get_wnba_backfill_snapshot', { p_snapshot_id: request.snapshotId });
    const snapshot = snapshots[0];
    if (!snapshot) throw new Error('WNBA snapshot was not found.');
    const actuals = await officialActuals(snapshot.contest_date);
    const roster = snapshot.manifest_data.player_roster ?? [];
    const rows = roster.flatMap((player) => {
      const actual = actuals.get(key(player.name, player.team));
      if (!actual) return [];
      return [{
        sport: 'wnba', contest_date: snapshot.contest_date, contest_type: snapshot.contest_type,
        contest_id: snapshot.contest_id, player_id: player.id ?? null, player_name: player.name,
        team: player.team ?? null, position: player.position ?? null, projected_points: player.projected_points ?? null,
        actual_points: actual.points, actual_minutes: actual.minutes, source: 'official_espn_snapshot_backfill', projection_source: player.projection_source ?? 'snapshot_unknown',
      }];
    });
    const upserted = rows.length ? await rpc<number>('fantasy_ai_upsert_projection_results_v2', { p_rows: rows }) : 0;
    const featuresMaterialized = await rpc<number>('fantasy_ai_materialize_wnba_features', { p_contest_date: snapshot.contest_date });
    return jsonResponse({ snapshot_id: snapshot.id, roster_count: roster.length, official_matches: rows.length, unmatched_players: roster.filter((player) => !actuals.has(key(player.name, player.team))).map((player) => player.name), upserted, features_materialized: featuresMaterialized });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
