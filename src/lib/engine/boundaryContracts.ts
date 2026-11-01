import { ENGINE_CONTRACT_VERSION, FDS_ERROR_CODES, FDS_SCHEMA_VERSION, FDS_TRANSPORT_CONTRACT_VERSION, SUPPORTED_FDS_SCHEMA_VERSIONS, isSupportedEngineContractVersion } from './contracts.js';
import type { ContestPayoutReadiness, FdsApiError, ModelEvaluation, NbaHouseReport, PortfolioSelection, SlateGame, StreetTeamSnapshot, ValidatedSlate } from './contracts.js';

export class BoundaryContractError extends Error {
  readonly path: string;
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.path = path; this.name = 'BoundaryContractError'; }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const iso = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const supportedSport = (value: unknown): boolean => ['NBA', 'WNBA', 'MLB', 'NFL', 'CFB', 'GOLF'].includes(String(value));

function currentContract(value: Record<string, unknown>, path = 'contractVersion'): void {
  if (value.contractVersion !== ENGINE_CONTRACT_VERSION) throw new BoundaryContractError(path, `expected ${ENGINE_CONTRACT_VERSION}`);
  assertCompatibleSchemaVersion(value.schemaVersion);
}
function assertCompatibleSchemaVersion(value: unknown): void {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !(SUPPORTED_FDS_SCHEMA_VERSIONS as readonly string[]).includes(value))) throw new BoundaryContractError('schemaVersion', `unsupported version ${String(value)}`);
}
function requireText(value: unknown, path: string): asserts value is string {
  if (!text(value)) throw new BoundaryContractError(path, 'required non-empty string');
}
function requireTime(value: unknown, path: string): asserts value is string {
  if (!iso(value) || !/(?:Z|\+00:00)$/i.test(value)) throw new BoundaryContractError(path, 'must be a valid UTC ISO timestamp');
}
function requireTenant(value: Record<string, unknown>, expectedTenantId?: string, path = 'tenantId'): void {
  requireText(value.tenantId, path);
  if (expectedTenantId && value.tenantId !== expectedTenantId) throw new BoundaryContractError(path, 'does not match authenticated tenant');
}
function requireSupportedSport(value: unknown, path: string): void {
  if (!supportedSport(value)) throw new BoundaryContractError(path, 'unsupported sport');
}
function requireUniqueStrings(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => !text(item)) || new Set(value).size !== value.length) throw new BoundaryContractError(path, 'must be an array of unique non-empty strings');
}

