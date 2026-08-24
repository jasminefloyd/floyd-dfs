import type { LineupCandidate, OptimizerPackage } from "./optimizer";
import type { ResearchPackage } from "./research";
import type { AdjustmentPackage } from "./adjustment";
import type { ProjectionPackage } from "./projection";
import type { ContestFormat, Sport, ValidatedSlate } from "./index";

export interface SelectionInput { validatedSlate: ValidatedSlate; researchPackage: ResearchPackage; adjustmentPackage: AdjustmentPackage; projectionPackage: ProjectionPackage; optimizerPackage: OptimizerPackage; }
export interface SelectedLineup { candidateId: string; bulletNumber: number; selectionType: string; explanation: string; newsContext: string[]; rationale: string[]; playerIds: string[]; rosterSlots: Record<string, string>; salaryUsed: number; salaryRemaining: number; median: number; ceiling: number; }
export interface SelectionPackage { slateId: string; tenantId: string; sport: Sport; version: number; generatedAt: string; selectedLineups: SelectedLineup[]; optimizerGap?: string; status: "COMPLETE" | "BLOCKED"; }
export interface SelectionService { select(input: SelectionInput, now?: Date): SelectionPackage; }
export interface SelectionRunRecord { id: string; tenantId: string; generationRunId: string; version: number; selectionPackage: SelectionPackage; status: SelectionPackage["status"]; createdAt: string; }
export type { ContestFormat, LineupCandidate };
