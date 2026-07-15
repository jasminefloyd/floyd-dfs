import { supabase } from './supabaseClient'

export async function testSupabaseConnection() {
  const { data, error } = await supabase
    .schema('tenant_fantasy_ai')
    .from('player_last_5_stats')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Supabase connection test failed:', error)
  } else {
    console.log('Supabase connection test succeeded:', data)
  }
}