/** Validate and freeze the shared Street Team snapshot at its stated as-of time. */
export function parseStreetTeamSnapshot(value: unknown, expectedTenantId?: string): StreetTeamSnapshot {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  currentContract(value);
  requireTenant(value, expectedTenantId);
  requireText(value.snapshotId, 'snapshotId');
  requireSupportedSport(value.sport, 'sport');
  requireTime(value.asOf, 'asOf');
  requireTime(value.createdAt, 'createdAt');
  if (Date.parse(value.createdAt) < Date.parse(value.asOf)) throw new BoundaryContractError('createdAt', 'cannot precede snapshot asOf');
  requireText(value.evidenceHash, 'evidenceHash');
  for (const key of ['observations', 'resolvedFacts', 'rosterState', 'availability', 'transactions', 'behaviorSignals', 'unknowns', 'providerDiagnostics']) {
    if (!Array.isArray(value[key])) throw new BoundaryContractError(key, 'expected an array');
  }
  const observations = value.observations as unknown[];
  const resolvedFacts = value.resolvedFacts as unknown[];
  const rosterState = value.rosterState as unknown[];
  const availability = value.availability as unknown[];
  const transactions = value.transactions as unknown[];
  const behaviorSignals = value.behaviorSignals as unknown[];
  const providerDiagnostics = value.providerDiagnostics as unknown[];

  const observationIds = new Set<string>();
  for (const [index, raw] of observations.entries()) {
    const path = `observations[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.id, `${path}.id`);
    if (observationIds.has(raw.id)) throw new BoundaryContractError(`${path}.id`, 'duplicate observation ID');
    observationIds.add(raw.id);
    if (raw.tenantId !== value.tenantId || raw.sport !== value.sport) throw new BoundaryContractError(path, 'crossed tenant or sport boundary');
    if (!record(raw.subject) || !['PLAYER', 'TEAM', 'EVENT', 'LEAGUE'].includes(String(raw.subject.kind))) throw new BoundaryContractError(`${path}.subject`, 'invalid subject');
    requireText(raw.subject.id, `${path}.subject.id`);
    for (const key of ['claim', 'source', 'contentSha256']) requireText(raw[key], `${path}.${key}`);
    if (!['OFFICIAL_CONFIRMED', 'CORROBORATED_REPORT', 'SINGLE_SOURCE_REPORT', 'HYPOTHESIS', 'STALE', 'SUPERSEDED'].includes(String(raw.classification))) throw new BoundaryContractError(`${path}.classification`, 'invalid evidence classification');
    if (!finite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw new BoundaryContractError(`${path}.confidence`, 'must be between 0 and 1');
    requireTime(raw.observedAt, `${path}.observedAt`);
    requireTime(raw.retrievedAt, `${path}.retrievedAt`);
    if (Date.parse(raw.retrievedAt) < Date.parse(raw.observedAt)) throw new BoundaryContractError(`${path}.retrievedAt`, 'cannot precede observedAt');
    if (Date.parse(raw.retrievedAt) > Date.parse(value.asOf)) throw new BoundaryContractError(`${path}.retrievedAt`, 'cannot be later than snapshot asOf');
    for (const key of ['publishedAt', 'effectiveAt', 'expiresAt'] as const) if (raw[key] !== undefined && raw[key] !== null) requireTime(raw[key], `${path}.${key}`);
    if (raw.publishedAt && Date.parse(raw.publishedAt as string) > Date.parse(value.asOf)) throw new BoundaryContractError(`${path}.publishedAt`, 'cannot be later than snapshot asOf');
    if (raw.sourceUrl !== undefined && raw.sourceUrl !== null && (typeof raw.sourceUrl !== 'string' || !raw.sourceUrl.startsWith('https://'))) throw new BoundaryContractError(`${path}.sourceUrl`, 'must be HTTPS');
  }

  const factIds = new Set<string>();
  for (const [index, raw] of resolvedFacts.entries()) {
    const path = `resolvedFacts[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.id, `${path}.id`);
    if (factIds.has(raw.id)) throw new BoundaryContractError(`${path}.id`, 'duplicate fact ID');
    factIds.add(raw.id);
    if (raw.tenantId !== value.tenantId || raw.sport !== value.sport) throw new BoundaryContractError(path, 'crossed tenant or sport boundary');
    if (!record(raw.subject)) throw new BoundaryContractError(`${path}.subject`, 'expected a subject');
    requireText(raw.subject.id, `${path}.subject.id`);
    requireText(raw.factType, `${path}.factType`);
    requireUniqueStrings(raw.observationIds, `${path}.observationIds`);
    if (!raw.observationIds.length || raw.observationIds.some((id) => !observationIds.has(id))) throw new BoundaryContractError(`${path}.observationIds`, 'must reference observations in this snapshot');
    if (!['ACCEPTED', 'CONFLICT', 'UNKNOWN', 'EXPIRED'].includes(String(raw.state))) throw new BoundaryContractError(`${path}.state`, 'invalid resolution state');
    if (!finite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw new BoundaryContractError(`${path}.confidence`, 'must be between 0 and 1');
    requireTime(raw.resolvedAt, `${path}.resolvedAt`);
    if (Date.parse(raw.resolvedAt) > Date.parse(value.asOf)) throw new BoundaryContractError(`${path}.resolvedAt`, 'cannot be later than snapshot asOf');
    requireText(raw.ruleVersion, `${path}.ruleVersion`);
    if (raw.effectiveAt !== undefined && raw.effectiveAt !== null) requireTime(raw.effectiveAt, `${path}.effectiveAt`);
  }

  const validateEvidenceRefs = (refs: unknown, path: string) => {
    requireUniqueStrings(refs, path);
    if (refs.some((id) => !observationIds.has(id))) throw new BoundaryContractError(path, 'references an observation outside this snapshot');
  };
  for (const [index, raw] of rosterState.entries()) {
    const path = `rosterState[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    for (const key of ['teamId', 'playerId', 'status']) requireText(raw[key], `${path}.${key}`);
    requireTime(raw.validFrom, `${path}.validFrom`);
    if (raw.validTo !== undefined && raw.validTo !== null) requireTime(raw.validTo, `${path}.validTo`);
    const evidenceIds = raw.evidenceIds;
    validateEvidenceRefs(evidenceIds, `${path}.evidenceIds`);
    if (!(evidenceIds as string[]).length) throw new BoundaryContractError(`${path}.evidenceIds`, 'requires source evidence');
  }
  for (const [index, raw] of availability.entries()) {
    const path = `availability[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.playerId, `${path}.playerId`);
    requireText(raw.status, `${path}.status`);
    requireTime(raw.observedAt, `${path}.observedAt`);
    if (raw.effectiveAt !== undefined && raw.effectiveAt !== null) requireTime(raw.effectiveAt, `${path}.effectiveAt`);
    const evidenceIds = raw.evidenceIds;
    validateEvidenceRefs(evidenceIds, `${path}.evidenceIds`);
    if (!(evidenceIds as string[]).length) throw new BoundaryContractError(`${path}.evidenceIds`, 'requires source evidence');
  }
  for (const [index, raw] of transactions.entries()) {
    const path = `transactions[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.playerId, `${path}.playerId`);
    requireText(raw.transactionType, `${path}.transactionType`);
    requireTime(raw.effectiveAt, `${path}.effectiveAt`);
    const evidenceIds = raw.evidenceIds;
    validateEvidenceRefs(evidenceIds, `${path}.evidenceIds`);
    if (!(evidenceIds as string[]).length) throw new BoundaryContractError(`${path}.evidenceIds`, 'requires source evidence');
  }
  for (const [index, raw] of behaviorSignals.entries()) {
    const path = `behaviorSignals[${index}]`;
    if (!record(raw) || !record(raw.subject)) throw new BoundaryContractError(path, 'expected a signal and subject');
    if (raw.tenantId !== value.tenantId || raw.sport !== value.sport) throw new BoundaryContractError(path, 'crossed tenant or sport boundary');
    requireText(raw.id, `${path}.id`);
    requireText(raw.subject.id, `${path}.subject.id`);
    requireText(raw.event, `${path}.event`);
    const observationRefs = raw.observationIds;
    validateEvidenceRefs(observationRefs, `${path}.observationIds`);
    if (!(observationRefs as string[]).length) throw new BoundaryContractError(`${path}.observationIds`, 'requires source evidence');
    if (!finite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw new BoundaryContractError(`${path}.confidence`, 'must be between 0 and 1');
    if (!['REPORT_ONLY', 'VALIDATION_REQUIRED', 'APPROVED'].includes(String(raw.effectStatus))) throw new BoundaryContractError(`${path}.effectStatus`, 'invalid behavior effect status');
    if (raw.numericEffect !== undefined && !finite(raw.numericEffect)) throw new BoundaryContractError(`${path}.numericEffect`, 'must be finite');
    if (raw.effectStatus !== 'APPROVED' && raw.numericEffect !== undefined && raw.numericEffect !== 0) throw new BoundaryContractError(`${path}.numericEffect`, 'unapproved behavioral effects must be report-only or zero');
    if (raw.effectStatus === 'APPROVED' && !text(raw.modelVersion)) throw new BoundaryContractError(`${path}.modelVersion`, 'approved behavioral effects require a validated model version');
  }
  for (const [index, raw] of providerDiagnostics.entries()) {
    const path = `providerDiagnostics[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.provider, `${path}.provider`);
    requireTime(raw.retrievedAt, `${path}.retrievedAt`);
    if (Date.parse(raw.retrievedAt) > Date.parse(value.asOf)) throw new BoundaryContractError(`${path}.retrievedAt`, 'cannot be later than snapshot asOf');
    if (!['SUCCEEDED', 'EMPTY', 'FAILED', 'RATE_LIMITED'].includes(String(raw.status)) || !['FRESH', 'STALE', 'UNKNOWN'].includes(String(raw.freshness))) throw new BoundaryContractError(path, 'invalid provider status or freshness');
  }
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as unknown as StreetTeamSnapshot;
}

export interface NbaHouseBoundaryOptions {
  expectedTenantId?: string;
  expectedSlateId?: string;
  expectedForecastCutoff?: string;
  intelSnapshot?: StreetTeamSnapshot;
}

/** Validate House output against the exact slate, tenant, NBA sport, and evidence cutoff. */
export function parseNbaHouseReport(value: unknown, expected: NbaHouseBoundaryOptions = {}): NbaHouseReport {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  currentContract(value);
  requireTenant(value, expected.expectedTenantId);
  for (const key of ['houseReportId', 'slateId', 'intelSnapshotId', 'modelVersion', 'baselineModelVersion']) requireText(value[key], key);
  if (expected.expectedSlateId && value.slateId !== expected.expectedSlateId) throw new BoundaryContractError('slateId', 'does not match requested slate');
  if (value.sport !== 'NBA') throw new BoundaryContractError('sport', 'NBA House reports must be NBA');
  requireTime(value.forecastCutoff, 'forecastCutoff');
  requireTime(value.generatedAt, 'generatedAt');
  if (Date.parse(value.generatedAt) < Date.parse(value.forecastCutoff)) throw new BoundaryContractError('generatedAt', 'cannot precede forecastCutoff');
  if (expected.expectedForecastCutoff && value.forecastCutoff !== expected.expectedForecastCutoff) throw new BoundaryContractError('forecastCutoff', 'does not match requested forecast cutoff');
  if (expected.intelSnapshot) {
    if (expected.intelSnapshot.tenantId !== value.tenantId || expected.intelSnapshot.sport !== 'NBA' || expected.intelSnapshot.snapshotId !== value.intelSnapshotId) throw new BoundaryContractError('intelSnapshotId', 'does not match the supplied tenant-scoped NBA snapshot');
    if (expected.intelSnapshot.asOf !== value.forecastCutoff) throw new BoundaryContractError('forecastCutoff', 'must exactly match the intelligence snapshot asOf');
  }
  for (const key of ['baselineProjections', 'adjustedProjections'] as const) {
    const projection = value[key];
    if (!record(projection)) throw new BoundaryContractError(key, 'expected a projection package');
    if (projection.tenantId !== value.tenantId || projection.slateId !== value.slateId || projection.sport !== 'NBA') throw new BoundaryContractError(key, 'crossed House tenant, slate, or sport boundary');
    requireText(projection.modelVersion, `${key}.modelVersion`);
    requireTime(projection.generatedAt, `${key}.generatedAt`);
    if (Date.parse(projection.generatedAt) > Date.parse(value.generatedAt)) throw new BoundaryContractError(`${key}.generatedAt`, 'cannot follow the House report generation time');
    if (!Array.isArray(projection.players)) throw new BoundaryContractError(`${key}.players`, 'expected an array');
  }
  if (!Array.isArray(value.driverAttributions) || !Array.isArray(value.scenarioDistributions) || !Array.isArray(value.unknowns) || !Array.isArray(value.warnings)) throw new BoundaryContractError('$', 'House attributions, scenarios, unknowns, and warnings must be arrays');
  if (!['VALIDATED', 'UNVALIDATED', 'PARTIAL', 'BLOCKED'].includes(String(value.trustStatus))) throw new BoundaryContractError('trustStatus', 'invalid trust status');
  const evidenceIds = new Set(expected.intelSnapshot ? [...expected.intelSnapshot.observations.map((item) => item.id), ...expected.intelSnapshot.resolvedFacts.map((item) => item.id)] : []);
  for (const [index, raw] of value.driverAttributions.entries()) {
    const path = `driverAttributions[${index}]`;
    if (!record(raw)) throw new BoundaryContractError(path, 'expected an object');
    requireText(raw.playerId, `${path}.playerId`);
    requireText(raw.dimension, `${path}.dimension`);
    requireText(raw.modelVersion, `${path}.modelVersion`);
    if (!finite(raw.baselineValue) || !finite(raw.adjustedValue)) throw new BoundaryContractError(path, 'baseline and adjusted values must be finite');
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(String(raw.confidence))) throw new BoundaryContractError(`${path}.confidence`, 'invalid confidence');
    requireUniqueStrings(raw.evidenceIds, `${path}.evidenceIds`);
    if (expected.intelSnapshot && raw.evidenceIds.some((id) => !evidenceIds.has(id))) throw new BoundaryContractError(`${path}.evidenceIds`, 'references evidence outside the supplied intelligence snapshot');
  }
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as unknown as NbaHouseReport;
}

