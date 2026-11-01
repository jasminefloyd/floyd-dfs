export const PROJECTED_OWNERSHIP_FIELD_MODEL_VERSION = 'projected-ownership-field.experimental.v1';

export interface ContestFieldValidationEvidence {
  modelVersion: string;
  independentContests: number;
  minimumIndependentContests: number;
  datasetSha256: string | null;
  passedPredeterminedChecks: boolean;
  humanApproved: boolean;
  evaluationVersion: string | null;
  evaluationReportSha256: string | null;
  holdoutStart: string | null;
  holdoutEnd: string | null;
  reviewedAt: string | null;
  reviewerId: string | null;
}

/** A model cannot become calibrated from one contest or an unreviewed metric response. */
export function contestFieldReadiness(evidence?: ContestFieldValidationEvidence): {
  status: 'CALIBRATED' | 'EXPERIMENTAL' | 'UNAVAILABLE';
  version?: string;
  reason: string;
} {
  if (!evidence) return { status: 'UNAVAILABLE', reason: 'No versioned contest-field validation evidence is available.' };
  const validWindow = isUtc(evidence.holdoutStart) && isUtc(evidence.holdoutEnd) && Date.parse(evidence.holdoutStart) < Date.parse(evidence.holdoutEnd);
  const reviewedAfterHoldout = isUtc(evidence.reviewedAt) && isUtc(evidence.holdoutEnd) && validWindow && Date.parse(evidence.reviewedAt) >= Date.parse(evidence.holdoutEnd);
  const completeEvidence = Boolean(evidence.modelVersion.trim())
    && Number.isInteger(evidence.independentContests) && evidence.independentContests > 0
    && Number.isInteger(evidence.minimumIndependentContests) && evidence.minimumIndependentContests >= 2
    && evidence.independentContests >= evidence.minimumIndependentContests
    && isSha256(evidence.datasetSha256)
    && evidence.passedPredeterminedChecks === true && evidence.humanApproved === true
    && Boolean(evidence.evaluationVersion?.trim()) && isSha256(evidence.evaluationReportSha256)
    && validWindow && reviewedAfterHoldout && Boolean(evidence.reviewerId?.trim());
  if (!completeEvidence) {
    return { status: 'EXPERIMENTAL', version: evidence.modelVersion, reason: 'Field model remains unvalidated until independent chronological contest evidence passes predetermined checks and receives human approval.' };
  }
  return { status: 'CALIBRATED', version: evidence.modelVersion, reason: 'Field model has versioned, reviewed chronological validation evidence.' };
}

function isSha256(value: string | null): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function isUtc(value: string | null): value is string { if (!value) return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
