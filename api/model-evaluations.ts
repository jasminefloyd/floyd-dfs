import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, cors, method, parseBody, requireOperator, respondError, tenantContext } from '../server/runtime.js';
import { canReviewEvaluation, promotionEvidence, type StoredEvaluation } from '../server/learning/promotion.js';
import { readFeatureFlags } from '../server/featureFlags.js';

const COMPONENTS = ['PROJECTION','SIMULATION','FIELD_MODEL','OPTIMIZER','PORTFOLIO'] as const;
const SPORTS = ['NBA','WNBA','MLB','NFL','CFB','GOLF'] as const;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET','POST'])) return;
  try {
    const context = await tenantContext(req); requireOperator(context);
    if (req.method === 'GET') {
      const evaluations = await queryAll((start, end) => context.db.from('floyd_dfs_model_evaluations').select('id,tenant_id,sport,contest_format,component,model_version,baseline_model_version,candidate_model_version,evaluation_window,sample_count,holdout_name,metrics,data_manifest,gate_decision,reviewed_by,reviewed_at,review_note,created_at').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).range(start, end));
      const registry = await queryAll((start, end) => context.db.from('floyd_dfs_model_registry').select('id,tenant_id,sport,component,model_version,status,config,evaluation_id,created_at').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).range(start, end));
      const portfolioPerformance = await loadPortfolioPerformance(context.db, context.tenantId);
      const houseResult = await context.db.from('floyd_dfs_house_reports').select('id,model_version,baseline_model_version,forecast_cutoff,baseline,adjustments,trust_status,created_at').eq('tenant_id', context.tenantId).eq('sport', 'NBA').order('created_at', { ascending: false }).limit(200);
      if (houseResult.error) throw houseResult.error;
      const houseReports = (houseResult.data ?? []) as Array<Record<string, unknown>>;
      const featureFlags = readFeatureFlags();
      cors(req, res); res.status(200).json({ evaluations, registry, portfolioPerformance, nbaHouseShadowParity: houseReports.map(summarizeHouseParity), rollout: { featureFlags, productionCutover: 'DISABLED', canarySportScope: 'NBA_ONLY', canaryRuntimeAdapter: 'NOT_CONNECTED', legacyGenerationRoute: 'PRESERVED' }, promotionRelease: 'MANUAL_REVIEW_REQUIRED; candidate evidence remains separate from production runtime.' }); return;
    }
    if (!readFeatureFlags().LEARNING_V2) throw new ApiError(503, 'Learning registry changes are disabled by the LEARNING_V2 rollback switch.', 'FEATURE_DISABLED');
    const body = parseBody(req);
    if (body.action === 'register') {
      const sport = text(body.sport).toUpperCase(); const component = text(body.component).toUpperCase(); const modelVersion = text(body.modelVersion); const evaluationId = text(body.evaluationId);
      if (!SPORTS.includes(sport as typeof SPORTS[number]) || !COMPONENTS.includes(component as typeof COMPONENTS[number]) || !modelVersion || modelVersion.length > 180 || !evaluationId) throw new ApiError(400, 'sport, component, modelVersion, and evaluationId are required.', 'VALIDATION_FAILED');
      const evaluation = await getEvaluation(context.db, context.tenantId, evaluationId);
      if (evaluation.sport !== sport || evaluation.component !== component) throw new ApiError(409, 'Evaluation sport/component does not match the candidate model.', 'CONFLICT');
      const inserted = await context.db.rpc('floyd_dfs_register_model_registry', { p_tenant_id: context.tenantId, p_actor_id: context.userId, p_sport: sport, p_component: component, p_model_version: modelVersion, p_config: isRecord(body.config) ? body.config : {}, p_evaluation_id: evaluation.id });
      if (inserted.error) throw inserted.error;
      const registryRow = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
      if (!registryRow) throw new ApiError(500, 'Model registry registration returned no record.', 'INTERNAL_ERROR');
      cors(req, res); res.status(201).json({ registry: registryRow, message: 'Registered as EXPERIMENTAL with an append-only audit event. Registration does not alter runtime behavior.' }); return;
    }
    if (body.action === 'review') {
      const evaluationId = text(body.evaluationId); const decision = text(body.decision).toUpperCase(); const reviewNote = text(body.reviewNote);
      if (!evaluationId || !['PROMOTE','HOLD','INSUFFICIENT_DATA'].includes(decision) || reviewNote.length < 8) throw new ApiError(400, 'evaluationId, a valid decision, and a reviewNote of at least 8 characters are required.', 'VALIDATION_FAILED');
      const evaluation = await getEvaluation(context.db, context.tenantId, evaluationId);
      const gate = canReviewEvaluation(evaluation.metrics, evaluation.sample_count);
      if (decision === 'PROMOTE' && !gate.promotable) throw new ApiError(409, `Promotion review rejected: ${gate.reason}`, 'CONFLICT');
      const update = await context.db.from('floyd_dfs_model_evaluations').update({ gate_decision: decision, reviewed_by: context.userId, reviewed_at: new Date().toISOString(), review_note: reviewNote }).eq('tenant_id', context.tenantId).eq('id', evaluationId).select('*').single();
      if (update.error) throw update.error;
      cors(req, res); res.status(200).json({ evaluation: update.data, gate }); return;
    }
    if (body.action === 'transition') {
      const registryId = text(body.registryId); const target = text(body.status).toUpperCase(); const evaluationId = text(body.evaluationId);
      if (!registryId || !['SHADOW','CANARY','RETIRED'].includes(target)) throw new ApiError(400, 'registryId and status SHADOW, CANARY, or RETIRED are required. ACTIVE is reserved for P7 runtime rollout.', 'VALIDATION_FAILED');
      const reviewNote = text(body.reviewNote);
      if (reviewNote.length < 8) throw new ApiError(400, 'A reviewNote of at least 8 characters is required for an audited registry transition.', 'VALIDATION_FAILED');
      const prior = await context.db.from('floyd_dfs_model_registry').select('*').eq('tenant_id', context.tenantId).eq('id', registryId).maybeSingle();
      if (prior.error) throw prior.error;
      if (!prior.data) throw new ApiError(404, 'Model registry record not found.', 'NOT_FOUND');
      const current = String(prior.data.status);
      if (target !== 'RETIRED') {
        const chosenEvaluationId = evaluationId || String(prior.data.evaluation_id ?? '');
        if (!chosenEvaluationId) throw new ApiError(409, 'A persisted evaluation is required before a candidate can enter shadow or canary.', 'CONFLICT');
        const evaluation = await getEvaluation(context.db, context.tenantId, chosenEvaluationId);
        if (evaluation.sport !== prior.data.sport || evaluation.component !== prior.data.component) throw new ApiError(409, 'Evaluation does not match this model registry record.', 'CONFLICT');
        if (target === 'CANARY') {
          if (String(prior.data.sport).toUpperCase() !== 'NBA') throw new ApiError(409, 'P7 canary rollout is restricted to NBA; other sports retain the existing route.', 'CONFLICT');
          if (!['PROJECTION','SIMULATION'].includes(String(prior.data.component))) throw new ApiError(409, 'Only NBA projection or simulation candidates can enter the P7 canary review path.', 'CONFLICT');
          if (!readFeatureFlags().NBA_HOUSE_V1) throw new ApiError(409, 'NBA_HOUSE_V1 is disabled; the current production path remains active.', 'CONFLICT');
          const gate = promotionEvidence(evaluation);
          if (!gate.eligible) throw new ApiError(409, `Canary transition blocked: ${gate.reasons.join(' ')}`, 'CONFLICT');
        }
        if (current === 'CANARY' && target === 'SHADOW') throw new ApiError(409, 'Canary models cannot return to shadow; retire and register a new version.', 'CONFLICT');
        if (current === 'RETIRED') throw new ApiError(409, 'Retired model versions cannot be reactivated.', 'CONFLICT');
      }
      if (target === 'RETIRED' && current === 'ACTIVE') throw new ApiError(409, 'ACTIVE models must be retired through the P7 rollout control.', 'CONFLICT');
      const chosenEvaluationId = target === 'RETIRED' ? evaluationId || String(prior.data.evaluation_id ?? '') : evaluationId || String(prior.data.evaluation_id ?? '');
      const transitioned = await context.db.rpc('floyd_dfs_transition_model_registry', { p_tenant_id: context.tenantId, p_registry_id: registryId, p_actor_id: context.userId, p_expected_status: current, p_next_status: target, p_evaluation_id: chosenEvaluationId || null, p_note: reviewNote });
      if (transitioned.error) throw transitioned.error;
      const registryRow = Array.isArray(transitioned.data) ? transitioned.data[0] : transitioned.data;
      if (!registryRow) throw new ApiError(409, 'Model registry transition did not update the expected record.', 'CONFLICT');
      cors(req, res); res.status(200).json({ registry: registryRow, runtimeChanged: false, audited: true, ...(target === 'CANARY' ? { canaryRuntimeAdapter: 'NOT_CONNECTED', message: 'Recorded NBA canary eligibility only. No candidate is routed to production until a runtime adapter is explicitly enabled.' } : {}) }); return;
    }
    throw new ApiError(400, 'Unsupported model-evaluation action.', 'VALIDATION_FAILED');
  } catch (error) { respondError(req, res, error); }
}

