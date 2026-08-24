import { describe, expect, it } from "vitest";
import type { AdjustmentPackage, OptimizerInput, ProjectionPackage, ResearchPackage, ValidatedSlate } from "@sports-engine/contracts";
import { DeterministicOptimizer, createOptimizeStageHandler } from "./index";

const slate: ValidatedSlate = {
  slateId: "slate-1", tenantId: "tenant-1", userId: "user-1", requestId: "request-1", receivedAt: "2026-08-23T12:00:00.000Z", sport: "NBA", league: "NBA",
  event: { eventId: "event-1", name: "Test", eventDate: "2026-08-23T23:00:00.000Z", participants: ["A", "B"] }, contest: { draftKingsContestId: "contest-1", name: "Test", format: "CLASSIC", lockTime: "2026-08-23T23:00:00.000Z", userEntryCount: 1, contestSize: 100 }, salaryCap: 10000,
  rosterRules: { rosterSize: 2, slots: { G: { count: 1 }, F: { count: 1 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2, maximumPlayersPerTeam: 2 } }, scoringRules: { points: { value: 1 } },
  playerPool: [
    { playerId: "p1", playerName: "One", team: "A", salary: 5000, eligibility: { G: true, F: false } },
    { playerId: "p2", playerName: "Two", team: "B", salary: 4500, eligibility: { G: false, F: true } },
    { playerId: "p3", playerName: "Three", team: "A", salary: 4000, eligibility: { G: true, F: true } },
  ], sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T12:00:00.000Z", fields: ["contest"] }], version: 1, validation: { status: "VALID", warnings: [], errors: [] }, createdAt: "2026-08-23T12:00:00.000Z",
};
const research = { slateId: "slate-1", tenantId: "tenant-1", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", freshThrough: "2026-08-23T15:00:00.000Z", findings: [], availability: [], recentRoleForm: [], matchupEnvironment: { summary: "", evidenceFindingIds: [] }, marketSignals: { summary: "", evidenceFindingIds: [] }, newsExternalContext: [], fieldSentiment: [], competitiveContext: [], playerEvidence: [], conflicts: [], unknowns: [], watchItems: [], status: "COMPLETE" } as ResearchPackage;
const adjustment = { slateId: "slate-1", tenantId: "tenant-1", sport: "NBA", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", adjustments: [], researchGaps: [], status: "COMPLETE" } as AdjustmentPackage;
const projection = { slateId: "slate-1", tenantId: "tenant-1", sport: "NBA", version: 1, generatedAt: "2026-08-23T12:00:00.000Z", modelVersion: "test", simulationRuns: 10, players: [
  { playerId: "p1", salary: 5000, baselineOpportunity: {}, adjustedOpportunity: {}, opportunityDelta: {}, componentProjection: { points: 30 }, projectedOutcomes: { floorP20: 20, medianP50: 30, ceilingP90: 45 }, salaryEfficiency: { medianPer1k: 6, ceilingPer1k: 9 }, confidence: "HIGH", uncertaintyFactors: [], watchDependencies: [], modelVersion: "test" },
  { playerId: "p2", salary: 4500, baselineOpportunity: {}, adjustedOpportunity: {}, opportunityDelta: {}, componentProjection: { points: 20 }, projectedOutcomes: { floorP20: 15, medianP50: 20, ceilingP90: 30 }, salaryEfficiency: { medianPer1k: 4.4, ceilingPer1k: 6.6 }, confidence: "HIGH", uncertaintyFactors: [], watchDependencies: [], modelVersion: "test" },
  { playerId: "p3", salary: 4000, baselineOpportunity: {}, adjustedOpportunity: {}, opportunityDelta: {}, componentProjection: { points: 25 }, projectedOutcomes: { floorP20: 18, medianP50: 25, ceilingP90: 38 }, salaryEfficiency: { medianPer1k: 6.25, ceilingPer1k: 9.5 }, confidence: "HIGH", uncertaintyFactors: [], watchDependencies: [], modelVersion: "test" },
], gaps: [], status: "COMPLETE" } as ProjectionPackage;
const input: OptimizerInput = { validatedSlate: slate, researchPackage: research, adjustmentPackage: adjustment, projectionPackage: projection };

describe("DeterministicOptimizer", () => {
  it("generates only legal roster combinations and metrics", () => {
    const result = new DeterministicOptimizer().optimize(input, { maxCandidates: 20 }, new Date("2026-08-23T12:00:00.000Z"));
    expect(result.status).toBe("COMPLETE");
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.salaryUsed).toBeLessThanOrEqual(slate.salaryCap);
      expect(new Set(candidate.playerIds).size).toBe(candidate.playerIds.length);
      expect(candidate.rosterSlots.G).toBeTruthy();
      expect(candidate.rosterSlots.F).toBeTruthy();
      expect(new Set(candidate.playerIds.map((id) => slate.playerPool.find((player) => player.playerId === id)?.team)).size).toBeGreaterThanOrEqual(2);
      expect(candidate.candidateTypes.length).toBeGreaterThan(0);
    }
  });

  it("blocks when projections are blocked", () => {
    const result = new DeterministicOptimizer().optimize({ ...input, projectionPackage: { ...projection, status: "BLOCKED", players: [] } });
    expect(result.status).toBe("BLOCKED");
    expect(result.candidates).toHaveLength(0);
  });

  it("uses contest size to choose the optimizer objective profile", () => {
    const smallField = new DeterministicOptimizer().optimize({ ...input, validatedSlate: { ...slate, contest: { ...slate.contest, contestSize: 713 } } });
    const largeField = new DeterministicOptimizer().optimize({ ...input, validatedSlate: { ...slate, contest: { ...slate.contest, contestSize: 50_000 } } });

    expect(smallField.objectiveProfile.name).toBe("small-field");
    expect(largeField.objectiveProfile.name).toBe("large-field-gpp");
  });
});

describe("orchestrator adapter", () => {
  it("blocks malformed optimize input", async () => {
    const result = await createOptimizeStageHandler()({}, {} as never);
    expect(result.status).toBe("BLOCKED");
  });
});
