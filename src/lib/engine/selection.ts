import type { LineupCandidate, ResearchPackage, SelectedLineup, SelectionPackage, SlatePlayer, ValidatedSlate } from './contracts.js';
import { calibratedCashLineProbability, CASH_LINE_TARGET_PROBABILITY, type CashLineCalibration } from './cashLineCalibration.js';

export interface SelectionInput {
  validatedSlate: ValidatedSlate;
  researchPackage: ResearchPackage;
  optimizerPackage: { candidates: LineupCandidate[] };
  cashLineCalibration?: CashLineCalibration;
}

export function selectLineups(input: SelectionInput, now = new Date()): SelectionPackage {
  const candidates = input.optimizerPackage.candidates;
  if (!candidates.length) return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: [], optimizerGap: 'Optimizer returned no candidates for Selection.', warnings: [], status: 'BLOCKED' };
  const requested = Math.max(1, input.validatedSlate.contest.userEntryCount);
  const maximum = input.validatedSlate.contest.maxEntriesAllowed ?? requested;
  const count = Math.min(requested, maximum, candidates.length);
  const isCashGame = input.validatedSlate.contest.contestKind === 'CASH';
  const ranked = rankForContext(candidates, input.validatedSlate, input.cashLineCalibration);
  const { selected, underfilled } = choosePortfolio(ranked, count, isCashGame);
  const warnings = underfilled ? [`Only ${selected.length} of ${count} requested lineup(s) could be selected from the optimizer's candidate set (remaining candidates were too similar to already-selected lineups, or the candidate set was smaller than requested).`] : [];
  const nearDuplicateCount = selected.filter((candidate) => candidate.strategicSimilarity >= 0.8).length;
  if (nearDuplicateCount) warnings.push(`${nearDuplicateCount} of ${selected.length} selected lineups closely overlap (>=80% shared players) with another selected lineup because the candidate pool didn't contain enough sufficiently distinct high-quality builds.`);
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: selected.map((candidate, index) => explain(candidate, index + 1, input, isCashGame)), warnings, status: 'COMPLETE' };
}

// Default to the tournament-composite rank (already balances median/ceiling/frequency) — sorting
// by raw median alone is exactly the "always pick highest median" anti-pattern the design docs
// warn against, and it's the wrong objective for a tournament regardless of contest size. The
// one carve-out is a contest DraftKings' own payout structure classifies as a cash game (see
// draftKingsSlate.ts's classifyContestKind) — there, beating the cash line is the actual game
// being played, so candidates are ranked by cash-line probability instead. This never blocks or
// shrinks the portfolio: choosePortfolio always fills from this ranking regardless of whether
// any candidate actually clears the 85% target -- see explain() for how a shortfall is disclosed.
function rankForContext(candidates: LineupCandidate[], slate: ValidatedSlate, calibration: CashLineCalibration | undefined): LineupCandidate[] {
  if (slate.contest.contestKind === 'CASH') return [...candidates].sort((a, b) => (resolveCashLineProbability(b, calibration).probability ?? -1) - (resolveCashLineProbability(a, calibration).probability ?? -1));
  return [...candidates].sort((a, b) => a.tournamentRank - b.tournamentRank);
}

export interface CashLineResolution { probability?: number; confidence: 'CALIBRATED' | 'SIMULATED_ESTIMATE' | 'UNAVAILABLE'; }
// Prefers real, historically-calibrated probability once enough resolved contest results exist
// (CashLineCalibration.status === 'APPROVED'); falls back to the simulated/manual raw estimate
// computed in Optimize; UNAVAILABLE when neither exists (e.g. an UNKNOWN-kind contest) rather
// than fabricating a number.
export function resolveCashLineProbability(candidate: LineupCandidate, calibration: CashLineCalibration | undefined): CashLineResolution {
  if (candidate.cashLineProbability === undefined) return { confidence: 'UNAVAILABLE' };
  if (calibration) { const calibrated = calibratedCashLineProbability(candidate.cashLineProbability, calibration); if (calibrated !== null) return { probability: calibrated, confidence: 'CALIBRATED' }; }
  return { probability: candidate.cashLineProbability, confidence: 'SIMULATED_ESTIMATE' };
}

// Cash games are probability-based, not a diversity problem: repeating the single best
// cash-line candidate across every entry is the correct play there (see rankForContext), so
// this just takes the top N by rank as-is. `strategicSimilarity` is still computed (against
// already-picked entries) purely for the near-duplicate disclosure in selectLineups/explain.
function choosePortfolioForCashGame(candidates: LineupCandidate[], count: number): { selected: LineupCandidate[]; underfilled: boolean } {
  const chosen: LineupCandidate[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    const similarity = chosen.length ? Math.max(...chosen.map((existing) => overlap(existing.playerIds, candidate.playerIds))) : 0;
    chosen.push({ ...candidate, strategicSimilarity: similarity });
  }
  return { selected: chosen, underfilled: chosen.length < count };
}

