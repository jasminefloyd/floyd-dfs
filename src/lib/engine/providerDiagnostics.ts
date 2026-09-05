export interface ProviderHttpDiagnostics {
  provider: string;
  status: number;
  message: string;
  headers: Record<string, string>;
}

export async function providerHttpError(provider: string, response: Response): Promise<Error> {
  const rawBody = await response.text().catch(() => '');
  let detail = rawBody.trim().slice(0, 600);
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : parsed;
    detail = String(error.message ?? error.code ?? detail).slice(0, 600);
  } catch { /* Keep the bounded raw response when it is not JSON. */ }
  const headers: Record<string, string> = {};
  for (const key of ['retry-after', 'x-request-id', 'request-id', 'cf-ray']) {
    const value = response.headers.get(key);
    if (value) headers[key] = value;
  }
  const suffix = [detail ? ` detail=${JSON.stringify(detail)}` : '', Object.keys(headers).length ? ` headers=${JSON.stringify(headers)}` : ''].join('');
  const error = new Error(`${provider} returned HTTP ${response.status}.${suffix}`);
  (error as Error & { diagnostics?: ProviderHttpDiagnostics }).diagnostics = { provider, status: response.status, message: detail, headers };
  return error;
}

export function diagnosticsFromError(error: unknown): ProviderHttpDiagnostics | undefined {
  return error && typeof error === 'object' && 'diagnostics' in error ? (error as { diagnostics?: ProviderHttpDiagnostics }).diagnostics : undefined;
}
