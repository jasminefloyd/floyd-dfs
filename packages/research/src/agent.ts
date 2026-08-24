import { createHash } from "node:crypto";
import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchPackage, ResearchAgentInput, ResearchAgentOptions, ResearchPlan, ResearchUnknown, ResearchConflict, ValidatedSlate } from "@sports-engine/contracts";
import { createResearchPlan } from "./planner";

export class ResearchAgent {
  private readonly now: () => Date;
  private readonly version: number;
  constructor(private readonly options: ResearchAgentOptions) {
    this.now = options.now ?? (() => new Date());
    this.version = options.version ?? 1;
  }

  async run(input: ResearchAgentInput): Promise<ResearchPackage> {
    const now = this.now();
    const plan = createResearchPlan(input.validatedSlate, now);
    if (!this.options.providers.length) return blockedPackage(input.validatedSlate, plan, now, "No research source providers are configured.");

    const articles: ResearchArticle[] = [];
    const unknowns: ResearchUnknown[] = [];
    for (const provider of this.options.providers) {
      try { articles.push(...await provider.fetch({ slate: input.validatedSlate, plan })); }
      catch (error) { unknowns.push({ question: `Retrieve research from ${provider.name}.`, importance: "HIGH", reason: error instanceof Error ? error.message : "Provider failed." }); }
    }
    for (const gap of input.researchGaps ?? []) unknowns.push({ question: gap.question, importance: gap.importance, reason: gap.reason });

    const slateArticles = filterArticlesForSlate(articles, input.validatedSlate);
    let findings = normalizeArticles(slateArticles, input.validatedSlate, now);
    if (this.options.synthesizer) {
      try { findings = [...findings, ...await this.options.synthesizer.synthesize({ slate: input.validatedSlate, plan, articles: slateArticles })]; }
      catch (error) { unknowns.push({ question: `Synthesize research with ${this.options.synthesizer.name}.`, importance: "MEDIUM", reason: error instanceof Error ? error.message : "Research synthesizer failed." }); }
    }
    if (!findings.length) unknowns.push({ question: `Retrieve evidence for the ${input.validatedSlate.sport} slate.`, importance: "HIGH", reason: "No research evidence matched the selected slate; downstream decisions must treat the research layer as incomplete." });
    const conflicts = findConflicts(findings);
    const linked = linkConflicts(findings, conflicts);
    const playerEvidence = input.validatedSlate.playerPool.map((player) => ({ playerId: player.playerId, findingIds: linked.filter((finding) => finding.subjectId === player.playerId).map((finding) => finding.id), unresolved: false }));
    const availability = input.validatedSlate.playerPool.map((player) => {
      const evidence = linked.filter((finding) => finding.subjectId === player.playerId && finding.bucket === "AVAILABILITY");
      const text = evidence.map((finding) => finding.finding).join(" ").toLowerCase();
      return { playerId: player.playerId, status: /out|inactive|ruled out|scratched/.test(text) ? "OUT" as const : /questionable|limited|game-time/.test(text) ? "QUESTIONABLE" as const : evidence.length ? "AVAILABLE" as const : "UNKNOWN" as const, evidenceFindingIds: evidence.map((finding) => finding.id) };
    });
    const roleFindings = linked.filter((finding) => finding.bucket === "RECENT_ROLE_FORM");
    const fieldFindings = linked.filter((finding) => finding.bucket === "FIELD_SENTIMENT");
    const competitiveFindings = linked.filter((finding) => finding.bucket === "COMPETITIVE_CONTEXT");
    const freshThrough = new Date(Math.min(Date.parse(input.validatedSlate.contest.lockTime), now.getTime() + 180 * 60_000)).toISOString();
    const status = unknowns.length || conflicts.some((conflict) => !conflict.resolved) ? "PARTIAL" : "COMPLETE";
    return {
      slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, version: this.version,
      generatedAt: now.toISOString(), freshThrough, findings: linked,
      availability, recentRoleForm: input.validatedSlate.playerPool.map((player) => { const evidence = roleFindings.filter((finding) => finding.subjectId === player.playerId); return { playerId: player.playerId, summary: evidence.map((finding) => finding.finding).join(" ") || "No role/form evidence retrieved.", evidenceFindingIds: evidence.map((finding) => finding.id) }; }), matchupEnvironment: summaryFor(linked, "MATCHUP_ENVIRONMENT"),
      marketSignals: summaryFor(linked, "MARKET_SIGNALS"),
      newsExternalContext: linked.filter((finding) => finding.bucket === "NEWS_EXTERNAL_CONTEXT"), fieldSentiment: fieldFindings.map((finding) => ({ subjectId: finding.subjectId, summary: finding.finding, evidenceFindingIds: [finding.id] })), competitiveContext: [{ summary: competitiveFindings.map((finding) => finding.finding).join(" ") || "No competitive context evidence retrieved.", evidenceFindingIds: competitiveFindings.map((finding) => finding.id) }],
      playerEvidence, conflicts, unknowns, watchItems: unknowns.map((unknown) => ({ reason: unknown.reason, expectedChangeBeforeLock: true })), status,
    };
  }
}

