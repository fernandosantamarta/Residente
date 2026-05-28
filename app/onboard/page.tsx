'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { CONSENT_DISCLOSURES } from '@/lib/voice'
import { useAuth } from '../providers'
import { logAudit } from '@/lib/audit'
import './onboard.css'

type Step = 'loading' | 'password' | 'tos' | 'consent' | 'done' | 'no-session'

export default function OnboardPage() {
  const { session, profile, setProfile } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState<Step>('loading')
  const [residentId, setResidentId] = useState<string | null>(null)
  const [communityName, setCommunityName] = useState<string>('')
  const [err, setErr] = useState<string>('')

  // Decide which step to start on. The flow can be entered fresh
  // (magic-link invite → still needs password + TOS + consent) or by an
  // already-activated user who needs to consent retroactively because
  // they predated Easy Voice (skips straight to the consent step).
  useEffect(() => {
    let cancelled = false
    const decide = async () => {
      if (!hasSupabase || !supabase) { setStep('no-session'); return }
      if (!session) { setStep('no-session'); return }
      if (!profile?.community_id) {
        // Sometimes the profile lookup races with the session — wait a tick.
        return
      }
      try {
        const [{ data: consentRows }, { data: resident }, { data: community }] =
          await Promise.all([
            supabase.from('ev_consents')
              .select('id')
              .eq('profile_id', session.user.id)
              .eq('community_id', profile.community_id)
              .limit(1),
            supabase.from('residents')
              .select('id, activated_at')
              .eq('profile_id', session.user.id)
              .eq('community_id', profile.community_id)
              .maybeSingle(),
            supabase.from('communities')
              .select('name')
              .eq('id', profile.community_id)
              .maybeSingle(),
          ])
        if (cancelled) return
        setResidentId(resident?.id ?? null)
        setCommunityName(community?.name ?? '')
        if (consentRows && consentRows.length > 0) {
          // Already consented — nothing to do here.
          setStep('done')
          router.replace('/app')
          return
        }
        // Already activated (e.g. existing dues user) → only collect consent.
        if (resident?.activated_at) setStep('consent')
        else setStep('password')
      } catch (e) {
        if (!cancelled) setErr((e as Error)?.message || 'Could not load onboarding state')
      }
    }
    decide()
    return () => { cancelled = true }
  }, [session, profile?.community_id, router])

  if (step === 'loading') {
    return <OnboardShell><div className="onboard-msg">Loading…</div></OnboardShell>
  }

  if (step === 'no-session') {
    return (
      <OnboardShell>
        <h1 className="onboard-h1">Open your invitation email</h1>
        <p className="onboard-lede">
          To finish setting up your account, open the most recent invitation
          email from your community and click the button there. The link signs
          you in and brings you back here.
        </p>
        <Link href="/login" className="onboard-btn-ghost">Already have a password? Sign in</Link>
      </OnboardShell>
    )
  }

  if (step === 'password') {
    return (
      <OnboardShell>
        <PasswordStep
          onDone={() => setStep('tos')}
          err={err}
          setErr={setErr}
        />
      </OnboardShell>
    )
  }

  if (step === 'tos') {
    return (
      <OnboardShell>
        <TosStep onDone={() => setStep('consent')} />
      </OnboardShell>
    )
  }

  if (step === 'consent') {
    return (
      <OnboardShell variant="consent">
        <ConsentStep
          communityName={communityName}
          communityId={profile?.community_id || ''}
          profileId={session?.user.id || ''}
          residentId={residentId}
          onDone={async () => {
            // Touch profile in context so any downstream consumer re-renders.
            if (profile) setProfile({ ...profile })
            setStep('done')
            router.replace('/app')
          }}
        />
      </OnboardShell>
    )
  }

  return <OnboardShell><div className="onboard-msg">Redirecting…</div></OnboardShell>
}

function OnboardShell({
  children, variant,
}: {
  children: React.ReactNode
  variant?: 'consent'
}) {
  return (
    <div className={`onboard-screen${variant ? ` onboard-${variant}` : ''}`}>
      <div className="onboard-glow" />
      <div className="onboard-card">
        <Link href="/" className="onboard-brand" aria-label="Residente home">
          <div className="brand-dot" style={{ width: 16, height: 16 }} />
          <div className="onboard-brand-word">Residente</div>
        </Link>
        {children}
      </div>
    </div>
  )
}

