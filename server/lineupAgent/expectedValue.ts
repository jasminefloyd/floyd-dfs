import { averagePayoutForTie } from '../../src/lib/engine/contestSimulation.js';
import type { ContestPayoutReadiness } from '../../src/lib/engine/contracts.js';

export interface ExpectedValueInput {
  readiness: ContestPayoutReadiness;
  candidateScores: number[];
  opponentScoresByTrial: number[][];
}

/** Return null financial outputs unless both contest terms and field model are decision-ready. */
export function calculateContestExpectedValue(input: ExpectedValueInput): {
  expectedGrossPayout: number | null;
  expectedNetProfit: number | null;
  cashProbability: number | null;
  lossProbability: number | null;
  p10GrossPayout: number | null;
  p90GrossPayout: number | null;
  reason?: string;
} {
  const { readiness, candidateScores, opponentScoresByTrial } = input;
  if (readiness.status !== 'READY' || readiness.payoutStatus !== 'VERIFIED' || readiness.fieldModelStatus !== 'CALIBRATED') {
    return { expectedGrossPayout: null, expectedNetProfit: null, cashProbability: null, lossProbability: null, p10GrossPayout: null, p90GrossPayout: null, reason: readiness.warnings.join(' ') || 'Verified payout rules and a calibrated field model are required.' };
  }
  if (!Number.isFinite(readiness.entryFee) || !Number.isInteger(readiness.fieldSize) || readiness.fieldSize! < 2 || candidateScores.length < 1 || candidateScores.length !== opponentScoresByTrial.length || candidateScores.some((score) => !Number.isFinite(score)) || opponentScoresByTrial.some((scores) => scores.length !== readiness.fieldSize! - 1 || scores.some((score) => !Number.isFinite(score)))) {
    return { expectedGrossPayout: null, expectedNetProfit: null, cashProbability: null, lossProbability: null, p10GrossPayout: null, p90GrossPayout: null, reason: 'Contest field scores do not match the verified contest size or contain invalid values.' };
  }
  const payouts = new Map(readiness.payoutTiers.map((tier) => [tier.rank, tier.payout]));
  const payoutSamples = candidateScores.map((score, trial) => {
    const opponents = opponentScoresByTrial[trial];
    const ahead = opponents.filter((opponent) => opponent > score).length;
    const tied = opponents.filter((opponent) => opponent === score).length + 1;
    return averagePayoutForTie(ahead + 1, tied, readiness.payoutTiers.length, payouts);
  });
  const sorted = [...payoutSamples].sort((a, b) => a - b);
  const mean = payoutSamples.reduce((sum, value) => sum + value, 0) / payoutSamples.length;
  const cashProbability = payoutSamples.filter((value) => value > 0).length / payoutSamples.length;
  return {
    expectedGrossPayout: mean,
    expectedNetProfit: mean - readiness.entryFee!,
    cashProbability,
    lossProbability: 1 - cashProbability,
    p10GrossPayout: quantile(sorted, 0.1),
    p90GrossPayout: quantile(sorted, 0.9),
  };
}

function quantile(sorted: number[], probability: number): number { if (!sorted.length) return 0; const index = (sorted.length - 1) * probability; const lower = Math.floor(index); const fraction = index - lower; return sorted[lower]! + ((sorted[Math.ceil(index)] ?? sorted[lower]!) - sorted[lower]!) * fraction; }
