import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Next.js exposes browser-readable env vars under the NEXT_PUBLIC_ prefix.
// We also fall back to the old CRA REACT_APP_ prefix during the migration
// so a stale .env.local keeps working until the user updates it.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY

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
