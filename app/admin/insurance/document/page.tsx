'use client'

// Insurance documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders each insurance artifact: an insurance-compliance summary, a
// replacement-cost appraisal REQUEST letter (condo, a draft to an appraiser),
// and a fidelity-bond adequacy worksheet (the max-funds-in-custody check).
// Every artifact is a DRAFT/aid and the language requires attorney review.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  PROPERTY_APPRAISAL_INTERVAL_MONTHS, FIDELITY_BOND_COVERED_PERSONS, FIDELITY_BOND_FLOOR_NOTE,
  HOA_FIDELITY_BOND_WAIVER_BASIS,
  appraisalNextDue, estimatedMaxFunds, currentFiscalYear,
  type InsurancePolicyRow, type ReserveBalanceRow,
} from '@/lib/compliance/insurance'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'summary' | 'appraisal_request' | 'bond_worksheet'

const TITLES: Record<DocType, string> = {
  summary:           'Insurance Compliance Summary',
  appraisal_request: 'Request for Replacement-Cost Appraisal',
  bond_worksheet:    'Fidelity-Bond Adequacy Worksheet',
}

export default function InsuranceDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.insuranceDocument.loading')}</div>}>
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
  const [policies, setPolicies] = useState<InsurancePolicyRow[]>([])
  const [reserves, setReserves] = useState<ReserveBalanceRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: comm, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const { data: p } = (await withTimeout(supabase.from('ev_insurance_policies').select('*').eq('community_id', communityId).order('created_at', { ascending: false }))) as any
        const { data: r } = (await withTimeout(supabase.from('ev_reserve_components').select('current_balance').eq('community_id', communityId))) as any
        if (cancelled) return
        setCommunity(comm || null)
        setPolicies(p || [])
        setReserves(r || [])
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.insuranceDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const isCondo = community?.association_type !== 'hoa'

  const property = policies.find(p => p.kind === 'property') || null
  const bond = policies.find(p => p.kind === 'fidelity_bond') || null
  const maxFunds = estimatedMaxFunds(community, reserves)
  const reserveSum = reserves.reduce((s, r) => s + (Number(r.current_balance) || 0), 0)
  const bondAmount = Number(bond?.amount) || 0
  const bondGap = maxFunds - bondAmount

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
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {t('admin.insuranceDocument.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.insuranceDocument.printSaveAsPdf')}</button>
        </div>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>set the association address in Community settings</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Insurance compliance summary ---------- */}
      {type === 'summary' && (
        <Body>
          <p>This summary reflects the insurance records on file for {community?.name || 'the association'} as of {today}. It is an internal management aid.</p>

          {isCondo && (
            <>
              <h3 style={h3}>Property insurance &amp; replacement-cost appraisal (FS 718.111(11)(a))</h3>
              {property ? (
                <table style={tbl}><tbody>
                  <Trow label="Carrier" value={property.carrier} />
                  <Trow label="Policy #" value={property.policy_number} />
                  <Trow label="Coverage amount" value={property.amount != null ? fmt$(property.amount) : <Em>—</Em>} />
                  <Trow label="Replacement-cost value" value={property.replacement_cost_value != null ? fmt$(property.replacement_cost_value) : <Em>—</Em>} />
                  <Trow label="Effective / expiration" value={`${property.effective_date || '—'} → ${property.expiration_date || '—'}`} />
                  <Trow label="Last appraisal" value={property.last_appraisal_date || <Em>not recorded</Em>} />
                  <Trow label={`Next appraisal due (every ${PROPERTY_APPRAISAL_INTERVAL_MONTHS.value} mo)`} value={(() => { const d = appraisalNextDue(property.last_appraisal_date); return d ? ymd(d) : <Em>record an appraisal date</Em> })()} />
                </tbody></table>
              ) : <p><Em>No property policy recorded.</Em></p>}
            </>
          )}

          <h3 style={h3}>Fidelity bond (FS {isCondo ? '718.111(11)(h)' : '720.3033(5)'})</h3>
          {bond ? (
            <table style={tbl}><tbody>
              <Trow label="Carrier" value={bond.carrier} />
              <Trow label="Bond #" value={bond.policy_number} />
              <Trow label="Bond amount" value={bond.amount != null ? fmt$(bond.amount) : <Em>—</Em>} />
              <Trow label="Effective / expiration" value={`${bond.effective_date || '—'} → ${bond.expiration_date || '—'}`} />
              <Trow label="Estimated max funds in custody" value={maxFunds > 0 ? fmt$(maxFunds) : <Em>not estimated</Em>} />
              <Trow label="Meets estimated floor?" value={maxFunds > 0 ? (bondAmount >= maxFunds ? 'Yes' : <Em>No — short {fmt$(Math.max(0, bondGap))}</Em>) : <Em>unknown</Em>} />
            </tbody></table>
          ) : (
            <p>{!isCondo && Number(community?.fidelity_bond_waiver_fy) === currentFiscalYear(community)
              ? <>No bond on file. The members have <strong>waived</strong> the fidelity bond for FY{currentFiscalYear(community)} ({HOA_FIDELITY_BOND_WAIVER_BASIS.value}); the waiver must be renewed annually.</>
              : <Em>No fidelity bond recorded.</Em>}</p>
          )}
          <p style={{ fontSize: 12.5, marginTop: 8 }}>The bond must cover {FIDELITY_BOND_FLOOR_NOTE.value}, for: {FIDELITY_BOND_COVERED_PERSONS.value.join('; ')}.</p>
          <p style={cite}>Sources: FS 718.111(11)(a)/(h) (condo); FS 720.3033(5) (HOA). Values require attorney confirmation.</p>
        </Body>
      )}

      {/* ---------- Replacement-cost appraisal request (condo) ---------- */}
      {type === 'appraisal_request' && (
        <Body>
          {!isCondo && (
            <div style={{ fontSize: 13, background: '#FFFAEB', color: '#B54708', padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
              The replacement-cost appraisal duty (FS 718.111(11)(a)) is a condominium obligation; this community is recorded as an HOA, so this request may not apply.
            </div>
          )}
          <p>To: <Em>appraiser / firm name &amp; address</Em></p>
          <p>Re: Independent replacement-cost insurance appraisal — {community?.name || 'the association'}</p>
          <p>Dear Appraiser,</p>
          <p>
            {community?.name || 'The association'} requests an independent appraisal of the full replacement cost of
            the association&apos;s insurable property, as required by Section 718.111(11)(a), Florida Statutes. Florida
            condominium associations must base their property insurance on replacement cost and have that value
            redetermined by independent appraisal at least once every {PROPERTY_APPRAISAL_INTERVAL_MONTHS.value} months.
          </p>
          {property?.last_appraisal_date ? (
            <p>Our most recent appraisal on file is dated {property.last_appraisal_date}{(() => { const d = appraisalNextDue(property.last_appraisal_date); return d ? `, so a redetermination is due by ${ymd(d)}` : '' })()}.</p>
          ) : (
            <p><Em>No prior appraisal date is on file; please treat this as the baseline replacement-cost appraisal.</Em></p>
          )}
          <p>Please provide a written appraisal that states the appraised replacement-cost value, the date of determination, and the methodology used, addressed to the association. We will keep your appraisal with the association&apos;s insurance records.</p>
          <p>Questions may be directed to {community?.association_officer_name || <Em>the association officer</Em>}.</p>
          <p style={cite}>Requested under FS 718.111(11)(a). The exact scope of insurable property and the controlling appraisal interval must be confirmed with the association&apos;s attorney and insurance agent.</p>
          <Sign name={community?.association_officer_name} assoc={community?.name} />
        </Body>
      )}

      {/* ---------- Fidelity-bond adequacy worksheet ---------- */}
      {type === 'bond_worksheet' && (
        <Body>
          <p>This worksheet compares the association&apos;s recorded fidelity bond against an estimate of the maximum funds in its custody. The statutory floor is {FIDELITY_BOND_FLOOR_NOTE.value} (FS {isCondo ? '718.111(11)(h)' : '720.3033(5)'}). Figures are indicative — confirm the true peak balance with the manager and the bond with your insurance agent.</p>
          <table style={tbl}><tbody>
            <Trow label="Operating + reserve balances (recorded reserves)" value={reserveSum > 0 ? fmt$(reserveSum) : <Em>no reserve balances recorded</Em>} />
            <Trow label="Board estimate of max funds in custody" value={Number(community?.estimated_max_funds) > 0 ? fmt$(community.estimated_max_funds) : <Em>not entered</Em>} />
            <Trow label="Estimated bond floor (the greater basis used)" value={maxFunds > 0 ? fmt$(maxFunds) : <Em>unknown</Em>} />
            <Trow label="Recorded fidelity bond amount" value={bond ? fmt$(bondAmount) : <Em>no bond recorded</Em>} />
            <Trow label="Shortfall (floor − bond)" value={maxFunds > 0 ? (bondGap > 0 ? <Em>{fmt$(bondGap)} short</Em> : '$0 — meets the estimate') : <Em>unknown</Em>} />
          </tbody></table>
          {!isCondo && Number(community?.fidelity_bond_waiver_fy) === currentFiscalYear(community) && (
            <p style={{ fontSize: 12.5, marginTop: 8 }}>Note: the members have waived the fidelity bond for FY{currentFiscalYear(community)} ({HOA_FIDELITY_BOND_WAIVER_BASIS.value}). The waiver is effective one fiscal year only.</p>
          )}
          <h3 style={h3}>Persons the bond must cover</h3>
          <ul style={{ marginTop: 6 }}>
            {FIDELITY_BOND_COVERED_PERSONS.value.map(name => <li key={name}>{name}</li>)}
          </ul>
          <p style={cite}>Prepared under FS 718.111(11)(h) / 720.3033(5). The maximum-funds-in-custody figure here is an estimate; confirm the controlling amount with the association&apos;s manager and counsel.</p>
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

function Trow({ label, value }: { label: any; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '52%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}

const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
