import { ENGINE_CONTRACT_VERSION, FDS_TRANSPORT_CONTRACT_VERSION } from './contracts.js';
import type { FdsApiError, SlateGame, ValidatedSlate } from './contracts.js';

export class BoundaryContractError extends Error {
  readonly path: string;
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.path = path; this.name = 'BoundaryContractError'; }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const iso = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));

/** Validate untrusted JSON before transport data enters the engine domain. */
export function parseValidatedSlate(value: unknown, expectedTenantId?: string): ValidatedSlate {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  if (value.contractVersion !== undefined && value.contractVersion !== ENGINE_CONTRACT_VERSION) throw new BoundaryContractError('contractVersion', `unsupported version ${String(value.contractVersion)}`);
  if (value.transportContractVersion !== undefined && value.transportContractVersion !== FDS_TRANSPORT_CONTRACT_VERSION) throw new BoundaryContractError('transportContractVersion', `unsupported version ${String(value.transportContractVersion)}`);
  for (const key of ['tenantId', 'slateId', 'requestId'] as const) if (!text(value[key])) throw new BoundaryContractError(key, 'required non-empty string');
  if (expectedTenantId && value.tenantId !== expectedTenantId) throw new BoundaryContractError('tenantId', 'does not match authenticated tenant');
  if (!record(value.event) || !text(value.event.eventId) || !iso(value.event.eventDate)) throw new BoundaryContractError('event', 'legacy event adapter requires eventId and valid eventDate');
  if (!Array.isArray(value.playerPool)) throw new BoundaryContractError('playerPool', 'expected an array');
  const games = normalizeSlateGames(value as unknown as ValidatedSlate);
  const gameIds = new Set(games.map((game) => game.gameId));
  for (const [i, player] of value.playerPool.entries()) {
    if (!record(player) || !text(player.playerId)) throw new BoundaryContractError(`playerPool[${i}]`, 'requires a stable string playerId');
    if (player.gameId !== undefined && !gameIds.has(String(player.gameId))) throw new BoundaryContractError(`playerPool[${i}].gameId`, 'must reference a game in this slate');
    if (player.photo !== undefined) {
      if (!record(player.photo) || player.photo.playerId !== player.playerId || player.photo.tenantId !== value.tenantId) throw new BoundaryContractError(`playerPool[${i}].photo`, 'must use the canonical player and current tenant IDs');
      if (player.photo.url !== null && (typeof player.photo.url !== 'string' || !player.photo.url.startsWith('https://'))) throw new BoundaryContractError(`playerPool[${i}].photo.url`, 'must be null or HTTPS');
    }
  }
  return { ...value, games, transportContractVersion: FDS_TRANSPORT_CONTRACT_VERSION } as unknown as ValidatedSlate;
}

/** Compatibility adapter: old one-event payloads become a one-game games[] slate. */
export function normalizeSlateGames(slate: Pick<ValidatedSlate, 'event' | 'games'>): SlateGame[] {
  if (slate.games?.length) {
    const ids = new Set<string>();
    for (const game of slate.games) {
      if (!record(game) || !text(game.gameId) || ids.has(game.gameId)) throw new BoundaryContractError('games', 'game IDs must be non-empty and unique');
      ids.add(game.gameId);
      if (!iso(game.scheduledStart)) throw new BoundaryContractError(`games.${game.gameId}.scheduledStart`, 'must be a valid timestamp');
      if (!Array.isArray(game.teamIds) || !record(game.providerIds)) throw new BoundaryContractError(`games.${game.gameId}`, 'teamIds and providerIds are required');
      for (const [provider, id] of Object.entries(game.providerIds)) if (!text(provider) || !text(id)) throw new BoundaryContractError(`games.${game.gameId}.providerIds`, 'provider IDs must be non-empty strings');
    }
    return slate.games;
  }
  if (!text(slate.event.eventId) || !iso(slate.event.eventDate)) throw new BoundaryContractError('event', 'cannot adapt invalid legacy event');
  return [{ gameId: slate.event.eventId, providerIds: {}, teamIds: [...slate.event.participants], scheduledStart: slate.event.eventDate, lockTime: slate.event.eventDate, status: 'UNKNOWN' }];
}

export function isFdsApiError(value: unknown): value is FdsApiError {
  const codes = ['EMPTY_PLAYER_POOL','NO_LEGAL_LINEUP','PROVIDER_UNAVAILABLE','STALE_DATA','BOUNDED_SEARCH','UNAUTHORIZED','TENANT_MISMATCH','CONFLICT','VALIDATION_FAILED','INTERNAL_ERROR'];
  if (!record(value) || !codes.includes(String(value.code)) || !text(value.safeMessage) || !text(value.requestId) || typeof value.retriable !== 'boolean' || !Array.isArray(value.reasons)) return false;
  return value.reasons.every((reason) => record(reason) && text(reason.code) && text(reason.message));
}

/** Strip query strings, fragments, and embedded credentials before a route is persisted. */
export function sanitizeProviderRoute(route: string): string {
  try {
    const url = new URL(route, 'https://provider.invalid');
    return `${url.host === 'provider.invalid' ? '' : url.host}${url.pathname}`.replace(/\/{2,}/g, '/').slice(0, 500);
  } catch {
    return route.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').slice(0, 500);
  }
}

/** JSON transport must preserve absent/null/zero distinctly; do not use truthy defaults. */
export function serializeContract<T extends { contractVersion?: string; transportContractVersion?: string }>(value: T): string {
  return JSON.stringify({ ...value, contractVersion: value.contractVersion ?? ENGINE_CONTRACT_VERSION, transportContractVersion: value.transportContractVersion ?? FDS_TRANSPORT_CONTRACT_VERSION });
}
