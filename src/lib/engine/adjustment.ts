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
type AdjustmentItem = PlayerAdjustment['adjustments'][number];

export const MAGNITUDE_WEIGHTS: Record<Magnitude, number> = { NONE: 0, SMALL: 0.03, MODERATE: 0.08, MATERIAL: 0.15, MAJOR: 0.3 };
const NET_MAGNITUDE_CLAMP = 0.4;

// Sums each item's signed weight instead of collapsing to NEUTRAL whenever both UP and DOWN
// items exist -- a MAJOR-UP + MODERATE-DOWN pair should net to a real positive signal, not
// vanish. Clamped so many corroborating items can't produce an unbounded swing.
export function netSignedMagnitude(items: AdjustmentItem[]): number {
  const total = items.reduce((sum, item) => {
    const weight = MAGNITUDE_WEIGHTS[item.magnitude] ?? 0;
    if (item.direction === 'UP') return sum + weight;
    if (item.direction === 'DOWN') return sum - weight;
    return sum;
  }, 0);
  return Math.max(-NET_MAGNITUDE_CLAMP, Math.min(NET_MAGNITUDE_CLAMP, total));
}

export function adjustSlate(slate: ValidatedSlate, research: ResearchPackage, now = new Date()): AdjustmentPackage {
  const unknowns = research.unknowns ?? [];
  const criticalGaps = unknowns.filter((unknown) => unknown.importance === 'CRITICAL').map((unknown) => ({ question: unknown.question, importance: unknown.importance, reason: unknown.reason, affectedPlayerIds: unknown.subjectId ? [unknown.subjectId] : slate.playerPool.map((player) => player.playerId) }));
  let adjustments = slate.playerPool.map((player) => adjustPlayer(player.playerId, slate.sport, research.findings.filter((finding) => finding.subjectId === player.playerId)));
  const evidenceGaps = slate.playerPool
    .filter((player) => !research.findings.some((finding) => finding.subjectId === player.playerId))
    .map((player) => ({ question: `What role, availability, or matchup evidence exists for ${player.playerName}?`, importance: 'HIGH' as const, reason: `No research findings were retrieved for ${player.playerName}; Sport Adjustment cannot assert an opportunity change without evidence.`, affectedPlayerIds: [player.playerId] }));
  adjustments = redistributeForUnavailablePlayers(slate, adjustments);
  const researchGaps = [...criticalGaps, ...evidenceGaps];
  // research.status === 'PARTIAL' has multiple independent causes, all folded into
  // research.unknowns (checked below) except unresolved conflicts. A conflict this stage's own
  // netSignedMagnitude demonstrably resolved into a real signal shouldn't still read as PARTIAL
  // here just because Research itself never marks a conflict `resolved`.
  const unresolvedUnnettedConflicts = (research.conflicts ?? []).filter((conflict) => !conflict.resolved).filter((conflict) => {
    const playerAdjustment = adjustments.find((item) => item.playerId === conflict.subjectId);
    return !playerAdjustment || Math.abs(playerAdjustment.netSignedMagnitude) < MAGNITUDE_WEIGHTS.SMALL;
  });
  const status = research.status === 'BLOCKED' ? 'BLOCKED' : researchGaps.length || unknowns.length || unresolvedUnnettedConflicts.length ? 'PARTIAL' : 'COMPLETE';
  return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), adjustments, researchGaps, status };
}

export function netOpportunityDirectionFrom(adjustments: AdjustmentItem[]): PlayerAdjustment['netOpportunityDirection'] {
  const net = netSignedMagnitude(adjustments);
  if (Math.abs(net) < MAGNITUDE_WEIGHTS.SMALL) return 'NEUTRAL';
  if (net >= MAGNITUDE_WEIGHTS.MATERIAL) return 'MATERIALLY_UP';
  if (net <= -MAGNITUDE_WEIGHTS.MATERIAL) return 'MATERIALLY_DOWN';
  return net > 0 ? 'SLIGHTLY_UP' : 'SLIGHTLY_DOWN';
}

