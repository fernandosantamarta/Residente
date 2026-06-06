'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { hasSupabase, signIn, signUp, supabase } from '@/lib/supabase'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'
import {
  provisionAccount,
  startSubscriptionCheckout,
  stashPendingProvision,
  clearPendingProvision,
  uploadSignupDocuments,
  saveSignupNotes,
  ProvisionError,
  type ProvisionInput,
  type PropertyType,
  type CollectedDoc,
} from '@/lib/signup'
import type { DocCategory } from '@/lib/compliance/official-records'
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
  | 'working' | 'confirm-email'

const FLOW: Record<Who, Step[]> = {
  resident: ['property', 'role', 'connect', 'details', 'account'],
  board:    ['property', 'role', 'community', 'plan', 'documents', 'details', 'account'],
}

// The document-collection wizard (board / management only). Each section maps to
// a canonical DocCategory so attached files land in the right shelf of the
// community's vault (see lib/compliance/official-records.ts for the category set
// and app/admin/documents for where they surface). The category is per-section;
// the item label becomes each document's title.
type DocItem = { name: string; desc: string }
const DOC_SECTIONS: { emoji: string; label: string; category: DocCategory; items: DocItem[] }[] = [
  { emoji: '📄', label: 'Governing documents', category: 'Governing Documents', items: [
    { name: 'CC&Rs (Covenants, Conditions & Restrictions)', desc: 'The recorded legal rulebook that runs with the land and binds every owner — sets property restrictions, the power to charge assessments, and who maintains what.' },
    { name: 'HOA Bylaws', desc: "The association's operating manual: how the board is elected, how meetings and votes work, and officer duties and terms." },
    { name: 'Articles of Incorporation', desc: 'The short charter filed with the state that legally creates the association as a corporation.' },
    { name: 'Rules & regulations', desc: 'Day-to-day rules the board adopts under the CC&Rs (pool hours, parking, noise) — easier to change than the CC&Rs themselves.' },
    { name: 'Architectural standards', desc: 'Design rules for exterior changes — paint, fences, additions — and how owners get approval before building.' },
    { name: 'Rental / leasing restrictions', desc: 'Limits on renting out units — minimum lease terms, caps on rentals, and tenant approval or registration.' },
    { name: 'Pet policy', desc: 'What pets are allowed, any size or breed limits, leash and waste rules, and registration requirements.' },
  ] },
  { emoji: '💰', label: 'Financial records', category: 'Financial Documents', items: [
    { name: 'Current annual budget', desc: "The board-approved plan of income and expenses for the year — the basis for each owner's dues." },
    { name: 'Reserve fund study', desc: 'A professional forecast of major future repairs (roof, paving) and how much to set aside each year for them.' },
    { name: 'Reserve fund balance statement', desc: 'How much is actually saved today in the reserve account for big-ticket repairs.' },
    { name: 'Delinquency report', desc: 'Owners behind on dues or assessments and how much each one owes.' },
    { name: 'Income & expense statement', desc: 'What the association earned and spent over a period — its profit-and-loss.' },
    { name: 'Insurance declarations', desc: "The summary pages of each policy showing what's covered, the limits, and deductibles." },
    { name: 'Bank statements (last 3 months)', desc: 'Recent statements for the operating and reserve accounts.' },
    { name: 'Most recent audit', desc: "An independent accountant's review confirming the financial statements are accurate." },
    { name: 'Tax returns (last 2 years)', desc: "The association's filed federal (and state) income tax returns." },
  ] },
  { emoji: '👥', label: 'Ownership & membership', category: 'Other', items: [
    { name: 'Homeowner roster with contact info', desc: 'Master list of every owner with mailing address, email, and phone for official notices.' },
    { name: 'Board member roster', desc: 'Names, roles, and terms of the current board of directors.' },
    { name: 'Committee member list', desc: 'Members serving on committees (architectural, social, finance) and what each covers.' },
    { name: 'Tenant directory', desc: 'List of renters and their units — where the community tracks non-owner occupants.' },
    { name: 'Delinquency list', desc: 'Current list of accounts past due, used for collections and lien decisions.' },
  ] },
  { emoji: '📅', label: 'Meetings & governance', category: 'Reports & Meeting Minutes', items: [
    { name: 'Board meeting minutes (last 12 mo.)', desc: 'Official written record of what the board discussed and decided at each meeting.' },
    { name: 'Annual meeting minutes (last 2 yr.)', desc: 'Record of the yearly membership meeting — elections, budget ratification, and owner business.' },
    { name: 'Election procedures', desc: 'The rules for nominating candidates, voting, and counting ballots for board elections.' },
    { name: 'Board resolution log', desc: 'A running list of formal board decisions and policies adopted by vote.' },
    { name: 'Proxy / ballot forms', desc: 'The forms owners use to vote, or to assign their vote to someone else.' },
  ] },
  { emoji: '🏠', label: 'Property & maintenance', category: 'Vendor & Contracts', items: [
    { name: 'Maintenance schedule', desc: 'The plan and calendar for routine upkeep of common areas and equipment.' },
    { name: 'Inspection reports', desc: 'Results of structural, elevator, fire, or pest inspections of the property.' },
    { name: 'Capital improvement list', desc: 'Planned major upgrades or replacements beyond routine maintenance.' },
    { name: 'Landscape contract', desc: 'The agreement with the lawn / landscaping vendor — scope, schedule, and cost.' },
    { name: 'Pool / amenity contracts', desc: 'Service agreements for the pool, gym, gate, or other shared amenities.' },
    { name: 'Open work orders', desc: 'Repairs and service requests currently in progress or waiting.' },
  ] },
  { emoji: '📋', label: 'Contracts & vendors', category: 'Vendor & Contracts', items: [
    { name: 'Property management agreement', desc: 'The contract with your management company — services, fees, and term.' },
    { name: 'Active vendor contracts', desc: 'All current service agreements (security, trash, elevator, and so on).' },
    { name: 'Vendor insurance certificates', desc: "Proof that each vendor carries liability and workers' comp insurance." },
    { name: 'Utility account info', desc: 'Account numbers and providers for shared electric, water, gas, and internet.' },
    { name: 'Waste removal contract', desc: 'The trash and recycling pickup agreement — schedule and cost.' },
  ] },
  { emoji: '⚖️', label: 'Compliance & legal', category: 'Other', items: [
    { name: 'State HOA registration', desc: 'Your filing or registration with the state agency that oversees associations.' },
    { name: 'Pending litigation', desc: 'Any active lawsuits the association is involved in, as plaintiff or defendant.' },
    { name: 'Open violations log', desc: 'Owners currently cited for rule violations and the status of each case.' },
    { name: 'Prior violation notices', desc: 'Past warning and fine letters sent to owners for rule breaches.' },
    { name: 'Fair housing records', desc: 'Documentation showing the association follows fair-housing and accommodation laws.' },
  ] },
  { emoji: '🔧', label: 'Operations', category: 'Other', items: [
    { name: 'Emergency contact list', desc: 'Who to call for after-hours emergencies — vendors, board, utilities.' },
    { name: 'Gate / access codes', desc: 'Current codes and credentials for gates, doors, and shared spaces.' },
    { name: 'Key / fob inventory log', desc: 'Record of who holds keys, fobs, and access cards to common areas.' },
    { name: 'Move-in / move-out policy', desc: 'Rules and fees for residents moving in or out — scheduling, deposits, elevator use.' },
    { name: 'Welcome packet', desc: 'The intro materials given to new owners and residents.' },
  ] },
]

