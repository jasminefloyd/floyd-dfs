export type Sport = 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL';
export type ContestFormat = 'SHOWDOWN' | 'CLASSIC';

export type EngineStage =
  | 'SLATE'
  | 'RESEARCH'
  | 'SPORT_ADJUSTMENT'
  | 'PROJECTION'
  | 'OPTIMIZE'
  | 'SELECTION'
  | 'LEARNING_LOOP';

export type GenerationRunState =
  | 'created'
  | 'slate_validated'
  | 'researching'
  | 'adjusting'
  | 'projecting'
  | 'optimizing'
  | 'selecting'
  | 'ready'
  | 'blocked'
  | 'failed'
  | 'complete';

export type StageExecutionStatus = 'COMPLETE' | 'PARTIAL' | 'VALID' | 'WARNING' | 'BLOCKED';

export interface RosterSlotRule {
  count: number;
  salaryMultiplier?: number;
  fantasyMultiplier?: number;
}

export interface RosterRules {
  rosterSize: number;
  slots: Record<string, RosterSlotRule>;
  uniquePlayersRequired: boolean;
  teamConstraints?: {
    minimumTeams?: number;
    maximumPlayersPerTeam?: number;
  };
}

export interface SlatePlayer {
  playerId: string;
  playerName: string;
  team?: string;
  opponent?: string;
  position?: string;
  salary: number;
  captainSalary?: number;
  utilitySalary?: number;
  eligibility: Record<string, boolean>;
  providerStatus?: string;
  providerFppg?: number;
  imageUrl?: string;
  teamLogoUrl?: string;
  projectionInputs?: Record<string, number>;
  availability?: {
    status: 'CONFIRMED_STARTER' | 'PROJECTED' | 'ACTIVE' | 'INACTIVE' | 'OUT' | 'UNKNOWN';
    confirmed: boolean;
    source: string;
    retrievedAt: string;
    providerPlayerId?: string;
    mappedBy?: 'NAME_AND_TEAM' | 'UNMAPPED';
    note?: string;
  };
}

export interface ValidatedSlate {
  slateId: string;
  version: number;
  tenantId: string;
  userId: string;
  requestId: string;
  receivedAt: string;
  createdAt: string;
  sport: Sport;
  league: Sport;
  event: {
    eventId: string;
    name: string;
    eventDate: string;
    participants: string[];
  };
  contest: {
    draftKingsContestId: string;
    name: string;
    format: ContestFormat;
    lockTime: string;
    userEntryCount: number;
    requestedEntryCount: number;
    contestSize?: number;
    maxEntriesAllowed?: number;
    cashLine?: number;
  };
  salaryCap: number;
  rosterRules: RosterRules;
  scoringRules: Record<string, { value: number }>;
  playerPool: SlatePlayer[];
  sourceManifest: Array<{ source: string; receivedAt: string; fields: string[] }>;
  validation: {
    status: 'VALID' | 'WARNING' | 'BLOCKED';
    warnings: string[];
    errors: string[];
  };
}

export interface OrchestrationRequest {
  tenantId: string;
  userId: string;
  requestId: string;
  requestedEntryCount: number;
  input: unknown;
}

export interface GenerationRunRecord {
  id: string;
  tenantId: string;
  userId: string;
  requestId: string;
  requestedEntryCount: number;
  state: GenerationRunState;
  currentStage?: EngineStage;
  error?: { message: string; stage?: EngineStage };
  lineage: Partial<Record<EngineStage, number>>;
  createdAt: string;
  updatedAt: string;
}

export interface StageRunRecord {
  id: string;
  tenantId: string;
  generationRunId: string;
  stage: EngineStage;
  version: number;
  status: StageExecutionStatus | 'FAILED';
  input: unknown;
  output?: unknown;
  warnings: string[];
  errors: string[];
  startedAt: string;
  completedAt: string;
  parentStageVersions: Partial<Record<EngineStage, number>>;
}

export interface StageExecutionResult<T = unknown> {
  status: StageExecutionStatus;
  output?: T;
  warnings?: string[];
  errors?: string[];
}

export interface PlayerProjection {
  playerId: string;
  salary: number;
  baselineOpportunity: Record<string, number>;
  adjustedOpportunity: Record<string, number>;
  opportunityDelta: Record<string, number>;
  componentProjection: Record<string, number>;
  projectedOutcomes: { floorP20: number; medianP50: number; ceilingP90: number };
  salaryEfficiency: { medianPer1k: number; ceilingPer1k: number };
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  uncertaintyFactors: string[];
  watchDependencies: string[];
  modelVersion: string;
}

