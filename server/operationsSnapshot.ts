import type { FeatureFlagSet } from './featureFlags.js';

type Row = Record<string, unknown>;
export interface OperationsSnapshotInput {
  now: Date; tenantId: string; providerCallBudget: number | null; collections: Row[]; upcomingGames: Row[]; scheduleSync: Row | null;
  generationRuns: Row[]; houseReports: Row[]; evaluations: Row[]; results: Row[]; lineups: Row[]; incidents: Row[]; featureFlags: FeatureFlagSet;
}

export type HouseRuntimeMode = 'LEGACY' | 'SHADOW' | 'CANARY' | 'ACTIVE' | 'UNKNOWN';
export interface HouseRuntimeStatus {
  mode: HouseRuntimeMode;
  configuredMode: HouseRuntimeMode;
  source: 'RUN_LINEAGE' | 'NO_RECENT_NBA_ASSIGNMENT';
  observedAt: string | null;
  lastSuccessfulRunAt: string | null;
  sampleCount: number;
  candidateSelected: boolean | null;
  fallback: boolean | null;
  fallbackReason: string | null;
  killSwitchEnabled: boolean;
  telemetryStale: boolean;
  reason: string;
  lastCandidateEvaluation: { id: string; modelVersion: string | null; decision: string | null; reviewedAt: string | null; createdAt: string | null; sampleCount: number | null } | null;
}

/** Show configured flags separately from what recent, tenant-owned NBA run lineage says happened. */
export function resolveHouseRuntimeStatus(input: { now: Date; tenantId: string; generationRuns: Row[]; evaluations: Row[]; featureFlags: FeatureFlagSet }): HouseRuntimeStatus {
  const flags = input.featureFlags;
  const killSwitchEnabled = flags.NBA_HOUSE_KILL_SWITCH_V1;
  const conflictingRolloutFlags = flags.NBA_HOUSE_CANARY_V1 && flags.NBA_HOUSE_ACTIVE_V1;
  const configuredMode: HouseRuntimeMode = conflictingRolloutFlags ? 'UNKNOWN'
    : killSwitchEnabled ? 'LEGACY'
      : flags.NBA_HOUSE_ACTIVE_V1 ? 'ACTIVE'
        : flags.NBA_HOUSE_CANARY_V1 ? 'CANARY'
          : flags.NBA_HOUSE_V1 || flags.NBA_HOUSE_SHADOW_V1 ? 'SHADOW' : 'LEGACY';
  const assignments = input.generationRuns.flatMap((run) => {
    if (String(run.tenant_id ?? '') !== input.tenantId) return [];
    const lineage = record(run.lineage);
    if (String(lineage?.sport ?? '').toUpperCase() !== 'NBA') return [];
    const assignment = record(lineage?.nbaHouseRolloutAssignment);
    return assignment ? [{ run, assignment }] : [];
  }).sort((a, b) => timestamp(b.run.created_at) - timestamp(a.run.created_at));
  const latest = assignments[0];
  const lastSuccessfulRun = assignments.find(({ run }) => String(run.state ?? '').toUpperCase() === 'COMPLETE');
  const evaluation = input.evaluations.find((row) => String(row.candidate_model_version ?? '').trim().length > 0) ?? null;
  const lastCandidateEvaluation = evaluation ? {
    id: String(evaluation.id),
    modelVersion: typeof evaluation.candidate_model_version === 'string' ? evaluation.candidate_model_version : null,
    decision: typeof evaluation.gate_decision === 'string' ? evaluation.gate_decision : null,
    reviewedAt: typeof evaluation.reviewed_at === 'string' ? evaluation.reviewed_at : null,
    createdAt: typeof evaluation.created_at === 'string' ? evaluation.created_at : null,
    sampleCount: finite(evaluation.sample_count),
  } : null;
  if (!latest) return {
    mode: 'UNKNOWN', configuredMode, source: 'NO_RECENT_NBA_ASSIGNMENT', observedAt: null, lastSuccessfulRunAt: null,
    sampleCount: 0, candidateSelected: null, fallback: null, fallbackReason: null,
    killSwitchEnabled, telemetryStale: true,
    reason: conflictingRolloutFlags ? 'Canary and active flags conflict; runtime configuration is invalid.' : 'No tenant-owned NBA runtime assignment is available in the sampled run history.',
    lastCandidateEvaluation,
  };
  const observedAt = typeof latest.run.created_at === 'string' ? latest.run.created_at : null;
  const assigned = String(latest.assignment.assignedMode ?? '').toUpperCase();
  const mode: HouseRuntimeMode = ['LEGACY', 'SHADOW', 'CANARY', 'ACTIVE'].includes(assigned) ? assigned as HouseRuntimeMode : 'UNKNOWN';
  const reason = conflictingRolloutFlags
    ? 'Canary and active flags conflict; the displayed route is the last observed run assignment, not a valid current configuration.'
    : typeof latest.assignment.reason === 'string' ? latest.assignment.reason
      : mode === 'UNKNOWN' ? 'The latest NBA run assignment has an unsupported or missing mode.' : `Observed from NBA run lineage; latest sampled assignment is ${mode}.`;
  const fallback = typeof latest.assignment.fallback === 'boolean' ? latest.assignment.fallback : null;
  return {
    mode, configuredMode, source: 'RUN_LINEAGE', observedAt,
    lastSuccessfulRunAt: typeof lastSuccessfulRun?.run.created_at === 'string' ? lastSuccessfulRun.run.created_at : null,
    sampleCount: assignments.length,
    candidateSelected: typeof latest.assignment.candidateSelected === 'boolean' ? latest.assignment.candidateSelected : null,
    fallback,
    fallbackReason: fallback ? reason : null,
    killSwitchEnabled,
    telemetryStale: !observedAt || input.now.getTime() - timestamp(observedAt) > 24 * 60 * 60_000,
    reason,
    lastCandidateEvaluation,
  };
}

