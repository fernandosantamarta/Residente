'use client'

// Meetings & statutory notice — notice-compliance workspace (FS 718.112(2)(c)-(e)
// condo / FS 720.303(2) & 720.306(5) HOA). The operational meeting feature lives
// in /admin/voice; this board tracks NOTICE compliance: required lead times by
// meeting type, the notice deadline, whether notice was timely, and the minutes-
// availability clock. Advisory posture — nothing here blocks scheduling.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
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

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function MeetingsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

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
      const { data: c } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single(),
      )) as any
      setCommunity(c || null)
      setMeetings(await grab('ev_meetings', 'scheduled_at'))
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load meetings data'); setStatus('error')
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  // ---- intake form ----
  const [form, setForm] = useState<any>({
    type: 'board',
    title: '',
    scheduled_at: '',
    affects_assessments: false,
    affects_use_rules: false,
    is_budget_meeting: false,
    emergency: false,
  })
  const setF = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }))
  const [saving, setSaving] = useState(false)

  const scheduleMeeting = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const insert: Record<string, any> = {
        community_id: communityId,
        type: form.type,
        title: (form.title || '').trim() || `${form.type || 'board'} meeting`, // ev_meetings.title is NOT NULL
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        affects_assessments: !!form.affects_assessments,
        affects_use_rules: !!form.affects_use_rules,
        is_budget_meeting: !!form.is_budget_meeting,
        emergency: !!form.emergency,
        status: 'draft',
        minutes_status: 'pending',
        created_by: profile?.id ?? null,
      }
      const { error } = (await withTimeout(supabase.from('ev_meetings').insert(insert))) as any
      if (error) throw error
      setForm({ type: 'board', title: '', scheduled_at: '', affects_assessments: false, affects_use_rules: false, is_budget_meeting: false, emergency: false })
      setMsg('Meeting logged. Record notice when given.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not schedule the meeting') }
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
    } catch (err: any) { setError(err?.message || 'Could not update') }
  }

  const recordPosting = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { notice_posted_at: now }, 'Notice posting recorded.')
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.notice_recorded', target_type: 'meeting', target_id: m.id })
  }

  const recordMailing = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { notice_mailed_at: now }, 'Notice mailing recorded.')
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.notice_recorded', target_type: 'meeting', target_id: m.id })
  }

  const recordAgenda = async (m: MeetingRow) => {
    await patchMeeting(m.id, { agenda_posted_at: new Date().toISOString() }, 'Agenda posting recorded.')
  }

  const publishMinutes = async (m: MeetingRow) => {
    const now = new Date().toISOString()
    await patchMeeting(m.id, { minutes_published_at: now, minutes_status: 'published' }, 'Minutes published.')
    if (communityId) logAudit({ community_id: communityId, event_type: 'meeting.minutes_published', target_type: 'meeting', target_id: m.id })
  }

  const docHref = (id: string, type: string) => `/admin/meetings/${id}/document?type=${type}`

  return (
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Meetings <span className="amp">&</span> notice</h1>
      <p className="admin-dek">
        Track statutory notice obligations for every meeting — {BOARD_MEETING_NOTICE_HOURS.value}-hour posting
        for regular board meetings, {ANNUAL_MEETING_NOTICE_DAYS.value}-day mailed + posted notice for annual,
        budget-adoption, special-assessment, and use-rule meetings — and monitor the{' '}
        {MINUTES_AVAILABLE_DAYS.value}-day minutes-availability clock. Advisory only; you decide every step.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* ---- Intake form ---- */}
          <form className="admin-form" onSubmit={scheduleMeeting} style={{ marginTop: 22 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Schedule / log a meeting</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label className="admin-field">
                <span className="admin-field-label">Meeting type</span>
                <select className="admin-input" value={form.type} onChange={e => setF('type', e.target.value)}>
                  <option value="board">Board meeting</option>
                  <option value="annual">Annual / members meeting</option>
                  <option value="special">Special meeting</option>
                  <option value="committee">Committee meeting</option>
                </select>
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Title (optional)</span>
                <input className="admin-input" value={form.title} placeholder="e.g. April Board Meeting" onChange={e => setF('title', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Scheduled date &amp; time</span>
                <input className="admin-input" type="datetime-local" value={form.scheduled_at} onChange={e => setF('scheduled_at', e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.affects_assessments} onChange={e => setF('affects_assessments', e.target.checked)} />
                Considers a special/regular assessment (14-day mailed notice)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.affects_use_rules} onChange={e => setF('affects_use_rules', e.target.checked)} />
                Considers rules on unit/parcel use (14-day mailed notice)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.is_budget_meeting} onChange={e => setF('is_budget_meeting', e.target.checked)} />
                Budget adoption (14-day notice with proposed budget)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.emergency} onChange={e => setF('emergency', e.target.checked)} />
                Emergency (no advance notice possible)
              </label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={saving || !form.scheduled_at}>{saving ? 'Saving…' : 'Log meeting'}</button>
              {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          {/* ---- Worklist ---- */}
          <h2 className="bc-title" style={{ margin: '26px 0 10px' }}>Meetings ({meetings.length})</h2>
          {meetings.length === 0 && <div className="admin-note">No meetings on file yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {meetings.map(m => (
              <MeetingCard
                key={m.id}
                m={m}
                onRecordPosting={() => recordPosting(m)}
                onRecordMailing={() => recordMailing(m)}
                onRecordAgenda={() => recordAgenda(m)}
                onPublishMinutes={() => publishMinutes(m)}
                docHref={(type: string) => docHref(m.id, type)}
              />
            ))}
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
  onRecordPosting,
  onRecordMailing,
  onRecordAgenda,
  onPublishMinutes,
  docHref,
}: {
  m: MeetingRow
  onRecordPosting: () => void
  onRecordMailing: () => void
  onRecordAgenda: () => void
  onPublishMinutes: () => void
  docHref: (type: string) => string
}) {
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
  let noticeLabel = 'Notice pending'
  if (m.emergency) {
    noticeColor = '#475467'
    noticeLabel = 'Emergency — no notice required'
  } else if (satisfied) {
    noticeColor = '#067647'
    noticeLabel = 'Notice satisfied ✓'
  } else if (given && !satisfied) {
    noticeColor = '#B42318'
    noticeLabel = 'Notice given too late'
  } else if (pastDeadline) {
    noticeColor = '#B42318'
    noticeLabel = `Notice deadline passed (${deadline ? ymd(deadline) : '—'})`
  } else if (deadline) {
    noticeLabel = `Notice by ${ymd(deadline)}`
    noticeColor = '#B54708'
  }

  const meetType = String(m.type ?? 'board')
  const typeLabel: Record<string, string> = { board: 'Board', annual: 'Annual', special: 'Special', committee: 'Committee' }
  const minutesStatus = String(m.minutes_status ?? 'pending')

  const borderColor = satisfied || m.emergency
    ? '#067647'
    : pastDeadline && !given
      ? '#B42318'
      : '#B54708'

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${borderColor}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {m.title || `${typeLabel[meetType] ?? meetType} meeting`}
            {sched && <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 10, opacity: 0.7 }}>{ymd(sched)}</span>}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {typeLabel[meetType] ?? meetType}
            {req.mailed ? ` · ${req.days}-day mailed + posted` : ' · 48-hour posting'}
            {' · '}{req.citation}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
            {req.reason}
            {deadline && !m.emergency && <> · Notice deadline: <strong>{ymd(deadline)}</strong></>}
            {given && <> · Notice given: {ymd(given)}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={chip(noticeColor)}>{noticeLabel}</span>
          {isPast && (
            <span style={chip(minutesStatus === 'published' || minutesStatus === 'approved' ? '#067647' : '#B54708')}>
              Minutes: {minutesStatus}
            </span>
          )}
        </div>
      </div>

      {/* Status detail */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 12, opacity: 0.65 }}>
        {m.notice_posted_at && <span>Posted: {ymd(m.notice_posted_at)}</span>}
        {m.notice_mailed_at && <span>Mailed: {ymd(m.notice_mailed_at)}</span>}
        {m.agenda_posted_at && <span>Agenda: {ymd(m.agenda_posted_at)}</span>}
        {m.minutes_published_at && <span>Minutes published: {ymd(m.minutes_published_at)}</span>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {!m.notice_posted_at && (
          <button className="admin-btn-ghost" onClick={onRecordPosting}>Record posting</button>
        )}
        {req.mailed && !m.notice_mailed_at && (
          <button className="admin-btn-ghost" onClick={onRecordMailing}>Record mailing</button>
        )}
        {!m.agenda_posted_at && (
          <button className="admin-btn-ghost" onClick={onRecordAgenda}>Mark agenda posted</button>
        )}
        {isPast && minutesStatus !== 'published' && minutesStatus !== 'approved' && (
          <button className="admin-primary-btn" onClick={onPublishMinutes}>Publish minutes</button>
        )}
        <a className="admin-btn-ghost" href={docHref('notice')} target="_blank" rel="noopener noreferrer">Notice</a>
        <a className="admin-btn-ghost" href={docHref('agenda')} target="_blank" rel="noopener noreferrer">Agenda</a>
        <a className="admin-btn-ghost" href={docHref('affidavit')} target="_blank" rel="noopener noreferrer">Affidavit</a>
      </div>
    </div>
  )
}
