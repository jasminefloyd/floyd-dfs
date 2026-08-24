import { DeterministicLearningService } from "@sports-engine/learning";
import { SupabaseLearningRepository } from "@sports-engine/database";
import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";
export async function POST(request: Request) {
  try { const context = await publicTenantContext(); const body = await request.json() as { enteredLineups?: unknown[]; changeEvents?: unknown[] }; const service = new DeterministicLearningService(); const decision = service.preLock({ enteredLineups: (body.enteredLineups ?? []) as never, changeEvents: (body.changeEvents ?? []) as never }); const repository = new SupabaseLearningRepository(context.client); for (const event of (body.changeEvents ?? []) as never[]) await repository.saveChangeEvent(event as never); return Response.json({ decision }); } catch (error) { return authErrorResponse(error); }
}
