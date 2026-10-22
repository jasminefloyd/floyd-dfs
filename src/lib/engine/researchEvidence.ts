import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchConflict, ResolvedFact, SourceObservation, ValidatedSlate } from './contracts.js';
import { resolveObservations } from './factResolution.js';

export function filterArticlesForSlate(articles: ResearchArticle[], slate: ValidatedSlate): ResearchArticle[] {
  return articles.filter((article) => articleSlateMatch(article, slate).accepted);
}

export function explainArticleRejection(article: ResearchArticle, slate: ValidatedSlate): string {
  const result = articleSlateMatch(article, slate); return result.accepted ? '' : result.reason;
}

function articleSlateMatch(article: ResearchArticle, slate: ValidatedSlate): { accepted: boolean; reason: string } {
  const target = slate.sport.toUpperCase();
  const acceptedSports = target === 'WNBA' ? ['WNBA', 'NBA'] : [target];
  const foreignSports = ['NBA', 'WNBA', 'NFL', 'CFB', 'MLB', 'GOLF'].filter((sport) => !acceptedSports.includes(sport));
  const targetTerms = [...slate.event.participants, ...slate.playerPool.flatMap((player) => [player.playerName, player.team ?? '', player.opponent ?? '', ...teamAliases(player.team), ...teamAliases(player.opponent)])]
    .map((term) => term.trim()).filter((term) => term.length >= 3);
  const text = `${article.title} ${article.summary ?? ''} ${article.content ?? ''} ${article.sourceName} ${(article.tags ?? []).join(' ')}`;
  const taggedSports = (article.tags ?? []).map((tag) => tag.toUpperCase()).filter((tag) => ['NBA', 'WNBA', 'NFL', 'CFB', 'MLB', 'GOLF'].includes(tag));
  if (taggedSports.length && taggedSports.some((sport) => !acceptedSports.includes(sport))) return { accepted: false, reason: `wrong sport tag (${taggedSports.join(', ')})` };
  if (!taggedSports.length && foreignSports.some((sport) => new RegExp(`\\b${escapeRegExp(sport)}\\b`, 'i').test(text))) return { accepted: false, reason: 'foreign sport detected in untagged content' };
  if (!targetTerms.some((term) => termMatchesText(term, text))) return { accepted: false, reason: 'no participant, team, opponent, or player match' };
  return { accepted: true, reason: '' };
}

function termMatchesText(term: string, text: string): boolean {
  if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text)) return true;
  const compactTerm = term.toLowerCase().replace(/[^a-z0-9]/g, ''); const compactText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compactTerm.length >= 4 && compactText.includes(compactTerm);
}

function teamAliases(team: string | undefined): string[] {
  const aliases: Record<string, string[]> = { PDX: ['Portland'], POR: ['Portland'], DAL: ['Dallas'], WAS: ['Washington'], WSH: ['Washington'], PHX: ['Phoenix'], CON: ['Connecticut'], CHI: ['Chicago'] };
  return aliases[String(team ?? '').toUpperCase()] ?? [];
}

