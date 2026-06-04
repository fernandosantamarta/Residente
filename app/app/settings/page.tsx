'use client'

import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { signOut, supabase, hasSupabase } from '@/lib/supabase'
import { deleteAccount } from '@/lib/signup'
import { DangerAction } from '@/components/DangerAction'
import { useCommunityData } from '@/hooks/useCommunityData'
import {
  EMAIL_PREF_LABEL,
  HOMEPAGE_LABEL,
  LANGUAGE_LABEL,
  PUSH_PREF_LABEL,
  SMS_PREF_LABEL,
  WEEK_START_LABEL,
  fileToProfileImage,
  formatTime12,
  newId,
  usePreferences,
  type EmailPref,
  type HomepageRoute,
  type LanguageCode,
  type Preferences,
  type PushPref,
  type SmsPref,
  type WeekStart,
} from '@/lib/preferences'
import {
  listHomeDocs, uploadHomeDoc, setConveys, deleteHomeDoc, homeDocUrl,
  transferHome, HOME_DOC_CATEGORIES, type HomeDoc,
} from '@/lib/homeVault'
import { loadNotificationPrefs, saveNotificationPrefs } from '@/lib/notificationPrefs'
import { loadResidentLists, addContact, addVehicle, addPet, removeResidentRow } from '@/lib/residentLists'
import {
  isPushSupported, isPushConfigured, pushPermission, isSubscribedHere, enablePush, disablePush,
} from '@/lib/webPush'
import '../home/home.css'

// Every row + sidebar CTA opens a dialog (keyed below). One generic
// SettingsDialog component switches on the key. State writes through
// usePreferences() immediately on change so closing the dialog is the
// only "save" the user has to do.
type DialogKey =
  | 'profile' | 'security' | 'notifications'
  | 'language' | 'accessibility'
  | 'email' | 'sms' | 'push' | 'quiet-hours'
  | 'homepage' | 'calendar' | 'payment' | 'privacy'
  | 'unit' | 'contacts' | 'vehicles' | 'pets'
  | 'refer' | 'updates'

