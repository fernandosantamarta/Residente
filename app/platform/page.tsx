'use client'

import { useState, useRef, useEffect, Fragment } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { usePlatformConsole, usePlatformThread, sendPlatformReply, openCommunityThread, PlatformRequest, PlatformResident, PlatformOperator, OperatorRole, AuditEntry } from '@/hooks/usePlatform'
import { DangerAction } from '@/components/DangerAction'
import PendingQueue from './PendingQueue'

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

type Tab = 'overview' | 'pending' | 'communities' | 'subscriptions' | 'ai-insights' | 'support' | 'operators' | 'activity'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pending', label: 'Pending' },
  { key: 'communities', label: 'Communities' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'ai-insights', label: 'AI Insights' },
  { key: 'support', label: 'Support' },
  { key: 'operators', label: 'Operators' },
  { key: 'activity', label: 'Activity' },
]

// Which tabs each operator role may see — the mock's role-views. Money lives only
// in Overview + Subscriptions, so omitting those from a role hides all revenue
// from it. Founder (owner) manages the team, so only Founder gets Operators.
const ROLE_TABS: Record<OperatorRole, Tab[]> = {
  // AI Insights (cost + the API budget/kill switch) is OWNER-ONLY — no other
  // Residente operator role can see it (and the RPCs behind it are owner-gated too).
  owner:    ['overview', 'pending', 'communities', 'subscriptions', 'ai-insights', 'support', 'operators', 'activity'],
  billing:  ['overview', 'pending', 'subscriptions', 'communities', 'activity'],
  operator: ['pending', 'communities', 'support', 'activity'],
  support:  ['pending', 'support', 'activity'],
}

// Per-home monthly rate (cents) by plan tier — mirrors lib/plan.ts. Uses the
// community's stored plan (respects manual tier overrides), not a recompute.
const PLAN_RATE_CENTS: Record<string, number> = { free: 0, pro: 200, premium: 400, enterprise: 600 }
const communityMonthlyCents = (c: { plan: string | null; home_count: number | null; unit_count: number | null }) =>
  (PLAN_RATE_CENTS[c.plan || 'free'] ?? 0) * Number(c.home_count ?? c.unit_count ?? 0)
const fmtMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`
// AI costs are small (cents to low dollars), so show two decimals here.
const fmtCents = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`
// Friendly label for each AI feature (function + document kind) — drives the
// "where is AI used most" breakdown. Keyed `${fn}|${kind}`.
const AI_FEATURE_LABEL: Record<string, string> = {
  'extract-roster|roster': 'Owner roster & balances',
  'extract-doc|budget': 'Budgets',
  'extract-doc|insurance': 'Insurance policies',
  'extract-setup|rules': 'Governing-doc rules',
  'extract-doc|categorize': 'Records filing',
  'extract-doc|minutes': 'Meeting minutes',
  'extract-doc|violation': 'Violation photos',
}
const aiFeatureLabel = (fn: string, kind: string) =>
  AI_FEATURE_LABEL[`${fn}|${kind}`] || kind || fn || 'Other'

// 'owner' in the DB and "Owner" in the UI — the role that manages the team.
const ROLES: { key: OperatorRole; label: string; blurb: string }[] = [
  { key: 'owner', label: 'Owner', blurb: 'Everything + manage the team' },
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
    case 'operator_extra_roles': return `set an operator's extra teams to ${(Array.isArray(d.extras) && d.extras.length) ? d.extras.join(', ') : 'none'}`
    case 'ticket_status':        return `moved a ticket "${d.subject || ''}" ${d.from} → ${d.to}`
    case 'ownership_transferred':return `transferred ownership of ${d.name || 'a community'} to ${d.to || 'a member'}`
    case 'resident_removed':     return `removed ${d.name || 'a resident'} from ${d.community || 'a community'}`
    default:                     return e.action.replace(/_/g, ' ')
  }
}

// Color + label for each audit action, so the Activity feed scans by category.
const AUDIT_META: Record<string, { tone: Tone; label: string }> = {
  entered_community:     { tone: 'info',   label: 'Entered' },
  operator_added:        { tone: 'good',   label: 'Operator +' },
  operator_removed:      { tone: 'bad',    label: 'Operator −' },
  operator_role_changed: { tone: 'warn',   label: 'Role' },
  operator_extra_roles:  { tone: 'warn',   label: 'Role' },
  ticket_status:         { tone: 'accent', label: 'Support' },
  ownership_transferred: { tone: 'warn',   label: 'Ownership' },
  resident_removed:      { tone: 'bad',    label: 'Resident −' },
}
const auditMeta = (action: string): { tone: Tone; label: string } =>
  AUDIT_META[action] || { tone: 'neutral', label: action.replace(/_/g, ' ') }

// Category filters for the Activity feed.
const KNOWN_AUDIT = ['entered_community', 'operator_added', 'operator_removed', 'operator_role_changed', 'operator_extra_roles', 'ticket_status']
const ACTIVITY_FILTERS: { key: string; label: string; tone: Tone; match: (a: string) => boolean }[] = [
  { key: 'all',       label: 'All',          tone: 'neutral', match: () => true },
  { key: 'entered',   label: 'Entered',      tone: 'info',    match: a => a === 'entered_community' },
  { key: 'operators', label: 'Operators',    tone: 'good',    match: a => a === 'operator_added' || a === 'operator_removed' || a === 'operator_role_changed' || a === 'operator_extra_roles' },
  { key: 'support',   label: 'Support',      tone: 'accent',  match: a => a === 'ticket_status' },
  { key: 'other',     label: 'Other',        tone: 'neutral', match: a => !KNOWN_AUDIT.includes(a) },
]

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

// Multi-pick variant of Select for the operator teams: tick two or more teams
// in one dropdown. Picks are a local DRAFT — the panel stays open while you
// toggle (no save, no reload) and only the orange Done button commits the set
// via onCommit. Closing the panel any other way discards the draft. `reduce`
// owns the toggle rules (Owner-exclusive, never empty).
function MultiSelect({ values, options, reduce, onCommit, minWidth, ariaLabel }: {
  values: OperatorRole[]; options: Opt<OperatorRole>[]
  reduce: (cur: OperatorRole[], key: OperatorRole) => OperatorRole[]
  onCommit: (next: OperatorRole[]) => void
  minWidth?: number; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<OperatorRole[] | null>(null)
  const [hover, setHover] = useState<OperatorRole | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); setDraft(null) }
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  const cur = draft ?? values
  const sel = options.filter(o => cur.includes(o.value))
  const done = () => { const next = cur; close(); onCommit(next) }
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: minWidth ?? 148, flexShrink: 0 }}>
      <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          background: C.bg, border: `1px solid ${open ? C.accent : C.border}`, borderRadius: 9, padding: '9px 12px',
          fontSize: 13, fontWeight: 700, color: sel.length === 1 ? (sel[0].color ?? C.text) : C.text, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span>{sel.length ? sel.map(o => o.label).join(' + ') : '—'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: '100%', zIndex: 50,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 5, overflow: 'hidden',
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)' }}>
          {options.map(o => {
            const active = cur.includes(o.value), hot = hover === o.value
            return (
              <button key={o.value} type="button" role="option" aria-selected={active}
                onMouseEnter={() => setHover(o.value)} onMouseLeave={() => setHover(h => h === o.value ? null : h)}
                onClick={() => setDraft(reduce(cur, o.value))}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer',
                  background: active ? C.accentSoft : hot ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none', borderRadius: 7, padding: '8px 11px', whiteSpace: 'nowrap' }}>
                <span aria-hidden="true" style={{ width: 16, height: 16, marginTop: 1, borderRadius: 4, flexShrink: 0,
                  border: `1.5px solid ${active ? (o.color ?? C.accent) : C.border}`,
                  background: active ? (o.color ?? C.accent) : 'transparent',
                  color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: '14px', textAlign: 'center' }}>
                  {active ? '✓' : ''}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: o.color ?? C.text }}>{o.label}</span>
                  {o.hint && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 1 }}>{o.hint}</span>}
                </span>
              </button>
            )
          })}
          <button type="button" onClick={done}
            style={{ width: '100%', marginTop: 5, cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 12px',
              borderRadius: 8, border: 'none', background: C.accent, color: '#fff' }}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}

