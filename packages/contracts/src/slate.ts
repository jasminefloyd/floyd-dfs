import type { ContestFormat, SlateSource, Sport, SlateValidationStatus } from "./index";

export interface SlateEvent {
  eventId: string;
  name: string;
  eventDate: string;
  participants: string[];
  venue?: string;
}

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

export interface ScoringRule {
  value: number;
  description?: string;
}

export type ScoringRules = Record<string, ScoringRule>;

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
  /** Explicit quantitative opportunity/rate inputs supplied by a trusted model or provider. */
  projectionInputs?: Record<string, number>;
}

export interface SourceManifestItem {
  source: SlateSource;
  receivedAt: string;
  fields: string[];
  reference?: string;
  payloadHash?: string;
}

export interface SlateInput {
  tenantId: string;
  userId: string;
  requestId: string;
  receivedAt: string;

  sport: Sport;
  league: string;
  event: SlateEvent;
  contest: {
    draftKingsContestId: string;
    name: string;
    format: ContestFormat;
    lockTime: string;
    contestSize?: number;
    userEntryCount: number;
    maxEntriesAllowed?: number;
  };

  salaryCap: number;
  rosterRules: RosterRules;
  scoringRules: ScoringRules;
  playerPool: SlatePlayer[];
  sourceManifest: SourceManifestItem[];
}

export interface ValidatedSlate extends SlateInput {
  slateId: string;
  version: number;
  validation: {
    status: SlateValidationStatus;
    warnings: string[];
    errors: string[];
  };
  createdAt: string;
}
