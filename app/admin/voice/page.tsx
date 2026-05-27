'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  MEETING_TYPES, VOTE_TYPES, DOC_TYPES,
  noticeWarning, MEETING_STATUS_LABELS, VOTE_STATUS_LABELS,
  NOTICE_KIND_LABELS, defaultNoticeCopy,
} from '@/lib/voice'
import { useVoiceMeetings, useVoiceMeeting } from '@/hooks/useVoiceMeetings'
import { useCommunityNotices } from '@/hooks/useNotices'
import { logAudit } from '@/lib/audit'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtDt = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const EMPTY_MEETING = {
  type: 'board', title: '', scheduled_at: '', location: '', virtual_link: '',
  quorum_required_pct: '',
}

const EMPTY_VOTE = {
  title: '', description: '', type: 'resolution', ballot_type: 'open', mode: 'in_meeting',
}

export default function Meetings() {
  const { meetings, loading, error, reload } = useVoiceMeetings()
  const [view, setView] = useState('list') // list | create | detail
  const [selectedId, setSelectedId] = useState(null)

  if (view === 'create') {
    return <MeetingForm onSaved={(id) => { reload(); setSelectedId(id); setView('detail') }} onCancel={() => setView('list')} />
  }
  if (view === 'detail' && selectedId) {
    return <MeetingDetail meetingId={selectedId} onBack={() => { reload(); setView('list') }} />
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <div className="admin-section-title">Easy Voice — Meetings</div>
          <div className="admin-section-sub">Create meetings, manage documents, and run votes.</div>
        </div>
        <button className="admin-btn" onClick={() => setView('create')}>+ New Meeting</button>
      </div>

      {loading && <div className="admin-placeholder">Loading meetings…</div>}
      {error && <div className="admin-err">{error}</div>}

      {!loading && !error && meetings.length === 0 && (
        <div className="admin-placeholder">
          No meetings yet. Create your first one above.
        </div>
      )}

      {!loading && meetings.length > 0 && (
        <div className="voice-meeting-list">
          {meetings.map(m => (
            <MeetingRow
              key={m.id}
              meeting={m}
              onClick={() => { setSelectedId(m.id); setView('detail') }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MeetingRow({ meeting: m, onClick }) {
  const typeLabel = MEETING_TYPES.find(t => t.value === m.type)?.label ?? m.type
  const votes = m.ev_votes ?? []
  const openVotes = votes.filter(v => v.status === 'open').length

  return (
    <button className="voice-meeting-row" onClick={onClick}>
      <div className="voice-meeting-row-left">
        <div className="voice-meeting-type">{typeLabel}</div>
        <div className="voice-meeting-title">{m.title}</div>
        <div className="voice-meeting-meta">{fmtDt(m.scheduled_at)}</div>
        {m.location && <div className="voice-meeting-meta">{m.location}</div>}
      </div>
      <div className="voice-meeting-row-right">
        <span className={`voice-status voice-status-${m.status}`}>
          {MEETING_STATUS_LABELS[m.status] ?? m.status}
        </span>
        {openVotes > 0 && (
          <span className="voice-badge-open">{openVotes} vote{openVotes > 1 ? 's' : ''} open</span>
        )}
      </div>
    </button>
  )
}

function MeetingForm({ onSaved, onCancel, existing }: { onSaved: (id) => void; onCancel: () => void; existing?: any }) {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState(existing ?? EMPTY_MEETING)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const warning = noticeWarning(form.type, form.scheduled_at)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    if (!hasSupabase || !profile?.community_id) return
    if (!form.title.trim() || !form.scheduled_at) {
      setErr('Title and date/time are required.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const payload = {
        community_id:        profile.community_id,
        type:                form.type,
        title:               form.title.trim(),
        scheduled_at:        form.scheduled_at,
        location:            form.location.trim() || null,
        virtual_link:        form.virtual_link.trim() || null,
        quorum_required_pct: form.quorum_required_pct ? Number(form.quorum_required_pct) : null,
        created_by:          profile.id,
      }
      let id = existing?.id
      if (id) {
        const { error } = await withTimeout(supabase.from('ev_meetings').update(payload).eq('id', id))
        if (error) throw error
      } else {
        const { data, error } = await withTimeout(
          supabase.from('ev_meetings').insert(payload).select('id').single()
        )
        if (error) throw error
        id = data.id
      }
      onSaved(id)
    } catch (e) {
      setErr(e?.message ?? 'Failed to save meeting.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <div className="admin-section-title">{existing ? 'Edit Meeting' : 'New Meeting'}</div>
        </div>
        <button className="admin-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      <form className="voice-form" onSubmit={save}>
        <div className="voice-form-row">
          <label>Meeting type</label>
          <select name="type" value={form.type} onChange={e => set('type', e.target.value)}>
            {MEETING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="voice-form-row">
          <label>Title</label>
          <input
            name="title"
            type="text"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="e.g. Q2 Board Meeting"
            required
          />
        </div>

        <div className="voice-form-row">
          <label>Date &amp; time</label>
          <input
            name="scheduled_at"
            type="datetime-local"
            value={form.scheduled_at}
            onChange={e => set('scheduled_at', e.target.value)}
            required
          />
        </div>

        {warning && (
          <div className="voice-notice-warn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>{warning}</span>
          </div>
        )}

        <div className="voice-form-row">
          <label>Location <span className="voice-opt">(optional)</span></label>
          <input
            name="location"
            type="text"
            value={form.location}
            onChange={e => set('location', e.target.value)}
            placeholder="e.g. Clubhouse Meeting Room"
          />
        </div>

        <div className="voice-form-row">
          <label>Virtual link <span className="voice-opt">(optional)</span></label>
          <input
            name="virtual_link"
            type="url"
            value={form.virtual_link}
            onChange={e => set('virtual_link', e.target.value)}
            placeholder="https://zoom.us/j/…"
          />
        </div>

        <div className="voice-form-row">
          <label>Quorum % <span className="voice-opt">(optional — overrides community default)</span></label>
          <input
            name="quorum_required_pct"
            type="number"
            min="1" max="100" step="0.1"
            value={form.quorum_required_pct}
            onChange={e => set('quorum_required_pct', e.target.value)}
            placeholder="e.g. 30"
          />
        </div>

        {err && <div className="admin-err">{err}</div>}

        <div className="voice-form-actions">
          <button type="submit" className="admin-btn" disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create meeting'}
          </button>
          <button type="button" className="admin-btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

function MeetingDetail({ meetingId, onBack }) {
  const { meeting, loading, error, reload } = useVoiceMeeting(meetingId)
  const [tab, setTab] = useState('votes') // votes | docs | settings
  const [editMode, setEditMode] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [advErr, setAdvErr] = useState(null)

  const advanceStatus = async () => {
    const next = {
      draft: 'notice_sent', notice_sent: 'in_progress', in_progress: 'completed',
    }[meeting.status]
    if (!next) return
    setAdvancing(true)
    setAdvErr(null)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_meetings').update({ status: next }).eq('id', meetingId)
      )
      if (error) throw error
      logAudit({
        community_id: meeting.community_id,
        event_type:   'meeting.status_changed',
        target_type:  'meeting',
        target_id:    meetingId,
        metadata:     { from: meeting.status, to: next },
      })
      if (next === 'notice_sent') {
        const copy = defaultNoticeCopy('meeting_published', { meetingTitle: meeting.title })
        try {
          await withTimeout(
            supabase.from('ev_notices').insert({
              community_id: meeting.community_id,
              meeting_id:   meeting.id,
              kind:         'meeting_published',
              channels:     ['in_app'],
              subject:      copy.subject,
              body:         copy.body,
            })
          )
          logAudit({
            community_id: meeting.community_id,
            event_type:   'notice.sent',
            target_type:  'notice',
            metadata:     { kind: 'meeting_published', meeting_id: meeting.id },
          })
        } catch { /* status change succeeded; notice is best-effort */ }
      }
      reload()
    } catch (e) {
      setAdvErr(e?.message ?? 'Failed to update status.')
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) return <div className="admin-section"><div className="admin-placeholder">Loading…</div></div>
  if (error)   return <div className="admin-section"><div className="admin-err">{error}</div></div>
  if (!meeting) return null

  if (editMode) {
    return (
      <MeetingForm
        existing={meeting}
        onSaved={() => { reload(); setEditMode(false) }}
        onCancel={() => setEditMode(false)}
      />
    )
  }

  const typeLabel = MEETING_TYPES.find(t => t.value === meeting.type)?.label ?? meeting.type
  const nextStatusLabel = { draft: 'Mark Notice Sent', notice_sent: 'Start Meeting', in_progress: 'Complete Meeting' }[meeting.status]

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <button className="admin-btn-ghost" onClick={onBack}>← All meetings</button>
        <button className="admin-btn-ghost" onClick={() => setEditMode(true)}>Edit</button>
      </div>

      <div className="voice-detail-header">
        <div className="voice-meeting-type">{typeLabel}</div>
        <h2 className="voice-detail-title">{meeting.title}</h2>
        <div className="voice-detail-meta">
          <span>{fmtDt(meeting.scheduled_at)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
          {meeting.virtual_link && (
            <a className="voice-link" href={meeting.virtual_link} target="_blank" rel="noreferrer">Virtual link ↗</a>
          )}
        </div>
        <div className="voice-detail-status-row">
          <span className={`voice-status voice-status-${meeting.status}`}>
            {MEETING_STATUS_LABELS[meeting.status]}
          </span>
          {nextStatusLabel && (
            <button className="admin-btn-sm" onClick={advanceStatus} disabled={advancing}>
              {advancing ? '…' : nextStatusLabel}
            </button>
          )}
        </div>
        {advErr && <div className="admin-err" style={{ marginTop: 8 }}>{advErr}</div>}
        {meeting.quorum_required_pct && (
          <div className="voice-quorum-row">
            Quorum required: {meeting.quorum_required_pct}%
            {meeting.quorum_confirmed
              ? <span className="voice-badge-quorum">Quorum confirmed</span>
              : meeting.status === 'in_progress'
                ? <QuorumConfirmBtn meetingId={meetingId} communityId={meeting.community_id} onDone={reload} />
                : null}
          </div>
        )}
      </div>

      <div className="voice-tabs">
        {['votes', 'docs', 'notify', 'settings'].map(t => (
          <button key={t} className={`voice-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'votes' ? 'Votes' : t === 'docs' ? 'Documents' : t === 'notify' ? 'Notify residents' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'votes'  && <VotesPanel  meeting={meeting} reload={reload} />}
      {tab === 'docs'   && <DocsPanel   meeting={meeting} reload={reload} />}
      {tab === 'notify' && <NotifyPanel meeting={meeting} />}
    </div>
  )
}

function NotifyPanel({ meeting }) {
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr]         = useState(null)
  const { notices, loading, reload } = useCommunityNotices({ meetingId: meeting.id })

  const send = async (e) => {
    e.preventDefault()
    if (!subject.trim() && !body.trim()) {
      setErr('Add a subject or body before sending.')
      return
    }
    setSending(true)
    setErr(null)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_notices').insert({
          community_id: meeting.community_id,
          meeting_id:   meeting.id,
          kind:         'custom_broadcast',
          channels:     ['in_app'],
          subject:      subject.trim(),
          body:         body.trim(),
        })
      )
      if (error) throw error
      logAudit({
        community_id: meeting.community_id,
        event_type:   'notice.sent',
        target_type:  'notice',
        metadata:     { kind: 'custom_broadcast', meeting_id: meeting.id, subject: subject.trim() },
      })
      setSubject('')
      setBody('')
      reload()
    } catch (e) {
      setErr(e?.message ?? 'Failed to send notice.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel-head"><span>Send a notice to all residents</span></div>

      <form className="voice-form" onSubmit={send}>
        <div className="voice-form-row">
          <label>Subject</label>
          <input
            name="notice-subject"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Reminder: meeting starts in 1 hour"
          />
        </div>
        <div className="voice-form-row">
          <label>Body</label>
          <textarea
            name="notice-body"
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            placeholder="What do residents need to know?"
          />
        </div>
        <div className="voice-form-row">
          <label>Channels</label>
          <div className="voice-channels-readonly">In-app only (email coming soon)</div>
        </div>
        {err && <div className="admin-err">{err}</div>}
        <div className="voice-form-actions">
          <button type="submit" className="admin-btn" disabled={sending}>
            {sending ? 'Sending…' : 'Send notice'}
          </button>
        </div>
      </form>

      <div className="voice-panel-head" style={{ marginTop: 24 }}><span>Notice history</span></div>
      {loading && <div className="admin-placeholder">Loading…</div>}
      {!loading && notices.length === 0 && (
        <div className="admin-placeholder">No notices sent for this meeting yet.</div>
      )}
      {!loading && notices.map((n: any) => (
        <div key={n.id} className="voice-notice-row">
          <div className="voice-notice-left">
            <div className="voice-notice-kind">{NOTICE_KIND_LABELS[n.kind] ?? n.kind}</div>
            <div className="voice-notice-subject">{n.subject || '(no subject)'}</div>
            {n.body && <div className="voice-notice-body">{n.body}</div>}
          </div>
          <div className="voice-notice-right">
            <div className="voice-notice-meta">{fmtDt(n.sent_at)}</div>
            <div className="voice-notice-stats">
              Sent to {n.recipient_count ?? 0} · {n.in_app_read_count ?? 0} read
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function QuorumConfirmBtn({ meetingId, communityId, onDone }) {
  const [confirming, setConfirming] = useState(false)
  const { profile } = useAuth() || {}

  const confirm = async () => {
    setConfirming(true)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_meetings').update({
          quorum_confirmed: true,
          quorum_confirmed_by: profile?.id,
          quorum_confirmed_at: new Date().toISOString(),
        }).eq('id', meetingId)
      )
      if (error) throw error
      logAudit({
        community_id: communityId,
        event_type:   'meeting.quorum_confirmed',
        target_type:  'meeting',
        target_id:    meetingId,
      })
      onDone()
    } catch {
      /* keep going */
    } finally {
      setConfirming(false)
    }
  }

  return (
    <button className="admin-btn-sm" onClick={confirm} disabled={confirming}>
      {confirming ? '…' : 'Confirm quorum'}
    </button>
  )
}

function VotesPanel({ meeting, reload }) {
  const [showForm, setShowForm] = useState(false)
  const votes = meeting.ev_votes ?? []

  return (
    <div className="voice-panel">
      <div className="voice-panel-head">
        <span>Vote items</span>
        <button className="admin-btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add vote'}
        </button>
      </div>

      {showForm && (
        <VoteForm
          meetingId={meeting.id}
          communityId={meeting.community_id}
          onSaved={() => { setShowForm(false); reload() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {votes.length === 0 && !showForm && (
        <div className="admin-placeholder">No vote items yet. Add one above.</div>
      )}

      {votes.map(v => <VoteRow key={v.id} vote={v} meetingStatus={meeting.status} onChanged={reload} />)}
    </div>
  )
}

function VoteRow({ vote: v, meetingStatus, onChanged }) {
  const typeLabel = VOTE_TYPES.find(t => t.value === v.type)?.label ?? v.type
  const [acting, setActing] = useState(false)

  const openVote = async () => {
    setActing(true)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_votes').update({ status: 'open', opens_at: new Date().toISOString() }).eq('id', v.id)
      )
      if (error) throw error
      logAudit({
        community_id: v.community_id,
        event_type:   'vote.opened',
        target_type:  'vote',
        target_id:    v.id,
        metadata:     { title: v.title, ballot_type: v.ballot_type, type: v.type },
      })
      onChanged()
    } catch { /* keep */ } finally { setActing(false) }
  }

  const closeVote = async () => {
    setActing(true)
    try {
      const total = (v.yes_count ?? 0) + (v.no_count ?? 0)
      const result = total === 0 ? null : v.yes_count >= v.no_count ? 'pass' : 'fail'
      const { error } = await withTimeout(
        supabase.from('ev_votes').update({
          status: 'tallied',
          closes_at: new Date().toISOString(),
          result,
        }).eq('id', v.id)
      )
      if (error) throw error
      logAudit({
        community_id: v.community_id,
        event_type:   'vote.closed',
        target_type:  'vote',
        target_id:    v.id,
        metadata:     { yes: v.yes_count ?? 0, no: v.no_count ?? 0, abstain: v.abstain_count ?? 0, result },
      })
      onChanged()
    } catch { /* keep */ } finally { setActing(false) }
  }

  const publishResult = async () => {
    setActing(true)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_votes').update({ status: 'published' }).eq('id', v.id)
      )
      if (error) throw error
      logAudit({
        community_id: v.community_id,
        event_type:   'vote.published',
        target_type:  'vote',
        target_id:    v.id,
        metadata:     { result: v.result },
      })
      onChanged()
    } catch { /* keep */ } finally { setActing(false) }
  }

  return (
    <div className="voice-vote-row">
      <div className="voice-vote-left">
        <div className="voice-vote-title">{v.title}</div>
        <div className="voice-vote-meta">
          {typeLabel}
          {' · '}{v.ballot_type === 'secret' ? '🔒 Secret ballot' : 'Open ballot'}
        </div>
        {(v.status === 'tallied' || v.status === 'published') && (
          <div className="voice-tally">
            <span className="voice-tally-yes">✓ {v.yes_count ?? 0} yes</span>
            <span className="voice-tally-no">✗ {v.no_count ?? 0} no</span>
            <span className="voice-tally-abs">{v.abstain_count ?? 0} abstain</span>
            {v.result && (
              <span className={`voice-result voice-result-${v.result}`}>
                {v.result === 'pass' ? 'PASSED' : 'FAILED'}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="voice-vote-right">
        <span className={`voice-status voice-status-${v.status}`}>
          {VOTE_STATUS_LABELS[v.status] ?? v.status}
        </span>
        {v.status === 'draft' && meetingStatus === 'in_progress' && (
          <button className="admin-btn-sm" onClick={openVote} disabled={acting}>Open vote</button>
        )}
        {v.status === 'open' && (
          <button className="admin-btn-sm admin-btn-warn" onClick={closeVote} disabled={acting}>Close &amp; tally</button>
        )}
        {v.status === 'tallied' && (
          <button className="admin-btn-sm" onClick={publishResult} disabled={acting}>Publish result</button>
        )}
      </div>
    </div>
  )
}

function VoteForm({ meetingId, communityId, onSaved, onCancel }) {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState(EMPTY_VOTE)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'type' && v === 'election') next.ballot_type = 'secret'
    return next
  })

  const save = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Title is required.'); return }
    setSaving(true)
    setErr(null)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_votes').insert({
          meeting_id:   meetingId,
          community_id: communityId,
          title:        form.title.trim(),
          description:  form.description.trim() || null,
          type:         form.type,
          ballot_type:  form.ballot_type,
          mode:         form.mode,
          created_by:   profile?.id,
        })
      )
      if (error) throw error
      onSaved()
    } catch (e) {
      setErr(e?.message ?? 'Failed to save vote.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="voice-vote-form" onSubmit={save}>
      <div className="voice-form-row">
        <label>Vote title</label>
        <input name="vote-title" type="text" value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="e.g. Approve pool renovation special assessment" required />
      </div>
      <div className="voice-form-row">
        <label>Description <span className="voice-opt">(optional)</span></label>
        <textarea name="vote-description" value={form.description} onChange={e => set('description', e.target.value)}
          rows={2} placeholder="Additional details visible to residents…" />
      </div>
      <div className="voice-form-inline">
        <div className="voice-form-row">
          <label>Type</label>
          <select name="vote-type" value={form.type} onChange={e => set('type', e.target.value)}>
            {VOTE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="voice-form-row">
          <label>Ballot type</label>
          <select name="ballot-type" value={form.ballot_type} onChange={e => set('ballot_type', e.target.value)}
            disabled={form.type === 'election'}>
            <option value="open">Open</option>
            <option value="secret">Secret</option>
          </select>
          {form.type === 'election' && (
            <div className="voice-hard-block">Elections must use secret ballot (FL 718.112(2)(d)(3))</div>
          )}
        </div>
      </div>
      {err && <div className="admin-err">{err}</div>}
      <div className="voice-form-actions">
        <button type="submit" className="admin-btn" disabled={saving}>{saving ? 'Adding…' : 'Add vote item'}</button>
        <button type="button" className="admin-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function DocsPanel({ meeting, reload }) {
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState('agenda')
  const [docTitle, setDocTitle] = useState('')
  const [err, setErr] = useState(null)
  const { profile } = useAuth() || {}
  const docs = meeting.ev_meeting_docs ?? []

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !docTitle.trim()) { setErr('Title is required before uploading.'); return }
    if (!hasSupabase) { setErr('Supabase not configured.'); return }
    setUploading(true)
    setErr(null)
    try {
      const ext = file.name.split('.').pop()
      const path = `${meeting.community_id}/${meeting.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await withTimeout(
        supabase.storage.from('ev-documents').upload(path, file)
      )
      if (upErr) throw upErr
      const { data: docRow, error: dbErr } = await withTimeout(
        supabase.from('ev_meeting_docs').insert({
          meeting_id:   meeting.id,
          community_id: meeting.community_id,
          type:         docType,
          title:        docTitle.trim(),
          storage_path: path,
          file_size:    file.size,
          uploaded_by:  profile?.id,
        }).select('id').single()
      )
      if (dbErr) throw dbErr
      logAudit({
        community_id: meeting.community_id,
        event_type:   'document.uploaded',
        target_type:  'document',
        target_id:    docRow?.id ?? null,
        metadata:     { meeting_id: meeting.id, type: docType, title: docTitle.trim(), file_size: file.size },
      })
      // Silent for draft meetings (board still composing) and for
      // supporting/notice_record docs (admin can broadcast manually).
      if (
        (docType === 'agenda' || docType === 'minutes') &&
        (meeting.status === 'notice_sent' || meeting.status === 'in_progress')
      ) {
        const kind = docType === 'minutes' ? 'minutes_published' : 'document_uploaded'
        const copy = defaultNoticeCopy(kind, { meetingTitle: meeting.title, docTitle: docTitle.trim() })
        try {
          await withTimeout(
            supabase.from('ev_notices').insert({
              community_id: meeting.community_id,
              meeting_id:   meeting.id,
              kind,
              channels:     ['in_app'],
              subject:      copy.subject,
              body:         copy.body,
            })
          )
          logAudit({
            community_id: meeting.community_id,
            event_type:   'notice.sent',
            target_type:  'notice',
            metadata:     { kind, meeting_id: meeting.id, doc_title: docTitle.trim() },
          })
        } catch { /* upload succeeded; notice is best-effort */ }
      }
      setDocTitle('')
      reload()
    } catch (e) {
      setErr(e?.message ?? 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel-head"><span>Meeting documents</span></div>

      <div className="voice-upload-row">
        <select name="doc-type" value={docType} onChange={e => setDocType(e.target.value)}>
          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input
          name="doc-title"
          type="text"
          value={docTitle}
          onChange={e => setDocTitle(e.target.value)}
          placeholder="Document title"
        />
        <label className={`admin-btn-sm voice-upload-btn${uploading ? ' disabled' : ''}`}>
          {uploading ? 'Uploading…' : 'Choose file'}
          <input name="meeting-doc" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={upload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {err && <div className="admin-err" style={{ marginTop: 8 }}>{err}</div>}

      {docs.length === 0 && (
        <div className="admin-placeholder">No documents attached yet.</div>
      )}

      {docs.map(d => <DocRow key={d.id} doc={d} communityId={meeting.community_id} onDeleted={reload} />)}
    </div>
  )
}

function DocRow({ doc: d, communityId, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [url, setUrl] = useState(null)
  const typeLabel = DOC_TYPES.find(t => t.value === d.type)?.label ?? d.type

  const getUrl = async () => {
    if (url) { window.open(url, '_blank'); return }
    try {
      const { data } = await supabase.storage.from('ev-documents').createSignedUrl(d.storage_path, 300)
      if (data?.signedUrl) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank') }
    } catch { /* keep */ }
  }

  const del = async () => {
    if (!window.confirm(`Delete "${d.title}"?`)) return
    setDeleting(true)
    try {
      await supabase.storage.from('ev-documents').remove([d.storage_path])
      await withTimeout(supabase.from('ev_meeting_docs').delete().eq('id', d.id))
      logAudit({
        community_id: communityId,
        event_type:   'document.deleted',
        target_type:  'document',
        target_id:    d.id,
        metadata:     { meeting_id: d.meeting_id, type: d.type, title: d.title },
      })
      onDeleted()
    } catch { /* keep */ } finally { setDeleting(false) }
  }

  return (
    <div className="voice-doc-row">
      <div className="voice-doc-left">
        <span className="voice-doc-type">{typeLabel}</span>
        <button className="voice-doc-title" onClick={getUrl}>{d.title}</button>
        {d.file_size && (
          <span className="voice-doc-meta">{(d.file_size / 1024).toFixed(0)} KB</span>
        )}
      </div>
      <button className="voice-doc-del" onClick={del} disabled={deleting} aria-label="Delete document">
        {deleting ? '…' : '×'}
      </button>
    </div>
  )
}
