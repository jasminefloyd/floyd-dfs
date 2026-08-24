import { describe, expect, it } from "vitest";
import type { ResearchPackage, ValidatedSlate } from "@sports-engine/contracts";
import { SportAdjustmentRouter, createSportAdjustmentStageHandler } from "./index";

const slate: ValidatedSlate = {
  slateId: "slate-1", tenantId: "tenant-1", userId: "user-1", requestId: "request-1", receivedAt: "2026-08-23T12:00:00.000Z", sport: "NBA", league: "NBA",
  event: { eventId: "event-1", name: "Test", eventDate: "2026-08-23T23:00:00.000Z", participants: ["A", "B"] },
  contest: { draftKingsContestId: "contest-1", name: "Test", format: "CLASSIC", lockTime: "2026-08-23T23:00:00.000Z", userEntryCount: 1 }, salaryCap: 50000,
  rosterRules: { rosterSize: 1, slots: { UTIL: { count: 1 } }, uniquePlayersRequired: true }, scoringRules: { points: { value: 1 } },
  playerPool: [{ playerId: "p1", playerName: "Alex Example", salary: 5000, eligibility: { UTIL: true } }], sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T12:00:00.000Z", fields: ["contest"] }], version: 1,
  validation: { status: "VALID", warnings: [], errors: [] }, createdAt: "2026-08-23T12:00:00.000Z",
};

function research(findings: ResearchPackage["findings"], status: ResearchPackage["status"] = "COMPLETE"): ResearchPackage {
  return { slateId: "slate-1", tenantId: "tenant-1", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", freshThrough: "2026-08-23T15:00:00.000Z", findings, availability: [], recentRoleForm: [], matchupEnvironment: { summary: "", evidenceFindingIds: [] }, marketSignals: { summary: "", evidenceFindingIds: [] }, newsExternalContext: [], fieldSentiment: [], competitiveContext: [], playerEvidence: [], conflicts: [], unknowns: [], watchItems: [], status };
}

describe("SportAdjustmentRouter", () => {
  it("routes all supported sports", () => {
    for (const sport of ["NBA", "WNBA", "NFL", "MLB", "GOLF"] as const) {
      const result = new SportAdjustmentRouter().adjust({ validatedSlate: { ...slate, sport }, researchPackage: research([]) });
      expect(result.sport).toBe(sport);
      expect(result.adjustments).toHaveLength(1);
    }
  });

  it("makes a major down adjustment only from explicit unavailability evidence", () => {
    const result = new SportAdjustmentRouter().adjust({ validatedSlate: slate, researchPackage: research([{ id: "finding-1", bucket: "AVAILABILITY", subjectType: "PLAYER", subjectId: "p1", finding: "Alex Example is ruled out.", sourceName: "Official Team", sourceTier: 1, sourcePurpose: "Official availability", retrievedAt: "2026-08-23T12:00:00.000Z", confidence: "HIGH" }]) });
    expect(result.adjustments[0].adjustments[0]).toMatchObject({ direction: "DOWN", magnitude: "MAJOR", evidenceFindingIds: ["finding-1"] });
    expect(result.adjustments[0].projectionNotes[0]).toContain("does not calculate fantasy points");
  });

  it("keeps partial evidence visible without forcing an identical rerun", () => {
    const result = new SportAdjustmentRouter().adjust({ validatedSlate: slate, researchPackage: research([], "PARTIAL") });
    expect(result.status).toBe("PARTIAL");
    expect(result.researchGaps).toEqual([]);
    expect(result.adjustments[0].roleCertainty).toBe("LOW");
  });
});

describe("orchestrator adapter", () => {
  it("blocks malformed stage input", async () => {
    const result = await createSportAdjustmentStageHandler()( {} , {} as never);
    expect(result.status).toBe("BLOCKED");
  });
});
