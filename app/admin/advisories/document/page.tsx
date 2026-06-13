'use client'

// Advisory documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders: the developer-turnover checklist (HOA 720.307 (a)-(t), or a
// condo turnover-transition summary), a receivership notice-of-intent draft, and
// a presuit-mediation demand draft. Every artifact is a DRAFT/aid and the
// language requires attorney review.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  TURNOVER_DOC_CHECKLIST, TURNOVER_CALL_DAYS, TURNOVER_ELECTION_NOTICE_DAYS,
  TURNOVER_DOC_DELIVERY_DAYS, RECEIVERSHIP_CURE_DAYS,
} from '@/lib/compliance/advisories'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'turnover_checklist' | 'receivership_notice' | 'mediation_demand'

const TITLES: Record<DocType, string> = {
  turnover_checklist:  'Developer-Turnover Document Checklist',
  receivership_notice: 'Notice of Intent to Apply for Receivership',
  mediation_demand:    'Demand for Presuit Mediation',
}

export default function AdvisoryDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.advisoriesDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'turnover_checklist') as DocType

  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError(t('admin.advisoriesDocument.errNoCommunity')); return }
      try {
        const { data: comm, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        if (cancelled) return
        setCommunity(comm || null)
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || t('admin.advisoriesDocument.errCouldNotLoad')); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.advisoriesDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const isCondo = regime !== 'hoa'
  const entity = isCondo ? 'unit owner' : 'parcel owner / member'

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {t('admin.advisoriesDocument.draftBanner')}
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>{t('admin.advisoriesDocument.printButton')}</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.advisoriesDocument.setAddressHint')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Turnover checklist / summary ---------- */}
      {type === 'turnover_checklist' && (
        <Body>
          {isCondo ? (
            <>
              <p>Condominium developer-to-owner turnover transition summary for {community?.name || 'the association'}. When the unit owners other than the developer are entitled to elect board members, the association must <strong>call the turnover election within {TURNOVER_CALL_DAYS.value} days</strong> of the triggering event and give <strong>at least {TURNOVER_ELECTION_NOTICE_DAYS.value} days' notice</strong> of it (FS 718.301(2)). Record the trigger date in the Advisories workspace to track the clock.</p>
              <p>At turnover the developer must also deliver the association's records and financial materials. Use the checklist below as a starting point and confirm the controlling list (FS 718.301(4)) with counsel.</p>
            </>
          ) : (
            <p>Homeowners'-association developer turnover: the developer must deliver the following records to the association, at the developer's expense, <strong>within {TURNOVER_DOC_DELIVERY_DAYS.value} days</strong> of the turnover (FS 720.307(4)). Check off each item as received.</p>
          )}
          <table style={tbl}><thead><tr>
            <th style={{ ...th, width: 36 }}>✓</th><th style={th}>Document / record</th>
          </tr></thead><tbody>
            {TURNOVER_DOC_CHECKLIST.value.map((t, i) => (
              <tr key={i}><td style={{ ...td, textAlign: 'center' }}>☐</td><td style={td}>{t}</td></tr>
            ))}
          </tbody></table>
          <p style={cite}>{isCondo ? 'Condo turnover: FS 718.301. The delivery list shown follows the HOA 720.307(4) enumeration as a practical baseline; confirm the controlling condo list (718.301(4)) with counsel.' : 'Provided under FS 720.307(4). Items are "if applicable"; confirm the controlling enumeration with the association attorney.'}</p>
        </Body>
      )}

      {/* ---------- Receivership notice of intent ---------- */}
      {type === 'receivership_notice' && (
        <Body>
          <p style={{ fontSize: 12.5, color: '#B42318', fontWeight: 700 }}>DRAFT NOTICE — to be served by an owner/member, not the association. This organises the statutory notice of intent; confirm the exact statutory form before serving.</p>
          <p>TO: {community?.name || 'the Association'} and all {isCondo ? 'unit owners' : 'members'}</p>
          <p>NOTICE OF INTENT TO APPLY FOR THE APPOINTMENT OF A RECEIVER</p>
          <p>The board of directors of {community?.name || 'the association'} has failed to fill vacancies sufficient to constitute a quorum. As permitted by {isCondo ? 'Section 718.1124' : 'Section 720.3053'}, Florida Statutes, the undersigned {entity} intends to apply to the circuit court for the appointment of a receiver to manage the affairs of the association.</p>
          <p><strong>This petition will not be filed if the vacancies are filled within {RECEIVERSHIP_CURE_DAYS.value} days after the date on which this notice was sent or posted, whichever is later.</strong></p>
          <p>This notice must be sent to the association by certified mail or personal delivery, posted in a conspicuous place on the {isCondo ? 'condominium' : 'community'} property, and provided to every other {isCondo ? 'unit owner' : 'member'}, at least {RECEIVERSHIP_CURE_DAYS.value} days before any petition is filed.</p>
          <p style={cite}>Statutory basis: {isCondo ? 'FS 718.1124' : 'FS 720.3053'}. The association does not file this notice — an owner/member does. There is no notice to the Division. Confirm the controlling statutory form and service requirements with an attorney.</p>
          <Sign name="Owner / member" assoc={community?.name} />
        </Body>
      )}

      {/* ---------- Presuit mediation demand ---------- */}
      {type === 'mediation_demand' && (
        <Body>
          <p>TO: <Em>responding party (name &amp; address)</Em></p>
          <p>RE: Statutory Demand for Presuit Mediation — {community?.name || 'the association'}</p>
          <p>Pursuant to {isCondo ? 'Section 718.1255' : 'Section 720.311'}, Florida Statutes, the undersigned demands that you participate in presuit mediation of the following dispute before any party files suit:</p>
          <p style={{ margin: '8px 0', padding: '10px 12px', background: '#F8F8F8', borderRadius: 8 }}><Em>Describe the dispute (e.g., a covenant-enforcement, use, meeting-notice, or records dispute). Note: assessment-collection, fining, and election/recall disputes follow a different path.</Em></p>
          <p>{isCondo
            ? 'For condominium disputes, a party may petition the Division for nonbinding arbitration or initiate presuit mediation, except election and recall disputes, which go to Division arbitration or court.'
            : 'The parties shall select a mutually acceptable Florida Supreme Court–certified circuit civil mediator. A party who refuses to participate in presuit mediation may forfeit the right to recover attorney’s fees in subsequent litigation.'}</p>
          <p>Please respond within the time provided by the statute to identify a mediator and available dates.</p>
          <p style={cite}>Statutory basis: {isCondo ? 'FS 718.1255' : 'FS 720.311'}. This is a process aid, not legal advice; the categories of covered disputes, the required form, and the response deadlines must be confirmed with an attorney.</p>
          <Sign name="Demanding party" assoc={community?.name} />
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
      <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{name || 'Signature'}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{assoc || 'Association'}</div>
    </div>
  )
}

const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
