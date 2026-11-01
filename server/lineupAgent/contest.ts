import type { ContestPayoutReadiness, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { ENGINE_CONTRACT_VERSION } from '../../src/lib/engine/contracts.js';
import type { ContestSpec } from './contracts.js';

/** Freeze all contest, scoring, roster and eligible-pool inputs used by a generated portfolio. */
export function buildContestSpec(slate: ValidatedSlate, fieldModelStatus: 'CALIBRATED' | 'EXPERIMENTAL' | 'UNAVAILABLE' = 'UNAVAILABLE'): ContestSpec {
  const sources = slate.sourceManifest.map((item) => item.source);
  const manualFields = new Set(slate.sourceManifest.find((item) => item.source === 'USER_CONFIRMED_CONTEST_TERMS')?.fields ?? []);
  const apiSource = sources.includes('DRAFTKINGS_API');
  const csvSource = sources.includes('DRAFTKINGS_PUBLIC_LOBBY_AND_PLAYER_CSV');
  const payoutReadiness = assessContestPayoutReadiness(slate, { status: fieldModelStatus });
  const rulesComplete = slate.salaryCap > 0 && slate.rosterRules.rosterSize > 0 && Object.keys(slate.scoringRules).length > 0 && slate.playerPool.length > 0;
  const warnings = [...payoutReadiness.warnings];
  if (csvSource) warnings.push('Contest/player inputs came from the public lobby and salary CSV fallback; verify the saved roster/scoring rules before entry.');
  if (fieldModelStatus !== 'CALIBRATED' && payoutReadiness.payoutStatus === 'VERIFIED') warnings.push('Payout terms are present, but financial readiness is blocked until the versioned field model is calibrated.');
  const readiness: ContestSpec['readiness'] = !rulesComplete || slate.validation.status === 'BLOCKED'
    ? 'PROJECTION_ONLY'
    : payoutReadiness.payoutStatus !== 'VERIFIED' ? 'NEEDS_PAYOUTS'
      : fieldModelStatus !== 'CALIBRATED' ? 'NEEDS_FIELD_CALIBRATION' : 'READY';
  return {
    specVersion: 'draftkings-contest-spec.v1', sport: slate.sport, slateId: slate.slateId,
    contestId: slate.contest.draftKingsContestId, name: slate.contest.name, format: slate.contest.format,
    lockTime: slate.contest.lockTime, entryFee: finiteNonnegative(slate.contest.entryFee),
    fieldSize: positiveInteger(slate.contest.contestSize), entryLimit: positiveInteger(slate.contest.maxEntriesAllowed),
    requestedEntries: slate.contest.userEntryCount, salaryCap: slate.salaryCap,
    rosterRules: slate.rosterRules,
    multiplierRules: Object.fromEntries(Object.entries(slate.rosterRules.slots).flatMap(([slot, rule]) => rule.salaryMultiplier !== undefined || rule.fantasyMultiplier !== undefined ? [[slot, { ...(rule.salaryMultiplier !== undefined ? { salaryMultiplier: rule.salaryMultiplier } : {}), ...(rule.fantasyMultiplier !== undefined ? { fantasyMultiplier: rule.fantasyMultiplier } : {}) }]] : [])),
    scoringRules: slate.scoringRules,
    sourceVersion: slate.sourceManifest.map((item) => `${item.source}:${item.ruleVersion ?? item.receivedAt}`).join('|') || 'UNKNOWN',
    eligiblePlayerIds: slate.playerPool.map((player) => player.playerId).sort(),
    payoutTiers: payoutReadiness.payoutTiers,
    tieHandling: { rule: slate.contest.tieHandling ?? 'UNKNOWN', provenance: slate.contest.tieHandling ? (manualFields.has('tieHandling') ? 'USER_CONFIRMED' : apiSource ? 'DRAFTKINGS_API' : 'UNKNOWN') : 'UNKNOWN' },
    lateSwap: { allowed: typeof slate.contest.lateSwapAllowed === 'boolean' ? slate.contest.lateSwapAllowed : null, provenance: typeof slate.contest.lateSwapAllowed !== 'boolean' ? 'UNKNOWN' : manualFields.has('lateSwapAllowed') ? 'USER_CONFIRMED' : apiSource ? 'DRAFTKINGS_API' : 'UNKNOWN' },
    provenance: {
      contestIdentity: apiSource ? 'DRAFTKINGS_API' : csvSource ? 'DRAFTKINGS_PUBLIC_LOBBY' : 'UNKNOWN',
      rules: slate.sourceManifest.some((item) => item.source === 'DRAFTKINGS_PUBLISHED_CONTEST_RULE_PROFILE') ? 'DRAFTKINGS_PUBLISHED_RULE_PROFILE' : apiSource ? 'DRAFTKINGS_API' : 'UNKNOWN',
      playerPool: apiSource ? 'DRAFTKINGS_API' : csvSource ? 'DRAFTKINGS_PUBLIC_PLAYER_CSV' : 'UNKNOWN',
      payout: payoutReadiness.payoutStatus === 'VERIFIED' && manualFields.has('payoutTiers') ? 'USER_CONFIRMED' : payoutReadiness.payoutStatus === 'VERIFIED' && apiSource ? 'DRAFTKINGS_API' : 'UNAVAILABLE',
      entryFee: finiteNonnegative(slate.contest.entryFee) !== null && manualFields.has('entryFee') ? 'USER_CONFIRMED' : finiteNonnegative(slate.contest.entryFee) !== null && apiSource ? 'DRAFTKINGS_API' : 'UNAVAILABLE',
      entryLimit: positiveInteger(slate.contest.maxEntriesAllowed) !== null && manualFields.has('entryLimit') ? 'USER_CONFIRMED' : positiveInteger(slate.contest.maxEntriesAllowed) !== null && apiSource ? 'DRAFTKINGS_API' : 'UNAVAILABLE',
      fieldSize: positiveInteger(slate.contest.contestSize) !== null && manualFields.has('fieldSize') ? 'USER_CONFIRMED' : positiveInteger(slate.contest.contestSize) !== null && csvSource ? 'DRAFTKINGS_PUBLIC_LOBBY' : positiveInteger(slate.contest.contestSize) !== null && apiSource ? 'DRAFTKINGS_API' : 'UNAVAILABLE',
    },
    readiness, warnings,
  };
}

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
  const payoutComplete = validRows && feeValid && paidPositionsValid && contest.tieHandling === 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS' && Array.from({ length: contest.paidPositions ?? 0 }, (_, index) => index + 1).every((rank) => ranks.has(rank));
  const warnings: string[] = [];
  if (!payoutComplete) warnings.push('Payout-aware financial estimates are unavailable because the complete paid-rank ladder, field size, and positive entry fee were not all verified.');
  if (contest.tieHandling !== 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS') warnings.push('Payout-aware estimates are withheld because contest tie handling is not explicitly verified.');
  if (fieldModel.status !== 'CALIBRATED') warnings.push(fieldModel.status === 'EXPERIMENTAL' ? 'Opponent-field estimates are experimental and are not used as trusted expected return or cash probability.' : 'Opponent-field model is unavailable; expected return and cash probability are unavailable.');
  if (payoutComplete && fieldModel.status !== 'CALIBRATED') warnings.push('Payout tiers are present, but a calibrated opponent-field model is required before financial estimates can be treated as decision-ready.');
  const ready = payoutComplete && fieldModel.status === 'CALIBRATED';
  const somePayoutData = tiers.length > 0 || contest.entryFee !== undefined || contest.paidPositions !== undefined;
  const decisionStatus = slate.validation.status === 'BLOCKED' ? 'INVALID' : ready ? 'READY' : payoutComplete ? 'NEEDS_FIELD_CALIBRATION' : somePayoutData ? 'NEEDS_PAYOUTS' : 'PROJECTION_ONLY';
  return {
    contractVersion: ENGINE_CONTRACT_VERSION,
    tenantId: slate.tenantId,
    slateId: slate.slateId,
    contestId: contest.draftKingsContestId,
    asOf: new Date().toISOString(),
    status: ready ? 'READY' : somePayoutData ? 'PARTIAL' : 'UNAVAILABLE',
    decisionStatus,
    payoutStatus: payoutComplete ? 'VERIFIED' : somePayoutData ? 'INCOMPLETE' : 'UNAVAILABLE',
    payoutTiers: payoutComplete ? [...tiers].sort((a, b) => a.rank - b.rank) : [],
    ...(feeValid ? { entryFee: contest.entryFee } : {}),
    ...(Number.isInteger(contest.contestSize) && contest.contestSize! > 0 ? { fieldSize: contest.contestSize } : {}),
    fieldModelStatus: fieldModel.status,
    ...(fieldModel.version ? { fieldModelVersion: fieldModel.version } : {}),
    warnings,
  };
}

function finiteNonnegative(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function positiveInteger(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null; }