export function parseContestPayoutReadiness(value: unknown, expectedTenantId?: string): ContestPayoutReadiness {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  currentContract(value);
  requireTenant(value, expectedTenantId);
  for (const key of ['slateId', 'contestId']) requireText(value[key], key);
  requireTime(value.asOf, 'asOf');
  if (!['READY', 'PARTIAL', 'UNAVAILABLE'].includes(String(value.status))) throw new BoundaryContractError('status', 'invalid payout readiness');
  if (!['READY', 'PROJECTION_ONLY', 'NEEDS_PAYOUTS', 'NEEDS_FIELD_CALIBRATION', 'INVALID'].includes(String(value.decisionStatus))) throw new BoundaryContractError('decisionStatus', 'invalid contest readiness status');
  if (!['VERIFIED', 'INCOMPLETE', 'UNAVAILABLE'].includes(String(value.payoutStatus))) throw new BoundaryContractError('payoutStatus', 'invalid payout status');
  if (!['CALIBRATED', 'EXPERIMENTAL', 'UNAVAILABLE'].includes(String(value.fieldModelStatus))) throw new BoundaryContractError('fieldModelStatus', 'invalid field model status');
  if (!Array.isArray(value.payoutTiers) || !Array.isArray(value.warnings)) throw new BoundaryContractError('$', 'payoutTiers and warnings must be arrays');
  const ranks = new Set<number>();
  for (const [index, tier] of value.payoutTiers.entries()) {
    const path = `payoutTiers[${index}]`;
    if (!record(tier) || !Number.isInteger(tier.rank) || (tier.rank as number) < 1 || !finite(tier.payout) || tier.payout < 0) throw new BoundaryContractError(path, 'requires a positive rank and non-negative finite payout');
    if (ranks.has(tier.rank as number)) throw new BoundaryContractError(`${path}.rank`, 'duplicate payout rank');
    ranks.add(tier.rank as number);
  }
  if (value.entryFee !== undefined && (!finite(value.entryFee) || value.entryFee < 0)) throw new BoundaryContractError('entryFee', 'must be non-negative and finite');
  if (value.fieldSize !== undefined && (!Number.isInteger(value.fieldSize) || (value.fieldSize as number) < 1)) throw new BoundaryContractError('fieldSize', 'must be a positive integer');
  if (value.fieldModelVersion !== undefined) requireText(value.fieldModelVersion, 'fieldModelVersion');
  if (value.status === 'READY' && (value.payoutStatus !== 'VERIFIED' || value.payoutTiers.length === 0 || value.fieldModelStatus !== 'CALIBRATED' || !text(value.fieldModelVersion) || !finite(value.entryFee) || !finite(value.fieldSize))) throw new BoundaryContractError('status', 'READY requires verified payout tiers, entry fee, field size, and a calibrated versioned field model');
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as unknown as ContestPayoutReadiness;
}

