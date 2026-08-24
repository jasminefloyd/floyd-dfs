import type { SupabaseClient } from "@supabase/supabase-js";

export async function createTenant(client: SupabaseClient, name: string, slug: string): Promise<string> {
  const { data, error } = await client.rpc("floyd_dfs_create_tenant", { tenant_name: name, tenant_slug: slug });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Tenant creation returned an invalid tenant ID.");
  return data;
}
