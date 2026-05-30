'use client'

import Link from 'next/link'
import { usePlatformConsole, PlatformRequest } from '@/hooks/usePlatform'

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const card: React.CSSProperties = {
  background: 'var(--surface, #15171c)', border: '1px solid var(--border)',
  borderRadius: 14, padding: '18px 20px', marginBottom: 18,
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-faint)', padding: '8px 10px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '10px 10px', borderTop: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }
const STATUS_NEXT: Record<PlatformRequest['status'], PlatformRequest['status']> = {
  open: 'in_progress', in_progress: 'resolved', resolved: 'open',
}

export default function PlatformConsole() {
  const { isAdmin, communities, requests, loading, setRequestStatus } = usePlatformConsole()

  if (loading || isAdmin === null) {
    return <div style={{ padding: 40, color: 'var(--text-faint)' }}>Loading the platform console…</div>
  }
  if (!isAdmin) {
    return (
      <div style={{ padding: 40, maxWidth: 520 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Not authorized</h1>
        <p style={{ color: 'var(--text-faint)', marginBottom: 16 }}>
          The Platform Console is for Residente operators only.
        </p>
        <Link href="/app" style={{ color: 'var(--pink)' }}>&larr; Back to your community</Link>
      </div>
    )
  }

  const openCount = requests.filter(r => r.status !== 'resolved').length
  const totalResidents = communities.reduce((s, c) => s + Number(c.resident_count || 0), 0)
  const trials = communities.filter(c => c.subscription_status === 'trial').length

  return (
    <div style={{ padding: '32px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Residente — Platform Console</h1>
        <Link href="/app" style={{ color: 'var(--text-faint)', fontSize: 13 }}>&larr; Back to your community</Link>
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginBottom: 20 }}>
        Every community on Residente, plus support requests from their boards. Operators only.
      </p>

      {/* Headline stats */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          ['Communities', communities.length],
          ['On trial', trials],
          ['Total residents', totalResidents],
          ['Open tickets', openCount],
        ].map(([label, val]) => (
          <div key={label as string} style={{ ...card, flex: '1 1 160px', marginBottom: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{val as number}</div>
            <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{label as string}</div>
          </div>
        ))}
      </div>

      {/* Communities */}
      <section style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Communities</h2>
        {communities.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>No communities yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Community</th><th style={th}>Location</th><th style={th}>Plan</th>
                  <th style={th}>Residents</th><th style={th}>Board</th><th style={th}>Join code</th><th style={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {communities.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.name || '—'}</td>
                    <td style={td}>{c.location || '—'}</td>
                    <td style={td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: c.subscription_status === 'trial' ? 'rgba(224,163,62,0.15)' : 'rgba(92,200,160,0.15)',
                        color: c.subscription_status === 'trial' ? '#E0A33E' : '#5CC8A0',
                      }}>{c.subscription_status || 'active'}</span>
                    </td>
                    <td style={td}>{c.resident_count}</td>
                    <td style={td}>{c.board_count}</td>
                    <td style={{ ...td, fontFamily: 'monospace', letterSpacing: 1 }}>{c.join_code || '—'}</td>
                    <td style={td}>{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Support inbox */}
      <section style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          Support inbox {openCount > 0 && <span style={{ color: '#E0A33E' }}>· {openCount} open</span>}
        </h2>
        {requests.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>No support requests yet.</div>
        ) : requests.map(r => (
          <div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <button
              onClick={() => setRequestStatus(r.id, STATUS_NEXT[r.status])}
              title="Click to advance status"
              style={{
                cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border)',
                background: r.status === 'resolved' ? 'rgba(92,200,160,0.15)' : r.status === 'in_progress' ? 'rgba(62,124,177,0.15)' : 'rgba(224,163,62,0.15)',
                color: r.status === 'resolved' ? '#5CC8A0' : r.status === 'in_progress' ? '#3E7CB1' : '#E0A33E',
                flexShrink: 0, whiteSpace: 'nowrap',
              }}>
              {r.status === 'in_progress' ? 'in progress' : r.status}
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.subject}</div>
              {r.body && <div style={{ color: 'var(--text-soft, var(--text-faint))', fontSize: 13, marginTop: 2 }}>{r.body}</div>}
              <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>
                {r.from_name || 'A board member'}{r.from_email ? ` · ${r.from_email}` : ''} · {fmtDate(r.created_at)}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