export interface PortfolioBoundaryOptions { expectedTenantId?: string; expectedSlateId?: string; expectedContestId?: string; expectedHouseReportId?: string; }

export function parsePortfolioSelection(value: unknown, expected: PortfolioBoundaryOptions = {}): PortfolioSelection {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  currentContract(value);
  requireTenant(value, expected.expectedTenantId);
  for (const key of ['portfolioId', 'slateId', 'contestId', 'houseReportId', 'modelVersion']) requireText(value[key], key);
  if (expected.expectedSlateId && value.slateId !== expected.expectedSlateId) throw new BoundaryContractError('slateId', 'does not match requested slate');
  if (expected.expectedContestId && value.contestId !== expected.expectedContestId) throw new BoundaryContractError('contestId', 'does not match requested contest');
  if (expected.expectedHouseReportId && value.houseReportId !== expected.expectedHouseReportId) throw new BoundaryContractError('houseReportId', 'does not match requested House report');
  if (value.generationRunId !== undefined) requireText(value.generationRunId, 'generationRunId');
  if (!['MAX_EXPECTED_NET_RETURN', 'MAX_EXPECTED_POINTS', 'RISK_ADJUSTED_RETURN'].includes(String(value.objective))) throw new BoundaryContractError('objective', 'unsupported portfolio objective');
  if (!Number.isInteger(value.entryCount) || (value.entryCount as number) < 1) throw new BoundaryContractError('entryCount', 'must be a positive integer');
  if (!['COMPLETE', 'PARTIAL', 'BLOCKED'].includes(String(value.status))) throw new BoundaryContractError('status', 'invalid portfolio status');
  if (!Array.isArray(value.candidates) || !Array.isArray(value.selectedLineups) || !Array.isArray(value.legalityResults) || !Array.isArray(value.warnings)) throw new BoundaryContractError('$', 'candidates, selectedLineups, legalityResults, and warnings must be arrays');
  if (value.selectedLineups.length > (value.entryCount as number) || (value.status === 'COMPLETE' && value.selectedLineups.length !== value.entryCount)) throw new BoundaryContractError('selectedLineups', 'must not exceed entryCount and must fill all entries when COMPLETE');
  const readiness = parseContestPayoutReadiness(value.payoutReadiness, value.tenantId as string);
  if (readiness.slateId !== value.slateId || readiness.contestId !== value.contestId) throw new BoundaryContractError('payoutReadiness', 'does not match the portfolio slate and contest');
  const candidateIds = new Set<string>();
  for (const [index, candidate] of value.candidates.entries()) {
    if (!record(candidate)) throw new BoundaryContractError(`candidates[${index}]`, 'expected an object');
    requireText(candidate.id, `candidates[${index}].id`);
    if (candidateIds.has(candidate.id)) throw new BoundaryContractError(`candidates[${index}].id`, 'duplicate candidate ID');
    candidateIds.add(candidate.id);
  }
  const selectedIds = new Set<string>();
  for (const [index, lineup] of value.selectedLineups.entries()) {
    if (!record(lineup)) throw new BoundaryContractError(`selectedLineups[${index}]`, 'expected an object');
    requireText(lineup.candidateId, `selectedLineups[${index}].candidateId`);
    if (selectedIds.has(lineup.candidateId)) throw new BoundaryContractError(`selectedLineups[${index}].candidateId`, 'duplicate selected candidate');
    selectedIds.add(lineup.candidateId);
    if (!candidateIds.has(lineup.candidateId)) throw new BoundaryContractError(`selectedLineups[${index}].candidateId`, 'is absent from candidates');
  }
  const legalById = new Map<string, boolean>();
  for (const [index, result] of value.legalityResults.entries()) {
    if (!record(result)) throw new BoundaryContractError(`legalityResults[${index}]`, 'expected an object');
    requireText(result.candidateId, `legalityResults[${index}].candidateId`);
    if (!candidateIds.has(result.candidateId)) throw new BoundaryContractError(`legalityResults[${index}].candidateId`, 'is absent from candidates');
    if (typeof result.legal !== 'boolean' || !Array.isArray(result.errors) || result.errors.some((error) => typeof error !== 'string')) throw new BoundaryContractError(`legalityResults[${index}]`, 'requires a boolean legal status and string errors');
    if (legalById.has(result.candidateId)) throw new BoundaryContractError(`legalityResults[${index}].candidateId`, 'duplicate legality result');
    legalById.set(result.candidateId, result.legal);
  }
  for (const id of selectedIds) if (legalById.get(id) !== true) throw new BoundaryContractError('legalityResults', `selected lineup ${id} is not affirmatively legal`);
  const financialMetrics = ['expectedNetPayout', 'expectedProfit', 'cashProbability'] as const;
  for (const key of financialMetrics) {
    const metric = value[key];
    if (metric !== undefined && !finite(metric)) throw new BoundaryContractError(key, 'must be finite');
    if (metric !== undefined && readiness.status !== 'READY') throw new BoundaryContractError(key, 'financial estimates require READY payout and field inputs');
  }
  if (value.cashProbability !== undefined && ((value.cashProbability as number) < 0 || (value.cashProbability as number) > 1)) throw new BoundaryContractError('cashProbability', 'must be between 0 and 1');
  if (value.fieldModelVersion !== undefined) requireText(value.fieldModelVersion, 'fieldModelVersion');
  if (readiness.status === 'READY' && value.fieldModelVersion !== readiness.fieldModelVersion) throw new BoundaryContractError('fieldModelVersion', 'must match the calibrated payout-readiness field model');
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as unknown as PortfolioSelection;
}

