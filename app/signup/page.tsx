'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { hasSupabase, signIn, signUp, supabase, getProfile } from '@/lib/supabase'
import { useAuth } from '../providers'
import { isNativeApp } from '@/lib/nativePush'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'
import { useCheckout } from '@/components/CheckoutProvider'
import {
  provisionAccount,
  stashPendingProvision,
  clearPendingProvision,
  uploadSignupDocuments,
  saveSignupNotes,
  ProvisionError,
  type ProvisionInput,
  type PropertyType,
  type CollectedDoc,
} from '@/lib/signup'
import { docSectionsFor, type DocSection } from '@/lib/documents/checklist'
import { parseRosterCsv, parseBudgetCsv, applySignupImport, extractSetupFromPdf, applyExtractedSetup } from '@/lib/signupImport'
import './signup.css'

// Duolingo-style self-serve sign-up. Full-orange, one decision per screen, a
// friendly house on every slide, account creation deferred to the end. Two
// branches: board / HOA management create a community (free trial) → /admin;
// residents join an existing community → /onboard (consent).

type Who = 'resident' | 'board'
type Step =
  | 'property' | 'role'
  | 'community' | 'plan' | 'documents' | 'connect' | 'details' | 'account'
  | 'working' | 'confirm-email' | 'pending-approval' | 'pay-now'

const FLOW: Record<Who, Step[]> = {
  resident: ['property', 'role', 'connect', 'details', 'account'],
  board:    ['property', 'role', 'community', 'plan', 'documents', 'details', 'account'],
}

// The document-collection wizard (board / management only). The checklist data
// itself — sections, items, and the condo/HOA variants — lives in
// lib/documents/checklist.ts so the /admin overview "Upload documents" popup can
// render the very same list. Here we layer the per-item upload/check/note state
// the signup wizard needs on top of it.
type DocItemState = { checked: boolean; file: File | null }
type DocSectionState = { items: DocItemState[]; note: string }
const emptyDocState = (docs: DocSection[]): DocSectionState[] =>
  docs.map((s) => ({ items: s.items.map(() => ({ checked: false, file: null })), note: '' }))

// Locate a "smart" wizard item's uploaded file by stable key (ccrs/budget/
// roster) — independent of name (condo renames CC&Rs) and order.
function smartFile(docState: DocSectionState[], docs: DocSection[], key: 'ccrs' | 'budget' | 'roster'): File | null {
  for (let si = 0; si < docs.length; si++) {
    const ii = docs[si].items.findIndex((it) => it.key === key)
    if (ii >= 0) return docState[si]?.items?.[ii]?.file ?? null
  }
  return null
}

