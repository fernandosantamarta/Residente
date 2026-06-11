'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePlatformConsole, PlatformRequest, PlatformResident, OperatorRole, AuditEntry } from '@/hooks/usePlatform'
import { DangerAction } from '@/components/DangerAction'

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDateTime = (s: string) =>
  s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

// Self-contained palette — this page lives outside the themed app layout.
// Signup/mock look: warm cream surfaces, dark-brown ink, signup-orange accent.
const C = {
  bg: '#FFF5EC', card: '#FFFFFF', border: 'rgba(42,18,6,0.14)',
  // Darker muted + border than before so secondary text and rules read on cream.
  text: '#2A1206', muted: 'rgba(42,18,6,0.64)', accent: '#E14909', accentSoft: 'rgba(225,73,9,0.12)',
  // Semantic set — used consistently across KPI tiles, status badges, and table
  // rows so an operator can scan state by color: green=healthy, amber=attention,
  // red=problem, blue=in progress. Hues chosen to stay legible on white/cream.
  good: '#1B9E6B', goodSoft: 'rgba(27,158,107,0.13)',
  warn: '#C2740C', warnSoft: 'rgba(194,116,12,0.14)',
  bad: '#D64141', badSoft: 'rgba(214,65,65,0.13)',
  info: '#3B72C4', infoSoft: 'rgba(59,114,196,0.13)',
}
type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'
const toneColor: Record<Tone, string> = { neutral: C.text, good: C.good, warn: C.warn, bad: C.bad, info: C.info, accent: C.accent }
const toneSoft: Record<Tone, string> = { neutral: C.border, good: C.goodSoft, warn: C.warnSoft, bad: C.badSoft, info: C.infoSoft, accent: C.accentSoft }

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 22px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, padding: '0 12px 10px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '13px 12px', borderTop: `1px solid ${C.border}`, fontSize: 13.5, color: C.text, verticalAlign: 'middle' }
const searchInput: React.CSSProperties = {
  width: '100%', maxWidth: 320, background: C.bg, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 12px',
  fontSize: 13, marginBottom: 14, outline: 'none', display: 'block',
}
// Case-insensitive substring match across a row's searchable fields.
const matchesQuery = (q: string, fields: (string | null | undefined)[]) => {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return fields.some(f => String(f || '').toLowerCase().includes(s))
}
const STATUS_NEXT: Record<PlatformRequest['status'], PlatformRequest['status']> = { open: 'in_progress', in_progress: 'resolved', resolved: 'open' }
const statusStyle = (s: PlatformRequest['status']): React.CSSProperties => ({
  cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, border: '1px solid transparent',
  flexShrink: 0, whiteSpace: 'nowrap', textTransform: 'capitalize',
  background: s === 'resolved' ? C.goodSoft : s === 'in_progress' ? C.infoSoft : C.accentSoft,
  color: s === 'resolved' ? C.good : s === 'in_progress' ? C.info : C.accent,
})

// Subscription status → semantic color. Module-scoped so either table can use
// it (a community table defined before the component-body helpers still reaches
// this), and so the badge color stays identical across both tables.
const subStatusColor = (s: string | null) =>
  s === 'active' ? C.good : s === 'past_due' ? C.bad : s === 'cancelled' || s === 'canceled' ? C.warn : s === 'trial' ? C.info : C.muted
const subStatusBg = (s: string | null) =>
  s === 'active' ? C.goodSoft : s === 'past_due' ? C.badSoft : s === 'cancelled' || s === 'canceled' ? C.warnSoft : s === 'trial' ? C.infoSoft : C.accentSoft

type Tab = 'overview' | 'communities' | 'subscriptions' | 'support' | 'operators' | 'activity'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'communities', label: 'Communities' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'support', label: 'Support' },
  { key: 'operators', label: 'Operators' },
  { key: 'activity', label: 'Activity' },
]

// Which tabs each operator role may see — the mock's role-views. Money lives only
// in Overview + Subscriptions, so omitting those from a role hides all revenue
// from it. Founder (owner) manages the team, so only Founder gets Operators.
const ROLE_TABS: Record<OperatorRole, Tab[]> = {
  owner:    ['overview', 'communities', 'subscriptions', 'support', 'operators', 'activity'],
  billing:  ['overview', 'subscriptions', 'communities', 'activity'],
  operator: ['communities', 'support', 'activity'],
  support:  ['support', 'activity'],
}

