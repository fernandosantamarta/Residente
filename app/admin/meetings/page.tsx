'use client'

// Meetings & statutory notice — notice-compliance workspace (FS 718.112(2)(c)-(e)
// condo / FS 720.303(2) & 720.306(5) HOA). The operational meeting feature lives
// in /admin/voice; this board tracks NOTICE compliance: required lead times by
// meeting type, the notice deadline, whether notice was timely, and the minutes-
// availability clock. Advisory posture — nothing here blocks scheduling.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate } from '@/lib/compliance/rules-core'
import {
  requiredNotice,
  noticeDeadline,
  noticeSatisfied,
  noticeGivenDate,
  BOARD_MEETING_NOTICE_HOURS,
  ANNUAL_MEETING_NOTICE_DAYS,
  MINUTES_AVAILABLE_DAYS,
  type MeetingRow,
} from '@/lib/compliance/meetings'
import { logAudit } from '@/lib/audit'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function MeetingsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const t = useT()

  const [community, setCommunity] = useState<any>(null)
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const grab = async (table: string, order?: string) => {
        try {
          let q = supabase.from(table).select('*').eq('community_id', communityId)
          if (order) q = q.order(order, { ascending: false })
          const { data, error } = (await withTimeout(q)) as any
          if (error) return []
          return data || []
        } catch { return [] }
      }
      // The community row and the meetings list are independent reads — fire them
      // in ONE parallel batch so the page waits for the slower query, not the sum.
      const [cRes, meetingsData] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        grab('ev_meetings', 'scheduled_at'),
      ])
      const { data: c } = cRes as any
      setCommunity(c || null)
      setMeetings(meetingsData)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.meetings.errorLoadMeetings')); setStatus('error')
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  const isCondo = community?.association_type !== 'hoa'

  // ---- intake form ----
  const [form, setForm] = useState<any>({
    type: 'board',
    title: '',
    scheduled_at: '',
    affects_assessments: false,
    affects_use_rules: false,
    is_budget_meeting: false,
    emergency: false,
    is_video_conference: false,
    vc_join_url: '',
    vc_phone: '',
    vc_physical_location: '',
  })
  const setF = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }))
  const [saving, setSaving] = useState(false)

  const scheduleMeeting = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const isVc = isCondo && !!form.is_video_conference
      const insert: Record<string, any> = {
        community_id: communityId,
        type: form.type,
        title: (form.title || '').trim() || `${form.type || 'board'} meeting`, // ev_meetings.title is NOT NULL
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        affects_assessments: !!form.affects_assessments,
        affects_use_rules: !!form.affects_use_rules,
        is_budget_meeting: !!form.is_budget_meeting,
        emergency: !!form.emergency,
        is_video_conference: isVc,
        vc_join_url: isVc ? ((form.vc_join_url || '').trim() || null) : null,
        vc_phone: isVc ? ((form.vc_phone || '').trim() || null) : null,
        vc_physical_location: isVc ? ((form.vc_physical_location || '').trim() || null) : null,
        status: 'draft',
        minutes_status: 'pending',
        created_by: profile?.id ?? null,
      }
      const { error } = (await withTimeout(supabase.from('ev_meetings').insert(insert))) as any
      if (error) throw error
      setForm({ type: 'board', title: '', scheduled_at: '', affects_assessments: false, affects_use_rules: false, is_budget_meeting: false, emergency: false, is_video_conference: false, vc_join_url: '', vc_phone: '', vc_physical_location: '' })
      setMsg(t('admin.meetings.meetingLogged'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.meetings.errorScheduleMeeting')) }
    finally { setSaving(false) }
  }

  // ---- per-meeting patch ----
  const patchMeeting = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_meetings').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || t('admin.meetings.errorUpdate')) }
  }

  const recordPosting = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { notice_posted_at: now }, t('admin.meetings.noticePostingRecorded'))
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.notice_recorded', target_type: 'meeting', target_id: m.id })
  }

  const recordMailing = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { notice_mailed_at: now }, t('admin.meetings.noticeMailingRecorded'))
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.notice_recorded', target_type: 'meeting', target_id: m.id })
  }

  const recordAgenda = async (m: MeetingRow) => {
    await patchMeeting(m.id, { agenda_posted_at: new Date().toISOString() }, t('admin.meetings.agendaPostingRecorded'))
  }

  const publishMinutes = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { minutes_published_at: now, minutes_status: 'published' }, t('admin.meetings.minutesPublished'))
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.minutes_published', target_type: 'meeting', target_id: m.id })
  }

  // Video-conference meeting must be recorded + the recording kept as an official record
  // (FS 718.112(2)(c)1 / (2)(d)2). Marks recording_retained → clears the advisory signal.
  const markRecording = async (m: MeetingRow) => {
    await patchMeeting(m.id, { recording_retained: true }, 'Video-conference recording marked retained.')
  }

  const docHref = (id: string, type: string) => `/admin/meetings/${id}/document?type=${type}`

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.meetings.kicker')}</div>
      <h1 className="admin-h1">{t('admin.meetings.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.meetings.pageDescription', {
          boardHours: BOARD_MEETING_NOTICE_HOURS.value,
          annualDays: ANNUAL_MEETING_NOTICE_DAYS.value,
          minutesDays: MINUTES_AVAILABLE_DAYS.value,
        })}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.meetings.noCommunityLinked')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.meetings.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.meetings.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* ---- Intake form ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.meetings.scheduleLog')}</h2></div></div>
            <form className="admin-form" onSubmit={scheduleMeeting}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="admin-field">
                <span className="admin-field-label">{t('admin.meetings.meetingType')}</span>
                <Dropdown<string>
                  value={form.type}
                  onChange={v => setF('type', v)}
                  ariaLabel={t('admin.meetings.meetingType')}
                  options={[
                    { value: 'board', label: t('admin.meetings.typeBoardMeeting') },
                    { value: 'annual', label: t('admin.meetings.typeAnnualMeeting') },
                    { value: 'special', label: t('admin.meetings.typeSpecialMeeting') },
                    { value: 'committee', label: t('admin.meetings.typeCommitteeMeeting') },
                  ]}
                />
              </div>
              <label className="admin-field">
                <span className="admin-field-label">{t('admin.meetings.titleOptional')}</span>
                <input className="admin-input" value={form.title} placeholder={t('admin.meetings.titlePlaceholder')} onChange={e => setF('title', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">{t('admin.meetings.scheduledDateTime')}</span>
                <input className="admin-input" type="datetime-local" value={form.scheduled_at} onChange={e => setF('scheduled_at', e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.affects_assessments} onChange={e => setF('affects_assessments', e.target.checked)} />
                {t('admin.meetings.checkboxAssessments')}
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.affects_use_rules} onChange={e => setF('affects_use_rules', e.target.checked)} />
                {t('admin.meetings.checkboxUseRules')}
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.is_budget_meeting} onChange={e => setF('is_budget_meeting', e.target.checked)} />
                {t('admin.meetings.checkboxBudget')}
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.emergency} onChange={e => setF('emergency', e.target.checked)} />
                {t('admin.meetings.checkboxEmergency')}
              </label>
            </div>
            {isCondo && (
              <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, margin: '4px 0 10px' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
                  <input type="checkbox" checked={!!form.is_video_conference} onChange={e => setF('is_video_conference', e.target.checked)} />
                  Held by video conference (FS 718.112(2)(c)1 — notice must include a join link, a call-in number &amp; the physical address; the meeting must be recorded)
                </label>
                {form.is_video_conference && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 10 }}>
                    <label className="admin-field"><span className="admin-field-label">Join link (hyperlink)</span>
                      <input className="admin-input" value={form.vc_join_url} placeholder="https://…" onChange={e => setF('vc_join_url', e.target.value)} /></label>
                    <label className="admin-field"><span className="admin-field-label">Conference phone number</span>
                      <input className="admin-input" value={form.vc_phone} placeholder="+1 …" onChange={e => setF('vc_phone', e.target.value)} /></label>
                    <label className="admin-field"><span className="admin-field-label">Physical location to attend</span>
                      <input className="admin-input" value={form.vc_physical_location} placeholder="Clubhouse, 123 Main St" onChange={e => setF('vc_physical_location', e.target.value)} /></label>
                  </div>
                )}
              </div>
            )}
            <div className="card-cta">
              {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
              <button type="submit" className="admin-primary-btn" disabled={saving || !form.scheduled_at}>{saving ? t('admin.meetings.saving') : t('admin.meetings.logMeeting')}</button>
            </div>
            </form>
          </div>

          {/* ---- Worklist ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.meetings.meetingsHeading')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({meetings.length})</span></h2></div></div>
            {meetings.length === 0 && <div className="admin-note">{t('admin.meetings.noMeetingsYet')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {meetings.map(m => (
                <MeetingCard
                  key={m.id}
                  m={m}
                  isCondo={isCondo}
                  onRecordPosting={() => recordPosting(m)}
                  onRecordMailing={() => recordMailing(m)}
                  onRecordAgenda={() => recordAgenda(m)}
                  onPublishMinutes={() => publishMinutes(m)}
                  onMarkRecording={() => markRecording(m)}
                  docHref={(type: string) => docHref(m.id, type)}
                  minutesHref={`/admin/meetings/${m.id}/minutes`}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}

// ----------------------------------------------------------------------------
// Meeting card
// ----------------------------------------------------------------------------
function MeetingCard({
  m,
  isCondo,
  onRecordPosting,
  onRecordMailing,
  onRecordAgenda,
  onPublishMinutes,
  onMarkRecording,
  docHref,
  minutesHref,
}: {
  m: MeetingRow
  isCondo: boolean
  onRecordPosting: () => void
  onRecordMailing: () => void
  onRecordAgenda: () => void
  onPublishMinutes: () => void
  onMarkRecording: () => void
  docHref: (type: string) => string
  minutesHref: string
}) {
  const t = useT()
  const req = requiredNotice(m)
  const deadline = noticeDeadline(m)
  const given = noticeGivenDate(m)
  const satisfied = noticeSatisfied(m)
  const sched = toDate(m.scheduled_at)
  const now = new Date()
  const pastDeadline = deadline ? deadline.getTime() < now.getTime() : false
  const isPast = sched ? sched.getTime() < now.getTime() : false

  // Notice chip
  let noticeColor = '#175CD3'
  let noticeLabel = t('admin.meetings.noticePending')
  if (m.emergency) {
    noticeColor = '#475467'
    noticeLabel = t('admin.meetings.noticeEmergency')
  } else if (satisfied) {
    noticeColor = '#067647'
    noticeLabel = t('admin.meetings.noticeSatisfied')
  } else if (given && !satisfied) {
    noticeColor = '#B42318'
    noticeLabel = t('admin.meetings.noticeTooLate')
  } else if (pastDeadline) {
    noticeColor = '#B42318'
    noticeLabel = t('admin.meetings.noticeDeadlinePassed', { date: deadline ? ymd(deadline) : '—' })
  } else if (deadline) {
    noticeLabel = t('admin.meetings.noticeBy', { date: ymd(deadline) })
    noticeColor = '#B54708'
  }

  const meetType = String(m.type ?? 'board')
  const typeLabel: Record<string, string> = {
    board: t('admin.meetings.typeLabelBoard'),
    annual: t('admin.meetings.typeLabelAnnual'),
    special: t('admin.meetings.typeLabelSpecial'),
    committee: t('admin.meetings.typeLabelCommittee'),
  }
  const minutesStatus = String(m.minutes_status ?? 'pending')

  // Condo video-conference notice content (FS 718.112(2)(c)1, HB 913).
  const isVc = isCondo && !!m.is_video_conference
  const vcMissing = (isVc
    ? [
        !String(m.vc_join_url ?? '').trim() && 'join link',
        !String(m.vc_phone ?? '').trim() && 'call-in number',
        !String(m.vc_physical_location ?? '').trim() && 'physical address',
      ].filter(Boolean)
    : []) as string[]

  const borderColor = satisfied || m.emergency
    ? '#067647'
    : pastDeadline && !given
      ? '#B42318'
      : '#B54708'

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {m.title || `${typeLabel[meetType] ?? meetType} meeting`}
            {sched && <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 10, opacity: 0.7 }}>{ymd(sched)}</span>}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {typeLabel[meetType] ?? meetType}
            {req.mailed ? ` · ${req.days}-day mailed + posted` : ` · ${t('admin.meetings.detail48HourPosting')}`}
            {' · '}{req.citation}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
            {req.reason}
            {deadline && !m.emergency && <> · {t('admin.meetings.detailNoticeDeadline')}: <strong>{ymd(deadline)}</strong></>}
            {given && <> · {t('admin.meetings.detailNoticeGiven')}: {ymd(given)}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={chip(noticeColor)}>{noticeLabel}</span>
          {isVc && (
            <span style={chip(vcMissing.length ? '#B54708' : '#067647')}>
              {vcMissing.length ? `VC notice: add ${vcMissing.join(', ')}` : 'Video conference ✓'}
            </span>
          )}
          {isPast && (
            <span style={chip(minutesStatus === 'published' || minutesStatus === 'approved' ? '#067647' : '#B54708')}>
              {t('admin.meetings.minutesChip')}: {minutesStatus}
            </span>
          )}
        </div>
      </div>

      {/* Status detail */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 12, opacity: 0.65 }}>
        {m.notice_posted_at && <span>{t('admin.meetings.statusPosted')}: {ymd(m.notice_posted_at)}</span>}
        {m.notice_mailed_at && <span>{t('admin.meetings.statusMailed')}: {ymd(m.notice_mailed_at)}</span>}
        {m.agenda_posted_at && <span>{t('admin.meetings.statusAgenda')}: {ymd(m.agenda_posted_at)}</span>}
        {m.minutes_published_at && <span>{t('admin.meetings.statusMinutesPublished')}: {ymd(m.minutes_published_at)}</span>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {!m.notice_posted_at && (
          <button className="admin-btn-ghost" onClick={onRecordPosting}>{t('admin.meetings.btnRecordPosting')}</button>
        )}
        {req.mailed && !m.notice_mailed_at && (
          <button className="admin-btn-ghost" onClick={onRecordMailing}>{t('admin.meetings.btnRecordMailing')}</button>
        )}
        {!m.agenda_posted_at && (
          <button className="admin-btn-ghost" onClick={onRecordAgenda}>{t('admin.meetings.btnMarkAgendaPosted')}</button>
        )}
        {isPast && minutesStatus !== 'published' && minutesStatus !== 'approved' && (
          <button className="admin-primary-btn" onClick={onPublishMinutes}>{t('admin.meetings.btnPublishMinutes')}</button>
        )}
        {isVc && isPast && !m.recording_retained && (
          <button className="admin-btn-ghost" onClick={onMarkRecording}>Mark recording retained</button>
        )}
        <a className="admin-btn-ghost" href={docHref('notice')}>{t('admin.meetings.linkNotice')}</a>
        <a className="admin-btn-ghost" href={docHref('agenda')}>{t('admin.meetings.linkAgenda')}</a>
        <a className="admin-btn-ghost" href={docHref('affidavit')}>{t('admin.meetings.linkAffidavit')}</a>
        <a className="admin-btn-ghost" href={minutesHref}>{t('admin.minutes.captureMinutes')}</a>
      </div>
    </div>
  )
}
