'use client'

import { useState } from 'react'
import Link from 'next/link'
import { sendPasswordReset, hasSupabase } from '@/lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasSupabase) {
      setError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { error: err } = await sendPasswordReset(email.trim())
      // Don't leak whether an account exists — show the same confirmation
      // either way. Only surface true transport/config failures.
      if (err) {
        setError(err.message || 'Could not send the reset link')
      } else {
        setSent(true)
      }
    } catch (err) {
      setError((err as Error)?.message || 'Could not send the reset link')
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

        <h1 className="login-title">Reset your password</h1>

        {sent ? (
          <>
            <p className="login-sub">
              If an account exists for <strong>{email.trim()}</strong>, we just sent a
              link to reset your password. Check your inbox (and spam).
            </p>
            <div className="login-success">
              The link opens a page where you can set a new password. It expires after a
              little while, so use it soon.
            </div>
            <div className="login-foot">
              <Link href="/login" className="login-foot-link">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <p className="login-sub">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>

            <form onSubmit={onSubmit} className="login-form">
              <label className="login-field">
                <span className="login-label">Email</span>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </label>

              {error && <div className="login-error">{error}</div>}

              <button type="submit" className="login-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send reset link'}
              </button>
            </form>

            <div className="login-foot">
              Remembered it? <Link href="/login" className="login-foot-link">Sign in</Link>
            </div>
          </>
        )}

        <Link href="/" className="login-back">&larr; Back to home</Link>
      </div>
    </div>
  )
}
