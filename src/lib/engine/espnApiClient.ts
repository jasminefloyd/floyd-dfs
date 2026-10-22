import { providerHttpError } from './providerDiagnostics.js';

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: Json }>();
const inFlight = new Map<string, Promise<Json>>();

export interface EspnApiDiagnostics { url: string; status?: number; attempts: number; cached: boolean; error?: string; }

export async function fetchEspnJson(url: string, options: { signal?: AbortSignal; fetcher?: Fetcher; cacheTtlMs?: number; maxAttempts?: number; timeoutMs?: number } = {}): Promise<{ payload: Json; diagnostics: EspnApiDiagnostics }> {
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
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        const timeout = setTimeout(() => controller.abort(new Error('ESPN request timed out.')), options.timeoutMs ?? 12_000);
        let response: Response;
        try { response = await fetcher(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'Floyd-DFS/1.0' } }); }
        finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abortFromCaller); }
        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';
          if (!/^(application\/json|application\/[a-z0-9.+-]+\+json)(\s*;|$)/i.test(contentType)) throw new Error(`ESPN API returned non-JSON content type: ${contentType || 'missing'}.`);
          const payload = await response.json() as unknown;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('ESPN API returned an invalid JSON object.');
          const value = payload as Json;
          cache.set(url, { expiresAt: Date.now() + (options.cacheTtlMs ?? CACHE_TTL_MS), value });
          return value;
        }
        lastError = await providerHttpError('ESPN API', response);
        if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
        if (error instanceof SyntaxError || (error instanceof Error && /non-JSON content type|invalid JSON object/.test(error.message))) break;
      }
      if (attempt < attempts) {
        const retryAfter = (lastError as Error & { diagnostics?: { headers?: Record<string, string> } } | undefined)?.diagnostics?.headers?.['retry-after'];
        const retryAfterSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : undefined;
        const delay = Math.min(5_000, retryAfterSeconds ?? (200 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150)));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('ESPN API request failed.');
  })();
  inFlight.set(url, request);
  try { return { payload: await request, diagnostics: { url, attempts, cached: false } }; }
  finally { inFlight.delete(url); }
}

export function clearEspnApiCache(): void { cache.clear(); inFlight.clear(); }