function PasswordStep({
  onDone, err, setErr,
}: {
  onDone: () => void
  err: string
  setErr: (s: string) => void
}) {
  const [pwd, setPwd]   = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwd.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pwd !== pwd2) { setErr('Passwords do not match.'); return }
    setBusy(true); setErr('')
    try {
      const { error } = await supabase!.auth.updateUser({ password: pwd })
      if (error) throw error
      onDone()
    } catch (e2: any) {
      setErr(e2?.message || 'Could not set password. Try a stronger one.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="onboard-h1">Set your password</h1>
      <p className="onboard-lede">Pick something at least 8 characters long.</p>
      <form className="onboard-form" onSubmit={submit}>
        <label className="onboard-field">
          <span className="onboard-label">New password</span>
          <input type="password" autoComplete="new-password" minLength={8}
                 value={pwd} onChange={e => setPwd(e.target.value)} required />
        </label>
        <label className="onboard-field">
          <span className="onboard-label">Confirm password</span>
          <input type="password" autoComplete="new-password" minLength={8}
                 value={pwd2} onChange={e => setPwd2(e.target.value)} required />
        </label>
        {err && <div className="onboard-err">{err}</div>}
        <button type="submit" className="onboard-btn" disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </>
  )
}

function TosStep({ onDone }: { onDone: () => void }) {
  const [agree, setAgree] = useState(false)
  return (
    <>
      <h1 className="onboard-h1">Terms of service</h1>
      <p className="onboard-lede">
        Residente is the official communication and voting platform for your
        community association. Your account is provisioned by your board and
        cannot be transferred. You're responsible for keeping your password
        confidential and your contact information current.
      </p>
      <p className="onboard-lede">
        You agree to use Residente only for legitimate association business.
        Misuse — including sharing ballots, attempting to impersonate other
        owners, or scraping content — may result in account suspension.
      </p>
      <label className="onboard-checkbox-row">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
        <span>I have read and agree to these terms.</span>
      </label>
      <button className="onboard-btn" disabled={!agree} onClick={onDone}>
        Continue
      </button>
    </>
  )
}

function ConsentStep({
  communityName, communityId, profileId, residentId, onDone,
}: {
  communityName: string
  communityId: string
  profileId: string
  residentId: string | null
  onDone: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string>('')

  const consent = useCallback(async () => {
    if (!hasSupabase || !supabase) return
    setBusy(true); setErr('')
    try {
      // Fetch server-derived IP so the audit record isn't user-controlled.
      let ip: string | null = null
      try {
        const resp = await fetch('/api/ip', { cache: 'no-store' })
        if (resp.ok) {
          const j = await resp.json()
          if (j?.ip) ip = String(j.ip)
        }
      } catch { /* ip is optional */ }

      const { error: consentErr } = await supabase
        .from('ev_consents')
        .insert({
          community_id: communityId,
          profile_id:   profileId,
          resident_id:  residentId,
          ip_address:   ip,
          user_agent:   typeof navigator !== 'undefined' ? navigator.userAgent : null,
        })
      if (consentErr) throw consentErr

      // Mark the resident activated for the first time. Idempotent — only
      // sets activated_at if it's still null, so re-running the consent
      // flow doesn't overwrite the original activation timestamp.
      if (residentId) {
        await supabase.from('residents')
          .update({ activated_at: new Date().toISOString() })
          .eq('id', residentId)
          .is('activated_at', null)
      }

      await logAudit({
        community_id: communityId,
        event_type:   'consent.recorded',
        target_type:  'consent',
        target_id:    null,
        metadata: { ip, has_resident_id: !!residentId },
      })
      await logAudit({
        community_id: communityId,
        event_type:   'invite.accepted',
        target_type:  'resident',
        target_id:    residentId,
      })

      await onDone()
    } catch (e: any) {
      setErr(e?.message || 'Could not record your consent.')
    } finally {
      setBusy(false)
    }
  }, [communityId, profileId, residentId, onDone])

  return (
    <>
      <div className="onboard-consent-banner">Required by Florida law</div>
      <h1 className="onboard-h1">Consent to electronic voting</h1>
      <p className="onboard-lede">
        Before you can vote or receive notices electronically for{' '}
        <strong>{communityName || 'your community'}</strong>, Florida law
        requires you to give explicit consent. Read the four points below
        before you continue.
      </p>
      <ul className="onboard-consent-list">
        {CONSENT_DISCLOSURES.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {err && <div className="onboard-err">{err}</div>}
      <div className="onboard-consent-actions">
        <button
          className="onboard-btn"
          disabled={busy || !communityId || !profileId}
          onClick={consent}
        >
          {busy ? 'Recording…' : 'I consent'}
        </button>
        <Link href="/login" className="onboard-btn-ghost">
          Not now — sign out
        </Link>
      </div>
      <p className="onboard-foot">
        We log the timestamp, your IP address, and your browser as proof of
        consent. This record is immutable.
      </p>
    </>
  )
}
