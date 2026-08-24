import type { AdjustmentPackage } from "./adjustment";
import type { ResearchPackage } from "./research";
import type { Sport, ValidatedSlate } from "./index";

export interface PlayerProjection {
  playerId: string;
  salary: number;
  baselineOpportunity: Record<string, number>;
  adjustedOpportunity: Record<string, number>;
  opportunityDelta: Record<string, number>;
  componentProjection: Record<string, number>;
  projectedOutcomes: { floorP20: number; medianP50: number; ceilingP90: number };
  salaryEfficiency: { medianPer1k: number; ceilingPer1k: number };
  confidence: "LOW" | "MEDIUM" | "HIGH";
  uncertaintyFactors: string[];
  watchDependencies: string[];
  modelVersion: string;
}

export interface ProjectionGap { playerId?: string; question: string; reason: string; importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; }

export interface ProjectionPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  modelVersion: string;
  simulationRuns: number;
  players: PlayerProjection[];
  gaps: ProjectionGap[];
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
}

export interface ProjectionInput {
  validatedSlate: ValidatedSlate;
  researchPackage: ResearchPackage;
  adjustmentPackage: AdjustmentPackage;
}

export interface ProjectionModel {
  readonly sport: Sport;
  project(input: ProjectionInput, now?: Date): ProjectionPackage;
}
