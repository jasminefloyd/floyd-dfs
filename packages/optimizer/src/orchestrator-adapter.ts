import type { StageExecutionResult } from "@sports-engine/contracts";
import type { StageHandler } from "@sports-engine/orchestrator";
import { DeterministicOptimizer } from "./optimizer";

export function createOptimizeStageHandler(optimizer = new DeterministicOptimizer()): StageHandler { return async (input): Promise<StageExecutionResult> => { if (!isRecord(input) || !isRecord(input.validatedSlate) || !isRecord(input.researchPackage) || !isRecord(input.adjustmentPackage) || !isRecord(input.projectionPackage)) return { status: "BLOCKED", errors: ["Optimize requires validatedSlate, researchPackage, adjustmentPackage, and projectionPackage inputs."] }; const output = optimizer.optimize({ validatedSlate: input.validatedSlate as never, researchPackage: input.researchPackage as never, adjustmentPackage: input.adjustmentPackage as never, projectionPackage: input.projectionPackage as never }); return { status: output.status, output, warnings: output.warnings, errors: output.status === "BLOCKED" ? output.gaps : undefined }; }; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
