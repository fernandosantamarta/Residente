'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn, hasSupabase } from '@/lib/supabase'
import { useAuth } from '../providers'

export default function Login() {
  const { session } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If already signed in, bounce to the cockpit.
  useEffect(() => {
    if (session) router.replace('/app')
  }, [session, router])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasSupabase) {
      setError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { error: err } = await signIn({ email, password })
      if (err) {
        setError(err.message || 'Sign in failed')
      } else {
        router.replace('/app')
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
          <div className="brand-dot" style={{ width: 16, height: 16 }} />
          <div className="login-brand-word">Residente</div>
        </Link>

        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in to your community cockpit.</p>

        <form onSubmit={onSubmit} className="login-form">
          <label className="login-field">
            <span className="login-label">Email</span>
            <input
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
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="login-foot">
          Account managed by your HOA board.
        </div>
        <Link href="/" className="login-back">&larr; Back to home</Link>
      </div>
    </div>
  )
}
