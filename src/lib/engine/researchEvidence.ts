import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchConflict, ValidatedSlate } from './contracts.js';

export function filterArticlesForSlate(articles: ResearchArticle[], slate: ValidatedSlate): ResearchArticle[] {
  return articles.filter((article) => articleSlateMatch(article, slate).accepted);
}

export function explainArticleRejection(article: ResearchArticle, slate: ValidatedSlate): string {
  const result = articleSlateMatch(article, slate); return result.accepted ? '' : result.reason;
}

function articleSlateMatch(article: ResearchArticle, slate: ValidatedSlate): { accepted: boolean; reason: string } {
  const target = slate.sport.toUpperCase();
  const acceptedSports = target === 'WNBA' ? ['WNBA', 'NBA'] : [target];
  const foreignSports = ['NBA', 'WNBA', 'NFL', 'MLB', 'GOLF'].filter((sport) => !acceptedSports.includes(sport));
  const targetTerms = [...slate.event.participants, ...slate.playerPool.flatMap((player) => [player.playerName, player.team ?? '', player.opponent ?? '', ...teamAliases(player.team), ...teamAliases(player.opponent)])]
    .map((term) => term.trim()).filter((term) => term.length >= 3);
  const text = `${article.title} ${article.summary ?? ''} ${article.content ?? ''} ${article.sourceName} ${(article.tags ?? []).join(' ')}`;
  const taggedSports = (article.tags ?? []).map((tag) => tag.toUpperCase()).filter((tag) => ['NBA', 'WNBA', 'NFL', 'MLB', 'GOLF'].includes(tag));
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
  return articles.map((article, index) => {
    const text = `${article.title} ${article.summary ?? ''}`.toLowerCase();
    const player = slate.playerPool.find((candidate) => text.includes(candidate.playerName.toLowerCase()));
    const bucket: ResearchBucket = /injur|out|questionable|available|lineup|starting|scratch/.test(text) ? 'AVAILABILITY' : /role|minutes|snap|usage|starter|form|recent/.test(text) ? 'RECENT_ROLE_FORM' : /odds|line|spread|total|market/.test(text) ? 'MARKET_SIGNALS' : /sentiment|chalk|ownership|popular/.test(text) ? 'FIELD_SENTIMENT' : /weather|wind|pace|matchup|defense|course|venue/.test(text) ? 'MATCHUP_ENVIRONMENT' : /playoff|seed|eliminat|qualif|advanc|rest|standings/.test(text) ? 'COMPETITIVE_CONTEXT' : 'NEWS_EXTERNAL_CONTEXT';
    const publishedAt = article.publishedAt;
    const ageMinutes = publishedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / 60_000)) : undefined;
    return {
      id: stableId(`${slate.slateId}:${article.url ?? article.title}:${index}`),
      bucket,
      subjectType: player ? 'PLAYER' : 'EVENT',
      subjectId: player?.playerId ?? slate.event.eventId,
      finding: article.summary || article.title,
      sourceUrl: article.url,
      sourceName: article.sourceName,
      sourceTier: article.sourceTier,
      sourcePurpose: bucket === 'FIELD_SENTIMENT' ? 'Field sentiment only; not factual player evidence.' : 'External context for the exact slate.',
      publishedAt,
      retrievedAt: now.toISOString(),
      confidence: article.sourceTier <= 2 ? 'HIGH' : article.sourceTier === 3 ? 'MEDIUM' : 'LOW',
      metadata: { title: article.title, tags: article.tags ?? [], ageMinutes },
    };
  });
}

export function findConflicts(findings: ResearchFinding[]): ResearchConflict[] {
  const conflicts: ResearchConflict[] = [];
  for (const group of groupBy(findings, (finding) => `${finding.subjectId}:${finding.bucket}`)) {
    if (group[0]?.subjectType === 'EVENT') continue;
    const tiers = new Set(group.map((finding) => finding.sourceTier));
    const contradictory = group.some((left, index) => group.slice(index + 1).some((right) => claimsConflict(left, right)));
    if (group.length > 1 && tiers.size > 1 && contradictory) conflicts.push({ findingIds: group.map((finding) => finding.id), subjectId: group[0].subjectId, summary: 'Multiple source tiers reported contradictory evidence for the same subject and bucket; authority, recency, and specificity must remain visible.', resolved: false });
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

function groupBy<T>(items: T[], key: (item: T) => string): T[][] { const groups = new Map<string, T[]>(); for (const item of items) { const groupKey = key(item); groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]); } return [...groups.values()]; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
