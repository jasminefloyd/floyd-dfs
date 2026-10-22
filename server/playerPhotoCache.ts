import { createHash } from 'node:crypto';
import type { ValidatedSlate } from '../src/lib/engine/contracts.js';

interface PhotoRow { canonical_player_id: string; provider_player_id?: string | null; photo_url?: string | null; retrieved_at?: string | null; verified_at?: string | null; expires_at?: string | null; }
interface DbResult<T> { data: T | null; error: { message: string } | null; }
interface PhotoDb { from(table: string): any; }

/** Tenant-scoped metadata cache only; it never downloads or proxies the provider image. */
export async function cacheSlatePlayerPhotos(db: PhotoDb, slate: ValidatedSlate, allowedHosts: string[], ttlDays = 7): Promise<ValidatedSlate> {
  const now = new Date();
  const boundedDays = Number.isFinite(ttlDays) ? Math.max(1, Math.min(30, ttlDays)) : 7;
  const expiresAt = new Date(now.getTime() + boundedDays * 86_400_000).toISOString();
  const eligible = slate.playerPool.filter((player) => player.identity?.matchedBy === 'DRAFTKINGS' && player.identity.draftKingsId);
  if (!eligible.length) return slate;
  const hosts = new Set(allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  const ids = eligible.map((player) => player.playerId);
  let cached = new Map<string, PhotoRow>();
  const warnings: string[] = [];
  try {
    const query = await db.from('floyd_dfs_player_photos').select('canonical_player_id,provider_player_id,photo_url,retrieved_at,verified_at,expires_at')
      .eq('tenant_id', slate.tenantId).eq('provider', 'DRAFTKINGS').in('canonical_player_id', ids).gt('expires_at', now.toISOString()).order('retrieved_at', { ascending: false });
    const result = query as DbResult<PhotoRow[]>;
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) if (!cached.has(row.canonical_player_id)) cached.set(row.canonical_player_id, row);
  } catch (error) {
    warnings.push(`Tenant-scoped player photo cache read failed: ${error instanceof Error ? error.message : 'database error'}.`);
  }
  const writes: Array<Record<string, unknown>> = [];
  const staleIdentityIds: string[] = [];
  const players = slate.playerPool.map((player) => {
    if (player.identity?.matchedBy !== 'DRAFTKINGS' || !player.identity.draftKingsId) return player;
    const candidateCache = cached.get(player.playerId);
    const cachedRow = candidateCache?.provider_player_id === player.identity.draftKingsId ? candidateCache : undefined;
    if (candidateCache && !cachedRow) staleIdentityIds.push(player.playerId);
    const currentUrl = approvedUrl(player.imageUrl, hosts);
    const cachedUrl = approvedUrl(cachedRow?.photo_url ?? undefined, hosts);
    const url = currentUrl ?? cachedUrl ?? null;
    const retrievedAt = currentUrl ? now.toISOString() : cachedRow?.retrieved_at ?? undefined;
    const verifiedAt = currentUrl ? now.toISOString() : cachedRow?.verified_at ?? undefined;
    const rowExpiresAt = currentUrl ? expiresAt : cachedRow?.expires_at ?? undefined;
    if (currentUrl) {
      const digest = createHash('sha256').update(`${slate.tenantId}:DRAFTKINGS:${player.playerId}:${player.identity.draftKingsId}:${currentUrl}`).digest('hex');
      writes.push({ tenant_id: slate.tenantId, canonical_player_id: player.playerId, provider: 'DRAFTKINGS', provider_player_id: player.identity.draftKingsId, photo_url: currentUrl, retrieved_at: retrievedAt, verified_at: verifiedAt, expires_at: expiresAt, content_sha256: digest });
    }
    return { ...player, imageUrl: url ?? undefined, photo: { tenantId: slate.tenantId, playerId: player.playerId, providerId: player.identity.draftKingsId, source: 'DRAFTKINGS', url, retrievedAt, verifiedAt, expiresAt: rowExpiresAt } };
  });
  if (staleIdentityIds.length) {
    try {
      const result = await db.from('floyd_dfs_player_photos').delete().eq('tenant_id', slate.tenantId).eq('provider', 'DRAFTKINGS').in('canonical_player_id', staleIdentityIds);
      if (result.error) throw new Error(result.error.message);
    } catch (error) { warnings.push(`Stale tenant-scoped photo metadata could not be invalidated after a provider identity change: ${error instanceof Error ? error.message : 'database error'}.`); }
  }
  if (writes.length) {
    try {
      const result = await db.from('floyd_dfs_player_photos').upsert(writes, { onConflict: 'tenant_id,canonical_player_id,provider,content_sha256' });
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      warnings.push(`Tenant-scoped player photo cache write failed: ${error instanceof Error ? error.message : 'database error'}.`);
    }
  }
  const coverage = players.filter((player) => Boolean(player.photo?.url)).length;
  return { ...slate, playerPool: players, sourceManifest: [...(slate.sourceManifest ?? []), { source: 'FLOYD_DFS_TENANT_PHOTO_CACHE', receivedAt: now.toISOString(), fields: [`tenant=${slate.tenantId}`, `covered=${coverage}`, `total=${players.length}`, `ttlDays=${boundedDays}`] }], validation: { ...slate.validation, warnings: [...slate.validation.warnings, ...warnings, `Photo metadata coverage after tenant-scoped cache: ${coverage}/${players.length}.`] } };
}

function approvedUrl(value: string | undefined, allowedHosts: Set<string>): string | undefined {
  if (!value || !allowedHosts.size) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowedHosts.has(url.hostname.toLowerCase()) ? url.toString() : undefined; }
  catch { return undefined; }
}
