'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  MEETING_TYPES, VOTE_TYPES, VOTE_CATEGORIES, DOC_TYPES,
  noticeWarning, MEETING_STATUS_LABELS, VOTE_STATUS_LABELS,
  NOTICE_KIND_LABELS, defaultNoticeCopy, DEFAULT_CHANNELS,
  type NoticeChannel,
} from '@/lib/voice'
import { useVoiceMeetings, useVoiceMeeting } from '@/hooks/useVoiceMeetings'
import { useCommunityNotices } from '@/hooks/useNotices'
import { logAudit } from '@/lib/audit'
import {
  generateVoteKeypair, wrapSecretKey, unwrapSecretKey,
  decryptAnswer, exportKeyCard, bytesToBase64,
} from '@/lib/ballotCrypto'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'
import { WorkspaceLinks } from '../WorkspaceLinks'

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
  quorum_required_pct: '', summary: '',
}

export default function Meetings() {
  const t = useT()
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
    <div className="admin-page cset">
      <EasyVoiceTabs active="meetings" />

      <div className="admin-section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="admin-kicker">Easy Voice</div>
          <h1 className="admin-h1">{t('admin.voice.pageTitle')}</h1>
          <p className="admin-dek">{t('admin.voice.pageDek')}</p>
        </div>
        <button className="admin-primary-btn" onClick={() => setView('create')}>{t('admin.voice.newMeeting')}</button>
      </div>

      {loading && <div className="admin-placeholder">{t('admin.voice.loadingMeetings')}</div>}
      {error && <div className="admin-err">{error}</div>}

      {!loading && !error && meetings.length === 0 && (
        <div className="admin-placeholder">
          {t('admin.voice.noMeetings')}
        </div>
      )}

      {!loading && meetings.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>{t('admin.voice.allMeetings')}</h2><div className="sub">{t('admin.voice.allMeetingsSub')}</div></div></div>
          <div className="voice-meeting-list">
            {meetings.map(m => (
              <MeetingRow
                key={m.id}
                meeting={m}
                onClick={() => { setSelectedId(m.id); setView('detail') }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Governance workspaces re-homed from the Compliance tab (consolidation phase 1). */}
      <WorkspaceLinks title="Statutory workspaces" items={[
        { href: '/admin/meetings', label: 'Meeting notices & minutes', desc: 'The 48-hour / 14-day notice clock, agendas, and minutes availability for these meetings.', color: '#0891B2' },
        { href: '/admin/elections', label: 'Elections & recall', desc: 'The 60 / 40 / 14-day election timeline, the election quorum, and the recall clock.', color: '#7C3AED' },
        { href: '/admin/governance', label: 'Directors & management', desc: 'Term limits, the director certification clock, conflicts of interest, and CAM licensing.', color: '#9333EA' },
      ]} />
    </div>
  )
}

function MeetingRow({ meeting: m, onClick }) {
  const t = useT()
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
          <span className="voice-badge-open">{t('admin.voice.openVotes', { count: openVotes, s: openVotes > 1 ? 's' : '' })}</span>
        )}
      </div>
    </button>
  )
}

