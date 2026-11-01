import type { NbaRefreshKind } from './scheduler.js';

export type RefreshReadiness = 'READY' | 'DEGRADED' | 'STALE' | 'BLOCKED';
export function evaluateDailyProviderBudget(configuredBudget: unknown, callsUsed: number, productionTierVerified = false): { allowed: boolean; remaining: number; reason?: string } {
  if (String(configuredBudget ?? '').trim().toUpperCase() === 'UNLIMITED' && productionTierVerified && Number.isSafeInteger(callsUsed) && callsUsed >= 0) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER };
  const budget = Number(configuredBudget);
  if (!Number.isSafeInteger(budget) || budget < 1) return { allowed: false, remaining: 0, reason: 'Verified daily provider-call budget is not configured.' };
  if (!Number.isSafeInteger(callsUsed) || callsUsed < 0) return { allowed: false, remaining: 0, reason: 'Provider-call usage could not be verified.' };
  const remaining = Math.max(0, budget - callsUsed);
  return remaining ? { allowed: true, remaining } : { allowed: false, remaining: 0, reason: 'Daily provider-call budget is exhausted.' };
}
export function assessRefreshPolicy(input: {
  kind: NbaRefreshKind; schedulerAvailable: boolean; providerQuotaRemaining?: number;
  lastSuccessAt?: string; contestLockAt?: string; now?: Date; maxAgeMs: number; identityVerified: boolean; injuryVerified: boolean;
}): { readiness: RefreshReadiness; reasons: string[]; mayRefresh: boolean } {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  if (!input.schedulerAvailable) reasons.push('Required refresh cadence has no configured scheduler.');
  if (input.providerQuotaRemaining === undefined) reasons.push('Provider quota could not be verified.');
  if (input.providerQuotaRemaining !== undefined && input.providerQuotaRemaining <= 0) reasons.push('Provider quota is exhausted.');
  if (input.kind === 'PRE_LOCK_VERIFY') {
    const lock = Date.parse(input.contestLockAt ?? '');
    if (!Number.isFinite(lock) || lock <= now.getTime()) reasons.push('A future contest lock time is required for pre-lock verification.');
    else if (lock - now.getTime() > 15 * 60_000) reasons.push('Pre-lock verification is outside its configured 15-minute checkpoint.');
  }
  const age = input.lastSuccessAt ? now.getTime() - Date.parse(input.lastSuccessAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(age) || age > input.maxAgeMs) reasons.push('Latest successful source refresh is stale.');
  if (!input.identityVerified) reasons.push('Player identity verification is incomplete.');
  if (!input.injuryVerified) reasons.push('Injury and availability verification is incomplete.');
  const mayRefresh = input.schedulerAvailable && !(input.providerQuotaRemaining !== undefined && input.providerQuotaRemaining <= 0);
  const readiness: RefreshReadiness = !mayRefresh && !input.lastSuccessAt ? 'BLOCKED'
    : !input.identityVerified || !input.injuryVerified ? 'BLOCKED'
      : age > input.maxAgeMs ? 'STALE'
        : reasons.length ? 'DEGRADED' : 'READY';
  return { readiness, reasons, mayRefresh };
}
