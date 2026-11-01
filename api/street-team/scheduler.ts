import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isFeatureEnabled } from '../../server/featureFlags.js';
import { assessRefreshPolicy, evaluateDailyProviderBudget } from '../../server/streetTeam/refreshPolicy.js';
import { decideScheduledRefresh, refreshWindowKey, type NbaRefreshKind } from '../../server/streetTeam/scheduler.js';
import { streetTeamHealth } from '../../server/streetTeam/health.js';
import { listUpcomingNbaSchedule, syncNbaSchedule } from '../../server/streetTeam/nbaScheduleRepository.js';
import { collectNbaStreetTeam, getLatestStreetTeamCollectionRun, getStreetTeamSnapshot, isSportsDataIoProductionVerifiedDataTier } from '../../server/streetTeam.js';
import { ApiError, cors, method, respondError, schedulerContext } from '../../server/runtime.js';

export const config = { maxDuration: 300 };
type RunRow = { id: string; created_at: string; request_payload: unknown };
const MAX_PROVIDER_CALLS_PER_REFRESH = 10;

/** Supabase Cron dispatcher; safely chooses one due feed-specific refresh per invocation. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    if (!isFeatureEnabled('STREET_TEAM_V2')) throw new ApiError(503, 'Street Team scheduling is disabled.', 'FEATURE_DISABLED');
    const { db, tenantId } = await schedulerContext(req);
    const now = new Date();
    const scheduleSync = await syncNbaSchedule(db, { now });
    const [runsResult, collectionRun, snapshot, upcomingGames] = await Promise.all([
      db.from('generation_runs').select('id,created_at,request_payload').eq('tenant_id', tenantId).gte('created_at', new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString()).order('created_at', { ascending: false }).limit(1000),
      getLatestStreetTeamCollectionRun(db, tenantId), getStreetTeamSnapshot(db, tenantId), listUpcomingNbaSchedule(db, now),
    ]);
    if (runsResult.error) throw runsResult.error;
    const nextLock = nextNbaLock((runsResult.data ?? []) as RunRow[], now, upcomingGames);
    const nextGame = upcomingGames[0];
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const history = await db.from('floyd_dfs_intel_collection_runs').select('idempotency_key,status,started_at,result').eq('tenant_id', tenantId).eq('sport', 'NBA').eq('provider', 'SPORTSDATAIO').gte('started_at', dayStart.toISOString()).order('started_at', { ascending: false }).limit(500);
    if (history.error) throw history.error;
    const lastAttemptAt: Partial<Record<NbaRefreshKind, string>> = {};
    const completedLockKeys: string[] = [];
    for (const item of history.data ?? []) {
      const key = String(item.idempotency_key ?? '');
      for (const kind of ['FULL', 'AVAILABILITY', 'TRANSACTIONS', 'LINEUPS', 'PRE_LOCK_VERIFY'] as const) {
        const prefix = `street-team:nba:${kind}:`;
        if (key.startsWith(prefix) && !lastAttemptAt[kind]) lastAttemptAt[kind] = String(item.started_at);
        if (kind === 'PRE_LOCK_VERIFY' && key.startsWith(prefix) && item.status === 'COMPLETE') completedLockKeys.push(key.slice(prefix.length));
      }
    }
    const latestResult = asRecord(collectionRun?.result);
    const quotaState = asRecord(latestResult?.providerQuotaState) as { remaining?: number; resetAt?: string; retryAfterAt?: string; rateLimited?: boolean } | undefined;
    const decision = decideScheduledRefresh({ now, nextLockAt: nextLock?.lockTime, nextLockKey: nextLock?.key, nextLockGameId: nextLock?.gameId, nextLockSlateId: nextLock?.slateId, nextGameAt: nextGame?.scheduled_start_at, nextGameId: nextGame?.provider_game_id, nextSlateId: nextLock?.gameId === nextGame?.provider_game_id ? nextLock.slateId : undefined, completedLockKeys, lastAttemptAt, providerQuotaState: quotaState });
    const failedCollectionCount = (history.data ?? []).filter((item) => item.status === 'FAILED').length;
    const prelockMissedCount = (history.data ?? []).filter((item) => String(item.idempotency_key ?? '').startsWith('street-team:nba:PRE_LOCK_VERIFY:') && item.status !== 'COMPLETE' && Date.parse(String(item.started_at ?? '')) < now.getTime() - 15 * 60_000).length;
    const staleGameCount = upcomingGames.filter((game) => !Number.isFinite(Date.parse(game.retrieved_at)) || now.getTime() - Date.parse(game.retrieved_at) > 24 * 60 * 60_000).length;
    const nextDueAt = decision.kind && Number.isFinite(decision.intervalMs) ? new Date(now.getTime() + Math.max(0, decision.intervalMs ?? 0)).toISOString() : scheduleSync.nextSyncAt;
    const health = streetTeamHealth(snapshot, collectionRun, now, { nextDueAt, quotaRemaining: quotaState?.remaining ?? null, staleGameCount, failedCollectionCount, prelockMissedCount });
    if (!decision.kind) { cors(req, res); res.status(200).json({ status: 'SKIPPED', reason: decision.reason, nextLock, nextGame, scheduleSync, decision, health }); return; }
    const callsUsed = (history.data ?? []).reduce((sum, item) => sum + Math.max(0, Number(asRecord(item.result)?.providerCallCount ?? 0)), 0);
    const budget = evaluateDailyProviderBudget(process.env.SPORTS_DATA_IO_NBA_DAILY_CALL_BUDGET, callsUsed, isSportsDataIoProductionVerifiedDataTier(process.env.SPORTS_DATA_IO_DATA_TIER));
    if (!budget.allowed) { cors(req, res); res.status(200).json({ status: 'SKIPPED', code: budget.reason?.includes('not configured') ? 'QUOTA_BUDGET_UNCONFIGURED' : 'DAILY_CALL_BUDGET_EXHAUSTED', reason: budget.reason, callsUsed, nextLock, nextGame, scheduleSync, health }); return; }
    const remaining = quotaState?.remaining;
    const policy = assessRefreshPolicy({ kind: decision.kind, schedulerAvailable: true, ...(remaining !== undefined ? { providerQuotaRemaining: remaining } : {}), lastSuccessAt: snapshot?.asOf, contestLockAt: nextLock?.lockTime, now, maxAgeMs: decision.intervalMs || 15 * 60_000, identityVerified: health.identityVerified, injuryVerified: health.injuryVerified });
    if (!policy.mayRefresh) { cors(req, res); res.status(200).json({ status: 'SKIPPED', reason: decision.reason, policy, nextLock, nextGame, scheduleSync, health }); return; }
    const apiKey = process.env.SPORTS_DATA_IO_KEY?.trim();
    if (!apiKey) throw new ApiError(503, 'SPORTS_DATA_IO_KEY is not configured for NBA Street Team collection.', 'PROVIDER_UNAVAILABLE');
    const key = decision.kind === 'PRE_LOCK_VERIFY' ? decision.logicalRunKey! : decision.kind === 'FULL' ? dayStart.toISOString().slice(0, 10) : refreshWindowKey(decision.kind, now, decision.intervalMs, decision.logicalRunKey);
    const result = await collectNbaStreetTeam(db, tenantId, { apiKey, dataTier: process.env.SPORTS_DATA_IO_DATA_TIER, baseUrl: process.env.SPORTS_DATA_IO_BASE_URL?.trim() || undefined, refreshKind: decision.kind, idempotencyKey: key, providerCallBudget: Math.min(MAX_PROVIDER_CALLS_PER_REFRESH, budget.remaining), scheduleContext: { gameIds: decision.gameId ? [decision.gameId] : [], slateIds: decision.slateId ? [decision.slateId] : [] } });
    cors(req, res);
    res.status(result.status === 'FAILED' ? 503 : 200).json({ ...result, refreshKind: decision.kind, decision, policy, nextLock, nextGame, scheduleSync, health });
  } catch (error) {
    const diagnostic = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    console.error('street-team-scheduler-error', {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof diagnostic.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(diagnostic.code) ? diagnostic.code : undefined,
      status: typeof diagnostic.status === 'number' ? diagnostic.status : undefined,
      path: typeof diagnostic.path === 'string' && diagnostic.path.length <= 128 && /^[A-Za-z0-9_.-]+$/.test(diagnostic.path.replace(/\[\d+\]/g, '')) ? diagnostic.path : undefined,
    });
    respondError(req, res, error);
  }
}

function nextNbaLock(runs: RunRow[], now: Date, schedule: Array<{ provider_game_id: string; home_team_code: string; away_team_code: string; scheduled_start_at: string }>): { lockTime: string; key: string; slateId?: string; gameId?: string } | undefined {
  const candidates = runs.flatMap((run) => {
    const request = asRecord(run.request_payload);
    const input = asRecord(request?.input);
    const slate = asRecord(input?.validatedSlate);
    const contest = asRecord(slate?.contest);
    const lockTime = typeof contest?.lockTime === 'string' ? contest.lockTime : '';
    const time = Date.parse(lockTime);
    if (slate?.sport !== 'NBA' || !Number.isFinite(time) || time <= now.getTime()) return [];
    const slateGames = Array.isArray(slate.games) ? slate.games.map(asRecord).filter((game): game is Record<string, unknown> => Boolean(game)) : [];
    const matchingGame = schedule.find((scheduled) => slateGames.some((game) => {
      const providerIds = asRecord(game.providerIds);
      if (String(providerIds?.ESPN ?? '') === scheduled.provider_game_id || String(game.gameId ?? '') === scheduled.provider_game_id) return true;
      const teamIds = Array.isArray(game.teamIds) ? game.teamIds.map(normalizeTeam) : [];
      const teamsMatch = teamIds.includes(normalizeTeam(scheduled.home_team_code)) && teamIds.includes(normalizeTeam(scheduled.away_team_code));
      const gameStart = Date.parse(String(game.scheduledStart ?? ''));
      return teamsMatch && Number.isFinite(gameStart) && Math.abs(gameStart - Date.parse(scheduled.scheduled_start_at)) < 24 * 60 * 60_000;
    }));
    return [{ lockTime: new Date(time).toISOString(), key: `${String(slate.slateId ?? run.id)}:${new Date(time).toISOString()}`, ...(typeof slate.slateId === 'string' ? { slateId: slate.slateId } : {}), ...(matchingGame ? { gameId: matchingGame.provider_game_id } : {}) }];
  });
  return candidates.sort((a, b) => Date.parse(a.lockTime) - Date.parse(b.lockTime))[0];
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function normalizeTeam(value: unknown): string { return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