export default function SignupPage() {
  const router = useRouter()
  const { setProfile } = useAuth()
  const { openCheckout } = useCheckout()
  const [step, setStep] = useState<Step>('property')
  const [who, setWho] = useState<Who | null>(null)
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null)

  const [communityName, setCommunityName] = useState('')
  const [location, setLocation] = useState('')
  const [unitCount, setUnitCount] = useState('')
  const [fullName, setFullName] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Document-collection wizard state (board / management). `docSection` is the
  // active category; `docState` holds every check + attached file + note so it
  // survives moving back and forth, then feeds the post-provision upload.
  const [docSection, setDocSection] = useState(0)
  const [docState, setDocState] = useState<DocSectionState[]>(() => emptyDocState(docSectionsFor(null)))

  // The document categories vary by property type (condos add SIRS, milestone,
  // Q&A and rename CC&Rs → Declaration). Recomputed from propertyType, which is
  // chosen at the very first step before the documents step is ever reached.
  const docs = docSectionsFor(propertyType)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const seq = who ? FLOW[who] : (['property', 'role'] as Step[])
  const idx = Math.max(0, seq.indexOf(step))
  const progress = step === 'working' ? 100 : ((idx + 1) / seq.length) * 100
  const canBack = step !== 'working'

  // In the native app, hide the back button on the very first step — there it
  // would navigate to '/' (the marketing landing), which strands the user
  // outside the app. The web keeps it (there's a real landing to return to).
  const [isNative, setIsNative] = useState(false)
  useEffect(() => { isNativeApp().then(setIsNative) }, [])
  const atFirstStep = idx === 0 && !(step === 'documents' && docSection > 0)
  const showBack = canBack && !(isNative && atFirstStep)

  const goBack = () => {
    setErr(null)
    // At the documents step the back button steps through the wizard categories
    // first, then leaves the step.
    if (step === 'documents' && docSection > 0) { setDocSection(docSection - 1); return }
    if (idx > 0) setStep(seq[idx - 1])
    else window.location.assign('/')
  }

  const startBranch = (w: Who) => {
    setWho(w)
    setErr(null)
    setStep(w === 'resident' ? 'connect' : 'community')
  }

  // Send a freshly-provisioned board into the admin (refresh the profile first on
  // native so the admin gate sees the new community/role).
  const goToAdmin = async () => {
    if (isNative && supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const { data: fresh } = await getProfile(session.user.id)
          if (fresh) setProfile({ ...fresh, email: session.user.email ?? fresh.email })
        }
      } catch { /* the admin page will refetch */ }
      router.replace('/admin')
    } else {
      window.location.assign('/admin')
    }
  }

  const finish = async () => {
    if (!hasSupabase || !supabase) {
      setErr('Sign-up is not available in local preview (Supabase not configured).')
      return
    }
    setBusy(true); setErr(null)

    // Assemble the provisioning payload up front so we can stash it if signUp
    // can't hand us a session (email-confirmation ON) and resume after the user
    // confirms + signs in. Without this, the confirm-email branch loses every
    // answer the user typed and their community never gets created.
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
          role: 'board_member',
          full_name: fullName.trim(),
          unit_number: unitNumber.trim() || undefined,
        }

    try {
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
      if (!session) {
        // Email confirmation is on — keep the answers so the login flow can
        // finish provisioning once they're verified.
        stashPendingProvision(input)
        setStep('confirm-email')
        setBusy(false)
        return
      }

      setStep('working')
      // Thread the fresh in-memory access token: getSession() can still be empty
      // this soon after signUp, which made the provision call go out unauthed.
      const res = await provisionAccount(input, session.access_token)
      // Inline path succeeded — make sure no stale stash lingers to re-run later.
      clearPendingProvision()

      // Persist any documents the board attached in the wizard now that the
      // community (and their admin membership) exists. Best-effort: a failed
      // upload must never block finishing signup — they can re-add in /admin.
      // (Skipped on the confirm-email branch above, which has no live session —
      // binary files can't be stashed, so those attachments are simply dropped.)
      if (who !== 'resident') {
        const collected: CollectedDoc[] = []
        docState.forEach((sec, si) => {
          sec.items.forEach((it, ii) => {
            if (it.file) collected.push({
              title: docs[si].items[ii].name,
              category: docs[si].category,
              file: it.file,
            })
          })
        })
        if (collected.length) {
          try { await uploadSignupDocuments(res.community_id, collected) } catch { /* non-fatal */ }
        }

        // Persist the per-category notes too (board-only). A later AI slice
        // reads these to pre-fill settings / flag missing docs. Best-effort:
        // same non-fatal contract as the uploads above.
        const notes = docState.map((sec, si) => ({ section: docs[si].label, note: sec.note }))
        try { await saveSignupNotes(res.community_id, notes) } catch { /* non-fatal */ }

        // Smart processing of the wizard's own uploads — one place per document,
        // no separate upload step. The homeowner-roster CSV → residents, the
        // annual-budget CSV → budget categories, the CC&Rs PDF → AI fines/rules.
        // Each runs IN ADDITION to vaulting the file above; all best-effort.
        try {
          const rosterFile = smartFile(docState, docs, 'roster')
          const budgetFile = smartFile(docState, docs, 'budget')
          const roster = rosterFile && /\.csv$/i.test(rosterFile.name) ? parseRosterCsv(await rosterFile.text()) : undefined
          const budget = budgetFile && /\.csv$/i.test(budgetFile.name) ? parseBudgetCsv(await budgetFile.text()) : undefined
          if (roster?.length || budget?.length) {
            await applySignupImport(res.community_id, { roster, budget }, { skipName: fullName.trim() })
          }
        } catch { /* non-fatal */ }

        // CC&Rs → AI extraction: pre-fills late-fee / interest settings + rules.
        // PDF only. Inert (no-op) until ANTHROPIC_API_KEY is set + extract-setup
        // is deployed. Board reviews in /admin. Non-fatal.
        const ccrsFile = smartFile(docState, docs, 'ccrs')
        if (ccrsFile && /\.pdf$/i.test(ccrsFile.name)) {
          try {
            const extracted = await extractSetupFromPdf(ccrsFile)
            if (extracted) await applyExtractedSetup(res.community_id, extracted)
          } catch { /* non-fatal */ }
        }
      }

      // Every new community starts on the 3 free months with NO card — exactly
      // what the Plan step promises ("No card needed to start"). So signup never
      // detours through Stripe checkout: the board lands in /admin and the
      // TrialBanner / billing page let them add payment any time before the trial
      // ends (provision still returns needs_payment, but nothing acts on it here).
      // Resident whose email/address didn't match the roster → awaiting board
      // approval. Don't route into the cockpit; show the waiting screen.
      if (res.pending) { setStep('pending-approval'); setBusy(false); return }
      // Board just created a community — offer to add a card now (optional)
      // before entering the dashboard. Residents go straight to consent.
      if (res.role !== 'resident') { setStep('pay-now'); setBusy(false); return }
      const dest = '/onboard'
      // In the native app a hard window.location navigation gets handed to Safari
      // (and lands on /login with no session). Route client-side so it stays in
      // the app. Refresh the profile in context first so the destination's
      // role/access gate sees the just-provisioned community/role (the hard
      // reload used to do this). On the web keep the full navigation.
      if (isNative) {
        try {
          const { data: fresh } = await getProfile(session.user.id)
          if (fresh) setProfile({ ...fresh, email: session.user.email ?? fresh.email })
        } catch { /* the destination page will refetch */ }
        router.replace(dest)
      } else {
        window.location.assign(dest)
      }
    } catch (e) {
      const pe = e as ProvisionError
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
      <Sparkles />
      <div className="su-top">
        <div className="su-topbar">
          {showBack ? (
            <button className="su-back-circle" onClick={goBack} aria-label="Back" type="button">
              <Chevron dir="left" />
            </button>
          ) : <span className="su-topbar-spacer" />}
          <Link href="/" className="su-brand" aria-label="Residente home">
            <span className="su-brand-chip"><img src="/residente-logo.png" alt="" /></span>
            <span className="su-brand-word">Residente</span>
          </Link>
          <span className="su-topbar-spacer" />
        </div>

        <div className="su-progress">
          <div className="su-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="su-stage">
        <div className="su-stage-inner">
        {step === 'property' && (
          <Property
            value={propertyType}
            onPick={(t) => { setPropertyType(t); setDocState(emptyDocState(docSectionsFor(t))); setErr(null); setStep('role') }}
          />
        )}

        {step === 'role' && <Role onPick={startBranch} />}

        {step === 'community' && (
          <Community
            who={who!} propertyType={propertyType!}
            name={communityName} setName={setCommunityName}
            location={location} setLocation={setLocation}
            unitCount={unitCount} setUnitCount={setUnitCount}
            onNext={() => { setErr(null); setStep('plan') }}
          />
        )}

        {step === 'plan' && (
          <Plan
            propertyType={propertyType!} unitCount={unitCount}
            onNext={() => { setErr(null); setDocSection(0); setStep('documents') }}
          />
        )}

        {step === 'documents' && (
          <DocWizard
            docs={docs}
            section={docSection} setSection={setDocSection}
            state={docState} setState={setDocState}
            onNext={() => { setErr(null); setStep('details') }}
          />
        )}

        {step === 'connect' && (
          <Connect
            code={joinCode} setCode={setJoinCode}
            onNext={() => { setErr(null); setStep('details') }}
            err={err}
          />
        )}

        {step === 'details' && (
          <Details
            who={who!}
            fullName={fullName} setFullName={setFullName}
            unitNumber={unitNumber} setUnitNumber={setUnitNumber}
            onNext={() => { setErr(null); setStep('account') }}
          />
        )}

        {step === 'account' && (
          <Account
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            busy={busy} err={err} onSubmit={finish}
          />
        )}

        {step === 'working' && (
          <>
            <div className="su-kicker">Almost done</div>
            <h1 className="su-h1">Setting things up…</h1>
            <p className="su-sub">Creating your account and getting your home ready.</p>
            <HouseArt />
          </>
        )}

        {step === 'confirm-email' && (
          <>
            <h1 className="su-h1">Check your email</h1>
            <p className="su-sub">
              We sent a confirmation link to <strong>{email}</strong>. Click it to
              activate your account, then come back and sign in to finish.
            </p>
            <HouseArt />
            <div className="su-actions">
              <Link href="/login" className="su-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Go to sign in
              </Link>
            </div>
          </>
        )}

        {step === 'pending-approval' && (
          <>
            <div className="su-kicker">Almost there</div>
            <h1 className="su-h1">Waiting for board approval</h1>
            <p className="su-sub">
              We couldn&apos;t automatically match you to your community&apos;s
              records, so your board needs to confirm you. You&apos;ll get access
              as soon as they approve — no need to sign up again.
            </p>
            <HouseArt />
            <p className="su-foot" style={{ marginTop: 8 }}>
              Tip: if you have a different email on file with your HOA, signing in
              with that one verifies you instantly.
            </p>
            <div className="su-actions">
              <Link href="/app" className="su-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Continue
              </Link>
            </div>
          </>
        )}

        {step === 'pay-now' && (
          <>
            <div className="su-kicker">You&apos;re all set</div>
            <h1 className="su-h1">Add a card now?</h1>
            <p className="su-sub">
              Your community is on 3 months free — no charge today. Add a payment
              method now and it simply bills when the free months end, or skip and
              add it anytime from your subscription page.
            </p>
            <HouseArt />
            <div className="su-actions">
              <button className="su-btn" type="button" onClick={() => openCheckout({
                fn: 'create-subscription-checkout',
                title: 'Add payment',
                countdownTo: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                onComplete: () => { void goToAdmin() },
              })}>
                Add a card now
              </button>
            </div>
            <button type="button" className="su-skip" onClick={() => { void goToAdmin() }}>
              Skip — start my 3 free months
            </button>
          </>
        )}
        </div>
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
      <h1 className="su-h1">Let&apos;s get started!</h1>
      <p className="su-sub">First, what kind of community is it?</p>
      <HouseArt />
      <div className="su-content">
        <div className="su-choices">
          <Tile icon={<IconHouse />} title="House"
            desc="A house in an HOA community (Florida Ch. 720)."
            selected={value === 'hoa'} onClick={() => onPick('hoa')} />
          <Tile icon={<IconBuilding />} title="Condo"
            desc="A unit in a condo association (Florida Ch. 718)."
            selected={value === 'condo'} onClick={() => onPick('condo')} />
        </div>
        <p className="su-foot">Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </>
  )
}

