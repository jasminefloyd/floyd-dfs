import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readDatabaseEnvironment } from "./env";

export function createAuthenticatedSupabaseClient(): SupabaseClient {
  const environment = readDatabaseEnvironment();
  return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Server-side only. Never import this function into a browser bundle.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient {
  const environment = readDatabaseEnvironment();
  if (!environment.supabaseServiceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for service-role access.");
  return createClient(environment.supabaseUrl, environment.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
