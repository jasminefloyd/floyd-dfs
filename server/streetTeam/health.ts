import type { StreetTeamSnapshot } from '../../src/lib/engine/contracts.js';
import { isSportsDataIoProductionVerifiedDataTier, NBA_STREET_TEAM_SNAPSHOT_TTL_MS, streetTeamSnapshotFreshness } from '../streetTeam.js';

export function streetTeamHealth(snapshot: StreetTeamSnapshot | null, run: Record<string, unknown> | null, now = new Date(), operational?: { nextDueAt?: string; quotaRemaining?: number | null; staleGameCount?: number; failedCollectionCount?: number; prelockMissedCount?: number }) {
  const runDiagnostics = providerDiagnostics(run);
  const diagnostics = runDiagnostics.length ? runDiagnostics : snapshot?.providerDiagnostics ?? [];
  const ageMs = snapshot ? Math.max(0, now.getTime() - Date.parse(snapshot.asOf)) : null;
  const identityVerified = Boolean(snapshot && snapshot.rosterState.length > 0 && !snapshot.unknowns.some((item) => /identity|alias|team assignment/i.test(`${item.question} ${item.reason}`)));
  const injuryVerified = Boolean(snapshot && diagnostics.some((item) => /InjuredPlayers/i.test(item.provider) && ['SUCCEEDED', 'EMPTY'].includes(item.status)));
  const failureCount = diagnostics.filter((item) => item.status === 'FAILED' || item.status === 'RATE_LIMITED').length;
  const freshness = snapshot ? streetTeamSnapshotFreshness(snapshot, now) : 'STALE';
  const reasons: string[] = [];
  if (!snapshot) reasons.push('No verified snapshot is available.');
  if (ageMs === null || ageMs > NBA_STREET_TEAM_SNAPSHOT_TTL_MS) reasons.push('The latest snapshot exceeds the 24-hour freshness window.');
  if (!identityVerified) reasons.push('Player identity verification is incomplete.');
  if (!injuryVerified) reasons.push('Injury and availability verification is incomplete.');
  if (failureCount) reasons.push(`${failureCount} provider feed(s) failed or were rate limited.`);
  const budgetSetting = String(process.env.SPORTS_DATA_IO_NBA_DAILY_CALL_BUDGET ?? '').trim().toUpperCase();
  const unlimitedVerified = budgetSetting === 'UNLIMITED' && isSportsDataIoProductionVerifiedDataTier(process.env.SPORTS_DATA_IO_DATA_TIER);
  if (!unlimitedVerified && (!Number.isSafeInteger(Number(budgetSetting)) || Number(budgetSetting) < 1)) reasons.push('Automatic NBA refresh is paused because the verified daily provider-call budget is not configured.');
  const readiness = !snapshot || !identityVerified || !injuryVerified ? 'BLOCKED'
    : freshness === 'STALE' ? 'STALE'
      : reasons.length ? 'DEGRADED' : 'READY';
  return {
    readiness, reasons, ageMs, failureCount, identityVerified, injuryVerified,
    last_success_at: run?.status === 'COMPLETE' ? String(run.finished_at ?? '') || null : null,
    last_attempt_at: String(run?.started_at ?? '') || null,
    next_due_at: operational?.nextDueAt ?? null,
    quota_remaining: operational?.quotaRemaining ?? null,
    stale_game_count: operational?.staleGameCount ?? 0,
    failed_collection_count: operational?.failedCollectionCount ?? failureCount,
    prelock_missed_count: operational?.prelockMissedCount ?? 0,
    sources: diagnostics.map((item) => ({ ...item, ageMs: Math.max(0, now.getTime() - Date.parse(item.retrievedAt)), affectedSlates: ['NBA'] })),
  };
}

export function nearLockAlerts(nextLockAt: string | undefined, snapshot: StreetTeamSnapshot | null, run: Record<string, unknown> | null, now = new Date()): string[] {
  const lockAt = Date.parse(nextLockAt ?? '');
  if (!Number.isFinite(lockAt) || lockAt <= now.getTime() || lockAt - now.getTime() > 2 * 60 * 60_000) return [];
  const alerts: string[] = [];
  const status = String(run?.status ?? '');
  const finishedAt = Date.parse(String(run?.finished_at ?? ''));
  if (status !== 'COMPLETE' || !Number.isFinite(finishedAt) || now.getTime() - finishedAt > 15 * 60_000) alerts.push('NBA pre-lock refresh is missing, incomplete, or older than 15 minutes.');
  const diagnostics = providerDiagnostics(run);
  for (const sourceName of ['SportsDataIO NBA Players', 'SportsDataIO NBA InjuredPlayers', 'SportsDataIO NBA StartingLineupsByDate']) {
    const source = diagnostics.find((item) => item.provider === sourceName);
    if (!source || source.status === 'FAILED' || source.status === 'RATE_LIMITED') alerts.push(`${sourceName} is unavailable or has no current verified result.`);
  }
  if (!snapshot) alerts.push('No canonical NBA Street Team snapshot is available for the upcoming slate.');
  return [...new Set(alerts)];
}

function providerDiagnostics(run: Record<string, unknown> | null): Array<{ provider: string; status: string; retrievedAt: string; freshness?: string; errorCode?: string }> {
  const result = run?.result;
  if (!result || typeof result !== 'object') return [];
  const diagnostics = (result as Record<string, unknown>).providerDiagnostics;
  return Array.isArray(diagnostics) ? diagnostics.filter((item): item is { provider: string; status: string; retrievedAt: string; freshness?: string; errorCode?: string } => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).provider === 'string')) : [];
}