function adjustPlayer(playerId: string, sport: Sport, findings: ResearchFinding[]): PlayerAdjustment {
  const evidence = findings.filter((finding) => finding.bucket !== 'FIELD_SENTIMENT');
  const interpreter = interpreterForSport(sport);
  const adjustments = dedupeAdjustments(evidence.flatMap((finding) => finding.bucket === 'COMPETITIVE_CONTEXT' ? interpretCompetitiveContext(finding) : interpreter(finding)));
  const neutral: AdjustmentItem = { adjustmentType: 'EVIDENCE_STATUS', direction: 'NEUTRAL', magnitude: 'NONE', rationale: 'No player-specific factual evidence was retrieved; no opportunity change is asserted.', evidenceFindingIds: [], confidence: 'LOW' };
  const applied = adjustments.length ? adjustments : [neutral];
  const roleCertainty = evidence.length === 0 ? 'LOW' : evidence.length >= 3 ? 'HIGH' : 'MEDIUM';
  return { playerId, baselineContext: { evidenceCount: evidence.length, specialistPriority: SPORT_PRIORITY[sport] }, adjustments: applied, netOpportunityDirection: netOpportunityDirectionFrom(applied), netSignedMagnitude: netSignedMagnitude(applied), roleCertainty, keyDeltas: applied.filter((item) => item.magnitude !== 'NONE').map((item) => item.rationale ?? ''), projectionNotes: ['Adjustment expresses opportunity direction only; it does not calculate fantasy points.'] };
}

