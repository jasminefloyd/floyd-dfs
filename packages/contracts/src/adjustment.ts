import type { ResearchFinding, ResearchGap, ResearchPackage } from "./research";
import type { Sport, ValidatedSlate } from "./index";

export type AdjustmentDirection = "UP" | "DOWN" | "NEUTRAL";
export type AdjustmentMagnitude = "NONE" | "SMALL" | "MODERATE" | "MATERIAL" | "MAJOR";
export type AdjustmentConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface PlayerAdjustment {
  playerId: string;
  baselineContext: Record<string, unknown>;
  adjustments: Array<{
    adjustmentType: string;
    direction: AdjustmentDirection;
    magnitude: AdjustmentMagnitude;
    rationale: string;
    evidenceFindingIds: string[];
    confidence: AdjustmentConfidence;
  }>;
  competitiveContext?: { impact: AdjustmentDirection; rationale: string; confidence: AdjustmentConfidence };
  netOpportunityDirection: "MATERIALLY_UP" | "SLIGHTLY_UP" | "NEUTRAL" | "SLIGHTLY_DOWN" | "MATERIALLY_DOWN";
  roleCertainty: AdjustmentConfidence;
  keyDeltas: string[];
  projectionNotes: string[];
}

export interface AdjustmentPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  adjustments: PlayerAdjustment[];
  researchGaps: ResearchGap[];
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
}

export interface SportAdjustmentInput { validatedSlate: ValidatedSlate; researchPackage: ResearchPackage; }

export interface SportAdjustmentSpecialist {
  readonly sport: Sport;
  adjust(input: SportAdjustmentInput, now?: Date): AdjustmentPackage;
}

export function findingText(finding: ResearchFinding): string { return `${finding.finding} ${finding.sourcePurpose}`.toLowerCase(); }
