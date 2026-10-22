export type Sport = 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' | 'CFB';
export type ContestFormat = 'SHOWDOWN' | 'CLASSIC';
export type ContestObjective = 'MAX_FPTS' | 'TOP_10' | 'TOP_4' | 'FIRST_PLACE' | 'CASH' | 'SMALL_FIELD' | 'LARGE_FIELD';

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

/** Versioned boundary for artifacts exchanged between stages. Bump only when an artifact's
 * meaning or required fields change; the numeric `version` remains the run-local revision. */
export const ENGINE_CONTRACT_VERSION = '2026-10-21.1';
export const FDS_TRANSPORT_CONTRACT_VERSION = 'fds.transport.v1';
export type EngineRunMode = 'PRE_LOCK' | 'LIVE';

/** Stable tenant-scoped IDs are strings even when an upstream provider uses numeric IDs. */
export interface CanonicalIdentity {
  tenantId: string;
  sport: Sport;
  leagueId: string;
  seasonId: string;
  eventId: string;
  gameId: string;
  teamId: string;
  playerId: string;
  contestId: string;
  draftGroupId: string;
  gameType: ContestFormat;
  lineupId: string;
  entryId: string;
  generationRunId: string;
  revision: number;
  providerIds: Record<string, string>;
}

export interface LiveGameState {
  observedAt: string;
  source: string;
  eventId: string;
  status: 'PREGAME' | 'LIVE' | 'HALFTIME' | 'FINAL' | 'POSTPONED';
  period?: number;
  clockSeconds?: number;
  homeScore?: number;
  awayScore?: number;
  possessionTeam?: string;
  pace?: number;
  teamStats?: Record<string, Record<string, number>>;
  playerStats?: Record<string, Record<string, number>>;
  injuries?: Array<{ playerId: string; status: string; observedAt: string; source: string }>;
}

/** Immutable provider assertion captured for one slate/event. It is not yet a resolved fact. */
export interface SourceObservation {
  id: string;
  tenantId: string;
  slateId: string;
  sport: Sport;
  eventId: string;
  source: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  subject: { kind: 'PLAYER' | 'TEAM' | 'EVENT' | 'VENUE'; id: string };
  factType: string;
  value: unknown;
  effectiveAt?: string;
  observedAt: string;
  retrievedAt: string;
  expiresAt?: string;
  status: 'CONFIRMED' | 'PROJECTED' | 'REPORTED' | 'UNVERIFIED';
  identityConfidence: 'EXACT' | 'HIGH' | 'LOW' | 'CONFLICT';
  rawPayloadRef: string;
  gameId?: string;
  valueUnit?: string;
  publishedAt?: string;
  observedTimeBasis?: 'SOURCE_TIMESTAMP' | 'PUBLISHED_AT_PROXY' | 'RETRIEVAL_FALLBACK';
  duplicateClusterId?: string;
}

export interface ResolvedFact {
  id: string;
  observationIds: string[];
  tenantId: string;
  slateId: string;
  eventId: string;
  subjectId: string;
  factType: string;
  value?: unknown;
  state: 'ACCEPTED' | 'CONFLICT' | 'UNKNOWN' | 'EXPIRED';
  resolvedAt: string;
  ruleVersion: string;
  rationale: string;
  canonicalFactKey?: string;
  supportingObservationIds?: string[];
  rejectedObservationIds?: string[];
  decisionAt?: string;
}