export function normalizeArticles(articles: ResearchArticle[], slate: ValidatedSlate, now = new Date()): ResearchFinding[] {
  const normalized = articles.flatMap((article) => {
    const sourceText = [article.summary, article.content].filter(Boolean).join(' ') || article.title;
    const sentences = sourceText.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const contexts = sentences.length ? sentences : [sourceText];
    const publishedAt = article.publishedAt;
    const ageMinutes = publishedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / 60_000)) : undefined;
    return contexts.flatMap((context, sentenceIndex) => {
      const text = context.toLowerCase();
      const nameMatches = slate.playerPool.filter((candidate) => termMatchesText(candidate.playerName, context));
      const duplicateNames = new Set(nameMatches.map((candidate) => candidate.playerName.trim().toLowerCase())).size < nameMatches.length;
      const specificallyScoped = duplicateNames ? nameMatches.filter((candidate) => termMatchesText(String(candidate.team ?? ''), context) || teamAliases(candidate.team).some((alias) => termMatchesText(alias, context))) : nameMatches;
      const subjects = duplicateNames && specificallyScoped.length !== nameMatches.length ? (specificallyScoped.length === 1 ? specificallyScoped : []) : specificallyScoped;
      const keywordBucket: ResearchBucket = /injur|\bout\b|questionable|available|scratched|inactive|ruled out/.test(text) ? 'AVAILABILITY' : /role|minutes|snap|usage|starter|starting|starts|form|recent|routes|batting order/.test(text) ? 'RECENT_ROLE_FORM' : /odds|line|spread|total|market/.test(text) ? 'MARKET_SIGNALS' : /sentiment|chalk|ownership|popular/.test(text) ? 'FIELD_SENTIMENT' : /weather|wind|pace|matchup|defense|course|venue/.test(text) ? 'MATCHUP_ENVIRONMENT' : /playoff|seed|eliminat|qualif|advanc|rest|standings/.test(text) ? 'COMPETITIVE_CONTEXT' : 'NEWS_EXTERNAL_CONTEXT';
      // Tier 4 (Reddit/social/unverified) sources may only ever populate FIELD_SENTIMENT — never a factual bucket.
      const bucket: ResearchBucket = article.sourceTier === 4 ? 'FIELD_SENTIMENT' : keywordBucket;
      const targets = subjects.length ? subjects : [undefined];
      return targets.map((player) => ({
        id: stableId(`${slate.tenantId}:${slate.slateId}:${article.sourceName}:${normalizeSourceUrl(article.url)}:${normalizeClaim(context)}:${player?.playerId ?? 'event'}`),
        bucket,
        subjectType: player ? 'PLAYER' as const : 'EVENT' as const,
        subjectId: player?.playerId ?? slate.event.eventId,
        finding: context,
        sourceUrl: normalizeSourceUrl(article.url) || undefined,
        sourceName: article.sourceName,
        sourceTier: article.sourceTier,
        sourcePurpose: bucket === 'FIELD_SENTIMENT' ? 'Field sentiment only; not factual player evidence.' : 'External context for the exact player/entity sentence.',
        publishedAt,
        retrievedAt: now.toISOString(),
        confidence: article.sourceTier <= 2 ? 'HIGH' as const : article.sourceTier === 3 ? 'MEDIUM' as const : 'LOW' as const,
        metadata: { title: article.title, context, sentenceIndex, tags: article.tags ?? [], ageMinutes, ...(nameMatches.length > 1 && !player ? { identityAmbiguous: true } : {}), canonicalSourceUrl: normalizeSourceUrl(article.url), canonicalClaim: normalizeClaim(context), duplicateClusterId: stableId(`${normalizeSourceUrl(article.url)}:${normalizeClaim(context)}`), canonicalFactKey: `${slate.tenantId}:${slate.slateId}:${player?.playerId ?? slate.event.eventId}:${classifyFactType({ id: '', bucket, subjectType: player ? 'PLAYER' : 'EVENT', subjectId: player?.playerId ?? slate.event.eventId, sourceName: article.sourceName, finding: context, confidence: article.sourceTier <= 2 ? 'HIGH' : 'MEDIUM' }, context.toLowerCase())}`, effectiveAt: inferEffectiveAt(context, now) },
      }));
    });
  });
  return [...new Map(normalized.map((finding) => [finding.id, finding])).values()];
}

/** Normalize only known tracking parameters. Content and provider-significant query values remain intact. */
export function normalizeSourceUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src|source)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return value.trim(); }
}

