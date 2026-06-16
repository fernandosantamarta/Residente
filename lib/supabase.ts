import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Next.js inlines NEXT_PUBLIC_* env vars at BUILD time. If Vercel didn't
// have them set when the production build ran, the inlined value is
// `undefined` and every Supabase call fails with "fetch: Invalid value".
// The anon key is meant to ship in the browser bundle (that's literally
// its purpose), so a hardcoded fallback to the known-good public values
// is a safe last-resort if env-var inlining didn't happen.
const FALLBACK_URL = 'https://nozzfcxijdnllkiydhfi.supabase.co'
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5venpmY3hpamRubGxraXlkaGZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzc1MTIsImV4cCI6MjA5NDcxMzUxMn0.Tv9E5bEGKuBFLdPUyF2AauW964jcb6ybESn81-ddO6Y'

// Reject env-var values that contain whitespace — they're malformed
// (the actual production-breaking case was a JWT with `\n  ` inside it
// after someone pasted a wrapped string into Vercel). A bad value is
// worse than no value, because the `||` chain treats it as truthy and
// skips the fallback.
const clean = (v: string | undefined): string | undefined =>
  v && !/\s/.test(v) ? v : undefined

const SUPABASE_URL =
  clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
  clean(process.env.REACT_APP_SUPABASE_URL) ||
  FALLBACK_URL
const SUPABASE_ANON_KEY =
  clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  clean(process.env.REACT_APP_SUPABASE_ANON_KEY) ||
  FALLBACK_ANON_KEY

export const hasSupabase: boolean = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

// Card payments stay dark until the board deploys the Stripe edge functions
// and flips this on. See supabase/README.md.
export const stripeEnabled: boolean =
  (process.env.NEXT_PUBLIC_STRIPE_ENABLED || process.env.REACT_APP_STRIPE_ENABLED) === 'true'

// Auth storage depends on where we're running:
//  • NATIVE app (Capacitor iOS shell): localStorage, so the session survives a
//    full app close and the resident stays signed in across launches — the
//    expected behaviour for an installed app.
//  • WEB (residente.io in a browser): sessionStorage, so the session survives
//    refreshes and in-app navigation but clears when the tab/browser closes —
//    a safer default on shared computers.
// The Capacitor native bridge injects window.Capacitor before app JS runs, so
// isNativePlatform() is reliable here; falls back to sessionStorage if unknown.
const authStorage =
  typeof window === 'undefined'
    ? undefined
    : (window as any).Capacitor?.isNativePlatform?.()
      ? window.localStorage
      : window.sessionStorage

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: authStorage,
      },
    })
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

// Self-serve account creation (the /signup flow). With email confirmation
// turned OFF in Supabase Auth, this returns a live session immediately so the
// flow can call signup-provision without an inbox round-trip.
//
// If confirmation is ON, signUp returns no session and Supabase emails a link.
// We point that link at /login (instead of the project Site URL) because that's
// the page that runs resumePendingProvision — so a confirm-then-return signup
// still finishes creating the community. Harmless when confirmation is off.
export const signUp = async ({ email, password }: { email: string; password: string }) => {
  const emailRedirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined
  const { data, error } = await supabase!.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  })
  return { data, error }
}

export const signOut = () => supabase!.auth.signOut()

// Email a password-reset link. The link lands on /reset-password, where
// supabase-js picks up the recovery token from the URL hash and establishes
// a short-lived session so the user can set a new password.
export const sendPasswordReset = async (email: string) => {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined
  const { data, error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo })
  return { data, error }
}

// Set a new password for the currently-authenticated user. Used by the
// /reset-password page once the recovery link has established a session.
export const updatePassword = async (password: string) => {
  const { data, error } = await supabase!.auth.updateUser({ password })
  return { data, error }
}

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
