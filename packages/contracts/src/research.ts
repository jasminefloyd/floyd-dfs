import type { Sport, ValidatedSlate } from "./index";

export type ResearchBucket =
  | "AVAILABILITY"
  | "RECENT_ROLE_FORM"
  | "MATCHUP_ENVIRONMENT"
  | "MARKET_SIGNALS"
  | "NEWS_EXTERNAL_CONTEXT"
  | "FIELD_SENTIMENT"
  | "COMPETITIVE_CONTEXT";

export type ResearchPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SourceTier = 1 | 2 | 3 | 4;
export type ResearchConfidence = "LOW" | "MEDIUM" | "HIGH";

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

export interface ResearchFinding {
  id: string;
  bucket: ResearchBucket;
  subjectType: "PLAYER" | "TEAM" | "EVENT" | "LEAGUE";
  subjectId: string;
  finding: string;
  sourceUrl?: string;
  sourceName: string;
  sourceTier: SourceTier;
  sourcePurpose: string;
  publishedAt?: string;
  retrievedAt: string;
  ageMinutes?: number;
  confidence: ResearchConfidence;
  conflictingFindingIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface AvailabilityResearch { playerId: string; status: "AVAILABLE" | "QUESTIONABLE" | "OUT" | "UNKNOWN"; evidenceFindingIds: string[]; }
export interface RoleFormResearch { playerId: string; summary: string; evidenceFindingIds: string[]; }
export interface MatchupEnvironmentResearch { summary: string; evidenceFindingIds: string[]; }
export interface MarketSignalResearch { summary: string; evidenceFindingIds: string[]; }
export interface FieldSentimentResearch { subjectId: string; summary: string; evidenceFindingIds: string[]; }
export interface CompetitiveContextResearch { summary: string; evidenceFindingIds: string[]; }
export interface PlayerEvidenceRecord { playerId: string; findingIds: string[]; unresolved: boolean; }
export interface ResearchConflict { findingIds: string[]; subjectId: string; summary: string; resolved: boolean; }
export interface ResearchUnknown { question: string; importance: ResearchPriority; reason: string; }
export interface WatchItem { subjectId?: string; reason: string; expectedChangeBeforeLock?: boolean; }
export interface ResearchGap { question: string; importance: ResearchPriority; reason: string; affectedPlayerIds: string[]; }

export interface ResearchPackage {
  slateId: string;
  tenantId: string;
  version: number;
  generatedAt: string;
  freshThrough: string;
  findings: ResearchFinding[];
  availability: AvailabilityResearch[];
  recentRoleForm: RoleFormResearch[];
  matchupEnvironment: MatchupEnvironmentResearch;
  marketSignals: MarketSignalResearch;
  newsExternalContext: ResearchFinding[];
  fieldSentiment: FieldSentimentResearch[];
  competitiveContext: CompetitiveContextResearch[];
  playerEvidence: PlayerEvidenceRecord[];
  conflicts: ResearchConflict[];
  unknowns: ResearchUnknown[];
  watchItems: WatchItem[];
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
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
  fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: unknown }): Promise<ResearchArticle[]>;
}

export interface ResearchSynthesizer {
  readonly name: string;
  synthesize(input: { slate: ValidatedSlate; plan: ResearchPlan; articles: ResearchArticle[]; signal?: unknown }): Promise<ResearchFinding[]>;
}

export interface ResearchAgentOptions {
  providers: ResearchSourceProvider[];
  synthesizer?: ResearchSynthesizer;
  now?: () => Date;
  version?: number;
}

export interface ResearchAgentInput {
  validatedSlate: ValidatedSlate;
  researchGaps?: ResearchGap[];
}

export interface ResearchRunRecord {
  id: string;
  tenantId: string;
  generationRunId: string;
  version: number;
  plan: ResearchPlan;
  researchPackage: ResearchPackage;
  status: ResearchPackage["status"];
  modelName?: string;
  promptVersion?: string;
  createdAt: string;
}

export type { Sport };
