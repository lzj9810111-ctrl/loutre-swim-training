import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kspcrguerclovouzdwdc.supabase.co'
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jQOiekvz5dYvoRfcGyZHSw_G4d5nzld'

export const supabase = createSupabaseClient(
  supabaseUrl,
  supabasePublishableKey
)
