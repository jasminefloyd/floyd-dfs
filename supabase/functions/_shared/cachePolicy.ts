// Matches the existing two-hour stale confirmed-lineup warning boundary.
export const MAX_MANIFEST_CACHE_AGE_MS = 2 * 60 * 60 * 1000;

export function isManifestCacheFresh(cachedAt: number, now = Date.now()): boolean {
  return Number.isFinite(cachedAt)
    && cachedAt <= now
    && now - cachedAt <= MAX_MANIFEST_CACHE_AGE_MS;
}
