'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePlatformConsole, PlatformRequest } from '@/hooks/usePlatform'

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Self-contained palette — this page lives outside the themed app layout.
const C = {
  bg: '#0b0d12', card: '#16191f', border: '#272c36',
  text: '#eceef2', muted: '#8b929e', accent: '#FF6B3D', accentSoft: 'rgba(255,107,61,0.14)',
}

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 22px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, padding: '0 12px 10px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '13px 12px', borderTop: `1px solid ${C.border}`, fontSize: 13.5, color: C.text, verticalAlign: 'middle' }
const STATUS_NEXT: Record<PlatformRequest['status'], PlatformRequest['status']> = { open: 'in_progress', in_progress: 'resolved', resolved: 'open' }
const statusStyle = (s: PlatformRequest['status']): React.CSSProperties => ({
  cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, border: '1px solid transparent',
  flexShrink: 0, whiteSpace: 'nowrap', textTransform: 'capitalize',
  background: s === 'resolved' ? 'rgba(74,201,155,0.15)' : s === 'in_progress' ? 'rgba(78,140,221,0.15)' : C.accentSoft,
  color: s === 'resolved' ? '#4AC99B' : s === 'in_progress' ? '#6BA6F5' : C.accent,
})

type Tab = 'overview' | 'communities' | 'support' | 'operators'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'communities', label: 'Communities' },
  { key: 'support', label: 'Support' },
  { key: 'operators', label: 'Operators' },
]

export default function PlatformConsole() {
  const { isAdmin, communities, requests, operators, loading, setRequestStatus, enterCommunity } = usePlatformConsole()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [entering, setEntering] = useState<string | null>(null)

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
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

  const onEnter = async (id: string) => {
    setEntering(id)
    const ok = await enterCommunity(id)
    if (ok) router.push('/admin')
    else setEntering(null)
  }

  const stat = (label: string, val: number, hot = false) => (
    <div key={label} style={{ ...card, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: hot ? C.accent : C.border }} />
      <div style={{ fontSize: 32, fontWeight: 800, color: hot ? C.accent : C.text, lineHeight: 1 }}>{val}</div>
      <div style={{ color: C.muted, fontSize: 12.5, marginTop: 7 }}>{label}</div>
    </div>
  )

  const statsGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
      {stat('Communities', communities.length)}
      {stat('On trial', trials)}
      {stat('Total residents', totalResidents)}
      {stat('Open tickets', openCount, openCount > 0)}
    </div>
  )

  const communitiesSection = (
    <section style={{ ...card, marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Communities</h2>
      <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>Click <strong style={{ color: C.accent }}>Manage</strong> to drop into a community and run it as an operator.</p>
      {communities.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13.5 }}>No communities yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              {['Community', 'Location', 'Plan', 'Residents', 'Board', 'Join code', 'Created', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {communities.map(c => (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{c.name || '—'}</td>
                  <td style={{ ...td, color: C.muted }}>{c.location || '—'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize',
                      background: c.subscription_status === 'trial' ? C.accentSoft : 'rgba(74,201,155,0.15)',
                      color: c.subscription_status === 'trial' ? C.accent : '#4AC99B' }}>{c.subscription_status || 'active'}</span>
                  </td>
                  <td style={td}>{c.resident_count}</td>
                  <td style={td}>{c.board_count}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', letterSpacing: 1, color: C.muted }}>{c.join_code || '—'}</td>
                  <td style={{ ...td, color: C.muted }}>{fmtDate(c.created_at)}</td>
                  <td style={td}>
                    <button onClick={() => onEnter(c.id)} disabled={entering === c.id}
                      style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 8,
                        border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, whiteSpace: 'nowrap' }}>
                      {entering === c.id ? 'Entering…' : 'Manage →'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            {r.body && <div style={{ color: '#c2c7d0', fontSize: 13.5, marginTop: 3 }}>{r.body}</div>}
            <div style={{ color: C.muted, fontSize: 12.5, marginTop: 6 }}>
              {r.from_name || 'A board member'}{r.from_email ? ` · ${r.from_email}` : ''} · {fmtDate(r.created_at)}
            </div>
          </div>
        </div>
      ))}
    </section>
  )

  return shell(
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.3 }}>
          Residente <span style={{ color: C.accent }}>Platform Console</span>
        </h1>
        <Link href="/app" style={{ color: C.muted, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>&larr; Back to your community</Link>
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, marginTop: 4 }}>Every community on Residente, plus support from their boards. Operators only.</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, margin: '22px 0 22px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const active = tab === t.key
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
      {tab === 'overview' && (<>{statsGrid}{communitiesSection}{supportSection}</>)}

      {/* COMMUNITIES */}
      {tab === 'communities' && communitiesSection}

      {/* SUPPORT */}
      {tab === 'support' && supportSection}

      {/* OPERATORS */}
      {tab === 'operators' && (
        <section style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Residente operators</h2>
          <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>The people who run Residente. They can see every community and drop into any of them.</p>
          {operators.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13.5 }}>No operators listed.</div>
          ) : operators.map((o, i) => (
            <div key={i} style={{ borderTop: `1px solid ${C.border}`, padding: '13px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: C.accentSoft, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                {o.name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'OP'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</div>
                {o.email && <div style={{ color: C.muted, fontSize: 12.5 }}>{o.email}</div>}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>since {fmtDate(o.added_at)}</div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
