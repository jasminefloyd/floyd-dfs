import type { AdjustmentPackage, LineupCandidate, ResearchPackage, SelectedLineup, SelectionPackage, ValidatedSlate } from './contracts.js';
import { netOpportunityDirectionFrom, netSignedMagnitude } from './adjustment.js';
import { overlap, resolveCashLineProbability } from './selection.js';
import { providerHttpError } from './providerDiagnostics.js';
import type { CashLineCalibration } from './cashLineCalibration.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

async function anthropicJson(prompt: string, apiKey: string, model?: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const response = await fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? DEFAULT_MODEL, max_tokens: 4096, system: 'Return only valid JSON. Never invent facts or IDs. Use only the supplied data.', messages: [{ role: 'user', content: prompt }] }) });
  if (!response.ok) throw await providerHttpError('Anthropic Stage Fallback', response);
  const payload = await response.json() as Record<string, unknown>;
  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content.map((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string' ? (item as Record<string, unknown>).text : '').join('').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!text) throw new Error('Anthropic Stage Fallback returned no structured output.');
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch (error) {
    // Claude can prepend a short explanation despite the JSON-only instruction.
    // Recover only a complete top-level object; never invent or repair fields.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; }
      catch { /* preserve the original parse failure below */ }
    }
    throw error;
  }
}

