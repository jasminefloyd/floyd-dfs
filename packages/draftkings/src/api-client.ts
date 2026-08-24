import {
  DEFAULT_DRAFTKINGS_API_ENDPOINTS,
  DRAFTKINGS_API_BASE_URL,
  DRAFTKINGS_LOBBY_BASE_URL,
  type DraftKingsApiBundle,
  type DraftKingsApiClientOptions,
  type DraftKingsApiEndpoints,
  type DraftKingsHttpResponse,
  type DraftKingsSportSummary,
} from "./provider";
import type { Sport } from "@sports-engine/contracts";
import { extractContestReference, extractContestSummaries, type DraftKingsContestReference } from "./contest-adapter";
import type { DraftKingsContestSummary } from "./provider";

export class DraftKingsApiError extends Error {
  constructor(
    message: string,
    readonly details: { url: string; status?: number; body?: unknown },
  ) {
    super(message);
    this.name = "DraftKingsApiError";
  }
}

export class DraftKingsApiClient {
  private readonly fetcher: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly lobbyBaseUrl: string;
  private readonly endpoints: DraftKingsApiEndpoints;
  private readonly sportCodes: DraftKingsApiClientOptions["sportCodes"];
  private readonly headers: Record<string, string>;

  constructor(options: DraftKingsApiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DRAFTKINGS_API_BASE_URL);
    this.lobbyBaseUrl = trimTrailingSlash(options.lobbyBaseUrl ?? DRAFTKINGS_LOBBY_BASE_URL);
    this.endpoints = { ...DEFAULT_DRAFTKINGS_API_ENDPOINTS, ...options.endpoints };
    this.sportCodes = options.sportCodes;
    this.headers = { accept: "application/json", ...options.headers };
  }

  async getContestLobby(sport: Sport): Promise<DraftKingsHttpResponse> {
    const sportCode = this.sportCodes[sport];
    if (!sportCode) throw new DraftKingsApiError(`No DraftKings sport code configured for ${sport}.`, { url: this.lobbyBaseUrl });
    return this.get(this.endpoints.contests, this.lobbyBaseUrl, { sport: sportCode });
  }

  async listSports(): Promise<DraftKingsSportSummary[]> {
    const response = await this.get(this.endpoints.sports, this.apiBaseUrl, { format: "json" });
    const record = response.data as { sports?: unknown };
    if (!record || !Array.isArray(record.sports)) throw new DraftKingsApiError("DraftKings sports response did not contain a sports array.", { url: response.url, body: response.data });
    return record.sports.map((value) => {
      if (!value || typeof value !== "object") throw new DraftKingsApiError("DraftKings sports response contained an invalid sport record.", { url: response.url, body: value });
      const sport = value as Record<string, unknown>;
      return {
        sportId: Number(sport.sportId),
        fullName: String(sport.fullName ?? ""),
        abbreviatedName: String(sport.regionAbbreviatedSportName ?? ""),
        hasPublicContests: Boolean(sport.hasPublicContests),
        isEnabled: Boolean(sport.isEnabled),
      };
    });
  }

  async listContests(sport: Sport): Promise<DraftKingsContestSummary[]> {
    const response = await this.getContestLobby(sport);
    return extractContestSummaries(response.data, sport);
  }

  async getContest(contestId: string): Promise<DraftKingsHttpResponse> {
    return this.get(this.endpoints.contest.replace("{contestId}", encodeURIComponent(contestId)), this.apiBaseUrl, { format: "json" });
  }

  async getDraftGroup(draftGroupId: string): Promise<DraftKingsHttpResponse> {
    return this.get(this.endpoints.draftGroup.replace("{draftGroupId}", encodeURIComponent(draftGroupId)), this.apiBaseUrl);
  }

  async getGameTypeRules(gameTypeId: string): Promise<DraftKingsHttpResponse> {
    return this.get(this.endpoints.gameTypeRules.replace("{gameTypeId}", encodeURIComponent(gameTypeId)), this.apiBaseUrl);
  }

  async getDraftables(draftGroupId: string): Promise<DraftKingsHttpResponse> {
    return this.get(this.endpoints.draftables.replace("{draftGroupId}", encodeURIComponent(draftGroupId)), this.apiBaseUrl);
  }

  async getSlateBundle(input: { contestId: string; draftGroupId: string; gameTypeId: string }): Promise<DraftKingsApiBundle> {
    const [contest, draftGroup, gameTypeRules, draftables] = await Promise.all([
      this.getContest(input.contestId),
      this.getDraftGroup(input.draftGroupId),
      this.getGameTypeRules(input.gameTypeId),
      this.getDraftables(input.draftGroupId),
    ]);

    return { contest, draftGroup, gameTypeRules, draftables };
  }

  async getSlateBundleForContest(input: { contestId: string; draftGroupId?: string; gameTypeId?: string }): Promise<DraftKingsApiBundle & { reference: DraftKingsContestReference }> {
    const contest = await this.getContest(input.contestId);
    const discovered = extractContestReference(contest.data, input.contestId);
    const reference = {
      ...discovered,
      draftGroupId: input.draftGroupId ?? discovered.draftGroupId,
      gameTypeId: input.gameTypeId ?? discovered.gameTypeId,
    };
    const [draftGroup, gameTypeRules, draftables] = await Promise.all([
      this.getDraftGroup(reference.draftGroupId),
      this.getGameTypeRules(reference.gameTypeId),
      this.getDraftables(reference.draftGroupId),
    ]);
    return { contest, draftGroup, gameTypeRules, draftables, reference };
  }

  private async get(path: string, baseUrl: string, query?: Record<string, string>): Promise<DraftKingsHttpResponse> {
    const url = new URL(path, `${baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    const response = await this.fetcher(url, { headers: this.headers });
    const body = await readBody(response);
    if (!response.ok) throw new DraftKingsApiError(`DraftKings request failed with HTTP ${response.status}.`, { url: url.toString(), status: response.status, body });

    return { data: body, url: url.toString(), retrievedAt: new Date().toISOString(), status: response.status };
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