/** Build the immutable observation and resolution artifacts before adjustment/projection. */
export function resolveResearchEvidence(slate: ValidatedSlate, findings: ResearchFinding[], now = new Date(), freshnessMinutes: { availability?: number; context?: number } = {}): { observations: SourceObservation[]; facts: ResolvedFact[] } {
  const observations = findings.map((finding): SourceObservation => {
    const player = finding.subjectType === 'PLAYER' ? slate.playerPool.find((candidate) => candidate.playerId === finding.subjectId) : undefined;
    const matchingGames = (slate.games ?? []).filter((game) => game.teamIds.includes(finding.subjectId));
    const text = finding.finding.toLowerCase();
    const factType = classifyFactType(finding, text);
    const retrievedAt = validIso(finding.retrievedAt) ?? now.toISOString();
    const publishedAt = validIso(finding.publishedAt);
    const effectiveAt = validIso(finding.metadata?.effectiveAt) ?? inferEffectiveAt(finding.finding, now);
    const ttl = factType === 'availability.status' ? (freshnessMinutes.availability ?? 5) : (freshnessMinutes.context ?? 1440);
    const expiresAt = validIso(finding.expiresAt) ?? new Date(Math.min(Date.parse(retrievedAt) + ttl * 60_000, Date.parse(slate.contest.lockTime) || Infinity)).toISOString();
    const status: SourceObservation['status'] = /directly fetched|confirmed lineup|confirmed starter/i.test(finding.sourcePurpose ?? '') && (finding.confidence === 'HIGH' || /confirmed as a starter|ruled out|inactive/.test(text)) ? 'CONFIRMED' : finding.sourceTier === 1 && finding.confidence === 'HIGH' ? 'PROJECTED' : publishedAt ? 'REPORTED' : 'UNVERIFIED';
    const claim = normalizeClaim(finding.finding);
    const value = extractFactValue(factType, finding.finding);
    return {
      id: stableId(`${slate.tenantId}:${slate.slateId}:${finding.id}:${retrievedAt}`), tenantId: slate.tenantId, slateId: slate.slateId, sport: slate.sport,
      eventId: slate.event.eventId, gameId: player?.gameId ?? (finding.subjectType === 'EVENT' ? finding.subjectId : matchingGames.length === 1 ? matchingGames[0].gameId : undefined), source: finding.sourceName,
      sourceRecordId: finding.id, sourceUrl: normalizeSourceUrl(finding.sourceUrl) || undefined,
      subject: { kind: finding.subjectType === 'LEAGUE' ? 'EVENT' : finding.subjectType ?? 'EVENT', id: finding.subjectId },
      factType, value, valueUnit: factType === 'availability.status' ? 'status' : factType.startsWith('claim.') ? 'text' : 'structured',
      publishedAt, effectiveAt, observedAt: validIso(finding.metadata?.observedAt) ?? publishedAt ?? retrievedAt, observedTimeBasis: validIso(finding.metadata?.observedAt) ? 'SOURCE_TIMESTAMP' : publishedAt ? 'PUBLISHED_AT_PROXY' : 'RETRIEVAL_FALLBACK', retrievedAt, expiresAt, status,
      identityConfidence: player?.identity?.confidence === 'EXACT' ? 'EXACT' : player?.identity?.confidence === 'HIGH' ? 'HIGH' : finding.subjectType === 'EVENT' || finding.subjectType === 'TEAM' ? 'HIGH' : 'LOW',
      rawPayloadRef: `research-finding:${finding.id}`, duplicateClusterId: String(finding.metadata?.duplicateClusterId ?? stableId(`${normalizeSourceUrl(finding.sourceUrl)}:${claim}`)),
    };
  });
  return { observations, facts: resolveObservations(observations, now) };
}

function classifyFactType(finding: ResearchFinding, text: string): string {
  if (finding.bucket === 'AVAILABILITY' && finding.subjectType === 'PLAYER') return 'availability.status';
  if (/minutes restriction|limited minutes|minutes limit|workload restriction|return restriction/.test(text)) return 'role.minutes_restriction';
  if (/rest days?|back.to.back|three games in four|schedule density/.test(text)) return 'team.rest_days';
  if (/travel|travelled|traveling|road trip|time zone/.test(text)) return 'team.travel';
  if (/ceremony|ring night|honor(ed|ing)|tribute/.test(text)) return 'event.ceremony';
  if (/former team|old team|faces? .* former|against .* ex-teammates/.test(text)) return 'player.former_team_matchup';
  if (/contract year|free agent after|expires? (in|after)|contract expiration/.test(text)) return 'contract.expiration_season';
  if (/spread|over\/under|game total|implied team total/.test(text)) return 'market.game_line';
  if (/starter|starting lineup|starting five|starting role|batting order|depth chart/.test(text)) return 'role.starting_status';
  if (/minutes|rotation|snap share|routes|targets|carries|plate appearances/.test(text)) return 'role.opportunity';
  return `claim.${finding.bucket.toLowerCase()}.${stableId(normalizeClaim(finding.finding)).slice(0, 12)}`;
}

function extractFactValue(factType: string, claim: string): unknown {
  if (factType === 'availability.status') {
    const lower = claim.toLowerCase();
    const status = /confirmed as a starter|confirmed starter/.test(lower) ? 'CONFIRMED_STARTER' : /ruled out|\bout\b|inactive|scratched/.test(lower) ? 'OUT' : /questionable|limited|restriction/.test(lower) ? 'LIMITED' : /active|available|will play/.test(lower) ? 'ACTIVE' : 'UNKNOWN';
    return { status, claim };
  }
  const number = claim.match(/\b(\d+(?:\.\d+)?)\s*(minutes?|days?|games?|percent|%)\b/i);
  return number ? { claim, value: Number(number[1]), unit: number[2].toLowerCase() } : { claim };
}

