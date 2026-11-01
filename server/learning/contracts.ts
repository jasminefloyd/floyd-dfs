import type { Sport } from '../../src/lib/engine/contracts.js';
import type { SchemaVersionedContract } from '../intelligence/contracts.js';

export interface PredictionOutcomeIdentity extends SchemaVersionedContract {
  tenantId: string;
  sport: Sport;
  slateId: string;
  runId: string;
  playerId: string;
  modelVersion: string;
  asOf: string;
}

export interface VerifiedOutcomeState {
  status: 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'DISPUTED';
  verifiedAt?: string;
  sourceId?: string;
  evidenceIds: string[];
}
