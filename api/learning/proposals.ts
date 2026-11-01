import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, cors, method, parseBody, requireOperator, respondError, tenantContext } from '../../server/runtime.js';
import { promotionEvidence, type StoredEvaluation } from '../../server/learning/promotion.js';
import { isFeatureEnabled } from '../../server/featureFlags.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const context = await tenantContext(req); requireOperator(context);
    if (req.method === 'GET') {
      const proposals = await context.db.from('floyd_dfs_model_change_proposals').select('*').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).limit(200);
      if (proposals.error) throw proposals.error;
      const ids = (proposals.data ?? []).map((proposal) => String(proposal.id));
      const events = ids.length ? await context.db.from('floyd_dfs_model_change_proposal_events').select('*').eq('tenant_id', context.tenantId).in('proposal_id', ids).order('created_at', { ascending: true }) : { data: [], error: null };
      if (events.error) throw events.error;
      cors(req, res); res.status(200).json({ proposals: proposals.data ?? [], events: events.data ?? [], runtimeEffect: 'NONE_WITHOUT_SEPARATE_REGISTRY_AND_ROLLOUT_CONTROLS' }); return;
    }

    const body = parseBody(req);
    if (!isFeatureEnabled('LEARNING_V2')) throw new ApiError(503, 'Model change proposal writes are disabled by the LEARNING_V2 rollback switch.', 'FEATURE_DISABLED');
    if (body.action === 'create') {
      const input = normalizeProposal(body, context.userId);
      const referencedLessons = await context.db.from('floyd_dfs_lesson_candidates').select('id,status,sample_count,sport,stage').eq('tenant_id', context.tenantId).in('id', input.evidence_refs);
      if (referencedLessons.error) throw referencedLessons.error;
      const foundRefs = new Set((referencedLessons.data ?? []).map((row) => String(row.id)));
      const missingRefs = input.evidence_refs.filter((reference) => !foundRefs.has(reference));
      if (missingRefs.length) throw new ApiError(400, `Evidence references were not found in this tenant's lesson records: ${missingRefs.slice(0, 5).join(', ')}.`, 'VALIDATION_FAILED');
      const immature = (referencedLessons.data ?? []).filter((row) => Number(row.sample_count) < 3 || !['ACCUMULATING','VALIDATED'].includes(String(row.status)));
      if (immature.length) throw new ApiError(409, 'A model-change proposal requires at least three repeated, accumulated outcome observations for every cited lesson.', 'CONFLICT');
      if ((referencedLessons.data ?? []).some((row) => String(row.sport) !== input.sport)) throw new ApiError(409, 'Evidence lessons must match the proposal sport.', 'CONFLICT');
      const inserted = await context.db.from('floyd_dfs_model_change_proposals').insert({ tenant_id: context.tenantId, ...input }).select('*').single();
      if (inserted.error) throw inserted.error;
      await appendEvent(context.db, context.tenantId, String(inserted.data.id), context.userId, 'CREATED', 'Operator created a hypothesis for separate evaluation.', { evidenceCount: input.evidence_refs.length });
      cors(req, res); res.status(201).json({ proposal: inserted.data, runtimeChanged: false }); return;
    }

    if (body.action === 'review') {
      const proposalId = requiredText(body.proposalId, 'proposalId', 100);
      const decision = requiredText(body.decision, 'decision', 20).toUpperCase();
      const note = requiredText(body.note, 'note', 2000);
      if (!['HOLD', 'REJECTED', 'APPROVED'].includes(decision) || note.length < 8) throw new ApiError(400, 'decision must be HOLD, REJECTED, or APPROVED and note must contain at least 8 characters.', 'VALIDATION_FAILED');
      const current = await context.db.from('floyd_dfs_model_change_proposals').select('*').eq('tenant_id', context.tenantId).eq('id', proposalId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) throw new ApiError(404, 'Model change proposal was not found.', 'NOT_FOUND');
      const evaluationId = typeof body.evaluationId === 'string' ? body.evaluationId.trim() : String(current.data.evaluation_id ?? '');
      if (decision === 'APPROVED') {
        if (!evaluationId) throw new ApiError(409, 'A separately persisted holdout evaluation is required before approval.', 'CONFLICT');
        const evaluation = await context.db.from('floyd_dfs_model_evaluations').select('id,tenant_id,sport,component,model_version,candidate_model_version,gate_decision,reviewed_by,reviewed_at,review_note,sample_count,metrics,data_manifest').eq('tenant_id', context.tenantId).eq('id', evaluationId).maybeSingle();
        if (evaluation.error) throw evaluation.error;
        if (!evaluation.data) throw new ApiError(404, 'Linked evaluation was not found.', 'NOT_FOUND');
        if (String(evaluation.data.sport) !== String(current.data.sport) || String(evaluation.data.component) !== String(current.data.component) || String(evaluation.data.candidate_model_version ?? evaluation.data.model_version) !== String(current.data.candidate_model_version)) throw new ApiError(409, 'The linked evaluation does not match the proposal sport, component, and candidate model version.', 'CONFLICT');
        const gate = promotionEvidence(evaluation.data as StoredEvaluation);
        if (!gate.eligible) throw new ApiError(409, `Proposal approval blocked: ${gate.reasons.join(' ')}`, 'CONFLICT');
      }
      const updated = await context.db.from('floyd_dfs_model_change_proposals').update({ status: decision, ...(evaluationId ? { evaluation_id: evaluationId } : {}), updated_at: new Date().toISOString() }).eq('tenant_id', context.tenantId).eq('id', proposalId).select('*').single();
      if (updated.error) throw updated.error;
      await appendEvent(context.db, context.tenantId, proposalId, context.userId, 'REVIEWED', note, { decision, evaluationId: evaluationId || null });
      cors(req, res); res.status(200).json({ proposal: updated.data, runtimeChanged: false, message: 'Proposal review is recorded. Approval does not change the runtime model or production route.' }); return;
    }
    throw new ApiError(400, 'action must be create or review.', 'VALIDATION_FAILED');
  } catch (error) { respondError(req, res, error); }
}