export function parseModelEvaluation(value: unknown, expectedTenantId?: string): ModelEvaluation {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  currentContract(value);
  requireTenant(value, expectedTenantId);
  for (const key of ['evaluationId', 'component', 'baselineModelVersion', 'candidateModelVersion', 'gateReason']) requireText(value[key], key);
  requireSupportedSport(value.sport, 'sport');
  if (!['CLASSIC', 'SHOWDOWN'].includes(String(value.contestFormat))) throw new BoundaryContractError('contestFormat', 'invalid contest format');
  if (!['PROJECTION', 'SIMULATION', 'FIELD_MODEL', 'OPTIMIZER', 'PORTFOLIO'].includes(String(value.component))) throw new BoundaryContractError('component', 'invalid evaluation component');
  if (!record(value.evaluationWindow)) throw new BoundaryContractError('evaluationWindow', 'expected a time window');
  requireTime(value.evaluationWindow.from, 'evaluationWindow.from');
  requireTime(value.evaluationWindow.to, 'evaluationWindow.to');
  requireTime(value.evaluatedAt, 'evaluatedAt');
  if (Date.parse(value.evaluationWindow.from) > Date.parse(value.evaluationWindow.to) || Date.parse(value.evaluationWindow.to) > Date.parse(value.evaluatedAt)) throw new BoundaryContractError('evaluationWindow', 'must be ordered and end no later than evaluatedAt');
  if (!record(value.sampleCounts)) throw new BoundaryContractError('sampleCounts', 'expected sample counts');
  for (const key of ['independentSlates', 'playerRows', 'lineupRows', 'contestEntries']) if (!Number.isInteger(value.sampleCounts[key]) || (value.sampleCounts[key] as number) < 0) throw new BoundaryContractError(`sampleCounts.${key}`, 'must be a non-negative integer');
  if (!record(value.metrics) || Object.values(value.metrics).some((metric) => metric !== null && !finite(metric))) throw new BoundaryContractError('metrics', 'must contain only finite numbers or null');
  if (!record(value.dataManifest)) throw new BoundaryContractError('dataManifest', 'expected an object');
  if (!['PROMOTE', 'HOLD', 'INSUFFICIENT_DATA'].includes(String(value.gateDecision))) throw new BoundaryContractError('gateDecision', 'invalid gate decision');
  if (value.gateDecision === 'PROMOTE' && Object.values(value.sampleCounts).every((count) => count === 0)) throw new BoundaryContractError('gateDecision', 'cannot promote an evaluation with no samples');
  return { ...value, schemaVersion: FDS_SCHEMA_VERSION } as unknown as ModelEvaluation;
}