function Role({ onPick }: { onPick: (w: Who) => void }) {
  return (
    <>
      <div className="su-kicker">Get started</div>
      <h1 className="su-h1">And who are you?</h1>
      <p className="su-sub">We&apos;ll set you up with the right tools.</p>
      <HouseArt />
      <div className="su-content">
        <div className="su-choices">
          <Tile icon={<IconPerson />} title="A resident / owner"
            desc="Join your community to see notices, docs, and vote."
            onClick={() => onPick('resident')} />
          <Tile icon={<IconPeople />} title="Board or HOA management"
            desc="Set up your community and run it. Free trial."
            onClick={() => onPick('board')} />
        </div>
      </div>
    </>
  )
}

function Community({
  who, propertyType, name, setName, location, setLocation,
  unitCount, setUnitCount, onNext,
}: {
  who: Who; propertyType: PropertyType
  name: string; setName: (s: string) => void
  location: string; setLocation: (s: string) => void
  unitCount: string; setUnitCount: (s: string) => void
  onNext: () => void
}) {
  // Units are required: the count sets the plan/price (≤25 free, 26+ paid), and
  // leaving it blank let any size community fall through to Free. Must be ≥ 1.
  const units = Number(unitCount)
  const valid = name.trim().length > 1 && location.trim().length > 1 && Number.isFinite(units) && units >= 1
  const label = propertyType === 'condo' ? 'condo association' : 'community'
  return (
    <>
      <div className="su-kicker">Your community</div>
      <h1 className="su-h1">Tell us about your {label}.</h1>
      <p className="su-sub">You can change all of this later.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <div className="su-form">
          <PlaceSearch onPick={({ name: n, location: l }) => {
            if (n) setName(n)
            if (l) setLocation(l)
          }} />
          <label className="su-field">
            <span className="su-label">Community name</span>
            <div className="su-input-wrap">
              <input className="su-input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Palm Grove" required />
            </div>
          </label>
          <CitySearch value={location} onChange={setLocation} />
          <label className="su-field">
            <span className="su-label">Number of {propertyType === 'condo' ? 'units' : 'homes'}</span>
            <div className="su-input-wrap">
              <input className="su-input" value={unitCount}
                onChange={(e) => setUnitCount(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric" placeholder="e.g. 120" required />
            </div>
            <span className="su-hint">Sets your plan — up to 25 is free.</span>
          </label>
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

// Google Places autocomplete (proxied server-side via /api/places/*). Lets the
// board search their real community, city, or street address and have the name
// + location filled in. Self-disabling: if the API has no key configured the
// box hides itself and the manual fields below carry the flow.
type Prediction = { placeId: string; primary: string; secondary: string; name?: string; location?: string }

function PlaceSearch({ onPick }: { onPick: (r: { name: string; location: string }) => void }) {
  const [q, setQ] = useState('')
  const [preds, setPreds] = useState<Prediction[]>([])
  const [open, setOpen] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const tokenRef = useRef<string>('')
  const justPicked = useRef(false)
  if (!tokenRef.current && typeof crypto !== 'undefined' && crypto.randomUUID) {
    tokenRef.current = crypto.randomUUID()
  }

  useEffect(() => {
    if (justPicked.current) { justPicked.current = false; return }
    const input = q.trim()
    if (input.length < 3) { setPreds([]); setOpen(false); setNoMatch(false); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, sessionToken: tokenRef.current }),
          signal: ctl.signal,
        })
        const data = await res.json()
        const list: Prediction[] = data.predictions || []
        setPreds(list)
        // Always open once they've typed enough — even with zero (or wrong)
        // results, the dropdown still offers the "Use what I typed" row so a
        // private HOA the geocoder doesn't know never blocks them.
        setOpen(true)
        setNoMatch(list.length === 0)
      } catch { /* aborted or offline — ignore, manual fields still work */ }
    }, 280)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q])

  // Keep exactly what the user typed as the community name (no geocoder match
  // needed). Leaves location empty so it doesn't clobber a city they picked.
  const useTyped = () => {
    justPicked.current = true
    const text = q.trim()
    setOpen(false); setPreds([]); setNoMatch(false)
    onPick({ name: text, location: '' })
  }

  const choose = async (pred: Prediction) => {
    justPicked.current = true
    setQ(pred.primary); setOpen(false); setPreds([]); setNoMatch(false)
    // OSM predictions already carry name + location — use them directly. Google
    // predictions don't, so resolve via /api/places/details.
    if (pred.name != null || pred.location != null) {
      onPick({ name: pred.name || pred.primary, location: pred.location || '' })
      return
    }
    try {
      const res = await fetch(
        `/api/places/details?placeId=${encodeURIComponent(pred.placeId)}&sessionToken=${encodeURIComponent(tokenRef.current)}`,
      )
      const data = await res.json()
      onPick({ name: data.name || pred.primary, location: data.location || '' })
    } catch {
      onPick({ name: pred.primary, location: '' })
    }
    // A details call consumes the session token — rotate it for the next search.
    tokenRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ''
  }

  return (
    <div className="su-field su-place">
      <span className="su-label">Search your community</span>
      <div className="su-input-wrap">
        <span className="su-place-icon" aria-hidden="true"><IconSearch /></span>
        <input className="su-input su-place-input" value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 3 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Community name, city, or address" autoFocus autoComplete="off" />
      </div>
      {open && q.trim().length >= 3 && (
        <ul className="su-place-list">
          {/* First, and always present: keep exactly what they typed. Geocoders
              rarely know private HOA names (e.g. "Pembroke Falls"), so this is
              usually what they want — the matches below are the fallback. */}
          <li>
            <button type="button" className="su-place-opt su-place-use"
              onMouseDown={(e) => e.preventDefault()} onClick={useTyped}>
              <span className="su-place-pin su-place-pin-add" aria-hidden="true">+</span>
              <span className="su-place-opt-text">
                <span className="su-place-opt-main">Use &ldquo;{q.trim()}&rdquo;</span>
                <span className="su-place-opt-sub">Enter your community name as typed</span>
              </span>
            </button>
          </li>
          {preds.map((p) => (
            <li key={p.placeId}>
              <button type="button" className="su-place-opt"
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                <span className="su-place-pin" aria-hidden="true"><IconPin /></span>
                <span className="su-place-opt-text">
                  <span className="su-place-opt-main">{p.primary}</span>
                  {p.secondary && <span className="su-place-opt-sub">{p.secondary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {noMatch ? (
        <span className="su-place-nomatch">
          No option here? Please manually fill it out in the fields below.
        </span>
      ) : (
        <span className="su-hint">Start typing to find it — or just fill it in below.</span>
      )}
    </div>
  )
}

// City & state field with its own dropdown — same proxy, kind:'city' (localities
// + states only). Bound to `location` so manual typing always works and the
// field stays required; picking a suggestion drops in "City, State".
function CitySearch({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [preds, setPreds] = useState<Prediction[]>([])
  const [open, setOpen] = useState(false)
  const justPicked = useRef(false)

  useEffect(() => {
    if (justPicked.current) { justPicked.current = false; return }
    const input = value.trim()
    if (input.length < 3) { setPreds([]); setOpen(false); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, kind: 'city' }),
          signal: ctl.signal,
        })
        const data = await res.json()
        const list: Prediction[] = data.predictions || []
        setPreds(list); setOpen(list.length > 0)
      } catch { /* offline — typing still works */ }
    }, 280)
    return () => { clearTimeout(t); ctl.abort() }
  }, [value])

  const choose = (pred: Prediction) => {
    justPicked.current = true
    onChange(pred.location || pred.primary)
    setOpen(false); setPreds([])
  }

  return (
    <div className="su-field su-place">
      <span className="su-label">City &amp; state</span>
      <div className="su-input-wrap">
        <span className="su-place-icon" aria-hidden="true"><IconPin /></span>
        <input className="su-input su-place-input" value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => preds.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="e.g. Miami, FL" required autoComplete="off" />
      </div>
      {open && preds.length > 0 && (
        <ul className="su-place-list">
          {preds.map((p) => (
            <li key={p.placeId}>
              <button type="button" className="su-place-opt"
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                <span className="su-place-pin" aria-hidden="true"><IconPin /></span>
                <span className="su-place-opt-text">
                  <span className="su-place-opt-main">{p.location || p.primary}</span>
                  {p.secondary && <span className="su-place-opt-sub">{p.secondary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Plan confirmation. Reads the size the board just entered, shows the matching
// band (lib/plan.ts — the single source of truth), the whole-community monthly
// total, what every plan includes, and the launch promo. Paid bands continue to
// payment (collected by Stripe after account creation); ≤25 homes is free.
function Plan({ propertyType, unitCount, onNext }: {
  propertyType: PropertyType; unitCount: string; onNext: () => void
}) {
  const homes = Number(unitCount) || 0
  const band = planForHomes(homes)
  const flat = band.flatCents > 0
  const total = monthlyTotalLabel(homes)
  const unitWord = propertyType === 'condo' ? 'units' : 'homes'
  const oneWord = unitWord.slice(0, -1)
  const perHome = Math.round(band.perHomeCents / 100)
  const INCLUDED = [
    'Resident cockpit', 'Online dues & fines', 'Live budget rings',
    'Board decisions & voting', 'Meeting minutes', 'Document vault',
    'Amenity booking', 'Maintenance & complaints', 'Violation tracking',
    'Community calendar', 'Household roster & CSV import', 'English · Spanish · Portuguese',
  ]
  return (
    <>
      <div className="su-kicker">Your plan</div>
      <h1 className="su-h1">
        The <span className="su-plan-hl">{band.label}</span> plan is right for you.
      </h1>
      <p className="su-sub">
        {`Based on ${homes} ${unitWord}, here's your plan — and your first 3 months are free.`}
      </p>
      <div className="su-content">
        <div className="su-plan-card">
          <div className="su-plan-top">
            <div className="su-plan-id">
              <div className="su-plan-name">{band.label}</div>
              <div className="su-plan-band">{band.band}</div>
            </div>
            <div className="su-plan-price">
              <span className="su-plan-amt">{total}</span>
              <span className="su-plan-unit">{flat ? `flat · up to 25 ${unitWord}` : `$${perHome}/${oneWord}/mo · ${homes} ${unitWord}`}</span>
            </div>
          </div>

          <div className="su-plan-promo">
            <span className="su-plan-promo-tag">New community</span>
            <span>Your first <strong>3 months are free</strong>. No card to start, then {total}. Cancel anytime.</span>
          </div>

          <div className="su-plan-feats-label">Every plan includes the whole platform</div>
          <ul className="su-plan-feats">
            {INCLUDED.map((f) => (
              <li key={f}><span className="su-plan-check"><IconCheck /></span>{f}</li>
            ))}
          </ul>

          <p className="su-plan-fine">
            Free for 3 months, then billed to the association monthly. Cancel anytime.
            Stripe processing fees are passed through.
          </p>
        </div>

        <div className="su-actions">
          <button className="su-btn" type="button" onClick={onNext}>
            Continue — 3 months free
          </button>
        </div>
        <p className="su-foot">No card needed to start. Add payment any time before your free months end.</p>
      </div>
    </>
  )
}

// Document-collection wizard (board / management). A self-contained mini-flow
// inside one signup step: one category per slide with confirm/upload toggles +
// notes, then a review summary. Everything is optional — every slide offers a
// skip, and attachments persist to the community vault after provisioning. The
// `docs` it renders vary by property type (condo vs HOA).
function DocWizard({
  docs, section, setSection, state, setState, onNext,
}: {
  docs: DocSection[]
  section: number; setSection: (n: number) => void
  state: DocSectionState[]; setState: React.Dispatch<React.SetStateAction<DocSectionState[]>>
  onNext: () => void
}) {
  const total = docs.length
  const onSummary = section >= total

  // Which item's plain-English description is expanded. Keyed by `section-index`
  // so the same row index in a different category doesn't stay open across jumps.
  // Click pins the description (openKey); hover reveals it transiently (hoverKey).
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const doneCount = (i: number) => state[i].items.filter((it) => it.checked).length
  const allDone = (i: number) => doneCount(i) === docs[i].items.length

  const patchSection = (fn: (s: DocSectionState) => DocSectionState) =>
    setState((prev) => prev.map((s, si) => (si === section ? fn(s) : s)))

  const toggle = (i: number) =>
    patchSection((s) => ({ ...s, items: s.items.map((it, ii) => (ii === i ? { ...it, checked: !it.checked } : it)) }))
  const attach = (i: number, file: File | null) => {
    if (!file) return
    patchSection((s) => ({ ...s, items: s.items.map((it, ii) => (ii === i ? { checked: true, file } : it)) }))
  }
  const setNote = (note: string) => patchSection((s) => ({ ...s, note }))

  // Dots double as a jump nav across categories.
  const dots = (
    <div className="su-doc-dots">
      {docs.map((sec, i) => (
        <button key={sec.label} type="button"
          className={`su-doc-dot${i === section ? ' active' : allDone(i) ? ' done' : ''}`}
          onClick={() => setSection(i)} aria-label={`Go to ${sec.label}`} />
      ))}
    </div>
  )

  if (onSummary) {
    return (
      <>
        <div className="su-kicker">Almost done</div>
        <h1 className="su-h1">Review your documents</h1>
        <p className="su-sub">Here&apos;s what you&apos;ve gathered. You can add the rest anytime from your dashboard.</p>
        {dots}
        <div className="su-content">
          {docs.map((sec, i) => {
            const d = doneCount(i), t = sec.items.length
            const cls = d === t ? 'all' : d > 0 ? 'partial' : 'none'
            return (
              <button key={sec.label} type="button" className="su-doc-sum" onClick={() => setSection(i)}>
                <span className="su-doc-sum-id">
                  <span className="su-doc-sum-emoji" aria-hidden="true">{sec.emoji}</span>
                  <span className="su-doc-sum-name">{sec.label}</span>
                </span>
                <span className={`su-doc-pill ${cls}`}>{d === t ? 'All done' : `${d}/${t}`}</span>
              </button>
            )
          })}
          <div className="su-actions">
            <button className="su-btn" type="button" onClick={onNext}>Continue</button>
          </div>
        </div>
      </>
    )
  }

  const sec = docs[section]
  const s = state[section]
  const d = doneCount(section), t = sec.items.length
  const isLast = section === total - 1
  return (
    <>
      <div className="su-kicker">Step {section + 1} of {total} · Your documents</div>
      <h1 className="su-h1">{sec.label}</h1>
      <p className="su-sub">
        {d === t ? 'All set for this category ✓' : 'Confirm or upload each — listed most important first. Skip and add the rest later.'}
      </p>
      <div className="su-doc-emoji" aria-hidden="true">{sec.emoji}</div>
      <div className="su-content">
        <div className="su-doc-card">
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(42,18,6,0.45)', padding: '9px 16px 1px' }}>
            Most important first ↓
          </div>
          <div className="su-doc-items">
            {sec.items.map((item, i) => {
              const it = s.items[i]
              const dkey = `${section}-${i}`
              const open = openKey === dkey
              const showDesc = open || hoverKey === dkey
              return (
                <div className="su-doc-row" key={item.name}
                  onMouseEnter={() => setHoverKey(dkey)} onMouseLeave={() => setHoverKey(null)}>
                  <div className="su-doc-item">
                    <button type="button" className={`su-doc-check${it.checked ? ' on' : ''}`}
                      onClick={() => toggle(i)} aria-label={`${it.checked ? 'Uncheck' : 'Check'} ${item.name}`}>
                      <IconCheck />
                    </button>
                    {/* Hover reveals the plain-English description; tap pins it
                        open. The checkbox stays the confirm action. */}
                    <button type="button" className={`su-doc-name${it.checked ? ' done' : ''}${showDesc ? ' open' : ''}`}
                      onClick={() => setOpenKey(open ? null : dkey)} aria-expanded={showDesc}>
                      <span className="su-doc-name-text">{item.name}</span>
                      <span className="su-doc-caret" aria-hidden="true"><Chevron dir="right" /></span>
                    </button>
                    <label className={`su-doc-up${it.file ? ' done' : ''}`}>
                      {it.file ? '✓ Saved' : 'Upload'}
                      <input className="su-doc-file" type="file"
                        onChange={(e) => attach(i, e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                  {/* Smooth height + fade reveal (inline, eases the rows below). */}
                  <div style={{ display: 'grid', gridTemplateRows: showDesc ? '1fr' : '0fr', opacity: showDesc ? 1 : 0, transition: 'grid-template-rows 0.24s ease, opacity 0.2s ease' }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div className="su-doc-desc">{item.desc}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="su-doc-notes">
            <div className="su-doc-notes-label">Notes</div>
            <textarea className="su-doc-textarea" value={s.note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Missing items, context, or questions…" />
          </div>
        </div>
        <div className="su-actions">
          <button className="su-btn" type="button" onClick={() => setSection(section + 1)}>
            {isLast ? 'Review →' : 'Next →'}
          </button>
        </div>
        <button type="button" className="su-skip" onClick={onNext}>
          Skip — I&apos;ll add documents later
        </button>
      </div>
    </>
  )
}

function Connect({
  code, setCode, onNext, err,
}: {
  code: string; setCode: (s: string) => void
  onNext: () => void; err: string | null
}) {
  return (
    <>
      <div className="su-kicker">Find your community</div>
      <h1 className="su-h1">Got a join code?</h1>
      <p className="su-sub">
        Your board can share a short code. No code? If they already added your
        email, we&apos;ll find you automatically — just continue.
      </p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); onNext() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Join code (optional)</span>
            <div className="su-input-wrap">
              <input className="su-input" value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="e.g. PALM24" autoFocus maxLength={12}
                style={{ letterSpacing: '2px', fontWeight: 700 }} />
            </div>
          </label>
          {err && <div className="su-err">{err}</div>}
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit">Continue</button>
        </div>
      </form>
    </>
  )
}

function Details({
  who, fullName, setFullName, unitNumber, setUnitNumber, onNext,
}: {
  who: Who
  fullName: string; setFullName: (s: string) => void
  unitNumber: string; setUnitNumber: (s: string) => void
  onNext: () => void
}) {
  // Residents must give their unit — it's how they're matched to a home. Board /
  // management can leave it blank: a property-management company has no unit of
  // its own, and a board member's unit isn't needed to run the community.
  const unitRequired = who === 'resident'
  const valid = fullName.trim().length > 1 && (!unitRequired || unitNumber.trim().length > 0)
  return (
    <>
      <div className="su-kicker">About you</div>
      <h1 className="su-h1">What&apos;s your name?</h1>
      <p className="su-sub">This is how neighbors and the board will see you.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Full name</span>
            <div className="su-input-wrap">
              <input className="su-input" value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jane Doe" autoFocus required autoComplete="name" />
            </div>
          </label>
          <label className="su-field">
            <span className="su-label">Your unit / address{unitRequired ? '' : ' (optional)'}</span>
            <div className="su-input-wrap">
              <input className="su-input" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)}
                placeholder="e.g. 4B or 1420 Palm St" required={unitRequired} />
            </div>
          </label>
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

function Account({
  email, setEmail, password, setPassword, busy, err, onSubmit,
}: {
  email: string; setEmail: (s: string) => void
  password: string; setPassword: (s: string) => void
  busy: boolean; err: string | null
  onSubmit: () => void
}) {
  const [show, setShow] = useState(false)
  const reqs = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Includes a number', ok: /[0-9]/.test(password) },
    { label: 'Includes a letter', ok: /[a-zA-Z]/.test(password) },
  ]
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = emailOk && reqs.every(r => r.ok)
  return (
    <>
      <div className="su-kicker">Almost there</div>
      <h1 className="su-h1">Create a password</h1>
      <p className="su-sub">Make it strong and secure.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) onSubmit() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Email</span>
            <div className="su-input-wrap">
              <input className="su-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoFocus required autoComplete="email" />
            </div>
          </label>
          <label className="su-field">
            <span className="su-label">Password</span>
            <div className="su-input-wrap">
              <input className="su-input" type={show ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                required autoComplete="new-password" />
              <button type="button" className="su-eye" onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>
          <div className="su-reqs">
            {reqs.map(r => (
              <div key={r.label} className={`su-req${r.ok ? ' met' : ''}`}>
                <span className="su-req-dot"><IconCheck /></span>
                {r.label}
              </div>
            ))}
          </div>
          {err && <div className="su-err">{err}</div>}
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </div>
      </form>
    </>
  )
}

function Tile({
  icon, title, desc, selected, onClick,
}: {
  icon: React.ReactNode; title: string; desc: string; selected?: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`su-tile${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className="su-tile-icon">{icon}</span>
      <span className="su-tile-text">
        <span className="su-tile-title">{title}</span>
        <span className="su-tile-desc">{desc}</span>
      </span>
      <span className="su-tile-chev"><Chevron dir="right" /></span>
    </button>
  )
}

/* ----------------------------- art ----------------------------- */

// Friendly smiling-house mascot — shown on every slide. Glossy orange roof,
// cream walls with a happy face, rosy cheeks, a little window, and green
// bushes at the base. No hearts, no bird.
function HouseArt() {
  return (
    <div className="su-house">
      <svg viewBox="0 0 240 206" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="House">
        {/* ground shadow */}
        <ellipse cx="124" cy="190" rx="78" ry="10" fill="rgba(90,28,0,0.18)" />

        {/* bushes */}
        <ellipse cx="58" cy="180" rx="26" ry="18" fill="#4E9E33" />
        <ellipse cx="188" cy="182" rx="30" ry="19" fill="#4E9E33" />
        <ellipse cx="150" cy="188" rx="22" ry="14" fill="#5BB23E" />
        <circle cx="46" cy="171" r="11" fill="#6BC24C" />
        <circle cx="200" cy="172" r="12" fill="#6BC24C" />
        <circle cx="74" cy="174" r="9" fill="#6BC24C" />

        {/* picket fence (left) */}
        <g fill="#FFF7EC" stroke="#E7C9A8" strokeWidth="1.4">
          <path d="M24 152 h7 v32 h-7 z" />
          <path d="M36 147 h7 v37 h-7 z" />
          <path d="M48 152 h7 v32 h-7 z" />
          <rect x="20" y="160" width="40" height="6" rx="2" />
        </g>

        {/* house body */}
        <rect x="76" y="98" width="104" height="84" rx="14" fill="#FFF4E4" />
        <path d="M152 98 h14 a14 14 0 0 1 14 14 v56 a14 14 0 0 1 -14 14 h-14 z" fill="#F1DFC6" opacity="0.55" />

        {/* roof */}
        <path d="M66 106 L128 52 L190 106 a7 7 0 0 1 -5 3 H71 a7 7 0 0 1 -5 -3 Z" fill="#E5732A" />
        <path d="M128 52 L190 106 a7 7 0 0 1 -5 3 H128 Z" fill="#CF541A" opacity="0.5" />
        <path d="M66 106 L128 52 L134 56 L75 108 Z" fill="#FB9A4E" opacity="0.7" />

        {/* chimney */}
        <rect x="160" y="62" width="14" height="26" rx="3" fill="#CF541A" />

        {/* window (forehead) */}
        <rect x="112" y="110" width="30" height="20" rx="6" fill="#F4A23E" />
        <rect x="112" y="110" width="30" height="20" rx="6" fill="none" stroke="#E5732A" strokeWidth="2.5" />

        {/* face */}
        <g className="su-eye su-eye-l"><ellipse cx="108" cy="143" rx="4.6" ry="6.4" fill="#5A2A14" /></g>
        <g className="su-eye su-eye-r"><ellipse cx="144" cy="143" rx="4.6" ry="6.4" fill="#5A2A14" /></g>
        <ellipse cx="98" cy="158" rx="8" ry="5" fill="#FFAE9A" />
        <ellipse cx="154" cy="158" rx="8" ry="5" fill="#FFAE9A" />
        <path d="M114 154 Q126 172 138 154 Z" fill="#8A2E1E" />
        <path d="M120 160 Q126 168 132 160 Z" fill="#FF7B6B" />
      </svg>
    </div>
  )
}

function Sparkles() {
  const stars = [
    { top: '12%', left: '14%', size: 22, o: 0.9 },
    { top: '22%', left: '82%', size: 16, o: 0.7 },
    { top: '54%', left: '8%', size: 14, o: 0.6 },
    { top: '68%', left: '88%', size: 20, o: 0.8 },
    { top: '40%', left: '90%', size: 12, o: 0.5 },
    { top: '83%', left: '20%', size: 16, o: 0.7 },
  ]
  return (
    <div className="su-sparkles" aria-hidden="true">
      {stars.map((s, i) => (
        <span key={i} className="su-sparkle" style={{ top: s.top, left: s.left, opacity: s.o }}>
          <Star size={s.size} />
        </span>
      ))}
    </div>
  )
}

function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFF">
      <path d="M12 0c.8 6.4 4.8 10.4 12 11.2-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 10.4 11.2 6.4 12 0Z" />
    </svg>
  )
}

/* ----------------------------- icons ----------------------------- */

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}
function IconHouse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
    </svg>
  )
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /><path d="M10 21v-3h4v3" />
    </svg>
  )
}
function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  )
}
function IconPeople() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14c2.5.4 4 2 4 5" />
    </svg>
  )
}
function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconEyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.4 3.2M6.1 6.1A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 4-.9" /><path d="m3 3 18 18" /><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 12 10 17 19 7" />
    </svg>
  )
}
function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  )
}
function IconPin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}
