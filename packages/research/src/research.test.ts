import { describe, expect, it } from "vitest";
import type { ValidatedSlate } from "@sports-engine/contracts";
import { ResearchAgent, RssResearchProvider, createResearchPlan, parseRss } from "./index";

const slate: ValidatedSlate = {
  slateId: "slate-1", tenantId: "tenant-1", userId: "user-1", requestId: "request-1", receivedAt: "2026-08-23T12:00:00.000Z",
  sport: "NBA", league: "NBA", event: { eventId: "event-1", name: "Test Game", eventDate: "2026-08-23T23:00:00.000Z", participants: ["A", "B"] },
  contest: { draftKingsContestId: "contest-1", name: "Test", format: "CLASSIC", lockTime: "2026-08-23T23:00:00.000Z", userEntryCount: 1 }, salaryCap: 50000,
  rosterRules: { rosterSize: 1, slots: { UTIL: { count: 1 } }, uniquePlayersRequired: true }, scoringRules: { points: { value: 1 } },
  playerPool: [{ playerId: "player-1", playerName: "Alex Example", salary: 5000, eligibility: { UTIL: true } }],
  sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T12:00:00.000Z", fields: ["contest"] }],
  version: 1, validation: { status: "VALID", warnings: [], errors: [] }, createdAt: "2026-08-23T12:00:00.000Z",
};

describe("research planner", () => {
  it("creates all seven research buckets plus player availability", () => {
    const plan = createResearchPlan(slate, new Date("2026-08-23T12:00:00.000Z"));
    expect(new Set(plan.questions.map((question) => question.bucket)).size).toBe(7);
    expect(plan.questions.some((question) => question.subjectId === "player-1")).toBe(true);
  });
});

describe("RSS provider normalization", () => {
  it("parses CDATA, entities, links, and publication dates", () => {
    const articles = parseRss('<rss><channel><item><title><![CDATA[Alex &amp; status]]></title><link>https://example.test/a</link><description>Available &amp; starting</description><pubDate>Sun, 23 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>', { url: "https://example.test/feed", name: "Example", tier: 2 });
    expect(articles[0]).toMatchObject({ title: "Alex & status", url: "https://example.test/a", sourceTier: 2 });
  });

  it("treats HTTP 304 as an empty successful feed response", async () => {
    const provider = new RssResearchProvider({ url: "https://example.test/feed", name: "Example", tier: 2 }, async () => new Response(null, { status: 304 }));
    await expect(provider.fetch({ slate, plan: createResearchPlan(slate, new Date("2026-08-23T12:00:00.000Z")) })).resolves.toEqual([]);
  });
});

describe("ResearchAgent", () => {
  it("preserves multi-tier evidence conflicts and never emits projections", async () => {
    const agent = new ResearchAgent({ now: () => new Date("2026-08-23T12:00:00.000Z"), providers: [
      { name: "Official", tier: 1, fetch: async () => [{ title: "Alex Example available", sourceName: "Official", sourceTier: 1, summary: "Available", publishedAt: "2026-08-23T11:30:00.000Z" }] },
      { name: "Specialist", tier: 3, fetch: async () => [{ title: "Alex Example questionable", sourceName: "Specialist", sourceTier: 3, summary: "Questionable", publishedAt: "2026-08-23T11:45:00.000Z" }] },
    ] });
    const result = await agent.run({ validatedSlate: slate });
    expect(result.status).toBe("PARTIAL");
    expect(result.conflicts).toHaveLength(1);
    expect(result.findings.every((finding) => !("projectedPoints" in finding))).toBe(true);
  });

  it("blocks when no provider is configured", async () => {
    const result = await new ResearchAgent({ providers: [] }).run({ validatedSlate: slate });
    expect(result.status).toBe("BLOCKED");
    expect(result.unknowns[0].importance).toBe("CRITICAL");
  });

  it("does not carry explicitly foreign-sport RSS evidence into a slate", async () => {
    const wnbaSlate = { ...slate, sport: "WNBA" as const, league: "WNBA" };
    const agent = new ResearchAgent({ providers: [{ name: "DraftKings Network", tier: 3, fetch: async () => [
      { title: "WNBA availability update", sourceName: "DraftKings Network", sourceTier: 3, summary: "Alex Example is available for the WNBA slate." },
      { title: "MLB availability update", sourceName: "DraftKings Network", sourceTier: 3, summary: "MLB pitchers are highlighted." },
    ] }] });
    const result = await agent.run({ validatedSlate: wnbaSlate });
    expect(result.findings.some((finding) => finding.finding.includes("MLB pitchers"))).toBe(false);
    expect(result.findings.some((finding) => finding.finding.includes("Alex Example"))).toBe(true);
  });

  it("excludes unrelated same-sport articles from slate evidence", async () => {
    const agent = new ResearchAgent({ providers: [{ name: "ESPN MLB", tier: 2, fetch: async () => [
      { title: "MLB league update", sourceName: "ESPN MLB", sourceTier: 2, summary: "A general league update with no slate participant." },
      { title: "Alex Example lineup update", sourceName: "ESPN MLB", sourceTier: 2, summary: "Alex Example is expected to start." },
    ] }] });
    const result = await agent.run({ validatedSlate: { ...slate, sport: "MLB", league: "MLB" } });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.finding).toContain("Alex Example");
  });
});
