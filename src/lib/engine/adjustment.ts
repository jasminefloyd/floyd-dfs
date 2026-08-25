import type { AdjustmentPackage, PlayerAdjustment, ResearchFinding, ResearchPackage, Sport, ValidatedSlate } from './contracts.js';

const SPORT_PRIORITY: Record<Sport, string[]> = {
  NBA: ['expected minutes', 'starting role', 'closing role', 'usage', 'ball-handling', 'rebounding', 'pace', 'matchup', 'rest', 'competitive context'],
  WNBA: ['expected minutes', 'starting role', 'closing role', 'usage', 'ball-handling', 'rebounding', 'pace', 'matchup', 'rest', 'competitive context'],
  MLB: ['batting order', 'plate appearances', 'handedness', 'starting pitcher', 'pitch-type', 'quality of contact', 'strikeout', 'bullpen', 'park/weather', 'competitive context'],
  GOLF: ['strokes gained', 'tee-to-green', 'approach', 'off-the-tee', 'putting', 'birdie', 'course fit', 'weather wave', 'leaderboard', 'competitive context'],
  NFL: ['snap share', 'routes', 'targets', 'carries', 'red-zone role', 'quarterback', 'line matchup', 'pace', 'game script', 'weather', 'competitive context'],
};

type Magnitude = PlayerAdjustment['adjustments'][number]['magnitude'];
type Direction = 'UP' | 'DOWN' | 'NEUTRAL';

export function adjustSlate(slate: ValidatedSlate, research: ResearchPackage, now = new Date()): AdjustmentPackage {
  const unknowns = research.unknowns ?? [];
  const researchGaps = unknowns.filter((unknown) => unknown.importance === 'CRITICAL').map((unknown) => ({ question: unknown.question, importance: unknown.importance, reason: unknown.reason, affectedPlayerIds: slate.playerPool.map((player) => player.playerId) }));
  const adjustments = slate.playerPool.map((player) => adjustPlayer(player.playerId, slate.sport, research.findings.filter((finding) => finding.subjectId === player.playerId)));
  const status = research.status === 'BLOCKED' ? 'BLOCKED' : researchGaps.length || research.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE';
  return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), adjustments, researchGaps, status };
}

function adjustPlayer(playerId: string, sport: Sport, findings: ResearchFinding[]): PlayerAdjustment {
  const evidence = findings.filter((finding) => finding.bucket !== 'FIELD_SENTIMENT');
  const adjustments = evidence.flatMap(interpretFinding);
  const hasUp = adjustments.some((item) => item.direction === 'UP' && item.magnitude !== 'NONE');
  const hasDown = adjustments.some((item) => item.direction === 'DOWN' && item.magnitude !== 'NONE');
  const netOpportunityDirection = hasUp && hasDown ? 'NEUTRAL' : hasUp ? 'SLIGHTLY_UP' : hasDown ? 'SLIGHTLY_DOWN' : 'NEUTRAL';
  const neutral = { adjustmentType: 'EVIDENCE_STATUS', direction: 'NEUTRAL' as const, magnitude: 'NONE' as const, rationale: 'No player-specific factual evidence was retrieved; no opportunity change is asserted.', evidenceFindingIds: [], confidence: 'LOW' as const };
  const applied = adjustments.length ? adjustments : [neutral];
  return { playerId, baselineContext: { evidenceCount: evidence.length, specialistPriority: SPORT_PRIORITY[sport] }, adjustments: applied, netOpportunityDirection, roleCertainty: evidence.length ? 'MEDIUM' : 'LOW', keyDeltas: applied.filter((item) => item.magnitude !== 'NONE').map((item) => item.rationale), projectionNotes: ['Adjustment expresses opportunity direction only; it does not calculate fantasy points.'] };
}

function interpretFinding(finding: ResearchFinding) {
  const text = `${finding.finding} ${finding.sourcePurpose ?? ''}`.toLowerCase();
  const base = { evidenceFindingIds: [finding.id], confidence: finding.confidence };
  if (/out|inactive|ruled out|scratched/.test(text)) return [{ ...base, adjustmentType: 'AVAILABILITY', direction: 'DOWN' as Direction, magnitude: 'MAJOR' as Magnitude, rationale: `${finding.finding} Explicit unavailability evidence materially reduces player opportunity.` }];
  if (/questionable|limited|restriction|workload/.test(text)) return [{ ...base, adjustmentType: 'ROLE_RESTRICTION', direction: 'DOWN' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence indicates uncertainty or workload limitation; active does not imply unrestricted workload.` }];
  if (/starting|starter|increased minutes|increased role|lead role|more routes|target share|batting (first|second|third)|top of the order/.test(text)) return [{ ...base, adjustmentType: 'ROLE_OPPORTUNITY', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports a stronger current role.` }];
  if (/bench|reduced minutes|limited role|fewer routes|bottom of the order|bullpen game/.test(text)) return [{ ...base, adjustmentType: 'ROLE_OPPORTUNITY', direction: 'DOWN' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a reduced current role.` }];
  return [{ ...base, adjustmentType: 'CONTEXT', direction: 'NEUTRAL' as Direction, magnitude: 'NONE' as Magnitude, rationale: `${finding.finding} No explicit opportunity change was established by this evidence.` }];
}
