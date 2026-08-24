import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, SourceTier, Sport, ValidatedSlate } from "@sports-engine/contracts";
import { parseAvailabilityRecords, type AvailabilitySnapshot } from "./availability";

export interface SportsDataIoClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

/** SportsDataIO's league APIs share https://api.sportsdata.io/v3/{league}. */
export class SportsDataIoClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly options: SportsDataIoClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.sportsdata.io/v3").replace(/\/+$/, "");
    if (!options.apiKey) throw new Error("SportsDataIO API key is required.");
  }

  async get<T>(sport: Sport, feed: string, resource: string, parameter?: string, signal?: AbortSignal): Promise<T> {
    const league = sport.toLowerCase();
    const path = [this.baseUrl, league, feed, "json", resource, parameter].filter(Boolean).join("/");
    const response = await this.fetcher(path, {
      signal,
      headers: { accept: "application/json", "Ocp-Apim-Subscription-Key": this.options.apiKey },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new Error(`SportsDataIO access denied for ${sport} ${feed}/${resource} (HTTP ${response.status}). Check subscription feed permissions.`);
      }
      throw new Error(`SportsDataIO ${sport} ${feed}/${resource} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`);
    }
    return await response.json() as T;
  }

  async getAvailabilitySnapshot(slate: ValidatedSlate, signal?: AbortSignal): Promise<AvailabilitySnapshot> {
    const date = slate.event.eventDate.slice(0, 10);
    if (slate.sport === "MLB") {
      const payload = await this.get<unknown>("MLB", "projections", "StartingLineupsByDate", date, signal);
      return parseAvailabilityRecords(payload, slate.sport, new Date().toISOString());
    }
    // SportsDataIO documents that WNBA has no confirmed pregame lineup feed
    // and NFL has no single confirmed-lineup endpoint. Optional configured
    // feeds may still provide active/inactive data without inventing a source.
    const configured = slate.sport === "WNBA" ? process.env.SPORTS_DATA_IO_WNBA_AVAILABILITY_RESOURCE : process.env.SPORTS_DATA_IO_NFL_AVAILABILITY_RESOURCE;
    const feed = slate.sport === "WNBA" ? process.env.SPORTS_DATA_IO_WNBA_AVAILABILITY_FEED : process.env.SPORTS_DATA_IO_NFL_AVAILABILITY_FEED;
    if (!configured || !feed) return { source: "SPORTSDATAIO", retrievedAt: new Date().toISOString(), records: [], confirmedLineupAvailable: false, note: `${slate.sport} has no configured provider availability feed.` };
    const payload = await this.get<unknown>(slate.sport, feed, configured, date, signal);
    return parseAvailabilityRecords(payload, slate.sport, new Date().toISOString());
  }
}

export interface SportsDataIoResearchProviderOptions {
  client: SportsDataIoClient;
  feed?: string;
  resource?: string;
  tier?: SourceTier;
}

/** Optional schedule/context provider. DraftKings remains authoritative for slate definition. */
export class SportsDataIoResearchProvider implements ResearchSourceProvider {
  readonly name = "SportsDataIO";
  readonly tier: SourceTier;
  constructor(private readonly options: SportsDataIoResearchProviderOptions) {
    this.tier = options.tier ?? 2;
  }

  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const date = input.slate.event.eventDate.slice(0, 10);
    const feed = this.options.feed ?? "scores";
    const resource = this.options.resource ?? "GamesByDate";
    const payload = await this.options.client.get<unknown>(input.slate.sport, feed, resource, date, input.signal);
    const rows = Array.isArray(payload) ? payload : [];
    return rows.slice(0, 20).map((row, index) => ({
      title: `${input.slate.sport} schedule context ${index + 1}`,
      sourceName: this.name,
      sourceTier: this.tier,
      summary: summarize(row),
      tags: [input.slate.sport, "sportsdataio"],
    }));
  }
}

function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "No schedule context returned.");
  const row = value as Record<string, unknown>;
  const fields = ["Status", "Date", "HomeTeam", "AwayTeam", "HomeTeamName", "AwayTeamName", "VenueName", "StadiumDetails"];
  const parts = fields.flatMap((field) => typeof row[field] === "string" || typeof row[field] === "number" ? [`${field}: ${row[field]}`] : []);
  return parts.join("; ") || JSON.stringify(value).slice(0, 500);
}