// Per-home monthly rate (cents) by plan tier — mirrors lib/plan.ts. Uses the
// community's stored plan (respects manual tier overrides), not a recompute.
const PLAN_RATE_CENTS: Record<string, number> = { free: 0, pro: 200, premium: 500, enterprise: 1000 }
const communityMonthlyCents = (c: { plan: string | null; home_count: number | null; unit_count: number | null }) =>
  (PLAN_RATE_CENTS[c.plan || 'free'] ?? 0) * Number(c.home_count ?? c.unit_count ?? 0)
const fmtMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`

const ROLES: { key: OperatorRole; label: string; blurb: string }[] = [
  { key: 'owner', label: 'Founder', blurb: 'Everything + manage the team' },
  { key: 'operator', label: 'Onboarding', blurb: 'Communities + support, no billing' },
  { key: 'billing', label: 'Billing', blurb: 'Subscriptions & invoices' },
  { key: 'support', label: 'Support', blurb: 'Support inbox only' },
]
const roleColor = (r: OperatorRole) =>
  r === 'owner' ? '#E14909' : r === 'operator' ? '#2F6BD6' : r === 'billing' ? '#8A5CF0' : '#1F7A4D'
const roleBg = (r: OperatorRole) =>
  r === 'owner' ? 'rgba(225,73,9,0.12)' : r === 'operator' ? 'rgba(47,107,214,0.14)' : r === 'billing' ? 'rgba(138,92,240,0.14)' : 'rgba(31,122,77,0.14)'
const ROLE_OPTIONS = ROLES.map(r => ({ value: r.key, label: r.label, color: roleColor(r.key), hint: r.blurb }))

// Human-readable line for one audit entry.
const auditText = (e: AuditEntry): string => {
  const d = e.detail || {}
  switch (e.action) {
    case 'entered_community':    return `entered ${d.name || 'a community'}`
    case 'operator_added':       return `added ${d.email || 'an operator'} as ${d.role || 'operator'}`
    case 'operator_removed':     return `removed ${d.email || 'an operator'} (${d.role || '—'})`
    case 'operator_role_changed':return `changed an operator from ${d.from} to ${d.to}`
    case 'ticket_status':        return `moved a ticket "${d.subject || ''}" ${d.from} → ${d.to}`
    default:                     return e.action.replace(/_/g, ' ')
  }
}

// Themed dropdown for the console — replaces native <select> so the popup
// panel matches the dark palette (no OS-white menu). Closes on outside click
// + Escape. Options can carry their own accent color (used for role colors).
type Opt<T extends string> = { value: T; label: string; color?: string; hint?: string }
function Select<T extends string>({ value, onChange, options, width, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: Opt<T>[]; width?: number | string; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<T | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  const sel = options.find(o => o.value === value)
  return (
    <div ref={ref} style={{ position: 'relative', width: width ?? 'auto', flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          background: C.bg, border: `1px solid ${open ? C.accent : C.border}`, borderRadius: 9, padding: '9px 12px',
          fontSize: 13, fontWeight: 700, color: sel?.color ?? C.text, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span>{sel?.label ?? '—'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '100%', zIndex: 50,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 5, overflow: 'hidden',
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)' }}>
          {options.map(o => {
            const active = o.value === value, hot = hover === o.value
            return (
              <button key={o.value} type="button" role="option" aria-selected={active}
                onMouseEnter={() => setHover(o.value)} onMouseLeave={() => setHover(h => h === o.value ? null : h)}
                onClick={() => { onChange(o.value); setOpen(false) }}
                style={{ width: '100%', textAlign: 'left', display: 'block', cursor: 'pointer',
                  background: active ? C.accentSoft : hot ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none', borderRadius: 7, padding: '8px 11px', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: o.color ?? C.text }}>{o.label}</div>
                {o.hint && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{o.hint}</div>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PlatformConsole() {
  const {
    isAdmin, myRole, communities, requests, operators, audit, loading,
    setRequestStatus, enterCommunity, addOperator, removeOperator, setOperatorRole,
    removeCommunity, fetchResidents, removeResident,
  } = usePlatformConsole()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [entering, setEntering] = useState<string | null>(null)
  // Per-list search queries (communities, subscriptions, roster modal).
  const [commQuery, setCommQuery] = useState('')
  const [subQuery, setSubQuery] = useState('')
  const [rosterQuery, setRosterQuery] = useState('')
  const isOwner = myRole === 'owner'
  // Role-scoped views (mock parity). Unknown/legacy role → treat as full access
  // (owner) so an admin never lands on a blank console. Money lives only in the
  // Overview + Subscriptions tabs, so omitting those hides revenue from a role.
  const effectiveRole: OperatorRole = (myRole && ROLE_TABS[myRole]) ? myRole : 'owner'
  const allowedTabs = ROLE_TABS[effectiveRole]
  const curTab: Tab = allowedTabs.includes(tab) ? tab : allowedTabs[0]
  const canEnter = effectiveRole !== 'support'
  // Residents roster modal (per community)
  const [rosterFor, setRosterFor] = useState<{ id: string; name: string } | null>(null)
  const [roster, setRoster] = useState<PlatformResident[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterBusy, setRosterBusy] = useState<string | null>(null)
  const openRoster = async (id: string, name: string) => {
    setRosterFor({ id, name }); setRoster([]); setRosterQuery(''); setRosterLoading(true)
    setRoster(await fetchResidents(id)); setRosterLoading(false)
  }
  const onRemoveResident = async (rid: string, rname: string) => {
    if (!window.confirm(`Remove ${rname || 'this resident'} from the community? This deletes their roster record.`)) return
    setRosterBusy(rid)
    const err = await removeResident(rid)
    if (!err && rosterFor) setRoster(await fetchResidents(rosterFor.id))
    setRosterBusy(null)
  }
  // Where "Back to your community" returns to: the admin page the operator was
  // on before opening Platform Console (stashed by the admin nav link). Defaults
  // to the admin home, and only honors /admin paths so it can't be redirected.
  const [returnTo, setReturnTo] = useState('/admin')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('admin_return_to')
    if (v && v.startsWith('/admin')) setReturnTo(v)
  }, [])

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<OperatorRole>('operator')
  const [opMsg, setOpMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)
  const [opBusy, setOpBusy] = useState(false)

  const onAddOperator = async () => {
    const email = newEmail.trim()
    if (!email) return
    setOpBusy(true); setOpMsg(null)
    const err = await addOperator(email, newRole)
    setOpBusy(false)
    if (err) setOpMsg({ kind: 'err', text: err })
    else { setOpMsg({ kind: 'ok', text: `Added ${email} as ${newRole}.` }); setNewEmail('') }
  }
  const onChangeRole = async (id: string, role: OperatorRole) => {
    setOpMsg(null)
    const err = await setOperatorRole(id, role)
    if (err) setOpMsg({ kind: 'err', text: err })
  }
  const onRemoveOperator = async (id: string, name: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name} as a Residente operator?`)) return
    setOpMsg(null)
    const err = await removeOperator(id)
    if (err) setOpMsg({ kind: 'err', text: err })
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* Hover/zebra/past-due row treatment — this page is otherwise all inline
          styles, so one scoped style tag drives the table interactions. */}
      <style>{`
        .plat-table tbody tr { transition: background 0.12s ease; }
        .plat-table tbody tr:nth-child(even) { background: rgba(42,18,6,0.025); }
        .plat-table tbody tr:hover { background: rgba(225,73,9,0.07); }
        .plat-table tbody tr.is-pastdue { background: rgba(214,65,65,0.07); }
        .plat-table tbody tr.is-pastdue:hover { background: rgba(214,65,65,0.12); }
      `}</style>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 28px 64px' }}>{children}</div>
    </div>
  )

  if (loading || isAdmin === null) return shell(<div style={{ color: C.muted, padding: 40 }}>Loading the platform console…</div>)
  if (!isAdmin) return shell(
    <div style={{ paddingTop: 24, maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Not authorized</h1>
      <p style={{ color: C.muted, marginBottom: 16 }}>The Platform Console is for Residente operators only.</p>
      <Link href="/app" style={{ color: C.accent, textDecoration: 'none' }}>&larr; Back to your community</Link>
    </div>
  )

  const openCount = requests.filter(r => r.status !== 'resolved').length
  const totalResidents = communities.reduce((s, c) => s + Number(c.resident_count || 0), 0)
  const trials = communities.filter(c => c.subscription_status === 'trial').length
  const paying = communities.filter(c => communityMonthlyCents(c) > 0)
  const mrrCents = communities.reduce((s, c) => s + (c.subscription_status === 'active' ? communityMonthlyCents(c) : 0), 0)
  const activeCount = communities.filter(c => c.subscription_status === 'active').length
  const pastDueCount = communities.filter(c => c.subscription_status === 'past_due').length

  // Search-filtered views (the lists stay alphabetical from the hook).
  const filteredCommunities = communities.filter(c =>
    matchesQuery(commQuery, [c.name, c.location, c.created_by_name, c.created_by_email, c.join_code, c.plan, c.subscription_status]))
  const filteredSubs = communities.filter(c =>
    matchesQuery(subQuery, [c.name, c.plan, c.subscription_status]))
  const filteredRoster = roster.filter(r =>
    matchesQuery(rosterQuery, [r.full_name, r.email, r.unit_number, r.board_position]))

  const onEnter = async (id: string) => {
    setEntering(id)
    const ok = await enterCommunity(id)
    if (ok) router.push('/admin')
    else setEntering(null)
  }

  // A KPI tile. `tone` colors the number + left bar + a faint background wash so
  // the meaningful figures (MRR, past due, open tickets) carry their own color.
  // `prefix` lets MRR show a "$". When `tone` is a problem color (warn/bad) the
  // wash only shows once the value is non-zero, so a clean console stays calm.
  const stat = (label: string, val: number, tone: Tone = 'neutral', prefix = '') => {
    const lit = tone !== 'neutral' && val > 0
    const col = lit ? toneColor[tone] : C.text
    return (
      <div key={label} style={{ ...card, padding: '18px 20px', position: 'relative', overflow: 'hidden',
        background: lit ? toneSoft[tone] : C.card, borderColor: lit ? 'transparent' : C.border }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: lit ? col : C.border }} />
        <div style={{ fontSize: 32, fontWeight: 800, color: col, lineHeight: 1 }}>{prefix}{val.toLocaleString('en-US')}</div>
        <div style={{ color: C.muted, fontSize: 12.5, marginTop: 7, fontWeight: 600 }}>{label}</div>
      </div>
    )
  }

  const statsGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
      {stat('Communities', communities.length)}
      {stat('MRR / mo', Math.round(mrrCents / 100), 'good', '$')}
      {stat('Active subs', activeCount, 'good')}
      {stat('Trials', trials, 'info')}
      {stat('Past due', pastDueCount, 'bad')}
      {stat('Open tickets', openCount, 'accent')}
      {stat('Total residents', totalResidents)}
    </div>
  )

  const communitiesSection = (
    <section style={{ ...card, marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Communities</h2>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>Click <strong style={{ color: C.accent }}>Manage</strong> to drop into a community and run it as an operator.</p>
      {communities.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5 }}>No communities yet.</div>
      ) : (
        <>
        <input value={commQuery} onChange={e => setCommQuery(e.target.value)}
          placeholder="Search communities…" aria-label="Search communities" style={searchInput} />
        {filteredCommunities.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13.5 }}>No communities match &ldquo;{commQuery}&rdquo;.</div>
        ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="plat-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              {['Community', 'Created by', 'Plan', 'Residents', 'Board', 'Join code', 'Created', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filteredCommunities.map(c => (
                <tr key={c.id} className={c.subscription_status === 'past_due' ? 'is-pastdue' : undefined}>
                  <td style={{ ...td, fontWeight: 700 }}>{c.name || '—'}{c.location ? <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted }}>{c.location}</span> : null}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{c.created_by_name || '—'}</div>
                    {c.created_by_email && <div style={{ fontSize: 12, color: C.muted, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.created_by_email}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize',
                      background: subStatusBg(c.subscription_status), color: subStatusColor(c.subscription_status) }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: subStatusColor(c.subscription_status) }} />
                      {c.subscription_status || 'active'}
                    </span>
                  </td>
                  <td style={td}>{c.resident_count}</td>
                  <td style={td}>{c.board_count}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', letterSpacing: 1, color: C.muted }}>{c.join_code || '—'}</td>
                  <td style={{ ...td, color: C.muted }}>{fmtDate(c.created_at)}</td>
                  <td style={td}>
                    {canEnter ? (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                        <button onClick={() => onEnter(c.id)} disabled={entering === c.id}
                          style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, flexShrink: 0,
                            border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, whiteSpace: 'nowrap' }}>
                          {entering === c.id ? 'Entering…' : 'Manage →'}
                        </button>
                        <button onClick={() => openRoster(c.id, c.name)}
                          style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, flexShrink: 0,
                            border: `1px solid ${C.border}`, background: 'transparent', color: C.text, whiteSpace: 'nowrap' }}>
                          Residents
                        </button>
                        <DangerAction
                          dark
                          confirmWord="DELETE"
                          confirmLabel="Delete community"
                          title={`Delete ${c.name || 'community'}`}
                          body={<>This permanently deletes <strong>{c.name || 'this community'}</strong> and all its data, and cancels its subscription. This can&apos;t be undone.</>}
                          onConfirm={async () => { const e = await removeCommunity(c.id); return e ? { error: e } : { ok: true } }}
                          trigger={(open) => (
                            <button onClick={open}
                              style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, flexShrink: 0,
                                border: '1px solid #E97070', background: 'transparent', color: '#E97070', whiteSpace: 'nowrap' }}>
                              Delete
                            </button>
                          )}
                        />
                      </div>
                    ) : (
                      <span title="Support operators can't manage communities" style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
    </section>
  )

  const subscriptionsSection = (
    <section style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Subscriptions</h2>
        <span style={{ fontSize: 13, color: C.muted }}>
          MRR <strong style={{ color: C.accent }}>{fmtMoney(mrrCents)}/mo</strong> · {activeCount} active · {paying.length} on a paid plan
          {pastDueCount > 0 && <span style={{ color: C.bad, fontWeight: 700 }}> · {pastDueCount} past due</span>}
        </span>
      </div>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>Every community&apos;s plan, status, and monthly amount. MRR counts active subscriptions only.</p>
      {communities.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5 }}>No communities yet.</div>
      ) : (
        <>
        <input value={subQuery} onChange={e => setSubQuery(e.target.value)}
          placeholder="Search subscriptions…" aria-label="Search subscriptions" style={searchInput} />
        {filteredSubs.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13.5 }}>No subscriptions match &ldquo;{subQuery}&rdquo;.</div>
        ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="plat-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              {['Community', 'Plan', 'Status', 'Homes', 'Monthly', 'Billing'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filteredSubs.map(c => {
                const monthly = communityMonthlyCents(c)
                return (
                  <tr key={c.id} className={c.subscription_status === 'past_due' ? 'is-pastdue' : undefined}>
                    <td style={{ ...td, fontWeight: 700 }}>{c.name || '—'}</td>
                    <td style={{ ...td, textTransform: 'capitalize' }}>{c.plan || 'free'}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize',
                        background: subStatusBg(c.subscription_status), color: subStatusColor(c.subscription_status) }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: subStatusColor(c.subscription_status) }} />
                        {c.subscription_status || 'active'}
                      </span>
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>{c.home_count ?? c.unit_count ?? '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{monthly > 0 ? `${fmtMoney(monthly)}/mo` : 'Free'}</td>
                    <td style={{ ...td, color: C.muted }}>{c.stripe_subscription_id ? 'Stripe' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
    </section>
  )

  const supportSection = (
    <section style={card}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        Support inbox {openCount > 0 && <span style={{ color: C.accent }}>· {openCount} open</span>}
      </h2>
      {requests.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5, marginTop: 12 }}>No support requests yet.</div>
      ) : requests.map(r => (
        <div key={r.id} style={{ borderTop: `1px solid ${C.border}`, padding: '14px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <button onClick={() => setRequestStatus(r.id, STATUS_NEXT[r.status])} title="Click to advance status" style={statusStyle(r.status)}>
            {r.status === 'in_progress' ? 'in progress' : r.status}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.subject}</div>
            {r.body && <div style={{ color: C.muted, fontSize: 13.5, marginTop: 3 }}>{r.body}</div>}
            <div style={{ color: C.muted, fontSize: 12.5, marginTop: 6 }}>
              {r.from_name || 'A board member'}{r.from_email ? ` · ${r.from_email}` : ''} · {fmtDate(r.created_at)}
            </div>
          </div>
        </div>
      ))}
    </section>
  )

  // Triage strip for the Overview: surfaces the two things an operator must act
  // on — communities behind on payment and unresolved support — as colored
  // chips. Hidden entirely when there's nothing to do, so a healthy console
  // doesn't carry a warning it doesn't need.
  const attentionItems: { label: string; tone: Tone; onClick: () => void }[] = []
  if (pastDueCount > 0) attentionItems.push({ label: `${pastDueCount} past due`, tone: 'bad', onClick: () => setTab('subscriptions') })
  if (openCount > 0) attentionItems.push({ label: `${openCount} open ticket${openCount > 1 ? 's' : ''}`, tone: 'accent', onClick: () => setTab('support') })
  if (trials > 0) attentionItems.push({ label: `${trials} on trial`, tone: 'info', onClick: () => setTab('subscriptions') })
  const attentionBanner = attentionItems.length > 0 && (
    <div style={{ ...card, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      borderColor: pastDueCount > 0 ? C.badSoft : C.border }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Needs attention</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {attentionItems.map(a => (
          <button key={a.label} onClick={a.onClick}
            style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '5px 13px', borderRadius: 999,
              border: `1px solid ${toneColor[a.tone]}`, background: toneSoft[a.tone], color: toneColor[a.tone], whiteSpace: 'nowrap' }}>
            {a.label} &rarr;
          </button>
        ))}
      </div>
      {pastDueCount === 0 && openCount === 0 && (
        <span style={{ color: C.muted, fontSize: 12.5 }}>No payments behind, no open tickets.</span>
      )}
    </div>
  )

  return shell(
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.3 }}>
          Residente <span style={{ color: C.accent }}>Platform Console</span>
        </h1>
        <Link href={returnTo} style={{ color: C.muted, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>&larr; Back to your community</Link>
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, marginTop: 4 }}>Every community on Residente, plus support from their boards. Operators only.</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, margin: '22px 0 22px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        {TABS.filter(t => allowedTabs.includes(t.key)).map(t => {
          const active = curTab === t.key
          const badge = t.key === 'support' && openCount > 0 ? ` · ${openCount}` : ''
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                cursor: 'pointer', background: 'none', border: 'none', padding: '10px 16px', fontSize: 14,
                fontWeight: active ? 700 : 500, color: active ? C.accent : C.muted,
                borderBottom: `2px solid ${active ? C.accent : 'transparent'}`, marginBottom: -1,
              }}>
              {t.label}{badge}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW — everything on one page */}
      {curTab === 'overview' && (<>{attentionBanner}{statsGrid}{subscriptionsSection}{communitiesSection}{supportSection}</>)}

      {/* COMMUNITIES */}
      {curTab === 'communities' && communitiesSection}

      {/* SUBSCRIPTIONS */}
      {curTab === 'subscriptions' && subscriptionsSection}

      {/* SUPPORT */}
      {curTab === 'support' && supportSection}

      {/* OPERATORS */}
      {curTab === 'operators' && (
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Residente operators</h2>
            {!isOwner && <span style={{ color: C.muted, fontSize: 12 }}>Owners can add or change operators.</span>}
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, margin: '4px 0 14px' }}>
            Who can act on the platform, and what they're allowed to do.
          </p>

          {opMsg && (
            <div style={{ fontSize: 13, padding: '9px 13px', borderRadius: 9, marginBottom: 14,
              background: opMsg.kind === 'err' ? C.badSoft : C.goodSoft,
              color: opMsg.kind === 'err' ? C.bad : C.good, border: `1px solid ${opMsg.kind === 'err' ? C.bad : C.good}` }}>
              {opMsg.text}
            </div>
          )}

          {operators.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13.5 }}>No operators listed.</div>
          ) : operators.map(o => {
            const editable = isOwner
            return (
              <div key={o.profile_id} style={{ borderTop: `1px solid ${C.border}`, padding: '13px 0', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: roleBg(o.role), color: roleColor(o.role), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {o.name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'OP'}
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</div>
                  {o.email && <div style={{ color: C.muted, fontSize: 12.5 }}>{o.email}</div>}
                  <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2 }}>
                    since {fmtDate(o.added_at)}{o.added_by_name ? ` · added by ${o.added_by_name}` : ''}
                  </div>
                </div>
                {editable ? (
                  <Select<OperatorRole> value={o.role} onChange={v => onChangeRole(o.profile_id, v)}
                    options={ROLE_OPTIONS} width={148} ariaLabel={`Role for ${o.name}`} />
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, textTransform: 'capitalize', background: roleBg(o.role), color: roleColor(o.role) }}>{o.role}</span>
                )}
                {editable && (
                  <button onClick={() => onRemoveOperator(o.profile_id, o.name)}
                    style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, whiteSpace: 'nowrap' }}>
                    Remove
                  </button>
                )}
              </div>
            )
          })}

          {isOwner && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Add an operator</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="their Residente email"
                  onKeyDown={e => { if (e.key === 'Enter') onAddOperator() }}
                  style={{ flex: 1, minWidth: 220, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 9, padding: '10px 13px', fontSize: 13.5 }} />
                <Select<OperatorRole> value={newRole} onChange={setNewRole}
                  options={ROLE_OPTIONS} width={150} ariaLabel="Role for new operator" />
                <button onClick={onAddOperator} disabled={opBusy || !newEmail.trim()}
                  style={{ cursor: opBusy || !newEmail.trim() ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 700, padding: '10px 18px', borderRadius: 9,
                    border: `1px solid ${C.accent}`, background: opBusy || !newEmail.trim() ? 'transparent' : C.accentSoft, color: C.accent, opacity: opBusy || !newEmail.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {opBusy ? 'Adding…' : 'Add operator'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                {ROLES.map(r => (
                  <div key={r.key} style={{ fontSize: 11.5, color: C.muted }}>
                    <span style={{ color: roleColor(r.key), fontWeight: 700 }}>{r.label}</span> — {r.blurb}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ACTIVITY (audit log) */}
      {curTab === 'activity' && (
        <section style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Activity</h2>
          <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 8 }}>Every operator action on the platform, newest first.</p>
          {audit.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13.5, marginTop: 10 }}>No activity recorded yet.</div>
          ) : audit.map(e => (
            <div key={e.id} style={{ borderTop: `1px solid ${C.border}`, padding: '12px 0', display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220, fontSize: 13.5 }}>
                <strong style={{ color: C.text }}>{e.actor_name || 'An operator'}</strong>
                <span style={{ color: C.muted }}> {auditText(e)}</span>
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>{fmtDateTime(e.created_at)}</div>
            </div>
          ))}
        </section>
      )}

      {/* Residents roster modal — view + remove a community's residents */}
      {rosterFor && (
        <div onClick={() => setRosterFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,10,16,0.6)', display: 'grid', placeItems: 'center', padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{rosterFor.name || 'Community'} · residents</h2>
              <button onClick={() => setRosterFor(null)} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 26, cursor: 'pointer', color: C.muted, lineHeight: 1 }}>×</button>
            </div>
            <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>Remove a resident to delete their roster record from this community.</p>
            {rosterLoading ? (
              <div style={{ color: C.muted, fontSize: 13.5, padding: '14px 0' }}>Loading…</div>
            ) : roster.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13.5, padding: '14px 0' }}>No residents in this community.</div>
            ) : (
              <>
              <input value={rosterQuery} onChange={e => setRosterQuery(e.target.value)}
                placeholder="Search residents…" aria-label="Search residents" style={searchInput} />
              {filteredRoster.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13.5, padding: '14px 0' }}>No residents match &ldquo;{rosterQuery}&rdquo;.</div>
              ) : filteredRoster.map(r => (
                <div key={r.id} style={{ borderTop: `1px solid ${C.border}`, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {r.full_name || '—'}{r.is_board && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: C.accent }}>{r.board_position || 'Board'}</span>}
                    </div>
                    <div style={{ color: C.muted, fontSize: 12.5 }}>
                      {[r.unit_number ? `Unit ${r.unit_number}` : null, r.email].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <button onClick={() => onRemoveResident(r.id, r.full_name || '')} disabled={rosterBusy === r.id}
                    style={{ flexShrink: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid #E97070', background: 'transparent', color: '#E97070' }}>
                    {rosterBusy === r.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
