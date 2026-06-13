'use client'

// Directors & management artifacts — print-ready HTML (Save as PDF). One
// parameterised page (?type=): a director fiduciary acknowledgement / written
// certification, a certification-status report, a conflict register, and the
// CAM transparency disclosure. Every artifact is a DRAFT/aid; the language
// requires attorney review before use.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import { consecutiveServiceYears, certExpiry, INITIAL_CERT_DAYS } from '@/lib/compliance/governance'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'acknowledgement' | 'cert_status' | 'conflict_register' | 'cam_disclosure'
const TITLES: Record<DocType, string> = {
  acknowledgement: 'Director Certification & Fiduciary Acknowledgement',
  cert_status: 'Board Certification-Status Report',
  conflict_register: 'Conflict-of-Interest Register',
  cam_disclosure: 'Community-Association Manager Disclosure',
}

export default function GovernanceDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.governanceDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'cert_status') as DocType

  const [community, setCommunity] = useState<any>(null)
  const [directors, setDirectors] = useState<any[]>([])
  const [terms, setTerms] = useState<any[]>([])
  const [certs, setCerts] = useState<any[]>([])
  const [managers, setManagers] = useState<any[]>([])
  const [disclosures, setDisclosures] = useState<any[]>([])
  const [vendors, setVendors] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const safe = async (t: string) => { const { data, error } = (await withTimeout(supabase.from(t).select('*').eq('community_id', communityId))) as any; return error ? [] : (data || []) }
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: c, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const res = await safe('residents')
        if (cancelled) return
        setCommunity(c || null)
        setDirectors((res || []).filter((r: any) => r.is_board))
        setTerms(await safe('ev_board_terms'))
        setCerts(await safe('ev_director_certifications'))
        setManagers(await safe('ev_managers'))
        setDisclosures(await safe('ev_conflict_disclosures'))
        setVendors(await safe('vendors'))
        setStatus('ready')
      } catch (err: any) { if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') } }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.governanceDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const isHoa = community?.association_type === 'hoa'
  const regime = isHoa ? 'hoa' : 'condo'
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const vById = (id: string) => vendors.find(v => v.id === id)
  const dById = (id: string) => directors.find(d => d.id === id)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>
      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {t('admin.governanceDocument.draftWarning')}
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>{t('admin.governanceDocument.printSaveAsPdf')}</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.governanceDocument.setAddressHint')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Fiduciary acknowledgement / written certification ---------- */}
      {type === 'acknowledgement' && (
        <Body>
          <p>I, the undersigned, having been elected or appointed as a director of {community?.name || 'the association'}, certify that within {INITIAL_CERT_DAYS.value} days of my election/appointment I have either (a) completed the educational curriculum approved by the {isHoa ? 'Department' : 'Division'}, or (b) read the association&apos;s declaration{isHoa ? '/governing documents' : ', articles of incorporation, bylaws'} and current written policies, and that I will work to uphold those documents and policies to the best of my ability and faithfully discharge my fiduciary duty to the members.</p>
          <p style={{ fontSize: 12.5, color: '#555' }}>Provided under {isHoa ? 'FS 720.3033(1)' : 'FS 718.112(2)(d)4'}. This certification is valid for {isHoa ? 'four' : 'seven'} years; continuing education applies thereafter.</p>
          <div style={{ marginTop: 36, fontSize: 14 }}>
            <div style={{ borderTop: '1px solid #111', width: 320, paddingTop: 6 }}>Director signature</div>
            <div style={{ fontSize: 12, color: '#555' }}>Printed name: ____________________  ·  Date: __________</div>
          </div>
        </Body>
      )}

      {/* ---------- Certification-status report ---------- */}
      {type === 'cert_status' && (
        <Body>
          <p>Certification and consecutive-service status for the current board, as of {today}.</p>
          {directors.length === 0 ? <p><Em>No board members recorded.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Director</th><th style={th}>Position</th>{!isHoa && <th style={thR}>Consec. yrs</th>}<th style={th}>Certified</th><th style={th}>Valid through</th>
            </tr></thead><tbody>
              {directors.map((d: any) => {
                const dt = terms.filter((t: any) => t.resident_id === d.id)
                const dc = certs.filter((c: any) => c.resident_id === d.id && c.completed_at).sort((a: any, b: any) => String(b.completed_at).localeCompare(String(a.completed_at)))[0]
                const exp = dc ? (dc.expires_at || ymd(certExpiry(dc.completed_at, regime as any))) : null
                return (
                  <tr key={d.id}>
                    <td style={td}>{d.full_name || <Em>—</Em>}</td>
                    <td style={td}>{d.board_position || 'Member'}</td>
                    {!isHoa && <td style={tdR}>{consecutiveServiceYears(dt.map((t: any) => t.term_start)).toFixed(1)}</td>}
                    <td style={td}>{dc ? dc.completed_at : <Em>none on file</Em>}</td>
                    <td style={td}>{exp || <Em>—</Em>}</td>
                  </tr>
                )
              })}
            </tbody></table>
          )}
          <p style={cite}>Director certification under {isHoa ? 'FS 720.3033(1)' : 'FS 718.112(2)(d)4'}{!isHoa ? '; 8-year consecutive-service limit under FS 718.112(2)(d)2' : ''}.</p>
        </Body>
      )}

      {/* ---------- Conflict register ---------- */}
      {type === 'conflict_register' && (
        <Body>
          <p>Recorded conflict-of-interest disclosures and director-affiliated vendors.</p>
          <h3 style={h3}>Disclosures</h3>
          {disclosures.length === 0 ? <p><Em>None recorded.</Em></p> : (
            <table style={tbl}><thead><tr><th style={th}>Disclosed</th><th style={th}>Director</th><th style={th}>Subject</th><th style={th}>Vendor</th><th style={th}>Approved</th></tr></thead><tbody>
              {disclosures.map((x: any) => (
                <tr key={x.id}>
                  <td style={td}>{x.disclosed_at || <Em>—</Em>}</td>
                  <td style={td}>{x.resident_id ? (dById(x.resident_id)?.full_name || '—') : '—'}</td>
                  <td style={td}>{x.subject}</td>
                  <td style={td}>{x.related_vendor_id ? (vById(x.related_vendor_id)?.name || '—') : '—'}</td>
                  <td style={td}>{x.approved ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          <h3 style={h3}>Director-affiliated vendors</h3>
          {vendors.filter((v: any) => v.director_owned).length === 0 ? <p><Em>None flagged.</Em></p> : (
            <table style={tbl}><tbody>
              {vendors.filter((v: any) => v.director_owned).map((v: any) => (
                <tr key={v.id}><td style={td}>{v.name}</td><td style={tdR}>{v.director_equity_pct != null ? `${v.director_equity_pct}% equity` : ''}</td></tr>
              ))}
            </tbody></table>
          )}
          <p style={cite}>Conflict disclosure + approval under FS 718.3027 / 720.3033(2). A contract with a director-affiliated party requires written disclosure and ⅔-of-directors approval.</p>
        </Body>
      )}

      {/* ---------- CAM transparency disclosure ---------- */}
      {type === 'cam_disclosure' && (
        <Body>
          <p>The following community-association manager / management company provides management services to {community?.name || 'the association'}. This disclosure is provided for member transparency.</p>
          {managers.length === 0 ? <p><Em>No manager recorded. If the association is over 10 units or has a budget over $100,000, a licensed CAM is required (FS 468.431).</Em></p> : (
            <table style={tbl}><tbody>
              {managers.map((m: any) => (
                <tr key={m.id}><td style={{ ...td, fontWeight: 600, width: '40%' }}>{m.name}{m.company ? ` (${m.company})` : ''}</td>
                  <td style={td}>{m.license_type ? `${String(m.license_type).toUpperCase()} ` : ''}{m.license_number || <Em>license #</Em>}{m.license_expiry ? ` · exp ${m.license_expiry}` : ''}{m.dbpr_verified ? ' · DBPR-verified' : ''}</td></tr>
              ))}
            </tbody></table>
          )}
          <p style={cite}>Manager disclosure under FS 468.432. License status should be verified at the DBPR licensee-search portal.</p>
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) { return <div style={{ fontSize: 14 }}>{children}</div> }
const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
