'use client'

// Directors & management workspace — eligibility, certification, conflicts &
// CAM (FS 718.112(2)(d), 718.1265, 718.3027 / 720.3033 / Ch. 468 Pt VIII).
// ADVISORY only: never auto-removes a director or auto-voids a contract. The
// board roster is residents.is_board; directors are keyed by residents.id.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import { AttorneyNote } from '../AttorneyNote'
import { SignalRow } from '../SignalRow'
import {
  governanceSignals, consecutiveServiceYears, certExpiry, camRequired,
  CONDO_TERM_LIMIT_YEARS, TERM_LIMIT_EXCEPTION_LABELS,
  type DirectorRow, type BoardTermRow, type DirectorCertRow,
  type DirectorEligibilityRow, type ManagerRow, type ConflictDisclosureRow, type TermLimitException,
} from '@/lib/compliance/governance'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])
const todayYmd = () => ymd(new Date())

export default function GovernancePage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [directors, setDirectors] = useState<DirectorRow[]>([])
  const [terms, setTerms] = useState<BoardTermRow[]>([])
  const [certs, setCerts] = useState<DirectorCertRow[]>([])
  const [eligibility, setEligibility] = useState<DirectorEligibilityRow[]>([])
  const [managers, setManagers] = useState<ManagerRow[]>([])
  const [vendors, setVendors] = useState<any[]>([])
  const [disclosures, setDisclosures] = useState<ConflictDisclosureRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const safe = async (table: string, sel = '*') => {
    const { data, error } = (await withTimeout(supabase.from(table).select(sel).eq('community_id', communityId))) as any
    return error ? [] : (data || [])
  }
  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire every read in ONE parallel batch instead of awaiting eight round-trips
      // in series — the page used to wait for the SUM of all eight; now it waits for
      // the slowest single query. None of these reads depend on another's result, and
      // safe() is tolerant (returns [] on error) so a missing table never blocks the rest.
      const [cRes, res, termRows, certRows, eligRows, mgrRows, vendRows, discRows] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        safe('residents'),
        safe('ev_board_terms'),
        safe('ev_director_certifications'),
        safe('ev_director_eligibility'),
        safe('ev_managers'),
        safe('vendors'),
        safe('ev_conflict_disclosures'),
      ])
      const { data: c } = cRes as any
      setCommunity(c || null)
      setDirectors(((res || []) as DirectorRow[]).filter(r => r.is_board))
      setTerms(termRows)
      setCerts(certRows)
      setEligibility(eligRows)
      setManagers(mgrRows)
      setVendors(vendRows)
      setDisclosures(discRows)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load governance data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const signals = useMemo(
    () => governanceSignals(community, directors, terms, certs, eligibility, managers, vendors as any, disclosures),
    [community, directors, terms, certs, eligibility, managers, vendors, disclosures],
  )

  // ---- mutations ----
  const addTerm = async (resident_id: string, term_start: string, position: string, exception?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_board_terms').insert({
        community_id: communityId, resident_id, term_start: term_start || null, elected_at: term_start || null,
        position: position || null, term_limit_exception: exception || null, created_by: profile?.id ?? null,
      }))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'governance.term_recorded', target_type: 'director', target_id: resident_id })
      setMsg('Term recorded.'); load()
    } catch (err: any) { setError(err?.message || 'Could not record term') }
  }
  const addCert = async (resident_id: string, kind: string, completed_at: string, hours: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_director_certifications').insert({
        community_id: communityId, resident_id, kind: kind || 'initial',
        completed_at: completed_at || null, hours: hours ? Number(hours) : null,
        expires_at: completed_at ? ymd(certExpiry(completed_at, regime as any)) : null,
        created_by: profile?.id ?? null,
      }))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'governance.cert_recorded', target_type: 'director', target_id: resident_id })
      setMsg('Certification recorded.'); load()
    } catch (err: any) { setError(err?.message || 'Could not record certification') }
  }
  const saveEligibility = async (resident_id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const existing = eligibility.find(e => e.resident_id === resident_id)
      const row = { community_id: communityId, resident_id, updated_by: profile?.id ?? null, updated_at: new Date().toISOString(), ...patch }
      const q = existing
        ? supabase.from('ev_director_eligibility').update(row).eq('id', existing.id)
        : supabase.from('ev_director_eligibility').insert(row)
      const { error } = (await withTimeout(q)) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'governance.eligibility_updated', target_type: 'director', target_id: resident_id })
      load()
    } catch (err: any) { setError(err?.message || 'Could not update eligibility') }
  }

  // ---- manager intake ----
  const [mForm, setMForm] = useState<any>({ status: 'active' })
  const setMF = (k: string, v: any) => setMForm((f: any) => ({ ...f, [k]: v }))
  const addManager = async (e: any) => {
    e.preventDefault(); setError('')
    try {
      const insert = {
        community_id: communityId, name: (mForm.name || '').trim(), company: (mForm.company || '').trim() || null,
        license_number: (mForm.license_number || '').trim() || null, license_type: mForm.license_type || null,
        license_expiry: (mForm.license_expiry || '').trim() || null, status: mForm.status || 'active',
        dbpr_verified: !!mForm.dbpr_verified, created_by: profile?.id ?? null,
      }
      if (!insert.name) { setError('Name the manager'); return }
      const { error } = (await withTimeout(supabase.from('ev_managers').insert(insert))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'governance.manager_recorded', target_type: 'manager' })
      setMForm({ status: 'active' }); setMsg('Manager recorded.'); load()
    } catch (err: any) { setError(err?.message || 'Could not record manager') }
  }

  // ---- conflict disclosure intake ----
  const [cForm, setCForm] = useState<any>({})
  const addDisclosure = async (e: any) => {
    e.preventDefault(); setError('')
    try {
      const insert = {
        community_id: communityId, subject: (cForm.subject || '').trim(),
        resident_id: cForm.resident_id || null, related_vendor_id: cForm.related_vendor_id || null,
        disclosed_at: (cForm.disclosed_at || '').trim() || todayYmd(), approved: !!cForm.approved,
        approval_basis: (cForm.approval_basis || '').trim() || null, created_by: profile?.id ?? null,
      }
      if (!insert.subject) { setError('Describe the conflict'); return }
      const { error } = (await withTimeout(supabase.from('ev_conflict_disclosures').insert(insert))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'governance.conflict_disclosed', target_type: 'conflict_disclosure' })
      setCForm({}); setMsg('Disclosure recorded.'); load()
    } catch (err: any) { setError(err?.message || 'Could not record disclosure') }
  }

  const directorOwnedVendors = vendors.filter(v => v.director_owned)

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Directors <span className="amp">&</span> management</h1>
      <p className="admin-dek">
        Track director eligibility, the 4-hour certification + continuing education, conflict-of-interest
        disclosures, and CAM licensing (FS 718.112(2)(d) / 720.3033 / Ch. 468). Advisory — the board decides;
        nothing here removes a director or voids a contract.
      </p>

      <AttorneyNote />
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {signals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {signals.map(s => <SignalRow key={s.id} signal={s} />)}
            </div>
          )}

          {/* Directors */}
          <div className="card">
            <div className="card-head"><div><h2>Directors <span style={{ opacity: 0.55, fontWeight: 400 }}>({directors.length})</span></h2></div></div>
            {directors.length === 0 && <div className="admin-note">No board members yet. Mark residents as board members on Easy Voice → Board.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {directors.map(d => (
                <DirectorCard
                  key={d.id} d={d} regime={regime}
                  terms={terms.filter(t => t.resident_id === d.id)}
                  certs={certs.filter(c => c.resident_id === d.id)}
                  elig={eligibility.find(e => e.resident_id === d.id)}
                  onAddTerm={addTerm} onAddCert={addCert} onSaveElig={saveEligibility}
                />
              ))}
            </div>
          </div>

          {/* Managers (CAM) */}
          <div className="card">
            <div className="card-head"><div><h2>Community-association manager (CAM){camRequired(community) ? ' — required at this size' : ''}</h2></div></div>
            <form className="admin-form" onSubmit={addManager}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">Name</span>
                  <input className="admin-input" value={mForm.name ?? ''} onChange={e => setMF('name', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">License #</span>
                  <input className="admin-input" value={mForm.license_number ?? ''} onChange={e => setMF('license_number', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">Type</span>
                  <select className="admin-input" value={mForm.license_type ?? ''} onChange={e => setMF('license_type', e.target.value)}>
                    <option value="">—</option><option value="cam">CAM</option><option value="cab">CAB (firm)</option><option value="other">Other</option>
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">License expiry</span>
                  <input className="admin-input" type="date" value={mForm.license_expiry ?? ''} onChange={e => setMF('license_expiry', e.target.value)} /></label>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '8px 0' }}>
                <input type="checkbox" checked={!!mForm.dbpr_verified} onChange={e => setMF('dbpr_verified', e.target.checked)} /> DBPR-verified
              </label>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">Record manager</button></div>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {managers.map(m => (
                <div key={m.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}{m.status !== 'active' ? ' (inactive)' : ''}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75 }}>
                    {m.license_type ? `${String(m.license_type).toUpperCase()} ` : ''}{m.license_number || ''}
                    {m.license_expiry ? ` · exp ${m.license_expiry}` : ''} · {m.dbpr_verified ? 'DBPR-verified' : 'not DBPR-verified'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Conflicts */}
          <div className="card">
            <div className="card-head"><div><h2>Conflicts of interest</h2></div></div>
            {directorOwnedVendors.length > 0 && (
              <div className="admin-note admin-note-info" style={{ marginBottom: 10 }}>
                Director-affiliated vendor(s): {directorOwnedVendors.map(v => v.name).join(', ')}. A contract with a director-affiliated party needs written disclosure + ⅔ board approval (FS 718.3027). Mark a vendor as director-owned on Easy Track → Vendors.
              </div>
            )}
            <form className="admin-form" onSubmit={addDisclosure}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">What is disclosed</span>
                  <input className="admin-input" value={cForm.subject ?? ''} placeholder="Director's firm bidding the landscaping contract" onChange={e => setCForm((f: any) => ({ ...f, subject: e.target.value }))} /></label>
                <label className="admin-field"><span className="admin-field-label">Director</span>
                  <select className="admin-input" value={cForm.resident_id ?? ''} onChange={e => setCForm((f: any) => ({ ...f, resident_id: e.target.value }))}>
                    <option value="">—</option>
                    {directors.map(d => <option key={d.id} value={d.id}>{d.full_name || d.id.slice(0, 8)}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Related vendor</span>
                  <select className="admin-input" value={cForm.related_vendor_id ?? ''} onChange={e => setCForm((f: any) => ({ ...f, related_vendor_id: e.target.value }))}>
                    <option value="">—</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Disclosed on</span>
                  <input className="admin-input" type="date" value={cForm.disclosed_at ?? ''} onChange={e => setCForm((f: any) => ({ ...f, disclosed_at: e.target.value }))} /></label>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '8px 0' }}>
                <input type="checkbox" checked={!!cForm.approved} onChange={e => setCForm((f: any) => ({ ...f, approved: e.target.checked }))} /> Approved by ⅔ of directors
              </label>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">Record disclosure</button></div>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {disclosures.map(x => (
                <div key={x.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{(x as any).subject}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75 }}>{(x as any).disclosed_at ? `disclosed ${(x as any).disclosed_at}` : ''} · {x.approved ? '✓ approved' : 'not approved'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Documents: generate or view each statutory artifact */}
          <div className="card">
            <div className="card-head"><div><h2>Documents</h2><div className="sub">Generate or view each statutory artifact</div></div></div>
            <div className="wslist">
              {[
                { type: 'acknowledgement', label: 'Fiduciary acknowledgement / written certification', live: false },
                { type: 'cert_status', label: 'Certification-status report', live: true },
                { type: 'conflict_register', label: 'Conflict register', live: true },
                { type: 'cam_disclosure', label: 'CAM transparency disclosure', live: false },
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/governance/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      {d.live ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                      )}
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">{d.live ? 'Live document' : 'Draft template'}</div>
                    </div>
                    <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DirectorCard({ d, regime, terms, certs, elig, onAddTerm, onAddCert, onSaveElig }: {
  d: DirectorRow; regime: string
  terms: BoardTermRow[]; certs: DirectorCertRow[]; elig?: DirectorEligibilityRow
  onAddTerm: (rid: string, ts: string, pos: string, exception?: string) => void
  onAddCert: (rid: string, kind: string, completed: string, hours: string) => void
  onSaveElig: (rid: string, patch: Record<string, any>) => void
}) {
  const [open, setOpen] = useState(false)
  const [ts, setTs] = useState('')
  const [tex, setTex] = useState('')
  const [cd, setCd] = useState(''); const [ck, setCk] = useState('initial'); const [ch, setCh] = useState('')
  const years = consecutiveServiceYears(terms.map(t => t.term_start))
  const newestCert = certs.filter(c => c.completed_at).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0]
  const overLimit = regime === 'condo' && years >= CONDO_TERM_LIMIT_YEARS.value

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${overLimit ? '#B42318' : '#175CD3'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{d.full_name || 'Director'}{d.board_position ? ` · ${d.board_position}` : ''}</div>
          <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
            {regime === 'condo' ? `~${years.toFixed(1)} consecutive yrs` : 'HOA director'}
            {newestCert ? ` · certified ${newestCert.completed_at}` : ' · no certification on file'}
          </div>
        </div>
        <button type="button" className="admin-btn-ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Manage'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Terms */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Terms ({terms.length})</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {terms.length === 0 ? '—' : terms.map(t => `${t.term_start || '—'}${t.term_limit_exception ? ` (exception: ${TERM_LIMIT_EXCEPTION_LABELS[t.term_limit_exception as TermLimitException] ?? t.term_limit_exception})` : ''}`).join(', ')}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11.5 }}>Term start<input className="admin-input" style={{ maxWidth: 150 }} type="date" value={ts} onChange={e => setTs(e.target.value)} /></label>
              {regime === 'condo' && (
                <label style={{ fontSize: 11.5 }}>Beyond-8-yr exception (if any)
                  <select className="admin-input" style={{ maxWidth: 230 }} value={tex} onChange={e => setTex(e.target.value)}>
                    <option value="">— none —</option>
                    {(Object.keys(TERM_LIMIT_EXCEPTION_LABELS) as TermLimitException[]).map(k => (
                      <option key={k} value={k}>{TERM_LIMIT_EXCEPTION_LABELS[k]}</option>
                    ))}
                  </select></label>
              )}
              <button type="button" className="admin-btn-ghost" disabled={!ts} onClick={() => { onAddTerm(d.id, ts, d.board_position || '', tex); setTs(''); setTex('') }}>Add term</button>
            </div>
          </div>
          {/* Certifications */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Certifications ({certs.length})</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11.5 }}>Type
                <select className="admin-input" style={{ maxWidth: 130 }} value={ck} onChange={e => setCk(e.target.value)}>
                  <option value="initial">initial</option><option value="continuing">continuing</option><option value="recert">recert</option>
                </select></label>
              <label style={{ fontSize: 11.5 }}>Completed<input className="admin-input" style={{ maxWidth: 150 }} type="date" value={cd} onChange={e => setCd(e.target.value)} /></label>
              <label style={{ fontSize: 11.5 }}>Hours<input className="admin-input" style={{ maxWidth: 80 }} type="number" min="0" step="0.5" value={ch} onChange={e => setCh(e.target.value)} /></label>
              <button type="button" className="admin-btn-ghost" disabled={!cd} onClick={() => { onAddCert(d.id, ck, cd, ch); setCd(''); setCh('') }}>Add</button>
            </div>
          </div>
          {/* Eligibility flags (board-only) */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Eligibility (board-only)</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
              {([
                ['delinquent', 'delinquent in a monetary obligation'],
                ['felony_conviction', 'felony conviction'],
                ['charged_pending', 'pending charge'],
                ['signed_certification', 'signed written certification'],
              ] as [keyof DirectorEligibilityRow, string][]).map(([key, lbl]) => (
                <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!elig?.[key]} onChange={e => onSaveElig(d.id, { [key]: e.target.checked })} /> {lbl}
                </label>
              ))}
            </div>
            {elig?.delinquent && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5, marginTop: 8, maxWidth: 220 }}>
                <span style={{ opacity: 0.7 }}>Delinquent since (the 90-day clock runs from here)</span>
                <input className="admin-input" type="date" defaultValue={elig?.delinquent_since ?? ''}
                  onChange={e => onSaveElig(d.id, { delinquent_since: e.target.value || null })} />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
