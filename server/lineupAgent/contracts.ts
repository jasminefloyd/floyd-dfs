import type { ContestFormat, RosterRules, Sport, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import type { SchemaVersionedContract } from '../intelligence/contracts.js';

export interface LineupAgentIdentity extends SchemaVersionedContract {
  tenantId: string;
  sport: Sport;
  slateId: string;
  contestId: string;
  lineupId: string;
  projectionVersion: string;
  modelVersion: string;
}

export interface DraftKingsContestIdentity {
  contestId: string;
  slateId: string;
  sport: Sport;
  format: ContestFormat;
  lockAt: string;
}

export interface ContestSpec {
  specVersion: 'draftkings-contest-spec.v1';
  sport: Sport;
  slateId: string;
  contestId: string;
  name: string;
  format: ContestFormat;
  lockTime: string;
  entryFee: number | null;
  fieldSize: number | null;
  entryLimit: number | null;
  requestedEntries: number;
  salaryCap: number;
  rosterRules: RosterRules;
  multiplierRules: Record<string, { salaryMultiplier?: number; fantasyMultiplier?: number }>;
  scoringRules: ValidatedSlate['scoringRules'];
  sourceVersion: string;
  eligiblePlayerIds: string[];
  payoutTiers: Array<{ rank: number; payout: number }>;
  tieHandling: { rule: 'AVERAGE_PAYOUT_ACROSS_TIED_RANKS' | 'UNKNOWN'; provenance: 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNKNOWN' };
  lateSwap: { allowed: boolean | null; provenance: 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNKNOWN' };
  provenance: {
    contestIdentity: 'DRAFTKINGS_API' | 'DRAFTKINGS_PUBLIC_LOBBY' | 'UNKNOWN';
    rules: 'DRAFTKINGS_API' | 'DRAFTKINGS_PUBLISHED_RULE_PROFILE' | 'UNKNOWN';
    playerPool: 'DRAFTKINGS_API' | 'DRAFTKINGS_PUBLIC_PLAYER_CSV' | 'UNKNOWN';
    payout: 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNAVAILABLE';
    entryFee: 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNAVAILABLE';
    entryLimit: 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNAVAILABLE';
    fieldSize: 'DRAFTKINGS_PUBLIC_LOBBY' | 'DRAFTKINGS_API' | 'USER_CONFIRMED' | 'UNAVAILABLE';
  };
  readiness: 'READY' | 'PROJECTION_ONLY' | 'NEEDS_PAYOUTS' | 'NEEDS_FIELD_CALIBRATION' | 'INVALID';
  warnings: string[];
}