function redistributeForUnavailablePlayers(slate: ValidatedSlate, adjustments: PlayerAdjustment[]): PlayerAdjustment[] {
  const byId = new Map(adjustments.map((adjustment) => [adjustment.playerId, adjustment]));
  const playersById = new Map(slate.playerPool.map((player) => [player.playerId, player]));
  const isMajorDownAvailability = (adjustment: PlayerAdjustment) => adjustment.adjustments.some((item) => item.adjustmentType === 'AVAILABILITY' && item.direction === 'DOWN' && item.magnitude === 'MAJOR');
  const unavailable = adjustments.filter(isMajorDownAvailability);
  if (!unavailable.length) return adjustments;
  for (const outAdjustment of unavailable) {
    const outPlayer = playersById.get(outAdjustment.playerId);
    const groundingFindingId = outAdjustment.adjustments.find((item) => item.adjustmentType === 'AVAILABILITY')?.evidenceFindingIds?.[0];
    if (!outPlayer?.team || !groundingFindingId) continue;
    const teammates = slate.playerPool.filter((player) => player.team === outPlayer.team && player.playerId !== outPlayer.playerId)
      .map((player) => ({ player, score: beneficiaryScore(slate.sport, outPlayer.position, player.position) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    for (const { player: teammate, score } of teammates) {
      const current = byId.get(teammate.playerId);
      if (!current || isMajorDownAvailability(current)) continue;
      const magnitude: Magnitude = score >= 5 ? 'MATERIAL' : score >= 3 ? 'MODERATE' : 'SMALL';
      const redistribution: AdjustmentItem = { adjustmentType: redistributionDimension(slate.sport, teammate.position), direction: 'UP', magnitude, rationale: `${outPlayer.playerName} is unavailable; role proximity indicates that ${teammate.playerName} is a direct same-team opportunity beneficiary.`, evidenceFindingIds: [groundingFindingId], confidence: 'LOW' };
      const mergedAdjustments = [...current.adjustments, redistribution];
      byId.set(teammate.playerId, { ...current, adjustments: mergedAdjustments, netOpportunityDirection: netOpportunityDirectionFrom(mergedAdjustments), netSignedMagnitude: netSignedMagnitude(mergedAdjustments), keyDeltas: [...current.keyDeltas, redistribution.rationale ?? ''] });
    }
  }
  return adjustments.map((adjustment) => byId.get(adjustment.playerId) ?? adjustment);
}

function beneficiaryScore(sport: Sport, unavailablePosition?: string, teammatePosition?: string): number {
  const out = (unavailablePosition ?? '').toUpperCase();
  const teammate = (teammatePosition ?? '').toUpperCase();
  if (sport === 'NBA' || sport === 'WNBA') {
    if (out === 'PG') return teammate === 'PG' ? 5 : ['SG', 'SF'].includes(teammate) ? 3 : 1;
    if (['SG', 'SF', 'PF', 'C'].includes(out)) return teammate === out ? 5 : ['SG', 'SF', 'PF', 'C'].includes(teammate) ? 3 : 1;
  }
  if (sport === 'NFL') {
    if (out === 'QB') return ['WR', 'TE', 'RB'].includes(teammate) ? 4 : 1;
    if (['WR', 'TE'].includes(out)) return teammate === out ? 5 : ['WR', 'TE', 'RB'].includes(teammate) ? 3 : 1;
    if (out === 'RB') return teammate === 'RB' ? 5 : ['WR', 'TE'].includes(teammate) ? 2 : 1;
  }
  if (sport === 'MLB' && !/^(SP|RP|P)$/.test(out)) return /^(C|1B|2B|3B|SS|OF|DH)$/.test(teammate) ? 3 : 0;
  return 0;
}

function redistributionDimension(sport: Sport, teammatePosition?: string): string {
  const position = (teammatePosition ?? '').toUpperCase();
  if (sport === 'NBA' || sport === 'WNBA') return 'MINUTES';
  if (sport === 'NFL') return position === 'RB' ? 'CARRY_SHARE' : 'TARGET_SHARE';
  if (sport === 'MLB') return 'PLATE_APPEARANCES';
  return 'ROLE_OPPORTUNITY';
}

function dedupeAdjustments(items: AdjustmentItem[]): AdjustmentItem[] {
  const seen = new Map<string, AdjustmentItem>();
  for (const item of items) {
    const evidence = [...(item.evidenceFindingIds ?? [])].sort().join(',');
    const key = `${evidence}:${item.adjustmentType ?? 'UNKNOWN'}`;
    seen.set(key, item);
  }
  return [...seen.values()];
}

function interpreterForSport(sport: Sport): (finding: ResearchFinding) => AdjustmentItem[] {
  if (sport === 'NBA' || sport === 'WNBA') return interpretBasketballFinding;
  if (sport === 'MLB') return interpretMlbFinding;
  if (sport === 'GOLF') return interpretGolfFinding;
  return interpretNflFinding;
}

function findingText(finding: ResearchFinding): string { return `${finding.finding} ${finding.sourcePurpose ?? ''}`.toLowerCase(); }
function baseFields(finding: ResearchFinding) { return { evidenceFindingIds: [finding.id], confidence: finding.confidence }; }
function neutralContext(finding: ResearchFinding): AdjustmentItem[] { return [{ ...baseFields(finding), adjustmentType: 'CONTEXT', direction: 'NEUTRAL', magnitude: 'NONE', rationale: `${finding.finding} No explicit opportunity change was established by this evidence.` }]; }

// Availability language overrides every sport's priority ordering — an unavailable or
// restricted player is downgraded before any sport-specific role signal is considered.
function baseAvailability(text: string, finding: ResearchFinding): AdjustmentItem[] | undefined {
  const base = baseFields(finding);
  if (/\bout\b|inactive|ruled out|scratched/.test(text)) return [{ ...base, adjustmentType: 'AVAILABILITY', direction: 'DOWN', magnitude: 'MAJOR', rationale: `${finding.finding} Explicit unavailability evidence materially reduces player opportunity.` }];
  if (/questionable|limited|restriction|workload/.test(text)) return [{ ...base, adjustmentType: 'ROLE_RESTRICTION', direction: 'DOWN', magnitude: 'MODERATE', rationale: `${finding.finding} Evidence indicates uncertainty or workload limitation; active does not imply unrestricted workload.` }];
  return undefined;
}

// Cross-sport role-language fallback, checked after each sport's own priority signals so
// phrasing that doesn't match a sport-specific pattern still resolves to a real signal
// instead of falling straight to NEUTRAL.
function genericRoleOpportunity(text: string, finding: ResearchFinding): AdjustmentItem[] | undefined {
  const base = baseFields(finding);
  if (/starting|starter|increased minutes|increased role|lead role|more routes|target share|batting (first|second|third)|top of the order/.test(text)) return [{ ...base, adjustmentType: 'ROLE_OPPORTUNITY', direction: 'UP', magnitude: 'MODERATE', rationale: `${finding.finding} Evidence supports a stronger current role.` }];
  if (/bench|reduced minutes|limited role|fewer routes|bottom of the order|bullpen game/.test(text)) return [{ ...base, adjustmentType: 'ROLE_OPPORTUNITY', direction: 'DOWN', magnitude: 'SMALL', rationale: `${finding.finding} Evidence supports a reduced current role.` }];
  return undefined;
}

function interpretBasketballFinding(finding: ResearchFinding): AdjustmentItem[] {
  const text = findingText(finding); const base = baseFields(finding);
  const availability = baseAvailability(text, finding); if (availability) return availability;
  if (/(more|increased|expanded) minutes|starting (five|lineup|role)|closing lineup|top of the rotation/.test(text)) return [{ ...base, adjustmentType: 'MINUTES', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports increased expected minutes or role certainty.` }];
  if (/(reduced|fewer|limited) minutes|bench role|out of the rotation|closing lineup demotion/.test(text)) return [{ ...base, adjustmentType: 'MINUTES', direction: 'DOWN' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports reduced expected minutes or role certainty.` }];
  if (/increased usage|more shots|primary scoring option|go-to option|usage rate/.test(text)) return [{ ...base, adjustmentType: 'USAGE', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports increased offensive usage.` }];
  if (/ball[- ]?handling|primary (ball[- ]?handler|creator)|point guard duties/.test(text)) return [{ ...base, adjustmentType: 'BALL_HANDLING', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports an expanded ball-handling/creation role.` }];
  if (/rebounding opportunity|more rebounds|frontcourt minutes|glass work/.test(text)) return [{ ...base, adjustmentType: 'REBOUNDING', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports increased rebounding opportunity.` }];
  if (/favorable pace|fast pace|up-tempo|high-possession/.test(text)) return [{ ...base, adjustmentType: 'PACE', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable pace/possession environment.` }];
  return genericRoleOpportunity(text, finding) ?? neutralContext(finding);
}

function interpretMlbFinding(finding: ResearchFinding): AdjustmentItem[] {
  const text = findingText(finding); const base = baseFields(finding);
  const availability = baseAvailability(text, finding); if (availability) return availability;
  if (/batting (first|second|third|cleanup|fourth)|top of the order|moved up in the (batting )?order/.test(text)) return [{ ...base, adjustmentType: 'BATTING_ORDER', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports a more favorable batting-order position, increasing expected plate appearances.` }];
  if (/batting (seventh|eighth|ninth)|bottom of the order|dropped in the (batting )?order/.test(text)) return [{ ...base, adjustmentType: 'BATTING_ORDER', direction: 'DOWN' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a less favorable batting-order position.` }];
  if (/favorable (matchup|handedness)|platoon advantage|faces a (lefty|righty|left-hander|right-hander)/.test(text)) return [{ ...base, adjustmentType: 'HANDEDNESS_MATCHUP', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable handedness/pitcher matchup.` }];
  if (/weak(ened)? bullpen|bullpen (game|depleted|taxed)/.test(text)) return [{ ...base, adjustmentType: 'BULLPEN', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a weakened opposing bullpen, increasing late-game offensive opportunity.` }];
  if (/quality start|shutdown (pitcher|starter)|elite strikeout|dominant on the mound/.test(text)) return [{ ...base, adjustmentType: 'PITCHER_QUALITY', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable pitching-quality/strikeout opportunity.` }];
  return genericRoleOpportunity(text, finding) ?? neutralContext(finding);
}

function interpretGolfFinding(finding: ResearchFinding): AdjustmentItem[] {
  const text = findingText(finding); const base = baseFields(finding);
  const availability = baseAvailability(text, finding) ?? (/withdrew|withdrawal|missed the cut|\bwd\b/.test(text) ? [{ ...base, adjustmentType: 'AVAILABILITY', direction: 'DOWN' as Direction, magnitude: 'MAJOR' as Magnitude, rationale: `${finding.finding} Withdrawal/missed-cut evidence eliminates remaining scoring opportunity.` }] : undefined);
  if (availability) return availability;
  if (/strokes gained|gaining strokes|elite ball[- ]?striking|hot putter/.test(text)) return [{ ...base, adjustmentType: 'STROKES_GAINED', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable strokes-gained profile for this round.` }];
  if (/favorable tee time|calm conditions|morning wave advantage|benign weather/.test(text)) return [{ ...base, adjustmentType: 'WEATHER_WAVE', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable tee-time weather wave.` }];
  if (/course fit|history at this course|strong track record here/.test(text)) return [{ ...base, adjustmentType: 'COURSE_FIT', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports favorable course fit.` }];
  if (/cold putter|missed cuts recently|poor recent form|struggling off the tee/.test(text)) return [{ ...base, adjustmentType: 'FORM', direction: 'DOWN' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports weaker recent form.` }];
  return genericRoleOpportunity(text, finding) ?? neutralContext(finding);
}

function interpretNflFinding(finding: ResearchFinding): AdjustmentItem[] {
  const text = findingText(finding); const base = baseFields(finding);
  const availability = baseAvailability(text, finding); if (availability) return availability;
  if (/increased snap share|full participant|expanded role|starting (role|job)/.test(text)) return [{ ...base, adjustmentType: 'SNAP_SHARE', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports an increased snap share.` }];
  if (/target share|more routes|red[- ]?zone (role|looks|targets)/.test(text)) return [{ ...base, adjustmentType: 'TARGET_SHARE', direction: 'UP' as Direction, magnitude: 'MODERATE' as Magnitude, rationale: `${finding.finding} Evidence supports increased route participation or red-zone opportunity.` }];
  if (/favorable (matchup|game script)|shootout expected|high total|pass-funnel defense/.test(text)) return [{ ...base, adjustmentType: 'GAME_SCRIPT', direction: 'UP' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a favorable game-script environment.` }];
  if (/reduced snaps|fewer targets|committee backfield|timeshare/.test(text)) return [{ ...base, adjustmentType: 'SNAP_SHARE', direction: 'DOWN' as Direction, magnitude: 'SMALL' as Magnitude, rationale: `${finding.finding} Evidence supports a reduced snap share or crowded backfield.` }];
  return genericRoleOpportunity(text, finding) ?? neutralContext(finding);
}

// Competitive context (playoff race, seeding, elimination, qualification, rest incentives) must
// never automatically translate into a projection boost. It only produces a non-neutral
// adjustment when the finding itself contains evidence of an actual behavior change.
function interpretCompetitiveContext(finding: ResearchFinding): AdjustmentItem[] {
  const text = findingText(finding); const base = baseFields(finding);
  const behaviorChangeUp = /extended minutes|increased workload|expanded role|increased usage in (close|competitive) games|shortened rotation to (stars|starters)/.test(text);
  const behaviorChangeDown = /rest(ing)?( starters)?\b|reduced (workload|minutes)|shut down|load management|resting|sitting out/.test(text);
  if (!behaviorChangeUp && !behaviorChangeDown) return [{ ...base, adjustmentType: 'COMPETITIVE_CONTEXT', direction: 'NEUTRAL', magnitude: 'NONE', rationale: `${finding.finding} Competitive context noted, but no evidence of a resulting behavior change (minutes, rotation, workload, or rest) was found.` }];
  return [{ ...base, adjustmentType: 'COMPETITIVE_CONTEXT', direction: behaviorChangeUp ? 'UP' : 'DOWN', magnitude: 'SMALL', rationale: `${finding.finding} Evidence indicates an actual behavior change tied to competitive/standings context.` }];
}
