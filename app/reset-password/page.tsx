'use client'

import { useState } from 'react'
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
              <label className="login-field">
                <span className="login-label">New password</span>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="At least 8 characters"
                />
              </label>

              <label className="login-field">
                <span className="login-label">Confirm password</span>
                <input
                  id="reset-confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  placeholder="Re-enter it"
                />
              </label>

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
