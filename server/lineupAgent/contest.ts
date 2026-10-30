import type { ContestPayoutReadiness, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { ENGINE_CONTRACT_VERSION } from '../../src/lib/engine/contracts.js';

/**
 * Validate the facts needed for payout-aware lineup decisions. This classifies
 * inputs only; it never fills missing payout ranks or infers paid positions.
 */
export function assessContestPayoutReadiness(slate: ValidatedSlate, fieldModel: { status: 'CALIBRATED' | 'EXPERIMENTAL' | 'UNAVAILABLE'; version?: string } = { status: 'UNAVAILABLE' }): ContestPayoutReadiness {
  const contest = slate.contest;
  const tiers = contest.payoutStructure ?? [];
  const ranks = new Set<number>();
  const validRows = tiers.every((tier) => Number.isInteger(tier.rank) && tier.rank > 0 && Number.isFinite(tier.payout) && tier.payout >= 0 && !ranks.has(tier.rank) && Boolean(ranks.add(tier.rank)));
  const feeValid = Number.isFinite(contest.entryFee) && contest.entryFee! > 0;
  const paidPositionsValid = Number.isInteger(contest.paidPositions) && contest.paidPositions! > 0 && Boolean(contest.contestSize && contest.paidPositions! < contest.contestSize);
  const payoutComplete = validRows && feeValid && paidPositionsValid && Array.from({ length: contest.paidPositions ?? 0 }, (_, index) => index + 1).every((rank) => ranks.has(rank));
  const warnings: string[] = [];
  if (!payoutComplete) warnings.push('Payout-aware financial estimates are unavailable because the complete paid-rank ladder, field size, and positive entry fee were not all verified.');
  if (fieldModel.status !== 'CALIBRATED') warnings.push(fieldModel.status === 'EXPERIMENTAL' ? 'Opponent-field estimates are experimental and are not used as trusted expected return or cash probability.' : 'Opponent-field model is unavailable; expected return and cash probability are unavailable.');
  if (payoutComplete && fieldModel.status !== 'CALIBRATED') warnings.push('Payout tiers are present, but a calibrated opponent-field model is required before financial estimates can be treated as decision-ready.');
  const ready = payoutComplete && fieldModel.status === 'CALIBRATED';
  const somePayoutData = tiers.length > 0 || contest.entryFee !== undefined || contest.paidPositions !== undefined;
  return {
    contractVersion: ENGINE_CONTRACT_VERSION,
    tenantId: slate.tenantId,
    slateId: slate.slateId,
    contestId: contest.draftKingsContestId,
    asOf: new Date().toISOString(),
    status: ready ? 'READY' : somePayoutData ? 'PARTIAL' : 'UNAVAILABLE',
    payoutStatus: payoutComplete ? 'VERIFIED' : somePayoutData ? 'INCOMPLETE' : 'UNAVAILABLE',
    payoutTiers: payoutComplete ? [...tiers].sort((a, b) => a.rank - b.rank) : [],
    ...(feeValid ? { entryFee: contest.entryFee } : {}),
    ...(Number.isInteger(contest.contestSize) && contest.contestSize! > 0 ? { fieldSize: contest.contestSize } : {}),
    fieldModelStatus: fieldModel.status,
    ...(fieldModel.version ? { fieldModelVersion: fieldModel.version } : {}),
    warnings,
  };
}