/** Tenant-scoped operational facts. Missing measurements remain null/UNKNOWN, never zero. */
export function buildOperationsSnapshot(input: OperationsSnapshotInput) {
  const since = input.now.getTime() - 24 * 60 * 60_000;
  const collections = input.collections.filter((row) => timestamp(row.started_at) >= since);
  const providerCalls = collections.reduce((sum, row) => sum + nonnegative(record(row.result)?.providerCallCount), 0);
  const latestCollection = input.collections[0] ?? null;
  const quotaRemaining = record(latestCollection && record(latestCollection.result)?.providerQuotaState)?.remaining;
  const failedCollectionCount = collections.filter((row) => row.status === 'FAILED').length;
  const prelockAttempts = collections.filter((row) => String(row.idempotency_key ?? '').includes(':PRE_LOCK_VERIFY:'));
  const missedPrelocks = prelockAttempts.filter((row) => row.status === 'FAILED').length;
  const latestEvaluation = input.evaluations[0] ?? null;
  const latestSimulationEvaluation = input.evaluations.find((row) => row.component === 'SIMULATION') ?? null;
  const houseRuntime = resolveHouseRuntimeStatus(input);
  const latestScheduleAt = timestamp(input.scheduleSync?.last_success_at);
  const staleGames = input.upcomingGames.filter((row) => input.now.getTime() - timestamp(row.retrieved_at) > 24 * 60 * 60_000).length;
  const unresolvedIncidents = input.incidents.filter((row) => !row.resolved_at);
  const pendingSettlement = input.results.filter((row) => row.official_outcome === true && row.reconciliation_status !== 'MATCHED').length;
  const enteredLineups = input.lineups.filter((row) => String(row.status ?? '').toUpperCase() === 'ENTERED').length;
  const unresolvedResults = input.results.filter((row) => !['MATCHED', 'DISPUTED'].includes(String(row.reconciliation_status ?? '').toUpperCase())).length;
  const houseRunAssignments = input.generationRuns.flatMap((run) => String(run.tenant_id ?? '') === input.tenantId && String(record(run.lineage)?.sport ?? '').toUpperCase() === 'NBA' && record(record(run.lineage)?.nbaHouseRolloutAssignment) ? [record(record(run.lineage)?.nbaHouseRolloutAssignment)!] : []);
  const candidateAssignments = houseRunAssignments.filter((row) => row.candidateSelected === true && String(row.effectiveProjection ?? '').toUpperCase() === 'HOUSE').length;
  const alerts: Array<{ severity: 'CRITICAL' | 'WARNING' | 'INFO'; code: string; message: string }> = [];
  if (input.providerCallBudget === null) alerts.push({ severity: 'WARNING', code: 'PROVIDER_BUDGET_UNKNOWN', message: 'Verified NBA provider daily call budget is not configured; automatic provider refresh must remain paused.' });
  else if (providerCalls >= input.providerCallBudget) alerts.push({ severity: 'CRITICAL', code: 'PROVIDER_BUDGET_EXHAUSTED', message: `NBA provider call budget reached (${providerCalls}/${input.providerCallBudget}) in the rolling 24-hour window.` });
  else if (providerCalls >= input.providerCallBudget * 0.9) alerts.push({ severity: 'WARNING', code: 'PROVIDER_BUDGET_NEAR_LIMIT', message: `NBA provider calls are near the configured daily ceiling (${providerCalls}/${input.providerCallBudget}).` });
  if (failedCollectionCount) alerts.push({ severity: 'WARNING', code: 'COLLECTION_FAILURES', message: `${failedCollectionCount} NBA Street Team collection attempt(s) failed in the last 24 hours.` });
  if (input.upcomingGames.length && (!latestScheduleAt || input.now.getTime() - latestScheduleAt > 24 * 60 * 60_000)) alerts.push({ severity: 'WARNING', code: 'NBA_SCHEDULE_STALE', message: 'NBA schedule sync is missing or older than 24 hours while upcoming games are listed.' });
  if (staleGames) alerts.push({ severity: 'WARNING', code: 'STALE_SCHEDULE_ROWS', message: `${staleGames} upcoming schedule row(s) were last observed more than 24 hours ago.` });
  if (unresolvedIncidents.length) alerts.push({ severity: 'CRITICAL', code: 'OPEN_RUNTIME_INCIDENTS', message: `${unresolvedIncidents.length} unresolved runtime incident(s) require operator review.` });
  if (pendingSettlement) alerts.push({ severity: 'INFO', code: 'SETTLEMENT_RECONCILIATION', message: `${pendingSettlement} official contest result(s) have not reconciled.` });
  return {
    generatedAt: input.now.toISOString(), windowStart: new Date(since).toISOString(),
    provider: { callsLast24Hours: providerCalls, dailyBudget: input.providerCallBudget, remainingByConfiguredBudget: input.providerCallBudget === null ? null : Math.max(0, input.providerCallBudget - providerCalls), remainingReportedByProvider: finite(quotaRemaining), failedCollectionsLast24Hours: failedCollectionCount, failedPreLockAttemptsLast24Hours: missedPrelocks, lastCollection: latestCollection, budgetSource: input.providerCallBudget === null ? 'UNCONFIGURED' : 'OPERATOR_CONFIGURED_ENVIRONMENT' },
    schedule: { lastAttemptAt: input.scheduleSync?.last_attempt_at ?? null, lastSuccessAt: input.scheduleSync?.last_success_at ?? null, nextDueAt: input.scheduleSync?.next_due_at ?? null, nextGames: input.upcomingGames, staleGames, lastError: input.scheduleSync?.last_error ?? null },
    model: { featureFlags: input.featureFlags, houseAssignmentsObserved: houseRunAssignments.length, candidateAssignmentsObserved: candidateAssignments, houseRuntime, houseReportsLast24Hours: input.houseReports.length, latestHouseReportAt: input.houseReports[0]?.created_at ?? null, latestEvaluation: latestEvaluation ? { component: latestEvaluation.component, decision: latestEvaluation.gate_decision, createdAt: latestEvaluation.created_at, sampleCount: latestEvaluation.sample_count } : null, latestSimulationEvaluation: latestSimulationEvaluation ? { decision: latestSimulationEvaluation.gate_decision, createdAt: latestSimulationEvaluation.created_at, sampleCount: latestSimulationEvaluation.sample_count } : null },
    lineups: { generatedLast24Hours: input.lineups.length, enteredObserved: enteredLineups, legalityFailureCount: null, legalityFailureMeasurement: 'UNAVAILABLE_NOT_PERSISTED' },
    settlement: { resultsObserved: input.results.length, officialResultsPendingReconciliation: pendingSettlement, unresolvedResultCount: unresolvedResults },
    incidents: unresolvedIncidents,
    alerts,
    unavailableMeasurements: ['simulation_runtime_error_rate', 'candidate_runtime_fallback_rate', 'lineup_legality_failure_rate', 'provider_cost_per_generation', 'external_alert_delivery'],
  };
}

function record(value: unknown): Row | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null; }
function timestamp(value: unknown): number { const result = Date.parse(String(value ?? '')); return Number.isFinite(result) ? result : 0; }
function finite(value: unknown): number | null { const result = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(result) ? result : null; }
function nonnegative(value: unknown): number { const result = finite(value); return result !== null && result > 0 ? result : 0; }
