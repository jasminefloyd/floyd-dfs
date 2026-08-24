import type { AdjustmentPackage } from "./adjustment";
import type { ProjectionPackage } from "./projection";
import type { ResearchPackage } from "./research";
import type { Sport, ValidatedSlate } from "./index";

export type CandidateType = "HIGHEST_MEDIAN" | "HIGHEST_CEILING" | "BEST_TOURNAMENT_EV" | "LEVERAGE" | "LOW_DUPLICATION" | "ALTERNATE_GAME_SCRIPT";
export type DuplicationRisk = "LOW" | "MEDIUM" | "HIGH";

export interface ObjectiveProfile { name: string; medianWeight: number; ceilingWeight: number; leverageWeight: number; duplicationPenalty: number; correlationWeight: number; }
export interface OptimizerOptions { maxCandidates?: number; simulationRuns?: number; objectiveProfile?: ObjectiveProfile; }

export interface LineupCandidate {
  id: string;
  playerIds: string[];
  rosterSlots: Record<string, string>;
  salaryUsed: number;
  salaryRemaining: number;
  floor: number;
  median: number;
  ceiling: number;
  correlationScore: number;
  optimalLineupFrequency: number;
  topOnePercentFrequency: number;
  ownershipEstimate: number;
  leverageScore: number;
  duplicationRisk: DuplicationRisk;
  estimatedDuplicates: number;
  medianRank: number;
  ceilingRank: number;
  tournamentRank: number;
  candidateTypes: CandidateType[];
  gameScriptCluster: string;
  strategicSimilarity: number;
  riskFlags: string[];
}

export interface OptimizerPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  objectiveProfile: ObjectiveProfile;
  candidates: LineupCandidate[];
  warnings: string[];
  gaps: string[];
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
}

export interface OptimizerInput { validatedSlate: ValidatedSlate; researchPackage: ResearchPackage; adjustmentPackage: AdjustmentPackage; projectionPackage: ProjectionPackage; }
export interface OptimizerService { optimize(input: OptimizerInput, options?: OptimizerOptions, now?: Date): OptimizerPackage; }
