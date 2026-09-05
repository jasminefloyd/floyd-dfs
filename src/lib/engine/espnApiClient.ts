import { providerHttpError } from './providerDiagnostics.js';

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: Json }>();
const inFlight = new Map<string, Promise<Json>>();

export interface EspnApiDiagnostics { url: string; status?: number; attempts: number; cached: boolean; error?: string; }

export async function fetchEspnJson(url: string, options: { signal?: AbortSignal; fetcher?: Fetcher; cacheTtlMs?: number; maxAttempts?: number } = {}): Promise<{ payload: Json; diagnostics: EspnApiDiagnostics }> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expiresAt > now) return { payload: cached.value, diagnostics: { url, attempts: 0, cached: true } };
  const existing = inFlight.get(url);
  if (existing) return { payload: await existing, diagnostics: { url, attempts: 0, cached: false } };
  const fetcher = options.fetcher ?? fetch;
  const attempts = Math.max(1, options.maxAttempts ?? 2);
  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetcher(url, { signal: options.signal, headers: { accept: 'application/json', 'user-agent': 'Floyd-DFS/1.0' } });
        if (response.ok) {
          const payload = await response.json() as unknown;
          const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Json : {};
          cache.set(url, { expiresAt: Date.now() + (options.cacheTtlMs ?? CACHE_TTL_MS), value });
          return value;
        }
        lastError = await providerHttpError('ESPN API', response);
        if (response.status === 403 || response.status === 404) break;
      } catch (error) { lastError = error; }
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
    throw lastError instanceof Error ? lastError : new Error('ESPN API request failed.');
  })();
  inFlight.set(url, request);
  try { return { payload: await request, diagnostics: { url, attempts, cached: false } }; }
  finally { inFlight.delete(url); }
}

export function clearEspnApiCache(): void { cache.clear(); inFlight.clear(); }
