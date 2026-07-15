import { createClient } from '@supabase/supabase-js'

type ViteImportMeta = ImportMeta & {
  env: Record<string, string | undefined>
}

const viteEnv = (import.meta as ViteImportMeta).env

export const supabaseUrl = viteEnv.VITE_SUPABASE_URL ?? ''
export const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? ''
export const supabaseSchema = viteEnv.VITE_SUPABASE_SCHEMA || 'tenant_fantasy_ai'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
