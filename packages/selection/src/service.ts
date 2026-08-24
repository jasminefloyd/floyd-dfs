import type { LineupCandidate, SelectionInput, SelectionPackage, SelectionService, SelectedLineup } from "@sports-engine/contracts";

export class DeterministicSelectionService implements SelectionService {
  select(input: SelectionInput, now = new Date()): SelectionPackage {
    const candidates = input.optimizerPackage.candidates;
    if (!candidates.length) return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: [], optimizerGap: "Optimizer returned no candidates for Selection.", status: "BLOCKED" };
    const requested = Math.max(1, input.validatedSlate.contest.userEntryCount);
    const maximum = input.validatedSlate.contest.maxEntriesAllowed ?? requested;
    const count = Math.min(requested, maximum, candidates.length);
    const ranked = rankForContext(candidates, input.validatedSlate.contest.contestSize, requested);
    const selected = choosePortfolio(ranked, count);
    return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), selectedLineups: selected.map((candidate, index) => explain(candidate, index + 1, input)), status: "COMPLETE" };
  }
}

function rankForContext(candidates: LineupCandidate[], contestSize: number | undefined, entries: number): LineupCandidate[] {
  const tournament = (contestSize ?? 0) >= 10000 || entries > 1;
  return [...candidates].sort((a, b) => (tournament ? a.tournamentRank - b.tournamentRank : b.median - a.median));
}

function choosePortfolio(candidates: LineupCandidate[], count: number): LineupCandidate[] {
  const chosen: LineupCandidate[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    const similarity = chosen.length ? Math.max(...chosen.map((existing) => overlap(existing.playerIds, candidate.playerIds))) : 0;
    if (chosen.length && count > 1 && similarity >= 0.8 && candidates.some((other) => !chosen.includes(other) && overlap(existingIds(chosen), other.playerIds) < 0.8)) continue;
    chosen.push({ ...candidate, strategicSimilarity: similarity });
  }
  return chosen;
}

function explain(candidate: LineupCandidate, bulletNumber: number, input: SelectionInput): SelectedLineup {
  const news = input.researchPackage.findings.filter((finding) => candidate.playerIds.includes(finding.subjectId) && finding.bucket === "NEWS_EXTERNAL_CONTEXT").slice(0, 2).map((finding) => `${finding.sourceName}: ${finding.finding}`);
  const rationale = [
    `Median ${format(candidate.median)} with a ${format(candidate.ceiling)} ceiling.`,
    candidate.candidateTypes.length ? `Profile: ${candidate.candidateTypes.join(", ").replaceAll("_", " ").toLowerCase()}.` : "Selected from the optimizer's ranked candidate set.",
    candidate.riskFlags.length ? `Watch: ${candidate.riskFlags[0]}` : "No projection risk flag was attached to this candidate.",
  ];
  return { candidateId: candidate.id, bulletNumber, selectionType: candidate.candidateTypes[0] ?? "OPTIMIZER_RANKED", explanation: "This lineup balances the slate's strongest quantified path with the contest context. The Selection Agent chose it from the optimizer candidates and did not alter the roster.", newsContext: news, rationale, playerIds: candidate.playerIds, rosterSlots: candidate.rosterSlots, salaryUsed: candidate.salaryUsed, salaryRemaining: candidate.salaryRemaining, median: candidate.median, ceiling: candidate.ceiling };
}

function overlap(a: string[], b: string[]): number { const set = new Set(a); return b.filter((id) => set.has(id)).length / Math.max(a.length, b.length, 1); }
function existingIds(candidates: LineupCandidate[]): string[] { return [...new Set(candidates.flatMap((candidate) => candidate.playerIds))]; }
function format(value: number): string { return Number.isFinite(value) ? value.toFixed(1) : "—"; }
