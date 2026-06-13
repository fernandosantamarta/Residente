'use client'

// Meetings document artifacts — print-ready HTML (Save as PDF). One parameterised
// page (?type=) renders statutory meeting documents: the Notice of Meeting, a
// meeting Agenda, and an Affidavit of Mailing / Posting. Every artifact is a
// DRAFT/aid requiring attorney review before use.

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate } from '@/lib/compliance/rules-core'
import {
  requiredNotice,
  noticeDeadline,
  type MeetingRow,
} from '@/lib/compliance/meetings'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'notice' | 'agenda' | 'affidavit'

const TITLES: Record<DocType, string> = {
  notice:    'Notice of Meeting',
  agenda:    'Agenda',
  affidavit: 'Affidavit of Mailing / Posting',
}

export default function MeetingDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.meetingsDetailDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const params = useParams()
  const search = useSearchParams()
  const id = params?.id as string
  const type = (search?.get('type') || 'notice') as DocType

  const [meeting, setMeeting] = useState<MeetingRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No meeting ID'); return }
      try {
        const { data: m, error: mErr } = (await withTimeout(
          supabase.from('ev_meetings').select('*').eq('id', id).single(),
        )) as any
        if (mErr) throw mErr
        const { data: comm } = (await withTimeout(
          supabase.from('communities').select('*').eq('id', m.community_id).single(),
        )) as any
        if (cancelled) return
        setMeeting(m)
        setCommunity(comm || null)
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.meetingsDetailDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>
  if (!meeting) return <div style={{ padding: 40, color: '#B42318' }}>{t('admin.meetingsDetailDocument.meetingNotFound')}</div>

  const isCondo = community?.association_type !== 'hoa'
  const today = ymd(new Date())
  const req = requiredNotice(meeting)
  const deadline = noticeDeadline(meeting)
  const sched = toDate(meeting.scheduled_at)
  const meetTypeLabel: Record<string, string> = { board: 'Board Meeting', annual: 'Annual Meeting', special: 'Special Meeting', committee: 'Committee Meeting' }
  const meetTitle = meeting.title || meetTypeLabel[String(meeting.type ?? 'board')] || 'Meeting'

  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      {/* Draft banner + print button */}
      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 520 }}>
          {t('admin.meetingsDetailDocument.draftBanner')}
        </div>
        <button
          onClick={() => window.print()}
          style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}
        >
          {t('admin.meetingsDetailDocument.printButton')}
        </button>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>
          {community?.association_address || <Em>set the association address in Community settings</Em>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 4 }}>{TITLES[type]}</h1>

      {/* ---- Notice of Meeting ---- */}
      {type === 'notice' && (
        <Body>
          <p style={{ marginBottom: 10 }}>
            <strong>{meetTitle}</strong>
          </p>
          <table style={tbl}><tbody>
            <Trow label="Date & time" value={sched ? sched.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : <Em>date not set</Em>} />
            <Trow label="Location" value={<Em>insert meeting location / video-conference link</Em>} />
            {deadline && <Trow label="Notice deadline" value={ymd(deadline)} />}
            <Trow label="Notice requirement" value={`${req.reason} — ${req.mailed ? `${req.days} days mailed + posted` : '48 hours posted conspicuously'}`} />
          </tbody></table>

          <p style={{ marginTop: 14 }}>
            This notice is given under <strong>{req.citation}</strong>. {req.mailed
              ? `This notice was mailed and posted conspicuously on the property at least ${req.days} days before the meeting as required by Florida law.`
              : `This notice was posted conspicuously on the property at least 48 hours before the meeting as required by Florida law.`}
          </p>

          {meeting.is_budget_meeting && (
            <p>
              A copy of the proposed budget is enclosed with this notice as required by{' '}
              {isCondo ? 'FS 718.112(2)(e)' : 'FS 720.303(2)'}.
            </p>
          )}
          {meeting.affects_assessments && (
            <p>
              The agenda includes consideration of a special or regular assessment. Written notice, including the
              nature of the assessment, has been provided pursuant to{' '}
              {isCondo ? 'FS 718.112(2)(c)1' : 'FS 720.303(2)(c)1'}.
            </p>
          )}
          {meeting.affects_use_rules && (
            <p>
              The agenda includes consideration of rules regarding unit/parcel use. Written notice has been provided
              pursuant to {isCondo ? 'FS 718.112(2)(c)1' : 'FS 720.303(2)(c)1'}.
            </p>
          )}
          {meeting.emergency && (
            <p style={{ color: '#B54708' }}>
              This is an emergency meeting. Advance notice was not practicable given the emergency circumstances.
            </p>
          )}

          <p style={{ fontSize: 12, color: '#555', marginTop: 14 }}>
            {isCondo
              ? 'Florida Condominium Act, FS 718.112(2)(c)-(e). Governing documents may require longer notice; confirm with counsel.'
              : 'Florida Homeowners Association Act, FS 720.303(2) & 720.306(5). Governing documents may require longer notice; confirm with counsel.'}
          </p>

          <div style={{ marginTop: 36, fontSize: 14 }}>
            <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
              {community?.association_officer_name || 'Authorized officer / agent'}
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
          </div>
        </Body>
      )}

      {/* ---- Agenda ---- */}
      {type === 'agenda' && (
        <Body>
          <p>
            <strong>{meetTitle}</strong>
            {sched && (
              <> &mdash; {sched.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</>
            )}
          </p>
          <p style={{ fontSize: 12, color: '#555' }}>
            The board-meeting notice must include the agenda, posted conspicuously with the notice
            ({isCondo ? 'FS 718.112(2)(c)' : 'FS 720.303(2)(c)'}).
          </p>

          <ol style={{ lineHeight: 2, fontSize: 14, marginTop: 14 }}>
            <li>Call to order</li>
            <li>Quorum verification</li>
            <li>Approval of prior meeting minutes</li>
            <li><Em>[Insert agenda items]</Em></li>
            {meeting.is_budget_meeting && <li>Consideration and adoption of the proposed budget</li>}
            {meeting.affects_assessments && <li>Consideration of special/regular assessment</li>}
            {meeting.affects_use_rules && <li>Consideration of rules regarding unit/parcel use</li>}
            <li>Owner / member comments (open forum)</li>
            <li>Adjournment</li>
          </ol>

          <p style={{ fontSize: 12, color: '#555', marginTop: 14 }}>
            ⚠ The agenda must accurately reflect all matters to be addressed. Business not on the agenda
            generally may not be acted upon at the meeting unless an exception applies. Confirm with counsel.
          </p>

          <div style={{ marginTop: 36, fontSize: 14 }}>
            <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
              {community?.association_officer_name || 'Board secretary / authorized officer'}
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
          </div>
        </Body>
      )}

      {/* ---- Affidavit of Mailing / Posting ---- */}
      {type === 'affidavit' && (
        <Body>
          <p style={{ fontSize: 12.5, color: '#555' }}>
            This affidavit evidences the posting and/or mailing of the Notice of Meeting in compliance with
            Florida law ({req.citation}).
          </p>

          <table style={tbl}><tbody>
            <Trow label="Meeting" value={meetTitle} />
            <Trow label="Meeting date" value={sched ? ymd(sched) : <Em>not set</Em>} />
            <Trow
              label="Notice posted on"
              value={meeting.notice_posted_at ? ymd(meeting.notice_posted_at) : <Em>confirm date</Em>}
            />
            {req.mailed && (
              <Trow
                label="Notice mailed on"
                value={meeting.notice_mailed_at ? ymd(meeting.notice_mailed_at) : <Em>confirm date</Em>}
              />
            )}
            <Trow label="Posted at location(s)" value={<Em>describe conspicuous location(s) on property</Em>} />
            {req.mailed && (
              <Trow label="Mailed to" value={<Em>all unit/parcel owners at their addresses of record</Em>} />
            )}
          </tbody></table>

          <p style={{ marginTop: 20 }}>
            The undersigned states, under penalty of perjury, that the foregoing is true and correct to the best
            of their knowledge and belief: the Notice of Meeting was posted conspicuously on the property
            on{' '}
            <Em>{meeting.notice_posted_at ? ymd(meeting.notice_posted_at) : '____________'}</Em>
            {req.mailed && (
              <>
                {' '}and mailed by first-class U.S. mail to all owners at their addresses of record
                on{' '}
                <Em>{meeting.notice_mailed_at ? ymd(meeting.notice_mailed_at) : '____________'}</Em>
              </>
            )}
            , at least {req.mailed ? `${req.days} days` : '48 hours'} before the meeting scheduled
            for {sched ? ymd(sched) : <Em>____________</Em>}.
          </p>

          <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
            Citation: {req.citation}. {isCondo
              ? 'Florida Condominium Act.'
              : 'Florida Homeowners Association Act.'}
          </p>

          {/* Notary block */}
          <div style={{ marginTop: 32, padding: '16px 20px', border: '1px solid #ccc', borderRadius: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>NOTARY BLOCK</div>
            <p style={{ margin: '0 0 10px' }}>
              STATE OF FLORIDA<br />
              COUNTY OF ____________________________
            </p>
            <p style={{ margin: '0 0 10px' }}>
              The foregoing instrument was sworn to and subscribed before me this ______ day
              of ____________________, 20______, by <Em>{community?.association_officer_name || '[officer / agent name]'}</Em>,
              who is personally known to me or who has produced ______________________ as identification.
            </p>
            <div style={{ marginTop: 24, display: 'flex', gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderTop: '1px solid #111', paddingTop: 6 }}>Signature of Notary Public</div>
                <div style={{ fontSize: 11.5, color: '#555', marginTop: 4 }}>Print name: __________________________</div>
                <div style={{ fontSize: 11.5, color: '#555' }}>Commission No.: __________________________</div>
                <div style={{ fontSize: 11.5, color: '#555' }}>My commission expires: __________________________</div>
              </div>
            </div>
          </div>

          {/* Signatory block */}
          <div style={{ marginTop: 36, fontSize: 14 }}>
            <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
              {community?.association_officer_name || 'Authorized officer / agent'}
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Date: __________</div>
          </div>
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function Trow({ label, value }: { label: string; value: any }) {
  return (
    <tr>
      <td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td>
      <td style={td}>{value ?? '—'}</td>
    </tr>
  )
}

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