function normalizeProposal(body: Record<string, unknown>, ownerId: string) {
  const windows = {
    training_window: requiredText(body.trainingWindow, 'trainingWindow', 120),
    validation_window: requiredText(body.validationWindow, 'validationWindow', 120),
    holdout_window: requiredText(body.holdoutWindow, 'holdoutWindow', 120),
  };
  const start = (value: string) => Date.parse(value.split(/[,)\]]/)[0]!.replace(/^\[/, ''));
  const trainingStart = start(windows.training_window); const validationStart = start(windows.validation_window); const holdoutStart = start(windows.holdout_window);
  if (![trainingStart, validationStart, holdoutStart].every(Number.isFinite) || trainingStart >= validationStart || validationStart >= holdoutStart) throw new ApiError(400, 'Training, validation, and holdout windows must be parseable and chronological.', 'VALIDATION_FAILED');
  const evidence = Array.isArray(body.evidenceRefs) ? [...new Set(body.evidenceRefs.map((value) => requiredText(value, 'evidenceRefs item', 300)))] : [];
  if (evidence.length < 3) throw new ApiError(400, 'At least three distinct evidence references are required for a repeatable-pattern proposal.', 'VALIDATION_FAILED');
  return {
    title: requiredText(body.title, 'title', 180), hypothesis: requiredText(body.hypothesis, 'hypothesis', 4000),
    affected_driver: requiredText(body.affectedDriver, 'affectedDriver', 180), pattern_group: requiredText(body.patternGroup, 'patternGroup', 180),
    sport: enumText(body.sport, 'sport', ['NBA','WNBA','MLB','NFL','CFB','GOLF']), component: enumText(body.component, 'component', ['PROJECTION','SIMULATION','FIELD_MODEL','OPTIMIZER','PORTFOLIO']),
    evidence_refs: evidence, ...windows,
    expected_benefit: requiredText(body.expectedBenefit, 'expectedBenefit', 2000), failure_risks: requiredText(body.failureRisks, 'failureRisks', 2000),
    owner_id: ownerId, code_version: requiredText(body.codeVersion, 'codeVersion', 180),
    baseline_model_version: requiredText(body.baselineModelVersion, 'baselineModelVersion', 180),
    candidate_model_version: requiredText(body.candidateModelVersion, 'candidateModelVersion', 180),
  };
}
async function appendEvent(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string, proposalId: string, actorId: string, action: string, note: string, metadata: Record<string, unknown>) {
  const result = await db.from('floyd_dfs_model_change_proposal_events').insert({ tenant_id: tenantId, proposal_id: proposalId, actor_id: actorId, action, note, metadata });
  if (result.error) throw result.error;
}
function requiredText(value: unknown, name: string, maxLength: number): string { const text = typeof value === 'string' ? value.trim() : ''; if (!text || text.length > maxLength) throw new ApiError(400, `${name} is required and must be at most ${maxLength} characters.`, 'VALIDATION_FAILED'); return text; }
function enumText(value: unknown, name: string, allowed: string[]): string { const text = requiredText(value, name, 30).toUpperCase(); if (!allowed.includes(text)) throw new ApiError(400, `${name} is unsupported.`, 'VALIDATION_FAILED'); return text; }