/** Validate untrusted JSON before transport data enters the engine domain. */
export function parseValidatedSlate(value: unknown, expectedTenantId?: string): ValidatedSlate {
  if (!record(value)) throw new BoundaryContractError('$', 'expected an object');
  assertCompatibleSchemaVersion(value.schemaVersion);
  if (value.contractVersion !== undefined && !isSupportedEngineContractVersion(value.contractVersion)) throw new BoundaryContractError('contractVersion', `unsupported version ${String(value.contractVersion)}`);
  if (value.transportContractVersion !== undefined && value.transportContractVersion !== FDS_TRANSPORT_CONTRACT_VERSION) throw new BoundaryContractError('transportContractVersion', `unsupported version ${String(value.transportContractVersion)}`);
  for (const key of ['tenantId', 'slateId', 'requestId'] as const) if (!text(value[key])) throw new BoundaryContractError(key, 'required non-empty string');
  if (expectedTenantId && value.tenantId !== expectedTenantId) throw new BoundaryContractError('tenantId', 'does not match authenticated tenant');
  if (!record(value.event) || !text(value.event.eventId) || !iso(value.event.eventDate)) throw new BoundaryContractError('event', 'legacy event adapter requires eventId and valid eventDate');
  if (!Array.isArray(value.playerPool)) throw new BoundaryContractError('playerPool', 'expected an array');
  const games = normalizeSlateGames(value as unknown as ValidatedSlate);
  const gameIds = new Set(games.map((game) => game.gameId));
  for (const [i, player] of value.playerPool.entries()) {
    if (!record(player) || !text(player.playerId)) throw new BoundaryContractError(`playerPool[${i}]`, 'requires a stable string playerId');
    if (player.gameId !== undefined && !gameIds.has(String(player.gameId))) throw new BoundaryContractError(`playerPool[${i}].gameId`, 'must reference a game in this slate');
    if (player.photo !== undefined) {
      if (!record(player.photo) || player.photo.playerId !== player.playerId || player.photo.tenantId !== value.tenantId) throw new BoundaryContractError(`playerPool[${i}].photo`, 'must use the canonical player and current tenant IDs');
      if (player.photo.url !== null && (typeof player.photo.url !== 'string' || !player.photo.url.startsWith('https://'))) throw new BoundaryContractError(`playerPool[${i}].photo.url`, 'must be null or HTTPS');
    }
  }
  return { ...value, games, schemaVersion: FDS_SCHEMA_VERSION, transportContractVersion: FDS_TRANSPORT_CONTRACT_VERSION } as unknown as ValidatedSlate;
}

