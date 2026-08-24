import type { StageExecutionResult } from "@sports-engine/contracts";
import type { StageHandler } from "@sports-engine/orchestrator";
import { SportAdjustmentRouter } from "./router";

export function createSportAdjustmentStageHandler(router = new SportAdjustmentRouter()): StageHandler {
  return async (input): Promise<StageExecutionResult> => {
    if (!isRecord(input) || !isRecord(input.validatedSlate) || !isRecord(input.researchPackage)) return { status: "BLOCKED", errors: ["Sport Adjustment requires validatedSlate and researchPackage inputs."] };
    const output = router.adjust({ validatedSlate: input.validatedSlate as never, researchPackage: input.researchPackage as never });
    return { status: output.status, output, researchGaps: output.researchGaps };
  };
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
