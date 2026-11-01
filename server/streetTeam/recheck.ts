import type { SupabaseClient } from '@supabase/supabase-js';
import type { StreetTeamSnapshot, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { resolveDraftKingsPoolIds } from './entityResolver.js';

export interface StreetTeamMaterialChange {
  playerId: string; providerPlayerId: string; eventType: 'AVAILABILITY_CHANGE' | 'ROSTER_CHANGE';
  previousState: unknown; newState: unknown; observationIds: string[];
}

export function detectStreetTeamMaterialChanges(current: StreetTeamSnapshot, previous?: StreetTeamSnapshot): StreetTeamMaterialChange[] {
  if (!previous) return [];
  const oldAvailability = new Map(previous.availability.map((item) => [item.playerId, item]));
  const newAvailability = new Map(current.availability.map((item) => [item.playerId, item]));
  const changes: StreetTeamMaterialChange[] = [];
  for (const [playerId, next] of newAvailability) {
    const prior = oldAvailability.get(playerId);
    if (!prior || prior.status === next.status) continue;
    const providerPlayerId = providerId(playerId);
    if (providerPlayerId && (next.status === 'OUT' || prior.status === 'OUT')) changes.push({ playerId, providerPlayerId, eventType: 'AVAILABILITY_CHANGE', previousState: { status: prior.status }, newState: { status: next.status }, observationIds: next.evidenceIds });
  }
  const oldRoster = new Map(previous.rosterState.map((item) => [item.playerId, item]));
  const newRoster = new Map(current.rosterState.map((item) => [item.playerId, item]));
  for (const [playerId, next] of newRoster) {
    const prior = oldRoster.get(playerId);
    if (!prior || prior.teamId === next.teamId) continue;
    const providerPlayerId = providerId(playerId);
    if (providerPlayerId) changes.push({ playerId, providerPlayerId, eventType: 'ROSTER_CHANGE', previousState: { teamId: prior.teamId }, newState: { teamId: next.teamId }, observationIds: next.evidenceIds });
  }
  return changes;
}

export async function markUnlockedLineupsForRecheck(db: SupabaseClient, tenantId: string, changes: StreetTeamMaterialChange[], snapshotId: string, now = new Date()): Promise<number> {
  if (!changes.length) return 0;
  const runs = await db.from('generation_runs').select('id,request_payload').eq('tenant_id', tenantId).gte('created_at', new Date(now.getTime() - 14 * 24 * 60 * 60_000).toISOString()).order('created_at', { ascending: false }).limit(500);
  if (runs.error) throw runs.error;
  let marked = 0;
  for (const run of runs.data ?? []) {
    const request = record(run.request_payload);
    const slate = record(record(request?.input)?.validatedSlate) as unknown as ValidatedSlate | undefined;
    if (slate?.sport !== 'NBA' || Date.parse(slate.contest.lockTime) <= now.getTime()) continue;
    const providerIds = new Set(changes.map((item) => item.providerPlayerId));
    const impactedIds = new Set([...providerIds].flatMap((providerPlayerId) => resolveDraftKingsPoolIds(slate.playerPool, providerPlayerId).playerIds));
    if (!impactedIds.size) continue;
    const selection = await db.from('floyd_dfs_selection_runs').select('id').eq('tenant_id', tenantId).eq('generation_run_id', run.id);
    if (selection.error) throw selection.error;
    const selectionIds = (selection.data ?? []).map((row) => String(row.id));
    if (!selectionIds.length) continue;
    const lineups = await db.from('floyd_dfs_generated_lineups').select('id,status,entered_at,lineup_payload').eq('tenant_id', tenantId).in('selection_run_id', selectionIds).eq('recheck_required', false);
    if (lineups.error) throw lineups.error;
    for (const lineup of lineups.data ?? []) {
      if (lineup.status === 'ENTERED' || lineup.entered_at) continue;
      const lineupIds = lineupPlayerIds(lineup.lineup_payload);
      const affected = [...impactedIds].filter((id) => lineupIds.has(id));
      if (!affected.length) continue;
      const applicableChanges = changes.filter((change) => slate.playerPool.some((player) => player.identity?.sportsDataIoId === change.providerPlayerId && (affected.includes(player.playerId) || Object.values(player.draftKingsSlotIds ?? {}).some((id) => affected.includes(id)))));
      const update = await db.from('floyd_dfs_generated_lineups').update({ recheck_required: true, recheck_required_at: now.toISOString(), recheck_reason: { snapshotId, changes: applicableChanges.map((item) => ({ eventType: item.eventType, playerId: item.playerId, previousState: item.previousState, newState: item.newState, observationIds: item.observationIds })) } }).eq('tenant_id', tenantId).eq('id', lineup.id).eq('status', 'GENERATED').is('entered_at', null).eq('recheck_required', false).select('id').maybeSingle();
      if (update.error) throw update.error;
      if (update.data) marked += 1;
    }
  }
  return marked;
}

function providerId(value: string): string | undefined { const match = /^nba:player:sportsdataio:(.+)$/.exec(value); return match?.[1]; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function lineupPlayerIds(value: unknown): Set<string> {
  const payload = record(value);
  const ids = new Set<string>();
  if (Array.isArray(payload?.playerIds)) for (const id of payload.playerIds) if (typeof id === 'string' || typeof id === 'number') ids.add(String(id));
  const slots = record(payload?.rosterSlots);
  if (slots) for (const player of Object.values(slots)) {
    if (typeof player === 'string' || typeof player === 'number') ids.add(String(player));
    else { const item = record(player); const id = item?.playerId ?? item?.id; if (typeof id === 'string' || typeof id === 'number') ids.add(String(id)); }
  }
  return ids;
}
