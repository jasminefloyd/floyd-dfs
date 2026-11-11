// Minimal read-only relay for the DraftKings endpoints the app needs.
// DraftKings returns HTTP 403 to these requests from cloud server IPs (Vercel). Run this
// relay on a network DraftKings does not block and point DRAFTKINGS_API_BASE_URL at it.
//
// It forwards only GET requests, only for the allowlisted paths below, and only when the
// x-relay-token header matches RELAY_TOKEN. It does not change or add identifying headers.
//
// Use as a Cloudflare Worker (export default { fetch }) or with Node 18+ via node-server.mjs.

const UPSTREAM = 'https://api.draftkings.com';
const ALLOWED_PATHS = [
  /^\/draftgroups\/v1\/\d+$/, // draft group
  /^\/draftgroups\/v1\/draftgroups\/\d+\/draftables$/, // player pool
  /^\/lineups\/v1\/gametypes\/\d+\/rules$/, // roster and scoring rules
  /^\/contests\/v1\/contests\/\d+$/, // contest detail
  /^\/sites\/US-DK\/sports\/v1\/sports$/, // sport list
];

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function handleRelayRequest(request, token) {
  if (!token) return new Response('Relay is not configured (RELAY_TOKEN missing).', { status: 500 });
  if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });
  if (!timingSafeEqual(request.headers.get('x-relay-token') ?? '', token)) return new Response('Unauthorized.', { status: 401 });
  const url = new URL(request.url);
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname))) return new Response('Path not allowed.', { status: 404 });
  const upstream = new URL(url.pathname + url.search, UPSTREAM);
  const response = await fetch(upstream, { headers: { accept: request.headers.get('accept') ?? 'application/json' } });
  const body = await response.text();
  return new Response(body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) { return handleRelayRequest(request, env.RELAY_TOKEN); },
};
