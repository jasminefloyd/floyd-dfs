import { DeterministicLearningService } from "@sports-engine/learning";
import { SupabaseLearningRepository } from "@sports-engine/database";
import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";
export async function POST(request: Request) {
  try { const context = await publicTenantContext(); const input = await request.json(); const result = new DeterministicLearningService().diagnose(input as never); const repository = new SupabaseLearningRepository(context.client); await repository.saveDiagnostic(result.diagnostic); if (result.lesson) await repository.saveLesson(result.lesson); return Response.json(result); } catch (error) { return authErrorResponse(error); }
}
