const lastRequestAt = new Map<string, number>();

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  dedupeMs?: number;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function limitedFetch(url: string, service: string, options: FetchOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  const dedupeMs = options.dedupeMs ?? 500;

  const now = Date.now();
  const last = lastRequestAt.get(service) ?? 0;
  const waitMs = Math.max(0, dedupeMs - (now - last));
  if (waitMs > 0) await delay(waitMs);
  lastRequestAt.set(service, Date.now());

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 429 && attempt < retries) {
        await delay(Math.min(1000 * 2 ** attempt, 16_000));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) await delay(Math.min(1000 * 2 ** attempt, 16_000));
    }
  }

  throw lastError;
}
