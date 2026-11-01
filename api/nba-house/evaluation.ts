import type { VercelRequest, VercelResponse } from '@vercel/node';
import { evaluateNbaHouse, type NbaHouseEvaluationRow } from '../../server/houses/nba/evaluation.js';
import { ApiError, cors, method, parseBody, requireOperator, respondError, tenantContext } from '../../server/runtime.js';
import { getStreetTeamSnapshot } from '../../server/streetTeam.js';
import { isFeatureEnabled } from '../../server/featureFlags.js';

type Row = Record<string, unknown>;
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(req); requireOperator(context);
    const body = parseBody(req); const validationCutoff = text(body.validationCutoff); const holdoutCutoff = text(body.holdoutCutoff);
    if (![validationCutoff, holdoutCutoff].every((value) => Number.isFinite(Date.parse(value)) && /(?:Z|\+00:00)$/i.test(value)) || Date.parse(validationCutoff) >= Date.parse(holdoutCutoff)) throw new ApiError(400, 'validationCutoff and holdoutCutoff must be ordered UTC timestamps recorded before the evaluation query.', 'VALIDATION_FAILED');
    const preRegisteredAt = new Date().toISOString();
    const reports = await context.db.from('floyd_dfs_house_reports').select('id,generation_run_id,intel_snapshot_id,model_version,forecast_cutoff,baseline,adjustments,scenario_metadata,created_at').eq('tenant_id', context.tenantId).eq('sport', 'NBA').not('generation_run_id', 'is', null).order('created_at', { ascending: true }).limit(500);
    if (reports.error) throw reports.error;
    const rows: NbaHouseEvaluationRow[] = []; const actualSourceCounts: Record<string, number> = {};
    for (const report of reports.data ?? []) {
      const runId = String(report.generation_run_id ?? ''); if (!runId) continue;
      const actuals = await context.db.from('floyd_dfs_historical_player_actuals').select('slate_id,sport,player_id,projection_generated_at,lock_time,actual_dk_points,actual_components,source_validation_status,finality_status,provider').eq('tenant_id', context.tenantId).eq('generation_run_id', runId).eq('sport', 'NBA').eq('source_validation_status', 'VERIFIED').in('finality_status', ['FINAL', 'CORRECTED']);
      if (actuals.error) throw actuals.error;
      const snapshot = await getStreetTeamSnapshot(context.db, context.tenantId, String(report.intel_snapshot_id));
      if (!snapshot) { actualSourceCounts.MISSING_LINKED_SNAPSHOT = (actualSourceCounts.MISSING_LINKED_SNAPSHOT ?? 0) + (actuals.data?.length ?? 0); continue; }
      const baseline = record(report.baseline); const adjustments = record(report.adjustments); const metadata = record(report.scenario_metadata);
      const candidate = record(metadata.candidateProjection) ?? record(adjustments.candidateProjection) ?? record(adjustments.adjustedProjections);
      const basePlayers = keyedPlayers(baseline); const candidatePlayers = keyedPlayers(candidate); const catalog = new Map(array(metadata.playerCatalog).map((player) => [String(player.playerId), player]));
      const decisions = record(metadata.driverDecisions); const decisionByPlayer = new Map<string, Row>();
      for (const groupName of ['appliedDrivers', 'reportOnlyContext', 'rejectedOrConflictingEvidence', 'noAdjustment']) for (const decision of array(decisions[groupName])) decisionByPlayer.set(String(decision.playerId), decision);
      for (const actual of actuals.data ?? []) {
        const playerId = String(actual.player_id); const before = basePlayers.get(playerId); const after = candidatePlayers.get(playerId); const playerInfo = catalog.get(playerId); const outcome = record(actual.actual_components); const decision = decisionByPlayer.get(playerId);
        if (!before || !after) { actualSourceCounts.MISSING_PAIRED_HOUSE_PROJECTION = (actualSourceCounts.MISSING_PAIRED_HOUSE_PROJECTION ?? 0) + 1; continue; }
        const evidenceIds = Array.isArray(decision?.evidenceIds) ? decision.evidenceIds.map(String) : [];
        const observations = snapshot.observations.filter((observation) => evidenceIds.includes(observation.id));
        const baseOutput = record(before.projectedOutcomes); const candidateOutput = record(after.projectedOutcomes);
        const baseOpportunity = record(before.adjustedOpportunity); const candidateOpportunity = record(after.adjustedOpportunity);
        const applied = decision?.decision === 'APPLY'; const source = String(actual.provider);
        rows.push({ slateId: String(actual.slate_id ?? report.id), gameId: String(playerInfo?.gameId ?? ''), playerId, eventTime: String(actual.lock_time), projectionGeneratedAt: String(actual.projection_generated_at ?? baseline.generatedAt ?? report.created_at), lockTime: String(actual.lock_time), knowledgeCutoff: String(report.forecast_cutoff), evidenceEffectiveAt: latestTime(observations.map((item) => item.effectiveAt)), evidenceIngestedAt: latestTime(observations.map((item) => item.retrievedAt)), actualSourceVerified: actual.source_validation_status === 'VERIFIED' && source === 'SPORTSDATAIO_NBA_FINAL', actualFinality: String(actual.finality_status) as NbaHouseEvaluationRow['actualFinality'], driverType: String(decision?.driverType ?? 'NO_ADJUSTMENT'), driverApplied: applied,
          ...(numberOrUndefined(baseOpportunity.expectedMinutes) !== undefined ? { baselineMinutes: numberOrUndefined(baseOpportunity.expectedMinutes)! } : {}), ...(numberOrUndefined(candidateOpportunity.expectedMinutes) !== undefined ? { candidateMinutes: numberOrUndefined(candidateOpportunity.expectedMinutes)! } : {}), ...(numberOrUndefined(outcome.minutes ?? outcome.minutesPlayed) !== undefined ? { actualMinutes: numberOrUndefined(outcome.minutes ?? outcome.minutesPlayed)! } : {}),
          baselinePoints: number(baseOutput.medianP50), candidatePoints: number(candidateOutput.medianP50), baselineP20: number(baseOutput.floorP20), baselineP90: number(baseOutput.ceilingP90), candidateP20: number(candidateOutput.floorP20), candidateP90: number(candidateOutput.ceilingP90), actualPoints: number(actual.actual_dk_points) });
        actualSourceCounts[source] = (actualSourceCounts[source] ?? 0) + 1;
      }
    }
    const evaluation = evaluateNbaHouse(rows, { validationCutoff, holdoutCutoff }, preRegisteredAt);
    if (body.save === true) {
      if (!isFeatureEnabled('LEARNING_V2')) throw new ApiError(503, 'NBA House evaluation persistence is disabled by the LEARNING_V2 rollback switch.', 'FEATURE_DISABLED');
      const saved = await context.db.from('floyd_dfs_model_evaluations').insert({ tenant_id: context.tenantId, sport: 'NBA', contest_format: 'CLASSIC', component: 'PROJECTION', model_version: 'nba-house.driver-policy.v1', baseline_model_version: 'nba-house.baseline.deterministic.v1', candidate_model_version: 'nba-house.driver-policy.v1', evaluation_window: `[${evaluation.holdoutCutoff},)`, sample_count: evaluation.holdout.rows, holdout_name: `${evaluation.policy.version}:validation=${evaluation.validationCutoff}:holdout=${evaluation.holdoutCutoff}`, gate_decision: 'HOLD', metrics: evaluation, data_manifest: { actualSourceCounts, actualFinalityRequired: ['FINAL', 'CORRECTED'], sourceValidationStatus: 'VERIFIED', cutoffsRegisteredAt: preRegisteredAt, datasetSha256: evaluation.datasetSha256, projectionTimestampRequirement: 'strictly before contest lock', split: 'Chronological train/validation/holdout; slate-game connected groups remain in one partition', excludedRows: evaluation.excludedRows } }).select('id,gate_decision,created_at').single();
      if (saved.error) throw saved.error;
      cors(req, res); res.status(201).json({ evaluation, storedEvaluation: saved.data, actualSourceCounts, message: 'Saved as HOLD. Promotion requires a separate named operator review.' }); return;
    }
    cors(req, res); res.status(200).json({ evaluation, actualSourceCounts, stored: false });
  } catch (error) { respondError(req, res, error); }
}
function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function array(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function keyedPlayers(value: Row): Map<string, Row> { return new Map(array(value.players).flatMap((player) => typeof player.playerId === 'string' ? [[player.playerId, player] as [string, Row]] : [])); }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : Number.NaN; }
function numberOrUndefined(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function latestTime(values: Array<string | undefined>) { const times = values.filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))).map(Date.parse); return times.length ? new Date(Math.max(...times)).toISOString() : undefined; }