// Greedy diminishing-returns diverse selection for multi-entry GPP portfolios: each pick after
// the first maximizes (rank score - diversityWeight * overlap with the best-matching
// already-chosen lineup), instead of pure rank order. This naturally spreads a portfolio across
// genuinely different captains/stacks/game scripts when the pool supports it, while every
// remaining candidate is still always a legal pick -- so this never returns fewer than `count`
// unless the candidate pool itself is smaller than requested (same guarantee as before; a
// candidate that's still a near-duplicate of everything chosen so far is only picked once it's
// genuinely the best-scoring option left, which is the correct "pool too thin" signal downstream).
const DIVERSITY_WEIGHT = 0.35;
function choosePortfolioDiverse(candidates: LineupCandidate[], count: number): { selected: LineupCandidate[]; underfilled: boolean } {
  const rankScore = new Map(candidates.map((candidate, index) => [candidate.id, 1 - index / Math.max(1, candidates.length - 1)]));
  const remaining = [...candidates];
  const chosen: LineupCandidate[] = [];
  while (chosen.length < count && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    let bestSimilarity = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const similarity = chosen.length ? Math.max(...chosen.map((existing) => overlap(existing.playerIds, candidate.playerIds))) : 0;
      const score = (rankScore.get(candidate.id) ?? 0) - DIVERSITY_WEIGHT * similarity;
      if (score > bestScore) { bestScore = score; bestIndex = i; bestSimilarity = similarity; }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    chosen.push({ ...picked, strategicSimilarity: bestSimilarity });
  }
  return { selected: chosen, underfilled: chosen.length < count };
}

function choosePortfolio(candidates: LineupCandidate[], count: number, isCashGame: boolean): { selected: LineupCandidate[]; underfilled: boolean } {
  if (isCashGame || count <= 1) return choosePortfolioForCashGame(candidates, count);
  return choosePortfolioDiverse(candidates, count);
}

function watchItemsFor(research: ResearchPackage, playerIds: string[]): string[] {
  return (research.watchItems ?? [])
    .filter((item) => item.importance === 'CRITICAL' && (!item.subjectId || playerIds.includes(item.subjectId)))
    .map((item) => item.reason);
}

function explain(candidate: LineupCandidate, bulletNumber: number, input: SelectionInput, isCashGame: boolean): SelectedLineup {
  const news = input.researchPackage.findings.filter((finding) => candidate.playerIds.includes(finding.subjectId) && finding.bucket === 'NEWS_EXTERNAL_CONTEXT').slice(0, 2).map((finding) => `${finding.sourceName}: ${finding.finding}`);
  const cashLine = resolveCashLineProbability(candidate, input.cashLineCalibration);
  const rationale = [
    `Median ${format(candidate.median)} with a ${format(candidate.ceiling)} ceiling.`,
    candidate.candidateTypes.length ? `Profile: ${candidate.candidateTypes.join(', ').replaceAll('_', ' ').toLowerCase()}.` : "Selected from the optimizer's ranked candidate set.",
    candidate.riskFlags.length ? `Watch: ${candidate.riskFlags[0]}` : 'No projection risk flag was attached to this candidate.',
  ];
  // Cash-game shortfall is disclosed, never hidden -- the portfolio is still filled from the best
  // available candidate (choosePortfolio never blocks), this only makes clear when that candidate
  // didn't actually clear the 85% target rather than silently presenting it as if it had.
  if (isCashGame && cashLine.probability !== undefined && cashLine.probability < CASH_LINE_TARGET_PROBABILITY) rationale.push(`Best available cash-line confidence is ${Math.round(cashLine.probability * 100)}% (${cashLine.confidence === 'CALIBRATED' ? 'calibrated' : 'simulated estimate'}), below the ${Math.round(CASH_LINE_TARGET_PROBABILITY * 100)}% target — no candidate in this pool cleared it.`);
  if (candidate.candidateTypes.includes('LEVERAGE') || candidate.candidateTypes.includes('LOW_DUPLICATION')) rationale.push('Leverage/duplication figures are a salary-efficiency heuristic, not real field-ownership data.');
  if (candidate.strategicSimilarity >= 0.8) rationale.push('This lineup closely overlaps with another selected lineup due to a limited pool of distinct high-quality builds.');
  const watchItems = watchItemsFor(input.researchPackage, candidate.playerIds);
  return { candidateId: candidate.id, bulletNumber, selectionType: candidate.candidateTypes[0] ?? 'OPTIMIZER_RANKED', explanation: buildExplanation(candidate, input.validatedSlate), newsContext: news, rationale, playerIds: candidate.playerIds, rosterSlots: candidate.rosterSlots, salaryUsed: candidate.salaryUsed, salaryRemaining: candidate.salaryRemaining, floor: candidate.floor, median: candidate.median, ceiling: candidate.ceiling, watchItems, readinessStatus: watchItems.length ? 'READY_WITH_WATCH' : 'READY', cashLineProbability: cashLine.probability, cashLineConfidence: cashLine.confidence };
}

function buildExplanation(candidate: LineupCandidate, slate: ValidatedSlate): string {
  const topPlayers = candidate.playerIds
    .map((id) => slate.playerPool.find((player) => player.playerId === id))
    .filter((player): player is SlatePlayer => Boolean(player))
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 2)
    .map((player) => player.playerName);
  const typeLabel = candidate.candidateTypes.length ? candidate.candidateTypes.join(', ').replaceAll('_', ' ').toLowerCase() : "the optimizer's top-ranked build";
  const correlationNote = candidate.correlationScore > 0.05 ? ' with meaningful same-team correlation' : '';
  const anchor = topPlayers.length ? ` anchored by ${topPlayers.join(' and ')}` : '';
  return `Selected as ${typeLabel}${anchor}${correlationNote}, projecting ${format(candidate.median)} points on $${(candidate.salaryUsed / 1000).toFixed(1)}k of the $${(slate.salaryCap / 1000).toFixed(1)}k cap.`;
}

export function overlap(a: string[], b: string[]): number { const set = new Set(a); return b.filter((id) => set.has(id)).length / Math.max(a.length, b.length, 1); }
function format(value: number): string { return Number.isFinite(value) ? value.toFixed(1) : '—'; }
