'use client'

// Structural integrity workspace — milestone inspections, SIRS & turnover.
// CONDO ONLY (FS 553.899, 718.112(2)(g), 718.301(4)); renders N/A for HOAs.
// Board records buildings + their assessments; the date math + the advisory
// signals live in lib/compliance/structural.ts and surface on /admin/compliance.
// Nothing here blocks a board action.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import {
  SIRS_COMPONENTS, SIRS_MIN_STORIES,
  DBPR_FEE_PER_UNIT, DBPR_FEE_MIN_UNITS, DBPR_BUILDING_REPORT_MIN_STORIES, dbprAnnualFee,
  milestoneInitialDueDate, milestoneTriggerYears, isSirsEligible,
  type BuildingRow, type StructuralAssessmentRow, type SirsComponentRow,
  type AssessmentKind,
} from '@/lib/compliance/structural'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

const KIND_LABEL: Record<string, string> = { milestone: 'Milestone inspection', sirs: 'SIRS', turnover: 'Turnover inspection' }
const STATUS_OPTIONS = ['not_started', 'scheduled', 'in_progress', 'report_received', 'completed', 'cancelled'] as const
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', scheduled: 'Scheduled', in_progress: 'In progress',
  report_received: 'Report received', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<string, string> = {
  not_started: '#475467', scheduled: '#175CD3', in_progress: '#B54708',
  report_received: '#7A5AF8', completed: '#067647', cancelled: '#98A2B3',
}
const PERFORMER_TYPES = ['PE', 'RA', 'CAI-RS', 'APRA-PRA', 'other'] as const