type DocItemState = { checked: boolean; file: File | null }
type DocSectionState = { items: DocItemState[]; note: string }
const emptyDocState = (): DocSectionState[] =>
  DOC_SECTIONS.map((s) => ({ items: s.items.map(() => ({ checked: false, file: null })), note: '' }))

// The three "smart" wizard items processed specially after provisioning
// (roster → residents, budget → categories, CC&Rs → AI). Found by name, not
// position, so reordering the lists by importance never breaks the wiring.
const SMART_ITEMS = {
  ccrs: 'CC&Rs (Covenants, Conditions & Restrictions)',
  budget: 'Current annual budget',
  roster: 'Homeowner roster with contact info',
}
function smartFile(docState: DocSectionState[], itemName: string): File | null {
  for (let si = 0; si < DOC_SECTIONS.length; si++) {
    const ii = DOC_SECTIONS[si].items.findIndex((it) => it.name === itemName)
    if (ii >= 0) return docState[si]?.items?.[ii]?.file ?? null
  }
  return null
}

// Documents Residente produces itself from the community's data (rosters,
// minutes, statements, notices) — the board needn't hunt for/upload these. In
// the wizard they get a "Residente creates this" button instead of Upload; the
// live generators live in /admin (estoppel certs, meeting minutes, etc.).
const GENERATED_DOCS = new Set<string>([
  'Income & expense statement',
  'Delinquency report',
  'Board member roster',
  'Committee member list',
  'Delinquency list',
  'Board meeting minutes (last 12 mo.)',
  'Annual meeting minutes (last 2 yr.)',
  'Proxy / ballot forms',
  'Open violations log',
  'Prior violation notices',
])

