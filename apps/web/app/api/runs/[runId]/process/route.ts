import { SupabaseOrchestratorRepository } from "@sports-engine/database";
import { authErrorResponse, isTrustedWorker, publicTenantContext, workerSupabase } from "../../../../../lib/server-auth";
import { createGenerationOrchestrator, persistStageArtifacts } from "../../../../../lib/generation-pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const context = isTrustedWorker(request)
      ? { client: workerSupabase(), tenantId: "", tenantName: "", user: null, actorUserId: "" }
      : await publicTenantContext();
    const repository = new SupabaseOrchestratorRepository(context.client);
    const run = await repository.getRun(runId);
    if (isTrustedWorker(request) && run) context.tenantId = run.tenantId;
    const orchestrationRequest = await repository.getRequest(runId);
    if (!run || run.tenantId !== context.tenantId || !orchestrationRequest) return Response.json({ error: "Generation run was not found." }, { status: 404 });
    const { data: job, error: jobReadError } = await context.client.from("engine_jobs").select("id,status").eq("generation_run_id", runId).eq("tenant_id", context.tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (jobReadError) throw jobReadError;
    if (!job) return Response.json({ error: "Generation job was not found." }, { status: 404 });
    if (job.status === "succeeded") return Response.json({ run });
    const { data: claimed, error: claimError } = await context.client.from("engine_jobs").update({ status: "running", attempt: 1, started_at: new Date().toISOString() }).eq("id", job.id).eq("status", "queued").select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return Response.json({ run, queued: run.state === "created", message: "This generation job is already being processed." }, { status: 202 });
    const { orchestrator } = createGenerationOrchestrator(context.client);
    const result = await orchestrator.runExistingGeneration(run, orchestrationRequest);
    await persistStageArtifacts(context.client, runId, context.tenantId, result.run, orchestrationRequest.input as never);
    const { error: finishError } = await context.client.from("engine_jobs").update({ status: result.run.state === "failed" ? "failed" : "succeeded", output_ref: { runId }, error: result.run.error ?? null, completed_at: new Date().toISOString() }).eq("id", job.id);
    if (finishError) throw finishError;
    return Response.json({ run: result.run, selection: result.selectionOutput ?? null });
  } catch (error) {
    return authErrorResponse(error);
  }
}
