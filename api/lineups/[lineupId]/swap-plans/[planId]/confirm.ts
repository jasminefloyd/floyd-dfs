import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { ApiError, draftKingsClient, method, parseBody, requireOwnedLineup, respondError, tenantContext } from '../../../../../server/runtime.js';
import { getLateSwapLockSnapshot } from '../../../../../server/gameLockProvider.js';
import { extractLateSwapEligibility } from '../../../../../src/lib/engine/draftKings.js';
import { validateLineupCandidate } from '../../../../../src/lib/engine/validation.js';
import type { ValidatedSlate } from '../../../../../src/lib/engine/contracts.js';

/** Append a locally approved recommendation revision after a live lock/revision recheck. Never submits to DraftKings. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(req);
    const lineupId = String(req.query.lineupId ?? '');
    const planId = String(req.query.planId ?? '');
    await requireOwnedLineup(context, lineupId);
    const body = parseBody(req);
    if (body.confirmRecommendation !== true) throw new ApiError(400, 'Set confirmRecommendation=true to append this local recommendation revision.', 'VALIDATION_FAILED');
    const planResult = await context.db.from('floyd_dfs_swap_plans').select('*').eq('tenant_id', context.tenantId).eq('lineup_id', lineupId).eq('id', planId).single();
    if (planResult.error) throw planResult.error;
    const plan = planResult.data;
    if (plan.outcome !== 'READY' || !plan.generation_run_id) throw new ApiError(409, 'Only a ready swap plan with a persisted modeling run can be confirmed.', 'CONFLICT');
    if (!plan.expires_at || Date.parse(plan.expires_at) <= Date.now()) throw new ApiError(409, 'This swap plan expired; request a new plan.', 'CONFLICT');
    if (Number(body.sourceRevision) !== Number(plan.source_revision)) throw new ApiError(409, 'The confirmation source revision does not match the plan.', 'CONFLICT');

    const latestRevision = await context.db.from('floyd_dfs_lineup_revisions').select('revision').eq('tenant_id', context.tenantId).eq('lineup_id', lineupId).order('revision', { ascending: false }).limit(1).maybeSingle();
    if (latestRevision.error) throw latestRevision.error;
    const currentRevision = Number(latestRevision.data?.revision ?? 0);
    if (currentRevision !== Number(plan.source_revision)) throw new ApiError(409, 'The lineup changed after this plan was generated; request a new plan.', 'CONFLICT');
    const link = await context.db.from('floyd_dfs_entry_links').select('contest_id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).eq('external_entry_id', plan.entry_id).maybeSingle();
    if (link.error) throw link.error;
    if (!link.data || String(link.data.contest_id) !== String(plan.entry_id ? link.data.contest_id : '')) throw new ApiError(409, 'The DraftKings entry link is missing.', 'CONFLICT');

    const stages = await context.db.from('engine_stage_runs').select('stage,output_payload').eq('tenant_id', context.tenantId).eq('generation_run_id', plan.generation_run_id).in('stage', ['SLATE','OPTIMIZE']).order('created_at', { ascending: true });
    if (stages.error) throw stages.error;
    const slateStage = [...(stages.data ?? [])].reverse().find((stage) => stage.stage === 'SLATE');
    const optimizerStage = [...(stages.data ?? [])].reverse().find((stage) => stage.stage === 'OPTIMIZE');
    const slate = (record(slateStage?.output_payload).enrichedSlate ?? record(slateStage?.output_payload).slate ?? record(slateStage?.output_payload)) as unknown as ValidatedSlate;
    const optimizer = record(optimizerStage?.output_payload);
    if (!slate || slate.tenantId !== context.tenantId || slate.contest.draftKingsContestId !== String(link.data.contest_id)) throw new ApiError(409, 'The plan slate snapshot is missing or does not match this tenant-owned contest.', 'CONFLICT');
    const lateSwapAllowed = extractLateSwapEligibility((await draftKingsClient().getContest(String(link.data.contest_id))).data);
    if (lateSwapAllowed !== true) throw new ApiError(409, 'DraftKings no longer explicitly confirms late-swap eligibility for this contest.', 'CONFLICT');
    const lockSnapshot = await getLateSwapLockSnapshot(slate, { lateSwapAllowed });
    if (lockSnapshot.verification !== 'VERIFIED' || lockSnapshot.games.some((game) => game.locked === null)) throw new ApiError(409, 'Game lock state is stale, conflicting, or unsupported; this plan cannot be confirmed.', 'CONFLICT');

    const rosterSlots = record(plan.replacement_roster) as Record<string, string>;
    const playerIds = Object.values(rosterSlots);
    const candidate = (Array.isArray(optimizer.candidates) ? optimizer.candidates : []).find((item: unknown) => stableJson(record(item).rosterSlots) === stableJson(rosterSlots));
    if (!candidate) throw new ApiError(409, 'The planned roster is not present in its recorded optimizer output.', 'CONFLICT');
    const salaryUsed = finite(record(candidate).salaryUsed);
    if (salaryUsed === undefined) throw new ApiError(409, 'The plan is missing a validated salary total.', 'CONFLICT');
    const sourceLineup = await context.db.from('floyd_dfs_generated_lineups').select('lineup_payload').eq('tenant_id', context.tenantId).eq('id', lineupId).single();
    if (sourceLineup.error) throw sourceLineup.error;
    const currentRoster = record(record(sourceLineup.data.lineup_payload).rosterSlots) as Record<string, string>;
    const fixed: Record<string, string> = {};
    const gameForPlayer = (playerId: string) => slate.playerPool.find((player) => player.playerId === playerId)?.gameId;
    for (const [slot, playerId] of Object.entries(currentRoster)) {
      const gameId = gameForPlayer(playerId);
      const game = lockSnapshot.games.find((item) => item.gameId === gameId);
      if (!game || game.locked === null) throw new ApiError(409, `Could not verify lock state for stored player ${playerId}.`, 'CONFLICT');
      if (game.locked) fixed[slot] = playerId;
    }
    if (Object.entries(fixed).some(([slot, playerId]) => rosterSlots[slot] !== playerId)) throw new ApiError(409, 'The plan changes a locked roster assignment.', 'CONFLICT');
    const errors = validateLineupCandidate({ playerIds, rosterSlots, salaryUsed }, slate, { lockedSlotAssignments: fixed });
    if (errors.length) throw new ApiError(409, `The plan no longer passes lineup validation: ${errors.slice(0, 3).join(' ')}`, 'CONFLICT');

    const contentSha = digest({ planId, lineupId, sourceRevision: currentRevision, rosterSlots });
    const prior = await context.db.from('floyd_dfs_lineup_revisions').select('id,revision,state,slot_assignments').eq('tenant_id', context.tenantId).eq('lineup_id', lineupId).eq('content_sha256', contentSha).maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) { res.status(200).json({ revision: prior.data, alreadyConfirmed: true, draftKingsSubmitted: false }); return; }
    const inserted = await context.db.from('floyd_dfs_lineup_revisions').insert({ tenant_id: context.tenantId, lineup_id: lineupId, revision: currentRevision + 1, parent_revision: currentRevision || null, generation_run_id: plan.generation_run_id, input_sha256: String(plan.snapshot_sha256), model_sha256: digest(optimizer), rules_sha256: digest(slate.rosterRules), slot_assignments: rosterSlots, generated_at: new Date().toISOString(), state: 'RECOMMENDED', submission_confirmed_at: null, content_sha256: contentSha }).select('id,revision,state,slot_assignments,generated_at').single();
    if (inserted.error) {
      if (inserted.error.code === '40001' || inserted.error.code === '23505') {
        const raced = await context.db.from('floyd_dfs_lineup_revisions').select('id,revision,state,slot_assignments,generated_at').eq('tenant_id', context.tenantId).eq('lineup_id', lineupId).eq('content_sha256', contentSha).maybeSingle();
        if (raced.data) { res.status(200).json({ revision: raced.data, alreadyConfirmed: true, draftKingsSubmitted: false }); return; }
      }
      throw inserted.error;
    }
    res.status(201).json({ revision: inserted.data, alreadyConfirmed: false, draftKingsSubmitted: false, message: 'Recommendation saved as a new local revision. The DraftKings entry was not changed.' });
  } catch (error) { respondError(req, res, error); }
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function stableJson(value: unknown): string { if (!value || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
function digest(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
