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

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function ArcDocumentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
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

  if (status === 'loading') return <div style={{ padding: 40 }}>Loading…</div>
  if (status === 'error' || !req) return <div style={{ padding: 40, color: '#B42318' }}>{error || 'Request not found'}</div>

  const isCondo  = community?.association_type !== 'hoa'
  const today    = ymd(new Date())
  const st       = String(req.status ?? 'submitted')
  const typeLabel = ARC_TYPE_LABELS[(req.request_type ?? 'other') as ArcRequestType] || req.request_type || 'Other'
  const statusLabel = ARC_STATUS_LABELS[st as keyof typeof ARC_STATUS_LABELS] || st
  const deadline = arcResponseDeadline(req, community)
  const matPct   = Number(community?.material_alteration_threshold_pct) || MATERIAL_ALTERATION_APPROVAL_PCT.value

  // Condo vs HOA statute cite
  const cite = (condo: string, hoa: string) => (isCondo ? condo : hoa)

  const Em = ({ children }: { children: any }) => (
    <em style={{ color: '#B54708' }}>{children}</em>
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.6 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      {/* Screen-only bar */}
      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 520 }}>
          ⚠ DRAFT — an aid, not an official document. Confirm every detail and the legal language
          with your association attorney before sending.
        </div>
        <button
          onClick={() => window.print()}
          style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}
        >
          Print / Save as PDF
        </button>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>
          {community?.association_address || <Em>set the association address in Community settings</Em>}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 10 }}>Architectural Review Decision</h1>

      {/* Addressee */}
      <div style={{ fontSize: 13.5, marginBottom: 18 }}>
        <div>{req.unit_label || <Em>owner name / unit</Em>}</div>
        <div>Re: ARC Request — {typeLabel}</div>
        {req.submitted_at && <div>Submitted: {req.submitted_at}</div>}
        {deadline && <div>Response due: {ymd(deadline)}</div>}
      </div>

      {/* Body */}
      <Body>
        <p>
          This letter constitutes the written decision of {community?.name || 'the association'} on your
          Architectural Review Committee (ARC) application described below.
        </p>

        <table style={tbl}><tbody>
          <Trow label="Owner / unit" value={req.unit_label || <Em>owner name / unit</Em>} />
          <Trow label="Request type" value={typeLabel} />
          <Trow label="Description" value={req.description || <Em>no description provided</Em>} />
          <Trow label="Submitted" value={req.submitted_at || <Em>unknown</Em>} />
          <Trow label="Decision date" value={req.decided_at || today} />
          <Trow label="Decision" value={statusLabel} />
        </tbody></table>

        {/* ---- APPROVED ---- */}
        {st === 'approved' && (
          <>
            <p>
              After review, the association <strong>approves</strong> the above request. The owner may
              proceed with the proposed work in accordance with the association&apos;s governing
              documents, applicable rules, and {cite('Florida Statutes § 718.113', 'Florida Statutes § 720.3035')}.
            </p>
            <p style={{ fontSize: 12.5, color: '#555' }}>
              This approval does not waive or limit any requirement of applicable local building codes,
              permits, or other governmental approvals that may be required.
            </p>
          </>
        )}

        {/* ---- APPROVED WITH CONDITIONS ---- */}
        {st === 'approved_with_conditions' && (
          <>
            <p>
              After review, the association <strong>approves</strong> the above request, subject to the
              following conditions:
            </p>
            <p style={{ border: '1px solid #eee', borderRadius: 6, padding: '10px 14px', background: '#fafafa' }}>
              {req.decision_reason ? req.decision_reason : <Em>state the conditions of approval</Em>}
            </p>
            <p>
              The owner must comply with the above conditions in all aspects of the work. This approval
              does not waive or limit any requirement of applicable local building codes, permits, or
              other governmental approvals that may be required.
            </p>
          </>
        )}

        {/* ---- DENIED ---- */}
        {st === 'denied' && (
          <>
            <p>
              After review, the association <strong>denies</strong> the above request for the
              following specific reason(s):
            </p>
            <p style={{ border: '1px solid #eee', borderRadius: 6, padding: '10px 14px', background: '#fafafa', fontWeight: 600 }}>
              {req.decision_reason
                ? req.decision_reason
                : <Em>state the specific reason(s) for the denial — a denial must include written reasons ({cite('FS 718.113', 'FS 720.3035(3)')})</Em>}
            </p>
            <p>
              The association is required to apply its architectural standards consistently and in
              conformity with its governing documents and
              {' '}{cite('Florida Statutes § 718.113(2)', 'Florida Statutes § 720.3035')}.
              You may have the right to appeal this decision under the association&apos;s governing
              documents. Please review your Declaration and Bylaws for the applicable appeal
              procedures, or consult with legal counsel.
            </p>
          </>
        )}

        {/* ---- MATERIAL ALTERATION note (condo) ---- */}
        {isCondo && req.is_material_alteration && (
          <p style={{ fontSize: 13, color: '#B54708', borderLeft: '3px solid #B54708', paddingLeft: 10, marginTop: 14 }}>
            Note — Material Alteration: The proposed work has been identified as a material
            alteration or substantial addition to the common elements of the condominium.
            Under Florida Statutes § 718.113(2), a material alteration or substantial addition
            requires approval of {matPct}% of the total voting interests of the association,
            unless the Declaration provides otherwise. Board approval alone may not be sufficient
            to authorize this work. Confirm with legal counsel and the membership vote requirement
            before proceeding.
          </p>
        )}

        {/* ---- Catch-all for non-decided statuses ---- */}
        {!['approved', 'approved_with_conditions', 'denied'].includes(st) && (
          <p><Em>This request is currently {statusLabel.toLowerCase()} — a final decision has not yet been recorded.</Em></p>
        )}

        <p style={{ fontSize: 12, color: '#555', marginTop: 18 }}>
          This decision is made under {cite('Florida Statutes § 718.113(2)', 'Florida Statutes § 720.3035')} and the
          association&apos;s governing documents. This letter is a draft prepared by Residente as an
          administrative aid and must be reviewed and approved by the association&apos;s attorney before
          use.
        </p>
      </Body>

      {/* Signature block */}
      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ display: 'flex', gap: 40 }}>
          <div style={{ flex: 1 }}>
            <div style={{ borderTop: '1px solid #111', paddingTop: 6 }}>
              {community?.association_officer_name || 'Authorized officer / ARC chair'}
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
            <div style={{ fontSize: 12, color: '#555' }}>Date: __________</div>
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

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8, marginBottom: 16 }
const td: React.CSSProperties  = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