function MeetingForm({ onSaved, onCancel, existing, embedded }: { onSaved: (id) => void; onCancel: () => void; existing?: any; embedded?: boolean }) {
  const t = useT()
  const { profile } = useAuth() || {}
  const [form, setForm] = useState(
    existing
      ? {
          ...EMPTY_MEETING,
          ...existing,
          // datetime-local needs "yyyy-MM-ddThh:mm"; the DB returns a full ISO.
          scheduled_at: String(existing.scheduled_at ?? '').slice(0, 16),
          // coerce nullable columns to '' so the inputs stay controlled (no React null warning).
          location: existing.location ?? '',
          virtual_link: existing.virtual_link ?? '',
          quorum_required_pct: existing.quorum_required_pct ?? '',
          summary: existing.summary ?? '',
        }
      : EMPTY_MEETING,
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const warning = noticeWarning(form.type, form.scheduled_at)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    if (!hasSupabase || !profile?.community_id) return
    if (!form.title.trim() || !form.scheduled_at) {
      setErr(t('admin.voice.errTitleDateRequired'))
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
        summary:             form.summary?.trim() || null,
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
      setErr(e?.message ?? t('admin.voice.errFailedSaveMeeting'))
    } finally {
      setSaving(false)
    }
  }

  const fields = (
    <>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldMeetingType')}</label>
        <Dropdown<string>
          value={form.type}
          onChange={v => set('type', v)}
          ariaLabel={t('admin.voice.fieldMeetingType')}
          options={MEETING_TYPES}
        />
      </div>

      <div className="voice-form-row">
        <label>{t('admin.voice.fieldTitle')}</label>
        <input
          name="title"
          type="text"
          value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder={t('admin.voice.placeholderTitle')}
          required
        />
      </div>

      <div className="voice-form-row">
        <label>{t('admin.voice.fieldDateTime')}</label>
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
        <label>{t('admin.voice.fieldLocation')} <span className="voice-opt">{t('admin.voice.optional')}</span></label>
        <input
          name="location"
          type="text"
          value={form.location}
          onChange={e => set('location', e.target.value)}
          placeholder={t('admin.voice.placeholderLocation')}
        />
      </div>

      <div className="voice-form-row">
        <label>{t('admin.voice.fieldVirtualLink')} <span className="voice-opt">{t('admin.voice.optional')}</span></label>
        <input
          name="virtual_link"
          type="url"
          value={form.virtual_link}
          onChange={e => set('virtual_link', e.target.value)}
          placeholder="https://zoom.us/j/…"
        />
      </div>

      <div className="voice-form-row">
        <label>{t('admin.voice.fieldQuorum')} <span className="voice-opt">{t('admin.voice.optionalQuorum')}</span></label>
        <input
          name="quorum_required_pct"
          type="number"
          min="1" max="100" step="0.1"
          value={form.quorum_required_pct}
          onChange={e => set('quorum_required_pct', e.target.value)}
          placeholder={t('admin.voice.placeholderQuorum')}
        />
      </div>

      <div className="voice-form-row">
        <label>{t('admin.voice.fieldSummary')} <span className="voice-opt">{t('admin.voice.optionalSummary')}</span></label>
        <textarea
          name="summary"
          value={form.summary}
          onChange={e => set('summary', e.target.value)}
          rows={4}
          placeholder={t('admin.voice.placeholderSummary')}
        />
      </div>
    </>
  )

  // Embedded on the meeting detail page: a full-width card section (matching the
  // Documents/Notify cards) with the form inside, like NotifyPanel.
  if (embedded) {
    return (
      <div className="card">
        <div className="card-head"><div><h2>{t('admin.voice.meetingSettings')}</h2><div className="sub">{t('admin.voice.meetingSettingsSub')}</div></div></div>
        <form className="voice-form" onSubmit={save}>
          {fields}
          {err && <div className="admin-err">{err}</div>}
          <div className="card-cta voice-form-actions">
            <button type="submit" className="admin-primary-btn" disabled={saving}>
              {saving ? t('admin.voice.saving') : t('admin.voice.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    )
  }

  // Standalone "New Meeting" page (reached from the + New Meeting button).
  return (
    <div className="admin-page cset">
      <div className="admin-section-head">
        <div>
          <div className="admin-kicker">Easy Voice</div>
          <h1 className="admin-h1">{existing ? t('admin.voice.editMeeting') : t('admin.voice.newMeeting')}</h1>
        </div>
        <button className="admin-btn-ghost" onClick={onCancel}>{t('admin.voice.cancel')}</button>
      </div>

      <form className="card voice-form" onSubmit={save}>
        {fields}
        {err && <div className="admin-err">{err}</div>}
        <div className="card-cta voice-form-actions">
          <button type="submit" className="admin-primary-btn" disabled={saving}>
            {saving ? t('admin.voice.saving') : existing ? t('admin.voice.saveChanges') : t('admin.voice.createMeeting')}
          </button>
          <button type="button" className="admin-btn-ghost" onClick={onCancel}>{t('admin.voice.cancel')}</button>
        </div>
      </form>
    </div>
  )
}

function MeetingDetail({ meetingId, onBack }) {
  const t = useT()
  const { meeting, loading, error, reload } = useVoiceMeeting(meetingId)
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
              channels:     DEFAULT_CHANNELS,
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
      setAdvErr(e?.message ?? t('admin.voice.errFailedUpdateStatus'))
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) return <div className="admin-page cset"><div className="admin-placeholder">{t('admin.voice.loading')}</div></div>
  if (error)   return <div className="admin-page cset"><div className="admin-err">{error}</div></div>
  if (!meeting) return null

  const typeLabel = MEETING_TYPES.find(t => t.value === meeting.type)?.label ?? meeting.type
  const nextStatusLabel = {
    draft: t('admin.voice.markNoticeSent'),
    notice_sent: t('admin.voice.startMeeting'),
    in_progress: t('admin.voice.completeMeeting'),
  }[meeting.status]

  return (
    <div className="admin-page cset">
      <button type="button" className="admin-backlink" onClick={onBack}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        <span aria-hidden>←</span> {t('admin.voice.backToMeetings')}
      </button>

      <div className="card voice-detail-header">
        <div className="voice-meeting-type">{typeLabel}</div>
        <h2 className="voice-detail-title">{meeting.title}</h2>
        <div className="voice-detail-meta">
          <span>{fmtDt(meeting.scheduled_at)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
          {meeting.virtual_link && (
            <a className="voice-link" href={meeting.virtual_link} target="_blank" rel="noreferrer">{t('admin.voice.virtualLink')}</a>
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
            {t('admin.voice.quorumRequired', { pct: meeting.quorum_required_pct })}
            {meeting.quorum_confirmed
              ? <span className="voice-badge-quorum">{t('admin.voice.quorumConfirmed')}</span>
              : meeting.status === 'in_progress'
                ? <QuorumConfirmBtn meetingId={meetingId} communityId={meeting.community_id} onDone={reload} />
                : null}
          </div>
        )}
      </div>

      {/* Everything on one page, in order: documents, then notices, then the
          editable settings/recap at the bottom. (Was a Documents/Notify/Settings
          tab bar.) */}
      <DocsPanel meeting={meeting} reload={reload} />
      <NotifyPanel meeting={meeting} />
      <MeetingForm existing={meeting} embedded onSaved={reload} onCancel={onBack} />
    </div>
  )
}

function NotifyPanel({ meeting }) {
  const t = useT()
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [channels, setChannels] = useState<NoticeChannel[]>(DEFAULT_CHANNELS)
  const [sending, setSending] = useState(false)
  const [err, setErr]         = useState(null)
  const { notices, loading, reload } = useCommunityNotices({ meetingId: meeting.id })

  const toggleChannel = (c: NoticeChannel) => {
    setChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  const send = async (e) => {
    e.preventDefault()
    if (!subject.trim() && !body.trim()) {
      setErr(t('admin.voice.errNoticeSubjectOrBody'))
      return
    }
    if (channels.length === 0) {
      setErr(t('admin.voice.errNoticeChannel'))
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
          channels,
          subject:      subject.trim(),
          body:         body.trim(),
        })
      )
      if (error) throw error
      logAudit({
        community_id: meeting.community_id,
        event_type:   'notice.sent',
        target_type:  'notice',
        metadata:     {
          kind: 'custom_broadcast', meeting_id: meeting.id,
          subject: subject.trim(), channels,
        },
      })
      setSubject('')
      setBody('')
      reload()
    } catch (e) {
      setErr(e?.message ?? t('admin.voice.errFailedSendNotice'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="voice-panel">
      <div className="card">
      <div className="card-head"><div><h2>{t('admin.voice.sendNoticeHeading')}</h2></div></div>

      <form className="voice-form" onSubmit={send}>
        <div className="voice-form-row">
          <label>{t('admin.voice.fieldSubject')}</label>
          <input
            name="notice-subject"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('admin.voice.placeholderSubject')}
          />
        </div>
        <div className="voice-form-row">
          <label>{t('admin.voice.fieldBody')}</label>
          <textarea
            name="notice-body"
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            placeholder={t('admin.voice.placeholderBody')}
          />
        </div>
        <div className="voice-form-row">
          <label>{t('admin.voice.fieldChannels')}</label>
          <div className="voice-channels">
            <label className="voice-channel-opt">
              <input
                type="checkbox"
                checked={channels.includes('in_app')}
                onChange={() => toggleChannel('in_app')}
              />
              <span>{t('admin.voice.channelInApp')}</span>
            </label>
            <label className="voice-channel-opt">
              <input
                type="checkbox"
                checked={channels.includes('email')}
                onChange={() => toggleChannel('email')}
              />
              <span>{t('admin.voice.channelEmail')}</span>
            </label>
          </div>
        </div>
        {err && <div className="admin-err">{err}</div>}
        <div className="card-cta voice-form-actions">
          <button type="submit" className="admin-primary-btn" disabled={sending}>
            {sending ? t('admin.voice.sending') : t('admin.voice.sendNotice')}
          </button>
        </div>
      </form>
      </div>

      <div className="card">
      <div className="card-head"><div><h2>{t('admin.voice.noticeHistory')}</h2></div></div>
      {loading && <div className="admin-placeholder">{t('admin.voice.loading')}</div>}
      {!loading && notices.length === 0 && (
        <div className="admin-placeholder">{t('admin.voice.noNotices')}</div>
      )}
      {!loading && notices.map((n: any) => (
        <div key={n.id} className="voice-notice-row">
          <div className="voice-notice-left">
            <div className="voice-notice-kind">{NOTICE_KIND_LABELS[n.kind] ?? n.kind}</div>
            <div className="voice-notice-subject">{n.subject || t('admin.voice.noSubject')}</div>
            {n.body && <div className="voice-notice-body">{n.body}</div>}
          </div>
          <div className="voice-notice-right">
            <div className="voice-notice-meta">{fmtDt(n.sent_at)}</div>
            <div className="voice-notice-stats">
              {t('admin.voice.noticeStats', { sent: n.recipient_count ?? 0, read: n.in_app_read_count ?? 0 })}
            </div>
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

function QuorumConfirmBtn({ meetingId, communityId, onDone }) {
  const t = useT()
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
      {confirming ? '…' : t('admin.voice.confirmQuorum')}
    </button>
  )
}

function DocsPanel({ meeting, reload }) {
  const t = useT()
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState('agenda')
  const [docTitle, setDocTitle] = useState('')
  const [err, setErr] = useState(null)
  const { profile } = useAuth() || {}
  const docs = meeting.ev_meeting_docs ?? []

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !docTitle.trim()) { setErr(t('admin.voice.errDocTitleRequired')); return }
    if (!hasSupabase) { setErr(t('admin.voice.errSupabaseNotConfigured')); return }
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
              channels:     DEFAULT_CHANNELS,
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
      setErr(e?.message ?? t('admin.voice.errUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="card voice-panel">
      <div className="card-head"><div><h2>{t('admin.voice.meetingDocuments')}</h2></div></div>

      <div className="voice-upload-row">
        <div style={{ minWidth: 190 }}>
          <Dropdown<string>
            value={docType}
            onChange={setDocType}
            ariaLabel={t('admin.voice.docTypeAria')}
            options={DOC_TYPES}
          />
        </div>
        <input
          name="doc-title"
          type="text"
          value={docTitle}
          onChange={e => setDocTitle(e.target.value)}
          placeholder={t('admin.voice.placeholderDocTitle')}
        />
        <label className={`admin-btn-sm voice-upload-btn${uploading ? ' disabled' : ''}`}>
          {uploading ? t('admin.voice.uploading') : t('admin.voice.chooseFile')}
          <input name="meeting-doc" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={upload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {err && <div className="admin-err" style={{ marginTop: 8 }}>{err}</div>}

      {docs.length === 0 && (
        <div className="admin-placeholder">{t('admin.voice.noDocuments')}</div>
      )}

      {docs.map(d => <DocRow key={d.id} doc={d} communityId={meeting.community_id} onDeleted={reload} />)}
    </div>
  )
}

function DocRow({ doc: d, communityId, onDeleted }) {
  const t = useT()
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
    if (!window.confirm(t('admin.voice.confirmDeleteDoc', { title: d.title }))) return
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
      <button className="voice-doc-del" onClick={del} disabled={deleting} aria-label={t('admin.voice.deleteDocAria')}>
        {deleting ? '…' : '×'}
      </button>
    </div>
  )
}