export interface QuantitativeAdjustment {
  id: string;
  playerId: string;
  dimension: string;
  before: number;
  delta: number;
  after: number;
  unit: string;
  evidenceIds: string[];
  scenarioId?: string;
  modelVersion: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Transport/domain boundary additions. Database row mappings live in server/schemaManifest.ts. */
export interface SlateGame {
  gameId: string;
  providerIds: Record<string, string>;
  homeTeamId?: string;
  awayTeamId?: string;
  teamIds: string[];
  scheduledStart: string;
  lockTime?: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELLED' | 'UNKNOWN';
}

export interface QuantitativeEffect {
  id: string;
  tenantId: string;
  slateId: string;
  playerId: string;
  gameId?: string;
  targetDimension: string;
  baseline: number;
  operation: 'ADD' | 'MULTIPLY';
  amount: number;
  unit: string;
  finalValue: number;
  evidenceIds: string[];
  factIds: string[];
  scenarioId?: string;
  capApplied?: { minimum?: number; maximum?: number; reason: string };
  modelVersion: string;
  outcome: 'APPLIED' | 'CONTEXT_ONLY' | 'REJECTED' | 'SUPERSEDED';
  reason: string;
}

export interface PlayerPhotoMetadata {
  tenantId: string;
  playerId: string;
  providerId?: string;
  source: string;
  url: string | null;
  retrievedAt?: string;
  verifiedAt?: string;
  expiresAt?: string;
}

export interface LineupExplanation {
  tenantId: string;
  lineupId: string;
  revision: number;
  objective: string;
  search: { completeness: 'EXHAUSTIVE' | 'GAP_BOUNDED' | 'HEURISTIC'; algorithm: string; version: string; snapshotHash: string };
  playerReasons: Array<{ playerId: string; reason: string; factIds: string[]; effectIds: string[] }>;
  candidateTradeoffs: string[];
  risks: string[];
  missingInputs: string[];
  dataTimestamps: Record<string, string>;
  unsupportedOrUnusedContext: string[];
}

export interface LockState {
  tenantId: string;
  contestId: string;
  lateSwapAllowed: boolean | null;
  verification: 'VERIFIED' | 'UNKNOWN' | 'UNSUPPORTED';
  verifiedAt?: string;
  slots: Array<{ slotId: string; lockTime: string | null; lockSource: string | null; locked: boolean | null; playerId?: string }>;
}

export interface SwapPlan {
  tenantId: string;
  id: string;
  sourceLineupId: string;
  sourceRevision: number;
  entryId: string;
  trigger: string;
  constraintHash: string;
  snapshotHash: string;
  affectedSlots: string[];
  replacementRoster: Record<string, string>;
  salaryDelta: number;
  pointDelta: number;
  reason: string;
  expiresAt?: string;
  nextLockAt?: string;
  evidenceIds: string[];
  outcome: 'PENDING' | 'READY' | 'NO_SOLUTION' | 'STALE' | 'LOCKED' | 'UNKNOWN_LOCK_STATE';
}

export interface ProviderHealthResult {
  tenantId: string;
  endpointKey: string;
  endpointVersion: string;
  environment: string;
  sport?: Sport;
  format?: ContestFormat;
  resolvedRoute: string;
  startedAt: string;
  finishedAt: string;
  status: 'HEALTHY' | 'EMPTY' | 'UNAVAILABLE' | 'INVALID_SCHEMA' | 'IDENTITY_MISMATCH' | 'STALE' | 'RATE_LIMITED' | 'AUTH_BLOCKED';
  schemaVersion?: string;
  freshnessCheck: 'PASS' | 'FAIL' | 'UNKNOWN';
  identityCheck: 'PASS' | 'FAIL' | 'UNKNOWN';
  failureDetail?: string;
  retryCount: number;
  lastSuccessfulCompatibleCheck?: string;
}

export interface FdsApiError {
  code: 'EMPTY_PLAYER_POOL' | 'NO_LEGAL_LINEUP' | 'PROVIDER_UNAVAILABLE' | 'STALE_DATA' | 'BOUNDED_SEARCH' | 'UNAUTHORIZED' | 'TENANT_MISMATCH' | 'CONFLICT' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR';
  safeMessage: string;
  requestId: string;
  retriable: boolean;
  stage?: EngineStage;
  reasons: Array<{ code: string; message: string; details?: Record<string, string | number | boolean | null> }>;
}

export interface RunTrust {
  dataTier: 'COMPLETE' | 'DEGRADED' | 'BLOCKED';
  modelTier: 'UNVALIDATED' | 'PROJECTION_VALIDATED' | 'CONTEST_VALIDATED';
  recommendationStatus: 'ENTRY_READY' | 'PROVISIONAL' | 'BLOCKED';
  entryEligible: boolean;
  releaseReasons: string[];
  missingRequiredFacts: string[];
  staleFacts: string[];
  fallbackPlayers: string[];
  searchCompleteness: 'EXHAUSTIVE' | 'GAP_BOUNDED' | 'HEURISTIC';
  contestMetricState: 'CALIBRATED' | 'SIMULATED_UNVALIDATED' | 'UNAVAILABLE';
}

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

export interface PortfolioConstraints {
  maxPlayerExposure?: number;
  maxCaptainExposure?: number;
  maxLineupOverlap?: number;
}

export interface SlatePlayer {
  playerId: string;
  playerName: string;
  gameId?: string;
  photo?: PlayerPhotoMetadata;
  identity?: {
    draftKingsId?: string;
    espnId?: string;
    sportsDataIoId?: string;
    confidence: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
    matchedBy: 'DRAFTKINGS' | 'PROVIDER_ID' | 'NAME_AND_TEAM' | 'NAME_ONLY' | 'UNMAPPED';
  };
  /** Provider's slot-specific IDs are distinct in some CSV exports (for example, Showdown CPT/UTIL). */
  draftKingsSlotIds?: Record<string, string>;
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
    status: 'CONFIRMED_STARTER' | 'PROJECTED' | 'ACTIVE' | 'NOT_IN_CONFIRMED_LINEUP' | 'NOT_IN_PROVIDER_ROSTER' | 'INACTIVE' | 'OUT' | 'UNKNOWN';
    roleStatus?: 'CONFIRMED_STARTER' | 'EXPECTED_STARTER' | 'ROLE_UNCONFIRMED' | 'NOT_STARTER' | 'UNKNOWN';
    confirmed: boolean;
    source: string;
    retrievedAt: string;
    providerPlayerId?: string;
    mappedBy?: 'PROVIDER_ID' | 'NAME_AND_TEAM' | 'NAME_ONLY' | 'UNMAPPED';
    battingOrder?: number;
    note?: string;
  };
  /** Real Vegas market data (implied team total from game total + spread) for this player's
   * team, when a match against The Odds API's data was found -- see oddsProvider.ts's
   * getTeamMarketContext. Absent (not fabricated) when the fetch failed or no team match. */
  marketContext?: { impliedTeamTotal: number; spread: number; gameTotal: number };
  /** Optional provider-derived context. Missing fields are unknown, never inferred. */
  sportContext?: {
    /** Usage/target/carry shares and overtime probability are fractions from 0 to 1. */
    nba?: { activeRotation?: boolean; starter?: boolean; minutesP10?: number; minutesP50?: number; minutesP90?: number; limitedMinutesRisk?: number; minutesSampleCount?: number; minutesRetrievedAt?: string; paceMultiplier?: number; usageMultiplier?: number; overtimeProbability?: number; expectedOvertimePeriods?: number };
    mlb?: { battingOrder?: number; expectedPA?: number; pitcherRole?: 'STARTER' | 'RELIEVER' | 'OPENER' | 'UNKNOWN'; probableStarter?: boolean; probablePitcherId?: string; expectedInningsP10?: number; expectedInningsP50?: number; expectedInningsP90?: number; expectedPitchesP50?: number; recentPitchesLast3Days?: number; workloadSampleCount?: number; workloadRetrievedAt?: string; workloadWarning?: string; bullpenAvailability?: 'UNKNOWN' | 'RECENT_USAGE_OBSERVED'; platoonMultiplier?: number; parkRunMultiplier?: number; opposingStarterQuality?: number; bullpenQuality?: number; weatherRunMultiplier?: number; gameWeather?: { temperatureLow?: number; temperatureHigh?: number; windSpeed?: number; windDirection?: string; description?: string; retrievedAt: string } };
    nfl?: { expectedPlays?: number; passRate?: number; targetShare?: number; carryShare?: number; redZoneShare?: number; touchdownRateMultiplier?: number };
    cfb?: { expectedPlays?: number; passRate?: number; targetShare?: number; carryShare?: number; redZoneShare?: number; touchdownRateMultiplier?: number };
    golf?: { strokesGainedTotal?: number; courseFit?: number; weatherMultiplier?: number; cutProbability?: number; finishPositionP50?: number };
  };
  projectedOwnership?: { classic?: number; captain?: number; utility?: number; source: 'PROVIDER' | 'CALIBRATED_MODEL'; observedAt?: string };
}

