import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Next.js inlines NEXT_PUBLIC_* env vars at BUILD time. If Vercel didn't
// have them set when the production build ran, the inlined value is
// `undefined` and every Supabase call fails with "fetch: Invalid value".
// The anon key is meant to ship in the browser bundle (that's literally
// its purpose), so a hardcoded fallback to the known-good public values
// is a safe last-resort if env-var inlining didn't happen.
const FALLBACK_URL = 'https://nozzfcxijdnllkiydhfi.supabase.co'
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5venpmY3hpamRubGxraXlkaGZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzc1MTIsImV4cCI6MjA5NDcxMzUxMn0.Tv9E5bEGKuBFLdPUyF2AauW964jcb6ybESn81-ddO6Y'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  FALLBACK_URL
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  FALLBACK_ANON_KEY

export const hasSupabase: boolean = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

// Card payments stay dark until the board deploys the Stripe edge functions
// and flips this on. See supabase/README.md.
export const stripeEnabled: boolean =
  (process.env.NEXT_PUBLIC_STRIPE_ENABLED || process.env.REACT_APP_STRIPE_ENABLED) === 'true'

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  : null

export type Profile = {
  id: string
  full_name: string | null
  unit_number: string | null
  email: string | null
  phone: string | null
  role: 'resident' | 'board_member' | 'admin' | string
  community_id: string | null
}

export const signIn = async ({ email, password }: { email: string; password: string }) => {
  const { data, error } = await supabase!.auth.signInWithPassword({ email, password })
  return { data, error }
}

export const signOut = () => supabase!.auth.signOut()

export const getProfile = async (userId: string) => {
  try {
    const { data, error } = await supabase!
      .from('profiles')
      .select('id, full_name, unit_number, email, phone, role, community_id')
      .eq('id', userId)
      .single()
    return { data: data as Profile | null, error }
  } catch (err) {
    return { data: null, error: err as Error }
  }
}
