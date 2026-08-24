// Durable worker entry point. Deploy this function with an internal service URL;
// it claims a queued job in Postgres and delegates processing to the authenticated
// server worker endpoint. The browser is not required for job completion.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: job, error } = await service.rpc("floyd_dfs_claim_engine_job", { p_tenant_id: tenantId });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!job) return Response.json({ claimed: false });
  const workerUrl = Deno.env.get("FLOYD_DFS_WORKER_URL");
  if (!workerUrl) return Response.json({ claimed: true, job, warning: "FLOYD_DFS_WORKER_URL is not configured." }, { status: 202 });
  const response = await fetch(`${workerUrl}/api/runs/${job.generation_run_id}/process`, { method: "POST", headers: { "x-engine-worker-secret": Deno.env.get("FLOYD_DFS_WORKER_SECRET") ?? "" } });
  return Response.json({ claimed: true, job, result: await response.json() }, { status: response.status });
});