export default function StructuralPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [assessments, setAssessments] = useState<StructuralAssessmentRow[]>([])
  const [components, setComponents] = useState<SirsComponentRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data: c } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single(),
      )) as any
      const { data: b, error: bErr } = (await withTimeout(
        supabase.from('ev_buildings').select('*').eq('community_id', communityId).order('created_at', { ascending: true }),
      )) as any
      if (bErr) throw bErr
      const { data: a } = (await withTimeout(
        supabase.from('ev_structural_assessments').select('*').eq('community_id', communityId).order('created_at', { ascending: false }),
      )) as any
      const { data: comp } = (await withTimeout(
        supabase.from('ev_sirs_components').select('*').eq('community_id', communityId),
      )) as any
      setCommunity(c || null)
      setBuildings(b || [])
      setAssessments(a || [])
      setComponents(comp || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load structural data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'

  // ---------- DBPR (Division) settings ----------
  const [dbprForm, setDbprForm] = useState<any>({})
  useEffect(() => {
    if (!community) return
    setDbprForm({
      dbpr_account_created_at: community.dbpr_account_created_at ? String(community.dbpr_account_created_at).slice(0, 10) : '',
      dbpr_fee_paid_year: community.dbpr_fee_paid_year ?? '',
      dbpr_building_report_filed_at: community.dbpr_building_report_filed_at ?? '',
    })
  }, [community])
  const [dbprSaving, setDbprSaving] = useState(false)
  const saveDbpr = async () => {
    setDbprSaving(true); setError('')
    try {
      const patch = {
        dbpr_account_created_at: (dbprForm.dbpr_account_created_at || '').trim() || null,
        dbpr_fee_paid_year: dbprForm.dbpr_fee_paid_year === '' ? null : Number(dbprForm.dbpr_fee_paid_year),
        dbpr_building_report_filed_at: (dbprForm.dbpr_building_report_filed_at || '').trim() || null,
      }
      const { error } = (await withTimeout(supabase.from('communities').update(patch).eq('id', communityId))) as any
      if (error) throw error
      setMsg('DBPR settings saved.'); load()
    } catch (err: any) { setError(err?.message || 'Could not save DBPR settings') }
    finally { setDbprSaving(false) }
  }

  // ---------- building intake ----------
  const [bForm, setBForm] = useState<any>({ coastal: false })
  const setBF = (k: string, v: any) => setBForm((f: any) => ({ ...f, [k]: v }))
  const [bSaving, setBSaving] = useState(false)

  const createBuilding = async (e: any) => {
    e.preventDefault()
    setBSaving(true); setError('')
    try {
      const insert = {
        community_id: communityId,
        name: (bForm.name || '').trim() || null,
        address: (bForm.address || '').trim() || null,
        stories: bForm.stories ? Number(bForm.stories) : null,
        units: bForm.units ? Number(bForm.units) : null,
        certificate_of_occupancy_date: (bForm.coa || '').trim() || null,
        coastal: !!bForm.coastal,
        notes: (bForm.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_buildings').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id) await logAudit({ community_id: communityId!, event_type: 'structural.building_added', target_type: 'building', target_id: ins.id })
      setBForm({ coastal: false })
      setMsg('Building added.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not add the building') }
    finally { setBSaving(false) }
  }

  // ---------- assessment intake ----------
  const [aForm, setAForm] = useState<any>({ kind: 'milestone' })
  const setAF = (k: string, v: any) => setAForm((f: any) => ({ ...f, [k]: v }))
  const [aSaving, setASaving] = useState(false)

  const createAssessment = async (e: any) => {
    e.preventDefault()
    setASaving(true); setError('')
    try {
      const kind = (aForm.kind || 'milestone') as AssessmentKind
      const due = (aForm.due_date || '').trim() || null
      const buildingId = aForm.building_id || null
      const insert = {
        community_id: communityId,
        building_id: buildingId,
        kind,
        status: aForm.status || 'not_started',
        due_date: due,
        inspection_date: (aForm.inspection_date || '').trim() || null,
        performer_name: (aForm.performer_name || '').trim() || null,
        performer_type: aForm.performer_type || null,
        performer_license: (aForm.performer_license || '').trim() || null,
        notes: (aForm.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_structural_assessments').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id) await logAudit({ community_id: communityId!, event_type: 'structural.assessment_created', target_type: 'structural_assessment', target_id: ins.id, metadata: { kind } })

      // Auto-create an "inspection" calendar event for the deadline so it shows
      // on /app/schedule and the Up-Next rail. notify=false (no bell spam).
      if (due) {
        const b = buildings.find(x => x.id === buildingId)
        const where = b?.name || b?.address || ''
        try {
          await withTimeout(supabase.from('ev_schedule_events').insert({
            community_id: communityId,
            kind: 'inspection',
            title: `${KIND_LABEL[kind]} due${where ? ` — ${where}` : ''}`,
            event_date: due,
            notify: false,
            created_by: profile?.id ?? null,
          }))
        } catch { /* calendar event is best-effort; never block the assessment */ }
      }

      setAForm({ kind })
      setMsg('Assessment recorded.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not record the assessment') }
    finally { setASaving(false) }
  }

  const updateAssessment = async (id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_structural_assessments').update(patch).eq('id', id))) as any
      if (error) throw error
      if (patch.status) await logAudit({ community_id: communityId!, event_type: 'structural.assessment_status_changed', target_type: 'structural_assessment', target_id: id, metadata: { status: patch.status } })
      load()
    } catch (err: any) { setError(err?.message || 'Could not update'); }
  }

  const componentsByAssessment = useMemo(() => {
    const m = new Map<string, SirsComponentRow[]>()
    for (const c of components) { const k = String(c.assessment_id ?? ''); (m.get(k) || m.set(k, []).get(k)!).push(c) }
    return m
  }, [components])

  // ---------- N/A for HOAs ----------
  if (status === 'ready' && regime === 'hoa') {
    return (
      <div className="admin-page">
        <div className="admin-kicker">Florida compliance</div>
        <h1 className="admin-h1">Structural integrity</h1>
        <div className="admin-note" style={{ marginTop: 16 }}>
          Milestone inspections and Structural Integrity Reserve Studies are condominium
          obligations under FS 553.899 and FS 718.112(2)(g). They do not apply to homeowners’
          associations (FS 720), so there is nothing to track here for this community.
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Structural integrity</h1>
      <p className="admin-dek">
        Track milestone structural inspections (FS 553.899) and the Structural Integrity Reserve
        Study (SIRS, FS 718.112(2)(g)) for each building. We compute every deadline from the
        building’s height and certificate-of-occupancy date; you decide each step.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* Documents */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
            {[
              { type: 'summary', label: 'Structural-compliance summary' },
              { type: 'sirs_notice', label: 'SIRS owner-notification letter' },
              { type: 'dbpr_packet', label: 'DBPR reporting data packet (draft)' },
              { type: 'reserve_worksheet', label: 'Reserve baseline-funding worksheet' },
            ].map(d => (
              <Link key={d.type} href={`/admin/structural/document?type=${d.type}`} className="admin-btn-ghost" style={{ textDecoration: 'none' }}>
                📄 {d.label}
              </Link>
            ))}
          </div>

          {/* DBPR (Division of Florida Condominiums) settings */}
          <section style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #067647', borderRadius: 12, padding: '14px 16px', background: '#fff', marginTop: 8 }}>
            <h2 className="bc-title" style={{ marginBottom: 4 }}>DBPR (Division) filings</h2>
            <p style={{ fontSize: 12.5, opacity: 0.72, margin: '0 0 12px' }}>
              Record your condominium&apos;s Division filings so the dashboard can track them:
              the online account (FS 718.501(1)), the ${DBPR_FEE_PER_UNIT.value}/unit annual fee
              due January 1 (FS 718.501(2) — associations operating more than {DBPR_FEE_MIN_UNITS.value} units),
              and the {DBPR_BUILDING_REPORT_MIN_STORIES.value}+-story building report (FS 718.501(3)).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">DBPR online account created</span>
                <input className="admin-input" type="date" value={dbprForm.dbpr_account_created_at ?? ''} onChange={e => setDbprForm((f: any) => ({ ...f, dbpr_account_created_at: e.target.value }))} /></label>
              <label className="admin-field">
                <span className="admin-field-label">Annual fee — last year paid{(Number(community?.unit_count) || 0) > 0 ? ` (~${'$' + dbprAnnualFee(community?.unit_count).toLocaleString('en-US')})` : ''}</span>
                <input className="admin-input" type="number" min="2000" max="2100" step="1" placeholder="e.g. 2026" value={dbprForm.dbpr_fee_paid_year ?? ''} onChange={e => setDbprForm((f: any) => ({ ...f, dbpr_fee_paid_year: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">{DBPR_BUILDING_REPORT_MIN_STORIES.value}+-story building report filed</span>
                <input className="admin-input" type="date" value={dbprForm.dbpr_building_report_filed_at ?? ''} onChange={e => setDbprForm((f: any) => ({ ...f, dbpr_building_report_filed_at: e.target.value }))} /></label>
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="admin-primary-btn" disabled={dbprSaving} onClick={saveDbpr}>{dbprSaving ? 'Saving…' : 'Save DBPR settings'}</button>
            </div>
          </section>

          {/* Building intake */}
          <form className="admin-form" onSubmit={createBuilding} style={{ marginTop: 24 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Add a building</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">Name</span>
                <input className="admin-input" value={bForm.name ?? ''} placeholder="Tower A" onChange={e => setBF('name', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Address</span>
                <input className="admin-input" value={bForm.address ?? ''} onChange={e => setBF('address', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Stories</span>
                <input className="admin-input" type="number" min="1" step="1" value={bForm.stories ?? ''} onChange={e => setBF('stories', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Units</span>
                <input className="admin-input" type="number" min="0" step="1" value={bForm.units ?? ''} onChange={e => setBF('units', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Certificate-of-occupancy date</span>
                <input className="admin-input" type="date" value={bForm.coa ?? ''} onChange={e => setBF('coa', e.target.value)} /></label>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '10px 0' }}>
              <input type="checkbox" checked={!!bForm.coastal} onChange={e => setBF('coastal', e.target.checked)} />
              Within 3 miles of the coastline (25-year milestone trigger instead of 30)
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={bSaving}>{bSaving ? 'Adding…' : 'Add building'}</button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          {/* Buildings list */}
          <h2 className="bc-title" style={{ margin: '22px 0 10px' }}>Buildings ({buildings.length})</h2>
          {buildings.length === 0 && <div className="admin-note">No buildings yet. Add one above to start tracking milestone and SIRS deadlines.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {buildings.map(b => {
              const due = milestoneInitialDueDate(b.certificate_of_occupancy_date, b.coastal)
              const eligible = isSirsEligible(b.stories)
              return (
                <div key={b.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #175CD3', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name || b.address || b.id.slice(0, 8)}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 3 }}>
                    {b.stories != null ? `${b.stories} stories` : 'stories unknown'} · {b.coastal ? 'coastal' : 'inland'}
                    {b.certificate_of_occupancy_date ? ` · CO ${b.certificate_of_occupancy_date}` : ' · no CO date'}
                    {b.units != null ? ` · ${b.units} units` : ''}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>
                    {!eligible && <span style={{ opacity: 0.6 }}>Below {SIRS_MIN_STORIES.value} stories — milestone/SIRS scheme does not apply.</span>}
                    {eligible && due && <span>Milestone trigger ({milestoneTriggerYears(b.coastal)} yr): <strong>{ymd(due)}</strong></span>}
                    {eligible && !due && <span style={{ color: '#B54708' }}>Add a certificate-of-occupancy date to compute the milestone trigger.</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Assessment intake */}
          <form className="admin-form" onSubmit={createAssessment} style={{ marginTop: 24 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Record an assessment</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">Type</span>
                <select className="admin-input" value={aForm.kind} onChange={e => setAF('kind', e.target.value)}>
                  <option value="milestone">Milestone inspection</option>
                  <option value="sirs">SIRS</option>
                  <option value="turnover">Turnover inspection</option>
                </select></label>
              <label className="admin-field"><span className="admin-field-label">Building (optional)</span>
                <select className="admin-input" value={aForm.building_id ?? ''} onChange={e => setAF('building_id', e.target.value)}>
                  <option value="">— community-wide —</option>
                  {buildings.map(b => <option key={b.id} value={b.id}>{b.name || b.address || b.id.slice(0, 8)}</option>)}
                </select></label>
              <label className="admin-field"><span className="admin-field-label">Status</span>
                <select className="admin-input" value={aForm.status ?? 'not_started'} onChange={e => setAF('status', e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select></label>
              <label className="admin-field"><span className="admin-field-label">{aForm.kind === 'milestone' ? 'Phase 1 due date' : 'Deadline'}</span>
                <input className="admin-input" type="date" value={aForm.due_date ?? ''} onChange={e => setAF('due_date', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Inspection date</span>
                <input className="admin-input" type="date" value={aForm.inspection_date ?? ''} onChange={e => setAF('inspection_date', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Performer name</span>
                <input className="admin-input" value={aForm.performer_name ?? ''} onChange={e => setAF('performer_name', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Performer credential</span>
                <select className="admin-input" value={aForm.performer_type ?? ''} onChange={e => setAF('performer_type', e.target.value)}>
                  <option value="">—</option>
                  {PERFORMER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                </select></label>
              <label className="admin-field"><span className="admin-field-label">License #</span>
                <input className="admin-input" value={aForm.performer_license ?? ''} onChange={e => setAF('performer_license', e.target.value)} /></label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={aSaving}>{aSaving ? 'Saving…' : 'Record assessment'}</button>
            </div>
          </form>

          {/* Assessments list */}
          <h2 className="bc-title" style={{ margin: '22px 0 10px' }}>Assessments ({assessments.length})</h2>
          {assessments.length === 0 && <div className="admin-note">No assessments recorded yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assessments.map(a => (
              <AssessmentCard
                key={a.id}
                a={a}
                buildings={buildings}
                components={componentsByAssessment.get(String(a.id)) || []}
                communityId={communityId!}
                profileId={profile?.id ?? null}
                onUpdate={updateAssessment}
                onChanged={load}
                onError={setError}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AssessmentCard({
  a, buildings, components, communityId, profileId, onUpdate, onChanged, onError,
}: {
  a: StructuralAssessmentRow
  buildings: BuildingRow[]
  components: SirsComponentRow[]
  communityId: string
  profileId: string | null
  onUpdate: (id: string, patch: Record<string, any>) => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [open, setOpen] = useState(false)
  const b = buildings.find(x => x.id === a.building_id)
  const where = b ? (b.name || b.address || b.id.slice(0, 8)) : 'Community-wide'
  const color = STATUS_COLOR[String(a.status)] || '#475467'

  const seedComponents = async () => {
    onError('')
    try {
      const existing = new Set(components.map(c => c.component))
      const rows = SIRS_COMPONENTS.value
        .filter(name => !existing.has(name))
        .map(name => ({ community_id: communityId, assessment_id: a.id, component: name, funding_status: 'not_funded' }))
      if (!rows.length) return
      const { error } = (await withTimeout(supabase.from('ev_sirs_components').insert(rows))) as any
      if (error) throw error
      await logAudit({ community_id: communityId, event_type: 'structural.sirs_recorded', target_type: 'sirs_component', target_id: a.id })
      onChanged()
    } catch (err: any) { onError(err?.message || 'Could not seed components') }
  }

  const updateComponent = async (id: string, patch: Record<string, any>) => {
    onError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_sirs_components').update(patch).eq('id', id))) as any
      if (error) throw error
      onChanged()
    } catch (err: any) { onError(err?.message || 'Could not update component') }
  }

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{KIND_LABEL[String(a.kind)] || String(a.kind)} · {where}</div>
          <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
            {a.due_date ? `Due ${a.due_date}` : 'no deadline'}
            {a.inspection_date ? ` · inspected ${a.inspection_date}` : ''}
            {a.performer_name ? ` · ${a.performer_name}${a.performer_type ? ` (${a.performer_type})` : ''}` : ''}
          </div>
        </div>
        <label className="admin-field" style={{ maxWidth: 180 }}>
          <span className="admin-field-label">Status</span>
          <select className="admin-input" value={String(a.status)} onChange={e => onUpdate(a.id, { status: e.target.value })}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>

      {/* Milestone lifecycle quick-fields */}
      {a.kind === 'milestone' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5 }}>
          <DateField label="Report received" value={a.report_received_at} onSet={v => onUpdate(a.id, { report_received_at: v })} />
          <DateField label="Owner summary sent" value={a.owner_notice_sent_at} onSet={v => onUpdate(a.id, { owner_notice_sent_at: v })} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!a.requires_phase_2} onChange={e => onUpdate(a.id, { requires_phase_2: e.target.checked })} />
            Phase 2 required
          </label>
          {a.requires_phase_2 && (
            <>
              <DateField label="Phase 2 due" value={a.phase_2_due} onSet={v => onUpdate(a.id, { phase_2_due: v })} />
              <DateField label="Repairs commence by" value={a.repair_commence_due} onSet={v => onUpdate(a.id, { repair_commence_due: v })} />
            </>
          )}
        </div>
      )}

      {/* SIRS components */}
      {a.kind === 'sirs' && (
        <div style={{ marginTop: 10 }}>
          <button className="admin-btn-ghost" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : 'Manage'} components ({components.length}/{SIRS_COMPONENTS.value.length})
          </button>
          {open && (
            <div style={{ marginTop: 10 }}>
              {components.length === 0 && (
                <button className="admin-primary-btn" onClick={seedComponents}>Seed the {SIRS_COMPONENTS.value.length} mandatory components</button>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {components.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 6 }}>
                    <span style={{ flex: '1 1 200px', fontSize: 13, fontWeight: 600 }}>{c.component}</span>
                    <input className="admin-input" style={{ maxWidth: 130 }} type="number" min="0" step="100" placeholder="est. cost"
                      defaultValue={c.estimated_cost ?? ''} onBlur={e => updateComponent(c.id, { estimated_cost: e.target.value === '' ? null : Number(e.target.value) })} />
                    <select className="admin-input" style={{ maxWidth: 150 }} value={String(c.funding_status ?? 'not_funded')}
                      onChange={e => updateComponent(c.id, { funding_status: e.target.value })}>
                      <option value="not_funded">Not funded</option>
                      <option value="underfunded">Underfunded</option>
                      <option value="fully_funded">Fully funded</option>
                    </select>
                  </div>
                ))}
              </div>
              {components.length > 0 && (
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                  Total estimated component cost: {fmt$(components.reduce((s, c) => s + (Number(c.estimated_cost) || 0), 0))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DateField({ label, value, onSet }: { label: string; value?: string | null; onSet: (v: string | null) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <input className="admin-input" style={{ maxWidth: 150 }} type="date" defaultValue={value ?? ''}
        onChange={e => onSet(e.target.value || null)} />
    </label>
  )
}
