'use client'

import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { signOut, supabase, hasSupabase } from '@/lib/supabase'
import { deleteAccount } from '@/lib/signup'
import { DangerAction } from '@/components/DangerAction'
import { useCommunityData } from '@/hooks/useCommunityData'
import {
  HOMEPAGE_LABEL,
  LANGUAGE_LABEL,
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
import { useT } from '@/lib/i18n'
import { useAppIcon, type AppIconChoice } from '@/lib/appIcon'
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
  | 'refer' | 'updates' | 'appicon'

export default function Settings() {
  const t = useT()
  const { profile, setProfile } = useAuth() || {}
  const { community } = useCommunityData()
  const [prefs, patch] = usePreferences()
  const [dialog, setDialog] = useState<DialogKey | null>(null)
  // Home-screen icon background (white/black) — device-local, mobile only.
  const [appIcon] = useAppIcon()
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Translated value labels for the communication-preference rows + overview.
  const PREF_LABEL_KEY = {
    email: { all: 'settings.emailAll', important: 'settings.emailImportant', none: 'settings.prefNone' } as Record<string, string>,
    sms:   { all: 'settings.smsAll',   emergency: 'settings.smsEmergency',  none: 'settings.prefNone' } as Record<string, string>,
    push:  { all: 'settings.pushAll',  important: 'settings.pushImportant', none: 'settings.prefNone' } as Record<string, string>,
  }
  const emailPrefLabel = t(PREF_LABEL_KEY.email[prefs.email_pref] ?? 'settings.prefNone')
  const smsPrefLabel   = t(PREF_LABEL_KEY.sms[prefs.sms_pref] ?? 'settings.prefNone')
  const pushPrefLabel  = t(PREF_LABEL_KEY.push[prefs.push_pref] ?? 'settings.prefNone')

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
  const unitLabel   = profile?.unit_number ? t('settings.unitLabel', { unit: profile.unit_number }) : t('settings.unitNone')
  const memberSince = 'Jan 2023'
  const communityName = community?.name || 'Sunset Lakes'

  return (
    <div className="set-wrap">
      <section className="set-hero">
        <div className="set-hero-content">
          <h1 className="set-hero-title">{t('settings.title')}</h1>
          <div className="set-hero-sub">
            {t('settings.heroSub', { community: communityName })}
          </div>
        </div>
      </section>

      <div className="set-grid">
        {/* MAIN COLUMN */}
        <div className="set-col">
          <SectionCard title={t('settings.secAccount')}>
            <Row icon={<IconUser />}  title={t('settings.rowProfile')}      desc={t('settings.rowProfileDesc')}
              onClick={() => setDialog('profile')} right={fullName} />
            <Row icon={<IconLock />}  title={t('settings.rowSecurity')}     desc={t('settings.rowSecurityDesc')}
              onClick={() => setDialog('security')} />
            <Row icon={<IconBell />}  title={t('settings.rowNotif')} desc={t('settings.rowNotifDesc')}
              onClick={() => setDialog('notifications')} />
            <Row icon={<IconGlobe />} title={t('settings.rowLanguage')}    desc={t('settings.rowLanguageDesc')}
              onClick={() => setDialog('language')}
              right={LANGUAGE_LABEL[prefs.language]} />
            <Row icon={<IconEye />}   title={t('settings.rowAccess')}            desc={t('settings.rowAccessDesc')}
              onClick={() => setDialog('accessibility')}
              right={accessibilitySummary(prefs, t)} />
            {isMobile && (
              <Row icon={<IconAppIcon />} title={t('settings.rowAppIcon')} desc={t('settings.rowAppIconDesc')}
                onClick={() => setDialog('appicon')}
                right={appIcon === 'black' ? t('settings.appIconBlack') : t('settings.appIconWhite')} />
            )}
          </SectionCard>

          <SectionCard title={t('settings.secComm')}>
            <Row icon={<IconMail />} title={t('settings.rowEmail')}  desc={t('settings.rowEmailDesc')}
              onClick={() => setDialog('email')} right={emailPrefLabel} />
            <Row icon={<IconChat />} title={t('settings.rowSms')}    desc={t('settings.rowSmsDesc')}
              onClick={() => setDialog('sms')}   right={smsPrefLabel} />
            <Row icon={<IconPush />} title={t('settings.rowBrowser')} desc={t('settings.rowBrowserDesc')}
              onClick={() => setDialog('push')}  right={pushPrefLabel} />
            <Row icon={<IconMoon />} title={t('settings.rowQuiet')}        desc={t('settings.rowQuietDesc')}
              onClick={() => setDialog('quiet-hours')}
              right={`${formatTime12(prefs.quiet_hours_start)} – ${formatTime12(prefs.quiet_hours_end)}`} />
          </SectionCard>

          <SectionCard title={t('settings.secSite')}>
            <Row icon={<IconHome />}     title={t('settings.rowHomepage')} desc={t('settings.rowHomepageDesc')}
              onClick={() => setDialog('homepage')} right={HOMEPAGE_LABEL[prefs.default_homepage]} />
            <Row icon={<IconCalendar />} title={t('settings.rowCalendar')}   desc={t('settings.rowCalendarDesc')}
              onClick={() => setDialog('calendar')} right={WEEK_START_LABEL[prefs.calendar_week_start]} />
            <Row icon={<IconCard />}     title={t('settings.rowPayment')}     desc={t('settings.rowPaymentDesc')}
              onClick={() => setDialog('payment')}  right={t('settings.nSaved', { n: prefs.payment_methods.length })} />
            <Row icon={<IconShield />}   title={t('settings.rowPrivacy')}  desc={t('settings.rowPrivacyDesc')}
              onClick={() => setDialog('privacy')} />
          </SectionCard>

          <SectionCard title={t('settings.secCommunity')}>
            <Row icon={<IconKey />}   title={t('settings.rowUnit')}   desc={t('settings.rowUnitDesc')}
              onClick={() => setDialog('unit')} right={unitLabel} />
            <Row icon={<IconPhone />} title={t('settings.rowContacts')} desc={t('settings.rowContactsDesc')}
              onClick={() => setDialog('contacts')} right={t('settings.nOnFile', { n: prefs.emergency_contacts.length })} />
            <Row icon={<IconCar />}   title={t('settings.rowVehicles')} desc={t('settings.rowVehiclesDesc')}
              onClick={() => setDialog('vehicles')} right={t('settings.nRegistered', { n: prefs.vehicles.length })} />
            <Row icon={<IconPaw />}   title={t('settings.rowPets')}    desc={t('settings.rowPetsDesc')}
              onClick={() => setDialog('pets')} right={t('settings.nRegistered', { n: prefs.pets.length })} />
          </SectionCard>

          <SectionCard title={t('settings.secVault')}>
            <HomeVaultPanel />
          </SectionCard>

          <SectionCard title={t('settings.secTransfer')}>
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
              <span className="set-logout-title">{t('settings.logout')}</span>
              <span className="set-logout-desc">{t('settings.logoutDesc')}</span>
            </span>
            <span className="set-logout-chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          <DangerAction
            confirmWord="DELETE"
            confirmLabel={t('settings.deleteConfirmLabel')}
            title={t('settings.deleteTitle')}
            body={<>{t('settings.deleteBodyLead')}{' '}{t('settings.deleteBodyHelp')} <a href="/app/contact" style={{ color: '#E5601F', fontWeight: 700 }}>{t('settings.contactResidente')}</a>.</>}
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
                  <span className="set-logout-title" style={{ color: '#b5481f' }}>{t('settings.deleteTitle')}</span>
                  <span className="set-logout-desc">{t('settings.deleteDesc')}</span>
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
            <div className="set-tile-title">{t('settings.acctSummary')}</div>
            <div className="set-account">
              <AvatarButton
                image={prefs.profile_image}
                fallback={(fullName[0] || 'R').toUpperCase()}
                onPick={async file => {
                  try {
                    const dataUrl = await fileToProfileImage(file)
                    patch({ profile_image: dataUrl })
                  } catch (err: any) {
                    alert(err?.message || t('settings.hvLoadImgFailed'))
                  }
                }}
              />
              <div className="set-account-meta">
                <div className="set-account-name">{fullName}</div>
                <div className="set-account-email">{unitLabel} · {email}</div>
              </div>
            </div>
            <div className="set-account-rows">
              <div className="set-account-row"><span>{t('settings.memberSince')}</span><span>{memberSince}</span></div>
              <div className="set-account-row"><span>{t('settings.community')}</span><span>{communityName}</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('profile')}>
              {t('settings.viewProfile')}
            </button>
          </div>

          <div className="set-tile set-tile-web">
            <div className="set-tile-title">{t('settings.quickLinks')}</div>
            <ul className="set-links">
              <li><Link href="/app/voice#contact">{t('settings.helpCenter')}</Link></li>
              <li><Link href="/app/voice#contact">{t('settings.contactMgmt')}</Link></li>
              <li><button type="button" className="set-links-btn" onClick={() => setDialog('notifications')}>{t('settings.updateCommPrefs')}</button></li>
              <li><Link href="/app/documents">{t('settings.downloadCenter')}</Link></li>
              <li><button type="button" className="set-links-btn" onClick={() => setDialog('refer')}>{t('settings.referNeighbor')}</button></li>
            </ul>
          </div>

          <div className="set-tile set-tile-web">
            <div className="set-tile-title">{t('settings.prefsOverview')}</div>
            <div className="set-prefs">
              <div className="set-pref-row"><span>{t('settings.email')}</span><span>{emailPrefLabel}</span></div>
              <div className="set-pref-row"><span>{t('settings.sms')}</span><span>{smsPrefLabel}</span></div>
              <div className="set-pref-row"><span>{t('settings.push')}</span><span>{pushPrefLabel}</span></div>
              <div className="set-pref-row"><span>{t('settings.quietHours')}</span><span>{formatTime12(prefs.quiet_hours_start)} – {formatTime12(prefs.quiet_hours_end)}</span></div>
              <div className="set-pref-row"><span>{t('settings.language')}</span><span>{LANGUAGE_LABEL[prefs.language]}</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('notifications')}>
              {t('settings.editPrefs')}
            </button>
          </div>

          <div className="set-tile set-tile-web">
            <div className="set-tile-title">{t('settings.aboutSite')}</div>
            <div className="set-prefs">
              <div className="set-pref-row"><span>{t('settings.build')}</span><span>1.2.5 (web)</span></div>
              <div className="set-pref-row"><span>{t('settings.lastDeployed')}</span><span>May 27, 2026</span></div>
              <div className="set-pref-row"><span>{t('settings.nativeApps')}</span><span>{t('settings.comingSoon')}</span></div>
            </div>
            <button className="set-tile-cta" type="button" onClick={() => setDialog('updates')}>
              {t('settings.reloadLatest')}
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

function accessibilitySummary(p: Preferences, t: (k: string, v?: Record<string, string | number>) => string): string {
  const flags = [
    p.large_text && t('settings.accLargeText'),
    p.reduced_motion && t('settings.accReducedMotion'),
    p.high_contrast && t('settings.accHighContrast'),
  ].filter(Boolean) as string[]
  return flags.length ? flags.join(' · ') : t('settings.accDefault')
}

// Home Vault: one row per category (Deed, Insurance, Warranties...). The
// document count sits at the far right; clicking a row opens a dropdown of that
// category's files (open / mark conveys / delete) plus an "add a file" action.
// Category keys are stored in the DB as-is (English), so we keep them as keys
// and map each to its translated label + description for display only.
const HV_CAT_I18N: Record<string, { label: string; desc: string }> = {
  'Deed & closing':    { label: 'settings.hvCatDeed',       desc: 'settings.hvCatDeedDesc' },
  'Insurance':         { label: 'settings.hvCatInsurance',  desc: 'settings.hvCatInsuranceDesc' },
  'Warranties':        { label: 'settings.hvCatWarranties', desc: 'settings.hvCatWarrantiesDesc' },
  'Permits':           { label: 'settings.hvCatPermits',    desc: 'settings.hvCatPermitsDesc' },
  'Appliance manuals': { label: 'settings.hvCatAppliance',  desc: 'settings.hvCatApplianceDesc' },
  'HOA documents':     { label: 'settings.hvCatHoa',        desc: 'settings.hvCatHoaDesc' },
  'Other':             { label: 'settings.hvCatOther',      desc: 'settings.hvCatOtherDesc' },
}

function HomeVaultPanel() {
  const t = useT()
  const docCount = (n: number) => t(n === 1 ? 'settings.hvDocOne' : 'settings.hvDocMany', { n })
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
    } catch (e2) { setErr((e2 as Error).message || t('settings.hvUploadFailed')) }
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
                <span className="set-row-title">{HV_CAT_I18N[cat] ? t(HV_CAT_I18N[cat].label) : cat}</span>
                <span className="set-row-desc">{HV_CAT_I18N[cat] ? t(HV_CAT_I18N[cat].desc) : ''}</span>
              </span>
              <span className="set-row-right">{docCount(items.length)}</span>
              <svg className="set-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            {isOpen && (
              <div className="hv-cat-drop">
                {items.length === 0 && <div className="hv-muted">{t('settings.hvNoFiles')}</div>}
                {items.map(d => (
                  <div key={d.id} className="hv-docrow">
                    <button type="button" className="hv-doc-main" onClick={() => openDoc(d)}>
                      <span className="hv-doc-title">{d.title}</span>
                      <span className="hv-doc-meta">{fmtD(d.uploaded_at)}{d.note ? ` · ${d.note}` : ''}</span>
                    </button>
                    <label className="hv-conveys" title={t('settings.hvConveysTip')}>
                      <input type="checkbox" checked={d.conveys} onChange={() => toggle(d)} /><span>{t('settings.hvConveys')}</span>
                    </label>
                    <button type="button" className="hv-doc-del" onClick={() => remove(d)} aria-label={t('settings.hvDelete')}>×</button>
                  </div>
                ))}
                <button type="button" className="hv-cat-add" onClick={() => openAdd(cat)}>{t('settings.hvAddDoc')}</button>
              </div>
            )}
          </div>
        )
      })}

      {addCat && (
        <div className="hv-modal-overlay" onClick={() => !mBusy && setAddCat(null)}>
          <form className="hv-modal" onClick={e => e.stopPropagation()} onSubmit={submitAdd}>
            <div className="hv-modal-title">{t('settings.hvAddTo', { cat: HV_CAT_I18N[addCat] ? t(HV_CAT_I18N[addCat].label) : addCat })}</div>
            <label className="hv-field">
              <span className="hv-label">{t('settings.hvFile')}</span>
              <input className="hv-input" type="file" required
                onChange={e => { const f = e.target.files?.[0] ?? null; setMFile(f); if (f && !mTitle) setMTitle(f.name.replace(/\.[^.]+$/, '')) }} />
            </label>
            <label className="hv-field">
              <span className="hv-label">{t('settings.hvTitleLabel')}</span>
              <input className="hv-input" value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder={t('settings.hvTitlePh')} autoFocus />
            </label>
            <label className="hv-field">
              <span className="hv-label">{t('settings.hvNoteLabel')}</span>
              <textarea className="hv-input hv-textarea" rows={3} value={mNote} onChange={e => setMNote(e.target.value)}
                placeholder={t('settings.hvNotePh')} />
            </label>
            {err && <div className="hv-err">{err}</div>}
            <div className="hv-modal-actions">
              <button type="button" className="hv-btn-ghost" onClick={() => setAddCat(null)} disabled={mBusy}>{t('settings.hvCancel')}</button>
              <button type="submit" className="hv-btn" disabled={mBusy || !mFile}>{mBusy ? t('settings.hvAdding') : t('settings.hvAdd')}</button>
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
  const t = useT()
  const conveyDocs = (n: number) => t(n === 1 ? 'settings.xferConveyOne' : 'settings.xferConveyMany', { n })
  const plainDocs = (n: number) => t(n === 1 ? 'settings.hvDocOne' : 'settings.hvDocMany', { n })
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
        t('settings.xferSuccessLead', { docs: plainDocs(res.docs_conveyed) }) +
        (res.email_sent ? t('settings.xferSuccessEmailed') : t('settings.xferSuccessNoEmail'))
      )
    } catch (e2) { setErr((e2 as Error).message || t('settings.xferFailed')) }
    finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="set-row" onClick={openModal}
        title={t('settings.xferTitle')}>
        <span className="set-row-icon hv-xfer-icon"><IconHome /></span>
        <span className="set-row-body">
          <span className="set-row-title">{t('settings.xferTitle')}</span>
          <span className="set-row-desc">
            {t('settings.xferDesc', { docs: plainDocs(conveyCount) })}
          </span>
        </span>
        <svg className="set-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      {open && (
        <div className="hv-modal-overlay" onClick={() => !busy && setOpen(false)}>
          <form className="hv-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
            <div className="hv-modal-title">{t('settings.xferModalTitle')}</div>
            {done ? (
              <>
                <div className="hv-xfer-success">{done}</div>
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn" onClick={() => setOpen(false)}>{t('settings.xferDone')}</button>
                </div>
              </>
            ) : !residentId ? (
              <>
                <div className="hv-xfer-warn">
                  {t('settings.xferNoHome')}
                </div>
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn" onClick={() => setOpen(false)}>{t('settings.xferGotIt')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="hv-xfer-warn">
                  <strong>{t('settings.xferWarnStrong')}</strong> {t('settings.xferWarnBody', { docs: conveyDocs(conveyCount) })}
                </div>
                <label className="hv-field">
                  <span className="hv-label">{t('settings.xferBuyerEmail')}</span>
                  <input className="hv-input" type="email" required value={email}
                    onChange={e => setEmail(e.target.value)} placeholder={t('settings.xferBuyerEmailPh')} autoFocus />
                </label>
                <label className="hv-field">
                  <span className="hv-label">{t('settings.xferBuyerName')}</span>
                  <input className="hv-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.xferBuyerNamePh')} />
                </label>
                <label className="hv-field">
                  <span className="hv-label">
                    {t('settings.xferConfirmName')}{ownerName ? <> — <strong>{ownerName}</strong></> : ''}
                  </span>
                  <input className="hv-input" value={typedName} onChange={e => setTypedName(e.target.value)}
                    placeholder={ownerName || t('settings.xferConfirmPh')} autoComplete="off" />
                </label>
                {err && <div className="hv-err">{err}</div>}
                <div className="hv-modal-actions">
                  <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>{t('settings.hvCancel')}</button>
                  <button type="submit" className="hv-danger-btn" disabled={busy || !email.trim() || !nameMatches}>
                    {busy ? t('settings.xferTransferring') : t('settings.xferTransferBtn')}
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

  const t = useT()
  const title = dialogTitle(k, t)
  return (
    <div className="set-dialog-backdrop" onClick={onClose}>
      <div className="set-dialog-card" role="dialog" aria-modal="true"
           onClick={e => e.stopPropagation()}>
        <header className="set-dialog-head">
          <h2 className="set-dialog-title">{title}</h2>
          <button type="button" className="set-dialog-close" aria-label={t('settings.dlgClose')} onClick={onClose}>×</button>
        </header>
        <div className="set-dialog-body">
          <DialogBody k={k} prefs={prefs} patch={patch} unitLabel={unitLabel}
            community={community} roster={roster} profileId={profileId} communityId={communityId}
            onSaveContact={onSaveContact} />
        </div>
        <footer className="set-dialog-foot">
          <button type="button" className="set-btn-primary" onClick={onClose}>{t('settings.dlgDone')}</button>
        </footer>
      </div>
    </div>
  )
}

function dialogTitle(k: DialogKey, t: (key: string) => string): string {
  const KEY: Record<DialogKey, string> = {
    profile:        'settings.dlgProfileTitle',
    security:       'settings.dlgSecurityTitle',
    notifications:  'settings.dlgNotifTitle',
    language:       'settings.rowLanguage',
    accessibility:  'settings.rowAccess',
    email:          'settings.dlgEmailTitle',
    sms:            'settings.dlgSmsTitle',
    push:           'settings.dlgPushTitle',
    'quiet-hours':  'settings.quietHours',
    homepage:       'settings.dlgHomepageTitle',
    calendar:       'settings.dlgCalendarTitle',
    payment:        'settings.dlgPaymentTitle',
    privacy:        'settings.dlgPrivacyTitle',
    unit:           'settings.dlgUnitTitle',
    contacts:       'settings.rowContacts',
    vehicles:       'settings.rowVehicles',
    pets:           'settings.rowPets',
    refer:          'settings.referNeighbor',
    updates:        'settings.reloadLatest',
    appicon:        'settings.dlgAppIconTitle',
  }
  return t(KEY[k])
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
  const t = useT()
  const seed = (prefs.full_name || '').trim()
  const seedSp = seed.indexOf(' ')
  const [first, setFirst] = useState(seedSp === -1 ? seed : seed.slice(0, seedSp))
  const [last, setLast]   = useState(seedSp === -1 ? '' : seed.slice(seedSp + 1).trim())

  const recombine = (f: string, l: string) => `${f.trim()} ${l.trim()}`.trim()

  return (
    <div className="set-name-row">
      <Field label={t('settings.fldFirstName')}>
        <input name="given-name" autoComplete="given-name" className="set-input" value={first}
          onChange={e => { setFirst(e.target.value); patch({ full_name: recombine(e.target.value, last) }) }}
          onBlur={() => onSaveContact({ full_name: recombine(first, last) })}
          placeholder={t('settings.phFirstName')} />
      </Field>
      <Field label={t('settings.fldLastName')}>
        <input name="family-name" autoComplete="family-name" className="set-input" value={last}
          onChange={e => { setLast(e.target.value); patch({ full_name: recombine(first, e.target.value) }) }}
          onBlur={() => onSaveContact({ full_name: recombine(first, last) })}
          placeholder={t('settings.phLastName')} />
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
  const t = useT()
  switch (k) {
    case 'profile':
      return (
        <>
          <ProfilePhotoEditor prefs={prefs} patch={patch} />
          <ProfileNameFields prefs={prefs} patch={patch} onSaveContact={onSaveContact} />
          <EmailChanger />
          <Field label={t('settings.fldPhone')}>
            <input name="phone" autoComplete="tel" className="set-input" type="tel" value={prefs.phone}
              onChange={e => patch({ phone: e.target.value })}
              onBlur={e => onSaveContact({ phone: e.target.value.trim() })}
              placeholder={t('settings.phPhone')} />
          </Field>
          <Field label={t('settings.fldAddress')}>
            <input name="street-address" autoComplete="street-address" className="set-input" value={prefs.address}
              onChange={e => patch({ address: e.target.value })}
              onBlur={e => onSaveContact({ address: e.target.value.trim() })}
              placeholder={t('settings.phAddress')} />
          </Field>
          {roster ? (
            <span className="set-dialog-note set-dialog-note-tight">
              {t('settings.profNoteSynced')}
            </span>
          ) : (
            <span className="set-dialog-note set-dialog-note-tight">
              {t('settings.profNoteUnsynced')}
            </span>
          )}
        </>
      )

    case 'security':
      return (
        <>
          <p className="set-dialog-note">
            {t('settings.secNote')}
          </p>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert(t('settings.secResetAlert', { email: prefs.email || t('settings.fldEmailLabel') }))}>
            {t('settings.secResetBtn')}
          </button>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert(t('settings.sec2faAlert'))}>
            {t('settings.sec2faBtn')}
          </button>
          <button type="button" className="set-btn-ghost"
            onClick={() => alert(t('settings.secSessionsAlert'))}>
            {t('settings.secSessionsBtn')}
          </button>
        </>
      )

    case 'notifications':
      return (
        <>
          <RadioGroup<EmailPref>
            label={t('settings.email')}
            value={prefs.email_pref}
            onChange={v => patch({ email_pref: v })}
            options={[
              { value: 'all',       label: t('settings.emailAll'),       desc: t('settings.emailAllDesc') },
              { value: 'important', label: t('settings.emailImportant'), desc: t('settings.emailImportantDesc') },
              { value: 'none',      label: t('settings.prefNone'),       desc: t('settings.emailNoneDesc') },
            ]}
          />
          <RadioGroup<SmsPref>
            label={t('settings.sms')}
            value={prefs.sms_pref}
            onChange={v => patch({ sms_pref: v })}
            options={[
              { value: 'all',       label: t('settings.smsAll'),       desc: t('settings.smsAllDesc') },
              { value: 'emergency', label: t('settings.smsEmergency'), desc: t('settings.smsEmergencyDesc') },
              { value: 'none',      label: t('settings.prefNone'),     desc: t('settings.smsNoneDesc') },
            ]}
          />
          <RadioGroup<PushPref>
            label={t('settings.push')}
            value={prefs.push_pref}
            onChange={v => patch({ push_pref: v })}
            options={[
              { value: 'all',       label: t('settings.pushAll'),       desc: t('settings.pushAllDesc') },
              { value: 'important', label: t('settings.pushImportant'), desc: t('settings.pushImportantDesc') },
              { value: 'none',      label: t('settings.prefNone'),      desc: t('settings.pushNoneDesc') },
            ]}
          />
          <Field label={t('settings.quietHours')}>
            <div className="set-time-row">
              <input name="quiet_hours_start" className="set-input" type="time" value={prefs.quiet_hours_start}
                onChange={e => patch({ quiet_hours_start: e.target.value })} />
              <span className="set-time-sep">{t('settings.timeTo')}</span>
              <input name="quiet_hours_end" className="set-input" type="time" value={prefs.quiet_hours_end}
                onChange={e => patch({ quiet_hours_end: e.target.value })} />
            </div>
          </Field>
        </>
      )

    case 'language':
      return (
        <RadioGroup<LanguageCode>
          label={t('settings.langDisplayLabel')}
          value={prefs.language}
          onChange={v => patch({ language: v })}
          options={[
            { value: 'en', label: 'English',     desc: t('settings.langEnDesc') },
            { value: 'es', label: 'Español',     desc: 'Para residentes hispanohablantes.' },
            { value: 'pt', label: 'Português',   desc: 'Para residentes que falam português.' },
          ]}
        />
      )

    case 'accessibility':
      return (
        <>
          <ToggleRow
            label={t('settings.accLargeText')}
            desc={t('settings.accLargeTextDesc')}
            checked={prefs.large_text}
            onChange={v => patch({ large_text: v })}
          />
          <ToggleRow
            label={t('settings.accReduceMotionLabel')}
            desc={t('settings.accReduceMotionDesc')}
            checked={prefs.reduced_motion}
            onChange={v => patch({ reduced_motion: v })}
          />
          <ToggleRow
            label={t('settings.accHighContrast')}
            desc={t('settings.accHighContrastDesc')}
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
            { value: 'all',       label: t('settings.emailAll'),       desc: t('settings.emailAllDesc') },
            { value: 'important', label: t('settings.emailImportant'), desc: t('settings.emailImportantDesc') },
            { value: 'none',      label: t('settings.prefNone'),       desc: t('settings.emailNoneDesc') },
          ]}
        />
      )

    case 'sms':
      return (
        <RadioGroup<SmsPref>
          value={prefs.sms_pref}
          onChange={v => patch({ sms_pref: v })}
          options={[
            { value: 'all',       label: t('settings.smsAll'),       desc: t('settings.smsAllDesc') },
            { value: 'emergency', label: t('settings.smsEmergency'), desc: t('settings.smsEmergencyDesc') },
            { value: 'none',      label: t('settings.prefNone'),     desc: t('settings.smsNoneDesc') },
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
              { value: 'all',       label: t('settings.pushAll'),       desc: t('settings.pushAllDesc') },
              { value: 'important', label: t('settings.pushImportant'), desc: t('settings.pushImportantDesc') },
              { value: 'none',      label: t('settings.prefNone'),      desc: t('settings.pushNoneDesc') },
            ]}
          />
        </>
      )

    case 'quiet-hours':
      return (
        <>
          <p className="set-dialog-note">
            {t('settings.quietNote')}
          </p>
          <Field label={t('settings.fldStart')}>
            <input name="quiet_start" className="set-input" type="time" value={prefs.quiet_hours_start}
              onChange={e => patch({ quiet_hours_start: e.target.value })} />
          </Field>
          <Field label={t('settings.fldEnd')}>
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
          label={t('settings.calWeekStartsOn')}
          value={prefs.calendar_week_start}
          onChange={v => patch({ calendar_week_start: v })}
          options={[
            { value: 'sun', label: t('settings.calSunday') },
            { value: 'mon', label: t('settings.calMonday') },
          ]}
        />
      )

    case 'payment':
      return <PaymentMethodsEditor prefs={prefs} patch={patch} />

    case 'privacy':
      return (
        <>
          <p className="set-dialog-note">
            {t('settings.privNote')}
          </p>
          <ToggleRow label={t('settings.privDir')} desc={t('settings.privDirDesc')} checked={true}  onChange={() => {}} />
          <ToggleRow label={t('settings.privGate')} desc={t('settings.privGateDesc')} checked={true}  onChange={() => {}} />
          <ToggleRow label={t('settings.privPolls')} desc={t('settings.privPollsDesc')} checked={true}  onChange={() => {}} />
        </>
      )

    case 'unit':
      return (
        <>
          <p className="set-dialog-note">
            {t('settings.unitNote')}
          </p>
          <div className="set-readonly-rows">
            <div className="set-readonly-row"><span>{t('settings.unitUnit')}</span><span>{unitLabel}</span></div>
            <div className="set-readonly-row"><span>{t('settings.community')}</span><span>{community}</span></div>
            {roster?.address && (
              <div className="set-readonly-row"><span>{t('settings.unitAddress')}</span><span>{roster.address}</span></div>
            )}
          </div>
          {!roster && (
            <p className="set-dialog-note set-dialog-note-tight">
              {t('settings.unitUnsynced')}
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

    case 'appicon':
      return <AppIconDialog />

    default:
      return <p>{t('settings.dlgUnknown')}</p>
  }
}

// Home-screen icon background chooser (white / black). Self-contained: reads +
// writes the device-local choice via useAppIcon (which also repoints the
// apple-touch-icon link). iOS only applies it on the NEXT "Add to Home Screen".
function AppIconDialog() {
  const t = useT()
  const [choice, setChoice] = useAppIcon()
  const OPTIONS: { value: AppIconChoice; label: string; src: string }[] = [
    { value: 'white', label: t('settings.appIconWhite'), src: '/apple-touch-icon.png' },
    { value: 'black', label: t('settings.appIconBlack'), src: '/apple-touch-icon-black.png' },
  ]
  return (
    <div>
      <p className="set-dialog-field-label" style={{ marginBottom: 12, lineHeight: 1.5, textTransform: 'none', letterSpacing: 0 }}>
        {t('settings.appIconHelp')}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        {OPTIONS.map(o => {
          const selected = choice === o.value
          return (
            <button key={o.value} type="button" onClick={() => setChoice(o.value)} aria-pressed={selected}
              style={{
                flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '14px 10px', cursor: 'pointer', borderRadius: 14, background: '#fff',
                border: selected ? '2px solid #E14909' : '1.5px solid rgba(199,111,69,0.30)',
                boxShadow: selected ? '0 0 0 3px rgba(225,73,9,0.14)' : 'none',
              }}>
              <img src={o.src} alt="" width={64} height={64}
                style={{ borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0A2440', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {selected && <span aria-hidden="true" style={{ color: '#E14909' }}>✓</span>}
                {o.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
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
  const t = useT()
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
        {t('settings.pushUnsupported')}
      </p>
    )
  }

  const onEnable = async () => {
    if (!profileId) { setMsg(t('settings.pushSignIn')); return }
    setBusy(true); setMsg('')
    const res = await enablePush(profileId, communityId ?? null)
    setBusy(false)
    setPerm(pushPermission())
    if (res.ok) { setSubscribed(true); setMsg(t('settings.pushEnabledMsg')) }
    else setMsg(res.error || t('settings.pushEnableErr'))
  }
  const onDisable = async () => {
    setBusy(true); setMsg('')
    await disablePush()
    setBusy(false); setSubscribed(false); setMsg(t('settings.pushOffMsg'))
  }

  return (
    <div className="set-dialog-field" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="set-dialog-field-label" style={{ marginBottom: 0 }}>{t('settings.pushThisDevice')}</span>
        {configured && perm !== 'denied' && (
          subscribed ? (
            <button type="button" className="set-btn-ghost" disabled={busy} onClick={onDisable}>
              {busy ? t('settings.pushWorking') : t('settings.pushTurnOff')}
            </button>
          ) : (
            <button type="button" className="set-btn-primary" disabled={busy} onClick={onEnable}>
              {busy ? t('settings.pushWorking') : t('settings.pushEnable')}
            </button>
          )
        )}
      </div>
      {!configured && (
        <p className="set-dialog-note">{t('settings.pushNotConfigured')}</p>
      )}
      {configured && perm === 'denied' && (
        <p className="set-dialog-note">
          {t('settings.pushBlocked')}
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
  const t = useT()
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
      {prefs.payment_methods.length === 0 && <div className="set-list-empty">{t('settings.payEmpty')}</div>}
      {prefs.payment_methods.map(pm => (
        <div key={pm.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{pm.brand} ···· {pm.last4}</strong>
            <span>{pm.kind === 'card' ? t('settings.payCardLine') : t('settings.payBankLine')}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label={t('settings.genRemove')}
            onClick={() => patch({ payment_methods: prefs.payment_methods.filter(x => x.id !== pm.id) })}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <RadioGroup<'card' | 'bank'>
            label={t('settings.payTypeLabel')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'card', label: t('settings.payCardOpt') },
              { value: 'bank', label: t('settings.payBankOpt') },
            ]}
          />
          <Field label={kind === 'card' ? t('settings.payCardBrand') : t('settings.payBankName')}>
            <input name="brand" className="set-input" value={brand} onChange={e => setBrand(e.target.value)}
              placeholder={kind === 'card' ? t('settings.payBrandPhCard') : t('settings.payBrandPhBank')} />
          </Field>
          <Field label={t('settings.payLast4')}>
            <input name="last4" className="set-input" value={last4} inputMode="numeric"
              onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={t('settings.payLast4Ph')} />
          </Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>{t('settings.genSave')}</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>{t('settings.hvCancel')}</button>
          </div>
          <p className="set-dialog-note set-dialog-note-tight">
            {t('settings.payStripeNote')}
          </p>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>{t('settings.payAddBtn')}</button>
      )}
    </div>
  )
}

// -- list-editor add forms ------------------------------------------

function ContactsEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const t = useT()
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
      {prefs.emergency_contacts.length === 0 && <div className="set-list-empty">{t('settings.contEmpty')}</div>}
      {prefs.emergency_contacts.map(c => (
        <div key={c.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{c.name}</strong>
            <span>{c.relation}{c.phone ? ` · ${c.phone}` : ''}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label={t('settings.genRemove')}
            onClick={() => remove(c.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label={t('settings.contName')}><input name="contact_name" className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.contNamePh')} /></Field>
          <Field label={t('settings.contRelation')}><input name="contact_relation" className="set-input" value={relation} onChange={e => setRelation(e.target.value)} placeholder={t('settings.contRelationPh')} /></Field>
          <Field label={t('settings.fldPhone')}><input name="contact_phone" className="set-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('settings.phPhone')} /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>{t('settings.contAddSubmit')}</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>{t('settings.hvCancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>{t('settings.contAddBtn')}</button>
      )}
    </div>
  )
}

function VehiclesEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const t = useT()
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
      {prefs.vehicles.length === 0 && <div className="set-list-empty">{t('settings.vehEmpty')}</div>}
      {prefs.vehicles.map(v => (
        <div key={v.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{[v.make, v.model].filter(Boolean).join(' ') || t('settings.vehFallback')}</strong>
            <span>{[v.plate, v.color].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label={t('settings.genRemove')}
            onClick={() => remove(v.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label={t('settings.vehMake')}><input name="vehicle_make" className="set-input" value={make} onChange={e => setMake(e.target.value)} placeholder={t('settings.vehMakePh')} /></Field>
          <Field label={t('settings.vehModel')}><input name="vehicle_model" className="set-input" value={model} onChange={e => setModel(e.target.value)} placeholder={t('settings.vehModelPh')} /></Field>
          <Field label={t('settings.vehPlate')}><input name="vehicle_plate" className="set-input" value={plate} onChange={e => setPlate(e.target.value)} placeholder={t('settings.vehPlatePh')} /></Field>
          <Field label={t('settings.vehColor')}><input name="vehicle_color" className="set-input" value={color} onChange={e => setColor(e.target.value)} placeholder={t('settings.vehColorPh')} /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>{t('settings.vehAddSubmit')}</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>{t('settings.hvCancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>{t('settings.vehAddBtn')}</button>
      )}
    </div>
  )
}

function PetsEditor({ prefs, patch, profileId, communityId }: { prefs: Preferences; patch: (p: Partial<Preferences>) => void; profileId: string | null; communityId: string | null }) {
  const t = useT()
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
      {prefs.pets.length === 0 && <div className="set-list-empty">{t('settings.petEmpty')}</div>}
      {prefs.pets.map(p => (
        <div key={p.id} className="set-list-row">
          <div className="set-list-row-body">
            <strong>{p.name}</strong>
            <span>{[p.species, p.breed].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="set-list-remove" aria-label={t('settings.genRemove')}
            onClick={() => remove(p.id)}>×</button>
        </div>
      ))}
      {adding ? (
        <div className="set-list-add">
          <Field label={t('settings.petName')}><input name="pet_name" className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.petNamePh')} /></Field>
          <Field label={t('settings.petSpecies')}><input name="pet_species" className="set-input" value={species} onChange={e => setSpecies(e.target.value)} placeholder={t('settings.petSpeciesPh')} /></Field>
          <Field label={t('settings.petBreed')}><input name="pet_breed" className="set-input" value={breed} onChange={e => setBreed(e.target.value)} placeholder={t('settings.petBreedPh')} /></Field>
          <div className="set-list-add-actions">
            <button type="button" className="set-btn-primary" onClick={submit}>{t('settings.petAddSubmit')}</button>
            <button type="button" className="set-btn-ghost" onClick={reset}>{t('settings.hvCancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="set-btn-ghost" onClick={() => setAdding(true)}>{t('settings.petAddBtn')}</button>
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
  const t = useT()
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
      aria-label={image ? t('settings.avatarChange') : t('settings.avatarAdd')}
      title={image ? t('settings.avatarChange') : t('settings.avatarAdd')}
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
  const t = useT()
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
      setMsg(t('settings.emailSentMsg', { email: value.trim() }))
    } catch (e: any) {
      setStatus('error'); setMsg(e?.message || t('settings.emailChangeErr'))
    }
  }

  return (
    <Field label={t('settings.fldEmailLabel')}>
      <input name="email" autoComplete="email" className="set-input" type="email"
        value={value} onChange={e => { setValue(e.target.value); if (status !== 'idle') setStatus('idle') }}
        placeholder={t('settings.phEmail')} />
      <div className="set-list-add-actions" style={{ marginTop: 8 }}>
        <button type="button" className="set-btn-primary" onClick={submit}
          disabled={!valid || !changed || status === 'sending'}>
          {status === 'sending' ? t('settings.emailSending') : t('settings.emailChangeBtn')}
        </button>
      </div>
      {status === 'sent'  && <span className="set-dialog-note set-dialog-note-tight">✓ {msg}</span>}
      {status === 'error' && <span className="set-dialog-note set-dialog-note-tight">{msg}</span>}
      {(status === 'idle' || status === 'sending') && (
        <span className="set-dialog-note set-dialog-note-tight">
          {t('settings.emailLoginNote')}
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
  const t = useT()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fallback = ((prefs.full_name || 'R')[0] || 'R').toUpperCase()
  const onPick = async (file: File) => {
    try {
      const dataUrl = await fileToProfileImage(file)
      patch({ profile_image: dataUrl })
    } catch (err: any) {
      alert(err?.message || t('settings.hvLoadImgFailed'))
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
          {prefs.profile_image ? t('settings.photoChange') : t('settings.photoUpload')}
        </button>
        {prefs.profile_image && (
          <button type="button" className="set-btn-ghost"
            onClick={() => patch({ profile_image: '' })}>
            {t('settings.photoRemove')}
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
          {t('settings.photoHint')}
        </p>
      </div>
    </div>
  )
}

function ReferDialog({ community }: { community: string }) {
  const t = useT()
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
        {t('settings.referNote', { community })}
      </p>
      <div className="set-refer-row">
        <input name="refer-link" className="set-input" value={link} readOnly onFocus={e => e.currentTarget.select()} />
        <button type="button" className="set-btn-primary" onClick={copy}>
          {copied ? t('settings.referCopied') : t('settings.referCopyBtn')}
        </button>
      </div>
    </>
  )
}

function UpdatesDialog() {
  const t = useT()
  return (
    <>
      <p className="set-dialog-note">
        {t('settings.updNote')}
      </p>
      <div className="set-readonly-rows">
        <div className="set-readonly-row"><span>{t('settings.build')}</span><span>1.2.5 (web)</span></div>
        <div className="set-readonly-row"><span>{t('settings.lastDeployed')}</span><span>May 27, 2026</span></div>
        <div className="set-readonly-row"><span>{t('settings.nativeApps')}</span><span>{t('settings.comingSoon')}</span></div>
      </div>
      <button type="button" className="set-btn-primary"
        onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}>
        {t('settings.updReloadBtn')}
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
function IconAppIcon() { return <Svg><><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 14 12 9l4 5"/><path d="M10.5 14v-2"/></></Svg> }
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
