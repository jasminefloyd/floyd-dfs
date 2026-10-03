export const CASH_LINE_CALIBRATION_VERSION = 'cash-line.v1';
export const CASH_LINE_TARGET_PROBABILITY = 0.85;
export const CASH_LINE_MIN_BUCKET_SAMPLES = 20;
export const CASH_LINE_MIN_APPROVAL_SAMPLES = 100;

export type CashLineCalibrationStatus = 'APPROVED' | 'PENDING_DATA' | 'UNCALIBRATED';

export interface CashLinePredictionInput {
  median: number;
  floor?: number;
  ceiling?: number;
  cashLine: number;
}

export interface CashLineObservation {
  rawProbability: number;
  beatCashLine: boolean;
  /** A DraftKings contest is the independent validation unit, not a lineup entry. */
  contestId?: string;
}

export interface CashLineCalibrationBin {
  lower: number;
  upper: number;
  samples: number;
  wins: number;
  observedRate: number;
  lowerConfidenceBound: number;
}

export interface CashLineCalibration {
  status: CashLineCalibrationStatus;
  version: string;
  targetProbability: number;
  sampleCount: number;
  approvedSampleCount: number;
  independentContestCount: number;
  releaseGate: 'DISABLED_PENDING_OUT_OF_SAMPLE_VALIDATION';
  bins: CashLineCalibrationBin[];
}

export function rawCashLineProbability(input: CashLinePredictionInput): number | null {
  if (![input.median, input.cashLine].every(Number.isFinite)) return null;
  const spread = Number.isFinite(input.floor) && Number.isFinite(input.ceiling) ? Math.max(1, (Number(input.ceiling) - Number(input.floor)) / 2.365) : Math.max(8, Math.abs(input.median) * 0.2);
  const z = (input.median - input.cashLine) / spread;
  return clamp(normalCdf(z));
}

export function buildCashLineCalibration(observations: CashLineObservation[]): CashLineCalibration {
  const validRows = observations.filter((item) => Number.isFinite(item.rawProbability) && Boolean(item.contestId?.trim()));
  // Keep one predeclared representative per contest: repeated lineups from one field
  // cannot inflate apparent calibration sample size. Deterministic selection avoids
  // making duplicate import order affect the result.
  const byContest = new Map<string, CashLineObservation>();
  for (const item of validRows) {
    const key = item.contestId!.trim();
    const prior = byContest.get(key);
    if (!prior || item.rawProbability < prior.rawProbability) byContest.set(key, item);
  }
  const valid = [...byContest.values()];
  const bins = Array.from({ length: 20 }, (_, index) => {
    const lower = index / 20;
    const upper = (index + 1) / 20;
    const rows = valid.filter((item) => item.rawProbability >= lower && (index === 19 ? item.rawProbability <= upper : item.rawProbability < upper));
    const wins = rows.filter((item) => item.beatCashLine).length;
    return { lower, upper, samples: rows.length, wins, observedRate: rows.length ? wins / rows.length : 0, lowerConfidenceBound: rows.length ? wilsonLowerBound(wins, rows.length) : 0 };
  }).filter((bin) => bin.samples > 0);
  const approved = bins.filter((bin) => bin.lower >= CASH_LINE_TARGET_PROBABILITY && bin.samples >= CASH_LINE_MIN_BUCKET_SAMPLES && bin.lowerConfidenceBound >= CASH_LINE_TARGET_PROBABILITY);
  const approvedSampleCount = approved.reduce((sum, bin) => sum + bin.samples, 0);
  // Win probabilities stay off until a chronological holdout plus same-slate baseline
  // evaluation has been reviewed and explicitly released. This function is descriptive only.
  const status: CashLineCalibrationStatus = valid.length < CASH_LINE_MIN_APPROVAL_SAMPLES ? 'PENDING_DATA' : 'UNCALIBRATED';
  return { status, version: CASH_LINE_CALIBRATION_VERSION, targetProbability: CASH_LINE_TARGET_PROBABILITY, sampleCount: observations.filter((item) => Number.isFinite(item.rawProbability)).length, approvedSampleCount, independentContestCount: valid.length, releaseGate: 'DISABLED_PENDING_OUT_OF_SAMPLE_VALIDATION', bins };
}

export function calibratedCashLineProbability(rawProbability: number | null, calibration: CashLineCalibration): number | null {
  if (rawProbability === null || calibration.status !== 'APPROVED') return null;
  // Bin construction uses a half-open interval [lower, upper) except for the final bin
  // (upper === 1), which is closed on both ends — the lookup must match exactly, or a
  // probability sitting on a 0.05 boundary can resolve to the wrong neighboring bin.
  const bin = calibration.bins.find((item) => rawProbability >= item.lower && (item.upper >= 1 ? rawProbability <= item.upper : rawProbability < item.upper) && item.samples >= CASH_LINE_MIN_BUCKET_SAMPLES);
  if (!bin || bin.lower < CASH_LINE_TARGET_PROBABILITY || bin.lowerConfidenceBound < CASH_LINE_TARGET_PROBABILITY) return null;
  return clamp(bin.observedRate);
}

function normalCdf(value: number): number { return 0.5 * (1 + erf(value / Math.sqrt(2))); }
function erf(value: number): number { const sign = value < 0 ? -1 : 1; const x = Math.abs(value); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return sign * y; }
function wilsonLowerBound(wins: number, samples: number): number { const z = 1.96; const p = wins / samples; const denominator = 1 + (z * z) / samples; const center = p + (z * z) / (2 * samples); const margin = z * Math.sqrt((p * (1 - p) / samples) + (z * z) / (4 * samples * samples)); return Math.max(0, (center - margin) / denominator); }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
