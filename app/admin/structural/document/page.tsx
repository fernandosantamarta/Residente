'use client'

// Structural documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders each structural artifact for the community: a structural-
// compliance summary, the SIRS owner-notification letter, a DBPR reporting DATA
// PACKET (a draft/aid that organises what a filing needs — NOT an official
// filing), and a reserve baseline-funding worksheet. Every artifact is a
// DRAFT/aid and the language requires attorney review before use.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  SIRS_COMPONENTS, SIRS_INITIAL_DEADLINE, SIRS_ABSOLUTE_CAP, SIRS_FULL_FUNDING_EFFECTIVE,
  DBPR_ACCOUNT_REQUIRED_SINCE, SIRS_MIN_STORIES,
  milestoneInitialDueDate, milestoneTriggerYears, isSirsEligible,
  type BuildingRow, type StructuralAssessmentRow, type SirsComponentRow,
} from '@/lib/compliance/structural'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'summary' | 'sirs_notice' | 'dbpr_packet' | 'reserve_worksheet'

const TITLES: Record<DocType, string> = {
  summary:           'Structural Compliance Summary',
  sirs_notice:       'Notice to Owners — Structural Integrity Reserve Study',
  dbpr_packet:       'Milestone / Structural Reporting Data Packet',
  reserve_worksheet: 'Reserve Baseline-Funding Worksheet',
}

