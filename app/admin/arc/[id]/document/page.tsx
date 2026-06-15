'use client'

// ARC decision document — print-ready HTML (Save as PDF). Renders the
// Architectural Review Decision letter for a given ARC request.
// Advisory: draft only; confirm language with Florida counsel before sending.

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import {
  arcResponseDeadline,
  ARC_TYPE_LABELS,
  ARC_STATUS_LABELS,
  MATERIAL_ALTERATION_APPROVAL_PCT,
  type ArcRequestRow,
  type ArcRequestType,
} from '@/lib/compliance/arc'
import {
  arcLetterIntro,
  arcLetterFactRows,
  arcLetterDecisionBlocks,
  arcLetterClosing,
  splitEmphasis,
  type ArcLetterInput,
  type LetterBlock,
} from '@/lib/compliance/arc-letter'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function ArcDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.arcDetailDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t           = useT()
  const params      = useParams()
  const search      = useSearchParams()
  const id          = params?.id as string
  const _type       = search?.get('type') || 'decision'   // only 'decision' for now

  const [req, setReq]           = useState<ArcRequestRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus]     = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError]       = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No request ID'); return }
      try {
        const { data: r, error: rErr } = (await withTimeout(
          supabase.from('ev_arc_requests').select('*').eq('id', id).single(),
        )) as any
        if (rErr) throw rErr
        const { data: c } = (await withTimeout(
          supabase.from('communities').select('*').eq('id', r.community_id).single(),
        )) as any
        if (cancelled) return
        setReq(r); setCommunity(c || null); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.arcDetailDocument.loading')}</div>
  if (status === 'error' || !req) return <div style={{ padding: 40, color: '#B42318' }}>{error || t('admin.arcDetailDocument.requestNotFound')}</div>

  const isCondo  = community?.association_type !== 'hoa'
  const today    = ymd(new Date())
  const st       = String(req.status ?? 'submitted')
  const typeLabel = ARC_TYPE_LABELS[(req.request_type ?? 'other') as ArcRequestType] || req.request_type || 'Other'
  const statusLabel = ARC_STATUS_LABELS[st as keyof typeof ARC_STATUS_LABELS] || st
  const deadline = arcResponseDeadline(req, community)
  const matPct   = Number(community?.material_alteration_threshold_pct) || MATERIAL_ALTERATION_APPROVAL_PCT.value

  // Letter content is built from the shared lib/compliance/arc-letter module so
  // this page and the delivered PDF (arc-decision-letter edge function) stay in
  // lockstep — the body language lives in exactly one place.
  const letter: ArcLetterInput = {
    associationName: community?.name || 'the association',
    isCondo,
    unitLabel: req.unit_label || '',
    typeLabel,
    status: st,
    statusLabel,
    description: req.description || '',
    attachmentName: (req.attachment_name as string) || '',
    submittedAt: req.submitted_at || '',
    decidedAt: req.decided_at || today,
    decisionReason: req.decision_reason || '',
    isMaterialAlteration: !!req.is_material_alteration,
    materialPct: matPct,
  }
  const decisionBlocks = arcLetterDecisionBlocks(letter)
  const isDecided = ['approved', 'approved_with_conditions', 'denied'].includes(st)

  const Em = ({ children }: { children: any }) => (
    <em style={{ color: '#B54708' }}>{children}</em>
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.6 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .admin-top, .admin-nav, .admin-foot, .site-footer-slim, footer { display: none !important; }
          body { margin: 0 }
        }
        @media (max-width: 640px) {
          .rp-toolbar { flex-direction: column; align-items: stretch !important; }
          .rp-actions { margin-left: 0 !important; }
          .rp-actions button { flex: 1 1 0; }
        }
      `}</style>

      {/* Screen-only bar */}
      <div className="no-print rp-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 520 }}>
          {t('admin.arcDetailDocument.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.arcDetailDocument.printSaveAsPdf')}</button>
        </div>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>
          {community?.association_address || <Em>{t('admin.arcDetailDocument.setAddressHint')}</Em>}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 10 }}>Architectural Review Decision</h1>

      {/* Addressee */}
      <div style={{ fontSize: 13.5, marginBottom: 18 }}>
        <div>{req.unit_label || <Em>{t('admin.arcDetailDocument.ownerUnitPlaceholder')}</Em>}</div>
        <div>Re: ARC Request — {typeLabel}</div>
        {req.submitted_at && <div>Submitted: {req.submitted_at}</div>}
        {deadline && <div>Response due: {ymd(deadline)}</div>}
      </div>

      {/* Body — rendered from the shared arc-letter blocks */}
      <Body>
        <p>{arcLetterIntro(letter)}</p>

        <table style={tbl}><tbody>
          {arcLetterFactRows(letter).map(([label, value]) => (
            <Trow key={label} label={label} value={value} />
          ))}
        </tbody></table>

        {decisionBlocks.map((b, n) => <LetterBlockView key={n} block={b} />)}

        {/* ---- Catch-all for non-decided statuses ---- */}
        {!isDecided && (
          <div className="no-print" style={{ border: '1px dashed #d6b8a8', borderRadius: 8, padding: '14px 16px', background: '#fdf6f1', fontFamily: 'system-ui, sans-serif', fontSize: 13.5 }}>
            <strong>{t('admin.arcDetailDocument.noDecisionYet')}</strong>
            {' — '}
            {t('admin.arcDetailDocument.noDecisionStatus', { status: statusLabel.toLowerCase() })}
            {' '}
            {t('admin.arcDetailDocument.noDecisionFillsIn')}
            {' '}
            <a href="/admin/arc" style={{ color: '#E14909', fontWeight: 700 }}>{t('admin.arcDetailDocument.arcPageLink')}</a>
            {t('admin.arcDetailDocument.noDecisionPageSuffix')}
          </div>
        )}

        <p style={{ fontSize: 12, color: '#555', marginTop: 18 }}>{arcLetterClosing(letter)}</p>
      </Body>

      {/* Signature block */}
      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ display: 'flex', gap: 40 }}>
          <div style={{ flex: 1 }}>
            <div style={{ borderTop: '1px solid #111', paddingTop: 6 }}>
              {community?.association_officer_name || 'Authorized officer / ARC chair'}
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
            <div style={{ fontSize: 12, color: '#555' }}>Date: {letter.decidedAt}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function Trow({ label, value }: { label: string; value: any }) {
  return (
    <tr>
      <td style={{ ...td, fontWeight: 600, width: '38%' }}>{label}</td>
      <td style={td}>{value ?? '—'}</td>
    </tr>
  )
}

// Render one shared LetterBlock, honoring tone + **emphasis** runs so the
// on-screen letter matches the delivered PDF.
function LetterBlockView({ block }: { block: LetterBlock }) {
  const runs = splitEmphasis(block.text).map((r, i) =>
    r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>)

  if (block.kind === 'box') {
    return (
      <p style={{ border: '1px solid #eee', borderRadius: 6, padding: '10px 14px', background: '#fafafa', fontWeight: block.bold ? 600 : 400 }}>
        {runs}
      </p>
    )
  }
  if (block.tone === 'fine') {
    return <p style={{ fontSize: 12.5, color: '#555' }}>{runs}</p>
  }
  if (block.tone === 'warn') {
    return <p style={{ fontSize: 13, color: '#B54708', borderLeft: '3px solid #B54708', paddingLeft: 10, marginTop: 14 }}>{runs}</p>
  }
  return <p>{runs}</p>
}

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8, marginBottom: 16 }
const td: React.CSSProperties  = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
