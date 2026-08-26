import type { ResearchPlan, ResearchSourceProvider, ResearchFinding, ResearchPackage, ValidatedSlate } from './contracts.js';
import type { ResearchSynthesizerInput } from './openAiTypes.js';
import { createResearchPlan } from './researchPlan.js';
import { explainArticleRejection, filterArticlesForSlate, findConflicts, findingsFromAvailability, linkConflicts, normalizeArticles } from './researchEvidence.js';

export interface ResearchAgentOptions { providers: ResearchSourceProvider[]; synthesizer?: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> }; now?: () => Date; version?: number; }
export interface ResearchAgentInput { validatedSlate: ValidatedSlate; researchGaps?: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }>; }

export class ResearchAgent {
  private readonly now: () => Date;
  private readonly version: number;
  private readonly options: ResearchAgentOptions;
  constructor(options: ResearchAgentOptions) { this.options = options; this.now = options.now ?? (() => new Date()); this.version = options.version ?? 1; }

  async run(input: ResearchAgentInput): Promise<ResearchPackage> {
    const now = this.now();
    const plan = createResearchPlan(input.validatedSlate, now, input.researchGaps ?? []);
    if (!this.options.providers.length) return blockedPackage(input.validatedSlate, plan, now, 'No research source providers are configured.');
    const articles = [] as Awaited<ReturnType<ResearchSourceProvider['fetch']>>;
    const providerResults: NonNullable<ResearchPackage['providerResults']> = [];
    const unknowns: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }> = [];
    for (const provider of this.options.providers) {
      try {
        const fetched = await provider.fetch({ slate: input.validatedSlate, plan });
        articles.push(...fetched);
        const accepted = filterArticlesForSlate(fetched, input.validatedSlate); const rejected = fetched.filter((article) => !accepted.includes(article));
        providerResults.push({ provider: provider.name, tier: provider.tier, status: fetched.length ? 'SUCCEEDED' : 'EMPTY', articleCount: fetched.length, acceptedArticleCount: accepted.length, rejectedArticleCount: rejected.length, rejectionSamples: [...new Set(rejected.map((article) => explainArticleRejection(article, input.validatedSlate)))].filter(Boolean).slice(0, 3) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Provider failed.';
        providerResults.push({ provider: provider.name, tier: provider.tier, status: 'FAILED', articleCount: 0, error: reason });
        // Providers are optional enrichments. Keep each exact failure in
        // providerResults for diagnostics, but do not make the research
        // contract incomplete when other evidence or synthesis succeeded.
      }
    }
    const slateArticles = filterArticlesForSlate(articles, input.validatedSlate);
    // Availability data already fetched onto the slate (e.g. SportsDataIO's confirmed-lineup
    // feed, applied before Research runs) is seeded in first so the per-player gap check below
    // sees it as real evidence, instead of reporting a gap for a player we've already confirmed.
    let findings: ResearchFinding[] = [...findingsFromAvailability(input.validatedSlate), ...normalizeArticles(slateArticles, input.validatedSlate, now)];
    if (this.options.synthesizer) {
      try {
        const synthesized = await this.options.synthesizer.synthesize({ slate: input.validatedSlate, plan, articles: slateArticles });
        findings = [...findings, ...synthesized];
        providerResults.push({ provider: 'OpenAI Research Synthesis', status: synthesized.length ? 'SUCCEEDED' : 'EMPTY', articleCount: synthesized.length, acceptedArticleCount: synthesized.length, rejectedArticleCount: 0 });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Research synthesizer failed.';
        providerResults.push({ provider: 'OpenAI Research Synthesis', status: 'FAILED', articleCount: 0, error: reason });
        unknowns.push({ question: 'Synthesize research with OpenAI.', importance: 'MEDIUM', reason });
      }
    }
    if (!findings.length) unknowns.push({ question: `Retrieve evidence for the ${input.validatedSlate.sport} slate.`, importance: 'HIGH', reason: 'No research evidence matched the selected slate; downstream decisions must treat the research layer as incomplete.' });
    // Only re-raise a prior gap if it is still unresolved after this pass — a gap tied to a
    // specific player is resolved once that player has an AVAILABILITY finding; an untargeted
    // gap is resolved once any new evidence exists.
    for (const gap of input.researchGaps ?? []) {
      const stillUnresolved = gap.subjectId
        ? !findings.some((finding) => finding.subjectId === gap.subjectId && finding.bucket === 'AVAILABILITY')
        : !findings.length;
      if (stillUnresolved) unknowns.push(gap);
    }
    const availabilityGaps = input.validatedSlate.playerPool
      .filter((player) => !findings.some((finding) => finding.subjectId === player.playerId && finding.bucket === 'AVAILABILITY'))
      .map((player) => ({ question: `Is ${player.playerName} available with an unrestricted role for this slate?`, importance: 'CRITICAL' as const, reason: `No AVAILABILITY-bucket evidence was retrieved for ${player.playerName}.`, subjectId: player.playerId }));
    unknowns.push(...availabilityGaps);
    const conflicts = findConflicts(findings);
    const linked = linkConflicts(findings, conflicts);
    // A provider outage is retained in providerResults for diagnostics, but it is
    // not itself a research contract failure when the agent has usable findings
    // and no unresolved research questions. Optional providers (for example odds
    // feeds) must not downgrade an otherwise complete research package.
    const status = unknowns.length || conflicts.some((conflict) => !conflict.resolved) ? 'PARTIAL' : 'COMPLETE';
    return buildResearchPackage(input.validatedSlate, linked, conflicts, unknowns, providerResults, status, now, this.version);
  }
}

function buildResearchPackage(slate: ValidatedSlate, findings: ResearchFinding[], conflicts: ReturnType<typeof findConflicts>, unknowns: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }>, providerResults: NonNullable<ResearchPackage['providerResults']>, status: 'COMPLETE' | 'PARTIAL', now: Date, version: number): ResearchPackage {
  const availability = slate.playerPool.map((player) => { const evidence = findings.filter((finding) => finding.subjectId === player.playerId && finding.bucket === 'AVAILABILITY'); const text = evidence.map((finding) => finding.finding).join(' ').toLowerCase(); return { playerId: player.playerId, status: /out|inactive|ruled out|scratched/.test(text) ? 'OUT' as const : /questionable|limited|game-time/.test(text) ? 'QUESTIONABLE' as const : evidence.length ? 'AVAILABLE' as const : 'UNKNOWN' as const, evidenceFindingIds: evidence.map((finding) => finding.id) }; });
  const roleFindings = findings.filter((finding) => finding.bucket === 'RECENT_ROLE_FORM');
  const summary = (bucket: string) => { const selected = findings.filter((finding) => finding.bucket === bucket); return { summary: selected.map((finding) => finding.finding).join(' ') || 'No evidence retrieved.', evidenceFindingIds: selected.map((finding) => finding.id) }; };
  return {
    slateId: slate.slateId, tenantId: slate.tenantId, version, generatedAt: now.toISOString(), freshThrough: new Date(Math.min(Date.parse(slate.contest.lockTime), now.getTime() + 180 * 60_000)).toISOString(), findings,
    availability, recentRoleForm: slate.playerPool.map((player) => { const evidence = roleFindings.filter((finding) => finding.subjectId === player.playerId); return { playerId: player.playerId, summary: evidence.map((finding) => finding.finding).join(' ') || 'No role/form evidence retrieved.', evidenceFindingIds: evidence.map((finding) => finding.id) }; }),
    matchupEnvironment: summary('MATCHUP_ENVIRONMENT'), marketSignals: summary('MARKET_SIGNALS'), newsExternalContext: findings.filter((finding) => finding.bucket === 'NEWS_EXTERNAL_CONTEXT'), fieldSentiment: findings.filter((finding) => finding.bucket === 'FIELD_SENTIMENT').map((finding) => ({ subjectId: finding.subjectId, summary: finding.finding, evidenceFindingIds: [finding.id] })), competitiveContext: [{ summary: findings.filter((finding) => finding.bucket === 'COMPETITIVE_CONTEXT').map((finding) => finding.finding).join(' ') || 'No competitive context evidence retrieved.', evidenceFindingIds: findings.filter((finding) => finding.bucket === 'COMPETITIVE_CONTEXT').map((finding) => finding.id) }],
    playerEvidence: slate.playerPool.map((player) => ({ playerId: player.playerId, findingIds: findings.filter((finding) => finding.subjectId === player.playerId).map((finding) => finding.id), unresolved: false })), conflicts, unknowns, providerResults, watchItems: unknowns.map((unknown) => ({ subjectId: unknown.subjectId, importance: unknown.importance, reason: unknown.reason, expectedChangeBeforeLock: true })), status,
  } as ResearchPackage;
}

function blockedPackage(slate: ValidatedSlate, plan: ResearchPlan, now: Date, reason: string): ResearchPackage {
  const unknowns = [{ question: plan.questions[0]?.question ?? 'Research slate', importance: 'CRITICAL' as const, reason }];
  return { ...buildResearchPackage(slate, [], [], unknowns, [], 'PARTIAL', now, 1), status: 'BLOCKED' };
}