export default function StructuralDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.structuralDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'summary') as DocType

  const [community, setCommunity] = useState<any>(null)
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [assessments, setAssessments] = useState<StructuralAssessmentRow[]>([])
  const [components, setComponents] = useState<SirsComponentRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: comm, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const { data: b } = (await withTimeout(supabase.from('ev_buildings').select('*').eq('community_id', communityId).order('created_at', { ascending: true }))) as any
        const { data: a } = (await withTimeout(supabase.from('ev_structural_assessments').select('*').eq('community_id', communityId).order('created_at', { ascending: false }))) as any
        const { data: comp } = (await withTimeout(supabase.from('ev_sirs_components').select('*').eq('community_id', communityId))) as any
        if (cancelled) return
        setCommunity(comm || null)
        setBuildings(b || [])
        setAssessments(a || [])
        setComponents(comp || [])
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.structuralDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const isCondo = community?.association_type !== 'hoa'

  // Convenience views
  const eligible = buildings.filter(b => isSirsEligible(b.stories))
  const completed = (kind: string, buildingId?: string | null) => assessments.find(a =>
    a.kind === kind && (a.status === 'completed' || a.status === 'report_received') &&
    (buildingId == null || a.building_id == null || a.building_id === buildingId))
  const sirsComponents = components
  const totalComponentCost = sirsComponents.reduce((s, c) => s + (Number(c.estimated_cost) || 0), 0)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {t('admin.structuralDocument.draftWarningBase')}{type === 'dbpr_packet' && t('admin.structuralDocument.draftWarningDbpr')}{t('admin.structuralDocument.draftWarningConfirm')}
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>{t('admin.structuralDocument.printButton')}</button>
      </div>

      {!isCondo && (
        <div style={{ fontSize: 13, background: '#FFFAEB', color: '#B54708', padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
          {t('admin.structuralDocument.hoaWarning')}
        </div>
      )}

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>set the association address in Community settings</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Structural compliance summary ---------- */}
      {type === 'summary' && (
        <Body>
          <p>This summary reflects the structural-compliance records on file for {community?.name || 'the association'} as of {today}. It is an internal management aid.</p>
          <h3 style={h3}>Condominium DBPR online account</h3>
          <p>{community?.dbpr_account_created_at
            ? `Recorded as created ${ymd(community.dbpr_account_created_at)}.`
            : `Not recorded. A DBPR online account has been required since ${DBPR_ACCOUNT_REQUIRED_SINCE.value} (FS 718.501).`}</p>

          <h3 style={h3}>Buildings &amp; milestone triggers</h3>
          {buildings.length === 0 ? <p><Em>No buildings recorded.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Building</th><th style={th}>Stories</th><th style={th}>CO date</th><th style={th}>Milestone trigger</th><th style={th}>Milestone on file</th><th style={th}>SIRS on file</th>
            </tr></thead><tbody>
              {buildings.map(b => {
                const due = milestoneInitialDueDate(b.certificate_of_occupancy_date, b.coastal)
                const m = completed('milestone', b.id)
                const s = completed('sirs', b.id)
                return (
                  <tr key={b.id}>
                    <td style={td}>{b.name || b.address || b.id.slice(0, 8)}{b.coastal ? ' (coastal)' : ''}</td>
                    <td style={td}>{b.stories ?? <Em>—</Em>}</td>
                    <td style={td}>{b.certificate_of_occupancy_date || <Em>—</Em>}</td>
                    <td style={td}>{isSirsEligible(b.stories) ? (due ? `${ymd(due)} (${milestoneTriggerYears(b.coastal)} yr)` : <Em>need CO date</Em>) : 'n/a (<3 stories)'}</td>
                    <td style={td}>{m ? (m.inspection_date || 'yes') : <Em>none</Em>}</td>
                    <td style={td}>{s ? (s.inspection_date || 'yes') : <Em>none</Em>}</td>
                  </tr>
                )
              })}
            </tbody></table>
          )}

          <h3 style={h3}>SIRS deadlines</h3>
          <p>Initial SIRS deadline: <strong>{SIRS_INITIAL_DEADLINE.value}</strong>; absolute backstop <strong>{SIRS_ABSOLUTE_CAP.value}</strong>. Reserves for SIRS components must be fully funded for budgets adopted on/after <strong>{SIRS_FULL_FUNDING_EFFECTIVE.value}</strong>. Applies to buildings {SIRS_MIN_STORIES.value}+ stories.</p>
          <p style={cite}>Sources: FS 553.899 (milestone); FS 718.112(2)(g) (SIRS); FS 718.501 (DBPR account). Values require attorney confirmation.</p>
        </Body>
      )}

      {/* ---------- SIRS owner-notification letter ---------- */}
      {type === 'sirs_notice' && (
        <Body>
          <p>Dear Owner,</p>
          <p>As required by Florida law, the association has {completed('sirs') ? 'completed' : 'undertaken'} a Structural Integrity Reserve Study (SIRS) for the association&apos;s building(s) of {SIRS_MIN_STORIES.value} or more habitable stories. This letter summarises the study and its effect on the association&apos;s reserves.</p>
          <p>A SIRS evaluates the remaining useful life and estimated replacement cost of the following structural components and recommends a reserve-funding schedule for each:</p>
          <ul style={{ marginTop: 6 }}>
            {SIRS_COMPONENTS.value.map(name => <li key={name}>{name}</li>)}
          </ul>
          {sirsComponents.length > 0 ? (
            <>
              <p>The study identifies an estimated total component cost of <strong>{fmt$(totalComponentCost)}</strong> across {sirsComponents.length} recorded component(s). The detailed schedule is available from the association upon request.</p>
            </>
          ) : (
            <p><Em>Component figures will be inserted from the completed study.</Em></p>
          )}
          <p>Beginning with budgets adopted on or after <strong>{SIRS_FULL_FUNDING_EFFECTIVE.value}</strong>, reserves for these components must be fully funded and may not be waived or reduced by a vote of the members. The association&apos;s proposed budget will reflect the funding the SIRS requires.</p>
          <p>Questions about the study or the association&apos;s reserves may be directed to {community?.association_officer_name || <Em>the association officer</Em>}.</p>
          <p style={cite}>Provided under FS 718.112(2)(g). The exact component list, deadlines, and funding obligations must be confirmed with the association&apos;s attorney.</p>
          <Sign name={community?.association_officer_name} assoc={community?.name} />
        </Body>
      )}

      {/* ---------- DBPR reporting data packet (DRAFT/aid) ---------- */}
      {type === 'dbpr_packet' && (
        <Body>
          <p style={{ fontSize: 12.5, color: '#B42318', fontWeight: 700 }}>DRAFT DATA PACKET — NOT AN OFFICIAL FILING. This document organises the information a milestone-inspection / structural report typically requires so it can be reviewed and then submitted through the proper DBPR or local-enforcement channel by an authorised person.</p>
          <h3 style={h3}>Association</h3>
          <table style={tbl}><tbody>
            <Trow label="Association name" value={community?.name} />
            <Trow label="Address" value={community?.association_address} />
            <Trow label="Authorized officer / agent" value={community?.association_officer_name} />
            <Trow label="DBPR online account created" value={community?.dbpr_account_created_at ? ymd(community.dbpr_account_created_at) : <Em>not recorded</Em>} />
            <Trow label="Total units" value={community?.unit_count ?? <Em>—</Em>} />
          </tbody></table>

          <h3 style={h3}>Buildings</h3>
          {buildings.length === 0 ? <p><Em>No buildings recorded.</Em></p> : buildings.map(b => (
            <table key={b.id} style={{ ...tbl, marginBottom: 10 }}><tbody>
              <Trow label="Building" value={b.name || b.address} />
              <Trow label="Address" value={b.address} />
              <Trow label="Stories" value={b.stories} />
              <Trow label="Units" value={b.units} />
              <Trow label="Certificate-of-occupancy date" value={b.certificate_of_occupancy_date} />
              <Trow label="Within 3 mi of coastline" value={b.coastal ? 'Yes (25-yr trigger)' : 'No (30-yr trigger)'} />
              <Trow label="Computed milestone trigger" value={(() => { const d = milestoneInitialDueDate(b.certificate_of_occupancy_date, b.coastal); return d ? ymd(d) : '—' })()} />
            </tbody></table>
          ))}

          <h3 style={h3}>Inspections / assessments</h3>
          {assessments.length === 0 ? <p><Em>None recorded.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Type</th><th style={th}>Status</th><th style={th}>Inspection date</th><th style={th}>Performer</th><th style={th}>Credential</th><th style={th}>License</th>
            </tr></thead><tbody>
              {assessments.map(a => (
                <tr key={a.id}>
                  <td style={td}>{a.kind}</td>
                  <td style={td}>{a.status}</td>
                  <td style={td}>{a.inspection_date || <Em>—</Em>}</td>
                  <td style={td}>{a.performer_name || <Em>—</Em>}</td>
                  <td style={td}>{a.performer_type || <Em>—</Em>}</td>
                  <td style={td}>{a.performer_license || <Em>—</Em>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          <p style={cite}>Compiled for review under FS 553.899 / 718.112(2)(g). Confirm the required fields, the recipient agency, and the submission method before filing.</p>
        </Body>
      )}

      {/* ---------- Reserve baseline-funding worksheet ---------- */}
      {type === 'reserve_worksheet' && (
        <Body>
          <p>Baseline reserve-funding worksheet for the SIRS components below. Annual baseline funding is estimated as the estimated replacement cost less the current reserve balance, divided by the remaining useful life. Figures are indicative only.</p>
          {sirsComponents.length === 0 ? <p><Em>No SIRS components recorded yet. Seed them on the SIRS assessment in the Structural workspace.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Component</th><th style={thR}>Est. cost</th><th style={thR}>RUL (yrs)</th><th style={thR}>Current reserve</th><th style={thR}>Annual baseline</th><th style={th}>Funding</th>
            </tr></thead><tbody>
              {sirsComponents.map(c => {
                const cost = Number(c.estimated_cost) || 0
                const rul = Number(c.remaining_useful_life_years) || 0
                const bal = Number(c.current_reserve_balance) || 0
                const annual = rul > 0 ? Math.max(0, (cost - bal) / rul) : 0
                return (
                  <tr key={c.id}>
                    <td style={td}>{c.component}</td>
                    <td style={tdR}>{cost ? fmt$(cost) : <Em>—</Em>}</td>
                    <td style={tdR}>{rul || <Em>—</Em>}</td>
                    <td style={tdR}>{bal ? fmt$(bal) : <Em>—</Em>}</td>
                    <td style={tdR}>{rul > 0 ? fmt$(annual) : <Em>set RUL</Em>}</td>
                    <td style={td}>{String(c.funding_status || 'not_funded').replace('_', ' ')}</td>
                  </tr>
                )
              })}
              <tr><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Total</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(totalComponentCost)}</td><td style={td} colSpan={4}></td></tr>
            </tbody></table>
          )}
          <p style={cite}>For budgets adopted on/after {SIRS_FULL_FUNDING_EFFECTIVE.value}, SIRS-component reserves must be fully funded and may not be waived (FS 718.112(2)(g)). This worksheet is an estimate; a reserve professional should prepare the controlling funding plan.</p>
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function Sign({ name, assoc }: { name?: string | null; assoc?: string | null }) {
  return (
    <div style={{ marginTop: 36, fontSize: 14 }}>
      <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{name || 'Authorized officer / agent'}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{assoc || 'Association'}</div>
    </div>
  )
}

function Trow({ label, value }: { label: string; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}

const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
