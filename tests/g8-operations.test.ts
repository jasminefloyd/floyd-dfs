import assert from 'node:assert/strict';
import { buildOperationsSnapshot } from '../server/operationsSnapshot.js';
import type { FeatureFlagSet } from '../server/featureFlags.js';

const now = new Date('2026-10-31T16:00:00.000Z');
const flags = Object.fromEntries(['STREET_TEAM_V2','NBA_HOUSE_V1','NBA_HOUSE_READ_V1','NBA_HOUSE_SHADOW_V1','NBA_HOUSE_CANARY_V1','NBA_HOUSE_ACTIVE_V1','NBA_HOUSE_KILL_SWITCH_V1','PORTFOLIO_EV_V1','LEARNING_V2'].map((name) => [name, false])) as FeatureFlagSet;
const base = {
  now, tenantId: 'tenant-a', providerCallBudget: 100, collections: [{ id: 'c1', status: 'COMPLETE', idempotency_key: 'street-team:nba:PRE_LOCK_VERIFY:game', started_at: '2026-10-31T15:00:00.000Z', result: { providerCallCount: 91, providerQuotaState: { remaining: null } } }, { id: 'c2', status: 'FAILED', idempotency_key: 'street-team:nba:PRE_LOCK_VERIFY:game2', started_at: '2026-10-31T14:00:00.000Z', result: { providerCallCount: 8 } }],
  upcomingGames: [{ provider_game_id: 'g1', retrieved_at: '2026-10-31T15:30:00.000Z', scheduled_start_at: '2026-11-01T00:00:00.000Z' }],
  scheduleSync: { last_success_at: '2026-10-31T15:00:00.000Z', next_due_at: '2026-10-31T18:00:00.000Z' }, generationRuns: [], houseReports: [], evaluations: [{ component: 'SIMULATION', gate_decision: 'HOLD', sample_count: 2, created_at: '2026-10-31T12:00:00.000Z' }], results: [{ official_outcome: true, reconciliation_status: 'PARTIAL' }, { official_outcome: false, reconciliation_status: 'UNVERIFIED' }], lineups: [{ status: 'ENTERED' }], incidents: [{ id: 'open', severity: 'WARNING', resolved_at: null }, { id: 'closed', resolved_at: '2026-10-31T13:00:00Z' }], featureFlags: flags,
};

const report = buildOperationsSnapshot(base);
assert.equal(report.provider.callsLast24Hours, 99);
assert.equal(report.provider.remainingByConfiguredBudget, 1);
assert.equal(report.provider.remainingReportedByProvider, null, 'unknown provider quota stays unavailable');
assert.ok(report.alerts.some((alert) => alert.code === 'PROVIDER_BUDGET_NEAR_LIMIT'));
assert.equal(report.provider.failedPreLockAttemptsLast24Hours, 1);
assert.equal(report.schedule.staleGames, 0);
assert.equal(report.model.latestSimulationEvaluation?.decision, 'HOLD');
assert.equal(report.model.houseRuntime.mode, 'UNKNOWN', 'no assignment is reported as unknown rather than an invented route');
assert.equal(report.lineups.enteredObserved, 1);
assert.equal(report.lineups.legalityFailureCount, null, 'unmeasured legality failures remain unavailable');
assert.equal(report.settlement.officialResultsPendingReconciliation, 1);
assert.equal(report.incidents.length, 1);
assert.ok(report.unavailableMeasurements.includes('external_alert_delivery'));
const selectedCandidate = buildOperationsSnapshot({ ...base, generationRuns: [{ tenant_id: 'tenant-a', created_at: now.toISOString(), lineage: { sport: 'NBA', nbaHouseRolloutAssignment: { requestedMode: 'CANARY', assignedMode: 'CANARY', candidateSelected: true, effectiveProjection: 'HOUSE', fallback: false, reason: 'Reviewed canary selected.' } } }] });
assert.equal(selectedCandidate.model.candidateAssignmentsObserved, 1, 'only a recorded selected House projection counts as candidate runtime traffic');
assert.equal(selectedCandidate.model.houseRuntime.mode, 'CANARY');
assert.equal(selectedCandidate.model.houseRuntime.candidateSelected, true);
assert.equal(selectedCandidate.model.houseRuntime.configuredMode, 'LEGACY', 'observed assignment is distinct from current flags');

