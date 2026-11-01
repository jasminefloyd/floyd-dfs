import assert from 'node:assert/strict';
import { buildEvaluationDataset } from '../server/learning/evaluationDataset.js';
import { summarizeEvaluationDataset } from '../server/learning/diagnostics.js';
import { joinVerifiedEnteredOutcomes } from '../server/learning/portfolioOutcomes.js';
import { promotionEvidence } from '../server/learning/promotion.js';
import type { VerifiedForecastRow } from '../server/learning/evaluationDataset.js';

const base: VerifiedForecastRow = {
  projection_run_id: 'projection-1', generation_run_id: 'generation-1', slate_id: 'nba-slate-1', provider_game_id: 'nba-game-1',
  player_id: 'nba:player:sportsdataio:42', sport: 'NBA', contest_format: 'CLASSIC', position: 'PG', model_version: 'nba-baseline.v1',
  projection_generated_at: '2026-10-01T20:00:00.000Z', lock_time: '2026-10-01T23:00:00.000Z', projected_floor: 10,
  projected_median: 25, projected_ceiling: 40, baseline_fppg: 22, actual_dk_points: 30,
  source_validation_status: 'VERIFIED', finality_status: 'FINAL',
  projected_minutes: 31, actual_minutes: 28, projected_usage: null, actual_usage: null, game_type: 'SHOWDOWN', player_role: 'PG', injury_return: null, contest_field_size: 2378,
};

const valid = { ...base };
const missingGame = { ...base, player_id: 'p2', provider_game_id: null };
const postLock = { ...base, player_id: 'p3', projection_run_id: 'projection-3', projection_generated_at: '2026-10-01T23:00:00.000Z' };
const unverified = { ...base, player_id: 'p4', source_validation_status: 'UNVERIFIED' };
const duplicate = { ...base };
const dataset = buildEvaluationDataset([valid, missingGame, postLock, unverified, duplicate]);
assert.equal(dataset.rows.length, 0, 'duplicate projection/player pairs are excluded rather than ambiguously paired');
assert.equal(dataset.exclusions.DUPLICATE_PROJECTION_PLAYER_JOIN, 2);
assert.equal(dataset.exclusions.MISSING_CANONICAL_GAME_ID, 1);
assert.equal(dataset.exclusions.FORECAST_NOT_VERIFIABLY_PRELOCK, 1);
assert.equal(dataset.exclusions.ACTUAL_NOT_VERIFIED_FINAL, 1);

