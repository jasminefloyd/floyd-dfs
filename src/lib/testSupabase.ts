import { supabase, supabaseSchema } from './supabaseClient'

export async function testSupabaseConnection() {
  let query = supabase.from('player_last_5_stats').select('*').limit(1)

  if (supabaseSchema !== 'public') {
    query = supabase
      .schema(supabaseSchema)
      .from('player_last_5_stats')
      .select('*')
      .limit(1)
  }

  const { data, error } = await query

  if (error?.code === 'PGRST106') {
    console.warn(
      `Supabase schema "${supabaseSchema}" is not exposed through the REST API. ` +
        'Expose the Fantasy AI tenant schema in Supabase API settings.'
    )
    return
  }

  if (error?.code === '42P01' || error?.code === 'PGRST205') {
    console.warn(
      `Supabase table player_last_5_stats was not found in schema "${supabaseSchema}". ` +
        'Apply supabase/schema.sql to the Fantasy AI tenant schema.'
    )
    return
  }

  if (error) {
    console.error('Supabase connection test failed:', error)
  } else {
    console.log('Supabase connection test succeeded:', data)
  }
}
