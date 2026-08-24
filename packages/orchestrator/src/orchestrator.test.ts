import { describe, expect, it } from "vitest";
import type { EngineStage, StageExecutionResult } from "@sports-engine/contracts";
import { InMemoryOrchestratorRepository } from "./memory-repository";
import { SportsEngineOrchestrator } from "./orchestrator";
import type { OrchestratorOptions, StageContract, StageHandler } from "./types";

const stages: EngineStage[] = ["SLATE", "RESEARCH", "SPORT_ADJUSTMENT", "PROJECTION", "OPTIMIZE", "SELECTION"];
const identity: StageContract = { parse: (output) => output };

function options(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  const handlers: Partial<Record<EngineStage, StageHandler>> = Object.fromEntries(stages.map((stage) => [stage, async () => ({ status: "COMPLETE", output: { stage } })]));
  const contracts: Partial<Record<EngineStage, StageContract>> = Object.fromEntries(stages.map((stage) => [stage, identity]));
  return {
    repository: new InMemoryOrchestratorRepository(),
    handlers,
    contracts,
    now: () => new Date("2026-08-23T16:00:00.000Z"),
    ...overrides,
  };
}

describe("SportsEngineOrchestrator", () => {
  it("runs the complete generation pipeline in order and persists lineage", async () => {
    const repository = new InMemoryOrchestratorRepository();
    const calls: string[] = [];
    const base = options({ repository });
    base.handlers = Object.fromEntries(stages.map((stage) => [stage, async () => {
      calls.push(stage);
      return { status: "COMPLETE", output: { stage } };
    }]));
    const orchestrator = new SportsEngineOrchestrator(base);

    const result = await orchestrator.startGeneration({ tenantId: "tenant-1", userId: "user-1", requestId: "request-1", requestedEntryCount: 1, input: { raw: true } });

    expect(result.run.state).toBe("ready");
    expect(result.run.lineage).toEqual({ SLATE: 1, RESEARCH: 1, SPORT_ADJUSTMENT: 1, PROJECTION: 1, OPTIMIZE: 1, SELECTION: 1 });
    expect(result.selectionOutput).toEqual({ stage: "SELECTION" });
    expect(calls).toEqual(stages);
    expect(repository.stageRuns).toHaveLength(6);
  });

  it("stops immediately when a critical stage is BLOCKED", async () => {
    const calls: string[] = [];
    const base = options();
    base.handlers = Object.fromEntries(stages.map((stage) => [stage, async () => {
      calls.push(stage);
      return stage === "PROJECTION"
        ? { status: "BLOCKED", errors: ["Scoring rules unavailable."] }
        : { status: "COMPLETE", output: { stage } };
    }]));
    const result = await new SportsEngineOrchestrator(base).startGeneration({ tenantId: "tenant-1", userId: "user-1", requestId: "request-2", requestedEntryCount: 1, input: {} });

    expect(result.run.state).toBe("blocked");
    expect(result.run.currentStage).toBe("PROJECTION");
    expect(calls).toEqual(["SLATE", "RESEARCH", "SPORT_ADJUSTMENT", "PROJECTION"]);
    expect(result.selectionOutput).toBeUndefined();
  });

  it("routes a ResearchGap back through Research and reruns downstream stages", async () => {
    const repository = new InMemoryOrchestratorRepository();
    let adjustmentAttempts = 0;
    const researchInputs: unknown[] = [];
    const base = options({ repository });
    base.handlers = {
      SLATE: async () => ({ status: "COMPLETE", output: { stage: "SLATE" } }),
      RESEARCH: async (input) => {
        researchInputs.push(input);
        return { status: "COMPLETE", output: { stage: "RESEARCH", attempt: researchInputs.length } };
      },
      SPORT_ADJUSTMENT: async () => {
        adjustmentAttempts += 1;
        return adjustmentAttempts === 1
          ? { status: "PARTIAL", output: { stage: "SPORT_ADJUSTMENT", attempt: adjustmentAttempts }, researchGaps: [{ question: "Is the player limited?", importance: "HIGH", reason: "Role is unresolved.", affectedPlayerIds: ["p-1"] }] }
          : { status: "COMPLETE", output: { stage: "SPORT_ADJUSTMENT", attempt: adjustmentAttempts } };
      },
      PROJECTION: async () => ({ status: "COMPLETE", output: { stage: "PROJECTION" } }),
      OPTIMIZE: async () => ({ status: "COMPLETE", output: { stage: "OPTIMIZE" } }),
      SELECTION: async () => ({ status: "COMPLETE", output: { stage: "SELECTION" } }),
    };

    const result = await new SportsEngineOrchestrator(base).startGeneration({ tenantId: "tenant-1", userId: "user-1", requestId: "request-3", requestedEntryCount: 1, input: {} });

    expect(result.run.state).toBe("ready");
    expect(researchInputs).toHaveLength(2);
    expect(researchInputs[1]).toMatchObject({ researchGaps: [{ question: "Is the player limited?" }] });
    expect(repository.stageRuns.filter((stage) => stage.stage === "RESEARCH")).toHaveLength(2);
    expect(repository.stageRuns.filter((stage) => stage.stage === "SPORT_ADJUSTMENT")).toHaveLength(2);
  });

  it("supports targeted reruns using persisted prior stage outputs", async () => {
    const repository = new InMemoryOrchestratorRepository();
    const base = options({ repository });
    base.handlers = Object.fromEntries(stages.map((stage) => [stage, async (_input, context) => ({ status: "COMPLETE", output: { stage, version: context.attempt } })]));
    const orchestrator = new SportsEngineOrchestrator(base);
    const request = { tenantId: "tenant-1", userId: "user-1", requestId: "request-4", requestedEntryCount: 1, input: {} };
    const initial = await orchestrator.startGeneration(request);
    const rerun = await orchestrator.rerunFrom(initial.run.id, "PROJECTION");

    expect(rerun.run.state).toBe("ready");
    expect(rerun.run.lineage).toMatchObject({ SLATE: 1, RESEARCH: 1, SPORT_ADJUSTMENT: 1, PROJECTION: 2, OPTIMIZE: 2, SELECTION: 2 });
    expect(repository.stageRuns.filter((stage) => stage.stage === "SLATE")).toHaveLength(1);
    expect(repository.stageRuns.filter((stage) => stage.stage === "PROJECTION")).toHaveLength(2);
  });

  it("fails the run when a stage output violates its registered contract", async () => {
    const base = options();
    base.contracts = { ...base.contracts, RESEARCH: { parse: () => { throw new Error("ResearchPackage is invalid."); } } };
    const result = await new SportsEngineOrchestrator(base).startGeneration({ tenantId: "tenant-1", userId: "user-1", requestId: "request-5", requestedEntryCount: 1, input: {} });

    expect(result.run.state).toBe("failed");
    expect(result.run.currentStage).toBe("RESEARCH");
    expect(result.run.error?.message).toBe("ResearchPackage is invalid.");
  });

  it("runs the entered-lineup guard before publishing Selection output", async () => {
    const guarded: unknown[] = [];
    const base = options({ enteredLineupGuard: (output) => { guarded.push(output); } });
    const result = await new SportsEngineOrchestrator(base).startGeneration({ tenantId: "tenant-1", userId: "user-1", requestId: "request-6", requestedEntryCount: 1, input: {} });

    expect(result.run.state).toBe("ready");
    expect(guarded).toEqual([{ stage: "SELECTION" }]);
  });
});
