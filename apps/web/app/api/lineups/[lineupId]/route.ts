import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ lineupId: string }> }) {
  try {
    const context = await publicTenantContext();
    const { lineupId } = await params;
    const { data, error } = await context.client.from("floyd_dfs_generated_lineups").select("*").eq("id", lineupId).eq("tenant_id", context.tenantId).maybeSingle();
    if (error) throw error;
    return data ? Response.json({ lineup: data }) : Response.json({ error: "Lineup was not found." }, { status: 404 });
  } catch (error) { return authErrorResponse(error); }
}