export default function SignupPage() {
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
  const [docState, setDocState] = useState<DocSectionState[]>(emptyDocState)

  // Onboarding "Upload your documents" fork (Phase 0). setupMode picks the path
  // at the documents step; the parsed roster + budget are stashed here and
  // applied to the live tables after provisioning (like the doc/notes upload).
  // Documents step runs in two sub-phases: 'manual' (the doc wizard, where the
  // roster / budget / CC&Rs items get smart processing on the file you attach) →
  // 'review' (confirm what will be set up).
  const [setupMode, setSetupMode] = useState<'manual' | 'review'>('manual')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const seq = who ? FLOW[who] : (['property', 'role'] as Step[])
  const idx = Math.max(0, seq.indexOf(step))
  const progress = step === 'working' ? 100 : ((idx + 1) / seq.length) * 100
  const canBack = step !== 'working'

  const goBack = () => {
    setErr(null)
    // At the documents step the back button unwinds the setup flow before
    // leaving: manual-wizard category → category, then any chosen path → the
    // fork, then the fork → the previous step.
    if (step === 'documents') {
      if (setupMode === 'review') { setSetupMode('manual'); return }
      if (docSection > 0) { setDocSection(docSection - 1); return }
      // first wizard category → fall through to leave the documents step
    }
    if (idx > 0) setStep(seq[idx - 1])
    else window.location.assign('/')
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
              title: DOC_SECTIONS[si].items[ii].name,
              category: DOC_SECTIONS[si].category,
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
        const notes = docState.map((sec, si) => ({ section: DOC_SECTIONS[si].label, note: sec.note }))
        try { await saveSignupNotes(res.community_id, notes) } catch { /* non-fatal */ }

        // Smart processing of the wizard's own uploads — one place per document,
        // no separate upload step. The homeowner-roster CSV → residents, the
        // annual-budget CSV → budget categories, the CC&Rs PDF → AI fines/rules.
        // Each runs IN ADDITION to vaulting the file above; all best-effort.
        try {
          const rosterFile = smartFile(docState, SMART_ITEMS.roster)
          const budgetFile = smartFile(docState, SMART_ITEMS.budget)
          const roster = rosterFile && /\.csv$/i.test(rosterFile.name) ? parseRosterCsv(await rosterFile.text()) : undefined
          const budget = budgetFile && /\.csv$/i.test(budgetFile.name) ? parseBudgetCsv(await budgetFile.text()) : undefined
          if (roster?.length || budget?.length) {
            await applySignupImport(res.community_id, { roster, budget }, { skipName: fullName.trim() })
          }
        } catch { /* non-fatal */ }

        // CC&Rs → AI extraction: pre-fills late-fee / interest settings + rules.
        // PDF only. Inert (no-op) until ANTHROPIC_API_KEY is set + extract-setup
        // is deployed. Board reviews in /admin. Non-fatal.
        const ccrsFile = smartFile(docState, SMART_ITEMS.ccrs)
        if (ccrsFile && /\.pdf$/i.test(ccrsFile.name)) {
          try {
            const extracted = await extractSetupFromPdf(ccrsFile)
            if (extracted) await applyExtractedSetup(res.community_id, extracted)
          } catch { /* non-fatal */ }
        }
      }

      // Paid band (26+ homes) → pay on the spot: redirect straight into Stripe
      // subscription checkout. On failure we fall through to /admin, where the
      // Activate banner lets them complete payment. ≤25 homes is free → /admin.
      if (res.needs_payment) {
        const url = await startSubscriptionCheckout()
        if (url) { window.location.assign(url); return }
      }
      const dest = res.role === 'resident' ? '/onboard' : '/admin'
      window.location.assign(dest)
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
          {canBack ? (
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
            onPick={(t) => { setPropertyType(t); setErr(null); setStep('role') }}
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
            onNext={() => { setErr(null); setSetupMode('manual'); setDocSection(0); setStep('documents') }}
          />
        )}

        {step === 'documents' && setupMode === 'manual' && (
          <DocWizard
            section={docSection} setSection={setDocSection}
            state={docState} setState={setDocState}
            onNext={() => { setErr(null); setSetupMode('review') }}
          />
        )}

        {step === 'documents' && setupMode === 'review' && (
          <SetupReview docState={docState} onNext={() => { setErr(null); setStep('details') }} />
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
  const paid = band.perHomeCents > 0
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
        {paid ? <>The <span className="su-plan-hl">{band.label}</span> plan is right for you.</>
              : <>You&apos;re on us — the Free plan.</>}
      </h1>
      <p className="su-sub">
        {paid
          ? `Based on ${homes} ${unitWord}, here's your plan and everything it includes.`
          : `${homes} ${unitWord} means Residente is free for your community — forever. Here's everything you get.`}
      </p>
      <div className="su-content">
        <div className="su-plan-card">
          <div className="su-plan-top">
            <div className="su-plan-id">
              <div className="su-plan-name">{band.label}</div>
              <div className="su-plan-band">{band.band}</div>
            </div>
            <div className="su-plan-price">
              <span className="su-plan-amt">{paid ? total : 'Free'}</span>
              {paid && <span className="su-plan-unit">${perHome}/{oneWord}/mo · {homes} {unitWord}</span>}
            </div>
          </div>

          {paid && (
            <div className="su-plan-promo">
              <span className="su-plan-promo-tag">Launch offer</span>
              <span>Pay just <strong>$1/{oneWord}</strong> for your entire first year if you sign up by <strong>Aug 31, 2026</strong>.</span>
            </div>
          )}

          <div className="su-plan-feats-label">Every plan includes the whole platform</div>
          <ul className="su-plan-feats">
            {INCLUDED.map((f) => (
              <li key={f}><span className="su-plan-check"><IconCheck /></span>{f}</li>
            ))}
          </ul>

          {paid && (
            <p className="su-plan-fine">
              Billed to the association, monthly. Cancel anytime.
              Stripe processing fees are passed through.
            </p>
          )}
        </div>

        <div className="su-actions">
          <button className="su-btn" type="button" onClick={onNext}>
            {paid ? 'Continue to payment' : 'Continue — it’s free'}
          </button>
        </div>
        {paid && (
          <p className="su-foot">You&apos;ll create your account first, then pay securely with Stripe.</p>
        )}
      </div>
    </>
  )
}

// Review sub-phase: a single confirmation of what will be set up — residents,
// budget, CC&Rs, attached documents, notes — read from the wizard's own files,
// before continuing to the account step. "Change it later" is the escape hatch.
function SetupReview({ docState, onNext }: {
  docState: DocSectionState[]; onNext: () => void
}) {
  // Smart items located by name (order-independent).
  const ccrsFile = smartFile(docState, SMART_ITEMS.ccrs)
  const budgetFile = smartFile(docState, SMART_ITEMS.budget)
  const rosterFile = smartFile(docState, SMART_ITEMS.roster)
  const docCount = docState.reduce((s, sec) => s + sec.items.filter(it => it.file).length, 0)
  const noteCount = docState.filter(sec => sec.note.trim()).length

  const rows: { label: string; value: string; on: boolean }[] = [
    { label: 'Residents', value: rosterFile ? `From ${rosterFile.name}` : 'Add later', on: !!rosterFile },
    { label: 'Budget', value: budgetFile ? `From ${budgetFile.name}` : 'Add later', on: !!budgetFile },
    { label: 'CC&Rs / governing docs', value: ccrsFile ? `We’ll read ${ccrsFile.name}` : 'Add later', on: !!ccrsFile },
    { label: 'Documents attached', value: docCount ? `${docCount} file${docCount === 1 ? '' : 's'}` : 'None yet', on: docCount > 0 },
    { label: 'Notes', value: noteCount ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : 'None', on: noteCount > 0 },
  ]

  return (
    <>
      <div className="su-kicker">Review</div>
      <h1 className="su-h1">Here&rsquo;s what we&rsquo;ll set up.</h1>
      <p className="su-sub">You can change any of this later in your dashboard.</p>
      <div className="su-content">
        <div className="su-doc-card">
          <div className="su-doc-items">
            {rows.map(r => (
              <div className="su-doc-item" key={r.label}>
                <span className="su-doc-name-text" style={{ flex: 1, fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: r.on ? 700 : 500, color: r.on ? '#E14909' : 'rgba(42,18,6,0.5)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="su-actions">
          <button className="su-btn" type="button" onClick={onNext}>Looks good — continue</button>
        </div>
      </div>
    </>
  )
}

// Document-collection wizard (board / management). A self-contained mini-flow
// inside one signup step: one category per slide with confirm/upload toggles +
// notes, then a review summary. Everything is optional — every slide offers a
// skip, and attachments persist to the community vault after provisioning.
function DocWizard({
  section, setSection, state, setState, onNext,
}: {
  section: number; setSection: (n: number) => void
  state: DocSectionState[]; setState: React.Dispatch<React.SetStateAction<DocSectionState[]>>
  onNext: () => void
}) {
  const total = DOC_SECTIONS.length
  const onSummary = section >= total

  // Which item's plain-English description is expanded. Keyed by `section-index`
  // so the same row index in a different category doesn't stay open across jumps.
  const [openKey, setOpenKey] = useState<string | null>(null)

  const doneCount = (i: number) => state[i].items.filter((it) => it.checked).length
  const allDone = (i: number) => doneCount(i) === DOC_SECTIONS[i].items.length

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
      {DOC_SECTIONS.map((sec, i) => (
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
          {DOC_SECTIONS.map((sec, i) => {
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

  const sec = DOC_SECTIONS[section]
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
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(42,18,6,0.45)', padding: '12px 16px 2px' }}>
            Most important first ↓
          </div>
          <div className="su-doc-items">
            {sec.items.map((item, i) => {
              const it = s.items[i]
              const dkey = `${section}-${i}`
              const open = openKey === dkey
              const generated = GENERATED_DOCS.has(item.name)
              return (
                <div className="su-doc-row" key={item.name}>
                  <div className="su-doc-item">
                    <button type="button" className={`su-doc-check${it.checked ? ' on' : ''}`}
                      onClick={() => toggle(i)} aria-label={`${it.checked ? 'Uncheck' : 'Check'} ${item.name}`}>
                      <IconCheck />
                    </button>
                    {/* Tap the name to reveal a plain-English description of the
                        document — the checkbox stays the confirm action. */}
                    <button type="button" className={`su-doc-name${it.checked ? ' done' : ''}${open ? ' open' : ''}`}
                      onClick={() => setOpenKey(open ? null : dkey)} aria-expanded={open}>
                      <span className="su-doc-name-text">{item.name}</span>
                      {generated && (
                        <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#E14909', background: 'rgba(225,73,9,0.12)', padding: '2px 6px', borderRadius: 999, marginLeft: 6 }}>Auto</span>
                      )}
                      <span className="su-doc-caret" aria-hidden="true"><Chevron dir="right" /></span>
                    </button>
                    {generated ? (
                      // Residente produces this from the community's data — the
                      // board taps to have us create it instead of uploading. (At
                      // signup this marks intent; the live generator is in /admin.)
                      <button type="button" onClick={() => toggle(i)}
                        style={{ flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
                          padding: '6px 12px', borderRadius: 999, border: '1.5px solid',
                          borderColor: it.checked ? '#E14909' : 'rgba(42,18,6,0.22)',
                          background: it.checked ? 'rgba(225,73,9,0.12)' : 'transparent',
                          color: it.checked ? '#E14909' : 'rgba(42,18,6,0.7)' }}>
                        {it.checked ? '✓ Residente will create' : 'Residente creates it'}
                      </button>
                    ) : (
                      <label className={`su-doc-up${it.file ? ' done' : ''}`}>
                        {it.file ? '✓ Saved' : 'Upload'}
                        <input className="su-doc-file" type="file"
                          onChange={(e) => attach(i, e.target.files?.[0] ?? null)} />
                      </label>
                    )}
                  </div>
                  {open && <div className="su-doc-desc">{item.desc}</div>}
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
