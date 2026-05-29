'use client'

import { useState } from 'react'
import Link from 'next/link'
import { hasSupabase, signIn, signUp, supabase } from '@/lib/supabase'
import {
  provisionAccount,
  ProvisionError,
  type ProvisionInput,
  type PropertyType,
} from '@/lib/signup'
import './signup.css'

// Duolingo-style self-serve sign-up. One decision per screen, a progress bar,
// big tappable tiles, account creation deferred to the end. Two branches:
//   board / management → create a new community (free trial), land in /admin
//   resident           → join an existing community, land in /onboard (consent)
//
// All the data writes happen server-side in the signup-provision edge function;
// the browser only collects answers, creates the auth user, then calls it.

type Who = 'resident' | 'board' | 'management'
type Step =
  | 'property' | 'role'
  | 'community' | 'connect' | 'details' | 'account'
  | 'working' | 'confirm-email'

// The ordered screens for each branch — drives the progress bar + Back button.
const FLOW: Record<Who, Step[]> = {
  resident:   ['property', 'role', 'connect', 'details', 'account'],
  board:      ['property', 'role', 'community', 'details', 'account'],
  management: ['property', 'role', 'community', 'details', 'account'],
}

export default function SignupPage() {
  const [step, setStep] = useState<Step>('property')
  const [who, setWho] = useState<Who | null>(null)
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null)

  // Collected answers.
  const [communityName, setCommunityName] = useState('')
  const [location, setLocation] = useState('')
  const [unitCount, setUnitCount] = useState('')
  const [fullName, setFullName] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Progress: position within the active branch (defaults to a 2-step intro
  // until the role is picked and the full path is known).
  const seq = who ? FLOW[who] : (['property', 'role'] as Step[])
  const idx = Math.max(0, seq.indexOf(step))
  const progress = step === 'working' ? 100 : ((idx + 1) / seq.length) * 100

  const goBack = () => {
    setErr(null)
    if (idx > 0) setStep(seq[idx - 1])
  }

  const startBranch = (w: Who) => {
    setWho(w)
    setErr(null)
    setStep(w === 'resident' ? 'connect' : 'community')
  }

  const finish = async () => {
    if (!hasSupabase || !supabase) {
      setErr('Sign-up is not available in local preview (Supabase not configured).')
      return
    }
    setBusy(true); setErr(null)
    try {
      // 1. Make sure we have an authenticated session for this email. If the
      //    account already exists with this password (e.g. a retry after a
      //    failed provision), sign in instead of erroring.
      let session = (await supabase.auth.getSession()).data.session
      if (!session) {
        const { data: su, error: suErr } = await signUp({ email: email.trim(), password })
        if (suErr) {
          if (/already|registered|exists/i.test(suErr.message)) {
            const { data: si, error: siErr } = await signIn({ email: email.trim(), password })
            if (siErr) {
              setErr('That email already has an account. Try signing in instead.')
              setBusy(false); return
            }
            session = si.session
          } else {
            setErr(suErr.message || 'Could not create your account.')
            setBusy(false); return
          }
        } else {
          session = su.session
        }
      }
      // 2. Email-confirmation is on → no session yet. Tell them to check inbox.
      if (!session) { setStep('confirm-email'); setBusy(false); return }

      // 3. Provision (idempotent server-side).
      setStep('working')
      const input: ProvisionInput = who === 'resident'
        ? {
            mode: 'join',
            full_name: fullName.trim(),
            join_code: joinCode.trim() || undefined,
            unit_number: unitNumber.trim() || undefined,
          }
        : {
            mode: 'create',
            association_type: propertyType!,
            community_name: communityName.trim(),
            location: location.trim() || undefined,
            unit_count: unitCount.trim() ? Number(unitCount) : undefined,
            role: who === 'management' ? 'admin' : 'board_member',
            full_name: fullName.trim(),
            unit_number: unitNumber.trim() || undefined,
          }
      const res = await provisionAccount(input)

      // 4. Hard navigate so AuthProvider re-bootstraps with the fresh profile
      //    (community_id is brand new and not yet in client context).
      const dest = res.role === 'resident' ? '/onboard' : '/admin'
      window.location.assign(dest)
    } catch (e) {
      const pe = e as ProvisionError
      // Resident community resolution failed → send them back to fix it.
      if (['bad_code', 'no_match', 'ambiguous'].includes(pe.code || '')) {
        setErr(pe.message)
        setStep('connect')
        setBusy(false)
        return
      }
      setErr(pe.message || 'Something went wrong finishing your setup.')
      setStep('account')
      setBusy(false)
    }
  }

  return (
    <div className="su-screen">
      <div className="su-glow" />
      <div className="su-card">
        <div className="su-progress">
          <div className="su-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <Link href="/" className="su-brand" aria-label="Residente home">
          <img src="/residente-logo.png" alt="" className="su-brand-logo" />
          <span className="su-brand-word">Residente</span>
        </Link>

        {step === 'property' && (
          <Property
            value={propertyType}
            onPick={(t) => { setPropertyType(t); setErr(null); setStep('role') }}
          />
        )}

        {step === 'role' && (
          <Role onPick={startBranch} onBack={goBack} />
        )}

        {step === 'community' && (
          <Community
            who={who!}
            propertyType={propertyType!}
            name={communityName} setName={setCommunityName}
            location={location} setLocation={setLocation}
            unitCount={unitCount} setUnitCount={setUnitCount}
            onNext={() => { setErr(null); setStep('details') }}
            onBack={goBack}
          />
        )}

        {step === 'connect' && (
          <Connect
            code={joinCode} setCode={setJoinCode}
            onNext={() => { setErr(null); setStep('details') }}
            onBack={goBack}
            err={err}
          />
        )}

        {step === 'details' && (
          <Details
            who={who!}
            fullName={fullName} setFullName={setFullName}
            unitNumber={unitNumber} setUnitNumber={setUnitNumber}
            onNext={() => { setErr(null); setStep('account') }}
            onBack={goBack}
          />
        )}

        {step === 'account' && (
          <Account
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            busy={busy} err={err}
            onSubmit={finish}
            onBack={goBack}
          />
        )}

        {step === 'working' && (
          <div>
            <h1 className="su-h1">Setting things up…</h1>
            <p className="su-msg">Creating your account and getting your community ready.</p>
          </div>
        )}

        {step === 'confirm-email' && (
          <div>
            <div className="su-done-emoji">📬</div>
            <h1 className="su-h1">Check your email</h1>
            <p className="su-sub">
              We sent a confirmation link to <strong>{email}</strong>. Click it to
              activate your account, then come back and sign in to finish.
            </p>
            <Link href="/login" className="su-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/* ----------------------------- steps ----------------------------- */

function Property({ value, onPick }: {
  value: PropertyType | null
  onPick: (t: PropertyType) => void
}) {
  return (
    <>
      <div className="su-kicker">Get started</div>
      <h1 className="su-h1">What kind of community is it?</h1>
      <p className="su-sub">This tailors the voting rules and notices to your association type.</p>
      <div className="su-choices">
        <Tile
          emoji="🏢" title="Condominium"
          desc="A condo association (Florida Ch. 718)."
          selected={value === 'condo'} onClick={() => onPick('condo')}
        />
        <Tile
          emoji="🏡" title="Homeowners (HOA)"
          desc="A homeowners association (Florida Ch. 720)."
          selected={value === 'hoa'} onClick={() => onPick('hoa')}
        />
      </div>
      <p className="su-foot">Already have an account? <Link href="/login">Sign in</Link></p>
    </>
  )
}

function Role({ onPick, onBack }: { onPick: (w: Who) => void; onBack: () => void }) {
  return (
    <>
      <div className="su-kicker">Get started</div>
      <h1 className="su-h1">And who are you?</h1>
      <p className="su-sub">We'll set you up with the right tools.</p>
      <div className="su-choices">
        <Tile emoji="🙋" title="A resident / owner"
          desc="Join your community to see notices, docs, and vote."
          onClick={() => onPick('resident')} />
        <Tile emoji="🧑‍⚖️" title="A board member"
          desc="Set up your community and run it. Free trial."
          onClick={() => onPick('board')} />
        <Tile emoji="🏬" title="Property management"
          desc="Manage one or many associations. Free trial."
          onClick={() => onPick('management')} />
      </div>
      <div className="su-actions">
        <button className="su-back" onClick={onBack} type="button">Back</button>
      </div>
    </>
  )
}

function Community({
  who, propertyType, name, setName, location, setLocation,
  unitCount, setUnitCount, onNext, onBack,
}: {
  who: Who; propertyType: PropertyType
  name: string; setName: (s: string) => void
  location: string; setLocation: (s: string) => void
  unitCount: string; setUnitCount: (s: string) => void
  onNext: () => void; onBack: () => void
}) {
  const valid = name.trim().length > 1
  const label = propertyType === 'condo' ? 'condo association' : 'HOA'
  return (
    <>
      <div className="su-kicker">{who === 'management' ? 'Your first community' : 'Your community'}</div>
      <h1 className="su-h1">Tell us about your {label}.</h1>
      <p className="su-sub">You can change all of this later in settings.</p>
      <form className="su-form" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <label className="su-field">
          <span className="su-label">Community name</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Palm Grove Condominiums" autoFocus required />
        </label>
        <label className="su-field">
          <span className="su-label">City / location (optional)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Miami, FL" />
        </label>
        <label className="su-field">
          <span className="su-label">Number of units (optional)</span>
          <input value={unitCount} onChange={(e) => setUnitCount(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric" placeholder="e.g. 120" />
        </label>
        <div className="su-actions">
          <button className="su-back" onClick={onBack} type="button">Back</button>
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

function Connect({
  code, setCode, onNext, onBack, err,
}: {
  code: string; setCode: (s: string) => void
  onNext: () => void; onBack: () => void; err: string | null
}) {
  return (
    <>
      <div className="su-kicker">Find your community</div>
      <h1 className="su-h1">Got a join code?</h1>
      <p className="su-sub">
        Your board can share a short code. No code? If they already added your
        email to the roster, we'll find you automatically — just continue.
      </p>
      <form className="su-form" onSubmit={(e) => { e.preventDefault(); onNext() }}>
        <label className="su-field">
          <span className="su-label">Join code (optional)</span>
          <input value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
            placeholder="e.g. PALM24" autoFocus maxLength={12}
            style={{ letterSpacing: '2px', fontWeight: 700 }} />
        </label>
        {err && <div className="su-err">{err}</div>}
        <div className="su-actions">
          <button className="su-back" onClick={onBack} type="button">Back</button>
          <button className="su-btn" type="submit">Continue</button>
        </div>
      </form>
    </>
  )
}

function Details({
  who, fullName, setFullName, unitNumber, setUnitNumber, onNext, onBack,
}: {
  who: Who
  fullName: string; setFullName: (s: string) => void
  unitNumber: string; setUnitNumber: (s: string) => void
  onNext: () => void; onBack: () => void
}) {
  const valid = fullName.trim().length > 1
  const showUnit = who !== 'management'
  return (
    <>
      <div className="su-kicker">About you</div>
      <h1 className="su-h1">What's your name?</h1>
      <p className="su-sub">This is how neighbors and the board will see you.</p>
      <form className="su-form" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <label className="su-field">
          <span className="su-label">Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Jane Doe" autoFocus required autoComplete="name" />
        </label>
        {showUnit && (
          <label className="su-field">
            <span className="su-label">Your unit / address {who === 'resident' ? '(optional)' : '(optional)'}</span>
            <input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="e.g. 4B or 1420 Palm St" />
          </label>
        )}
        <div className="su-actions">
          <button className="su-back" onClick={onBack} type="button">Back</button>
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

function Account({
  email, setEmail, password, setPassword, busy, err, onSubmit, onBack,
}: {
  email: string; setEmail: (s: string) => void
  password: string; setPassword: (s: string) => void
  busy: boolean; err: string | null
  onSubmit: () => void; onBack: () => void
}) {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8
  return (
    <>
      <div className="su-kicker">Almost there</div>
      <h1 className="su-h1">Create your login.</h1>
      <p className="su-sub">You'll use this to sign in from now on.</p>
      <form className="su-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) onSubmit() }}>
        <label className="su-field">
          <span className="su-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" autoFocus required autoComplete="email" />
        </label>
        <label className="su-field">
          <span className="su-label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters" minLength={8} required autoComplete="new-password" />
        </label>
        {err && <div className="su-err">{err}</div>}
        <div className="su-actions">
          <button className="su-back" onClick={onBack} type="button" disabled={busy}>Back</button>
          <button className="su-btn" type="submit" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </>
  )
}

function Tile({
  emoji, title, desc, selected, onClick,
}: {
  emoji: string; title: string; desc: string; selected?: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`su-tile${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className="su-tile-emoji" aria-hidden="true">{emoji}</span>
      <span className="su-tile-body">
        <span className="su-tile-title">{title}</span>
        <span className="su-tile-desc">{desc}</span>
      </span>
    </button>
  )
}