function filterArticlesForSlate(articles: ResearchArticle[], slate: ValidatedSlate): ResearchArticle[] {
  const target = slate.sport.toUpperCase();
  const foreignSports = ["NBA", "WNBA", "NFL", "MLB", "GOLF"].filter((sport) => sport !== target);
  // Do not use the sport/league name itself as a relevance match. A general
  // sports article mentioning MLB and another league is not evidence for
  // this slate. Relevance must come from the exact event, team, or player.
  const targetTerms = [...slate.event.participants, ...slate.playerPool.flatMap((player) => [player.playerName, player.team ?? "", player.opponent ?? ""])]
    .map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 3);
  return articles.filter((article) => {
    const text = `${article.title} ${article.summary ?? ""} ${article.sourceName} ${(article.tags ?? []).join(" ")}`.toUpperCase();
    const taggedSports = (article.tags ?? []).map((tag) => tag.toUpperCase()).filter((tag) => ["NBA", "WNBA", "NFL", "MLB", "GOLF"].includes(tag));
    const hasTargetTerm = targetTerms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text));
    if (taggedSports.length) return taggedSports.length === 1 && taggedSports.includes(target) && hasTargetTerm;
    const hasForeignSport = foreignSports.some((sport) => new RegExp(`\\b${sport}\\b`, "i").test(text));
    // League-only and unrelated general-sports articles are not evidence for
    // the selected slate. Items must identify a participant or matchup.
    return !hasForeignSport && hasTargetTerm;
  });
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function normalizeArticles(articles: ResearchArticle[], slate: ValidatedSlate, now: Date): ResearchFinding[] {
  return articles.map((article, index) => {
    const text = `${article.title} ${article.summary ?? ""}`.toLowerCase();
    const player = slate.playerPool.find((candidate) => text.includes(candidate.playerName.toLowerCase()));
    const bucket: ResearchBucket = /injur|out|questionable|available|lineup|starting|scratch/.test(text) ? "AVAILABILITY" : /role|minutes|snap|usage|starter|form|recent/.test(text) ? "RECENT_ROLE_FORM" : /odds|line|spread|total|market/.test(text) ? "MARKET_SIGNALS" : /sentiment|chalk|ownership|popular/.test(text) ? "FIELD_SENTIMENT" : /weather|wind|pace|matchup|defense|course|venue/.test(text) ? "MATCHUP_ENVIRONMENT" : /playoff|seed|eliminat|qualif|advanc|rest|standings/.test(text) ? "COMPETITIVE_CONTEXT" : "NEWS_EXTERNAL_CONTEXT";
    const publishedAt = article.publishedAt;
    const ageMinutes = publishedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / 60_000)) : undefined;
    const subjectId = player?.playerId ?? slate.event.eventId;
    return { id: createHash("sha256").update(`${slate.slateId}:${article.url ?? article.title}:${index}`).digest("hex").slice(0, 32), bucket, subjectType: player ? "PLAYER" : "EVENT", subjectId, finding: article.summary || article.title, sourceUrl: article.url, sourceName: article.sourceName, sourceTier: article.sourceTier, sourcePurpose: bucket === "FIELD_SENTIMENT" ? "Field sentiment only; not factual player evidence." : "External context for the exact slate.", publishedAt, retrievedAt: now.toISOString(), ageMinutes, confidence: article.sourceTier <= 2 ? "HIGH" : article.sourceTier === 3 ? "MEDIUM" : "LOW", metadata: { title: article.title, tags: article.tags ?? [] } };
  });
}

