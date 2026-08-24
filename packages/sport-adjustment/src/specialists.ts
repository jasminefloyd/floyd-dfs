import type { ResearchFinding, Sport, SportAdjustmentInput, SportAdjustmentSpecialist, AdjustmentPackage, PlayerAdjustment, AdjustmentDirection, AdjustmentMagnitude, AdjustmentConfidence } from "@sports-engine/contracts";
import { findingText } from "@sports-engine/contracts";

const SPORT_PRIORITY: Record<Sport, string[]> = {
  NBA: ["expected minutes", "starting role", "closing role", "usage", "ball-handling", "rebounding", "pace", "matchup", "rest", "competitive context"],
  WNBA: ["expected minutes", "starting role", "closing role", "usage", "ball-handling", "rebounding", "pace", "matchup", "rest", "competitive context"],
  MLB: ["batting order", "plate appearances", "handedness", "starting pitcher", "pitch-type", "quality of contact", "strikeout", "bullpen", "park/weather", "competitive context"],
  GOLF: ["strokes gained", "tee-to-green", "approach", "off-the-tee", "putting", "birdie", "course fit", "weather wave", "leaderboard", "competitive context"],
  NFL: ["snap share", "routes", "targets", "carries", "red-zone role", "quarterback", "line matchup", "pace", "game script", "weather", "competitive context"],
};

export class EvidenceSportSpecialist implements SportAdjustmentSpecialist {
  constructor(readonly sport: Sport) {}

  adjust(input: SportAdjustmentInput, now = new Date()): AdjustmentPackage {
    // Only critical unresolved questions justify an immediate orchestrator
    // rerun. HIGH provider/source failures are retained in the ResearchPackage
    // and reflected in confidence, but retrying them immediately repeats the
    // same external failure and prevents lineup generation.
    const gaps = input.researchPackage.unknowns
      .filter((unknown) => unknown.importance === "CRITICAL")
      .map((unknown) => ({ question: unknown.question, importance: unknown.importance, reason: unknown.reason, affectedPlayerIds: input.validatedSlate.playerPool.map((player) => player.playerId) }));
    // Lack of player-specific evidence is represented by the player's LOW
    // certainty neutral adjustment below. It is not a new research gap: RSS
    // sources are best-effort and may not mention every eligible player, so
    // emitting a gap here would rerun the same research indefinitely.
    const adjustments = input.validatedSlate.playerPool.map((player) => this.adjustPlayer(player.playerId, input.researchPackage.findings.filter((finding) => finding.subjectId === player.playerId)));
    return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: this.sport, version: 1, generatedAt: now.toISOString(), adjustments, researchGaps: gaps, status: input.researchPackage.status === "BLOCKED" ? "BLOCKED" : gaps.length || input.researchPackage.status === "PARTIAL" ? "PARTIAL" : "COMPLETE" };
  }

  private adjustPlayer(playerId: string, findings: ResearchFinding[]): PlayerAdjustment {
    const evidence = findings.filter((finding) => finding.bucket !== "FIELD_SENTIMENT");
    const adjustments = evidence.flatMap((finding) => this.interpretFinding(finding));
    const hasUp = adjustments.some((item) => item.direction === "UP" && item.magnitude !== "NONE");
    const hasDown = adjustments.some((item) => item.direction === "DOWN" && item.magnitude !== "NONE");
    const netOpportunityDirection = hasUp && hasDown ? "NEUTRAL" : hasUp ? "SLIGHTLY_UP" : hasDown ? "SLIGHTLY_DOWN" : "NEUTRAL";
    return { playerId, baselineContext: { evidenceCount: evidence.length, specialistPriority: SPORT_PRIORITY[this.sport] }, adjustments: adjustments.length ? adjustments : [{ adjustmentType: "EVIDENCE_STATUS", direction: "NEUTRAL", magnitude: "NONE", rationale: "No player-specific factual evidence was retrieved; no opportunity change is asserted.", evidenceFindingIds: [], confidence: "LOW" }], netOpportunityDirection, roleCertainty: evidence.length ? "MEDIUM" : "LOW", keyDeltas: adjustments.filter((item) => item.magnitude !== "NONE").map((item) => item.rationale), projectionNotes: ["Adjustment expresses opportunity direction only; it does not calculate fantasy points."] };
  }

  private interpretFinding(finding: ResearchFinding): PlayerAdjustment["adjustments"] {
    const text = findingText(finding);
    const base = { evidenceFindingIds: [finding.id], confidence: finding.confidence };
    if (/out|inactive|ruled out|scratched/.test(text)) return [{ ...base, adjustmentType: "AVAILABILITY", direction: "DOWN", magnitude: "MAJOR", rationale: `${finding.finding} Explicit unavailability evidence materially reduces player opportunity.` }];
    if (/questionable|limited|restriction|workload/.test(text)) return [{ ...base, adjustmentType: "ROLE_RESTRICTION", direction: "DOWN", magnitude: "MODERATE", rationale: `${finding.finding} Evidence indicates uncertainty or workload limitation; active does not imply unrestricted workload.` }];
    if (/starting|starter|increased minutes|increased role|lead role|more routes|target share|batting (first|second|third)|top of the order/.test(text)) return [{ ...base, adjustmentType: "ROLE_OPPORTUNITY", direction: "UP", magnitude: "MODERATE", rationale: `${finding.finding} Evidence supports a stronger current role.` }];
    if (/bench|reduced minutes|limited role|fewer routes|bottom of the order|bullpen game/.test(text)) return [{ ...base, adjustmentType: "ROLE_OPPORTUNITY", direction: "DOWN", magnitude: "SMALL", rationale: `${finding.finding} Evidence supports a reduced current role.` }];
    return [{ ...base, adjustmentType: "CONTEXT", direction: "NEUTRAL", magnitude: "NONE", rationale: `${finding.finding} No explicit opportunity change was established by this evidence.` }];
  }
}

export function createSpecialist(sport: Sport): EvidenceSportSpecialist { return new EvidenceSportSpecialist(sport); }
