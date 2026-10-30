import assert from 'node:assert/strict';
import { ENGINE_CONTRACT_VERSION, type LineupCandidate, type SelectedLineup } from '../src/lib/engine/contracts.js';
import {
  parseContestPayoutReadiness,
  parseModelEvaluation,
  parseNbaHouseReport,
  parsePortfolioSelection,
  parseStreetTeamSnapshot,
  parseValidatedSlate,
} from '../src/lib/engine/boundaryContracts.js';
import { readFeatureFlags } from '../server/featureFlags.js';

const cutoff = '2026-10-29T22:00:00.000Z';
const generatedAt = '2026-10-29T22:01:00.000Z';
const tenantId = 'tenant-a';
const slateId = 'nba-slate-a';
const contestId = 'dk-contest-a';

const legacySlate = {
  contractVersion: '2026-10-21.1',
  tenantId,
  slateId,
  requestId: 'request-a',
  event: { eventId: 'event-a', name: 'event-a', eventDate: '2026-10-30T00:00:00.000Z', participants: [] },
  playerPool: [],
};
assert.equal(parseValidatedSlate(legacySlate, tenantId).contractVersion, '2026-10-21.1');
assert.equal(parseValidatedSlate({ ...legacySlate, contractVersion: ENGINE_CONTRACT_VERSION }, tenantId).contractVersion, ENGINE_CONTRACT_VERSION);
assert.throws(() => parseValidatedSlate({ ...legacySlate, contractVersion: 'unknown' }, tenantId), /unsupported version/);
assert.throws(() => parseValidatedSlate({ ...legacySlate, tenantId: 'tenant-b' }, tenantId), /authenticated tenant/);

const snapshotInput = {
  contractVersion: ENGINE_CONTRACT_VERSION,
  snapshotId: 'snapshot-a',
  tenantId,
  sport: 'NBA',
  asOf: cutoff,
  createdAt: generatedAt,
  evidenceHash: 'a'.repeat(64),
  observations: [{
    id: 'observation-a', tenantId, sport: 'NBA', subject: { kind: 'PLAYER', id: 'player-a' },
    claim: 'Official availability update', source: 'League', sourceUrl: 'https://league.example/player-a',
    classification: 'OFFICIAL_CONFIRMED', confidence: 1, publishedAt: cutoff,
    observedAt: cutoff, retrievedAt: cutoff, contentSha256: 'b'.repeat(64),
  }],
  resolvedFacts: [{
    id: 'fact-a', tenantId, sport: 'NBA', subject: { kind: 'PLAYER', id: 'player-a' },
    factType: 'availability', value: 'ACTIVE', observationIds: ['observation-a'], state: 'ACCEPTED',
    confidence: 1, resolvedAt: cutoff, ruleVersion: 'fact-resolution.v1',
  }],
  rosterState: [{ teamId: 'team-a', playerId: 'player-a', status: 'CURRENT', validFrom: cutoff, evidenceIds: ['observation-a'] }],
  availability: [{ playerId: 'player-a', status: 'ACTIVE', observedAt: cutoff, evidenceIds: ['observation-a'] }],
  transactions: [], behaviorSignals: [], unknowns: [],
  providerDiagnostics: [{ provider: 'official', status: 'SUCCEEDED', retrievedAt: cutoff, freshness: 'FRESH' }],
};
const snapshot = parseStreetTeamSnapshot(snapshotInput, tenantId);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, tenantId: 'tenant-b' }, tenantId), /authenticated tenant/);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, sport: 'MLB' }, tenantId), /crossed tenant or sport/);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, asOf: '2026-10-29T21:00:00.000Z' }, tenantId), /later than snapshot asOf/);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, observations: [{ ...snapshotInput.observations[0], observedAt: generatedAt }] }, tenantId), /cannot precede observedAt/);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, contractVersion: 'unsupported' }, tenantId), /expected/);
assert.throws(() => parseStreetTeamSnapshot({ ...snapshotInput, resolvedFacts: [{ ...snapshotInput.resolvedFacts[0], observationIds: ['unknown'] }] }, tenantId), /observations in this snapshot/);

const projection = { tenantId, slateId, sport: 'NBA', modelVersion: 'projection.test.v1', generatedAt: cutoff, players: [] };
const houseInput = {
  contractVersion: ENGINE_CONTRACT_VERSION,
  houseReportId: 'house-a', tenantId, sport: 'NBA', slateId, intelSnapshotId: snapshot.snapshotId,
  modelVersion: 'nba-house.v1', baselineModelVersion: 'projection.test.v1', forecastCutoff: cutoff, generatedAt,
  baselineProjections: projection,
  adjustedProjections: { ...projection, modelVersion: 'projection.test.adjusted.v1' },
  driverAttributions: [{ playerId: 'player-a', dimension: 'minutes', baselineValue: 30, adjustedValue: 32, evidenceIds: ['observation-a'], confidence: 'HIGH', modelVersion: 'nba-house.v1' }],
  scenarioDistributions: [], trustStatus: 'UNVALIDATED', unknowns: [], warnings: [],
};
const house = parseNbaHouseReport(houseInput, { expectedTenantId: tenantId, expectedSlateId: slateId, expectedForecastCutoff: cutoff, intelSnapshot: snapshot });
assert.equal(house.sport, 'NBA');
assert.throws(() => parseNbaHouseReport({ ...houseInput, sport: 'MLB' }, { intelSnapshot: snapshot }), /must be NBA/);
assert.throws(() => parseNbaHouseReport(houseInput, { expectedSlateId: 'other-slate' }), /requested slate/);
assert.throws(() => parseNbaHouseReport(houseInput, { expectedTenantId: 'tenant-b' }), /authenticated tenant/);
assert.throws(() => parseNbaHouseReport(houseInput, { expectedForecastCutoff: '2026-10-29T21:00:00.000Z' }), /requested forecast cutoff/);
assert.throws(() => parseNbaHouseReport(houseInput, { intelSnapshot: { ...snapshot, asOf: '2026-10-29T21:59:00.000Z' } }), /snapshot asOf/);
assert.throws(() => parseNbaHouseReport({ ...houseInput, adjustedProjections: { ...projection, slateId: 'other-slate' } }), /crossed House tenant, slate, or sport boundary/);
assert.throws(() => parseNbaHouseReport({ ...houseInput, driverAttributions: [{ ...houseInput.driverAttributions[0], evidenceIds: ['other-evidence'] }] }, { intelSnapshot: snapshot }), /outside the supplied intelligence snapshot/);

