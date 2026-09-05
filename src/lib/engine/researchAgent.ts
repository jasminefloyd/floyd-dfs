import type { ResearchPlan, ResearchSourceProvider, ResearchFinding, ResearchPackage, ValidatedSlate } from './contracts.js';
import type { ResearchSynthesizerInput } from './openAiTypes.js';
import { createResearchPlan } from './researchPlan.js';
import { explainArticleRejection, filterArticlesForSlate, findConflicts, findingsFromAvailability, linkConflicts, normalizeArticles } from './researchEvidence.js';

export interface ResearchAgentOptions { providers: ResearchSourceProvider[]; synthesizer?: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]>; lastDiagnostics?: Array<{ provider: string; status: 'SUCCEEDED' | 'FAILED'; error?: string }> }; now?: () => Date; version?: number; }
export interface ResearchAgentInput { validatedSlate: ValidatedSlate; researchGaps?: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }>; }

const PROVIDER_TIMEOUT_MS = 8_000;
const SYNTHESIS_TIMEOUT_MS = 25_000;

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
    // Providers are independent enrichments. Fetch them concurrently and give each one a
    // bounded lifetime so one slow RSS/API source cannot strand the whole serverless run
    // before RESEARCH is persisted. The exact timeout is retained in providerResults.
    const providerPasses = await Promise.all(this.options.providers.map(async (provider) => {
      try {
        const fetched = await withTimeout(
          (signal) => provider.fetch({ slate: input.validatedSlate, plan, signal }),
          PROVIDER_TIMEOUT_MS,
        );
        const accepted = filterArticlesForSlate(fetched, input.validatedSlate); const rejected = fetched.filter((article) => !accepted.includes(article));
        return { fetched, result: { provider: provider.name, tier: provider.tier, status: fetched.length ? 'SUCCEEDED' as const : 'EMPTY' as const, articleCount: fetched.length, acceptedArticleCount: accepted.length, rejectedArticleCount: rejected.length, rejectionSamples: [...new Set(rejected.map((article) => explainArticleRejection(article, input.validatedSlate)))].filter(Boolean).slice(0, 3) } };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Provider failed.';
        return { fetched: [], result: { provider: provider.name, tier: provider.tier, status: 'FAILED' as const, articleCount: 0, error: reason } };
      }
    }));
    for (const pass of providerPasses) { articles.push(...pass.fetched); providerResults.push(pass.result); }
    const slateArticles = filterArticlesForSlate(articles, input.validatedSlate);
    // Availability data already fetched onto the slate (e.g. SportsDataIO's confirmed-lineup
    // feed, applied before Research runs) is seeded in first so the per-player gap check below
    // sees it as real evidence, instead of reporting a gap for a player we've already confirmed.
    let findings: ResearchFinding[] = [...findingsFromAvailability(input.validatedSlate), ...normalizeArticles(slateArticles, input.validatedSlate, now)];
    if (this.options.synthesizer) {
      try {
        const synthesized = await withTimeout(
          (signal) => this.options.synthesizer!.synthesize({ slate: input.validatedSlate, plan, articles: slateArticles, signal }),
          SYNTHESIS_TIMEOUT_MS,
        );
        findings = [...findings, ...synthesized];
        const diagnostics = this.options.synthesizer?.lastDiagnostics;
        if (diagnostics?.length) {
          for (const attempt of diagnostics) providerResults.push({ provider: attempt.provider, status: attempt.status, articleCount: attempt.status === 'SUCCEEDED' ? synthesized.length : 0, acceptedArticleCount: attempt.status === 'SUCCEEDED' ? synthesized.length : 0, rejectedArticleCount: 0, error: attempt.error, attempted: true, fallbackUsed: attempt.provider.includes('Anthropic') });
        } else providerResults.push({ provider: 'Research Synthesis', status: synthesized.length ? 'SUCCEEDED' : 'EMPTY', articleCount: synthesized.length, acceptedArticleCount: synthesized.length, rejectedArticleCount: 0, attempted: true });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Research synthesizer failed.';
        const diagnostics = this.options.synthesizer?.lastDiagnostics;
        if (diagnostics?.length) for (const attempt of diagnostics) providerResults.push({ provider: attempt.provider, status: 'FAILED', articleCount: 0, error: attempt.error ?? reason, attempted: true, fallbackUsed: attempt.provider.includes('Anthropic') });
        else providerResults.push({ provider: 'Research Synthesis', status: 'FAILED', articleCount: 0, error: reason, attempted: true });
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
    const uniqueUnknowns = [...new Map(unknowns.map((unknown) => [`${unknown.subjectId ?? ''}:${unknown.question}:${unknown.importance}`, unknown])).values()];
    // A provider outage is retained in providerResults for diagnostics, but it is
    // not itself a research contract failure when the agent has usable findings
    // and no unresolved research questions. Optional providers (for example odds
    // feeds) must not downgrade an otherwise complete research package.
    const status = uniqueUnknowns.length || conflicts.some((conflict) => !conflict.resolved) ? 'PARTIAL' : 'COMPLETE';
    return buildResearchPackage(input.validatedSlate, linked, conflicts, uniqueUnknowns, providerResults, status, now, this.version);
  }
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Research request timed out after ${timeoutMs / 1000} seconds.`)), timeoutMs);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); }
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
