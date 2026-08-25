import type { ResearchBucket, ResearchPlan, ResearchPriority, ResearchQuestion, SourceTier, ValidatedSlate } from './contracts.js';

const BASE_QUESTIONS: Array<[ResearchBucket, string, ResearchPriority, SourceTier[], number]> = [
  ['AVAILABILITY', 'What current availability, injury, suspension, or workload restrictions are verified for slate participants?', 'CRITICAL', [1, 2], 180],
  ['RECENT_ROLE_FORM', 'What recent role, usage, minutes, snaps, plate appearances, or starting status is supported by evidence?', 'HIGH', [1, 2, 3], 1440],
  ['MATCHUP_ENVIRONMENT', 'What matchup, venue, weather, pace, defensive, or course conditions materially affect this slate?', 'HIGH', [1, 2], 720],
  ['MARKET_SIGNALS', 'What actual market signals are available for this event, and what do they objectively measure?', 'MEDIUM', [1, 2], 360],
  ['NEWS_EXTERNAL_CONTEXT', 'What recent external news could materially affect the slate?', 'HIGH', [1, 2, 3], 360],
  ['FIELD_SENTIMENT', 'What public or specialist sentiment is observable, clearly separated from factual evidence?', 'LOW', [3, 4], 720],
  ['COMPETITIVE_CONTEXT', 'Are playoff, seeding, elimination, advancement, qualification, rest, or similar conditions relevant?', 'MEDIUM', [1, 2, 3], 1440],
];

export function createResearchPlan(slate: ValidatedSlate, now = new Date()): ResearchPlan {
  const questions: ResearchQuestion[] = BASE_QUESTIONS.map(([bucket, question, priority, tiers, freshness]) => ({
    id: `${slate.slateId}:${bucket.toLowerCase()}`,
    bucket,
    question: `${slate.sport} ${slate.league}: ${question}`,
    priority,
    preferredSourceTiers: tiers,
    freshnessRequirementMinutes: freshness,
  }));
  for (const player of slate.playerPool) questions.push({
    id: `${slate.slateId}:availability:${player.playerId}`,
    bucket: 'AVAILABILITY',
    question: `Is ${player.playerName} available with an unrestricted role for this slate?`,
    priority: 'CRITICAL',
    preferredSourceTiers: [1, 2],
    freshnessRequirementMinutes: 180,
    subjectId: player.playerId,
  });
  return { slateId: slate.slateId, generatedAt: now.toISOString(), questions };
}
