export interface DatabaseEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
}

export function readDatabaseEnvironment(environment: Record<string, string | undefined> = process.env): DatabaseEnvironment {
  const supabaseUrl = environment.SUPABASE_URL;
  const supabaseAnonKey = environment.SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  if (!supabaseAnonKey) throw new Error("SUPABASE_ANON_KEY is required.");
  return { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY };
}