/** Compatibility adapter: old one-event payloads become a one-game games[] slate. */
export function normalizeSlateGames(slate: Pick<ValidatedSlate, 'event' | 'games'>): SlateGame[] {
  if (slate.games?.length) {
    const ids = new Set<string>();
    for (const game of slate.games) {
      if (!record(game) || !text(game.gameId) || ids.has(game.gameId)) throw new BoundaryContractError('games', 'game IDs must be non-empty and unique');
      ids.add(game.gameId);
      if (!iso(game.scheduledStart)) throw new BoundaryContractError(`games.${game.gameId}.scheduledStart`, 'must be a valid timestamp');
      if (!Array.isArray(game.teamIds) || !record(game.providerIds)) throw new BoundaryContractError(`games.${game.gameId}`, 'teamIds and providerIds are required');
      for (const [provider, id] of Object.entries(game.providerIds)) if (!text(provider) || !text(id)) throw new BoundaryContractError(`games.${game.gameId}.providerIds`, 'provider IDs must be non-empty strings');
    }
    return slate.games;
  }
  if (!text(slate.event.eventId) || !iso(slate.event.eventDate)) throw new BoundaryContractError('event', 'cannot adapt invalid legacy event');
  return [{ gameId: slate.event.eventId, providerIds: {}, teamIds: [...slate.event.participants], scheduledStart: slate.event.eventDate, lockTime: slate.event.eventDate, status: 'UNKNOWN' }];
}

