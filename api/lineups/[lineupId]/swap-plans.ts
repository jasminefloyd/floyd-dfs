import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { cacheSlatePlayerPhotos } from '../../../server/playerPhotoCache.js';
import { ApiError, createRun, draftKingsClient, method, parseBody, processRun, requireOwnedLineup, respondError, tenantContext } from '../../../server/runtime.js';
import { getLateSwapLockSnapshot } from '../../../server/gameLockProvider.js';
import { buildValidatedSlateFromBundle } from '../../../src/lib/engine/draftKingsSlate.js';
import { extractLateSwapEligibility } from '../../../src/lib/engine/draftKings.js';
import type { ContestObjective, SelectedLineup, ValidatedSlate } from '../../../src/lib/engine/contracts.js';

/** Create persisted recommendations from fresh source data; this never submits a DraftKings lineup. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  let context: Awaited<ReturnType<typeof tenantContext>> | undefined;
  let reservation: { id: string; tenantId: string } | undefined;
  let modelRun: Record<string, any> | undefined;
  let engineJobId: string | undefined;
  try {
    context = await tenantContext(req);
    const lineupId = String(req.query.lineupId ?? '');
    await requireOwnedLineup(context, lineupId);
    const body = parseBody(req);
    const entryId = text(body.entryId);
    const trigger = text(body.trigger) || 'User requested a late-swap review.';
    const sourceRevision = Number(body.sourceRevision);
    const idempotencyKey = text(body.idempotencyKey);
    if (!entryId || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0 || !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) throw new ApiError(400, 'entryId, non-negative sourceRevision, and an 8–120 character idempotencyKey are required.', 'VALIDATION_FAILED');

    const priorPlans = await context.db.from('floyd_dfs_swap_plans').select('*').eq('tenant_id', context.tenantId).in('plan_key', [idempotencyKey, `${idempotencyKey}:2`, `${idempotencyKey}:3`]).order('plan_key');
    if (priorPlans.error) throw priorPlans.error;
    if (priorPlans.data?.length) { res.status(priorPlans.data.some((plan) => plan.outcome === 'PENDING') ? 202 : 200).json({ plans: priorPlans.data, idempotentReplay: true }); return; }

    const link = await context.db.from('floyd_dfs_entry_links').select('contest_id,external_entry_id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).eq('external_entry_id', entryId).maybeSingle();
    if (link.error) throw link.error;
    if (!link.data) throw new ApiError(409, 'Link the DraftKings entry to this saved lineup before requesting a late-swap plan.', 'CONFLICT');
    const latestRevision = await context.db.from('floyd_dfs_lineup_revisions').select('revision').eq('tenant_id', context.tenantId).eq('lineup_id', lineupId).order('revision', { ascending: false }).limit(1).maybeSingle();
    if (latestRevision.error) throw latestRevision.error;
    const currentRevision = Number(latestRevision.data?.revision ?? 0);
    if (sourceRevision !== currentRevision) throw new ApiError(409, `Source revision is stale; current revision is ${currentRevision}.`, 'CONFLICT');

    const lineupResult = await context.db.from('floyd_dfs_generated_lineups').select('selection_run_id,lineup_payload').eq('tenant_id', context.tenantId).eq('id', lineupId).single();
    if (lineupResult.error) throw lineupResult.error;
    const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id').eq('tenant_id', context.tenantId).eq('id', lineupResult.data.selection_run_id).single();
    if (selection.error) throw selection.error;
    const savedRun = await context.db.from('generation_runs').select('request_payload').eq('tenant_id', context.tenantId).eq('user_id', context.userId).eq('id', selection.data.generation_run_id).single();
    if (savedRun.error) throw savedRun.error;
    const savedInput = record(record(savedRun.data.request_payload).input);
    const savedSlate = savedInput.validatedSlate as ValidatedSlate | undefined;
    const sourceLineup = record(lineupResult.data.lineup_payload) as unknown as SelectedLineup;
    if (!savedSlate || savedSlate.tenantId !== context.tenantId || savedSlate.contest.draftKingsContestId !== String(link.data.contest_id)) throw new ApiError(409, 'Saved lineup does not match the tenant-owned contest slate.', 'CONFLICT');
    if (!sourceLineup.rosterSlots || !sourceLineup.playerIds?.length) throw new ApiError(409, 'Stored lineup has no authoritative roster assignments.', 'CONFLICT');

    let lateSwapAllowed: boolean | null = null;
    let bundle;
    try {
      const dk = draftKingsClient();
      const [contest, slateBundle] = await Promise.all([dk.getContest(String(link.data.contest_id)), dk.getSlateBundleForDraftGroup({ contestId: String(link.data.contest_id), draftGroupId: String(savedInput.draftGroupId ?? ''), sport: savedSlate.sport, format: savedSlate.contest.format, contestName: savedSlate.contest.name, contestLockTime: savedSlate.contest.lockTime, contestSize: savedSlate.contest.contestSize, maxEntriesAllowed: savedSlate.contest.maxEntriesAllowed })]);
      lateSwapAllowed = extractLateSwapEligibility(contest.data);
      bundle = slateBundle;
    } catch (error) {
      throw new ApiError(503, `Could not refresh the authoritative DraftKings contest/player pool: ${error instanceof Error ? error.message : 'provider unavailable'}`, 'PROVIDER_UNAVAILABLE');
    }
    if (lateSwapAllowed !== true) throw new ApiError(409, lateSwapAllowed === false ? 'DraftKings reports this contest is not late-swap eligible.' : 'DraftKings contest payload does not explicitly confirm late-swap eligibility; no swap plan was created.', 'CONFLICT');

    const requestId = randomId();
    let freshSlate = buildValidatedSlateFromBundle(bundle, { tenantId: context.tenantId, userId: context.userId, requestId, sport: savedSlate.sport, league: savedSlate.league, contestId: String(link.data.contest_id), contestFormat: savedSlate.contest.format, userEntryCount: 3, contestName: savedSlate.contest.name, contestLockTime: savedSlate.contest.lockTime, contestSizeOverride: savedSlate.contest.contestSize, objective: savedSlate.contest.objective as ContestObjective | undefined, allowedPhotoHosts: (process.env.FDS_PLAYER_PHOTO_ALLOWED_HOSTS ?? '').split(',') });
    freshSlate = await cacheSlatePlayerPhotos(context.db, freshSlate, (process.env.FDS_PLAYER_PHOTO_ALLOWED_HOSTS ?? '').split(','), Number(process.env.FDS_PLAYER_PHOTO_CACHE_TTL_DAYS ?? 7));
    if (freshSlate.validation.status === 'BLOCKED') throw new ApiError(409, `Refreshed DraftKings slate failed validation: ${freshSlate.validation.errors.join(' ')}`, 'VALIDATION_FAILED');

    const lockSnapshot = await getLateSwapLockSnapshot(freshSlate, { lateSwapAllowed });
    await persistGameLockSnapshot(context.db, context.tenantId, freshSlate, lockSnapshot);
    if (lockSnapshot.verification !== 'VERIFIED' || lockSnapshot.games.some((game) => game.locked === null)) throw new ApiError(409, `Late-swap lock state is not verified: ${lockSnapshot.reasons.join(' ')}`, 'CONFLICT');
    const freshPlayerById = new Map(freshSlate.playerPool.map((player) => [player.playerId, player]));
    const oldPlayerById = new Map(savedSlate.playerPool.map((player) => [player.playerId, player]));
    const fixedRosterSlots: Record<string, string> = {};
    const lockByTeamPair = new Map(lockSnapshot.games.map((game) => {
      const sourceGame = freshSlate.games?.find((item) => item.gameId === game.gameId);
      return [sourceGame?.teamIds.map((team) => team.toUpperCase()).sort().join(':'), game] as const;
    }));
    for (const [slot, playerId] of Object.entries(sourceLineup.rosterSlots)) {
      const player = oldPlayerById.get(playerId);
      const refreshedPlayer = freshPlayerById.get(playerId);
      if (!player || !refreshedPlayer) throw new ApiError(409, `Stored DraftKings player ${playerId} is missing from the current contest pool.`, 'CONFLICT');
      const game = player.gameId ? freshSlate.games?.find((item) => item.gameId === refreshedPlayer.gameId) : undefined;
      const state = game ? lockByTeamPair.get(game.teamIds.map((team) => team.toUpperCase()).sort().join(':')) : undefined;
      if (!state || state.locked === null) throw new ApiError(409, `Unable to verify the game lock for player ${playerId}.`, 'CONFLICT');
      if (state.locked) fixedRosterSlots[slot] = playerId;
    }
    if (!lockSnapshot.games.some((game) => game.locked === false)) throw new ApiError(409, 'No unlocked games remain; no late-swap plan can be generated.', 'CONFLICT');

    const reserved = await context.db.from('floyd_dfs_swap_plans').insert({ tenant_id: context.tenantId, plan_key: idempotencyKey, lineup_id: lineupId, source_revision: currentRevision, entry_id: entryId, trigger, constraint_sha256: hash({ rosterRules: freshSlate.rosterRules, fixedRosterSlots, objective: freshSlate.contest.objective }), snapshot_sha256: hash({ slateId: freshSlate.slateId, locks: lockSnapshot, sourceLineup: sourceLineup.rosterSlots }), affected_slots: [], replacement_roster: {}, salary_delta: 0, point_delta: 0, reason: 'Plan generation is in progress.', expires_at: null, next_lock_at: null, evidence_ids: [], outcome: 'PENDING' }).select('id').single();
    if (reserved.error) {
      if (reserved.error.code === '23505') throw new ApiError(409, 'This idempotency key was claimed concurrently; retry with the same key to retrieve the existing plan.', 'CONFLICT');
      throw reserved.error;
    }
    reservation = { id: String(reserved.data.id), tenantId: context.tenantId };

    const objective = savedSlate.contest.objective;
    const lineupMode = typeof savedInput.lineupMode === 'string' ? savedInput.lineupMode : objective === 'MAX_FPTS' ? 'max_fpts' : undefined;
    freshSlate = { ...freshSlate, contest: { ...freshSlate.contest, userEntryCount: 3, requestedEntryCount: 3, maxEntriesAllowed: Math.max(3, freshSlate.contest.maxEntriesAllowed ?? 3) } };
    const createdRun = await createRun(context.db, { tenantId: context.tenantId, userId: context.userId, requestId, entries: 3, payload: { sport: freshSlate.sport, contestId: String(link.data.contest_id), contestFormat: freshSlate.contest.format, draftGroupId: String(savedInput.draftGroupId), lineupMode, fixedRosterSlots, swapPlanSourceLineupId: lineupId, swapPlanSourceRevision: currentRevision, validatedSlate: freshSlate } });
    modelRun = createdRun;
    const boundPlan = await context.db.from('floyd_dfs_swap_plans').update({ generation_run_id: createdRun.id }).eq('tenant_id', context.tenantId).eq('id', reservation.id);
    if (boundPlan.error) throw boundPlan.error;
    const job = await context.db.from('engine_jobs').insert({ tenant_id: context.tenantId, generation_run_id: createdRun.id, stage: 'SLATE', status: 'running', attempt: 1, max_attempts: 1, started_at: new Date().toISOString(), input_payload: { slateId: freshSlate.slateId, swapPlanId: reservation.id } }).select('id').single();
    if (job.error) throw job.error;
    engineJobId = String(job.data.id);
    const modeled = await processRun(context.db, createdRun, freshSlate, { lineupMode, fixedRosterSlots });
    const completedJob = await context.db.from('engine_jobs').update({ status: modeled.state === 'complete' ? 'succeeded' : 'failed', completed_at: new Date().toISOString(), output_ref: { swapPlanId: reservation.id } }).eq('tenant_id', context.tenantId).eq('id', engineJobId);
    if (completedJob.error) throw completedJob.error;
    const selected = Array.isArray(modeled.lineups) ? modeled.lineups as unknown as SelectedLineup[] : [];
    const traceResult = selected.length ? await context.db.from('floyd_dfs_lineup_decision_traces').select('lineup_candidate_key,trace_payload').eq('tenant_id', context.tenantId).eq('generation_run_id', createdRun.id).in('lineup_candidate_key', selected.map((candidate) => candidate.candidateId)) : { data: [], error: null };
    if (traceResult.error) throw traceResult.error;
    const traces = new Map((traceResult.data ?? []).map((row) => [String(row.lineup_candidate_key), record(row.trace_payload)]));
    const oldMedian = finite(sourceLineup.median) ?? 0;
    const generatedAt = String(record(modeled.stages).projection && record(record(modeled.stages).projection).generatedAt || new Date().toISOString());
    const freshnessMinutes = boundedNumber(process.env.FDS_SWAP_PLAN_FRESHNESS_MINUTES, 5, 1, 30);
    const freshUntil = Date.parse(generatedAt) + freshnessMinutes * 60_000;
    const nextLockAt = lockSnapshot.games.filter((game) => game.locked === false && game.lockTime && Date.parse(game.lockTime) > Date.now()).map((game) => game.lockTime as string).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const expiresAt = nextLockAt ? new Date(Math.min(freshUntil, Date.parse(nextLockAt))).toISOString() : new Date(freshUntil).toISOString();
    const plans = selected.flatMap((candidate, index) => {
      const affectedSlots = Object.keys(sourceLineup.rosterSlots).filter((slot) => sourceLineup.rosterSlots[slot] !== candidate.rosterSlots[slot]);
      if (!affectedSlots.length || Object.entries(fixedRosterSlots).some(([slot, playerId]) => candidate.rosterSlots[slot] !== playerId)) return [];
      const planKey = index === 0 ? idempotencyKey : `${idempotencyKey}:${index + 1}`;
      const trace = traces.get(candidate.candidateId) ?? {};
      const meanDelta = finite(candidate.expectedPoints) !== undefined && finite(sourceLineup.expectedPoints) !== undefined ? Number((candidate.expectedPoints! - sourceLineup.expectedPoints!).toFixed(3)) : null;
      const medianDelta = Number((candidate.median - oldMedian).toFixed(3));
      const evidenceIds = traceEvidenceIds(trace);
      const riskFlags = arrayOfStrings(trace.risks);
      return [{ plan_key: planKey, generation_run_id: createdRun.id, lineup_id: lineupId, source_revision: currentRevision, entry_id: entryId, trigger, constraint_sha256: hash({ rosterRules: freshSlate.rosterRules, fixedRosterSlots, objective: freshSlate.contest.objective }), snapshot_sha256: hash({ slateId: freshSlate.slateId, lockSnapshot, generatedAt, projection: record(modeled.stages).projection }), affected_slots: affectedSlots, replacement_roster: candidate.rosterSlots, salary_delta: candidate.salaryUsed - Number(sourceLineup.salaryUsed ?? 0), salary_remaining: candidate.salaryRemaining, mean_delta: meanDelta, median_delta: medianDelta, point_delta: meanDelta ?? medianDelta, risk_flags: riskFlags, reason: `Fresh server-side recommendation. Mean change ${meanDelta === null ? 'unavailable' : `${meanDelta >= 0 ? '+' : ''}${meanDelta.toFixed(1)}`}; median change ${medianDelta >= 0 ? '+' : ''}${medianDelta.toFixed(1)}. Recommendation only; DraftKings submission remains a separate user action.`, expires_at: expiresAt, next_lock_at: nextLockAt ?? null, evidence_ids: evidenceIds, outcome: 'READY' as const }];
    });
    if (!plans.length) {
      await context.db.from('floyd_dfs_swap_plans').update({ generation_run_id: createdRun.id, reason: 'No distinct legal lineup was produced while preserving every locked player-slot assignment.', expires_at: expiresAt, next_lock_at: nextLockAt ?? null, outcome: 'NO_SOLUTION' }).eq('tenant_id', context.tenantId).eq('id', reservation.id);
      res.status(200).json({ outcome: 'NO_SOLUTION', plans: [], lockSnapshot, generationRunId: createdRun.id });
      return;
    }
    const savedPlans = await context.db.from('floyd_dfs_swap_plans').upsert(plans, { onConflict: 'tenant_id,plan_key' }).select('*');
    if (savedPlans.error) throw savedPlans.error;
    res.status(200).json({ outcome: 'READY', plans: savedPlans.data ?? [], lockSnapshot, generationRunId: createdRun.id, expiresAt, nextLockAt: nextLockAt ?? null, submission: 'Recommendations are local only; no DraftKings entry was changed.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Swap plan generation failed.';
    if (engineJobId && modelRun && context) await context.db.from('engine_jobs').update({ status: 'failed', completed_at: new Date().toISOString(), output_ref: { safeError: message.slice(0, 500) } }).eq('tenant_id', context.tenantId).eq('id', engineJobId);
    if (modelRun && context) await context.db.from('generation_runs').update({ state: 'failed', completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }).eq('tenant_id', context.tenantId).eq('id', modelRun.id);
    if (reservation && context) await context.db.from('floyd_dfs_swap_plans').update({ outcome: 'NO_SOLUTION', reason: message.slice(0, 1000) }).eq('tenant_id', reservation.tenantId).eq('id', reservation.id);
    respondError(req, res, error);
  }
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 200) : ''; }
function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function randomId(): string { return randomUUID(); }
function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function traceEvidenceIds(trace: Record<string, any>): string[] {
  const ids = new Set<string>();
  for (const player of Array.isArray(trace.playerReasons) ? trace.playerReasons : []) {
    for (const evidence of Array.isArray(record(player).evidence) ? record(player).evidence : []) if (typeof record(evidence).findingId === 'string') ids.add(record(evidence).findingId);
    for (const effect of Array.isArray(record(player).appliedEffects) ? record(player).appliedEffects : []) for (const id of arrayOfStrings(record(effect).evidenceFindingIds)) ids.add(id);
  }
  return [...ids].sort();
}

async function persistGameLockSnapshot(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string, slate: ValidatedSlate, snapshot: Awaited<ReturnType<typeof getLateSwapLockSnapshot>>): Promise<void> {
  const byId = new Map((slate.games ?? []).map((game) => [game.gameId, game]));
  const rows = snapshot.games.flatMap((game) => {
    const slateGame = byId.get(game.gameId);
    const start = game.scheduledStart;
    if (!slateGame || !start || !Number.isFinite(Date.parse(start))) return [];
    const material = { slateId: slate.slateId, game, teamIds: slateGame.teamIds };
    return [{ tenant_id: tenantId, slate_id: slate.slateId, canonical_game_id: game.gameId, sport: slate.sport, provider_ids: game.providerGameId ? { [game.source]: game.providerGameId } : {}, team_ids: slateGame.teamIds, scheduled_start: start, lock_time: game.lockTime, status: game.status, content_sha256: hash(material) }];
  });
  if (!rows.length) return;
  const result = await db.from('floyd_dfs_slate_games').upsert(rows, { onConflict: 'tenant_id,slate_id,canonical_game_id' });
  if (result.error) throw result.error;
}
