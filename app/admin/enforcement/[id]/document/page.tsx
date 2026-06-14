'use client'

// Enforcement documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders each statutory artifact for a violation/fine:
//   • violation_notice — notice of the rule violation + opportunity to cure
//   • hearing_notice    — the 14-day notice of an opportunity for a hearing
//                          before the independent fining committee
//   • decision          — the committee's written decision after the hearing
// Every artifact is a DRAFT/aid, not an official filing; the language requires
// attorney review before use. FS 718.303 (condo) / FS 720.305 (HOA).

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, addCalendarDays } from '@/lib/compliance/rules-core'
import {
  fineAccrued, hearingReadyDate, HEARING_NOTICE_DAYS, FINING_COMMITTEE_MIN, FINE_AGGREGATE_CAP,
  type ViolationRow, type HearingRow,
} from '@/lib/compliance/enforcement'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'violation_notice' | 'hearing_notice' | 'decision'

const TITLES: Record<DocType, string> = {
  violation_notice: 'Notice of Violation',
  hearing_notice:   'Notice of Opportunity for a Hearing',
  decision:         'Decision of the Fining Committee',
}

export default function EnforcementDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.enforcementDetailDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const params = useParams()
  const search = useSearchParams()
  const id = params?.id as string
  const type = (search?.get('type') || 'violation_notice') as DocType

  const [v, setV] = useState<ViolationRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [hearing, setHearing] = useState<HearingRow | null>(null)
  const [committee, setCommittee] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError(t('admin.enforcementDetailDocument.noViolation')); return }
      try {
        const { data: vio, error: vErr } = (await withTimeout(supabase.from('ev_violations').select('*').eq('id', id).single())) as any
        if (vErr) throw vErr
        const { data: comm } = (await withTimeout(supabase.from('communities').select('*').eq('id', vio.community_id).single())) as any
        const { data: hs } = (await withTimeout(
          supabase.from('ev_violation_hearings').select('*').eq('violation_id', id).order('notice_sent_at', { ascending: false }).limit(1),
        )) as any
        let cm: any[] = []
        try {
          const { data } = (await withTimeout(
            supabase.from('ev_fining_committee_members').select('*').eq('community_id', vio.community_id).eq('active', true),
          )) as any
          cm = data || []
        } catch { cm = [] }
        if (cancelled) return
        setV(vio); setCommunity(comm || null); setHearing((hs && hs[0]) || null); setCommittee(cm); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || t('admin.enforcementDetailDocument.couldNotLoad')); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.enforcementDetailDocument.loading')}</div>
  if (status === 'error' || !v) return <div style={{ padding: 40, color: '#B42318' }}>{error || t('admin.enforcementDetailDocument.notFound')}</div>

  const isCondo = community?.association_type !== 'hoa'
  const today = ymd(new Date())
  const owner = v.resident_label || 'Owner of record'
  const fine = fineAccrued(v)
  const ready = hearingReadyDate(hearing)
  const hearingDeadline = hearing?.notice_sent_at ? ymd(ready) : ymd(addCalendarDays(today, HEARING_NOTICE_DAYS.value))
  const cite = (condo: string, hoa: string) => (isCondo ? condo : hoa)
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>

  const fineLabel = v.fine_continuing
    ? `$${Number(v.fine_per_day) || 0}/day for a continuing violation (aggregate to date ${fmt$(fine.capped)}${fine.atCap ? `, at the $${FINE_AGGREGATE_CAP.value.toLocaleString('en-US')} cap` : ''})`
    : v.amount != null ? fmt$(v.amount) : null

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
          {t('admin.enforcementDetailDocument.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.enforcementDetailDocument.printSaveAsPdf')}</button>
        </div>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.enforcementDetailDocument.setAddressHint')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 4 }}>{TITLES[type]}</h1>

      {/* Recipient */}
      <div style={{ fontSize: 13.5, marginBottom: 14 }}>
        <div>{owner}</div>
        <div>Re: {v.rule_title || 'Rule / covenant violation'}</div>
      </div>

      {type === 'violation_notice' && (
        <div style={{ fontSize: 14 }}>
          <p>This letter is to notify you that the association has determined that a violation of the governing documents has occurred with respect to your {isCondo ? 'unit' : 'parcel'}: <strong>{v.rule_title || <Em>describe the violation</Em>}</strong>.</p>
          {v.cure_by && <p>Please correct this violation on or before <strong>{v.cure_by}</strong>. If the violation is corrected by that date, no fine will be imposed.</p>}
          <p>If the violation is not corrected, the association may levy a fine of up to <strong>$100 per violation</strong>{v.fine_continuing ? ', and for a continuing violation a fine may be levied for each day the violation continues' : ''}, subject to an aggregate cap of <strong>${FINE_AGGREGATE_CAP.value.toLocaleString('en-US')}</strong>{isCondo ? '' : ' unless the governing documents provide otherwise'}. {isCondo ? 'A fine may not become a lien against a condominium unit.' : 'An HOA fine of less than $1,000 may not become a lien against the parcel.'}</p>
          <p>Before any fine {isCondo ? 'or suspension ' : ''}is imposed, you will be given at least {HEARING_NOTICE_DAYS.value} days&apos; written notice and an opportunity for a hearing before a committee of at least {FINING_COMMITTEE_MIN.value} members who are independent of the board.</p>
          <p style={{ fontSize: 12, color: '#555' }}>This notice is provided under {cite('Florida Statutes § 718.303(3)', 'Florida Statutes § 720.305(2)')} and the association&apos;s governing documents.</p>
        </div>
      )}

      {type === 'hearing_notice' && (
        <div style={{ fontSize: 14 }}>
          <p>The association proposes to levy a fine{fineLabel ? <> of <strong>{fineLabel}</strong></> : ''} for the violation described above{v.fine_continuing ? '' : ''}.</p>
          <p>You are entitled to a hearing before an independent committee of at least {FINING_COMMITTEE_MIN.value} members before the fine {isCondo ? 'or suspension ' : ''}may be imposed. <strong>The hearing will be held no sooner than {HEARING_NOTICE_DAYS.value} days after the date of this notice</strong> — that is, on or after <strong>{hearingDeadline}</strong>{hearing?.scheduled_at ? <>, and is currently scheduled for <strong>{hearing.scheduled_at}</strong></> : ''}.</p>
          <p>At the hearing you may attend, be represented, present evidence, and respond to the alleged violation. If the committee, by majority vote, does not approve the proposed fine{isCondo ? ' or suspension' : ''}, it may not be imposed.</p>
          <p style={{ fontSize: 12, color: '#555' }}>This notice is provided under {cite('Florida Statutes § 718.303(3)(b)', 'Florida Statutes § 720.305(2)(b)')}.</p>
        </div>
      )}

      {type === 'decision' && (
        <div style={{ fontSize: 14 }}>
          <p>A hearing was {hearing?.held_at ? <>held on <strong>{hearing.held_at}</strong></> : 'held'} before the association&apos;s independent fining committee regarding the violation described above.</p>
          <table style={tbl}><tbody>
            <Trow label="Committee members present" value={hearing?.committee_present ?? <Em>record</Em>} />
            <Trow label="Votes to uphold" value={hearing?.vote_for ?? <Em>record</Em>} />
            <Trow label="Votes against" value={hearing?.vote_against ?? <Em>record</Em>} />
            <Trow label="Decision" value={
              v.enforcement_stage === 'rejected' || hearing?.decision === 'rejected'
                ? 'The proposed fine was NOT approved and may not be imposed.'
                : `The proposed fine was approved${fineLabel ? `: ${fineLabel}` : ''}.`
            } />
          </tbody></table>
          {hearing?.minutes && <p style={{ marginTop: 10 }}><strong>Findings:</strong> {hearing.minutes}</p>}
          {committee.length > 0 && (
            <p style={{ fontSize: 12, color: '#555', marginTop: 10 }}>
              Committee of record: {committee.map(m => m.full_name).filter(Boolean).join(', ')}.
            </p>
          )}
          <p style={{ fontSize: 12, color: '#555' }}>Decided under {cite('Florida Statutes § 718.303(3)(b)', 'Florida Statutes § 720.305(2)(b)')}. A fine {isCondo ? 'may not become a lien against the unit' : 'of less than $1,000 may not become a lien against the parcel'}.</p>
        </div>
      )}

      {/* Signature */}
      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
          {type === 'decision' ? 'Chair, fining committee' : (community?.association_officer_name || 'Authorized officer / agent')}
        </div>
        <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
      </div>
    </div>
  )
}

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

function Trow({ label, value }: { label: string; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
