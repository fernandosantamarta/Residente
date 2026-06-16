'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn, hasSupabase, supabase, getRememberMe, setRememberMe } from '@/lib/supabase'
import { resumePendingProvision } from '@/lib/signup'
import { getStoredPrefs } from '@/lib/preferences'
import { useAuth } from '../providers'

// Where to land after sign-in. An explicit "Default landing page" preference
// (from /app/settings) wins. Otherwise route by role: a community admin / board
// member lands on /admin to run their community; residents land on the cockpit.
// The /admin layout still gates access, so a no-permission board member who
// slips through is bounced back to /app — this just sets the right default.
async function resolveLanding(): Promise<string> {
  if (typeof window === 'undefined') return '/app'
  try {
    const pref = getStoredPrefs().default_homepage
    if (pref) return pref
  } catch { /* no stored prefs */ }
  try {
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.from('profiles').select('role, community_id').eq('id', user.id).single()
        // A Residente operator with no active community lives in the Platform
        // Console — there's no community admin to land on.
        if (data && !data.community_id) {
          const { data: isOp } = await supabase.rpc('is_platform_admin', { uid: user.id })
          if (isOp === true) return '/platform'
        }
        if (data?.role && data.role !== 'resident') return '/admin'
      }
    }
  } catch { /* fall through to the resident cockpit */ }
  return '/app'
}

export default function Login() {
  const { session } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)

  // Initialise the "Keep me signed in" toggle from the saved/default choice
  // (defaults ON in the native app, OFF on the web). Done in an effect so the
  // server render and first client render match (no hydration mismatch).
  useEffect(() => { setRemember(getRememberMe()) }, [])

  // Tint the status bar to the login page's warm background so it doesn't read
  // as a white strip above the orange card (standalone app; and Safari once the
  // toolbar minimizes). Restored on unmount so other pages keep their colour.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const prev = meta.getAttribute('content')
    meta.setAttribute('content', '#FFEADC')
    return () => { if (prev) meta.setAttribute('content', prev) }
  }, [])

  // If already signed in, bounce to the cockpit at the user's preferred landing
  // page — but first finish any sign-up left mid-flight by email confirmation.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    ;(async () => {
      const resumed = await resumePendingProvision()
      const dest = resumed ?? (await resolveLanding())
      if (!cancelled) router.replace(dest)
    })()
    return () => { cancelled = true }
  }, [session, router])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasSupabase) {
      setError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local')
      return
    }
    setSubmitting(true)
    setError(null)
    // Record the choice BEFORE signing in, so the session token gets written to
    // localStorage (stay signed in) or sessionStorage (sign out on close).
    setRememberMe(remember)
    try {
      const { error: err } = await signIn({ email, password })
      if (err) {
        const m = (err.message || '').toLowerCase()
        if (m.includes('email not confirmed')) {
          setError("Your email isn't confirmed yet — check your inbox for the confirmation link, then sign in.")
        } else if (m.includes('invalid login credentials')) {
          setError("That email and password don't match an account. If the account was reset or deleted, use Forgot password below.")
        } else {
          setError(err.message || 'Sign in failed')
        }
      } else {
        // Finish a confirmation-deferred sign-up if one is pending, otherwise
        // land on the user's preferred page.
        const resumed = await resumePendingProvision()
        router.replace(resumed ?? (await resolveLanding()))
      }
    } catch (err) {
      setError((err as Error)?.message || 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-glow" />
      <div className="login-card">
        <Link href="/" className="login-brand" aria-label="Back to Residente home">
          <img src="/residente-logo.png" alt="" className="brand-logo login-brand-logo" />
          <div className="login-brand-word">Residente</div>
        </Link>

        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in to your community cockpit.</p>

        <form onSubmit={onSubmit} className="login-form">
          <label className="login-field">
            <span className="login-label">Email</span>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </label>

          <label className="login-field">
            <span className="login-label">Password</span>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </label>

          <div className="login-forgot" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, color: '#fff', fontWeight: 600, userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, margin: 0 }}
              />
              {/* Custom box: unchecked = white with navy border; checked = navy with white check. */}
              <span aria-hidden="true" style={{
                width: 18, height: 18, flex: 'none', borderRadius: 5,
                border: '2px solid #0A2440',
                background: remember ? '#0A2440' : '#FFFFFF',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 120ms ease',
              }}>
                {remember && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              Keep me signed in
            </label>
            <Link href="/forgot-password" className="login-forgot-link">Forgot password?</Link>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="login-foot">
          New to Residente? <Link href="/signup" className="login-foot-link">Sign up</Link>
        </div>
        <Link href="/" className="login-back">&larr; Back to home</Link>
      </div>
    </div>
  )
}
