import { describe, expect, it } from "vitest";
import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, ValidatedSlate } from "@sports-engine/contracts";
import { DeterministicSelectionService, createSelectionStageHandler } from "./index";

const slate = { slateId: "slate-1", tenantId: "tenant-1", sport: "NBA", contest: { draftKingsContestId: "c1", name: "Test", format: "CLASSIC", lockTime: "2026-08-23T23:00:00.000Z", userEntryCount: 1, contestSize: 100 }, playerPool: [], validation: { warnings: [], errors: [], status: "VALID" } } as unknown as ValidatedSlate;
const research = { findings: [], unknowns: [], status: "COMPLETE" } as unknown as ResearchPackage;
const adjustment = {} as AdjustmentPackage;
const projection = {} as ProjectionPackage;
const optimizer = { candidates: [{ id: "candidate-1", playerIds: ["p1"], rosterSlots: { UTIL: "p1" }, salaryUsed: 5000, salaryRemaining: 45000, floor: 10, median: 20, ceiling: 30, correlationScore: 0, optimalLineupFrequency: 1, topOnePercentFrequency: 1, ownershipEstimate: .2, leverageScore: .8, duplicationRisk: "LOW", estimatedDuplicates: 2, medianRank: 1, ceilingRank: 1, tournamentRank: 1, candidateTypes: ["HIGHEST_MEDIAN"], gameScriptCluster: "SINGLE", strategicSimilarity: 0, riskFlags: [] }], status: "COMPLETE" } as unknown as OptimizerPackage;

describe("Selection service", () => {
  it("selects only an existing optimizer candidate and explains it", () => {
    const result = new DeterministicSelectionService().select({ validatedSlate: slate, researchPackage: research, adjustmentPackage: adjustment, projectionPackage: projection, optimizerPackage: optimizer });
    expect(result.status).toBe("COMPLETE");
    expect(result.selectedLineups[0].candidateId).toBe("candidate-1");
    expect(result.selectedLineups[0].rationale.length).toBeGreaterThan(0);
  });
  it("blocks when optimizer candidates are absent", () => {
    const result = new DeterministicSelectionService().select({ validatedSlate: slate, researchPackage: research, adjustmentPackage: adjustment, projectionPackage: projection, optimizerPackage: { ...optimizer, candidates: [] } });
    expect(result.status).toBe("BLOCKED");
    expect(result.optimizerGap).toBeTruthy();
  });
});

describe("Selection adapter", () => { it("blocks malformed input", async () => { const result = await createSelectionStageHandler()({}, {} as never); expect(result.status).toBe("BLOCKED"); }); });