export interface ValidatedSlate {
  slateId: string;
  version: number;
  tenantId: string;
  userId: string;
  requestId: string;
  receivedAt: string;
  contractVersion?: string;
  transportContractVersion?: string;
  games?: SlateGame[];
  runMode?: EngineRunMode;
  liveGameState?: LiveGameState;
  createdAt: string;
  sport: Sport;
  league: Sport;
  /** Structured provider diagnostics carried into Research for auditability. */
  providerDiagnostics?: Array<{ provider: string; status: 'SUCCEEDED' | 'EMPTY' | 'FAILED'; error?: string; httpStatus?: number; retrievedAt: string }>;
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
    contestKind?: 'CASH' | 'GPP' | 'UNKNOWN';
    objective?: ContestObjective;
    paidPositions?: number;
    entryFee?: number;
    payoutStructure?: Array<{ rank: number; payout: number }>;
  };
  salaryCap: number;
  rosterRules: RosterRules;
  scoringRules: Record<string, { value: number }>;
  playerPool: SlatePlayer[];
  sourceManifest: Array<{ source: string; receivedAt: string; fields: string[]; sourceUrl?: string; ruleVersion?: string }>;
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
  /** Same-slate pre-lock provider baseline, retained for paired validation only. */
  baselineFppg?: number;
  baselineOpportunity: Record<string, number>;
  adjustedOpportunity: Record<string, number>;
  opportunityDelta: Record<string, number>;
  componentProjection: Record<string, number>;
  projectedOutcomes: { floorP20: number; medianP50: number; ceilingP90: number };
  simulatedFantasyPointSamples?: number[];
  salaryEfficiency: { medianPer1k: number; ceilingPer1k: number };
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  uncertaintyFactors: string[];
  watchDependencies: string[];
  modelVersion: string;
  /** Present on new projections; optional only for persisted pre-Gate-2 records. */
  modelPath?: 'SPORT_STRUCTURED' | 'PROVIDER_FPPG_FALLBACK';
  distribution?: {
    family: 'SPORT_CORRELATED' | 'SPORT_EVENT' | 'GOLF_ROUND' | 'AGGREGATE_FPPG';
    correlationGroup?: string;
    drivers: string[];
  };
}