const readinessInput = {
  contractVersion: ENGINE_CONTRACT_VERSION,
  tenantId,
  slateId,
  contestId,
  asOf: cutoff,
  status: 'READY',
  payoutStatus: 'VERIFIED',
  payoutTiers: [{ rank: 1, payout: 100 }],
  entryFee: 10,
  fieldSize: 100,
  fieldModelStatus: 'CALIBRATED',
  fieldModelVersion: 'field.v1',
  warnings: [],
};
assert.equal(parseContestPayoutReadiness(readinessInput, tenantId).status, 'READY');
assert.throws(() => parseContestPayoutReadiness({ ...readinessInput, tenantId: 'tenant-b' }, tenantId), /authenticated tenant/);
assert.throws(() => parseContestPayoutReadiness({ ...readinessInput, payoutTiers: [] }), /READY requires verified/);

const candidate = { id: 'candidate-a' } as LineupCandidate;
const selectedLineup = { candidateId: candidate.id } as SelectedLineup;
const portfolioInput = {
  contractVersion: ENGINE_CONTRACT_VERSION,
  portfolioId: 'portfolio-a', tenantId, slateId, contestId, houseReportId: house.houseReportId,
  generationRunId: 'run-a', modelVersion: house.modelVersion, objective: 'MAX_EXPECTED_NET_RETURN', entryCount: 1,
  candidates: [candidate], selectedLineups: [selectedLineup], legalityResults: [{ candidateId: candidate.id, legal: true, errors: [] }],
  payoutReadiness: readinessInput, expectedNetPayout: 20, expectedProfit: 10, cashProbability: 0.5, fieldModelVersion: 'field.v1',
  warnings: [], status: 'COMPLETE',
};
assert.equal(parsePortfolioSelection(portfolioInput, { expectedTenantId: tenantId, expectedSlateId: slateId, expectedContestId: contestId, expectedHouseReportId: house.houseReportId }).portfolioId, 'portfolio-a');
assert.throws(() => parsePortfolioSelection({ ...portfolioInput, contestId: 'other-contest' }, { expectedContestId: contestId }), /requested contest/);
assert.throws(() => parsePortfolioSelection({ ...portfolioInput, selectedLineups: [{ candidateId: 'missing' }] }), /absent from candidates/);
assert.throws(() => parsePortfolioSelection({ ...portfolioInput, legalityResults: [{ candidateId: candidate.id, legal: false, errors: ['bad'] }] }), /not affirmatively legal/);
assert.throws(() => parsePortfolioSelection({ ...portfolioInput, payoutReadiness: { ...readinessInput, status: 'PARTIAL' } }), /financial estimates require READY/);

const evaluationInput = {
  contractVersion: ENGINE_CONTRACT_VERSION,
  evaluationId: 'evaluation-a', tenantId, sport: 'NBA', contestFormat: 'CLASSIC', component: 'PROJECTION',
  baselineModelVersion: 'baseline.v1', candidateModelVersion: 'candidate.v1',
  evaluationWindow: { from: '2026-10-01T00:00:00.000Z', to: cutoff }, evaluatedAt: generatedAt,
  sampleCounts: { independentSlates: 30, playerRows: 100, lineupRows: 0, contestEntries: 0 },
  metrics: { mae: 4.2, rmse: 6.1, missing: null }, dataManifest: { source: 'verified-final' },
  gateDecision: 'HOLD', gateReason: 'baseline comparison required',
};
assert.equal(parseModelEvaluation(evaluationInput, tenantId).gateDecision, 'HOLD');
assert.throws(() => parseModelEvaluation({ ...evaluationInput, tenantId: 'tenant-b' }, tenantId), /authenticated tenant/);
assert.throws(() => parseModelEvaluation({ ...evaluationInput, evaluationWindow: { from: cutoff, to: '2026-10-01T00:00:00.000Z' } }), /must be ordered/);
assert.throws(() => parseModelEvaluation({ ...evaluationInput, gateDecision: 'PROMOTE', sampleCounts: { independentSlates: 0, playerRows: 0, lineupRows: 0, contestEntries: 0 } }), /no samples/);

const flags = readFeatureFlags({});
assert.deepEqual(flags, { STREET_TEAM_V2: false, NBA_HOUSE_V1: false, PORTFOLIO_EV_V1: false, LEARNING_V2: false });
assert.equal(readFeatureFlags({ NBA_HOUSE_V1: 'true' }).NBA_HOUSE_V1, true);
assert.equal(readFeatureFlags({ NBA_HOUSE_V1: '1' }).NBA_HOUSE_V1, false);
assert.equal(readFeatureFlags({ NBA_HOUSE_V1: 'false' }).NBA_HOUSE_V1, false);

console.log('P1 boundary contracts, compatibility, cutoff, tenant/sport/slate, payout, and feature flag checks passed.');
