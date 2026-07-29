import { isManifestCacheFresh, MAX_MANIFEST_CACHE_AGE_MS } from '../cachePolicy.ts';

Deno.test('manifest cache freshness rejects entries older than two hours', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');
  if (!isManifestCacheFresh(now - MAX_MANIFEST_CACHE_AGE_MS, now)) throw new Error('boundary cache entry should be fresh');
  if (isManifestCacheFresh(now - MAX_MANIFEST_CACHE_AGE_MS - 1, now)) throw new Error('expired cache entry should be rejected');
  if (isManifestCacheFresh(now + 1, now)) throw new Error('future cache entry should be rejected');
});
