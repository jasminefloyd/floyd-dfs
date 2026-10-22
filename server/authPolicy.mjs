import { timingSafeEqual } from 'node:crypto';

export function parseBearer(value) {
  const match = typeof value === 'string' ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  return match?.[1];
}

export function tenantHeaderAllowed(configuredTenantId, requestedId) {
  return !requestedId || requestedId === configuredTenantId;
}

export function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isOperator(userId, configuredIds) {
  return new Set(String(configuredIds ?? '').split(',').map((value) => value.trim()).filter(Boolean)).has(userId);
}
