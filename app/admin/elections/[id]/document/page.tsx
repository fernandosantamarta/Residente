'use client'

// Election notice documents — print-ready HTML (Save as PDF). One parameterised
// page (?type=) renders each statutory election notice:
//   first_notice  — First Notice of Election & Annual Meeting (≥60 days before)
//   second_notice — Second Notice of Election / Ballot (14–34 days before)
//   affidavit     — Affidavit of Compliance / Mailing (FS 718.112(2)(d)3 / 720.306(5))
// All are DRAFTs requiring attorney review. FS 718.112(2)(d)4 (condo) /
// FS 720.306(9) (HOA). Nothing here is an official filing or binding document.

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import {
  electionMilestones,
  ELECTION_FIRST_NOTICE_DAYS,
  CANDIDATE_NOTICE_DAYS,
  SECOND_NOTICE_MIN_DAYS,
  SECOND_NOTICE_MAX_DAYS,
  type ElectionRow,
} from '@/lib/compliance/elections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'first_notice' | 'second_notice' | 'affidavit'

const TITLES: Record<DocType, string> = {
  first_notice:  'First Notice of Election & Annual Meeting',
  second_notice: 'Second Notice of Election (Ballot)',
  affidavit:     'Affidavit of Compliance — Election Notices',
}

export default function ElectionDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.electionsDetailDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const params = useParams()
  const search = useSearchParams()
  const id = params?.id as string
  const type = (search?.get('type') || 'first_notice') as DocType

  const [election, setElection] = useState<ElectionRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No election id'); return }
      try {
        const { data: el, error: elErr } = (await withTimeout(
          supabase.from('ev_elections').select('*').eq('id', id).single()
        )) as any
        if (elErr) throw elErr
        const { data: comm } = (await withTimeout(
          supabase.from('communities').select('*').eq('id', el.community_id).single()
        )) as any
        if (cancelled) return
        setElection(el); setCommunity(comm || null)
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.electionsDetailDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const isCondo = community?.association_type !== 'hoa'
  const today = ymd(new Date())
  const ms = election ? electionMilestones(election) : null
  const electionDateStr = election?.election_date || null
  const assocName = community?.name || 'Association'
  const officerName = community?.association_officer_name || 'Authorized officer / agent'
  const assocAddr = community?.association_address || null

  const cite = (condo: string, hoa: string) => isCondo ? condo : hoa
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>

  const title = TITLES[type] ?? 'Election Document'

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

      {/* Draft banner + print button */}
      <div className="no-print rp-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540, lineHeight: 1.45 }}>
          {t('admin.electionsDetailDocument.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.electionsDetailDocument.printSaveAsPdf')}</button>
        </div>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{assocName}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>
          {assocAddr || <Em>{t('admin.electionsDetailDocument.setAddressHint')}</Em>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 4 }}>{title}</h1>

      <Body>
        {/* Recipient placeholder */}
        <div style={{ marginBottom: 16 }}>
          <div><Em>[Member Name]</Em></div>
          <div><Em>[Member Address]</Em></div>
          <div>Re: Annual Meeting &amp; Election — {electionDateStr || <Em>election date</Em>}</div>
        </div>

        {/* ---- FIRST NOTICE ---- */}
        {type === 'first_notice' && (
          <>
            <p>
              Dear Member,
            </p>
            <p>
              You are hereby given notice that the Annual Meeting of {assocName} will be held on{' '}
              <strong>{electionDateStr || <Em>election date</Em>}</strong>{' '}
              for the purpose of electing{' '}
              {election?.seats != null ? <strong>{election.seats} director{election.seats !== 1 ? 's' : ''}</strong> : <Em>[number of seats]</Em>}{' '}
              to the Board of Directors.
            </p>
            <p>
              <strong>Opportunity to be a candidate:</strong>{' '}
              Any eligible member who desires to be a candidate for the Board of Directors must give
              written notice of intent to the association at least{' '}
              <strong>{CANDIDATE_NOTICE_DAYS.value} days</strong> before the election
              {ms?.candidateBy ? (
                <>, no later than <strong>{ymd(ms.candidateBy)}</strong></>
              ) : null}.
              Candidate information sheets and qualification requirements will be provided upon request.
            </p>
            <p>
              This first notice is being given at least{' '}
              <strong>{ELECTION_FIRST_NOTICE_DAYS.value} days</strong> before the election
              {ms?.firstNoticeBy ? (
                <>; the deadline for sending this notice was <strong>{ymd(ms.firstNoticeBy)}</strong></>
              ) : null}.
            </p>
            <p>
              A second notice of election, together with the official ballot and candidate information
              sheets, will be mailed to all eligible voters between{' '}
              <strong>{SECOND_NOTICE_MIN_DAYS.value}</strong> and{' '}
              <strong>{SECOND_NOTICE_MAX_DAYS.value}</strong> days before the election{' '}
              {ms?.secondNoticeEarliest && ms?.secondNoticeLatest ? (
                <>(between <strong>{ymd(ms.secondNoticeEarliest)}</strong> and <strong>{ymd(ms.secondNoticeLatest)}</strong>)</>
              ) : null}.
            </p>
            {isCondo && (
              <p>
                <strong>Condo elections — secret ballot / no proxies:</strong>{' '}
                Pursuant to {cite('Florida Statutes § 718.112(2)(d)4', '')}, condo board elections are
                conducted by secret ballot. No proxy may be used in board director elections.
              </p>
            )}
            <p style={{ fontSize: 12, color: '#555' }}>
              This First Notice of Election is provided under{' '}
              {cite(
                `Florida Statutes § 718.112(2)(d)4 (${ELECTION_FIRST_NOTICE_DAYS.citation})`,
                `Florida Statutes § 720.306(9)(b) (${CANDIDATE_NOTICE_DAYS.citation})`
              )}.{' '}
              This notice is being sent by first-class U.S. mail (or electronic delivery, if consented) to all
              eligible members of record.
            </p>
          </>
        )}

        {/* ---- SECOND NOTICE / BALLOT ---- */}
        {type === 'second_notice' && (
          <>
            <p>
              Dear Member,
            </p>
            <p>
              Enclosed with this notice are your <strong>official ballot</strong> and{' '}
              <strong>candidate information sheets</strong> for the election of directors to the Board of
              Directors of {assocName}, to be held on{' '}
              <strong>{electionDateStr || <Em>election date</Em>}</strong>.
            </p>
            <p>
              This second notice and ballot are mailed not less than{' '}
              <strong>{SECOND_NOTICE_MIN_DAYS.value} days</strong> nor more than{' '}
              <strong>{SECOND_NOTICE_MAX_DAYS.value} days</strong> before the election
              {ms?.secondNoticeEarliest && ms?.secondNoticeLatest ? (
                <> (the mailing window is{' '}
                <strong>{ymd(ms.secondNoticeEarliest)}</strong>–<strong>{ymd(ms.secondNoticeLatest)}</strong>)</>
              ) : null}.
            </p>
            {isCondo && (
              <>
                <p>
                  <strong>Secret ballot — no proxies:</strong>{' '}
                  Condo board director elections are conducted by secret ballot. No proxy is valid for
                  voting in an election of directors. Your ballot must be returned in the inner envelope
                  provided, which must be placed inside the outer envelope bearing your name and unit
                  number and returned to the association so as to be received before the start of the
                  annual meeting.
                </p>
                <p>
                  <strong>Election quorum:</strong>{' '}
                  At least 20% of eligible voters must cast a ballot for the election to be valid (Florida
                  Statutes § 718.112(2)(d)).
                  {election?.eligible_count != null && (
                    <> For this election, at least <strong>{Math.ceil(Number(election.eligible_count) * 0.2)}</strong> of{' '}
                    <strong>{election.eligible_count}</strong> eligible voters must participate.</>
                  )}
                </p>
              </>
            )}
            <table style={tbl}><tbody>
              <Trow label="Election date" value={electionDateStr || <Em>confirm</Em>} />
              <Trow label="Seats to be filled" value={election?.seats != null ? String(election.seats) : <Em>confirm</Em>} />
              <Trow label="Ballot return deadline" value={<Em>before the start of the annual meeting</Em>} />
              {ms?.secondNoticeLatest && <Trow label="Latest date this notice may be mailed" value={ymd(ms.secondNoticeLatest)} />}
            </tbody></table>
            <p style={{ fontSize: 12, color: '#555', marginTop: 14 }}>
              This Second Notice of Election is provided under{' '}
              {cite(
                `Florida Statutes § 718.112(2)(d)4 (${SECOND_NOTICE_MIN_DAYS.citation} / ${SECOND_NOTICE_MAX_DAYS.citation})`,
                `Florida Statutes § 720.306(9)(b) (${CANDIDATE_NOTICE_DAYS.citation})`
              )}.{' '}
              Questions? Contact the association at the address above.
            </p>
          </>
        )}

        {/* ---- AFFIDAVIT OF COMPLIANCE / MAILING ---- */}
        {type === 'affidavit' && (
          <>
            <p>
              STATE OF FLORIDA<br />
              COUNTY OF <Em>[county]</Em>
            </p>
            <p>
              Before me, the undersigned authority, personally appeared{' '}
              <strong>{officerName}</strong>, who, being first duly sworn, deposes and says:
            </p>
            <p>
              1. I am an officer of {assocName} (or the person who provided notice of its election),
              and I am authorized to make this affidavit.
            </p>
            <p>
              2. {cite(
                'Pursuant to section 718.112(2)(d)3, Florida Statutes',
                'Pursuant to section 720.306(5), Florida Statutes'
              )}, I affirm that notice of the election and annual meeting scheduled for{' '}
              <strong>{electionDateStr || <Em>election date</Em>}</strong> was mailed, hand delivered, or
              electronically transmitted to all members entitled to vote, as follows:
            </p>
            <table style={tbl}><tbody>
              <Trow label="First notice mailed / delivered" value={election?.first_notice_at ? ymd(election.first_notice_at) : <Em>date</Em>} />
              <Trow label="Second notice & ballot mailed / delivered" value={election?.ballots_sent_at ? ymd(election.ballots_sent_at) : <Em>date</Em>} />
              <Trow label="Election / annual meeting date" value={electionDateStr || <Em>date</Em>} />
            </tbody></table>
            <p>
              3. A United States Postal Service certificate of mailing (or other proof of delivery) is
              retained with this affidavit in the official records of the association.
            </p>
            <p style={{ marginTop: 28 }}>_______________________________<br />{officerName}, Affiant</p>
            <p style={{ marginTop: 18 }}>
              Sworn to and subscribed before me this ____ day of __________, 20____, by the affiant who is
              personally known to me or produced ____________________ as identification.
            </p>
            <p style={{ marginTop: 18 }}>_______________________________<br />Notary Public, State of Florida</p>
            <p style={{ fontSize: 12, color: '#555', marginTop: 14 }}>
              This affidavit of compliance is provided under{' '}
              {cite('Florida Statutes § 718.112(2)(d)3', 'Florida Statutes § 720.306(5)')}{' '}
              and must be retained among the association&apos;s official records.
            </p>
          </>
        )}
      </Body>

      {/* Signature */}
      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{officerName}</div>
        <div style={{ fontSize: 12, color: '#555' }}>{assocName}</div>
      </div>
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function Trow({ label, value }: { label: string; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
