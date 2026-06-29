'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updatePassword, hasSupabase } from '@/lib/supabase'
import { useAuth } from '../providers'

export default function ResetPassword() {
  const { session } = useAuth()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasSupabase) {
      setError('Supabase is not configured.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { error: err } = await updatePassword(password)
      if (err) {
        setError(err.message || 'Could not update your password')
      } else {
        // Done — clear the recovery guard flag BEFORE navigating so landing on
        // the cockpit doesn't trip the "left without finishing" sign-out.
        try { sessionStorage.removeItem('pw_recovery') } catch { /* ignore */ }
        setDone(true)
        // They're already signed in via the recovery session — drop them
        // straight into the cockpit after a beat so they see the confirmation.
        setTimeout(() => router.replace('/app'), 1200)
      }
    } catch (err) {
      setError((err as Error)?.message || 'Could not update your password')
    } finally {
      setSubmitting(false)
    }
  }

  // While the recovery session is live on this page, flag the app as "mid
  // password reset". The auth provider's RecoveryGuard watches this flag and
  // signs the user out if they leave WITHOUT finishing (back button, Back to
  // home, typed URL) — a recovery link must not leave a lingering session.
  // Cleared above on a successful change; cleared by the guard on sign-out.
  useEffect(() => {
    if (typeof window === 'undefined' || !session || done) return
    try { sessionStorage.setItem('pw_recovery', '1') } catch { /* ignore */ }
  }, [session, done])

  return (
    <div className="login-screen">
      <div className="login-glow" />
      <div className="login-card">
        <Link href="/" className="login-brand" aria-label="Back to Residente home">
          <img src="/residente-logo.png" alt="" className="brand-logo login-brand-logo" />
          <div className="login-brand-word">Residente</div>
        </Link>

        <h1 className="login-title">Set a new password</h1>

        {done ? (
          <>
            <div className="login-success">
              Password updated. Taking you to your community cockpit&hellip;
            </div>
            <div className="login-foot">
              <Link href="/app" className="login-foot-link">Go now</Link>
            </div>
          </>
        ) : !session ? (
          <>
            <p className="login-sub">
              This reset link is invalid or has expired. Request a fresh one and try again.
            </p>
            <div className="login-foot">
              <Link href="/forgot-password" className="login-foot-link">Send a new link</Link>
            </div>
          </>
        ) : (
          <>
            <p className="login-sub">Pick a new password for your account.</p>

            <form onSubmit={onSubmit} className="login-form">
              <div className="login-field">
                <label className="login-label" htmlFor="reset-password">New password</label>
                <div className="login-pw-wrap">
                  <input
                    id="reset-password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="At least 8 characters"
                  />
                  <PwToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} />
                </div>
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="reset-confirm">Confirm password</label>
                <div className="login-pw-wrap">
                  <input
                    id="reset-confirm"
                    name="confirm"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="Re-enter it"
                  />
                  <PwToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} />
                </div>
              </div>

              {error && <div className="login-error">{error}</div>}

              <button type="submit" className="login-btn" disabled={submitting}>
                {submitting ? 'Saving...' : 'Update password'}
              </button>
            </form>
          </>
        )}

        <Link href="/" className="login-back">&larr; Back to home</Link>
      </div>
    </div>
  )
}

// Reveal toggle — mirrors the eye/eye-off button on the login screen. The
// .login-pw-wrap + .login-pw-toggle styling already lives in globals.css.
function PwToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="login-pw-toggle"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      tabIndex={-1}
    >
      {shown ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  )
}