export function isFdsApiError(value: unknown): value is FdsApiError {
  if (!record(value) || !(FDS_ERROR_CODES as readonly string[]).includes(String(value.code)) || !text(value.safeMessage) || !text(value.requestId) || typeof value.retriable !== 'boolean' || !Array.isArray(value.reasons)) return false;
  return value.reasons.every((reason) => record(reason) && text(reason.code) && text(reason.message));
}

/** Strip query strings, fragments, and embedded credentials before a route is persisted. */
export function sanitizeProviderRoute(route: string): string {
  try {
    const url = new URL(route, 'https://provider.invalid');
    return `${url.host === 'provider.invalid' ? '' : url.host}${url.pathname}`.replace(/\/{2,}/g, '/').slice(0, 500);
  } catch {
    return route.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').slice(0, 500);
  }
}

/** JSON transport must preserve absent/null/zero distinctly; do not use truthy defaults. */
export function serializeContract<T extends { contractVersion?: string; transportContractVersion?: string; schemaVersion?: string }>(value: T): string {
  assertCompatibleSchemaVersion(value.schemaVersion);
  return JSON.stringify({ ...value, contractVersion: value.contractVersion ?? ENGINE_CONTRACT_VERSION, schemaVersion: FDS_SCHEMA_VERSION, transportContractVersion: value.transportContractVersion ?? FDS_TRANSPORT_CONTRACT_VERSION });
}
