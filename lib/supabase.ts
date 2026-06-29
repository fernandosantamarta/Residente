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

// "Keep me signed in" controls WHERE the Supabase session token is stored:
//  • ON  → localStorage: survives a full app close / browser restart, so the
//    user is auto-logged-in next launch.
//  • OFF → sessionStorage: cleared when the app/tab closes, so next launch shows
//    the sign-in screen (iOS still autofills the saved password — they just tap
//    Sign in). Default is ON in the native app (expected for an installed app)
//    and OFF on the web (safer on shared computers).
const REMEMBER_KEY = 'residente_remember_me'

export function rememberMeDefault(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as any).Capacitor?.isNativePlatform?.()
}

export function getRememberMe(): boolean {
  if (typeof window === 'undefined') return false
  const v = localStorage.getItem(REMEMBER_KEY)
  if (v === 'true') return true
  if (v === 'false') return false
  return rememberMeDefault()
}

export function setRememberMe(on: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(REMEMBER_KEY, on ? 'true' : 'false')
}

// Routes the session token to localStorage or sessionStorage per the flag above.
// getItem reads BOTH so an existing session is found wherever it was stored, and
// setItem writes to one and clears the other so the choice can't leave a stale copy.
const authStorage =
  typeof window === 'undefined'
    ? undefined
    : {
        getItem: (k: string) => window.localStorage.getItem(k) ?? window.sessionStorage.getItem(k),
        setItem: (k: string, v: string) => {
          if (getRememberMe()) {
            window.localStorage.setItem(k, v)
            window.sessionStorage.removeItem(k)
          } else {
            window.sessionStorage.setItem(k, v)
            window.localStorage.removeItem(k)
          }
        },
        removeItem: (k: string) => {
          window.localStorage.removeItem(k)
          window.sessionStorage.removeItem(k)
        },
      }

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
  // A successful password change should kick every OTHER session — devices or
  // browsers still signed in on the OLD password. scope:'others' revokes them
  // while keeping the current session. Best-effort: never fail the password
  // change itself if this revoke call hiccups.
  if (!error) {
    try { await supabase!.auth.signOut({ scope: 'others' }) } catch { /* ignore */ }
  }
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