// Compact paginator in the console palette. Hides itself when everything fits.
function Paginator({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  const btn = (label: string, disabled: boolean, onClick: () => void): React.ReactNode => (
    <button onClick={onClick} disabled={disabled}
      style={{ cursor: disabled ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 12px',
        borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text,
        opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: C.muted }}>{start}–{end} of {total}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn('← Prev', page <= 1, () => onPage(Math.max(1, page - 1)))}
        {btn('Next →', page >= pages, () => onPage(Math.min(pages, page + 1)))}
      </div>
    </div>
  )
}

// Conversation + reply composer for one support ticket — the operator side of
// the two-way thread. Replies go through the platform-reply edge fn (saved
// in-app, photo uploaded, board member emailed).
function SupportThread({ req, onResolve, onReopen, onChanged }: {
  req: PlatformRequest; onResolve: () => void; onReopen: () => void; onChanged: () => void
}) {
  const { messages, loading, reload } = usePlatformThread(req.id)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<{ file: File; url: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { setText(''); setPhoto(null); setErr('') }, [req.id])

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setPhoto({ file: f, url: URL.createObjectURL(f), name: f.name })
    e.target.value = ''
  }
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('Could not read the photo'))
    r.readAsDataURL(file)
  })
  const send = async () => {
    if (!text.trim() && !photo) return
    setSending(true); setErr('')
    try {
      const photoArg = photo ? { base64: await fileToBase64(photo.file), name: photo.name } : null
      const e = await sendPlatformReply({ requestId: req.id, body: text.trim(), photo: photoArg })
      if (e) { setErr(e); return }
      setText(''); setPhoto(null)
      await reload()
      onChanged()
    } catch (e: any) {
      setErr(e?.message || 'Could not send the reply')
    } finally { setSending(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && messages.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
        ) : messages.map(m => {
          const mine = m.authorRole === 'operator'
          const who = mine ? (m.authorName || 'You') : (m.authorName || 'Board')
          const initials = who.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 11, background: mine ? C.accentSoft : 'rgba(42,18,6,0.07)', color: mine ? C.accent : C.text }}>{initials}</div>
              <div style={{ maxWidth: '76%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ background: mine ? C.accent : C.card, color: mine ? '#fff' : C.text,
                  border: mine ? 'none' : `1px solid ${C.border}`, borderRadius: 14,
                  borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4,
                  padding: '10px 13px', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', boxShadow: '0 1px 2px rgba(42,18,6,0.06)' }}>
                  {m.body}
                  {m.attachmentUrl && (
                    <a href={m.attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 8 }}>
                      <img src={m.attachmentUrl} alt={m.attachmentName || 'attachment'} style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4, padding: '0 4px' }}>{who} · {fmtDateTime(m.createdAt)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write your reply…  (Enter to send, Shift+Enter for a new line)"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          style={{ width: '100%', minHeight: 84, resize: 'vertical', boxSizing: 'border-box', background: C.card, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }} />
        {photo && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={photo.url} alt="attachment" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}` }} />
            <span style={{ fontSize: 12.5, color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photo.name}</span>
            <button onClick={() => setPhoto(null)} style={{ flexShrink: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted }}>Remove</button>
          </div>
        )}
        {err && <div style={{ color: C.bad, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>
            📎 Attach photo
            <input type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
          </label>
          <div style={{ flex: 1 }} />
          {req.status === 'resolved' ? (
            <button onClick={onReopen}
              style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 9,
                border: `1px solid ${C.accent}`, background: 'transparent', color: C.accent }}>
              Reopen conversation
            </button>
          ) : (
            <button onClick={onResolve}
              style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 9,
                border: `1px solid ${C.border}`, background: 'transparent', color: C.muted }}>
              Close conversation
            </button>
          )}
          <button onClick={send} disabled={sending || (!text.trim() && !photo)}
            style={{ cursor: sending || (!text.trim() && !photo) ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 9,
              border: `1px solid ${C.accent}`, background: C.accent, color: '#fff', opacity: sending || (!text.trim() && !photo) ? 0.5 : 1 }}>
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Editable monthly AI cap + On/Off kill switch for one community (AI Insights
// tab). $0 = OFF — the edge functions block all AI extraction for that community.
// Commits on blur / Enter; "Turn off" sets $0, "Enable" restores $5.
function CapCell({ row, onSave }: { row: PlatformAiUsage; onSave: (cents: number) => Promise<string | null> }) {
  const off = (row.cap_cents || 0) <= 0
  const [val, setVal] = useState((row.cap_cents / 100).toFixed(2))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal((row.cap_cents / 100).toFixed(2)) }, [row.cap_cents])
  const commit = async (cents: number) => {
    if (cents === row.cap_cents) return
    setBusy(true); await onSave(cents); setBusy(false)
  }
  const commitInput = () => {
    const dollars = Number(val)
    if (!Number.isFinite(dollars) || dollars < 0) { setVal((row.cap_cents / 100).toFixed(2)); return }
    commit(Math.round(dollars * 100))
  }
  if (off) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: C.badSoft, color: C.bad }}>OFF</span>
        <button type="button" disabled={busy} onClick={() => commit(500)}
          style={{ fontSize: 12, fontWeight: 600, color: C.good, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Enable
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: C.muted }}>$</span>
      <input value={val} onChange={e => setVal(e.target.value)} onBlur={commitInput}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode="decimal" disabled={busy}
        style={{ width: 58, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 8px', fontSize: 13, textAlign: 'right' }} />
      <span style={{ color: C.muted, fontSize: 11 }}>/mo</span>
      <button type="button" disabled={busy} onClick={() => commit(0)} title="Turn AI off for this community"
        style={{ fontSize: 11.5, fontWeight: 600, color: C.bad, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px' }}>
        Turn off
      </button>
    </div>
  )
}

export default function PlatformConsole() {
  const {
    isAdmin, myRole, myRoles, communities, requests, operators, audit, aiUsage, aiByKind, aiByCommKind, loading, reload,
    setRequestStatus, enterCommunity, addOperator, removeOperator, setOperatorRole,
    setOperatorExtraRoles, removeCommunity, fetchResidents, removeResident, transferOwnership, setAiCap,
  } = usePlatformConsole()
  const router = useRouter()
  const { profile } = useAuth() || {}
  const [tab, setTab] = useState<Tab>('overview')
  const [entering, setEntering] = useState<string | null>(null)
  // Per-list search queries (communities, subscriptions, roster modal).
  const [commQuery, setCommQuery] = useState('')
  const [subQuery, setSubQuery] = useState('')
  const [rosterQuery, setRosterQuery] = useState('')
  // Pagination for the communities + subscriptions tables (used in Overview and
  // in their own tabs — the lists are long, so page through 8 at a time).
  const PAGE_SIZE = 8           // support inbox
  const LIST_PAGE_SIZE = 9      // communities + subscriptions tabs
  const OVERVIEW_PREVIEW = 5    // shorter preview of those lists in the Overview
  const [commPage, setCommPage] = useState(1)
  const [subsPage, setSubsPage] = useState(1)
  const [aiPage, setAiPage] = useState(1)
  const [aiExpanded, setAiExpanded] = useState<string | null>(null) // community_id whose AI breakdown is open
  const [supportPage, setSupportPage] = useState(1)
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null)
  // Operator → community "new message" composer.
  const [showCompose, setShowCompose] = useState(false)
  const [newCommunity, setNewCommunity] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newSending, setNewSending] = useState(false)
  const [newErr, setNewErr] = useState('')
  const ACT_PAGE_SIZE = 12
  const [activityPage, setActivityPage] = useState(1)
  const [activityCat, setActivityCat] = useState('all')
  // Row a user clicked from elsewhere (e.g. Overview) — highlighted in its tab so
  // it's easy to spot after the jump. subDetail drives the subscription pop-up.
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [subDetail, setSubDetail] = useState<(typeof communities)[number] | null>(null)
  // Auto-clear the row highlight after a moment so it pulses to draw the eye on
  // arrival, then fades — never a permanently highlighted "stuck" row.
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(t)
  }, [highlightId])
  const isOwner = myRole === 'owner'
  // Role-scoped views (mock parity). An operator can hold several teams — what
  // they see is the UNION of their teams' tabs (the DB walls enforce the same
  // set server-side). Unknown/legacy role → treat as full access (owner) so an
  // admin never lands on a blank console. Money lives only in the Overview +
  // Subscriptions tabs, so a role set without owner/billing never shows revenue.
  const roleSet: OperatorRole[] = (myRoles && myRoles.length ? myRoles : [myRole as OperatorRole])
    .filter((r): r is OperatorRole => !!r && !!ROLE_TABS[r])
  const effectiveRoles: OperatorRole[] = roleSet.length ? roleSet : ['owner']
  const allowedTabs = TABS.map(t => t.key)
    .filter(k => effectiveRoles.some(r => ROLE_TABS[r].includes(k)))
  const curTab: Tab = allowedTabs.includes(tab) ? tab : allowedTabs[0]
  const canEnter = effectiveRoles.some(r => r !== 'support')
  // Ownership reassignment is the operator backstop for orphaned communities —
  // owner/operator teams only (the DB function enforces the same rule).
  const canTransfer = effectiveRoles.includes('owner') || effectiveRoles.includes('operator')
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
  // Transfer-ownership picker inside the community pop-up. Choices are the
  // community's members who hold an account (profile_id), minus the current owner.
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferChoices, setTransferChoices] = useState<PlatformResident[]>([])
  const [transferSel, setTransferSel] = useState('')
  const [transferStepDown, setTransferStepDown] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferErr, setTransferErr] = useState('')
  useEffect(() => {
    // Opening a different community resets the picker.
    setTransferOpen(false); setTransferSel(''); setTransferErr(''); setTransferChoices([]); setTransferStepDown(false)
  }, [subDetail?.id])

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
  const [newTeams, setNewTeams] = useState<OperatorRole[]>(['operator'])
  const [opMsg, setOpMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)
  const [opBusy, setOpBusy] = useState(false)

  // One team set per operator, picked in a single multi-select. Owner is
  // exclusive (it's already everything): picking it clears the teams, picking
  // a team drops Owner. A set can never go empty.
  const toggleTeam = (cur: OperatorRole[], key: OperatorRole): OperatorRole[] => {
    if (key === 'owner') return ['owner']
    const next = cur.includes(key) ? cur.filter(r => r !== key) : [...cur.filter(r => r !== 'owner'), key]
    return next.length ? next : cur
  }
  // The DB stores a primary role + extras; derive them from the picked set.
  const splitTeams = (teams: OperatorRole[]): { primary: OperatorRole; extras: OperatorRole[] } => {
    const primary = (['owner', 'operator', 'billing', 'support'] as OperatorRole[]).find(r => teams.includes(r)) || 'operator'
    return { primary, extras: primary === 'owner' ? [] : teams.filter(t => t !== primary) }
  }
  const teamLabels = (teams: OperatorRole[]) =>
    teams.map(t => ROLES.find(r => r.key === t)?.label || t).join(' + ')

  const onAddOperator = async () => {
    const email = newEmail.trim()
    if (!email) return
    setOpBusy(true); setOpMsg(null)
    const { primary, extras } = splitTeams(newTeams)
    const err = await addOperator(email, primary, extras)
    setOpBusy(false)
    if (err) setOpMsg({ kind: 'err', text: err })
    else {
      setOpMsg({ kind: 'ok', text: `Added ${email} as ${teamLabels(newTeams)}.` })
      setNewEmail(''); setNewTeams(['operator'])
    }
  }
  // Apply an operator's new team set when their dropdown's Done is clicked.
  const commitRowTeams = async (o: PlatformOperator, next: OperatorRole[]) => {
    setOpMsg(null)
    const cur: OperatorRole[] = [o.role, ...o.extra_roles.filter(r => r !== o.role)]
    if (next.length === cur.length && next.every(r => cur.includes(r))) return
    const { primary, extras } = splitTeams(next)
    // Self-demotion is one click away from locking yourself out of this very
    // tab (the DB only protects the LAST owner) — make it deliberate.
    if (o.profile_id === profile?.id && o.role === 'owner' && primary !== 'owner') {
      if (!window.confirm(`Change YOUR OWN role to ${teamLabels(next)}? You'll immediately lose Owner access — including this Operators tab — and another Owner (or a SQL fix) will have to restore you.`)) return
    }
    let err: string | null = null
    if (primary !== o.role) err = await setOperatorRole(o.profile_id, primary)
    if (!err) err = await setOperatorExtraRoles(o.profile_id, extras)
    if (err) setOpMsg({ kind: 'err', text: err })
    else setOpMsg({ kind: 'ok', text: `${o.name} is now ${teamLabels(next)}.` })
  }
  const onRemoveOperator = async (id: string, name: string) => {
    const msg = id === profile?.id
      ? 'Remove YOURSELF as a Residente operator? You lose all Platform Console access and another Owner has to add you back.'
      : `Remove ${name} as a Residente operator?`
    if (typeof window !== 'undefined' && !window.confirm(msg)) return
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
        /* Tabs: only the straight orange underline marks the active tab —
           never the browser's rounded focus ring (outline or box-shadow). */
        .plat-tab:focus, .plat-tab:focus-visible { outline: none; box-shadow: none; }
        /* KPI tiles: a fixed 4-column grid so the 8 boxes line up as a clean
           4×2 block instead of a ragged auto-fit row. */
        .plat-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
        @media (max-width: 1000px) { .plat-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 680px) { .plat-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 460px) { .plat-stats { grid-template-columns: 1fr; } }
        /* Support inbox: a two-pane mail layout — list on the left, the selected
           message's conversation on the right. Stacks on narrow screens. */
        .plat-mail { display: grid; grid-template-columns: 300px 1fr; gap: 18px; margin-top: 8px; }
        .plat-mail-list { border: 1px solid rgba(42,18,6,0.14); border-radius: 12px; overflow: hidden auto; max-height: 520px; }
        .plat-mail-read { border: 1px solid rgba(42,18,6,0.14); border-radius: 12px; padding: 18px 20px; min-height: 240px; }
        @media (max-width: 760px) { .plat-mail { grid-template-columns: 1fr; } .plat-mail-list { max-height: 320px; } }
        /* Pulsing red count on the Support tab — matches the admin nav badge. */
        .plat-badge {
          margin-left: 7px; display: inline-block; min-width: 17px; text-align: center;
          font-size: 10px; font-weight: 800; line-height: 16px; color: #fff;
          background: #E5484D; border-radius: 999px; padding: 0 5px; vertical-align: middle;
          animation: platBadgePulse 1.6s ease-out infinite;
        }
        @keyframes platBadgePulse {
          0%   { box-shadow: 0 0 0 0 rgba(229, 72, 77, 0.5); }
          70%  { box-shadow: 0 0 0 5px rgba(229, 72, 77, 0); }
          100% { box-shadow: 0 0 0 0 rgba(229, 72, 77, 0); }
        }
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

  // Notification count = tickets awaiting an operator (status 'open'). Once you
  // reply the ticket moves to 'in_progress' and drops off the count until the
  // board replies back (a board reply flips it to 'open' again — DB trigger).
  const openCount = requests.filter(r => r.status === 'open').length
  const totalResidents = communities.reduce((s, c) => s + Number(c.resident_count || 0), 0)
  const trials = communities.filter(c => c.subscription_status === 'trial').length
  const paying = communities.filter(c => communityMonthlyCents(c) > 0)
  const mrrCents = communities.reduce((s, c) => s + (c.subscription_status === 'active' ? communityMonthlyCents(c) : 0), 0)
  const activeCount = communities.filter(c => c.subscription_status === 'active').length
  const pastDueCount = communities.filter(c => c.subscription_status === 'past_due').length

  // Signups this calendar month (a real proxy for landing-page conversions), and
  // month-over-month growth: this month's new communities vs everything before.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const newThisMonth = communities.filter(c => c.created_at && new Date(c.created_at) >= monthStart).length
  const priorCount = communities.length - newThisMonth
  const growthPct = priorCount > 0 ? Math.round((newThisMonth / priorCount) * 100) : (newThisMonth > 0 ? 100 : 0)

  // Search-filtered views (the lists stay alphabetical from the hook).
  const filteredCommunities = communities.filter(c =>
    matchesQuery(commQuery, [c.name, c.location, c.created_by_name, c.created_by_email, c.owner_name, c.owner_email, c.join_code, c.plan, c.subscription_status]))
  const filteredSubs = communities.filter(c =>
    matchesQuery(subQuery, [c.name, c.plan, c.subscription_status]))
  const filteredRoster = roster.filter(r =>
    matchesQuery(rosterQuery, [r.full_name, r.email, r.unit_number, r.board_position]))

  // Clamp each page so searching (or a shorter list) never strands an empty page,
  // then slice to the visible rows.
  const supportPageC = Math.min(supportPage, Math.max(1, Math.ceil(requests.length / PAGE_SIZE)))
  const pagedRequests = requests.slice((supportPageC - 1) * PAGE_SIZE, supportPageC * PAGE_SIZE)
  const activeFilter = ACTIVITY_FILTERS.find(f => f.key === activityCat) || ACTIVITY_FILTERS[0]
  const filteredAudit = audit.filter(e => activeFilter.match(e.action))
  const actPageC = Math.min(activityPage, Math.max(1, Math.ceil(filteredAudit.length / ACT_PAGE_SIZE)))
  const pagedAudit = filteredAudit.slice((actPageC - 1) * ACT_PAGE_SIZE, actPageC * ACT_PAGE_SIZE)

  const onEnter = async (id: string) => {
    setEntering(id)
    const ok = await enterCommunity(id)
    if (ok) router.push('/admin')
    else setEntering(null)
  }

  const openTransfer = async () => {
    if (!subDetail) return
    setTransferOpen(true); setTransferErr(''); setTransferSel(''); setTransferLoading(true)
    const all = await fetchResidents(subDetail.id)
    // One entry per account — a member with several roster rows (multi-role)
    // must appear once, keeping their board row so the label shows the seat.
    const seen = new Set<string>()
    const deduped = [...all]
      .sort((a, b) => Number(!!b.is_board) - Number(!!a.is_board))
      .filter(r => {
        if (!r.profile_id || r.profile_id === subDetail.owner_profile_id || seen.has(r.profile_id)) return false
        seen.add(r.profile_id)
        return true
      })
      .sort((a, b) => (a.full_name || '~').localeCompare(b.full_name || '~'))
    setTransferChoices(deduped)
    setTransferLoading(false)
  }
  const doTransfer = async () => {
    if (!subDetail || !transferSel) return
    const who = transferChoices.find(r => r.profile_id === transferSel)
    const stepDownNote = transferStepDown ? ' The previous owner steps down to a regular resident.' : ''
    if (!window.confirm(`Make ${who?.full_name || 'this member'} the owner of ${subDetail.name || 'this community'}? They get full admin access.${stepDownNote}`)) return
    setTransferBusy(true); setTransferErr('')
    const err = await transferOwnership(subDetail.id, transferSel, transferStepDown)
    setTransferBusy(false)
    if (err) { setTransferErr(err); return }
    setTransferOpen(false); setSubDetail(null)
  }

  // Jump from a KPI tile / triage chip to the first community with a given
  // subscription status: open the Subscriptions tab, highlight that row, and pop
  // its detail modal so the operator lands right on the one that needs them.
  const jumpToStatus = (status: string) => {
    const hit = communities.find(c => (c.subscription_status || 'active') === status)
    setTab('subscriptions')
    if (hit) { setHighlightId(hit.id); setSubDetail(hit) }
  }

  // A KPI tile. `tone` colors the number + a faint background wash so the
  // meaningful figures (MRR, past due, open tickets) carry their own color.
  // `prefix` lets MRR show a "$", `suffix` lets growth show a "%". When `tone`
  // is a problem color (warn/bad) the wash only shows once the value is non-zero,
  // so a clean console stays calm.
  const stat = (label: string, val: number, tone: Tone = 'neutral', prefix = '', suffix = '', onClick?: () => void) => {
    const lit = tone !== 'neutral' && val > 0
    const col = lit ? toneColor[tone] : C.text
    return (
      <div key={label} onClick={onClick} title={onClick ? `View ${label.toLowerCase()}` : undefined}
        style={{ ...card, padding: '18px 20px', cursor: onClick ? 'pointer' : 'default',
          background: lit ? toneSoft[tone] : C.card, borderColor: lit ? 'transparent' : C.border }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: col, lineHeight: 1 }}>{prefix}{val.toLocaleString('en-US')}{suffix}</div>
        <div style={{ color: C.muted, fontSize: 12.5, marginTop: 7, fontWeight: 600 }}>{label}</div>
      </div>
    )
  }

  const statsGrid = (
    <div className="plat-stats" style={{ marginBottom: 18 }}>
      {stat('Communities', communities.length)}
      {stat('MRR / mo', Math.round(mrrCents / 100), 'good', '$')}
      {stat('Active subs', activeCount, 'good')}
      {stat('Trials', trials, 'info', '', '', trials > 0 ? () => jumpToStatus('trial') : undefined)}
      {stat('Past due', pastDueCount, 'bad', '', '', pastDueCount > 0 ? () => jumpToStatus('past_due') : undefined)}
      {stat('Open tickets', openCount, 'accent')}
      {stat('Support messages', requests.length, 'info')}
      {stat('Total residents', totalResidents)}
      {stat('Growth / mo', growthPct, growthPct > 0 ? 'good' : 'neutral', '', '%')}
      {stat('New this month', newThisMonth, 'info')}
    </div>
  )

  const communitiesSection = (inOverview: boolean) => {
   const size = inOverview ? OVERVIEW_PREVIEW : LIST_PAGE_SIZE
   const commPageC = Math.min(commPage, Math.max(1, Math.ceil(filteredCommunities.length / size)))
   const pagedCommunities = filteredCommunities.slice((commPageC - 1) * size, commPageC * size)
   return (
    <section style={{ ...card, marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Communities</h2>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
        {inOverview ? <>Click a row to open the full <strong style={{ color: C.accent }}>Communities</strong> tab.</> : <>Click <strong style={{ color: C.accent }}>Manage</strong> to drop into a community and run it as an operator.</>}
      </p>
      {communities.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5 }}>No communities yet.</div>
      ) : (
        <>
        <input value={commQuery} onChange={e => { setCommQuery(e.target.value); setCommPage(1) }}
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
              {pagedCommunities.map(c => (
                <tr key={c.id} className={c.subscription_status === 'past_due' ? 'is-pastdue' : undefined}
                  onClick={() => { if (inOverview) setTab('communities'); setHighlightId(c.id); setSubDetail(c) }}
                  style={{ cursor: 'pointer',
                    ...(!inOverview && highlightId === c.id ? { background: C.accentSoft, boxShadow: `inset 3px 0 0 ${C.accent}` } : {}) }}>
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
                        <button onClick={(e) => { e.stopPropagation(); onEnter(c.id) }} disabled={entering === c.id}
                          title="Drop into this community's admin as an operator — you see and edit everything its board does. Recorded in Activity."
                          style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, flexShrink: 0,
                            border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, whiteSpace: 'nowrap' }}>
                          {entering === c.id ? 'Entering…' : 'Manage →'}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openRoster(c.id, c.name) }}
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
                            <button onClick={(e) => { e.stopPropagation(); open() }}
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
          <Paginator page={commPageC} pageSize={size} total={filteredCommunities.length} onPage={setCommPage} />
        </div>
        )}
        </>
      )}
    </section>
   )
  }

  const subscriptionsSection = (inOverview: boolean) => {
   const size = inOverview ? OVERVIEW_PREVIEW : LIST_PAGE_SIZE
   const subsPageC = Math.min(subsPage, Math.max(1, Math.ceil(filteredSubs.length / size)))
   const pagedSubs = filteredSubs.slice((subsPageC - 1) * size, subsPageC * size)
   return (
    <section style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Subscriptions</h2>
        <span style={{ fontSize: 13, color: C.muted }}>
          MRR <strong style={{ color: C.accent }}>{fmtMoney(mrrCents)}/mo</strong> · {activeCount} active · {paying.length} on a paid plan
          {pastDueCount > 0 && <span style={{ color: C.bad, fontWeight: 700 }}> · {pastDueCount} past due</span>}
        </span>
      </div>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
        {inOverview ? <>Click a row to open the full <strong style={{ color: C.accent }}>Subscriptions</strong> tab.</> : <>Every community&apos;s plan, status, and monthly amount. MRR counts active subscriptions only.</>}
      </p>
      {communities.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5 }}>No communities yet.</div>
      ) : (
        <>
        <input value={subQuery} onChange={e => { setSubQuery(e.target.value); setSubsPage(1) }}
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
              {pagedSubs.map(c => {
                const monthly = communityMonthlyCents(c)
                return (
                  <tr key={c.id} className={c.subscription_status === 'past_due' ? 'is-pastdue' : undefined}
                    onClick={() => { if (inOverview) setTab('subscriptions'); setHighlightId(c.id); setSubDetail(c) }}
                    style={{ cursor: 'pointer',
                      ...(!inOverview && highlightId === c.id ? { background: C.accentSoft, boxShadow: `inset 3px 0 0 ${C.accent}` } : {}) }}>
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
          <Paginator page={subsPageC} pageSize={size} total={filteredSubs.length} onPage={setSubsPage} />
        </div>
        )}
        </>
      )}
    </section>
   )
  }

  // Resolve a request's community name from its id; falls back to the sender.
  const reqCommunity = (id: string | null) => communities.find(c => c.id === id)?.name || null
  // The message shown in the reading pane — the clicked one, else the first.
  const selectedReq = requests.find(r => r.id === selectedReqId) || pagedRequests[0] || null

  const sendNewMessage = async () => {
    if (!profile?.id || !newCommunity || !newSubject.trim() || !newBody.trim()) return
    setNewSending(true); setNewErr('')
    const e = await openCommunityThread({
      communityId: newCommunity, subject: newSubject.trim(), body: newBody.trim(),
      operatorId: profile.id, operatorName: profile.full_name ?? null, operatorEmail: profile.email ?? null,
    })
    setNewSending(false)
    if (e) { setNewErr(e); return }
    setNewSubject(''); setNewBody(''); setNewCommunity(''); setShowCompose(false)
    await reload()
  }

  const supportSection = (
    <section style={card}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        Support inbox {openCount > 0 && <span style={{ color: C.accent }}>· {openCount} open</span>}
      </h2>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 12 }}>Messages from community boards — pick one to read the full conversation.</p>

      {/* New message — operator opens a thread with a community */}
      {!showCompose ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={() => setShowCompose(true)}
            style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 15px', borderRadius: 9,
              border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent }}>
            ✎ New message to a community
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, background: C.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>New message to a community</span>
              <button onClick={() => setShowCompose(false)} aria-label="Cancel"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted, fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <Select<string> value={newCommunity} onChange={setNewCommunity} ariaLabel="Community" width={220}
                options={[{ value: '', label: communities.length ? 'Pick a community…' : 'No communities' }, ...communities.map(c => ({ value: c.id, label: c.name || 'Untitled' }))]} />
              <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="Subject"
                style={{ flex: 1, minWidth: 180, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
            </div>
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Write your message…  (Enter to send, Shift+Enter for a new line)"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNewMessage() } }}
              style={{ width: '100%', minHeight: 72, resize: 'vertical', boxSizing: 'border-box', background: C.bg, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              {newErr && <span style={{ color: C.bad, fontSize: 12.5 }}>{newErr}</span>}
              <div style={{ flex: 1 }} />
              <button onClick={sendNewMessage} disabled={newSending || !newCommunity || !newSubject.trim() || !newBody.trim()}
                style={{ cursor: (newSending || !newCommunity || !newSubject.trim() || !newBody.trim()) ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 9,
                  border: `1px solid ${C.accent}`, background: C.accent, color: '#fff', opacity: (newSending || !newCommunity || !newSubject.trim() || !newBody.trim()) ? 0.5 : 1 }}>
                {newSending ? 'Sending…' : 'Send →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5, marginTop: 12 }}>No support requests yet.</div>
      ) : (
        <div className="plat-mail">
          {/* LEFT — message list */}
          <div className="plat-mail-list">
            {pagedRequests.map(r => {
              const active = selectedReq?.id === r.id
              const cname = reqCommunity(r.from_community_id) || r.from_name || 'Unknown community'
              const dot = r.status === 'resolved' ? C.good : r.status === 'in_progress' ? C.info : C.accent
              return (
                <button key={r.id} onClick={() => setSelectedReqId(r.id)}
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', borderRadius: 0,
                    border: 'none', borderLeft: `3px solid ${active ? C.accent : 'transparent'}`,
                    borderBottom: `1px solid ${C.border}`, background: active ? C.accentSoft : 'transparent', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cname}</span>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dot }} />
                  </div>
                  <div style={{ fontSize: 13, color: C.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject}</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{fmtDate(r.created_at)}</div>
                </button>
              )
            })}
            <div style={{ padding: '4px 12px' }}>
              <Paginator page={supportPageC} pageSize={PAGE_SIZE} total={requests.length} onPage={setSupportPage} />
            </div>
          </div>
          {/* RIGHT — reading pane (the conversation) */}
          <div className="plat-mail-read">
            {selectedReq ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{selectedReq.subject}</h3>
                  <button onClick={() => setRequestStatus(selectedReq.id, STATUS_NEXT[selectedReq.status])} title="Click to advance status" style={statusStyle(selectedReq.status)}>
                    {selectedReq.status === 'in_progress' ? 'in progress' : selectedReq.status}
                  </button>
                </div>
                <div style={{ margin: '6px 0 16px' }}>
                  <div style={{ color: C.muted, fontSize: 12.5 }}>
                    {reqCommunity(selectedReq.from_community_id) && <><strong style={{ color: C.text }}>{reqCommunity(selectedReq.from_community_id)}</strong> · </>}
                    {new Date(selectedReq.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  {selectedReq.from_email && (
                    <div style={{ color: C.muted, fontSize: 12.5, marginTop: 6 }}>{selectedReq.from_email}</div>
                  )}
                </div>
                <SupportThread
                  req={selectedReq}
                  onResolve={() => setRequestStatus(selectedReq.id, 'resolved')}
                  onReopen={() => setRequestStatus(selectedReq.id, 'open')}
                  onChanged={reload}
                />
              </>
            ) : (
              <div style={{ color: C.muted, fontSize: 13.5, padding: 20, textAlign: 'center' }}>Select a message to read it.</div>
            )}
          </div>
        </div>
      )}
    </section>
  )

  // Triage strip for the Overview: surfaces the two things an operator must act
  // on — communities behind on payment and unresolved support — as colored
  // chips. Hidden entirely when there's nothing to do, so a healthy console
  // doesn't carry a warning it doesn't need.
  const attentionItems: { label: string; tone: Tone; onClick: () => void }[] = []
  if (pastDueCount > 0) attentionItems.push({ label: `${pastDueCount} past due`, tone: 'bad', onClick: () => jumpToStatus('past_due') })
  if (openCount > 0) attentionItems.push({ label: `${openCount} open ticket${openCount > 1 ? 's' : ''}`, tone: 'accent', onClick: () => setTab('support') })
  if (trials > 0) attentionItems.push({ label: `${trials} on trial`, tone: 'info', onClick: () => jumpToStatus('trial') })
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
          return (
            <button key={t.key} className="plat-tab" onClick={() => setTab(t.key)}
              style={{
                cursor: 'pointer', background: 'none', border: 'none', outline: 'none', borderRadius: 0, padding: '10px 16px', fontSize: 14,
                fontWeight: active ? 700 : 500, color: active ? C.accent : C.muted,
                borderBottom: `2px solid ${active ? C.accent : 'transparent'}`, marginBottom: -1,
              }}>
              {t.label}
              {t.key === 'support' && openCount > 0 && <span className="plat-badge">{openCount}</span>}
              {t.key === 'pending' && openCount > 0 && <span className="plat-badge">{openCount}</span>}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW — everything on one page */}
      {curTab === 'overview' && (<>{attentionBanner}{statsGrid}{subscriptionsSection(true)}{communitiesSection(true)}</>)}

      {curTab === 'pending' && <PendingQueue />}

      {/* COMMUNITIES */}
      {curTab === 'communities' && communitiesSection(false)}

      {/* SUBSCRIPTIONS */}
      {curTab === 'subscriptions' && subscriptionsSection(false)}

      {/* AI INSIGHTS — document-reader usage + the per-community cost cap / kill switch */}
      {curTab === 'ai-insights' && (() => {
        const monthTotal = aiUsage.reduce((s, r) => s + (Number(r.month_cost_cents) || 0), 0)
        const monthCalls = aiUsage.reduce((s, r) => s + (Number(r.month_calls) || 0), 0)
        const activeCount = aiUsage.filter(r => (Number(r.month_calls) || 0) > 0).length
        const offCount = aiUsage.filter(r => (Number(r.cap_cents) || 0) <= 0).length
        const kindMonthTotal = aiByKind.reduce((s, r) => s + (Number(r.month_cost_cents) || 0), 0)
        // Per-community breakdown by feature (this month) for the expandable drill-down.
        const byComm: Record<string, any[]> = {}
        for (const k of (aiByCommKind as any[])) {
          if ((Number(k.month_calls) || 0) > 0) (byComm[k.community_id] ||= []).push(k)
        }
        // Paginate the per-community table so a large roster of communities stays readable.
        const AI_SIZE = LIST_PAGE_SIZE
        const aiPageC = Math.min(aiPage, Math.max(1, Math.ceil(aiUsage.length / AI_SIZE)))
        const pagedAi = aiUsage.slice((aiPageC - 1) * AI_SIZE, aiPageC * AI_SIZE)
        return (
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>AI Insights</h2>
            <span style={{ color: C.muted, fontSize: 12 }}>Document-reader usage + the monthly cost cap, per community.</span>
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, margin: '4px 0 16px' }}>
            The AI readers (roster, balances, budget, insurance, rules) bill per document. Each community has a monthly cap; once it&apos;s hit, AI pauses for that community until next month. Set a cap to <strong>$0</strong> to turn AI off entirely.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
            {[
              { label: 'This month', val: fmtCents(monthTotal), sub: `${monthCalls} call${monthCalls === 1 ? '' : 's'}`, col: C.accent },
              { label: 'Using AI', val: String(activeCount), sub: `of ${aiUsage.length} communities`, col: C.text },
              { label: 'Turned off', val: String(offCount), sub: offCount === 1 ? 'community' : 'communities', col: offCount > 0 ? C.bad : C.muted },
            ].map(k => (
              <div key={k.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, fontWeight: 700 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.col, lineHeight: 1.15, marginTop: 4 }}>{k.val}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Where AI is used — spend by document type this month, highest first.
              Answers "what are they spending AI on" at a glance. */}
          {aiByKind.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, fontWeight: 700, marginBottom: 10 }}>Where AI is used — this month</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aiByKind.map(r => {
                  const spent = Number(r.month_cost_cents) || 0
                  const pct = kindMonthTotal > 0 ? Math.round((spent / kindMonthTotal) * 100) : 0
                  return (
                    <div key={`${r.fn}|${r.kind}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 170, flexShrink: 0, fontSize: 13, fontWeight: 600 }}>{aiFeatureLabel(r.fn, r.kind)}</div>
                      <div style={{ flex: 1, minWidth: 60, height: 8, background: C.bg, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: C.accent }} />
                      </div>
                      <div style={{ width: 168, flexShrink: 0, textAlign: 'right', fontSize: 12.5, color: C.muted }}>
                        <span style={{ color: C.text, fontWeight: 700 }}>{fmtCents(spent)}</span> · {r.month_calls} call{Number(r.month_calls) === 1 ? '' : 's'} · {pct}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {aiUsage.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, padding: '12px 0' }}>
              No AI usage yet. (If this stays empty after communities use the readers, run <code>supabase/ai-usage.sql</code>.)
            </div>
          ) : (
          <>
          <div style={{ overflowX: 'auto' }}>
            <table className="plat-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Community</th>
                  <th style={th}>This month</th>
                  <th style={th}>Monthly cap</th>
                  <th style={th}>Used</th>
                  <th style={th}>Lifetime</th>
                  <th style={th}>Last used</th>
                </tr>
              </thead>
              <tbody>
                {pagedAi.map(r => {
                  const cap = Number(r.cap_cents) || 0
                  const spent = Number(r.month_cost_cents) || 0
                  const pct = cap > 0 ? Math.min(999, Math.round((spent / cap) * 100)) : null
                  const tone = cap <= 0 ? C.bad : pct == null ? C.muted : pct >= 100 ? C.bad : pct >= 80 ? C.warn : C.good
                  const detail = byComm[r.community_id] || []
                  const canExpand = detail.length > 0
                  const isOpen = aiExpanded === r.community_id
                  return (
                    <Fragment key={r.community_id}>
                    <tr>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {canExpand ? (
                          <button type="button" onClick={() => setAiExpanded(isOpen ? null : r.community_id)}
                            title="Show what this community spent AI on"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 700, color: C.text, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: C.muted, fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                            {r.name || '—'}
                          </button>
                        ) : (r.name || '—')}
                        {r.plan ? <span style={{ color: C.muted, fontWeight: 500, fontSize: 12 }}> · {r.plan}</span> : null}
                      </td>
                      <td style={td}>
                        {fmtCents(spent)}
                        <span style={{ color: C.muted, fontSize: 12 }}> · {r.month_calls} call{Number(r.month_calls) === 1 ? '' : 's'}</span>
                      </td>
                      <td style={td}><CapCell row={r} onSave={(c) => setAiCap(r.community_id, c)} /></td>
                      <td style={td}>
                        {cap <= 0
                          ? <span style={{ color: C.bad, fontWeight: 600 }}>off</span>
                          : <span style={{ fontWeight: 700, color: tone }}>{pct}%</span>}
                      </td>
                      <td style={{ ...td, color: C.muted }}>
                        {fmtCents(Number(r.total_cost_cents) || 0)}<span style={{ fontSize: 12 }}> · {r.total_calls}</span>
                      </td>
                      <td style={{ ...td, color: C.muted }}>{r.last_used_at ? fmtDate(r.last_used_at) : '—'}</td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr>
                        <td colSpan={6} style={{ ...td, background: C.bg, padding: '4px 12px 14px' }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, fontWeight: 700, margin: '6px 0 8px' }}>What they used AI on — this month</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {detail.map((d: any) => {
                              const ds = Number(d.month_cost_cents) || 0
                              const dpct = spent > 0 ? Math.round((ds / spent) * 100) : 0
                              return (
                                <div key={`${d.fn}|${d.kind}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <div style={{ width: 170, flexShrink: 0, fontSize: 12.5, fontWeight: 600 }}>{aiFeatureLabel(d.fn, d.kind)}</div>
                                  <div style={{ flex: 1, minWidth: 50, height: 6, background: '#fff', borderRadius: 3, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                                    <div style={{ height: '100%', width: `${dpct}%`, background: C.accent }} />
                                  </div>
                                  <div style={{ width: 168, flexShrink: 0, textAlign: 'right', fontSize: 12, color: C.muted }}>
                                    <span style={{ color: C.text, fontWeight: 700 }}>{fmtCents(ds)}</span> · {d.month_calls} doc{Number(d.month_calls) === 1 ? '' : 's'} · {dpct}%
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginator page={aiPageC} pageSize={AI_SIZE} total={aiUsage.length} onPage={setAiPage} />
          </>
          )}
        </section>
        )
      })()}

      {/* SUPPORT */}
      {curTab === 'support' && supportSection}

      {/* OPERATORS */}
      {curTab === 'operators' && (
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Residente Operators</h2>
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
                {/* Right-side controls: one multi-select holds the whole team
                    set (tick two or more; Owner is exclusive), plus Remove.
                    Non-owners just see the teams as pills. */}
                {editable ? (
                  <>
                    <MultiSelect values={[o.role, ...o.extra_roles.filter(r => r !== o.role)]}
                      reduce={toggleTeam} onCommit={next => commitRowTeams(o, next)} options={ROLE_OPTIONS}
                      ariaLabel={`Teams for ${o.name}`} />
                    <button onClick={() => onRemoveOperator(o.profile_id, o.name)}
                      style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, whiteSpace: 'nowrap' }}>
                      Remove
                    </button>
                  </>
                ) : (
                  [o.role, ...o.extra_roles.filter(r => r !== o.role)].map(t => (
                    <span key={t} style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, background: roleBg(t), color: roleColor(t) }}>
                      {ROLES.find(r => r.key === t)?.label || t}
                    </span>
                  ))
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
                <MultiSelect values={newTeams} reduce={toggleTeam} onCommit={setNewTeams}
                  options={ROLE_OPTIONS} minWidth={150} ariaLabel="Teams for new operator" />
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
          <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 12 }}>Every operator action on the platform, newest first.</p>

          {/* Category filter chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            {ACTIVITY_FILTERS.map(f => {
              const count = f.key === 'all' ? audit.length : audit.filter(e => f.match(e.action)).length
              if (f.key !== 'all' && count === 0) return null
              const on = activityCat === f.key
              return (
                <button key={f.key} onClick={() => { setActivityCat(f.key); setActivityPage(1) }}
                  style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                    border: `1px solid ${on ? toneColor[f.tone] : C.border}`,
                    background: on ? toneSoft[f.tone] : 'transparent', color: on ? toneColor[f.tone] : C.muted }}>
                  {f.label} <span style={{ opacity: 0.7 }}>· {count}</span>
                </button>
              )
            })}
          </div>

          {filteredAudit.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13.5, marginTop: 10 }}>
              {activityCat === 'all' ? 'No activity recorded yet.' : 'No activity in this category.'}
            </div>
          ) : (
            <>
            {pagedAudit.map(e => {
              const meta = auditMeta(e.action)
              return (
                <div key={e.id} style={{ borderTop: `1px solid ${C.border}`, padding: '12px 2px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center', minWidth: 104,
                    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', padding: '5px 11px', borderRadius: 999,
                    background: toneSoft[meta.tone], color: toneColor[meta.tone] }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: toneColor[meta.tone] }} />
                    {meta.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 200, fontSize: 13.5 }}>
                    <strong style={{ color: C.text }}>{e.actor_name || 'An operator'}</strong>
                    <span style={{ color: C.muted }}> {auditText(e)}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</div>
                </div>
              )
            })}
            <Paginator page={actPageC} pageSize={ACT_PAGE_SIZE} total={filteredAudit.length} onPage={setActivityPage} />
            </>
          )}
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

      {/* Community / subscription detail pop-up — opened by clicking any row in
          the Communities or Subscriptions tables. */}
      {subDetail && (
        <div onClick={() => setSubDetail(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,10,16,0.6)', display: 'grid', placeItems: 'center', padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{subDetail.name || 'Community'}</h2>
                <div style={{ color: C.muted, fontSize: 12.5, marginTop: 2 }}>{subDetail.location || 'Community details'}</div>
              </div>
              <button onClick={() => setSubDetail(null)} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 26, cursor: 'pointer', color: C.muted, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Owner</span>
                <span style={{ fontWeight: 700, textAlign: 'right' }}>
                  {subDetail.owner_name || subDetail.created_by_name || '—'}
                  {(subDetail.owner_email || subDetail.created_by_email) && <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted }}>{subDetail.owner_email || subDetail.created_by_email}</span>}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Created by</span>
                <span style={{ fontWeight: 700, textAlign: 'right' }}>
                  {subDetail.created_by_name || '—'}
                  {subDetail.created_by_email && <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted }}>{subDetail.created_by_email}</span>}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Plan</span>
                <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{subDetail.plan || 'free'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Status</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize',
                  background: subStatusBg(subDetail.subscription_status), color: subStatusColor(subDetail.subscription_status) }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: subStatusColor(subDetail.subscription_status) }} />
                  {subDetail.subscription_status || 'active'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Residents</span>
                <span style={{ fontWeight: 700 }}>{subDetail.resident_count ?? '—'}{subDetail.board_count != null ? <span style={{ fontWeight: 400, color: C.muted }}> · {subDetail.board_count} board</span> : null}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Homes</span>
                <span style={{ fontWeight: 700 }}>{subDetail.home_count ?? subDetail.unit_count ?? '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Monthly</span>
                <span style={{ fontWeight: 700 }}>{communityMonthlyCents(subDetail) > 0 ? `${fmtMoney(communityMonthlyCents(subDetail))}/mo` : 'Free'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Join code</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', letterSpacing: 1 }}>{subDetail.join_code || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Billing</span>
                <span style={{ fontWeight: 700 }}>{subDetail.stripe_subscription_id ? 'Stripe' : '—'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              {canEnter && (
                <button onClick={() => { const id = subDetail.id; setSubDetail(null); onEnter(id) }}
                  style={{ width: '100%', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '12px 16px', borderRadius: 10, whiteSpace: 'nowrap',
                    border: `1px solid ${C.accent}`, background: C.accent, color: '#fff' }}>
                  Manage this community →
                </button>
              )}
              {(() => {
                // Contact goes to the CURRENT owner; the creator is history.
                const cEmail = subDetail.owner_email || subDetail.created_by_email
                const cName = subDetail.owner_name || subDetail.created_by_name
                return (
                  <a href={cEmail ? `mailto:${cEmail}?subject=${encodeURIComponent(`Residente — ${subDetail.name || 'your community'}`)}` : undefined}
                    title={cEmail || 'No email on file'}
                    onClick={cEmail ? undefined : (e) => e.preventDefault()}
                    style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', textDecoration: 'none', whiteSpace: 'nowrap',
                      cursor: cEmail ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700,
                      padding: '12px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent',
                      color: cEmail ? C.text : C.muted, opacity: cEmail ? 1 : 0.6 }}>
                    {cEmail ? `Contact ${cName?.split(' ')[0] || 'owner'}` : 'No email on file'}
                  </a>
                )
              })()}
              {canTransfer && !transferOpen && (
                <button onClick={openTransfer}
                  style={{ width: '100%', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '12px 16px', borderRadius: 10, whiteSpace: 'nowrap',
                    border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>
                  Transfer ownership…
                </button>
              )}
            </div>
            {canTransfer && transferOpen && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.4px', color: C.muted, marginBottom: 8 }}>NEW OWNER</div>
                {transferLoading ? (
                  <div style={{ color: C.muted, fontSize: 13 }}>Loading members…</div>
                ) : transferChoices.length === 0 ? (
                  <div style={{ color: C.muted, fontSize: 13 }}>No other members with a Residente account — ask a board member to sign up first.</div>
                ) : (
                  <>
                    <Select value={transferSel} onChange={setTransferSel} ariaLabel="New owner" width="100%"
                      options={[{ value: '', label: 'Choose a member…' },
                        ...transferChoices.map(r => ({
                          value: r.profile_id as string,
                          label: `${r.full_name || r.email || 'Member'}${r.is_board ? ` · ${r.board_position || 'Board'}` : ''}`,
                        }))]} />
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: 12.5, color: C.text }}>
                      <input type="checkbox" checked={transferStepDown} onChange={e => setTransferStepDown(e.target.checked)}
                        style={{ marginTop: 2, accentColor: C.accent }} />
                      <span>Previous owner steps down to a regular resident (admin access, board seat, and any assigned role removed)</span>
                    </label>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button onClick={doTransfer} disabled={!transferSel || transferBusy}
                        style={{ flex: 1, cursor: transferSel && !transferBusy ? 'pointer' : 'not-allowed', fontSize: 13.5, fontWeight: 700, padding: '10px 14px', borderRadius: 10,
                          border: `1px solid ${C.accent}`, background: transferSel ? C.accent : C.accentSoft, color: transferSel ? '#fff' : C.accent, opacity: transferBusy ? 0.7 : 1 }}>
                        {transferBusy ? 'Transferring…' : 'Confirm transfer'}
                      </button>
                      <button onClick={() => { setTransferOpen(false); setTransferErr('') }}
                        style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 700, padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted }}>
                        Cancel
                      </button>
                    </div>
                  </>
                )}
                {transferErr && <div style={{ color: '#C24040', fontSize: 12.5, marginTop: 8 }}>{transferErr}</div>}
                <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.5, marginTop: 10, marginBottom: 0 }}>
                  The new owner gets full admin access. Unless they step down, the previous owner keeps their current role. Recorded in the Activity log.
                </p>
              </div>
            )}
            {canEnter && (
              <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.5, marginTop: 10, marginBottom: 0 }}>
                <strong style={{ color: C.text }}>Manage</strong> drops you into this community&rsquo;s admin as an operator — you act in the board&rsquo;s seat and can view and edit everything they can (residents, budget, notices, votes). Your visit is recorded in the Activity log.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
