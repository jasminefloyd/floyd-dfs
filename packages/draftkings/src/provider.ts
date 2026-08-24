import type { ContestFormat, SlateSource, Sport } from "@sports-engine/contracts";

export const DRAFTKINGS_API_BASE_URL = "https://api.draftkings.com";
export const DRAFTKINGS_LOBBY_BASE_URL = "https://www.draftkings.com";

export interface DraftKingsApiEndpoints {
  sports: string;
  contests: string;
  contest: string;
  draftGroup: string;
  gameTypeRules: string;
  draftables: string;
}

export const DEFAULT_DRAFTKINGS_API_ENDPOINTS: DraftKingsApiEndpoints = {
  sports: "/sites/US-DK/sports/v1/sports",
  contests: "/lobby/getcontests",
  contest: "/contests/v1/contests/{contestId}",
  draftGroup: "/draftgroups/v1/{draftGroupId}",
  gameTypeRules: "/lineups/v1/gametypes/{gameTypeId}/rules",
  draftables: "/draftgroups/v1/draftgroups/{draftGroupId}/draftables",
};

export interface DraftKingsContestSummary {
  draftKingsContestId: string;
  sport: Sport;
  format: ContestFormat;
  name: string;
  lockTime: string;
  contestSize?: number;
  maxEntriesAllowed?: number;
}

export interface DraftKingsSportSummary {
  sportId: number;
  fullName: string;
  abbreviatedName: string;
  hasPublicContests: boolean;
  isEnabled: boolean;
}

export interface DraftKingsProviderPayload {
  source: SlateSource;
  receivedAt: string;
  raw: unknown;
}

export interface DraftKingsSlatePayload {
  source: SlateSource;
  receivedAt: string;
  data: unknown;
}

export interface DraftKingsHttpResponse<T = unknown> {
  data: T;
  url: string;
  retrievedAt: string;
  status: number;
}

export interface DraftKingsApiClientOptions {
  fetcher?: typeof fetch;
  apiBaseUrl?: string;
  lobbyBaseUrl?: string;
  endpoints?: Partial<DraftKingsApiEndpoints>;
  sportCodes: Partial<Record<Sport, string>>;
  headers?: Record<string, string>;
}

export interface DraftKingsApiBundle {
  contest: DraftKingsHttpResponse;
  draftGroup: DraftKingsHttpResponse;
  gameTypeRules: DraftKingsHttpResponse;
  draftables: DraftKingsHttpResponse;
}

export interface DraftKingsProvider {
  listContests(sport: Sport): Promise<DraftKingsContestSummary[]>;
  getContest(id: string): Promise<DraftKingsProviderPayload>;
  getPlayerPool(id: string): Promise<DraftKingsProviderPayload>;
  getScoringRules(id: string): Promise<DraftKingsProviderPayload>;
  getRosterRules(id: string): Promise<DraftKingsProviderPayload>;
}

export interface DraftKingsApiProvider extends DraftKingsProvider {
  readonly source: "DRAFTKINGS_API";
}

export interface DraftKingsRssProvider extends DraftKingsProvider {
  readonly source: "DRAFTKINGS_RSS";
}