export default function Settings() {
  const { profile, setProfile } = useAuth() || {}
  const { community } = useCommunityData()
  const [prefs, patch] = usePreferences()
  const [dialog, setDialog] = useState<DialogKey | null>(null)

  // Two-way sync with the board's roster. The signed-in resident is matched
  // to their public.residents row by email (same match as useMyResident).
  // That row is the shared source of truth for name/email/phone: we seed
  // prefs from it once on load, and write name/phone back on edit so the
  // admin Residents page reflects what the resident maintains. Falls back to
  // localStorage-only when Supabase is off or there's no roster match yet.
  const [roster, setRoster] = useState<any | null>(null)
  const seededRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !supabase || !profile?.community_id || !profile?.email || !profile?.id) return
      try {
        // Match by the stable account link first; fall back to the legacy
        // email match and claim the row. Mirrors useMyResident so the
        // resident's Settings and the rest of the app resolve the same row.
        let row: any = null
        try {
          const byId = await supabase.from('residents').select('*')
            .eq('profile_id', profile.id).limit(1)
          if (!byId.error && byId.data && byId.data[0]) row = byId.data[0]
        } catch { /* no profile_id column yet — fall through */ }
        if (!row) {
          const byEmail = await supabase.from('residents').select('*')
            .eq('community_id', profile.community_id)
            .ilike('email', profile.email).limit(1)
          if (!byEmail.error && byEmail.data && byEmail.data[0]) {
            row = byEmail.data[0]
            if (!row.profile_id) {
              try {
                const claim = await supabase.from('residents').update({ profile_id: profile.id })
                  .eq('id', row.id).select().single()
                if (!claim.error && claim.data) row = claim.data
              } catch { /* pre-migration — ignore */ }
            }
          }
        }
        if (cancelled || !row) return
        setRoster(row)
        if (!seededRef.current) {
          seededRef.current = true
          // Name + phone come from the roster; email is the login email
          // (canonical), which providers already keeps current.
          const seed: Partial<Preferences> = {}
          if (row.full_name) seed.full_name = row.full_name
          if (row.phone)     seed.phone = row.phone
          if (profile.email) seed.email = profile.email
          if (Object.keys(seed).length) patch(seed)
        }
      } catch { /* prefs-only fallback */ }
    })()
    return () => { cancelled = true }
  }, [profile?.community_id, profile?.email, profile?.id])

  // Write a name/phone edit back to the roster row. No-op (local-only) when
  // there's no matched row yet — the board hasn't added this resident.
  const saveContact = async (next: { full_name?: string; phone?: string; address?: string }) => {
    patch(next)  // keep local prefs in sync even with no roster row yet
    if (!supabase) return
    try {
      // Name is canonical on the profiles table — the home greeting and the rest
      // of the app read profile.full_name from there, so a name edit MUST write
      // it back (and refresh the live session) or the greeting never updates.
      if (next.full_name !== undefined && profile?.id) {
        const { error } = await supabase
          .from('profiles').update({ full_name: next.full_name }).eq('id', profile.id)
        // Surface a failed write instead of swallowing it — a silent 403 here
        // (missing UPDATE grant on profiles) is what made name edits never
        // reach the home greeting. See supabase/profile-self-update.sql.
        if (error) console.warn('Could not save name to profiles:', error.message)
        if (setProfile && profile) setProfile({ ...profile, full_name: next.full_name })
      }
      // Roster row mirrors name/phone/address for the board's view.
      if (roster?.id) {
        const { error } = await supabase.from('residents').update(next).eq('id', roster.id)
        if (!error) setRoster((r: any) => ({ ...r, ...next }))
      }
    } catch { /* keep the local prefs copy */ }
  }

  // Mirror the notification subset of prefs to the DB so the server-side notice
  // fan-out can honor them (localStorage alone is invisible to the server).
  // Seed from the DB once on load, then upsert whenever a notification pref
  // changes. Requires supabase/resident-notification-prefs.sql.
  const notifSeeded = useRef(false)
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const row = await loadNotificationPrefs(profile.id)
      if (cancelled) return
      if (row) patch(row)
      notifSeeded.current = true
    })()
    return () => { cancelled = true }
  }, [profile?.id])
  useEffect(() => {
    if (!notifSeeded.current || !profile?.id) return
    void saveNotificationPrefs(profile.id, {
      email_pref: prefs.email_pref,
      sms_pref: prefs.sms_pref,
      push_pref: prefs.push_pref,
      quiet_hours_start: prefs.quiet_hours_start,
      quiet_hours_end: prefs.quiet_hours_end,
    })
  }, [prefs.email_pref, prefs.sms_pref, prefs.push_pref, prefs.quiet_hours_start, prefs.quiet_hours_end, profile?.id])

  // Hydrate the DB-backed lists (emergency contacts, vehicles, pets) into prefs
  // so the editors + row counts reflect the server, not stale localStorage.
  // Authed only; preview keeps its localStorage demo seed.
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const lists = await loadResidentLists(profile.id)
      if (cancelled || !lists) return
      patch({ emergency_contacts: lists.contacts, vehicles: lists.vehicles, pets: lists.pets })
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  const fullName    = prefs.full_name || profile?.full_name || 'Resident'
  const email       = prefs.email     || profile?.email     || 'resident@example.com'
  const unitLabel   = profile?.unit_number ? `Unit ${profile.unit_number}` : 'Unit —'
  const memberSince = 'Jan 2023'
  const communityName = community?.name || 'Sunset Lakes'

  return (
    <div className="set-wrap">
      <section className="set-hero">
        <div className="set-hero-content">
          <h1 className="set-hero-title">Settings</h1>
          <div className="set-hero-sub">
            Manage your account, preferences, and site settings for {communityName}.
          </div>
        </div>
      </section>

      <div className="set-grid">
        {/* MAIN COLUMN */}
        <div className="set-col">
          <SectionCard title="Account &amp; Profile">
            <Row icon={<IconUser />}  title="Profile Information"      desc="Update your name, photo, and contact info."
              onClick={() => setDialog('profile')} right={fullName} />
            <Row icon={<IconLock />}  title="Login &amp; Security"     desc="Password, two-factor, and active sessions."
              onClick={() => setDialog('security')} />
            <Row icon={<IconBell />}  title="Notification Preferences" desc="Choose what reaches you and how."
              onClick={() => setDialog('notifications')} />
            <Row icon={<IconGlobe />} title="Language"    desc="Choose your display language."
              onClick={() => setDialog('language')}
              right={LANGUAGE_LABEL[prefs.language]} />
            <Row icon={<IconEye />}   title="Accessibility"            desc="Larger text, reduced motion, high contrast."
              onClick={() => setDialog('accessibility')}
              right={accessibilitySummary(prefs)} />
          </SectionCard>

          <SectionCard title="Communication Preferences">
            <Row icon={<IconMail />} title="Email Preferences"  desc="Newsletters, board updates, billing receipts."
              onClick={() => setDialog('email')} right={EMAIL_PREF_LABEL[prefs.email_pref]} />
            <Row icon={<IconChat />} title="SMS Preferences"    desc="Texts for emergencies and dues reminders."
              onClick={() => setDialog('sms')}   right={SMS_PREF_LABEL[prefs.sms_pref]} />
            <Row icon={<IconPush />} title="Browser Notifications" desc="Browser push alerts when Residente isn't open."
              onClick={() => setDialog('push')}  right={PUSH_PREF_LABEL[prefs.push_pref]} />
            <Row icon={<IconMoon />} title="Quiet Hours"        desc="No non-emergency notifications during this window."
              onClick={() => setDialog('quiet-hours')}
              right={`${formatTime12(prefs.quiet_hours_start)} – ${formatTime12(prefs.quiet_hours_end)}`} />
          </SectionCard>

          <SectionCard title="Site Preferences">
            <Row icon={<IconHome />}     title="Default Landing Page" desc="Where Residente opens when you sign in."
              onClick={() => setDialog('homepage')} right={HOMEPAGE_LABEL[prefs.default_homepage]} />
            <Row icon={<IconCalendar />} title="Calendar Settings"   desc="Week start, default view, sync options."
              onClick={() => setDialog('calendar')} right={WEEK_START_LABEL[prefs.calendar_week_start]} />
            <Row icon={<IconCard />}     title="Payment Methods"     desc="Cards and bank accounts on file."
              onClick={() => setDialog('payment')}  right={`${prefs.payment_methods.length} saved`} />
            <Row icon={<IconShield />}   title="Privacy &amp; Data"  desc="Who can see your unit info and history."
              onClick={() => setDialog('privacy')} />
          </SectionCard>

          <SectionCard title="Community &amp; Unit">
            <Row icon={<IconKey />}   title="Unit Information"   desc="Address, square footage, ownership details."
              onClick={() => setDialog('unit')} right={unitLabel} />
            <Row icon={<IconPhone />} title="Emergency Contacts" desc="People the board reaches in an emergency."
              onClick={() => setDialog('contacts')} right={`${prefs.emergency_contacts.length} on file`} />
            <Row icon={<IconCar />}   title="Vehicle Information" desc="Cars registered for your designated spots."
              onClick={() => setDialog('vehicles')} right={`${prefs.vehicles.length} registered`} />
            <Row icon={<IconPaw />}   title="Pet Information"    desc="Pets registered with the community."
              onClick={() => setDialog('pets')} right={`${prefs.pets.length} registered`} />
          </SectionCard>

          <SectionCard title="Home Vault">
            <HomeVaultPanel />
          </SectionCard>

          <SectionCard title="Sell or transfer home">
            <HomeTransferPanel />
          </SectionCard>

          <button className="set-logout" onClick={() => signOut()}>
            <span className="set-logout-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </span>
            <span className="set-logout-body">
              <span className="set-logout-title">Log out</span>
              <span className="set-logout-desc">Sign out of your Residente account.</span>
            </span>
            <span className="set-logout-chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          <DangerAction
            confirmWord="DELETE"
            confirmLabel="Delete my account"
            title="Delete account"
            body={<>This permanently deletes your account and your personal data, and signs you out. If you&apos;re the only member of your community, the community is deleted too. This can&apos;t be undone.{' '}Need help instead? <a href="/app/contact" style={{ color: '#E5601F', fontWeight: 700 }}>Contact Residente</a>.</>}
            onConfirm={async () => {
              const r = await deleteAccount()
              if (r?.error) return r
              try { await signOut() } catch { /* ignore */ }
              if (typeof window !== 'undefined') window.location.assign('/')
              return { ok: true }
            }}
            trigger={(open) => (
              <button className="set-logout" onClick={open} style={{ marginTop: 12 }}>
                <span className="set-logout-icon" aria-hidden="true" style={{ color: '#b5481f' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </span>
                <span className="set-logout-body">
                  <span className="set-logout-title" style={{ color: '#b5481f' }}>Delete account</span>
                  <span className="set-logout-desc">Permanently remove your account and data.</span>
                </span>
                <span className="set-logout-chev" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </span>
              </button>
            )}
          />
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="set-aside">
          <div className="set-tile">
            <div className="set-tile-title">Account summary</div>
            <div className="set-account">
              <AvatarButton
                image={prefs.profile_image}
                fallback={(fullName[0] || 'R').toUpperCase()}
                onPick={async file => {
                  try {
                    const dataUrl = await fileToProfileImage(file)
                    patch({ profile_image: dataUrl })
                  } catch (err: any) {
                    alert(err?.message || 'Could not load that image.')
                  }
                }}
              />
              <div className="set-account-meta">
                <div className="set-account-name">{fullName}</div>
                <div className="set-account-email">{unitLabel} · {email}</div>
              </div>
            </div>
            <div className="set-account-rows">
              <div className="set-account-row"><span>Member since</span><span>{memberSince}</span></div>
              <div className="set-account-row"><span>Community</span><span>{communityName}</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('profile')}>
              View profile
            </button>
          </div>

          <div className="set-tile">
            <div className="set-tile-title">Quick links</div>
            <ul className="set-links">
              <li><Link href="/app/voice#contact">Help center</Link></li>
              <li><Link href="/app/voice#contact">Contact management</Link></li>
              <li><button type="button" className="set-links-btn" onClick={() => setDialog('notifications')}>Update communication preferences</button></li>
              <li><Link href="/app/documents">Download center</Link></li>
              <li><button type="button" className="set-links-btn" onClick={() => setDialog('refer')}>Refer a neighbor</button></li>
            </ul>
          </div>

          <div className="set-tile">
            <div className="set-tile-title">Preferences overview</div>
            <div className="set-prefs">
              <div className="set-pref-row"><span>Email</span><span>{EMAIL_PREF_LABEL[prefs.email_pref]}</span></div>
              <div className="set-pref-row"><span>SMS</span><span>{SMS_PREF_LABEL[prefs.sms_pref]}</span></div>
              <div className="set-pref-row"><span>Push</span><span>{PUSH_PREF_LABEL[prefs.push_pref]}</span></div>
              <div className="set-pref-row"><span>Quiet hours</span><span>{formatTime12(prefs.quiet_hours_start)} – {formatTime12(prefs.quiet_hours_end)}</span></div>
              <div className="set-pref-row"><span>Language</span><span>{LANGUAGE_LABEL[prefs.language]}</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('notifications')}>
              Edit preferences
            </button>
          </div>

          <div className="set-tile">
            <div className="set-tile-title">About this site</div>
            <div className="set-prefs">
              <div className="set-pref-row"><span>Build</span><span>1.2.5 (web)</span></div>
              <div className="set-pref-row"><span>Last deployed</span><span>May 27, 2026</span></div>
              <div className="set-pref-row"><span>Native apps</span><span>Coming soon</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('updates')}>
              Reload latest
            </button>
          </div>
        </aside>
      </div>

      {dialog && (
        <SettingsDialog
          k={dialog}
          prefs={prefs}
          patch={patch}
          unitLabel={unitLabel}
          community={communityName}
          roster={roster}
          profileId={profile?.id ?? null}
          communityId={profile?.community_id ?? null}
          onSaveContact={saveContact}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

// -- small helpers --------------------------------------------------

function accessibilitySummary(p: Preferences): string {
  const flags = [
    p.large_text && 'Larger text',
    p.reduced_motion && 'Reduced motion',
    p.high_contrast && 'High contrast',
  ].filter(Boolean) as string[]
  return flags.length ? flags.join(' · ') : 'Default'
}

// Home Vault: one row per category (Deed, Insurance, Warranties...). The
// document count sits at the far right; clicking a row opens a dropdown of that
// category's files (open / mark conveys / delete) plus an "add a file" action.
const HV_CATEGORY_DESC: Record<string, string> = {
  'Deed & closing':   'Deed, title, and closing documents.',
  'Insurance':        'Homeowner and hazard policies.',
  'Warranties':       'Appliance and system warranties.',
  'Permits':          'Renovation and building permits.',
  'Appliance manuals':'Manuals for what stays with the home.',
  'HOA documents':    'Welcome packet, rules, and statements.',
  'Other':            'Anything else worth keeping.',
}

function HomeVaultPanel() {
  const { profile } = useAuth() || {}
  const profileId = profile?.id
  const communityId = profile?.community_id ?? null
  const [docs, setDocs] = useState<HomeDoc[]>([])
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Add-document modal state.
  const [addCat, setAddCat] = useState<string | null>(null)
  const [mFile, setMFile] = useState<File | null>(null)
  const [mTitle, setMTitle] = useState('')
  const [mNote, setMNote] = useState('')
  const [mBusy, setMBusy] = useState(false)

  const reload = async () => {
    if (!profileId) return
    try { setDocs(await listHomeDocs(profileId)) } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => { reload() }, [profileId])

  const openAdd = (cat: string) => { setAddCat(cat); setMFile(null); setMTitle(''); setMNote('') }
  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mFile || !profileId || !addCat) return
    setMBusy(true); setErr(null)
    try {
      await uploadHomeDoc({ file: mFile, title: mTitle, note: mNote, category: addCat, profileId, communityId, residentId: null })
      setAddCat(null); await reload()
    } catch (e2) { setErr((e2 as Error).message || 'Upload failed.') }
    finally { setMBusy(false) }
  }
  const openDoc = async (d: HomeDoc) => { const u = await homeDocUrl(d.storage_path); if (u) window.open(u, '_blank', 'noopener') }
  const remove = async (d: HomeDoc) => { try { await deleteHomeDoc(d); reload() } catch (e) { setErr((e as Error).message) } }
  const toggle = async (d: HomeDoc) => { try { await setConveys(d.id, !d.conveys); reload() } catch (e) { setErr((e as Error).message) } }
  const fmtD = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <>
      {err && <div className="hv-err">{err}</div>}
      {HOME_DOC_CATEGORIES.map(cat => {
        const items = docs.filter(d => d.category === cat)
        const isOpen = openCat === cat
        return (
          <div key={cat} className="hv-cat">
            <button type="button" className={`set-row${isOpen ? ' hv-cat-open' : ''}`} onClick={() => setOpenCat(isOpen ? null : cat)}>
              <span className="set-row-icon"><IconKey /></span>
              <span className="set-row-body">
                <span className="set-row-title">{cat}</span>
                <span className="set-row-desc">{HV_CATEGORY_DESC[cat] || ''}</span>
              </span>
              <span className="set-row-right">{items.length} {items.length === 1 ? 'document' : 'documents'}</span>
              <svg className="set-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            {isOpen && (
              <div className="hv-cat-drop">
                {items.length === 0 && <div className="hv-muted">No files in this category yet.</div>}
                {items.map(d => (
                  <div key={d.id} className="hv-docrow">
                    <button type="button" className="hv-doc-main" onClick={() => openDoc(d)}>
                      <span className="hv-doc-title">{d.title}</span>
                      <span className="hv-doc-meta">{fmtD(d.uploaded_at)}{d.note ? ` · ${d.note}` : ''}</span>
                    </button>
                    <label className="hv-conveys" title="Transfers to the next owner when you sell">
                      <input type="checkbox" checked={d.conveys} onChange={() => toggle(d)} /><span>Conveys</span>
                    </label>
                    <button type="button" className="hv-doc-del" onClick={() => remove(d)} aria-label="Delete">×</button>
                  </div>
                ))}
                <button type="button" className="hv-cat-add" onClick={() => openAdd(cat)}>+ Add a document</button>
              </div>
            )}
          </div>
        )
      })}

      {addCat && (
        <div className="hv-modal-overlay" onClick={() => !mBusy && setAddCat(null)}>
          <form className="hv-modal" onClick={e => e.stopPropagation()} onSubmit={submitAdd}>
            <div className="hv-modal-title">Add to {addCat}</div>
            <label className="hv-field">
              <span className="hv-label">File</span>
              <input className="hv-input" type="file" required
                onChange={e => { const f = e.target.files?.[0] ?? null; setMFile(f); if (f && !mTitle) setMTitle(f.name.replace(/\.[^.]+$/, '')) }} />
            </label>
            <label className="hv-field">
              <span className="hv-label">Title</span>
              <input className="hv-input" value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="e.g. Roof warranty" autoFocus />
            </label>
            <label className="hv-field">
              <span className="hv-label">Note</span>
              <textarea className="hv-input hv-textarea" rows={3} value={mNote} onChange={e => setMNote(e.target.value)}
                placeholder="Optional — anything worth remembering about this document." />
            </label>
            {err && <div className="hv-err">{err}</div>}
            <div className="hv-modal-actions">
              <button type="button" className="hv-btn-ghost" onClick={() => setAddCat(null)} disabled={mBusy}>Cancel</button>
              <button type="submit" className="hv-btn" disabled={mBusy || !mFile}>{mBusy ? 'Adding…' : 'Add'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

// Sell / transfer this home — its own section, styled like Home Vault. One
// danger row with a red action that opens a confirm modal; the modal calls the
// home-transfer edge function to hand the unit + its conveying docs to the buyer.
function HomeTransferPanel() {
  const { profile } = useAuth() || {}
  const profileId = profile?.id
  const communityId = profile?.community_id ?? null
  // The owner types their own name to confirm — the type-to-confirm pattern,
  // harder to do by accident than a checkbox. Fall back to "your full name"
  // when we don't have one on file yet (rare; they can still type something).
  const ownerName = (profile?.full_name || '').trim()

  const [residentId, setResidentId] = useState<string | null>(null)
  const [conveyCount, setConveyCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [typedName, setTypedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Confirmed when the typed name matches the owner's name (case/space
  // insensitive). If we have no name on file, accept any non-empty entry.
  const nameMatches = ownerName
    ? typedName.trim().toLowerCase() === ownerName.toLowerCase()
    : typedName.trim().length > 1

  // Resolve this owner's roster row id + how many of their docs convey. Match
  // by account id first, then email (pre-claim), mirroring the home page.
  useEffect(() => {
    if (!profileId || !supabase) return
    ;(async () => {
      try {
        const byId = await supabase.from('residents').select('id').eq('profile_id', profileId).limit(1)
        let id = byId.data?.[0]?.id ?? null
        if (!id && communityId) {
          const { data: prof } = await supabase.from('profiles').select('email').eq('id', profileId).single()
          const email2 = prof?.email
          if (email2) {
            const byEmail = await supabase.from('residents').select('id')
              .eq('community_id', communityId).ilike('email', email2).limit(1)
            id = byEmail.data?.[0]?.id ?? null
          }
        }
        setResidentId(id)
        const docs = await listHomeDocs(profileId)
        setConveyCount(docs.filter(d => d.conveys).length)
      } catch { /* leave defaults — button stays disabled */ }
    })()
  }, [profileId, communityId])

  const openModal = () => { setEmail(''); setName(''); setTypedName(''); setDone(null); setErr(null); setOpen(true) }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!residentId || !email.trim() || !nameMatches) return
    setBusy(true); setErr(null)
    try {
      const res = await transferHome({ residentId, buyerEmail: email.trim(), buyerName: name.trim() || undefined })
      setDone(
        `Home transferred. ${res.docs_conveyed} document${res.docs_conveyed === 1 ? '' : 's'} moved to the new owner` +
        (res.email_sent ? ', and they were emailed a set-up link.' : '. (We could not send the email — share their invite link manually.)')
      )
    } catch (e2) { setErr((e2 as Error).message || 'Transfer failed.') }
    finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="set-row" onClick={openModal}
        title="Transfer this home to the next owner">
        <span className="set-row-icon hv-xfer-icon"><IconHome /></span>
        <span className="set-row-body">
          <span className="set-row-title">Sell or transfer this home</span>
          <span className="set-row-desc">
            Once the sale has closed, hand your unit to the next owner. The {conveyCount} document
            {conveyCount === 1 ? '' : 's'} marked “Conveys” move to them, plus an invite to set up their account.
          </span>
        </span>
        <svg className="set-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      {open && (
        <div className="hv-modal-overlay" onClick={() => !busy && setOpen(false)}>
          <form className="hv-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
            <div className="hv-modal-title">Transfer this home</div>
            {done ? (
              <>
                <div className="hv-xfer-success">{done}</div>
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn" onClick={() => setOpen(false)}>Done</button>
                </div>
              </>
            ) : !residentId ? (
              <>
                <div className="hv-xfer-warn">
                  We couldn’t find a home on your account to transfer. This tool moves a specific
                  unit, so your account needs to be linked to a home on the community roster first.
                  Ask your board to add you (or check that your account email matches the one they
                  have on file), then come back here.
                </div>
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn" onClick={() => setOpen(false)}>Got it</button>
                </div>
              </>
            ) : (
              <>
                <div className="hv-xfer-warn">
                  <strong>Only do this after closing.</strong> Wait until the sale is final and the
                  contract is signed — this immediately moves your unit and its {conveyCount} conveying
                  document{conveyCount === 1 ? '' : 's'} to the new owner. You’ll no longer own this home
                  on Residente, and this can’t be undone from here.
                </div>
                <label className="hv-field">
                  <span className="hv-label">Buyer’s email</span>
                  <input className="hv-input" type="email" required value={email}
                    onChange={e => setEmail(e.target.value)} placeholder="newowner@email.com" autoFocus />
                </label>
                <label className="hv-field">
                  <span className="hv-label">Buyer’s name (optional)</span>
                  <input className="hv-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jordan Lee" />
                </label>
                <label className="hv-field">
                  <span className="hv-label">
                    Type your name to confirm{ownerName ? <> — <strong>{ownerName}</strong></> : ''}
                  </span>
                  <input className="hv-input" value={typedName} onChange={e => setTypedName(e.target.value)}
                    placeholder={ownerName || 'Your full name'} autoComplete="off" />
                </label>
                {err && <div className="hv-err">{err}</div>}
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
                  <button type="submit" className="hv-danger-btn" disabled={busy || !email.trim() || !nameMatches}>
                    {busy ? 'Transferring…' : 'Transfer home'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h2 className="set-section-title" dangerouslySetInnerHTML={{ __html: titleWithAmp(title) }} />
      <div className="set-section-rows">{children}</div>
    </section>
  )
}

function titleWithAmp(t: string) {
  return t.replace(/&amp;/g, '<span class="rb-amp">&amp;</span>')
}

function Row({
  icon, title, desc, right, onClick,
}: {
  icon: ReactNode; title: string; desc: string; right?: string; onClick: () => void
}) {
  return (
    <button type="button" className="set-row" onClick={onClick}>
      <span className="set-row-icon">{icon}</span>
      <span className="set-row-body">
        <span className="set-row-title" dangerouslySetInnerHTML={{ __html: titleWithAmp(title) }} />
        <span className="set-row-desc">{desc.replace(/&amp;/g, '&').replace(/&ndash;/g, '–')}</span>
      </span>
      {right && <span className="set-row-right">{right}</span>}
      <svg className="set-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  )
}

// -- dialog ----------------------------------------------------------

function SettingsDialog({
  k, prefs, patch, unitLabel, community, roster, profileId, communityId, onSaveContact, onClose,
}: {
  k: DialogKey
  prefs: Preferences
  patch: (p: Partial<Preferences>) => void
  unitLabel: string
  community: string
  roster: any | null
  profileId: string | null
  communityId: string | null
  onSaveContact: (next: { full_name?: string; phone?: string; address?: string }) => void
  onClose: () => void
}) {
  // Esc closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = DIALOG_TITLE[k]
  return (
    <div className="set-dialog-backdrop" onClick={onClose}>
      <div className="set-dialog-card" role="dialog" aria-modal="true"
           onClick={e => e.stopPropagation()}>
        <header className="set-dialog-head">
          <h2 className="set-dialog-title">{title}</h2>
          <button type="button" className="set-dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="set-dialog-body">
          <DialogBody k={k} prefs={prefs} patch={patch} unitLabel={unitLabel}
            community={community} roster={roster} profileId={profileId} communityId={communityId}
            onSaveContact={onSaveContact} />
        </div>
        <footer className="set-dialog-foot">
          <button type="button" className="set-btn-primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  )
}

const DIALOG_TITLE: Record<DialogKey, string> = {
  profile:        'Profile information',
  security:       'Login & security',
  notifications:  'Notification preferences',
  language:       'Language',
  accessibility:  'Accessibility',
  email:          'Email preferences',
  sms:            'SMS preferences',
  push:           'Push notifications',
  'quiet-hours':  'Quiet hours',
  homepage:       'Default landing page',
  calendar:       'Calendar settings',
  payment:        'Payment methods',
  privacy:        'Privacy & data',
  unit:           'Unit information',
  contacts:       'Emergency contacts',
  vehicles:       'Vehicle information',
  pets:           'Pet information',
  refer:          'Refer a neighbor',
  updates:        'Reload latest',
}

// First / Last name editor. First and Last are independent local state so
// clearing one never reshuffles the other (the old version re-split a single
// full_name string on every render, so emptying First slid Last into its
// place and you kept erasing the wrong field). full_name stays the saved
// source of truth — we push the recombined value on every edit, and a
// guaranteed space lets the home greeting pick out the real first name.
function ProfileNameFields({
  prefs, patch, onSaveContact,
}: {
  prefs: Preferences
  patch: (p: Partial<Preferences>) => void
  onSaveContact: (next: { full_name?: string; phone?: string; address?: string }) => void
}) {
  const seed = (prefs.full_name || '').trim()
  const seedSp = seed.indexOf(' ')
  const [first, setFirst] = useState(seedSp === -1 ? seed : seed.slice(0, seedSp))
  const [last, setLast]   = useState(seedSp === -1 ? '' : seed.slice(seedSp + 1).trim())

  const recombine = (f: string, l: string) => `${f.trim()} ${l.trim()}`.trim()

  return (
    <div className="set-name-row">
      <Field label="First name">
        <input name="given-name" autoComplete="given-name" className="set-input" value={first}
          onChange={e => { setFirst(e.target.value); patch({ full_name: recombine(e.target.value, last) }) }}
          onBlur={() => onSaveContact({ full_name: recombine(first, last) })}
          placeholder="Maria" />
      </Field>
      <Field label="Last name">
        <input name="family-name" autoComplete="family-name" className="set-input" value={last}
          onChange={e => { setLast(e.target.value); patch({ full_name: recombine(first, e.target.value) }) }}
          onBlur={() => onSaveContact({ full_name: recombine(first, last) })}
          placeholder="Santos" />
      </Field>
    </div>
  )
}

function DialogBody({
  k, prefs, patch, unitLabel, community, roster, profileId, communityId, onSaveContact,
}: {
  k: DialogKey
  prefs: Preferences
  patch: (p: Partial<Preferences>) => void
  unitLabel: string
  community: string
  roster: any | null
  profileId: string | null
  communityId: string | null
  onSaveContact: (next: { full_name?: string; phone?: string; address?: string }) => void
}) {
  switch (k) {
    case 'profile':
      return (
        <>
          <ProfilePhotoEditor prefs={prefs} patch={patch} />
          <ProfileNameFields prefs={prefs} patch={patch} onSaveContact={onSaveContact} />
          <EmailChanger />
          <Field label="Phone">
            <input name="phone" autoComplete="tel" className="set-input" type="tel" value={prefs.phone}
              onChange={e => patch({ phone: e.target.value })}
              onBlur={e => onSaveContact({ phone: e.target.value.trim() })}
              placeholder="(305) 555-0142" />
          </Field>
          <Field label="Address">
            <input name="street-address" autoComplete="street-address" className="set-input" value={prefs.address}
              onChange={e => patch({ address: e.target.value })}
              onBlur={e => onSaveContact({ address: e.target.value.trim() })}
              placeholder="1247 Oak Street" />
          </Field>
          {roster ? (
            <span className="set-dialog-note set-dialog-note-tight">
              ✓ Synced to your community record — your name and phone update the board&rsquo;s roster.
            </span>
          ) : (
            <span className="set-dialog-note set-dialog-note-tight">
              Saved on this device. Once the board adds you to the roster (matched by this email),
              your name and phone will sync to them automatically.
            </span>
          )}
        </>
      )

    case 'security':
      return (
        <>
          <p className="set-dialog-note">
            Password and 2FA are managed by your community&rsquo;s Supabase auth.
            From the demo build these actions surface as stubs.
          </p>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert('A reset link would be sent to ' + (prefs.email || 'your email') + '.')}>
            Send password reset link
          </button>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert('Two-factor setup is wired up in production.')}>
            Set up two-factor authentication
          </button>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert('No other active sessions detected.')}>
            View active sessions
          </button>
        </>
      )

    case 'notifications':
      return (
        <>
          <RadioGroup<EmailPref>
            label="Email"
            value={prefs.email_pref}
            onChange={v => patch({ email_pref: v })}
            options={[
              { value: 'all',       label: 'All updates',     desc: 'Board posts, billing receipts, newsletters.' },
              { value: 'important', label: 'Important only',  desc: 'Billing, votes, emergencies.' },
              { value: 'none',      label: 'None',            desc: 'Mute community email entirely.' },
            ]}
          />
          <RadioGroup<SmsPref>
            label="SMS"
            value={prefs.sms_pref}
            onChange={v => patch({ sms_pref: v })}
            options={[
              { value: 'all',       label: 'All texts',         desc: 'Reminders, RSVP nudges, dues prompts.' },
              { value: 'emergency', label: 'Emergency only',    desc: 'Texts only when something urgent is happening.' },
              { value: 'none',      label: 'None',              desc: 'No SMS at all.' },
            ]}
          />
          <RadioGroup<PushPref>
            label="Push"
            value={prefs.push_pref}
            onChange={v => patch({ push_pref: v })}
            options={[
              { value: 'all',       label: 'All',              desc: 'Every push the board sends.' },
              { value: 'important', label: 'Important only',   desc: 'Votes, dues, emergencies.' },
              { value: 'none',      label: 'None',             desc: 'Silence in-app and mobile push.' },
            ]}
          />
          <Field label="Quiet hours">
            <div className="set-time-row">
              <input name="quiet_hours_start" className="set-input" type="time" value={prefs.quiet_hours_start}
                onChange={e => patch({ quiet_hours_start: e.target.value })} />
              <span className="set-time-sep">to</span>
              <input name="quiet_hours_end" className="set-input" type="time" value={prefs.quiet_hours_end}
                onChange={e => patch({ quiet_hours_end: e.target.value })} />
            </div>
          </Field>
        </>
      )

    case 'language':
      return (
        <RadioGroup<LanguageCode>
          label="Display language"
          value={prefs.language}
          onChange={v => patch({ language: v })}
          options={[
            { value: 'en', label: 'English',     desc: 'Default for the cockpit.' },
            { value: 'es', label: 'Español',     desc: 'Para residentes hispanohablantes.' },
            { value: 'pt', label: 'Português',   desc: 'Para residentes que falam português.' },
          ]}
        />
      )

    case 'accessibility':
      return (
        <>
          <ToggleRow
            label="Larger text"
            desc="Bump body and label sizes for easier reading."
            checked={prefs.large_text}
            onChange={v => patch({ large_text: v })}
          />
          <ToggleRow
            label="Reduce motion"
            desc="Skip the welcome zoom and other animated transitions."
            checked={prefs.reduced_motion}
            onChange={v => patch({ reduced_motion: v })}
          />
          <ToggleRow
            label="High contrast"
            desc="Stronger borders and darker text for low-light viewing."
            checked={prefs.high_contrast}
            onChange={v => patch({ high_contrast: v })}
          />
        </>
      )

    case 'email':
      return (
        <RadioGroup<EmailPref>
          value={prefs.email_pref}
          onChange={v => patch({ email_pref: v })}
          options={[
            { value: 'all',       label: 'All updates',     desc: 'Board posts, billing receipts, newsletters.' },
            { value: 'important', label: 'Important only',  desc: 'Billing, votes, emergencies.' },
            { value: 'none',      label: 'None',            desc: 'Mute community email entirely.' },
          ]}
        />
      )

    case 'sms':
      return (
        <RadioGroup<SmsPref>
          value={prefs.sms_pref}
          onChange={v => patch({ sms_pref: v })}
          options={[
            { value: 'all',       label: 'All texts',         desc: 'Reminders, RSVP nudges, dues prompts.' },
            { value: 'emergency', label: 'Emergency only',    desc: 'Texts only when something urgent is happening.' },
            { value: 'none',      label: 'None',              desc: 'No SMS at all.' },
          ]}
        />
      )

    case 'push':
      return (
        <>
          <PushDeviceToggle profileId={profileId ?? undefined} communityId={communityId} />
          <RadioGroup<PushPref>
            value={prefs.push_pref}
            onChange={v => patch({ push_pref: v })}
            options={[
              { value: 'all',       label: 'All',              desc: 'Every push the board sends.' },
              { value: 'important', label: 'Important only',   desc: 'Votes, dues, emergencies.' },
              { value: 'none',      label: 'None',             desc: 'Silence in-app and mobile push.' },
            ]}
          />
        </>
      )

    case 'quiet-hours':
      return (
        <>
          <p className="set-dialog-note">
            No non-emergency notifications will reach you during this window.
          </p>
          <Field label="Start">
            <input name="quiet_start" className="set-input" type="time" value={prefs.quiet_hours_start}
              onChange={e => patch({ quiet_hours_start: e.target.value })} />
          </Field>
          <Field label="End">
            <input name="quiet_end" className="set-input" type="time" value={prefs.quiet_hours_end}
              onChange={e => patch({ quiet_hours_end: e.target.value })} />
          </Field>
        </>
      )

    case 'homepage':
      return (
        <RadioGroup<HomepageRoute>
          value={prefs.default_homepage}
          onChange={v => patch({ default_homepage: v })}
          options={(Object.keys(HOMEPAGE_LABEL) as HomepageRoute[]).map(r => ({
            value: r, label: HOMEPAGE_LABEL[r],
          }))}
        />
      )

    case 'calendar':
      return (
        <RadioGroup<WeekStart>
          label="Week starts on"
          value={prefs.calendar_week_start}
          onChange={v => patch({ calendar_week_start: v })}
          options={[
            { value: 'sun', label: 'Sunday' },
            { value: 'mon', label: 'Monday' },
          ]}
        />
      )

    case 'payment':
      return <PaymentMethodsEditor prefs={prefs} patch={patch} />

    case 'privacy':
      return (
        <>
          <p className="set-dialog-note">
            Demo privacy toggles &mdash; production will surface the real
            data-sharing controls from the community settings table.
          </p>
          <ToggleRow label="Show my unit in the resident directory" desc="Other residents can see your name + unit." checked={true}  onChange={() => {}} />
          <ToggleRow label="Share vehicle info with the gate"        desc="Speeds up plate-based gate access."         checked={true}  onChange={() => {}} />
          <ToggleRow label="Include me in community-wide polls"      desc="Anonymous tallies, no individual votes."    checked={true}  onChange={() => {}} />
        </>
      )

    case 'unit':
      return (
        <>
          <p className="set-dialog-note">
            Unit details are managed by the HOA board. Contact management to update.
          </p>
          <div className="set-readonly-rows">
            <div className="set-readonly-row"><span>Unit</span><span>{unitLabel}</span></div>
            <div className="set-readonly-row"><span>Community</span><span>{community}</span></div>
            {roster?.address && (
              <div className="set-readonly-row"><span>Address</span><span>{roster.address}</span></div>
            )}
          </div>
          {!roster && (
            <p className="set-dialog-note set-dialog-note-tight">
              Once the board adds you to the roster (matched by your email), your
              unit details will show here.
            </p>
          )}
        </>
      )

    case 'contacts':
      return (
        <ContactsEditor prefs={prefs} patch={patch} profileId={profileId} communityId={communityId} />
      )

    case 'vehicles':
      return (
        <VehiclesEditor prefs={prefs} patch={patch} profileId={profileId} communityId={communityId} />
      )

    case 'pets':
      return (
        <PetsEditor prefs={prefs} patch={patch} profileId={profileId} communityId={communityId} />
      )

    case 'refer':
      return <ReferDialog community={community} />

    case 'updates':
      return <UpdatesDialog />

    default:
      return <p>Unknown setting.</p>
  }
}

// -- shared field/control components --------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="set-dialog-field">
      <span className="set-dialog-field-label">{label}</span>
      {children}
    </label>
  )
}

// Per-device push enable/disable. The push_pref radio below it decides WHAT
// gets pushed; this decides WHETHER this browser is subscribed at all. State is
// per-browser (a push subscription is tied to one browser/device), so the user
// turns it on once per device.
function PushDeviceToggle({ profileId, communityId }: { profileId?: string; communityId?: string | null }) {
  const [supported]  = useState(() => isPushSupported())
  const [configured] = useState(() => isPushConfigured())
  const [perm, setPerm]             = useState<NotificationPermission | 'unsupported'>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy]             = useState(false)
  const [msg, setMsg]               = useState('')

  useEffect(() => {
    setPerm(pushPermission())
    isSubscribedHere().then(setSubscribed)
  }, [])

  if (!supported) {
    return (
      <p className="set-dialog-note">
        This browser doesn’t support push notifications. On iPhone, add Residente to your
        Home Screen first, then enable it from the installed app.
      </p>
    )
  }

  const onEnable = async () => {
    if (!profileId) { setMsg('Sign in first.'); return }
    setBusy(true); setMsg('')
    const res = await enablePush(profileId, communityId ?? null)
    setBusy(false)
    setPerm(pushPermission())
    if (res.ok) { setSubscribed(true); setMsg('✓ This device will now get push alerts.') }
    else setMsg(res.error || 'Could not enable push.')
  }
  const onDisable = async () => {
    setBusy(true); setMsg('')
    await disablePush()
    setBusy(false); setSubscribed(false); setMsg('Push turned off on this device.')
  }

  return (
    <div className="set-dialog-field" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="set-dialog-field-label" style={{ marginBottom: 0 }}>This device</span>
        {configured && perm !== 'denied' && (
          subscribed ? (
            <button type="button" className="set-btn-ghost" disabled={busy} onClick={onDisable}>
              {busy ? 'Working…' : 'Turn off'}
            </button>
          ) : (
            <button type="button" className="set-btn-primary" disabled={busy} onClick={onEnable}>
              {busy ? 'Working…' : 'Enable'}
            </button>
          )
        )}
      </div>
      {!configured && (
        <p className="set-dialog-note">Push isn’t configured on the server yet.</p>
      )}
      {configured && perm === 'denied' && (
        <p className="set-dialog-note">
          Notifications are blocked for this site in your browser settings. Allow them, then
          reopen this dialog.
        </p>
      )}
      {msg && <p className="set-dialog-note" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  )
}

function RadioGroup<T extends string>({
  label, value, onChange, options,
}: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; desc?: string }[]
}) {
  return (
    <div className="set-dialog-field">
      {label && <span className="set-dialog-field-label">{label}</span>}
      <div className="set-radio-list">
        {options.map(o => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              className={`set-radio${on ? ' on' : ''}`}
              onClick={() => onChange(o.value)}
            >
              <span className={`set-radio-dot${on ? ' on' : ''}`} aria-hidden="true" />
              <span className="set-radio-body">
                <span className="set-radio-label">{o.label}</span>
                {o.desc && <span className="set-radio-desc">{o.desc}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ToggleRow({
  label, desc, checked, onChange,
}: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="set-toggle-row">
      <div className="set-toggle-body">
        <div className="set-toggle-label">{label}</div>
        <div className="set-toggle-desc">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`set-toggle${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="set-toggle-knob" />
      </button>
    </div>
  )
}

function PaymentMethodsEditor({ prefs, patch }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'card' | 'bank'>('card')
  const [brand, setBrand] = useState('')
  const [last4, setLast4] = useState('')
  const reset = () => { setKind('card'); setBrand(''); setLast4(''); setAdding(false) }
  const submit = () => {
    if (!brand.trim() || !/^\d{4}$/.test(last4)) return
    patch({
      payment_methods: [
        ...prefs.payment_methods,
        { id: newId('pm'), brand: brand.trim(), last4, kind },
      ],
    })
    reset()
  }
  return (
    <div className="set-list">
      {prefs.payment_methods.length === 0 && <div className="set-list-empty">No payment methods saved.</div>}
      {prefs.payment_methods.map(pm => (
        <div key={pm.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{pm.brand} ···· {pm.last4}</strong>
            <span>{pm.kind === 'card' ? 'Credit / debit card' : 'Bank account'}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label="Remove"
            onClick={() => patch({ payment_methods: prefs.payment_methods.filter(x => x.id !== pm.id) })}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <RadioGroup<'card' | 'bank'>
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'card', label: 'Credit or debit card' },
              { value: 'bank', label: 'Bank account (ACH)' },
            ]}
          />
          <Field label={kind === 'card' ? 'Card brand' : 'Bank name'}>
            <input name="brand" className="set-input" value={brand} onChange={e => setBrand(e.target.value)}
              placeholder={kind === 'card' ? 'Visa' : 'Bank of America'} />
          </Field>
          <Field label="Last 4 digits">
            <input name="last4" className="set-input" value={last4} inputMode="numeric"
              onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4242" />
          </Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>Save</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>Cancel</button>
          </div>
          <p className="set-dialog-note set-dialog-note-tight">
            Stripe handles the real card details &mdash; this only stores the brand + last 4 for display.
          </p>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>+ Add payment method</button>
      )}
    </div>
  )
}

// -- list-editor add forms ------------------------------------------

function ContactsEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  const [phone, setPhone] = useState('')
  const reset = () => { setName(''); setRelation(''); setPhone(''); setAdding(false) }
  const submit = async () => {
    if (!name.trim()) return
    const entry = { name: name.trim(), relation: relation.trim() || 'Contact', phone: phone.trim() }
    const row = profileId ? await addContact(profileId, communityId, entry) : null
    patch({ emergency_contacts: [...prefs.emergency_contacts, row || { id: newId('c'), ...entry }] })
    reset()
  }
  const remove = async (id: string) => {
    if (profileId) await removeResidentRow('resident_emergency_contacts', id)
    patch({ emergency_contacts: prefs.emergency_contacts.filter(x => x.id !== id) })
  }
  return (
    <div className="set-list">
      {prefs.emergency_contacts.length === 0 && <div className="set-list-empty">No emergency contacts saved.</div>}
      {prefs.emergency_contacts.map(c => (
        <div key={c.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{c.name}</strong>
            <span>{c.relation}{c.phone ? ` · ${c.phone}` : ''}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label="Remove"
            onClick={() => remove(c.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label="Name"><input name="contact_name" className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder="Maria Santos" /></Field>
          <Field label="Relation"><input name="contact_relation" className="set-input" value={relation} onChange={e => setRelation(e.target.value)} placeholder="Spouse" /></Field>
          <Field label="Phone"><input name="contact_phone" className="set-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(305) 555-0142" /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>Add contact</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>+ Add contact</button>
      )}
    </div>
  )
}

function VehiclesEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const [adding, setAdding] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState('')
  const reset = () => { setMake(''); setModel(''); setPlate(''); setColor(''); setAdding(false) }
  const submit = async () => {
    if (!make.trim() && !plate.trim()) return
    const entry = { make: make.trim(), model: model.trim(), plate: plate.trim().toUpperCase(), color: color.trim() }
    const row = profileId ? await addVehicle(profileId, communityId, entry) : null
    patch({ vehicles: [...prefs.vehicles, row || { id: newId('v'), ...entry }] })
    reset()
  }
  const remove = async (id: string) => {
    if (profileId) await removeResidentRow('resident_vehicles', id)
    patch({ vehicles: prefs.vehicles.filter(x => x.id !== id) })
  }
  return (
    <div className="set-list">
      {prefs.vehicles.length === 0 && <div className="set-list-empty">No vehicles registered.</div>}
      {prefs.vehicles.map(v => (
        <div key={v.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{[v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}</strong>
            <span>{[v.plate, v.color].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label="Remove"
            onClick={() => remove(v.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label="Make"><input name="vehicle_make" className="set-input" value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" /></Field>
          <Field label="Model"><input name="vehicle_model" className="set-input" value={model} onChange={e => setModel(e.target.value)} placeholder="RAV4" /></Field>
          <Field label="Plate"><input name="vehicle_plate" className="set-input" value={plate} onChange={e => setPlate(e.target.value)} placeholder="FL-7G3K2P" /></Field>
          <Field label="Color"><input name="vehicle_color" className="set-input" value={color} onChange={e => setColor(e.target.value)} placeholder="Silver" /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>Add vehicle</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>+ Add vehicle</button>
      )}
    </div>
  )
}

function PetsEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [species, setSpecies] = useState('Dog')
  const [breed, setBreed] = useState('')
  const reset = () => { setName(''); setSpecies('Dog'); setBreed(''); setAdding(false) }
  const submit = async () => {
    if (!name.trim()) return
    const entry = { name: name.trim(), species: species.trim(), breed: breed.trim() }
    const row = profileId ? await addPet(profileId, communityId, entry) : null
    patch({ pets: [...prefs.pets, row || { id: newId('p'), ...entry }] })
    reset()
  }
  const remove = async (id: string) => {
    if (profileId) await removeResidentRow('resident_pets', id)
    patch({ pets: prefs.pets.filter(x => x.id !== id) })
  }
  return (
    <div className="set-list">
      {prefs.pets.length === 0 && <div className="set-list-empty">No pets registered.</div>}
      {prefs.pets.map(p => (
        <div key={p.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{p.name}</strong>
            <span>{[p.species, p.breed].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label="Remove"
            onClick={() => remove(p.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label="Name"><input name="pet_name" className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder="Luna" /></Field>
          <Field label="Species"><input name="pet_species" className="set-input" value={species} onChange={e => setSpecies(e.target.value)} placeholder="Dog" /></Field>
          <Field label="Breed"><input name="pet_breed" className="set-input" value={breed} onChange={e => setBreed(e.target.value)} placeholder="Mini Labradoodle" /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>Add pet</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>+ Add pet</button>
      )}
    </div>
  )
}

// Avatar button that doubles as the file picker. Clicking opens the
// native file chooser; once a file is picked, fileToProfileImage
// resizes it and the parent patches the preference.
function AvatarButton({
  image, fallback, onPick,
}: {
  image: string
  fallback: string
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onPick(file)
    e.target.value = ''
  }
  return (
    <button
      type="button"
      className={`set-account-avatar set-avatar-btn${image ? ' has-image' : ''}`}
      onClick={() => inputRef.current?.click()}
      aria-label={image ? 'Change profile photo' : 'Add a profile photo'}
      title={image ? 'Change profile photo' : 'Add a profile photo'}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      {!image && <span>{fallback}</span>}
      <span className="set-avatar-edit" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>
          <path d="m18.4 2.6 3 3L12 15l-4 1 1-4z"/>
        </svg>
      </span>
      <input name="avatar-upload" ref={inputRef} type="file" accept="image/*" onChange={onChange} hidden />
    </button>
  )
}

// Verified email change. Email doubles as the login credential, so a new
// address isn't trusted until the resident clicks the confirmation link
// Supabase mails them. On confirmation the new email flows back into the
// profile (providers reads it from the auth session) and the roster
// (useMyResident syncs it on next load).
function EmailChanger() {
  const { profile } = useAuth() || {}
  const current = profile?.email || ''
  const [value, setValue] = useState(current)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => { setValue(current) }, [current])

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
  const changed = value.trim().toLowerCase() !== current.toLowerCase()

  const submit = async () => {
    if (!supabase || !valid || !changed) return
    setStatus('sending'); setMsg('')
    try {
      const { error } = await supabase.auth.updateUser({ email: value.trim() })
      if (error) throw error
      setStatus('sent')
      setMsg(`Confirmation link sent to ${value.trim()}. Click it to finish — your email won't change until you do.`)
    } catch (e: any) {
      setStatus('error'); setMsg(e?.message || 'Could not start the email change.')
    }
  }

  return (
    <Field label="Email">
      <input name="email" autoComplete="email" className="set-input" type="email"
        value={value} onChange={e => { setValue(e.target.value); if (status !== 'idle') setStatus('idle') }}
        placeholder="you@example.com" />
      <div className="set-list-add-actions" style={{ marginTop: 8 }}>
        <button type="button" className="set-btn-primary" onClick={submit}
          disabled={!valid || !changed || status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Change email'}
        </button>
      </div>
      {status === 'sent'  && <span className="set-dialog-note set-dialog-note-tight">✓ {msg}</span>}
      {status === 'error' && <span className="set-dialog-note set-dialog-note-tight">{msg}</span>}
      {(status === 'idle' || status === 'sending') && (
        <span className="set-dialog-note set-dialog-note-tight">
          This is your login email. Changing it sends a confirmation link to the new
          address; it updates everywhere — including the board&rsquo;s roster — once you confirm.
        </span>
      )}
    </Field>
  )
}

function ProfilePhotoEditor({
  prefs, patch,
}: {
  prefs: Preferences
  patch: (p: Partial<Preferences>) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fallback = ((prefs.full_name || 'R')[0] || 'R').toUpperCase()
  const onPick = async (file: File) => {
    try {
      const dataUrl = await fileToProfileImage(file)
      patch({ profile_image: dataUrl })
    } catch (err: any) {
      alert(err?.message || 'Could not load that image.')
    }
  }
  return (
    <div className="set-photo">
      <div
        className={`set-photo-avatar${prefs.profile_image ? ' has-image' : ''}`}
        style={prefs.profile_image ? { backgroundImage: `url(${prefs.profile_image})` } : undefined}
      >
        {!prefs.profile_image && <span>{fallback}</span>}
      </div>
      <div className="set-photo-actions">
        <button type="button" className="set-btn-primary"
          onClick={() => inputRef.current?.click()}>
          {prefs.profile_image ? 'Change photo' : 'Upload a photo'}
        </button>
        {prefs.profile_image && (
          <button type="button" className="set-btn-ghost"
            onClick={() => patch({ profile_image: '' })}>
            Remove photo
          </button>
        )}
        <input
          name="profile-photo-upload"
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.target.value = ''
          }}
        />
        <p className="set-photo-hint">
          Square JPG or PNG &mdash; we&rsquo;ll crop and resize to 256&times;256.
        </p>
      </div>
    </div>
  )
}

function ReferDialog({ community }: { community: string }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined'
    ? `${window.location.origin}/login?ref=${encodeURIComponent(community.toLowerCase().replace(/\s+/g, '-'))}`
    : '/login'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <>
      <p className="set-dialog-note">
        Send this link to a neighbor at {community}. They&rsquo;ll skip the
        community-picker on sign-up.
      </p>
      <div className="set-refer-row">
        <input name="refer-link" className="set-input" value={link} readOnly onFocus={e => e.currentTarget.select()} />
        <button type="button" className="set-btn-primary" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
    </>
  )
}

function UpdatesDialog() {
  return (
    <>
      <p className="set-dialog-note">
        Residente runs in the browser, so it&rsquo;s always up to date the
        next time you load it. If something looks stale, force a refresh
        and we&rsquo;ll pull the latest build.
      </p>
      <div className="set-readonly-rows">
        <div className="set-readonly-row"><span>Build</span><span>1.2.5 (web)</span></div>
        <div className="set-readonly-row"><span>Last deployed</span><span>May 27, 2026</span></div>
        <div className="set-readonly-row"><span>Native apps</span><span>Coming soon</span></div>
      </div>
      <button type="button" className="set-btn-primary"
        onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}>
        Reload now
      </button>
    </>
  )
}

// -- icons ----------------------------------------------------------

function IconUser()    { return <Svg><><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></></Svg> }
function IconLock()    { return <Svg><><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></></Svg> }
function IconBell()    { return <Svg><><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/></></Svg> }
function IconGlobe()   { return <Svg><><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></></Svg> }
function IconEye()     { return <Svg><><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></></Svg> }
function IconMail()    { return <Svg><><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></></Svg> }
function IconChat()    { return <Svg><><path d="M21 12a8 8 0 0 1-12 7L3 21l2-5a8 8 0 1 1 16-4z"/></></Svg> }
function IconPush()    { return <Svg><><rect x="6" y="3" width="12" height="18" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></></Svg> }
function IconMoon()    { return <Svg><><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></></Svg> }
function IconHome()    { return <Svg><><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></></Svg> }
function IconCalendar(){ return <Svg><><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></></Svg> }
function IconCard()    { return <Svg><><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></></Svg> }
function IconShield()  { return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/></></Svg> }
function IconKey()     { return <Svg><><circle cx="8" cy="14" r="3"/><path d="m10 12 9-9 3 3-2 2 2 2-2 2-2-2-2 2"/></></Svg> }
function IconPhone()   { return <Svg><><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></></Svg> }
function IconCar()     { return <Svg><><path d="M5 11l2-5h10l2 5"/><rect x="3" y="11" width="18" height="7" rx="2"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/></></Svg> }
function IconPaw()     { return <Svg><><ellipse cx="12" cy="16" rx="5" ry="4"/><circle cx="6" cy="10" r="2"/><circle cx="18" cy="10" r="2"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
