export type Sport = "WNBA" | "NBA" | "MLB" | "GOLF" | "NFL";

export type ContestFormat = "SHOWDOWN" | "CLASSIC";

export type SlateSource = "DRAFTKINGS_API" | "DRAFTKINGS_RSS" | "DRAFTKINGS_RULES_REGISTRY" | "SPORTSDATAIO";

export type StageStatus = "VALID" | "WARNING" | "BLOCKED";

export type LineupStatus = "GENERATED" | "ENTERED";

export type SlateValidationStatus = "VALID" | "WARNING" | "BLOCKED";

export interface SlateEntryContext {
  contestSize?: number;
  userEntryCount: number;
  maxEntriesAllowed?: number;
}

export type {
  RosterRules,
  ScoringRule,
  ScoringRules,
  SlateEvent,
  SlateInput,
  SlatePlayer,
  SourceManifestItem,
  ValidatedSlate,
} from "./slate";

export type {
  EngineStage,
  GenerationRunRecord,
  GenerationRunState,
  OrchestrationRequest,
  OrchestrationResult,
  ResearchGap as OrchestrationResearchGap,
  StageExecutionResult,
  StageExecutionStatus,
  StageRunRecord,
} from "./orchestration";

export type {
  AvailabilityResearch,
  CompetitiveContextResearch,
  FieldSentimentResearch,
  MatchupEnvironmentResearch,
  MarketSignalResearch,
  PlayerEvidenceRecord,
  ResearchAgentInput,
  ResearchAgentOptions,
  ResearchArticle,
  ResearchBucket,
  ResearchConfidence,
  ResearchConflict,
  ResearchFinding,
  ResearchGap,
  ResearchPlan,
  ResearchPriority,
  ResearchQuestion,
  ResearchPackage,
  ResearchRunRecord,
  ResearchSourceProvider,
  ResearchSynthesizer,
  ResearchUnknown,
  RoleFormResearch,
  SourceTier,
  WatchItem,
} from "./research";

export type {
  AdjustmentConfidence,
  AdjustmentDirection,
  AdjustmentMagnitude,
  AdjustmentPackage,
  PlayerAdjustment,
  SportAdjustmentInput,
  SportAdjustmentSpecialist,
} from "./adjustment";
export { findingText } from "./adjustment";

export type {
  PlayerProjection,
  ProjectionGap,
  ProjectionInput,
  ProjectionModel,
  ProjectionPackage,
} from "./projection";

export type {
  CandidateType,
  DuplicationRisk,
  LineupCandidate,
  ObjectiveProfile,
  OptimizerInput,
  OptimizerOptions,
  OptimizerPackage,
  OptimizerService,
} from "./optimizer";

export type {
  SelectedLineup,
  SelectionInput,
  SelectionPackage,
  SelectionRunRecord,
  SelectionService,
} from "./selection";

export type {
  ChangeEvent,
  ContestResult,
  DiagnosisInput,
  EnteredLineupRecord,
  LearningDecision,
  LearningDiagnostic,
  LearningService,
  LearningStage,
  LessonCandidate,
  LessonStatus,
  LockSnapshot,
  MeasurementInput,
  PlayerMeasurement,
  PreLockDecision,
  PreLockInput,
  WatchItemRecord,
} from "./learning";

export interface GenerationRunReference {
  tenantId: string;
  requestId: string;
  generationRunId: string;
}

export interface GeneratedLineup {
  id: string;
  candidateId: string;
  status: LineupStatus;
  bulletNumber: number;
  createdAt: string;
}

export interface EnteredLineup extends GeneratedLineup {
  status: "ENTERED";
  enteredAt: string;
  researchVersion: number;
  adjustmentVersion: number;
  projectionVersion: number;
  optimizerVersion: number;
  selectionVersion: number;
}

export { parseStageOutput } from "./runtime";
