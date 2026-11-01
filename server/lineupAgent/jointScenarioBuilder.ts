import type { OptimizerPackage } from '../../src/lib/engine/contracts.js';
import type { JointFieldScenarios } from './portfolioOptimizer.js';
import { contestFieldReadiness, type ContestFieldValidationEvidence } from './fieldModel.js';

export type JointScenarioReadiness =
  | { status: 'READY'; scenarios: JointFieldScenarios; fieldModelVersion: string; datasetSha256: string }
  | { status: 'NOT_READY'; reasons: string[] };

/** Resolve a persisted scenario artifact only when independent field-model evidence is complete. */
export function buildJointFieldScenarios(optimizer: OptimizerPackage): JointScenarioReadiness {
  const simulation = optimizer.contestSimulation;
  const reasons: string[] = [];
  if (!simulation) return { status: 'NOT_READY', reasons: ['Optimizer has no contest simulation artifact.'] };

  const evidence = simulation.fieldValidationEvidence as ContestFieldValidationEvidence | undefined;
  const readiness = contestFieldReadiness(evidence);
  if (readiness.status !== 'CALIBRATED') reasons.push(...calibrationGaps(evidence));
  const scenarios = simulation.jointFieldScenarios as JointFieldScenarios | undefined;
  if (!scenarios) reasons.push('A common-trial joint opponent/candidate scenario artifact is unavailable.');
  if (scenarios && readiness.status === 'CALIBRATED') {
    if (scenarios.fieldModelVersion !== readiness.version) reasons.push('Scenario field-model version does not match the reviewed validation evidence.');
    if (scenarios.datasetSha256 !== evidence?.datasetSha256) reasons.push('Scenario dataset hash does not match the reviewed validation evidence.');
  }
  if (reasons.length || !scenarios || !evidence || readiness.status !== 'CALIBRATED') return { status: 'NOT_READY', reasons: [...new Set(reasons)] };
  return { status: 'READY', scenarios, fieldModelVersion: readiness.version!, datasetSha256: evidence.datasetSha256! };
}

function calibrationGaps(evidence?: ContestFieldValidationEvidence): string[] {
  if (!evidence) return ['No versioned contest-field evaluation evidence is available.'];
  const gaps: string[] = [];
  if (!evidence.modelVersion.trim()) gaps.push('Field-model version is missing.');
  if (!Number.isInteger(evidence.independentContests) || !Number.isInteger(evidence.minimumIndependentContests) || evidence.minimumIndependentContests < 2 || evidence.independentContests < evidence.minimumIndependentContests) gaps.push('Independent contest holdout count is below the configured minimum.');
  if (!isSha256(evidence.datasetSha256)) gaps.push('Validation dataset SHA-256 is missing or invalid.');
  if (evidence.passedPredeterminedChecks !== true) gaps.push('Predetermined validation checks have not passed.');
  if (evidence.humanApproved !== true || !evidence.reviewerId?.trim()) gaps.push('Named human review approval is missing.');
  if (!evidence.evaluationVersion?.trim() || !isSha256(evidence.evaluationReportSha256)) gaps.push('Versioned evaluation report and its SHA-256 are required.');
  const start = isUtc(evidence.holdoutStart) ? Date.parse(evidence.holdoutStart) : NaN;
  const end = isUtc(evidence.holdoutEnd) ? Date.parse(evidence.holdoutEnd) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) gaps.push('A valid chronological holdout window is required.');
  const reviewed = isUtc(evidence.reviewedAt) ? Date.parse(evidence.reviewedAt) : NaN;
  if (!Number.isFinite(reviewed) || !Number.isFinite(end) || reviewed < end) gaps.push('Review timestamp must be at or after the holdout end.');
  return gaps.length ? gaps : ["Field evidence did not satisfy the certification policy."];
}
function isSha256(value: string | null): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function isUtc(value: string | null): value is string { if (!value) return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