export interface ProjectionPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  contractVersion?: string;
  modelVersion: string;
  simulationRuns: number;
  players: PlayerProjection[];
  effectOutcomes?: Array<{ playerId: string; adjustmentType: string; state: 'APPLIED' | 'CONTEXT_ONLY' | 'REJECTED'; requestedEffect: number; acceptedEffect: number; capApplied?: number; finalValue?: number; dimension?: string; unit?: string; evidenceFindingIds: string[]; reason: string }>;
  gaps: Array<{ reason: string }>;
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
}

export type CandidateType = 'HIGHEST_MEDIAN' | 'HIGHEST_CEILING' | 'HEURISTIC_TOURNAMENT_RANK' | 'LEVERAGE' | 'LOW_DUPLICATION' | 'ALTERNATE_GAME_SCRIPT';
export type DuplicationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ObjectiveProfile {
  name: string;
  meanWeight?: number;
  medianWeight: number;
  ceilingWeight: number;
  leverageWeight: number;
  /** Heuristic construction-score points subtracted per 1.0 of the 0–1 ownership proxy. */
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
  /** Arithmetic mean of the modeled joint lineup outcome samples. */
  expectedPoints?: number;
  median: number;
  ceiling: number;
  correlationScore: number;
  /** Deterministic ranking score; not a simulated frequency or contest EV. */
  heuristicTournamentScore?: number;
  /** Salary/value and construction proxy; not measured field ownership. */
  heuristicOwnershipProxy?: number;
  heuristicLeverageScore?: number;
  heuristicDuplicationRisk?: DuplicationRisk;
  /** Construction-risk proxy; not an expected duplicate count. */
  heuristicDuplicationRiskScore?: number;
  medianRank: number;
  ceilingRank: number;
  heuristicTournamentRank?: number;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  optimalLineupFrequency?: number;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  ownershipEstimate?: number;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  leverageScore?: number;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  duplicationRisk?: DuplicationRisk;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  estimatedDuplicates?: number;
  /** @deprecated Compatibility for pre-Gate-0 fixtures/persisted records; never emit in new output. */
  tournamentRank?: number;
  candidateTypes: CandidateType[];
  gameScriptCluster: string;
  strategicSimilarity: number;
  riskFlags: string[];
  /** Contest metrics computed from explicit joint field simulations. */
  simulatedScoreSamples?: number[];
  variance?: number;
  /** Event frequency for rank 1. */
  winFrequency?: number;
  /** Fractional share of first-place ties. */
  fractionalWinCredit?: number;
  winFrequencyStandardError?: number;
  /** Event frequency for finishing in the top 1% by official rank. */
  topOnePercentFrequency?: number;
  /** Event frequency for finishing in an official paid rank. */
  cashFrequency?: number;
  cashFrequencyStandardError?: number;
  /** Event frequency for receiving a positive contest payout. */
  positivePayoutFrequency?: number;
  expectedDuplicates?: number;
  expectedPayout?: number;
  expectedPayoutStandardError?: number;
  expectedProfit?: number;
  roi?: number;
  contestMetricProvenance?: 'JOINT_FIELD_SIMULATION' | 'UNAVAILABLE';
  cashLineProbability?: number;
}

