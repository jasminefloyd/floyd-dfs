import { DeterministicLearningService } from "@sports-engine/learning";
import { SupabaseLearningRepository } from "@sports-engine/database";
import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";
export async function POST(request: Request) {
  try { const context = await publicTenantContext(); const input = await request.json(); const measured = new DeterministicLearningService().measure(input as never); const repository = new SupabaseLearningRepository(context.client); await repository.saveContestResult(measured.result as never); await repository.saveMeasurements(measured.measurements as never); return Response.json({ measurement: measured }); } catch (error) { return authErrorResponse(error); }
}
