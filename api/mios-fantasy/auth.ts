import { createClient } from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';

interface AuthResult {
  userId: string | null;
  required: boolean;
}

function authRequired() {
  return process.env.REQUIRE_API_AUTH === 'true';
}

export async function validateApiAuth(req: VercelRequest, requestedUserId: string): Promise<AuthResult> {
  const required = authRequired();
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    if (required) throw new Error('Missing Authorization bearer token');
    return { userId: requestedUserId || null, required };
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase auth environment is not configured');

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid Authorization bearer token');
  if (requestedUserId && requestedUserId !== data.user.id) throw new Error('Request user does not match token user');

  return { userId: data.user.id, required };
}
