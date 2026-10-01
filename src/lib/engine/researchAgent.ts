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
    const providerResults: NonNullable<ResearchPackage['providerResults']> = [...(input.validatedSlate.providerDiagnostics ?? []).map((diagnostic) => ({ ...diagnostic, articleCount: 0, attempted: true }))];
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
        const diagnosticArticles = fetched.filter((article) => article.diagnostic);
        const contentArticles = fetched.filter((article) => !article.diagnostic);
        const accepted = filterArticlesForSlate(contentArticles, input.validatedSlate); const rejected = contentArticles.filter((article) => !accepted.includes(article));
        const failed = diagnosticArticles.find((article) => article.diagnostic?.status === 'FAILED');
        return { fetched: contentArticles, result: { provider: provider.name, tier: provider.tier, status: failed ? 'FAILED' as const : contentArticles.length ? 'SUCCEEDED' as const : 'EMPTY' as const, articleCount: contentArticles.length, acceptedArticleCount: accepted.length, rejectedArticleCount: rejected.length, rejectionSamples: [...new Set(rejected.map((article) => explainArticleRejection(article, input.validatedSlate)))].filter(Boolean).slice(0, 3), error: failed?.diagnostic?.error } };
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
        // Synthesis is an optional enrichment. Its outage is already recorded in
        // providerResults and must not create a contract-level unknown when direct
        // source findings are available. If no findings exist, the HIGH no-evidence
        // gate below still marks the research package incomplete.
      }
    }
    if (!findings.length) unknowns.push({ question: `Retrieve evidence for the ${input.validatedSlate.sport} slate.`, importance: 'HIGH', reason: 'No research evidence matched the selected slate; downstream decisions must treat the research layer as incomplete.' });
    // Only re-raise a prior gap if it is still unresolved after this pass — a gap tied to a
    // specific player is resolved once that player has an AVAILABILITY finding; an untargeted
    // gap is resolved once any new evidence exists.
    const activePlayerIds = new Set(input.validatedSlate.playerPool.map((player) => player.playerId));
    for (const gap of input.researchGaps ?? []) {
      // A targeted follow-up can run after availability reconciliation removes
      // explicit OUT/non-roster players. Their earlier unresolved questions no
      // longer apply to the active slate and must not be reintroduced.
      if (gap.subjectId && !activePlayerIds.has(gap.subjectId)) continue;
      const stillUnresolved = gap.subjectId
        ? !findings.some((finding) => finding.subjectId === gap.subjectId && finding.bucket === 'AVAILABILITY')
        : !findings.length;
      if (stillUnresolved) unknowns.push(gap);
    }
    const availabilityGaps = input.validatedSlate.playerPool
      .filter((player) => !findings.some((finding) => finding.subjectId === player.playerId && finding.bucket === 'AVAILABILITY'))
      .map((player) => ({ question: `Is ${player.playerName} available with an unrestricted role for this slate?`, importance: player.availability?.roleStatus === 'NOT_STARTER' ? 'HIGH' as const : 'CRITICAL' as const, reason: player.availability?.roleStatus === 'NOT_STARTER' ? `No direct availability evidence was retrieved for ${player.playerName}; the player is not listed as a current starter, so starter confirmation is not required but availability remains unresolved.` : `No AVAILABILITY-bucket evidence was retrieved for ${player.playerName}.`, subjectId: player.playerId }));
    unknowns.push(...availabilityGaps);
    const conflicts = findConflicts(findings);
    const linked = linkConflicts(findings, conflicts);
    const uniqueUnknowns = [...new Map(unknowns.map((unknown) => [`${unknown.subjectId ?? ''}:${unknown.question}:${unknown.importance}`, unknown])).values()];
    // A provider outage is retained in providerResults for diagnostics, but it is
    // not itself a research contract failure when the agent has usable findings
    // and no unresolved research questions. Optional providers (for example odds
    // feeds) must not downgrade an otherwise complete research package.
    const blockingUnknowns = uniqueUnknowns.some((unknown) => unknown.importance === 'CRITICAL' || unknown.importance === 'HIGH');
    const status = blockingUnknowns || conflicts.some((conflict) => !conflict.resolved) ? 'PARTIAL' : 'COMPLETE';
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
  const lockTime = Date.parse(slate.contest.lockTime);
  const expiringFindings = findings.map((finding) => {
    const ttlMinutes: Record<ResearchFinding['bucket'], number> = { AVAILABILITY: 60, RECENT_ROLE_FORM: 12 * 60, MATCHUP_ENVIRONMENT: 6 * 60, MARKET_SIGNALS: 3 * 60, NEWS_EXTERNAL_CONTEXT: 12 * 60, FIELD_SENTIMENT: 24 * 60, COMPETITIVE_CONTEXT: 7 * 24 * 60 };
    // Publication time governs news/role claims; direct structured observations use
    // retrieval time. Undated evidence is due for immediate refresh, never three hours.
    const directObservation = /directly fetched/i.test(finding.sourcePurpose ?? '');
    const timestamp = finding.publishedAt ?? (directObservation ? finding.retrievedAt : undefined);
    const observedAt = timestamp ? Date.parse(timestamp) : now.getTime();
    const expiresAt = Number.isFinite(observedAt) ? Math.min(lockTime, observedAt + ttlMinutes[finding.bucket] * 60_000) : now.getTime();
    return { ...finding, expiresAt: new Date(expiresAt).toISOString() };
  });
  const expires = expiringFindings.map((finding) => Date.parse(finding.expiresAt!)).filter((expiresAt) => expiresAt > now.getTime());
  const freshThrough = expires.length ? Math.min(lockTime, ...expires) : Math.min(lockTime, now.getTime());
  const expiredCount = expiringFindings.filter((finding) => Date.parse(finding.expiresAt!) <= now.getTime()).length;
  const freshnessUnknowns: Array<{ question: string; importance: 'MEDIUM'; reason: string; subjectId?: string }> = expiredCount ? [{ question: 'Refresh expired or undated research evidence.', importance: 'MEDIUM', reason: `${expiredCount} research fact(s) were already expired or undated when this package was assembled; they are retained for audit but cannot support adjustments.` }] : [];
  const availability = slate.playerPool.map((player) => { const evidence = findings.filter((finding) => finding.subjectId === player.playerId && finding.bucket === 'AVAILABILITY'); const text = evidence.map((finding) => finding.finding).join(' ').toLowerCase(); return { playerId: player.playerId, status: /out|inactive|ruled out|scratched/.test(text) ? 'OUT' as const : /questionable|limited|game-time/.test(text) ? 'QUESTIONABLE' as const : /starter role remains unconfirmed|starting role was not confirmed/.test(text) ? 'UNKNOWN' as const : evidence.length ? 'AVAILABLE' as const : 'UNKNOWN' as const, evidenceFindingIds: evidence.map((finding) => finding.id) }; });
  const roleFindings = findings.filter((finding) => finding.bucket === 'RECENT_ROLE_FORM');
  const summary = (bucket: string) => { const selected = findings.filter((finding) => finding.bucket === bucket); return { summary: selected.map((finding) => finding.finding).join(' ') || 'No evidence retrieved.', evidenceFindingIds: selected.map((finding) => finding.id) }; };
  return {
    slateId: slate.slateId, tenantId: slate.tenantId, version, generatedAt: now.toISOString(), freshThrough: new Date(freshThrough).toISOString(), findings: expiringFindings,
    availability, recentRoleForm: slate.playerPool.map((player) => { const evidence = roleFindings.filter((finding) => finding.subjectId === player.playerId); return { playerId: player.playerId, summary: evidence.map((finding) => finding.finding).join(' ') || 'No role/form evidence retrieved.', evidenceFindingIds: evidence.map((finding) => finding.id) }; }),
    matchupEnvironment: summary('MATCHUP_ENVIRONMENT'), marketSignals: summary('MARKET_SIGNALS'), newsExternalContext: findings.filter((finding) => finding.bucket === 'NEWS_EXTERNAL_CONTEXT'), fieldSentiment: findings.filter((finding) => finding.bucket === 'FIELD_SENTIMENT').map((finding) => ({ subjectId: finding.subjectId, summary: finding.finding, evidenceFindingIds: [finding.id] })), competitiveContext: [{ summary: findings.filter((finding) => finding.bucket === 'COMPETITIVE_CONTEXT').map((finding) => finding.finding).join(' ') || 'No competitive context evidence retrieved.', evidenceFindingIds: findings.filter((finding) => finding.bucket === 'COMPETITIVE_CONTEXT').map((finding) => finding.id) }],
    playerEvidence: slate.playerPool.map((player) => ({ playerId: player.playerId, findingIds: findings.filter((finding) => finding.subjectId === player.playerId).map((finding) => finding.id), unresolved: false })), conflicts, unknowns: [...unknowns, ...freshnessUnknowns], providerResults, watchItems: [...unknowns, ...freshnessUnknowns].map((unknown) => ({ subjectId: unknown.subjectId, importance: unknown.importance, reason: unknown.reason, expectedChangeBeforeLock: true })), status,
  } as ResearchPackage;
}

function blockedPackage(slate: ValidatedSlate, plan: ResearchPlan, now: Date, reason: string): ResearchPackage {
  const unknowns = [{ question: plan.questions[0]?.question ?? 'Research slate', importance: 'CRITICAL' as const, reason }];
  return { ...buildResearchPackage(slate, [], [], unknowns, [], 'PARTIAL', now, 1), status: 'BLOCKED' };
}