export interface ProjectionPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  modelVersion: string;
  simulationRuns: number;
  players: PlayerProjection[];
  gaps: Array<{ reason: string }>;
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
}

export type CandidateType = 'HIGHEST_MEDIAN' | 'HIGHEST_CEILING' | 'BEST_TOURNAMENT_EV' | 'LEVERAGE' | 'LOW_DUPLICATION' | 'ALTERNATE_GAME_SCRIPT';
export type DuplicationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ObjectiveProfile {
  name: string;
  medianWeight: number;
  ceilingWeight: number;
  leverageWeight: number;
  duplicationPenalty: number;
  correlationWeight: number;
}

export interface LineupCandidate {
  id: string;
  playerIds: string[];
  rosterSlots: Record<string, string>;
  salaryUsed: number;
  salaryRemaining: number;
  floor?: number;
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
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
}

export interface ResearchFinding {
  id: string;
  subjectId: string;
  bucket: ResearchBucket;
  sourceName: string;
  finding: string;
  subjectType?: 'PLAYER' | 'TEAM' | 'EVENT' | 'LEAGUE';
  sourceTier?: 1 | 2 | 3 | 4;
  sourcePurpose?: string;
  sourceUrl?: string;
  publishedAt?: string;
  retrievedAt?: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  conflictingFindingIds?: string[];
  metadata?: Record<string, unknown>;
}

export type ResearchBucket = 'AVAILABILITY' | 'RECENT_ROLE_FORM' | 'MATCHUP_ENVIRONMENT' | 'MARKET_SIGNALS' | 'NEWS_EXTERNAL_CONTEXT' | 'FIELD_SENTIMENT' | 'COMPETITIVE_CONTEXT';
export type ResearchPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SourceTier = 1 | 2 | 3 | 4;

export interface ResearchQuestion {
  id: string;
  bucket: ResearchBucket;
  question: string;
  priority: ResearchPriority;
  preferredSourceTiers: SourceTier[];
  freshnessRequirementMinutes?: number;
  subjectId?: string;
}

export interface ResearchPlan {
  slateId: string;
  generatedAt: string;
  questions: ResearchQuestion[];
}

export interface ResearchArticle {
  title: string;
  url?: string;
  sourceName: string;
  sourceTier: SourceTier;
  publishedAt?: string;
  summary?: string;
  content?: string;
  tags?: string[];
}

export interface ResearchSourceProvider {
  readonly name: string;
  readonly tier: SourceTier;
  fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]>;
}

export interface ResearchPackage {
  slateId: string;
  tenantId: string;
  version: number;
  generatedAt: string;
  freshThrough: string;
  findings: ResearchFinding[];
  unknowns?: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }>;
  providerResults?: Array<{ provider: string; tier?: SourceTier; status: 'SUCCEEDED' | 'EMPTY' | 'FAILED'; articleCount: number; acceptedArticleCount?: number; rejectedArticleCount?: number; rejectionSamples?: string[]; error?: string }>;
  conflicts?: ResearchConflict[];
  watchItems?: Array<{ subjectId?: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; expectedChangeBeforeLock: boolean }>;
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
}

export interface ResearchConflict {
  findingIds: string[];
  subjectId: string;
  summary: string;
  resolved: boolean;
}

export interface PlayerAdjustment {
  playerId: string;
  baselineContext: Record<string, unknown>;
  adjustments: Array<{ adjustmentType?: string; direction?: 'UP' | 'DOWN' | 'NEUTRAL'; magnitude: 'NONE' | 'SMALL' | 'MODERATE' | 'MATERIAL' | 'MAJOR'; rationale?: string; evidenceFindingIds?: string[]; confidence: 'LOW' | 'MEDIUM' | 'HIGH' }>;
  netOpportunityDirection: 'MATERIALLY_UP' | 'SLIGHTLY_UP' | 'NEUTRAL' | 'SLIGHTLY_DOWN' | 'MATERIALLY_DOWN';
  roleCertainty: 'LOW' | 'MEDIUM' | 'HIGH';
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
  researchGaps: unknown[];
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
}

export interface SelectedLineup {
  candidateId: string;
  bulletNumber: number;
  selectionType: string;
  explanation: string;
  newsContext: string[];
  rationale: string[];
  playerIds: string[];
  rosterSlots: Record<string, string>;
  salaryUsed: number;
  salaryRemaining: number;
  median: number;
  floor?: number;
  ceiling: number;
  watchItems: string[];
  readinessStatus: 'READY' | 'READY_WITH_WATCH';
}

export interface SelectionPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  selectedLineups: SelectedLineup[];
  optimizerGap?: string;
  warnings: string[];
  status: 'COMPLETE' | 'BLOCKED';
}
