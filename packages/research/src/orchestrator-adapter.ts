import type { StageExecutionResult } from "@sports-engine/contracts";
import type { StageHandler } from "@sports-engine/orchestrator";
import type { ResearchAgent } from "./agent";

export function createResearchStageHandler(agent: ResearchAgent): StageHandler {
  return async (input): Promise<StageExecutionResult> => {
    if (!isRecord(input) || !isRecord(input.validatedSlate)) return { status: "BLOCKED", errors: ["Research requires a validatedSlate input."] };
    const output = await agent.run({ validatedSlate: input.validatedSlate as never, researchGaps: Array.isArray(input.researchGaps) ? input.researchGaps as never : undefined });
    return { status: output.status === "BLOCKED" ? "BLOCKED" : output.status, output, errors: output.status === "BLOCKED" ? output.unknowns.map((unknown) => unknown.reason) : undefined };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
