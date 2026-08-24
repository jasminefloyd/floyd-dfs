import { describe, expect, it } from "vitest";
import type { AdjustmentPackage, ResearchPackage, ValidatedSlate } from "@sports-engine/contracts";
import { ProjectionService, createProjectionStageHandler } from "./index";

const slate: ValidatedSlate = {
  slateId: "slate-1", tenantId: "tenant-1", userId: "user-1", requestId: "request-1", receivedAt: "2026-08-23T12:00:00.000Z", sport: "NBA", league: "NBA",
  event: { eventId: "event-1", name: "Test", eventDate: "2026-08-23T23:00:00.000Z", participants: ["A", "B"] }, contest: { draftKingsContestId: "contest-1", name: "Test", format: "CLASSIC", lockTime: "2026-08-23T23:00:00.000Z", userEntryCount: 1 }, salaryCap: 50000,
  rosterRules: { rosterSize: 1, slots: { UTIL: { count: 1 } }, uniquePlayersRequired: true }, scoringRules: { points: { value: 1 }, rebounds: { value: 1.25 }, assists: { value: 1.5 }, threes: { value: 0.5 }, steals: { value: 3 }, blocks: { value: 3 }, turnovers: { value: -0.5 } },
  playerPool: [{ playerId: "p1", playerName: "Alex Example", salary: 5000, eligibility: { UTIL: true }, projectionInputs: { expectedMinutes: 30, pointsPerMinute: 0.7, reboundsPerMinute: 0.2, assistsPerMinute: 0.15, stealsPerMinute: 0.05, blocksPerMinute: 0.03, turnoversPerMinute: 0.08, threesPerMinute: 0.08 } }], sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T12:00:00.000Z", fields: ["contest"] }], version: 1, validation: { status: "VALID", warnings: [], errors: [] }, createdAt: "2026-08-23T12:00:00.000Z",
};
const research = { slateId: "slate-1", tenantId: "tenant-1", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", freshThrough: "2026-08-23T15:00:00.000Z", findings: [], availability: [], recentRoleForm: [], matchupEnvironment: { summary: "", evidenceFindingIds: [] }, marketSignals: { summary: "", evidenceFindingIds: [] }, newsExternalContext: [], fieldSentiment: [], competitiveContext: [], playerEvidence: [], conflicts: [], unknowns: [], watchItems: [], status: "COMPLETE" } as ResearchPackage;
const adjustment = { slateId: "slate-1", tenantId: "tenant-1", sport: "NBA", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", adjustments: [{ playerId: "p1", baselineContext: {}, adjustments: [{ adjustmentType: "ROLE", direction: "UP", magnitude: "SMALL", rationale: "Starting role verified.", evidenceFindingIds: ["finding-1"], confidence: "HIGH" }], netOpportunityDirection: "SLIGHTLY_UP", roleCertainty: "HIGH", keyDeltas: [], projectionNotes: [] }], researchGaps: [], status: "COMPLETE" } as AdjustmentPackage;

describe("ProjectionService", () => {
  it("requires explicit opportunity inputs", () => {
    const result = new ProjectionService().project({ validatedSlate: { ...slate, playerPool: [{ ...slate.playerPool[0], projectionInputs: undefined }] }, researchPackage: research, adjustmentPackage: adjustment });
    expect(result.status).toBe("BLOCKED");
    expect(result.players).toHaveLength(0);
    expect(result.gaps[0].importance).toBe("CRITICAL");
  });

  it("maps opportunity through adjustments and DraftKings scoring into P20/P50/P90", () => {
    const result = new ProjectionService().project({ validatedSlate: slate, researchPackage: research, adjustmentPackage: adjustment }, new Date("2026-08-23T12:00:00.000Z"));
    const player = result.players[0];
    expect(result.status).toBe("COMPLETE");
    expect(player.adjustedOpportunity.expectedMinutes).toBeGreaterThan(player.baselineOpportunity.expectedMinutes);
    expect(player.projectedOutcomes.floorP20).toBeLessThanOrEqual(player.projectedOutcomes.medianP50);
    expect(player.projectedOutcomes.medianP50).toBeLessThanOrEqual(player.projectedOutcomes.ceilingP90);
    expect(player.salaryEfficiency.medianPer1k).toBeGreaterThan(0);
  });
});

describe("orchestrator adapter", () => {
  it("blocks incomplete projection input", async () => {
    const result = await createProjectionStageHandler()({}, {} as never);
    expect(result.status).toBe("BLOCKED");
  });
});
