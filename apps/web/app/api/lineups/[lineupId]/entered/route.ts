import { authErrorResponse, publicTenantContext } from "../../../../../lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ lineupId: string }> }) {
  try {
    const context = await publicTenantContext();
    const { lineupId } = await params;
    const enteredAt = new Date().toISOString();
    const { data: current, error: readError } = await context.client.from("floyd_dfs_generated_lineups").select("*").eq("id", lineupId).eq("tenant_id", context.tenantId).maybeSingle();
    if (readError) throw readError;
    if (!current || current.status !== "GENERATED") return Response.json({ error: "Lineup was not found or has already been entered." }, { status: 409 });
    const { data, error } = await context.client.from("floyd_dfs_generated_lineups").update({ status: "ENTERED", entered_at: enteredAt, entered_by: context.actorUserId, entered_metadata: { source: "public_user_confirmation", immutable: true } }).eq("id", lineupId).eq("tenant_id", context.tenantId).eq("status", "GENERATED").select("*").maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Lineup was not found or has already been entered." }, { status: 409 });
    const { data: run } = await context.client.from("generation_runs").select("id,lineage").eq("id", current.generation_run_id).eq("tenant_id", context.tenantId).maybeSingle();
    const { error: snapshotError } = await context.client.from("floyd_dfs_lock_snapshots").insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, locked_at: enteredAt, lineup_payload: current.lineup_payload, projection_snapshot: current.projection_snapshot ?? {}, research_version: current.research_version ?? run?.lineage?.RESEARCH ?? 1, adjustment_version: current.adjustment_version ?? run?.lineage?.SPORT_ADJUSTMENT ?? 1, projection_version: current.projection_version ?? run?.lineage?.PROJECTION ?? 1, optimization_version: current.optimizer_version ?? run?.lineage?.OPTIMIZE ?? 1, selection_version: current.selection_version ?? run?.lineage?.SELECTION ?? 1, risk_flags: [] });
    if (snapshotError) throw snapshotError;
    return Response.json({ lineup: data });
  } catch (error) { return authErrorResponse(error); }
}
