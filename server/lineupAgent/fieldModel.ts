export const PROJECTED_OWNERSHIP_FIELD_MODEL_VERSION = 'projected-ownership-field.experimental.v1';

export interface ContestFieldValidationEvidence {
  modelVersion: string;
  independentContests: number;
  minimumIndependentContests: number;
  datasetSha256: string | null;
  passedPredeterminedChecks: boolean;
  humanApproved: boolean;
}

/** A model cannot become calibrated from one contest or an unreviewed metric response. */
export function contestFieldReadiness(evidence?: ContestFieldValidationEvidence): {
  status: 'CALIBRATED' | 'EXPERIMENTAL' | 'UNAVAILABLE';
  version?: string;
  reason: string;
} {
  if (!evidence) return { status: 'UNAVAILABLE', reason: 'No versioned contest-field validation evidence is available.' };
  if (!Number.isInteger(evidence.minimumIndependentContests) || evidence.minimumIndependentContests < 2 || evidence.independentContests < evidence.minimumIndependentContests || !evidence.datasetSha256 || !evidence.passedPredeterminedChecks || !evidence.humanApproved) {
    return { status: 'EXPERIMENTAL', version: evidence.modelVersion, reason: 'Field model remains unvalidated until independent chronological contest evidence passes predetermined checks and receives human approval.' };
  }
  return { status: 'CALIBRATED', version: evidence.modelVersion, reason: 'Field model has versioned, reviewed chronological validation evidence.' };
}