function inferEffectiveAt(text: string, now: Date): string | undefined {
  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!match) return undefined;
  const time = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(time) && time <= now.getTime() + 5 * 60_000 ? new Date(time).toISOString() : undefined;
}
function validIso(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : undefined; }
function normalizeClaim(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }

const AVAILABILITY_STATUS_TEXT: Record<string, string> = {
  CONFIRMED_STARTER: 'confirmed as a starter',
  ACTIVE: 'active',
  PROJECTED: 'projected to play, not yet confirmed',
  INACTIVE: 'inactive',
  OUT: 'ruled out',
  NOT_IN_CONFIRMED_LINEUP: 'not in the confirmed starting lineup',
  NOT_IN_PROVIDER_ROSTER: 'not found on the provider roster',
};

// Converts the confirmed-lineup/availability data already fetched onto the slate (before
// Research runs — see server/runtime.ts's processRun) into real AVAILABILITY findings, so
// Research's own gap-detection can see evidence we already have instead of reporting a gap
// for a player we've already confirmed. Skips ambiguous provider matches (UNMAPPED) and
// players with no real signal (UNKNOWN) rather than fabricating a finding from nothing.
export function findingsFromAvailability(slate: ValidatedSlate): ResearchFinding[] {
  return slate.playerPool.flatMap((player) => {
    const availability = player.availability;
    if (!availability || availability.mappedBy === 'UNMAPPED' || availability.status === 'NOT_IN_PROVIDER_ROSTER') return [];
    const statusText = AVAILABILITY_STATUS_TEXT[availability.status] ?? availability.status.toLowerCase();
    const finding = `${player.playerName} is ${statusText} per ${availability.source}${availability.note ? ` (${availability.note})` : ''}.`;
    return [{
      id: stableId(`${slate.tenantId}:${slate.slateId}:availability-seed:${player.playerId}:${availability.retrievedAt}:${availability.status}`),
      bucket: 'AVAILABILITY' as ResearchBucket,
      subjectType: 'PLAYER' as const,
      subjectId: player.playerId,
      finding,
      sourceName: availability.source,
      sourceTier: 1 as const,
        sourcePurpose: availability.status === 'UNKNOWN'
          ? 'Directly fetched roster/availability data for this exact slate; starting role remains unconfirmed.'
          : /depth chart/i.test(availability.note ?? '')
            ? 'Directly fetched NFL depth-chart data; this establishes roster/role intent, not game-day inactive confirmation.'
            : 'Directly fetched confirmed-lineup/availability data for this exact slate.',
      publishedAt: availability.retrievedAt,
      retrievedAt: availability.retrievedAt,
      confidence: availability.confirmed ? 'HIGH' as const : 'MEDIUM' as const,
      metadata: { mappedBy: availability.mappedBy, observedAt: availability.retrievedAt, canonicalFactKey: `${slate.tenantId}:${slate.slateId}:${player.playerId}:availability.status` },
    }];
  });
}

export function findConflicts(findings: ResearchFinding[]): ResearchConflict[] {
  const conflicts: ResearchConflict[] = [];
  for (const group of groupBy(findings, (finding) => `${finding.subjectId}:${finding.bucket}`)) {
    if (group[0]?.bucket === 'FIELD_SENTIMENT') continue;
    const contradictory = group.some((left, index) => group.slice(index + 1).some((right) => claimsConflict(left, right)));
    if (group.length > 1 && contradictory) {
      const resolution = resolveDirectAvailabilityConflict(group);
      conflicts.push({ findingIds: group.map((finding) => finding.id), subjectId: group[0].subjectId, summary: resolution?.summary ?? 'Sources reported contradictory evidence for the same subject and bucket; authority, recency, and specificity must remain visible.', resolved: Boolean(resolution) });
    }
  }
  return conflicts;
}

