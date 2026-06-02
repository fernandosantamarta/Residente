'use client'

// Easy Track — Estoppel certificates (resident, read-only). A self-contained
// route (not yet wired into the rail / Easy Track tabs — see the note at the
// bottom). An estoppel certificate states the amounts owed on a unit/parcel at
// sale or refinance; it's usually requested by a buyer or title/closing agent,
// and the owner can see the request + the amounts here, via the
// ev_estoppel_requests owner-read RLS. FS 718.116(8) / 720.30851.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import type { EstoppelRequestRow, EstoppelStatus } from '@/lib/compliance/estoppel'

const withTimeout = (p: any, ms = 10000): Promise<any> =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:        { label: 'Requested',   color: '#175CD3' },
  in_progress:{ label: 'In progress', color: '#B54708' },
  delivered:  { label: 'Delivered',   color: '#067647' },
  fee_waived: { label: 'Delivered · fee waived', color: '#067647' },
  cancelled:  { label: 'Cancelled',   color: '#98A2B3' },
}

export default function ResidentEstoppelPage() {
  const { profile } = useAuth() || {}
  const [rows, setRows] = useState<EstoppelRequestRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data } = (await withTimeout(
        supabase.from('ev_estoppel_requests').select('*').eq('profile_id', profile.id).order('received_at', { ascending: false }),
      )) as any
      setRows((data as EstoppelRequestRow[]) || [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  return (
    <section className="con-wrap ev-section">
      <div className="voice-page-head">
        <h1 className="voice-page-title">Estoppel certificates</h1>
        <p className="voice-page-sub">
          An estoppel certificate states the amounts owed on your unit/parcel at sale or refinance. It&apos;s
          usually requested by a buyer or title/closing agent — when one is requested, you&apos;ll see it here.
        </p>
      </div>

      <section className="con-card">
        <h2 className="con-card-title">Requests on your unit</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="con-empty">No estoppel certificate has been requested on your unit.</div>
        )}
        {!loading && rows.map(r => {
          const st = String(r.status ?? 'new')
          const meta = STATUS_META[st] || { label: st, color: '#475467' }
          return (
            <div key={r.id} style={ROW_WRAP}>
              <div style={ROW}>
                <div style={{ minWidth: 0 }}>
                  <div style={ROW_TITLE}>
                    Requested {fmtDate(r.received_at)}
                    {r.expedited ? <span style={{ marginLeft: 8, fontSize: 12, color: '#B54708', fontWeight: 700 }}>expedited</span> : null}
                  </div>
                  <div style={ROW_META}>
                    {r.fee_total != null ? `Fee ${st === 'fee_waived' ? '$0 (waived)' : fmt$(r.fee_total)}` : ''}
                    {r.due_at ? ` · due ${fmtDate(r.due_at)}` : ''}
                    {r.delivered_at ? ` · delivered ${fmtDate(r.delivered_at)}` : ''}
                    {r.effective_until ? ` · valid through ${fmtDate(r.effective_until)}` : ''}
                  </div>
                </div>
                <span style={pill(meta.color)}>{meta.label}</span>
              </div>
            </div>
          )
        })}
      </section>
    </section>
  )
}

function pill(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }
}
const ROW_WRAP: React.CSSProperties = { borderBottom: '1px solid rgba(15,28,46,0.07)' }
const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: '12px 2px' }
const ROW_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: '#0A2440' }
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 2 }

// ── Wire-up when ready ── Left rail or Easy Track tab: { href: '/app/estoppel', … }.
// Reachable directly at /app/estoppel until then.