function findConflicts(findings: ResearchFinding[]): ResearchConflict[] {
  const conflicts: ResearchConflict[] = [];
  for (const group of groupBy(findings, (finding) => `${finding.subjectId}:${finding.bucket}`)) {
    // Event-level RSS summaries are broad slate context, not a single
    // player claim. Do not turn unrelated event articles into a false
    // contradiction; player/team-specific claims remain conflict-checked.
    if (group[0]?.subjectType === "EVENT") continue;
    const tiers = new Set(group.map((finding) => finding.sourceTier));
    // Multiple tiers are not inherently a conflict. RSS feeds routinely
    // publish several compatible articles about the same event. Only mark
    // evidence unresolved when the claims actually point in opposite
    // directions; otherwise every multi-source slate becomes PARTIAL.
    const contradictory = group.some((left, index) => group.slice(index + 1).some((right) => claimsConflict(left, right)));
    if (group.length > 1 && tiers.size > 1 && contradictory) conflicts.push({ findingIds: group.map((finding) => finding.id), subjectId: group[0].subjectId, summary: "Multiple source tiers reported contradictory evidence for the same subject and bucket; authority, recency, and specificity must remain visible.", resolved: false });
  }
  return conflicts;
}

function claimsConflict(left: ResearchFinding, right: ResearchFinding): boolean {
  if (left.bucket !== right.bucket) return false;
  const leftText = left.finding.toLowerCase();
  const rightText = right.finding.toLowerCase();
  if (left.bucket === "AVAILABILITY") {
    const unavailable = (text: string) => /\bout\b|inactive|ruled out|scratched|questionable|limited/.test(text);
    const available = (text: string) => /available|active|starting|starter/.test(text) && !unavailable(text);
    return (unavailable(leftText) && available(rightText)) || (available(leftText) && unavailable(rightText));
  }
  const positive = /increased|starting|starter|more minutes|more routes|top of the order|favorable|boost/.test(leftText) !== /increased|starting|starter|more minutes|more routes|top of the order|favorable|boost/.test(rightText);
  const negative = /out|inactive|reduced|limited|fewer|bottom of the order|unfavorable|downgrade/.test(leftText) !== /out|inactive|reduced|limited|fewer|bottom of the order|unfavorable|downgrade/.test(rightText);
  return positive && negative;
}

function linkConflicts(findings: ResearchFinding[], conflicts: ResearchConflict[]): ResearchFinding[] {
  return findings.map((finding) => { const conflict = conflicts.find((item) => item.findingIds.includes(finding.id)); return conflict ? { ...finding, conflictingFindingIds: conflict.findingIds.filter((id) => id !== finding.id) } : finding; });
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] { const groups = new Map<string, T[]>(); for (const item of items) { const k = key(item); groups.set(k, [...(groups.get(k) ?? []), item]); } return [...groups.values()]; }

function summaryFor(findings: ResearchFinding[], bucket: ResearchBucket): { summary: string; evidenceFindingIds: string[] } { const selected = findings.filter((finding) => finding.bucket === bucket); return { summary: selected.map((finding) => finding.finding).join(" ") || "No evidence retrieved.", evidenceFindingIds: selected.map((finding) => finding.id) }; }

function blockedPackage(slate: ValidatedSlate, plan: ResearchPlan, now: Date, reason: string): ResearchPackage {
  return { slateId: slate.slateId, tenantId: slate.tenantId, version: 1, generatedAt: now.toISOString(), freshThrough: now.toISOString(), findings: [], availability: [], recentRoleForm: [], matchupEnvironment: { summary: "Blocked.", evidenceFindingIds: [] }, marketSignals: { summary: "Blocked.", evidenceFindingIds: [] }, newsExternalContext: [], fieldSentiment: [], competitiveContext: [], playerEvidence: slate.playerPool.map((player) => ({ playerId: player.playerId, findingIds: [], unresolved: true })), conflicts: [], unknowns: [{ question: plan.questions[0]?.question ?? "Research slate", importance: "CRITICAL", reason }], watchItems: [{ reason, expectedChangeBeforeLock: true }], status: "BLOCKED" };
}
