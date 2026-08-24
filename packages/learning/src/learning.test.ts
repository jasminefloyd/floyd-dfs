import { describe, expect, it } from "vitest";
import type { ContestResult, EnteredLineupRecord, PlayerMeasurement } from "@sports-engine/contracts";
import { DeterministicLearningService, createLearningStageHandler } from "./index";

const entered: EnteredLineupRecord = { id: "line-1", tenantId: "tenant-1", slateId: "slate-1", lineupId: "lineup-1", bulletNumber: 1, enteredAt: "2026-08-23T12:00:00.000Z", projectionSnapshot: { floor: 100, median: 150, ceiling: 200 }, researchVersion: 1, adjustmentVersion: 1, projectionVersion: 1, optimizerVersion: 1, selectionVersion: 1 };
const event = { id: "event-1", tenantId: "tenant-1", generationRunId: "run-1", eventType: "PLAYER_INJURY", subject: "p1", materiality: "CRITICAL", source: { source: "official" }, detectedAt: "2026-08-23T12:00:00.000Z" } as const;

describe("Learning Loop", () => {
  it("requires explicit confirmation before changing an entered lineup", () => {
    const result = new DeterministicLearningService().preLock({ enteredLineups: [entered], changeEvents: [event] });
    expect(result.decision).toBe("REBUILD");
    expect(result.requiresUserConfirmation).toBe(true);
    expect(result.immutableLineupIds).toEqual(["line-1"]);
  });
  it("keeps lineups when no material change is detected", () => {
    const result = new DeterministicLearningService().preLock({ enteredLineups: [entered], changeEvents: [] });
    expect(result.decision).toBe("KEEP");
  });
  it("measures range inclusion and diagnoses opportunity error", () => {
    const measurement: PlayerMeasurement = { id: "m1", tenantId: "tenant-1", generatedLineupId: "line-1", playerId: "p1", projectedOpportunity: { minutes: 30 }, actualOpportunity: { minutes: 20 }, projectedFloor: 10, projectedMedian: 20, projectedCeiling: 30, actualDk: 18 };
    const measured = new DeterministicLearningService().measure({ result: { id: "result-1", tenantId: "tenant-1", generatedLineupId: "line-1", measuredAt: "2026-08-23T12:00:00.000Z" }, measurements: [measurement] });
    expect(measured.measurements[0].projectionError).toBe(-2);
    const diagnosis = new DeterministicLearningService().diagnose({ generationRunId: "run-1", tenantId: "tenant-1", sport: "NBA", result: measured.result, measurements: measured.measurements, generalizable: true });
    expect(diagnosis.diagnostic.errorStage).toBe("PROJECTION");
    expect(diagnosis.lesson?.status).toBe("OBSERVED");
  });
});

describe("Learning adapter", () => { it("rejects an unsupported action", async () => { const result = await createLearningStageHandler()({ action: "UNKNOWN" }, {} as never); expect(result.status).toBe("BLOCKED"); }); });
