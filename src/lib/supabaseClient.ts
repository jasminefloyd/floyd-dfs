import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const supabase = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

export async function authenticatedHeaders(initial?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initial);
  if (!supabase) throw new Error('Authentication is not configured for this deployment.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in to use Floyd DFS.');
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return headers;
}