export async function adjustWithAnthropic(input: { slate: ValidatedSlate; research: ResearchPackage; baseline: AdjustmentPackage }, options: { apiKey: string; model?: string; fetcher?: typeof fetch } ): Promise<AdjustmentPackage> {
  const payload = await anthropicJson(`You are the ${input.slate.sport} Sport Adjustment Specialist. Return only evidence-grounded opportunity adjustments. Valid player IDs: ${JSON.stringify(input.baseline.adjustments.map((item) => item.playerId))}. Valid finding IDs: ${JSON.stringify(input.research.findings.map((item) => item.id))}. Return {"adjustments":[{"playerId":"...","direction":"UP|DOWN|NEUTRAL","magnitude":"NONE|SMALL|MODERATE|MATERIAL|MAJOR","rationale":"...","evidenceFindingIds":["..."],"confidence":"LOW|MEDIUM|HIGH"}]}. Findings: ${JSON.stringify(input.research.findings)}`, options.apiKey, options.model, options.fetcher);
  const findingIds = new Set(input.research.findings.map((finding) => finding.id));
  const items = Array.isArray(payload.adjustments) ? payload.adjustments : [];
  const byPlayer = new Map(input.baseline.adjustments.map((item) => [item.playerId, item]));
  for (const value of items) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const current = byPlayer.get(String(item.playerId));
    const evidence = Array.isArray(item.evidenceFindingIds) ? item.evidenceFindingIds.map(String).filter((id) => findingIds.has(id)) : [];
    if (!current || !evidence.length) continue;
    const direction = ['UP', 'DOWN', 'NEUTRAL'].includes(String(item.direction)) ? String(item.direction) as 'UP' | 'DOWN' | 'NEUTRAL' : 'NEUTRAL';
    const magnitude = ['NONE', 'SMALL', 'MODERATE', 'MATERIAL', 'MAJOR'].includes(String(item.magnitude)) ? String(item.magnitude) as 'NONE' | 'SMALL' | 'MODERATE' | 'MATERIAL' | 'MAJOR' : 'NONE';
    const confidence = ['LOW', 'MEDIUM', 'HIGH'].includes(String(item.confidence)) ? String(item.confidence) as 'LOW' | 'MEDIUM' | 'HIGH' : 'MEDIUM';
    const merged = [...current.adjustments, { adjustmentType: 'AI_SPECIALIST', direction, magnitude, rationale: String(item.rationale ?? ''), evidenceFindingIds: evidence, confidence }];
    byPlayer.set(current.playerId, { ...current, adjustments: merged, netOpportunityDirection: netOpportunityDirectionFrom(merged), netSignedMagnitude: netSignedMagnitude(merged), roleCertainty: String(item.confidence ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH', keyDeltas: [...current.keyDeltas, String(item.rationale ?? '')], projectionNotes: [...current.projectionNotes, 'Anthropic sport specialist adjustment grounded in validated Research findings.'] });
  }
  return { ...input.baseline, adjustments: [...byPlayer.values()] };
}

export async function selectWithAnthropic(input: { slate: ValidatedSlate; research: ResearchPackage; candidates: LineupCandidate[]; selection: SelectionPackage; cashLineCalibration?: CashLineCalibration; apiKey: string; model?: string; fetcher?: typeof fetch }): Promise<SelectionPackage> {
  const limit = Math.min(input.slate.contest.userEntryCount, input.slate.contest.maxEntriesAllowed ?? input.slate.contest.userEntryCount);
  const payload = await anthropicJson(`Choose up to ${limit} existing optimizer candidate IDs for this DraftKings contest. Never create or modify a lineup. Return {"selections":[{"candidateId":"...","explanation":"..."}]}. Candidates: ${JSON.stringify(input.candidates.map((candidate) => ({ id: candidate.id, playerIds: candidate.playerIds, median: candidate.median, ceiling: candidate.ceiling, salaryUsed: candidate.salaryUsed })))}`, input.apiKey, input.model, input.fetcher);
  const allowed = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const selections = Array.isArray(payload.selections) ? payload.selections : [];
  const chosen = selections.map((value) => value && typeof value === 'object' ? value as Record<string, unknown> : undefined).filter((value): value is Record<string, unknown> => Boolean(value && allowed.has(String(value.candidateId)))).slice(0, limit);
  if (!chosen.length) throw new Error('Anthropic Selection returned no valid optimizer candidate IDs.');
  const selectedIds = chosen.map((value) => String(value.candidateId));
  const lineups: SelectedLineup[] = chosen.map((value, index) => {
    const candidate = allowed.get(String(value.candidateId))!;
    const similarity = selectedIds.filter((id) => id !== candidate.id).map((id) => overlap(candidate.playerIds, allowed.get(id)!.playerIds)).reduce((max, value) => Math.max(max, value), 0);
    const cashLine = resolveCashLineProbability(candidate, input.cashLineCalibration);
    return { candidateId: candidate.id, bulletNumber: index + 1, selectionType: candidate.candidateTypes[0] ?? 'ANTHROPIC_SELECTED', explanation: String(value.explanation ?? 'Selected by Anthropic from the optimizer candidate set.'), newsContext: input.research.findings.filter((finding) => candidate.playerIds.includes(finding.subjectId) && finding.bucket === 'NEWS_EXTERNAL_CONTEXT').slice(0, 2).map((finding) => `${finding.sourceName}: ${finding.finding}`), rationale: [`Median ${candidate.median.toFixed(1)} with a ${candidate.ceiling.toFixed(1)} ceiling.`, 'Selected by Anthropic from the deterministic optimizer candidates.', ...(similarity >= 0.8 ? ['This lineup closely overlaps with another selected lineup.'] : [])], playerIds: candidate.playerIds, rosterSlots: candidate.rosterSlots, salaryUsed: candidate.salaryUsed, salaryRemaining: candidate.salaryRemaining, floor: candidate.floor, median: candidate.median, ceiling: candidate.ceiling, watchItems: (input.research.watchItems ?? []).filter((item) => item.importance === 'CRITICAL' && (!item.subjectId || candidate.playerIds.includes(item.subjectId))).map((item) => item.reason), readinessStatus: 'READY_WITH_WATCH', cashLineProbability: cashLine.probability, cashLineConfidence: cashLine.confidence };
  });
  return { ...input.selection, selectedLineups: lineups, warnings: [...input.selection.warnings, 'Anthropic fallback selected the final lineups after the OpenAI Selection request failed.'] };
}
