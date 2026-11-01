import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, cors, method, respondError, tenantContext } from '../../server/runtime.js';
import { getLatestStreetTeamCollectionRun, getStreetTeamSnapshot, getStreetTeamSnapshotAsOf, listStreetTeamSnapshots, streetTeamSnapshotFreshness } from '../../server/streetTeam.js';
import { nearLockAlerts, streetTeamHealth } from '../../server/streetTeam/health.js';
import { snapshotChanges } from '../../server/streetTeam/briefing.js';
import { listUpcomingNbaSchedule } from '../../server/streetTeam/nbaScheduleRepository.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req);
    const snapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : undefined;
    const asOf = typeof req.query.asOf === 'string' ? req.query.asOf.trim() : undefined;
    if (snapshotId && asOf) throw new ApiError(400, 'Use either snapshotId or asOf, not both.', 'INVALID_REQUEST');
    const historyRequested = String(req.query.history ?? '') === '1';
    const historyLimit = Number(req.query.limit ?? 20);
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) throw new ApiError(400, 'limit must be an integer from 1 to 100.', 'INVALID_REQUEST');
    if (historyRequested) {
      const snapshots = await listStreetTeamSnapshots(context.db, context.tenantId, historyLimit);
      cors(req, res);
      res.status(200).json({ sport: 'NBA', snapshots });
      return;
    }
    const snapshot = asOf ? await getStreetTeamSnapshotAsOf(context.db, context.tenantId, asOf) : await getStreetTeamSnapshot(context.db, context.tenantId, snapshotId);
    const latestCollectionRun = await getLatestStreetTeamCollectionRun(context.db, context.tenantId);
    const [nextLockAt, upcomingGames, syncState] = await Promise.all([
      latestNbaLock(context.db, context.tenantId),
      listUpcomingNbaSchedule(context.db, new Date(), 7),
      context.db.from('floyd_dfs_nba_schedule_sync_state').select('last_attempt_at,last_success_at,next_due_at,last_error,game_count').eq('provider', 'ESPN').maybeSingle(),
    ]);
    if (syncState.error) throw syncState.error;
    const schedule = { ...syncState.data, upcomingGames: upcomingGames.slice(0, 20), nextContestLockAt: nextLockAt ?? null };
    if (!snapshot && snapshotId) throw new ApiError(404, 'Street Team snapshot was not found.', 'NOT_FOUND');
    if (!snapshot) {
      cors(req, res);
      res.status(200).json({ snapshot: null, currentStateFreshness: 'UNKNOWN', ageMs: null, latestCollectionRun, schedule, health: { ...streetTeamHealth(null, latestCollectionRun, new Date(), { nextDueAt: syncState.data?.next_due_at ?? undefined }), alerts: nearLockAlerts(nextLockAt, null, latestCollectionRun) } });
      return;
    }
    const ageMs = Date.now() - Date.parse(snapshot.asOf);
    const currentStateFreshness = streetTeamSnapshotFreshness(snapshot);
    const history = await listStreetTeamSnapshots(context.db, context.tenantId, 100);
    const currentIndex = history.findIndex((item) => String((item as Record<string, unknown>).id) === snapshot.snapshotId);
    const priorId = currentIndex >= 0 ? String((history[currentIndex + 1] as Record<string, unknown> | undefined)?.id ?? '') : '';
    const previous = priorId ? await getStreetTeamSnapshot(context.db, context.tenantId, priorId) : null;
    const changes = snapshotChanges(snapshot, previous ?? undefined);
    const response = { snapshot, currentStateFreshness, ageMs: Math.max(0, ageMs), latestCollectionRun, schedule, health: { ...streetTeamHealth(snapshot, latestCollectionRun, new Date(), { nextDueAt: syncState.data?.next_due_at ?? undefined }), alerts: nearLockAlerts(nextLockAt, snapshot, latestCollectionRun) }, changes, changesSinceSnapshotId: previous?.snapshotId ?? null };
    cors(req, res);
    res.status(200).json(response);
  } catch (error) { respondError(req, res, error); }
}

async function latestNbaLock(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string): Promise<string | undefined> {
  const result = await db.from('generation_runs').select('id,request_payload').eq('tenant_id', tenantId).gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()).limit(1000);
  if (result.error) throw result.error;
  const locks = (result.data ?? []).flatMap((run) => {
    const request = record(run.request_payload); const input = record(request?.input); const slate = record(input?.validatedSlate); const contest = record(slate?.contest);
    const lock = typeof contest?.lockTime === 'string' ? contest.lockTime : '';
    return slate?.sport === 'NBA' && Date.parse(lock) > Date.now() ? [lock] : [];
  });
  return locks.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
