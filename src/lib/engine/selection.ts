import type { LineupCandidate, ResearchPackage, SelectedLineup, SelectionPackage, SlatePlayer, ValidatedSlate } from './contracts.js';

export interface SelectionInput {
  validatedSlate: ValidatedSlate;
  researchPackage: ResearchPackage;
  optimizerPackage: { candidates: LineupCandidate[] };
}

export function selectLineups(input: SelectionInput, now = new Date()): SelectionPackage {
  const candidates = input.optimizerPackage.candidates;
  if (!candidates.length) return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: [], optimizerGap: 'Optimizer returned no candidates for Selection.', warnings: [], status: 'BLOCKED' };
  const requested = Math.max(1, input.validatedSlate.contest.userEntryCount);
  const maximum = input.validatedSlate.contest.maxEntriesAllowed ?? requested;
  const count = Math.min(requested, maximum, candidates.length);
  const ranked = rankForContext(candidates, input.validatedSlate);
  const { selected, underfilled } = choosePortfolio(ranked, count);
  const warnings = underfilled ? [`Only ${selected.length} of ${count} requested lineup(s) could be selected from the optimizer's candidate set (remaining candidates were too similar to already-selected lineups, or the candidate set was smaller than requested).`] : [];
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: selected.map((candidate, index) => explain(candidate, index + 1, input)), warnings, status: 'COMPLETE' };
}

// Default to the tournament-composite rank (already balances median/ceiling/frequency) even
// for single-entry contests — sorting by raw median alone is exactly the "always pick highest
// median" anti-pattern the design docs warn against. The one carve-out is a confirmed small
// cash game (an explicit cashLine on a small field), where beating a fixed line matters more
// than tournament-style ceiling chasing.
function rankForContext(candidates: LineupCandidate[], slate: ValidatedSlate): LineupCandidate[] {
  const cashLine = slate.contest.cashLine;
  const isSmallCashGame = cashLine !== undefined && (slate.contest.contestSize === undefined || slate.contest.contestSize < 2_500);
  if (isSmallCashGame) return [...candidates].sort((a, b) => (b.median - cashLine) - (a.median - cashLine));
  return [...candidates].sort((a, b) => a.tournamentRank - b.tournamentRank);
}

function choosePortfolio(candidates: LineupCandidate[], count: number): { selected: LineupCandidate[]; underfilled: boolean } {
  const chosenIds = new Set<string>();
  const chosen: LineupCandidate[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    const similarity = chosen.length ? Math.max(...chosen.map((existing) => overlap(existing.playerIds, candidate.playerIds))) : 0;
    if (chosen.length && count > 1 && similarity >= 0.8 && candidates.some((other) => !chosenIds.has(other.id) && overlap(existingIds(chosen), other.playerIds) < 0.8)) continue;
    chosen.push({ ...candidate, strategicSimilarity: similarity });
    chosenIds.add(candidate.id);
  }
  // Backfill with the next-best remaining candidates (even if similar) rather than silently
  // returning fewer lineups than requested with no signal.
  if (chosen.length < count) {
    for (const candidate of candidates) {
      if (chosen.length >= count) break;
      if (chosenIds.has(candidate.id)) continue;
      const similarity = chosen.length ? Math.max(...chosen.map((existing) => overlap(existing.playerIds, candidate.playerIds))) : 0;
      chosen.push({ ...candidate, strategicSimilarity: similarity });
      chosenIds.add(candidate.id);
    }
  }
  return { selected: chosen, underfilled: chosen.length < count };
}

function watchItemsFor(research: ResearchPackage, playerIds: string[]): string[] {
  return (research.watchItems ?? [])
    .filter((item) => item.importance === 'CRITICAL' && (!item.subjectId || playerIds.includes(item.subjectId)))
    .map((item) => item.reason);
}

function explain(candidate: LineupCandidate, bulletNumber: number, input: SelectionInput): SelectedLineup {
  const news = input.researchPackage.findings.filter((finding) => candidate.playerIds.includes(finding.subjectId) && finding.bucket === 'NEWS_EXTERNAL_CONTEXT').slice(0, 2).map((finding) => `${finding.sourceName}: ${finding.finding}`);
  const rationale = [
    `Median ${format(candidate.median)} with a ${format(candidate.ceiling)} ceiling.`,
    candidate.candidateTypes.length ? `Profile: ${candidate.candidateTypes.join(', ').replaceAll('_', ' ').toLowerCase()}.` : "Selected from the optimizer's ranked candidate set.",
    candidate.riskFlags.length ? `Watch: ${candidate.riskFlags[0]}` : 'No projection risk flag was attached to this candidate.',
  ];
  const watchItems = watchItemsFor(input.researchPackage, candidate.playerIds);
  return { candidateId: candidate.id, bulletNumber, selectionType: candidate.candidateTypes[0] ?? 'OPTIMIZER_RANKED', explanation: buildExplanation(candidate, input.validatedSlate), newsContext: news, rationale, playerIds: candidate.playerIds, rosterSlots: candidate.rosterSlots, salaryUsed: candidate.salaryUsed, salaryRemaining: candidate.salaryRemaining, floor: candidate.floor, median: candidate.median, ceiling: candidate.ceiling, watchItems, readinessStatus: watchItems.length ? 'READY_WITH_WATCH' : 'READY' };
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

function overlap(a: string[], b: string[]): number { const set = new Set(a); return b.filter((id) => set.has(id)).length / Math.max(a.length, b.length, 1); }
function existingIds(candidates: LineupCandidate[]): string[] { return [...new Set(candidates.flatMap((candidate) => candidate.playerIds))]; }
function format(value: number): string { return Number.isFinite(value) ? value.toFixed(1) : '—'; }
