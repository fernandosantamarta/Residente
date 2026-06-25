'use client'

// Official-records artifacts — print-ready HTML (Save as PDF). One parameterised
// page (?type=) renders: a records-inspection checklist (HB 1021 made / not-made-
// available, ?request=<id>), an official-records index / posting manifest, and a
// records-request acknowledgement letter (?request=<id>). Every artifact is a
// DRAFT/aid; the language requires attorney review before use.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  FL_REQUIRED_CATEGORIES, recordsInspectionDueAt, retentionYearsForCategory,
  RECORDS_INSPECTION_DAYS,
} from '@/lib/compliance/official-records'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'checklist' | 'manifest' | 'acknowledgement'
const TITLES: Record<DocType, string> = {
  checklist:       'Records-Inspection Checklist',
  manifest:        'Official Records — Index & Posting Manifest',
  acknowledgement: 'Acknowledgement of Records-Inspection Request',
}

export default function RecordsPrintPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.documentsRecordsPrint.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'manifest') as DocType
  const requestId = search?.get('request') || null

  const [community, setCommunity] = useState<any>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [request, setRequest] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: comm, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const { data: docs } = (await withTimeout(supabase.from('documents').select('*').eq('community_id', communityId).order('category', { ascending: true }))) as any
        let req: any = null
        if (requestId) {
          const { data: r } = (await withTimeout(supabase.from('resident_requests').select('*').eq('id', requestId).single())) as any
          req = r || null
        }
        if (cancelled) return
        setCommunity(comm || null); setDocuments(docs || []); setRequest(req); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type, requestId])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.documentsRecordsPrint.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const isHoa = community?.association_type === 'hoa'
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const due = request ? (request.due_at ? new Date(request.due_at) : recordsInspectionDueAt(request.created_at)) : null

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
          {t('admin.documentsRecordsPrint.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.documentsRecordsPrint.printButton')}</button>
        </div>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.documentsRecordsPrint.setAddressHint')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Records-inspection checklist ---------- */}
      {type === 'checklist' && (
        <Body>
          <p>Use this checklist to record, for a member's request to inspect official records, which record types were made available, not made available (with the statutory basis), or are not applicable.</p>
          {request && (
            <table style={tbl}><tbody>
              <Trow label="Requestor" value={request.submitter_name} />
              <Trow label="Unit / parcel" value={request.submitter_unit} />
              <Trow label="Request" value={request.subject} />
              <Trow label="Requested on" value={ymd(request.created_at)} />
              <Trow label="Statutory production deadline" value={due ? `${ymd(due)} (${RECORDS_INSPECTION_DAYS.value} ${isHoa ? 'business' : 'working'} days)` : '—'} />
            </tbody></table>
          )}
          <table style={{ ...tbl, marginTop: 12 }}><thead><tr>
            <th style={th}>Record type</th><th style={th}>Made available</th><th style={th}>Not made available (basis)</th><th style={th}>N/A</th>
          </tr></thead><tbody>
            {FL_REQUIRED_CATEGORIES.filter(c => !c.regimes || c.regimes.includes(isHoa ? 'hoa' : 'condo')).map(c => (
              <tr key={c.label}>
                <td style={td}>{c.label}<div style={{ fontSize: 11, color: '#888' }}>FS {c.statute}</div></td>
                <td style={tdC}>☐</td><td style={tdC}>☐ ____________</td><td style={tdC}>☐</td>
              </tr>
            ))}
          </tbody></table>
          <p style={cite}>Records made available under {isHoa ? 'FS 720.303(5)' : 'FS 718.111(12)(c)'}. Protected personal information must be redacted before production. A withheld record must cite a statutory basis.</p>
          <Sign name={community?.association_officer_name} assoc={community?.name} />
        </Body>
      )}

      {/* ---------- Posting manifest / records index ---------- */}
      {type === 'manifest' && (
        <Body>
          <p>Index of the association's official records on file, with portal-posting status and the statutory minimum retention for each. Generated {today}.</p>
          {documents.length === 0 ? <p><Em>No documents on file.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Title</th><th style={th}>Category</th><th style={th}>Posted</th><th style={th}>Posted on</th><th style={th}>Retain</th>
            </tr></thead><tbody>
              {documents.map(d => {
                const ry = retentionYearsForCategory(d.category)
                return (
                  <tr key={d.id}>
                    <td style={td}>{d.title}</td>
                    <td style={td}>{d.category || <Em>—</Em>}</td>
                    <td style={tdC}>{d.posted_to_portal ? '✓' : '—'}</td>
                    <td style={td}>{d.posted_at ? ymd(d.posted_at) : '—'}</td>
                    <td style={td}>{ry == null ? 'Permanent' : `${ry} yr`}</td>
                  </tr>
                )
              })}
            </tbody></table>
          )}
          <p style={cite}>Retention: governing documents, plans &amp; permits are kept permanently; milestone / SIRS / structural reports for 15 years; ballots, sign-in sheets &amp; voting proxies for 1 year; most other official records for 7 years. Posting obligations under FS 718.111(12)(g) / 720.303(4)(b). Confirm with counsel.</p>
        </Body>
      )}

      {/* ---------- Acknowledgement letter ---------- */}
      {type === 'acknowledgement' && (
        <Body>
          <p>Dear {request?.submitter_name || 'Member'},</p>
          <p>The association acknowledges receipt of your request to inspect or copy official records{request?.subject ? ` regarding "${request.subject}"` : ''}{request?.created_at ? `, received on ${ymd(request.created_at)}` : ''}.</p>
          <p>Under {isHoa ? 'section 720.303(5), Florida Statutes' : 'section 718.111(12)(c), Florida Statutes'}, the association will make the requested records available for inspection or copying within <strong>{RECORDS_INSPECTION_DAYS.value} {isHoa ? 'business' : 'working'} days</strong> of this request{due ? `, on or before ${ymd(due)}` : ''}, at a mutually convenient time and place. Records containing protected personal information will be produced in redacted form as the statute requires.</p>
          <p>Reasonable costs of copies and the personnel time required to supervise the inspection may apply, consistent with the statute and the association's governing documents.</p>
          <p>{isHoa
            ? 'If the records are not made available within 10 business days of a request sent by certified mail, return receipt requested, the law provides a rebuttable presumption of willful non-compliance and minimum damages of $50 per day for up to 10 days ($500), beginning on the 11th business day; the association is committed to timely compliance.'
            : 'If the records are not made available within 10 working days, the law provides a rebuttable presumption of willful non-compliance and minimum damages of $50 per day for up to 10 days ($500), beginning on the 11th working day; the association is committed to timely compliance.'}</p>
          <Sign name={community?.association_officer_name} assoc={community?.name} />
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) { return <div style={{ fontSize: 14 }}>{children}</div> }
function Sign({ name, assoc }: { name?: string | null; assoc?: string | null }) {
  return (
    <div style={{ marginTop: 36, fontSize: 14 }}>
      <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{name || 'Authorized officer / agent'}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{assoc || 'Association'}</div>
    </div>
  )
}
function Trow({ label, value }: { label: string; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '40%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdC: React.CSSProperties = { ...td, textAlign: 'center' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