async function getEvaluation(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string, id: string): Promise<StoredEvaluation> {
  const result = await db.from('floyd_dfs_model_evaluations').select('id,tenant_id,sport,component,gate_decision,reviewed_by,reviewed_at,review_note,sample_count,metrics,data_manifest').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, 'Model evaluation not found.', 'NOT_FOUND');
  return result.data as StoredEvaluation;
}

async function loadPortfolioPerformance(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string) {
  const portfolios = await queryAll((start, end) => db.from('floyd_dfs_lineup_portfolios').select('id,contest_id,objective,entry_count,created_at,field_model_status,payout_status').eq('tenant_id', tenantId).order('created_at', { ascending: false }).range(start, end));
  if (!portfolios.length) return [];
  const portfolioIds = portfolios.map((portfolio) => String(portfolio.id)); const members: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < portfolioIds.length; offset += 300) {
    const page = await queryAll((start, end) => db.from('floyd_dfs_portfolio_members').select('portfolio_id,lineup_id,lineup_revision,entry_status,settlement_status,entry_fee').eq('tenant_id', tenantId).in('portfolio_id', portfolioIds.slice(offset, offset + 300)).order('lineup_revision', { ascending: false }).range(start, end));
    members.push(...page);
  }
  const latestMembers = new Map<string, Record<string, unknown>>();
  for (const member of members) { const key = `${member.portfolio_id}:${member.lineup_id}`; if (!latestMembers.has(key)) latestMembers.set(key, member); }
  const lineupIds = [...new Set([...latestMembers.values()].map((member) => String(member.lineup_id)))];
  const entryLinks: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < lineupIds.length; offset += 300) {
    const page = await queryAll((start, end) => db.from('floyd_dfs_entry_links').select('generated_lineup_id,contest_id,external_entry_id').eq('tenant_id', tenantId).in('generated_lineup_id', lineupIds.slice(offset, offset + 300)).range(start, end));
    entryLinks.push(...page);
  }
  const linkedEntryByKey = new Map(entryLinks.map((link) => [`${link.generated_lineup_id}:${link.contest_id}`, String(link.external_entry_id)]));
  const results: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < lineupIds.length; offset += 300) {
    const page = await queryAll((start, end) => db.from('floyd_dfs_contest_results').select('generated_lineup_id,contest_id,external_entry_id,payout,refund_amount,entry_fee,official_outcome,model_evaluation_eligible,reconciliation_status,result_payload,measured_at').eq('tenant_id', tenantId).in('generated_lineup_id', lineupIds.slice(offset, offset + 300)).eq('official_outcome', true).not('payout', 'is', null).not('refund_amount', 'is', null).order('measured_at', { ascending: false }).range(start, end));
    results.push(...page);
  }
  const resultByKey = new Map<string, Record<string, unknown>>();
  for (const result of results) { const key = `${result.generated_lineup_id}:${result.contest_id}:${result.external_entry_id}`; if (!resultByKey.has(key)) resultByKey.set(key, result); }
  return portfolios.map((portfolio) => {
    const portfolioMembers = [...latestMembers.values()].filter((member) => String(member.portfolio_id) === String(portfolio.id) && member.entry_status === 'ENTERED' && member.settlement_status === 'VERIFIED');
    const realized = portfolioMembers.flatMap((member) => {
      const externalEntryId = linkedEntryByKey.get(`${member.lineup_id}:${portfolio.contest_id}`);
      const result = externalEntryId ? resultByKey.get(`${member.lineup_id}:${portfolio.contest_id}:${externalEntryId}`) : undefined;
      const payload = record(result?.result_payload);
      if (!result || payload?.fullFieldImport !== true || result.reconciliation_status !== 'MATCHED' || result.model_evaluation_eligible !== true) return [];
      const fee = number(result.entry_fee ?? member.entry_fee); const payout = number(result.payout); const refund = number(result.refund_amount);
      return fee >= 0 && payout >= 0 && refund >= 0 ? [{ fee, payout, refund }] : [];
    });
    const totalFees = realized.reduce((sum, row) => sum + row.fee, 0); const totalPayout = realized.reduce((sum, row) => sum + row.payout + row.refund, 0);
    return { ...portfolio, enteredEntries: portfolioMembers.length, reconciledOfficialEntries: realized.length, realizedEntryFees: realized.length ? totalFees : null, realizedPayout: realized.length ? totalPayout : null, realizedNet: realized.length ? totalPayout - totalFees : null, realizedRoi: totalFees > 0 ? (totalPayout - totalFees) / totalFees : null, financialSource: realized.length ? 'FULL_FIELD_OFFICIAL_RESULTS_RECONCILED' : 'UNAVAILABLE' };
  });
}

