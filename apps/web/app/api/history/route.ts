import { authErrorResponse, publicTenantContext } from "../../../lib/server-auth";
export async function GET(request: Request) {
  try { const context = await publicTenantContext(); const { data, error } = await context.client.from("floyd_dfs_generated_lineups").select("*").eq("tenant_id", context.tenantId).order("created_at", { ascending: false }); if (error) throw error; return Response.json({ history: data ?? [] }); } catch (error) { return authErrorResponse(error); }
}
