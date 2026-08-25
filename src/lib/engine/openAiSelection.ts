import type { LineupCandidate, ResearchPackage, SelectionPackage, ValidatedSlate } from './contracts.js';

export interface OpenAiSelectionOptions { apiKey: string; model?: string; endpoint?: string; fetcher?: typeof fetch; }
export async function selectWithOpenAi(input: { slate: ValidatedSlate; research: ResearchPackage; candidates: LineupCandidate[]; selection: SelectionPackage }, options: OpenAiSelectionOptions): Promise<SelectionPackage> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(options.endpoint ?? 'https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({
    model: options.model ?? 'gpt-5', store: false,
    input: `You are a friendly, knowledgeable DFS expert choosing the final lineup(s) for a DraftKings contest. Choose only existing candidate IDs. Never create or modify a lineup. Contest size: ${input.slate.contest.contestSize ?? 'unknown'}. Entries: ${input.slate.contest.userEntryCount}. Candidates: ${JSON.stringify(input.candidates.map((candidate) => ({ id: candidate.id, median: candidate.median, ceiling: candidate.ceiling, tournamentRank: candidate.tournamentRank, leverageScore: candidate.leverageScore, duplicationRisk: candidate.duplicationRisk, playerIds: candidate.playerIds })))}. Return the strongest candidates in order, each with a concise (1-2 sentence), plain-English explanation of why it was chosen. Be concrete and grounded; no hype, no "lock of the century", no false certainty.`,
    text: { format: { type: 'json_schema', name: 'selection', strict: true, schema: { type: 'object', additionalProperties: false, properties: { selections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { candidateId: { type: 'string' }, explanation: { type: 'string' } }, required: ['candidateId', 'explanation'] } } }, required: ['selections'] } } },
  }) });
  if (!response.ok) throw new Error(`OpenAI Selection API returned HTTP ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  const text = typeof payload.output_text === 'string' ? payload.output_text : extractOutputText(payload.output);
  if (!text) throw new Error('OpenAI Selection returned no structured output.');
  const parsed = JSON.parse(text) as { selections?: Array<{ candidateId: string; explanation?: string }> };
  const allowed = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const selections = (parsed.selections ?? []).filter((item) => allowed.has(item.candidateId));
  if (!selections.length) throw new Error('OpenAI Selection returned no valid optimizer candidate IDs.');
  const limit = Math.min(input.slate.contest.userEntryCount, input.slate.contest.maxEntriesAllowed ?? input.slate.contest.userEntryCount);
  const selectedLineups = selections.slice(0, limit).map((item, index) => {
    const candidate = allowed.get(item.candidateId)!;
    const watchItems = (input.research.watchItems ?? []).filter((watchItem) => watchItem.importance === 'CRITICAL' && (!watchItem.subjectId || candidate.playerIds.includes(watchItem.subjectId))).map((watchItem) => watchItem.reason);
    return { candidateId: candidate.id, bulletNumber: index + 1, selectionType: candidate.candidateTypes[0] ?? 'OPENAI_SELECTED', explanation: item.explanation?.trim() || `Selected from the optimizer candidate set by the Selection Agent using contest context.`, newsContext: input.research.findings.filter((finding) => candidate.playerIds.includes(finding.subjectId) && finding.bucket === 'NEWS_EXTERNAL_CONTEXT').slice(0, 2).map((finding) => `${finding.sourceName}: ${finding.finding}`), rationale: [`Median ${candidate.median.toFixed(1)} with a ${candidate.ceiling.toFixed(1)} ceiling.`, `Optimizer profile: ${candidate.candidateTypes.join(', ') || 'ranked candidate'}.`], playerIds: candidate.playerIds, rosterSlots: candidate.rosterSlots, salaryUsed: candidate.salaryUsed, salaryRemaining: candidate.salaryRemaining, median: candidate.median, ceiling: candidate.ceiling, watchItems, readinessStatus: (watchItems.length ? 'READY_WITH_WATCH' : 'READY') as 'READY' | 'READY_WITH_WATCH' };
  });
  return selectedLineups.length ? { ...input.selection, selectedLineups, warnings: selectedLineups.length < limit ? [`OpenAI Selection returned ${selectedLineups.length} of ${limit} requested lineup(s).`] : [] } : input.selection;
}
function extractOutputText(output: unknown): string | undefined { if (!Array.isArray(output)) return undefined; const parts = output.flatMap((item) => item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []); return parts.map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, unknown>).text : '').join('') || undefined; }