function summarizeHouseParity(row: Record<string, unknown>) {
  const baseline = record(row.baseline);
  const adjustments = record(row.adjustments);
  const adjusted = record(adjustments?.adjustedProjections);
  const baselinePlayers = new Map<string, Record<string, unknown>>((Array.isArray(baseline?.players) ? baseline.players : []).flatMap((player) => {
    const item = record(player); const id = String(item?.playerId ?? ''); return item && id ? [[id, item] as [string, Record<string, unknown>]] : [];
  }));
  const deltas = (Array.isArray(adjusted?.players) ? adjusted.players : []).flatMap((player) => {
    const item = record(player); const id = String(item?.playerId ?? ''); const before = baselinePlayers.get(id);
    if (!item || !before) return [];
    const beforePoints = finiteNumber(record(before.projectedOutcomes)?.medianP50);
    const afterPoints = finiteNumber(record(item.projectedOutcomes)?.medianP50);
    return beforePoints !== null && afterPoints !== null ? [afterPoints - beforePoints] : [];
  });
  return {
    reportId: row.id,
    modelVersion: row.model_version,
    baselineModelVersion: row.baseline_model_version,
    forecastCutoff: row.forecast_cutoff,
    createdAt: row.created_at,
    trustStatus: row.trust_status,
    pairedPlayers: deltas.length,
    changedPlayers: deltas.filter((delta) => Math.abs(delta) > 0.000001).length,
    meanAbsoluteMedianDelta: deltas.length ? deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length : null,
    maxAbsoluteMedianDelta: deltas.length ? Math.max(...deltas.map(Math.abs)) : null,
    comparison: 'BASELINE_VS_ADJUSTED_PROJECTION_OUTPUT_ONLY',
  };
}

async function queryAll(makeQuery: (start: number, end: number) => any): Promise<any[]> { const all: any[] = []; for (let start = 0; ; start += 1000) { const result = await makeQuery(start, start + 999); if (result.error) throw result.error; const rows = result.data ?? []; all.push(...rows); if (rows.length < 1000) return all; } }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function finiteNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function record(value: unknown): Record<string, unknown> | undefined { return isRecord(value) ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