const run = (tenantId: string, assignedMode: string, createdAt = now.toISOString(), candidateSelected = false) => ({ tenant_id: tenantId, created_at: createdAt, lineage: { sport: 'NBA', nbaHouseRolloutAssignment: { assignedMode, candidateSelected, effectiveProjection: candidateSelected ? 'HOUSE' : 'LEGACY', fallback: assignedMode === 'LEGACY', reason: assignedMode === 'LEGACY' ? 'Fallback to legacy.' : `${assignedMode} assignment.` } } });
const legacyRun = buildOperationsSnapshot({ ...base, generationRuns: [run('tenant-a', 'LEGACY')] });
assert.equal(legacyRun.model.houseRuntime.mode, 'LEGACY');
assert.equal(legacyRun.model.houseRuntime.telemetryStale, false);
assert.equal(legacyRun.model.houseRuntime.fallback, true);
assert.equal(legacyRun.model.houseRuntime.fallbackReason, 'Fallback to legacy.');
const shadowRun = buildOperationsSnapshot({ ...base, featureFlags: { ...flags, NBA_HOUSE_SHADOW_V1: true }, generationRuns: [run('tenant-a', 'SHADOW')] });
assert.equal(shadowRun.model.houseRuntime.mode, 'SHADOW');
assert.equal(shadowRun.model.houseRuntime.configuredMode, 'SHADOW');
const activeRun = buildOperationsSnapshot({ ...base, featureFlags: { ...flags, NBA_HOUSE_ACTIVE_V1: true }, generationRuns: [run('tenant-a', 'ACTIVE', now.toISOString(), true)] });
assert.equal(activeRun.model.houseRuntime.mode, 'ACTIVE');
assert.equal(activeRun.model.houseRuntime.configuredMode, 'ACTIVE');
const killed = buildOperationsSnapshot({ ...base, featureFlags: { ...flags, NBA_HOUSE_KILL_SWITCH_V1: true, NBA_HOUSE_ACTIVE_V1: true }, generationRuns: [run('tenant-a', 'ACTIVE', now.toISOString(), true)] });
assert.equal(killed.model.houseRuntime.configuredMode, 'LEGACY');
assert.equal(killed.model.houseRuntime.killSwitchEnabled, true);
assert.equal(killed.model.houseRuntime.mode, 'ACTIVE', 'observed traffic is distinct from a newly enabled kill switch');
const conflict = buildOperationsSnapshot({ ...base, featureFlags: { ...flags, NBA_HOUSE_CANARY_V1: true, NBA_HOUSE_ACTIVE_V1: true }, generationRuns: [run('tenant-a', 'LEGACY')] });
assert.equal(conflict.model.houseRuntime.configuredMode, 'UNKNOWN');
assert.match(conflict.model.houseRuntime.reason, /conflict/i);
const stale = buildOperationsSnapshot({ ...base, generationRuns: [run('tenant-a', 'LEGACY', '2026-10-29T12:00:00.000Z')] });
assert.equal(stale.model.houseRuntime.telemetryStale, true);
const tenantIsolated = buildOperationsSnapshot({ ...base, generationRuns: [run('tenant-b', 'ACTIVE')] });
assert.equal(tenantIsolated.model.houseRuntime.mode, 'UNKNOWN');
const candidateEvaluation = buildOperationsSnapshot({ ...base, evaluations: [{ id: 'eval-1', component: 'PROJECTION', candidate_model_version: 'candidate.v2', gate_decision: 'HOLD', reviewed_at: null, sample_count: 0, created_at: now.toISOString() }] });
assert.equal(candidateEvaluation.model.houseRuntime.lastCandidateEvaluation?.modelVersion, 'candidate.v2');

const noBudget = buildOperationsSnapshot({ ...base, providerCallBudget: null });
assert.equal(noBudget.provider.dailyBudget, null);
assert.ok(noBudget.alerts.some((alert) => alert.code === 'PROVIDER_BUDGET_UNKNOWN'));
assert.equal(noBudget.provider.remainingByConfiguredBudget, null);
console.log('G8 Operations covers configured and observed House modes, freshness, kill switch, tenant isolation, candidate evaluation, and unavailable metrics.');
