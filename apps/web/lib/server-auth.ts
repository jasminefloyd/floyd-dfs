import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const TENANT_SLUG = "floyd-dfs";

export interface AuthContext {
  client: SupabaseClient;
  user: User | null;
  actorUserId: string;
  tenantId: string;
  tenantName: string;
}

export function serverSupabase(request: Request): SupabaseClient {
  const env = readEnvironment();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

export function workerSupabase(): SupabaseClient {
  const env = readEnvironment();
  if (!env.serviceRoleKey) throw new AuthHttpError("Server Supabase service role is not configured.", 500);
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function isTrustedWorker(request: Request): boolean {
  const configured = process.env.FLOYD_DFS_WORKER_SECRET;
  return Boolean(configured && request.headers.get("x-engine-worker-secret") === configured);
}

export async function requireTenantMember(request: Request): Promise<AuthContext> {
  const client = serverSupabase(request);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AuthHttpError("Authentication is required.", 401);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new AuthHttpError("Your session is invalid or expired.", 401);

  const { data: tenant, error: tenantError } = await client.from("tenants").select("id,name").eq("slug", TENANT_SLUG).maybeSingle();
  if (tenantError) throw new AuthHttpError(`Tenant lookup failed: ${tenantError.message}`, 500);
  if (!tenant) throw new AuthHttpError(`Tenant ${TENANT_SLUG} was not found.`, 404);

  const { data: membership, error: membershipError } = await client
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membershipError) throw new AuthHttpError(`Tenant membership lookup failed: ${membershipError.message}`, 500);
  if (!membership) throw new AuthHttpError("Your account is not a member of this tenant.", 403);
  return { client, user: userData.user, actorUserId: userData.user.id, tenantId: tenant.id, tenantName: tenant.name };
}

export async function publicTenantContext(): Promise<AuthContext> {
  const client = workerSupabase();
  const { data: tenant, error: tenantError } = await client.from("tenants").select("id,name").eq("slug", TENANT_SLUG).maybeSingle();
  if (tenantError) throw new AuthHttpError(`Tenant lookup failed: ${tenantError.message}`, 500);
  if (!tenant) throw new AuthHttpError(`Tenant ${TENANT_SLUG} was not found.`, 404);
  const { data: membership, error: membershipError } = await client.from("tenant_memberships").select("user_id").eq("tenant_id", tenant.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (membershipError) throw new AuthHttpError(`Public tenant actor lookup failed: ${membershipError.message}`, 500);
  if (!membership?.user_id) throw new AuthHttpError(`Tenant ${TENANT_SLUG} has no actor membership.`, 500);
  return { client, user: null, actorUserId: membership.user_id, tenantId: tenant.id, tenantName: tenant.name };
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthHttpError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return Response.json({ error: message }, { status: 500 });
}

export class AuthHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function readEnvironment(): { url: string; anonKey: string; serviceRoleKey?: string } {
  const values: Record<string, string> = { ...process.env } as Record<string, string>;
  const envPath = path.resolve(process.cwd(), "../../.env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  const url = values.SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = values.SUPABASE_ANON_KEY ?? values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AuthHttpError("Server Supabase environment is not configured.", 500);
  return { url, anonKey, serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY ?? values.SUPABASE_SERVICE_KEY };
}
