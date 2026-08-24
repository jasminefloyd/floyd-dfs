import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await publicTenantContext();
    const { runId } = await params;
    const { data: run, error } = await context.client.from("generation_runs").select("*").eq("id", runId).eq("tenant_id", context.tenantId).maybeSingle();
    if (error) throw error;
    if (!run) return Response.json({ error: "Generation run was not found." }, { status: 404 });
    const [{ data: stages, error: stageError }, { data: lineups, error: lineupError }] = await Promise.all([
      context.client.from("engine_stage_runs").select("*").eq("generation_run_id", runId).eq("tenant_id", context.tenantId).order("created_at", { ascending: true }),
      context.client.from("floyd_dfs_generated_lineups").select("*").eq("tenant_id", context.tenantId).in("selection_run_id", ((await context.client.from("floyd_dfs_selection_runs").select("id").eq("generation_run_id", runId).eq("tenant_id", context.tenantId)).data ?? []).map((row: { id: string }) => row.id)).order("bullet_number"),
    ]);
    if (stageError) throw stageError;
    if (lineupError) throw lineupError;
    const research = [...(stages ?? [])].reverse().find((stage) => stage.stage === "RESEARCH")?.output_payload ?? null;
    return Response.json({ run, stages: stages ?? [], research, lineups: lineups ?? [] });
  } catch (error) { return authErrorResponse(error); }
}