const clean = buildEvaluationDataset([valid]);
assert.equal(clean.rows.length, 1);
assert.equal(clean.rows[0]?.gameId, 'nba-game-1');
assert.equal(clean.independentSlates, 1);
assert.equal(buildEvaluationDataset([valid]).datasetSha256, buildEvaluationDataset([{ ...valid }]).datasetSha256);
const diagnostics = summarizeEvaluationDataset(clean);
assert.equal(diagnostics.projection.mae, 5);
assert.equal(diagnostics.projection.bias, -5);
assert.equal(diagnostics.projection.confidenceIntervalMethod, 'SLATE_CLUSTER_BOOTSTRAP_PCTL_95');
assert.equal(diagnostics.projection.minutesMae, 3, 'minutes error is reported only for paired verified minute values');
assert.equal(diagnostics.projection.usageMae, null, 'unavailable usage evidence remains null');
assert.equal(diagnostics.errorClassification.role.errorRate, null, 'unavailable role labels remain unscored');
assert.equal(diagnostics.projection.segments.gameType?.SHOWDOWN?.pairedRows, 1);
assert.deepEqual(diagnostics.contestStrategy.realizedNet, null, 'no generated/unentered run is treated as financial exposure');
const withVerifiedEntry = summarizeEvaluationDataset(clean, [{ entered: true, settlement: 'VERIFIED', contestId: 'contest', externalEntryId: 'entry', payout: 40, refund: 2, fee: 5, finishPosition: 2, paidPositions: 3 }]);
assert.equal(withVerifiedEntry.contestStrategy.realizedNet, 37);
assert.equal(withVerifiedEntry.contestStrategy.cashRate, 1);
const unknownRank = summarizeEvaluationDataset(clean, [
  { entered: true, settlement: 'VERIFIED', contestId: 'contest', externalEntryId: 'rank-known', payout: 0, refund: 0, fee: 5, finishPosition: 12, paidPositions: 10 },
  { entered: true, settlement: 'VERIFIED', contestId: 'contest', externalEntryId: 'rank-missing', payout: 0, refund: 0, fee: 5, finishPosition: null, paidPositions: null },
]);
assert.equal(unknownRank.contestStrategy.cashRate, 0, 'entries without verified rank terms are excluded from the cash-rate denominator');
assert.equal(unknownRank.contestStrategy.cashRateSampleSize, 1);
const invalidRefund = summarizeEvaluationDataset(clean, [{ entered: true, settlement: 'VERIFIED', contestId: 'contest', externalEntryId: 'invalid-refund', payout: 10, refund: Number.NaN, fee: 5, finishPosition: 1, paidPositions: 1 }]);
assert.equal(invalidRefund.contestStrategy.realizedNet, null, 'non-finite refund is excluded rather than contaminating realized return');
const exactOutcomes = joinVerifiedEnteredOutcomes({
  portfolios: [{ id: 'portfolio-1', contest_id: 'contest-1' }],
  members: [
    { portfolio_id: 'portfolio-1', lineup_id: 'lineup-entered', lineup_revision: 2, entry_status: 'ENTERED', settlement_status: 'VERIFIED', entry_fee: 5 },
    { portfolio_id: 'portfolio-1', lineup_id: 'lineup-generated', lineup_revision: 1, entry_status: 'GENERATED', settlement_status: 'VERIFIED', entry_fee: 5 },
    { portfolio_id: 'portfolio-1', lineup_id: 'lineup-pending', lineup_revision: 1, entry_status: 'ENTERED', settlement_status: 'RESULTS_PENDING', entry_fee: 5 },
  ],
  entryLinks: [
    { generated_lineup_id: 'lineup-entered', contest_id: 'contest-1', external_entry_id: 'entry-1' },
    { generated_lineup_id: 'lineup-generated', contest_id: 'contest-1', external_entry_id: 'entry-2' },
  ],
  results: [
    { generated_lineup_id: 'lineup-entered', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 10, refund_amount: 0, entry_fee: 5, finish_position: 4, paid_positions: 3, official_outcome: true, reconciliation_status: 'MATCHED', model_evaluation_eligible: true, finality_status: 'FINAL', revision: 1 },
    { generated_lineup_id: 'lineup-entered', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 20, refund_amount: 3, entry_fee: 5, finish_position: 2, paid_positions: 3, official_outcome: true, reconciliation_status: 'MATCHED', model_evaluation_eligible: true, finality_status: 'CORRECTED', revision: 2 },
    { generated_lineup_id: 'lineup-entered', contest_id: 'contest-1', external_entry_id: 'other-entry', payout: 999, entry_fee: 5, official_outcome: true, reconciliation_status: 'MATCHED', model_evaluation_eligible: true },
  ],
});
assert.equal(exactOutcomes.length, 1, 'only an exact, entered, verified external-entry settlement contributes');
assert.equal(exactOutcomes[0]?.externalEntryId, 'entry-1');
assert.equal(exactOutcomes[0]?.payout, 20, 'latest corrected official result supersedes the earlier revision');
assert.equal(exactOutcomes[0]?.refund, 3, 'verified refund is included separately from payout');
const noHoldoutPromotion = promotionEvidence({ id: 'eval', tenant_id: 'tenant', sport: 'NBA', component: 'SIMULATION', gate_decision: 'PROMOTE', reviewed_by: 'reviewer', reviewed_at: '2026-10-31T00:00:00.000Z', review_note: 'Reviewed independently.', sample_count: 100, metrics: { promotionGate: { eligible: true, independentSlates: 30, playerRows: 100 } }, data_manifest: {} });
assert.equal(noHoldoutPromotion.eligible, false, 'a nominal pass without a frozen, chronological holdout remains blocked');
assert.ok(noHoldoutPromotion.reasons.some((reason) => reason.includes('frozen holdout')));
const validHoldoutPromotion = promotionEvidence({ id: 'eval', tenant_id: 'tenant', sport: 'NBA', component: 'SIMULATION', gate_decision: 'PROMOTE', reviewed_by: 'reviewer', reviewed_at: '2026-10-31T00:00:00.000Z', review_note: 'Reviewed independently.', sample_count: 100, metrics: { promotionGate: { eligible: true, independentSlates: 30, playerRows: 100 } }, data_manifest: { holdoutDatasetSha256: 'a'.repeat(64), holdoutWindow: '[2026-10-01,)', holdoutSplit: 'CHRONOLOGICAL_SLATE_LOCK_TIME' } });
assert.equal(validHoldoutPromotion.eligible, true, 'reviewed promotion evidence requires independent sample, frozen hash and chronological holdout');
console.log('G6 strict pre-lock/game identity, verified actual exclusions, deterministic dataset digest, slate-clustered intervals, and entered-only financial metrics passed.');
