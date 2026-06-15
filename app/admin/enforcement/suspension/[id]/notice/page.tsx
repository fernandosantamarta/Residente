'use client'

// Suspension notice — print-ready HTML (Save as PDF). Notifies an owner that the
// association has suspended (or proposes to suspend) their voting and/or common-
// area use rights. Two bases:
//   • delinquency_90 — >90 days delinquent in a monetary obligation; the board
//     may suspend WITHOUT a hearing (FS 718.303(4)-(5) / 720.3085(4) & 720.305(2)).
//   • rule_violation — a use-rights suspension for a covenant violation requires
//     the 14-day notice + committee hearing first (FS 718.303(3) / 720.305(2)).
// DRAFT/aid only; attorney review required before use.

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  SUSPENSION_RIGHTS_LABELS, SUSPENSION_DELINQUENCY_DAYS,
  type SuspensionRow, type SuspensionRights, type SuspensionBasis,
} from '@/lib/compliance/enforcement'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

export default function SuspensionNoticePage() {
  const t = useT()
  const params = useParams()
  const id = params?.id as string
  const [s, setS] = useState<SuspensionRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No suspension'); return }
      try {
        const { data: sus, error: sErr } = (await withTimeout(supabase.from('ev_suspensions').select('*').eq('id', id).single())) as any
        if (sErr) throw sErr
        const { data: comm } = (await withTimeout(supabase.from('communities').select('*').eq('id', sus.community_id).single())) as any
        if (cancelled) return
        setS(sus); setCommunity(comm || null); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.enforcementSuspensionDetailNotice.loading')}</div>
  if (status === 'error' || !s) return <div style={{ padding: 40, color: '#B42318' }}>{error || t('admin.enforcementSuspensionDetailNotice.notFound')}</div>

  const isCondo = community?.association_type !== 'hoa'
  const today = ymd(new Date())
  const owner = s.unit_label || 'Owner of record'
  const basis = String(s.basis ?? 'delinquency_90') as SuspensionBasis
  const rightsLabel = SUSPENSION_RIGHTS_LABELS[(s.rights ?? 'voting') as SuspensionRights]
  const cite = (condo: string, hoa: string) => (isCondo ? condo : hoa)
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0 } }
        @media (max-width: 640px) {
          .rp-toolbar { flex-direction: column; align-items: stretch !important; }
          .rp-actions { margin-left: 0 !important; }
          .rp-actions button { flex: 1 1 0; }
        }
      `}</style>

      <div className="no-print rp-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540, lineHeight: 1.45 }}>
          {t('admin.enforcementSuspensionDetailNotice.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.enforcementSuspensionDetailNotice.printButton')}</button>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.enforcementSuspensionDetailNotice.setAssociationAddress')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 4 }}>Notice of Suspension of {rightsLabel}</h1>
      <div style={{ fontSize: 13.5, marginBottom: 14 }}><div>{owner}</div></div>

      <div style={{ fontSize: 14 }}>
        {basis === 'delinquency_90' ? (
          <>
            <p>The association&apos;s records reflect that the assessments or other monetary obligations on your {isCondo ? 'unit' : 'parcel'} have been delinquent for more than <strong>{SUSPENSION_DELINQUENCY_DAYS.value} days</strong>{s.amount_owed ? <>, in the amount of <strong>{fmt$(s.amount_owed)}</strong></> : ''}{s.delinquent_since ? <> (delinquent since {s.delinquent_since})</> : ''}.</p>
            <p>Accordingly, the board has suspended your <strong>{rightsLabel.toLowerCase()}</strong>, effective {s.started_at || today}. This suspension is authorized without a hearing and remains in effect until the past-due amount is paid in full.</p>
            <p style={{ fontSize: 12, color: '#555' }}>This suspension is imposed under {cite('Florida Statutes § 718.303(4)–(5)', 'Florida Statutes § 720.3085(4) and § 720.305(2)')}.</p>
          </>
        ) : (
          <>
            <p>Following the {/* hearing */}required notice and an opportunity for a hearing before the association&apos;s independent fining committee, the board has suspended your <strong>{rightsLabel.toLowerCase()}</strong> in connection with the following violation: <strong>{<Em>describe the violation</Em>}</strong>.</p>
            <p>This suspension is effective {s.started_at || today}.</p>
            <p style={{ fontSize: 12, color: '#555' }}>This suspension is imposed under {cite('Florida Statutes § 718.303(3)', 'Florida Statutes § 720.305(2)')}, following the 14-day notice and committee hearing those provisions require.</p>
          </>
        )}
      </div>

      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
          {community?.association_officer_name || 'Authorized officer / agent'}
        </div>
        <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
      </div>
    </div>
  )
}