export interface OptimizerPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  contractVersion?: string;
  objectiveProfile: ObjectiveProfile;
  candidates: LineupCandidate[];
  warnings: string[];
  gaps: string[];
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
  engineState: 'MODEL_VALIDATION_REQUIRED';
  searchCompleteness?: 'EXHAUSTIVE' | 'BOUNDED';
  optimalityGap?: number;
  searchDiagnostics?: {
    algorithm: 'DETERMINISTIC_BRANCH_AND_BOUND' | 'DETERMINISTIC_VALUE_ORDERED_DFS';
    terminationReason: 'SEARCH_SPACE_EXHAUSTED' | 'OBJECTIVE_BOUND_PROVEN' | 'NODE_BUDGET';
    nodesVisited: number;
    elapsedMilliseconds: number;
    candidatesEvaluated: number;
    uniqueLineups: number;
    bestIncumbentObjective?: number;
    validUpperBound?: number;
    /** Raw objective-score units, not a normalized percentage gap. */
    objectiveGap?: number;
  };
  portfolioConstraints?: PortfolioConstraints;
  cashLineEstimate?: { value: number; source: 'MANUAL' | 'SIMULATED' };
  contestSimulation?: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    simulations: number;
    fieldEntries?: number;
    fieldModel: 'PROJECTED_OWNERSHIP' | 'UNAVAILABLE';
    payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'UNAVAILABLE';
    reason?: string;
    seed?: string;
    ownershipProvenance?: 'PROVIDER_SLOT_OWNERSHIP';
    dependenceModel?: 'INDEPENDENT_PLAYER_SAMPLES';
    rulesVersion?: string;
  };
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
  expiresAt?: string;
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
  diagnostic?: { status: 'SUCCEEDED' | 'EMPTY' | 'FAILED'; error?: string; httpStatus?: number; coverage?: string };
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
  contractVersion?: string;
  freshThrough: string;
  findings: ResearchFinding[];
  observations?: SourceObservation[];
  resolvedFacts?: ResolvedFact[];
  experimentalContextEffectsEnabled?: boolean;
  unknowns?: Array<{ question: string; importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; subjectId?: string }>;
  providerResults?: Array<{ provider: string; tier?: SourceTier; status: 'SUCCEEDED' | 'EMPTY' | 'FAILED'; articleCount: number; acceptedArticleCount?: number; rejectedArticleCount?: number; rejectionSamples?: string[]; error?: string; coverageDiagnostics?: string[]; attempted?: boolean; fallbackUsed?: boolean; httpStatus?: number; responseHeaders?: Record<string, string> }>;
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
  adjustments: Array<{ adjustmentType?: string; direction?: 'UP' | 'DOWN' | 'NEUTRAL'; magnitude: 'NONE' | 'SMALL' | 'MODERATE' | 'MATERIAL' | 'MAJOR'; rationale?: string; evidenceFindingIds?: string[]; canonicalFactKey?: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH' }>;
  netOpportunityDirection: 'MATERIALLY_UP' | 'SLIGHTLY_UP' | 'NEUTRAL' | 'SLIGHTLY_DOWN' | 'MATERIALLY_DOWN';
  netSignedMagnitude: number;
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
  contractVersion?: string;
  adjustments: PlayerAdjustment[];
  researchGaps: unknown[];
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
  warnings?: string[];
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
  expectedPoints?: number;
  median: number;
  floor?: number;
  ceiling: number;
  watchItems: string[];
  readinessStatus: 'READY' | 'READY_WITH_WATCH' | 'PROVISIONAL';
  cashLineProbability?: number;
  cashLineConfidence?: 'CALIBRATED' | 'SIMULATED_ESTIMATE' | 'UNAVAILABLE';
}

export interface SelectionPackage {
  slateId: string;
  tenantId: string;
  sport: Sport;
  version: number;
  generatedAt: string;
  contractVersion?: string;
  selectedLineups: SelectedLineup[];
  optimizerGap?: string;
  warnings: string[];
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
  engineState: 'MODEL_VALIDATION_REQUIRED';
}