export function linkConflicts(findings: ResearchFinding[], conflicts: ResearchConflict[]): ResearchFinding[] {
  return findings.map((finding) => {
    const conflict = conflicts.find((item) => item.findingIds.includes(finding.id));
    return conflict ? { ...finding, conflictingFindingIds: conflict.findingIds.filter((id) => id !== finding.id) } : finding;
  });
}

function claimsConflict(left: ResearchFinding, right: ResearchFinding): boolean {
  if (left.bucket !== right.bucket) return false;
  const leftText = left.finding.toLowerCase();
  const rightText = right.finding.toLowerCase();
  if (left.bucket === 'AVAILABILITY') {
    const unavailable = (text: string) => /\bout\b|inactive|ruled out|scratched|questionable|limited/.test(text);
    const available = (text: string) => /available|active|starting|starter/.test(text) && !unavailable(text);
    return (unavailable(leftText) && available(rightText)) || (available(leftText) && unavailable(rightText));
  }
  const positive = /increased|starting|starter|more minutes|more routes|top of the order|favorable|boost/.test(leftText) !== /increased|starting|starter|more minutes|more routes|top of the order|favorable|boost/.test(rightText);
  const negative = /out|inactive|reduced|limited|fewer|bottom of the order|unfavorable|downgrade/.test(leftText) !== /out|inactive|reduced|limited|fewer|bottom of the order|unfavorable|downgrade/.test(rightText);
  return positive && negative;
}

// A same-slate, tier-1 provider lineup is stronger than an older external news item
// for MLB availability. Resolve only when the provider record is explicitly decisive
// (confirmed starter or explicit unavailable state), has a comparable timestamp, and
// outranks every contradictory finding. Otherwise preserve the conflict for review.
function resolveDirectAvailabilityConflict(group: ResearchFinding[]): { summary: string } | undefined {
  if (group[0]?.bucket !== 'AVAILABILITY') return undefined;
  const direct = group.filter(isDecisiveDirectAvailabilityFinding);
  for (const candidate of direct) {
    const opposing = group.filter((finding) => finding.id !== candidate.id && claimsConflict(candidate, finding));
    if (!opposing.length) continue;
    const candidateTime = findingTime(candidate);
    if (candidateTime === undefined) continue;
    const candidateTier = candidate.sourceTier ?? 4;
    const outranks = opposing.every((finding) => (finding.sourceTier ?? 4) > candidateTier && (findingTime(finding) ?? Number.NEGATIVE_INFINITY) <= candidateTime);
    if (outranks) return { summary: `Conflict resolved in favor of the newer tier-${candidateTier} direct same-slate availability record from ${candidate.sourceName}; contradictory lower-authority evidence remains linked for audit.` };
  }
  // NFL depth charts are season-long role intent, not game-day confirmation. When a
  // timestamped tier-1/2 report explicitly says a player is out and is newer than the
  // contradictory active/depth-chart evidence, resolve the conflict in favor of the
  // newer availability claim while retaining every finding link for auditability.
  const explicitOut = group.filter((finding) => (finding.sourceTier ?? 4) <= 2 && /\bout\b|inactive|ruled out|injured reserve/.test(finding.finding.toLowerCase()) && findingTime(finding) !== undefined);
  for (const candidate of explicitOut) {
    const candidateTime = findingTime(candidate)!;
    const opposing = group.filter((finding) => finding.id !== candidate.id && claimsConflict(candidate, finding));
    if (opposing.length && opposing.every((finding) => (findingTime(finding) ?? Number.NEGATIVE_INFINITY) <= candidateTime)) return { summary: `Conflict resolved in favor of the newer explicit availability report from ${candidate.sourceName}; older depth-chart or active-status evidence remains linked for audit.` };
  }
  return undefined;
}

function isDecisiveDirectAvailabilityFinding(finding: ResearchFinding): boolean {
  if (finding.bucket !== 'AVAILABILITY' || finding.sourceTier !== 1 || !finding.sourcePurpose?.includes('exact slate')) return false;
  const text = finding.finding.toLowerCase();
  return /confirmed as a starter|confirmed starting lineup|ruled out|inactive|not in the confirmed starting lineup/.test(text) && !/starting role remains unconfirmed|starting role was not confirmed/.test(text);
}

function findingTime(finding: ResearchFinding): number | undefined {
  const value = finding.retrievedAt ?? finding.publishedAt;
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] { const groups = new Map<string, T[]>(); for (const item of items) { const groupKey = key(item); groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]); } return [...groups.values()]; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
