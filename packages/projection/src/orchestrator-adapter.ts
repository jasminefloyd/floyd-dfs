import type { StageExecutionResult } from "@sports-engine/contracts";
import type { StageHandler } from "@sports-engine/orchestrator";
import { ProjectionService } from "./service";

export function createProjectionStageHandler(service = new ProjectionService()): StageHandler { return async (input): Promise<StageExecutionResult> => { if (!isRecord(input) || !isRecord(input.validatedSlate) || !isRecord(input.researchPackage) || !isRecord(input.adjustmentPackage)) return { status: "BLOCKED", errors: ["Projection requires validatedSlate, researchPackage, and adjustmentPackage inputs."] }; const output = service.project({ validatedSlate: input.validatedSlate as never, researchPackage: input.researchPackage as never, adjustmentPackage: input.adjustmentPackage as never }); return { status: output.status, output, errors: output.status === "BLOCKED" ? output.gaps.map((gap) => gap.reason) : undefined }; }; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
