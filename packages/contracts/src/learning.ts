import type { Sport } from "./index";

export type LearningDecision = "KEEP" | "ADJUST" | "REBUILD";
export type LearningStage = "RESEARCH" | "SPORT_ADJUSTMENT" | "PROJECTION" | "OPTIMIZE" | "SELECTION" | "VARIANCE";
export type LessonStatus = "OBSERVED" | "ACCUMULATING" | "VALIDATED" | "REJECTED";

export interface EnteredLineupRecord {
  id: string; tenantId: string; slateId: string; lineupId: string; bulletNumber: number; enteredAt: string;
  projectionSnapshot: { floor: number; median: number; ceiling: number };
  researchVersion: number; adjustmentVersion: number; projectionVersion: number; optimizerVersion: number; selectionVersion: number;
}
export interface ChangeEvent { id: string; tenantId: string; generationRunId: string; eventType: string; subject: string; previousState?: unknown; newState?: unknown; materiality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; source: Record<string, unknown>; detectedAt: string; affectedLineupIds?: string[]; }
export interface WatchItemRecord { id: string; tenantId: string; generationRunId: string; subject: string; importance: string; currentState?: unknown; triggerCondition?: unknown; expectedUpdateAt?: string; status: "active" | "resolved" | "expired"; }
export interface PreLockDecision { decision: LearningDecision; requiresUserConfirmation: boolean; immutableLineupIds: string[]; affectedStages: LearningStage[]; rationale: string; }
export interface LockSnapshot { id: string; tenantId: string; generatedLineupId: string; lockedAt: string; lineupPayload: unknown; projectionSnapshot: { floor: number; median: number; ceiling: number }; gameScript?: string; riskFlags: string[]; researchVersion: number; adjustmentVersion: number; projectionVersion: number; optimizationVersion: number; selectionVersion: number; }
export interface ContestResult { id: string; tenantId: string; generatedLineupId: string; actualDkPoints?: number; finishPosition?: number; finishPercentile?: number; payout?: number; roi?: number; resultPayload?: unknown; measuredAt: string; }
export interface PlayerMeasurement { id: string; tenantId: string; generatedLineupId: string; playerId: string; projectedOpportunity?: Record<string, number>; actualOpportunity?: Record<string, number>; projectedFloor?: number; projectedMedian?: number; projectedCeiling?: number; actualDk?: number; projectionError?: number; withinExpectedRange?: boolean; }
export interface LearningDiagnostic { id: string; tenantId: string; generationRunId: string; subjectType: string; subjectId: string; errorStage: LearningStage; severity?: string; confidence: "LOW" | "MEDIUM" | "HIGH"; assumption?: string; actualOutcome?: string; evidence: Record<string, unknown>; diagnosis: string; }
export interface LessonCandidate { id: string; tenantId: string; sport: Sport; stage: LearningStage; observation: string; proposedChange?: string; status: LessonStatus; sampleCount: number; confidence?: "LOW" | "MEDIUM" | "HIGH"; evidence: unknown[]; }

export interface PreLockInput { enteredLineups: EnteredLineupRecord[]; changeEvents: ChangeEvent[]; }
export interface MeasurementInput { result: ContestResult; measurements: PlayerMeasurement[]; }
export interface DiagnosisInput { generationRunId: string; tenantId: string; sport: Sport; result: ContestResult; measurements: PlayerMeasurement[]; selectedVsOptimizer?: { selectedMedian: number; bestAlternativeMedian: number; selectedCeiling: number; bestAlternativeCeiling: number }; generalizable?: boolean; }
export interface LearningService { preLock(input: PreLockInput, now?: Date): PreLockDecision; createLockSnapshot(snapshot: Omit<LockSnapshot, "id">): LockSnapshot; measure(input: MeasurementInput): MeasurementInput; diagnose(input: DiagnosisInput, now?: Date): { diagnostic: LearningDiagnostic; lesson?: LessonCandidate }; }
