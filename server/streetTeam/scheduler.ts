export type NbaRefreshKind = 'FULL' | 'AVAILABILITY' | 'TRANSACTIONS' | 'LINEUPS' | 'PRE_LOCK_VERIFY';
export type NbaGameState = { scheduled: boolean; nextLockAt?: string };
export interface ScheduledRefreshDecision { kind?: NbaRefreshKind; logicalRunKey?: string; intervalMs?: number; gameId?: string; slateId?: string; reason: string; }

export function decideScheduledRefresh(input: { now: Date; nextLockAt?: string; nextLockKey?: string; nextLockGameId?: string; nextLockSlateId?: string; nextGameAt?: string; nextGameId?: string; nextSlateId?: string; completedLockKeys?: string[]; lastAttemptAt: Partial<Record<NbaRefreshKind, string>>; providerQuotaState?: { remaining?: number; resetAt?: string; retryAfterAt?: string; rateLimited?: boolean } }): ScheduledRefreshDecision {
  const nowMs = input.now.getTime();
  const quotaBlockedUntil = Math.max(Date.parse(input.providerQuotaState?.resetAt ?? '') || 0, Date.parse(input.providerQuotaState?.retryAfterAt ?? '') || 0);
  const quotaBlocked = input.providerQuotaState?.remaining === 0 || input.providerQuotaState?.rateLimited;
  if (quotaBlocked && (!quotaBlockedUntil || quotaBlockedUntil > nowMs)) return { reason: quotaBlockedUntil ? `Provider quota/rate-limit signal blocks collection until ${new Date(quotaBlockedUntil).toISOString()}.` : 'Provider reported quota exhaustion without a reset time; automatic requests remain paused.' };
  const due = (kind: NbaRefreshKind, cadenceMs: number) => !input.lastAttemptAt[kind] || nowMs - Date.parse(input.lastAttemptAt[kind]!) >= cadenceMs;
  const lockMs = Date.parse(input.nextLockAt ?? '');
  const hasFutureLock = Number.isFinite(lockMs) && lockMs > nowMs;
  const untilLock = hasFutureLock ? lockMs - nowMs : Number.POSITIVE_INFINITY;
  if (hasFutureLock && untilLock <= 15 * 60_000) {
    const key = input.nextLockKey ?? input.nextLockAt!;
    if (input.completedLockKeys?.includes(key)) return { reason: 'Pre-lock verification already ran for this slate lock.' };
    return { kind: 'PRE_LOCK_VERIFY', logicalRunKey: key, intervalMs: 0, ...(input.nextLockGameId ? { gameId: input.nextLockGameId } : {}), ...(input.nextLockSlateId ? { slateId: input.nextLockSlateId } : {}), reason: 'Run the pre-lock verification checkpoint.' };
  }
  if (hasFutureLock && untilLock <= 2 * 60 * 60_000) {
    if (due('LINEUPS', 10 * 60_000)) return { kind: 'LINEUPS', intervalMs: 10 * 60_000, ...(input.nextLockGameId ? { gameId: input.nextLockGameId } : {}), ...(input.nextLockSlateId ? { slateId: input.nextLockSlateId } : {}), reason: 'Refresh starting-lineup and availability feeds during the final two hours.' };
  } else if (hasFutureLock && due('AVAILABILITY', 60 * 60_000)) {
    return { kind: 'AVAILABILITY', intervalMs: 60 * 60_000, ...(input.nextLockGameId ? { gameId: input.nextLockGameId } : {}), ...(input.nextLockSlateId ? { slateId: input.nextLockSlateId } : {}), reason: 'Hourly game-day availability refresh is due.' };
  }
  const gameMs = Date.parse(input.nextGameAt ?? '');
  const hasFutureGame = Number.isFinite(gameMs) && gameMs > nowMs;
  const untilGame = hasFutureGame ? gameMs - nowMs : Number.POSITIVE_INFINITY;
  if (hasFutureGame && untilGame <= 2 * 60 * 60_000 && due('LINEUPS', 10 * 60_000)) {
    return { kind: 'LINEUPS', intervalMs: 10 * 60_000, ...(input.nextGameId ? { gameId: input.nextGameId } : {}), ...(input.nextSlateId ? { slateId: input.nextSlateId } : {}), reason: 'Refresh availability and starting-lineup feeds before the scheduled game; no DraftKings lock time is inferred from game start.' };
  }
  if (hasFutureGame && due('AVAILABILITY', 60 * 60_000)) {
    return { kind: 'AVAILABILITY', intervalMs: 60 * 60_000, ...(input.nextGameId ? { gameId: input.nextGameId } : {}), ...(input.nextSlateId ? { slateId: input.nextSlateId } : {}), reason: 'Hourly availability refresh is due for an independently discovered NBA game.' };
  }
  if (!hasFutureLock && !hasFutureGame && due('FULL', 24 * 60 * 60_000)) return { kind: 'FULL', intervalMs: 24 * 60 * 60_000, reason: 'No upcoming NBA game or slate lock was found; daily full refresh is due.' };
  if (due('TRANSACTIONS', 24 * 60 * 60_000)) return { kind: 'TRANSACTIONS', intervalMs: 24 * 60 * 60_000, reason: 'Daily transaction refresh is due.' };
  if (due('FULL', 24 * 60 * 60_000)) return { kind: 'FULL', intervalMs: 24 * 60 * 60_000, reason: hasFutureLock ? 'Daily full roster and historical evidence refresh is due.' : 'No upcoming slate lock was found; daily full refresh is due.' };
  return { reason: 'No NBA Street Team refresh is due.' };
}

/** Return the intended minimum cadence. A scheduler must still be configured to invoke it. */
export function refreshIntervalMs(kind: NbaRefreshKind, game: NbaGameState, now = new Date()): number {
  if (kind === 'FULL' || !game.scheduled) return 24 * 60 * 60_000;
  if (kind === 'PRE_LOCK_VERIFY') return 0;
  const lock = Date.parse(game.nextLockAt ?? '');
  if (Number.isFinite(lock) && lock > now.getTime() && lock - now.getTime() <= 2 * 60 * 60_000) return 10 * 60_000;
  return 60 * 60_000;
}

export function refreshWindowKey(kind: NbaRefreshKind, now = new Date(), intervalMs = refreshIntervalMs(kind, { scheduled: kind !== 'FULL' }, now), logicalRunKey?: string): string {
  if (kind === 'PRE_LOCK_VERIFY') return `${kind}:${logicalRunKey ?? now.toISOString()}`;
  const width = Math.max(60_000, intervalMs);
  return `${kind}:${Math.floor(now.getTime() / width)}`;
}
